require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const db = require('../models/database');
const { generateStory, generateStoryCustom, generateLongStory } = require('./storyService');
const { generateVideoClip } = require('./videoService');
const { mergeVideoClips, getVideoDuration, applyPostVFX, burnSubtitle } = require('./ffmpegService');
const { generateSpeech } = require('./ttsService');
const { buildMotionPrompt } = require('./motionService');
const { deductCredits } = require('../middleware/credits');
const orchestrator = require('./agentOrchestrator');

const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg') ? process.env.FFMPEG_PATH : ffmpegStatic;
ffmpeg.setFfmpegPath(ffmpegPath);

const https = require('https');
const axios = require('axios');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const CHAR_IMG_DIR = path.join(OUTPUT_DIR, 'characters');
const SCENE_IMG_DIR = path.join(OUTPUT_DIR, 'scenes');

// === 图片公网 URL 缓存（同一张图片只上传一次）===
const _publicUrlCache = new Map();

// 将本地文件转为 { base64, filePath }
function resolveLocalFile(filename) {
  for (const dir of [CHAR_IMG_DIR, SCENE_IMG_DIR, OUTPUT_DIR]) {
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filename).toLowerCase().replace('.', '') || 'png';
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const base64 = `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
      return { base64, filePath, mime, ext };
    }
  }
  return null;
}

// 将 imageRef（API路径/localhost URL/外部URL）解析为 { base64, publicUrl }
// base64: data URI 格式（本地文件时）
// publicUrl: 公网可访问的 URL（外部链接或上传后的临时链接）
function resolveImageRef(imageRef) {
  try {
    if (!imageRef) {
      console.log('[resolveImageRef] 输入为空');
      return { base64: null, publicUrl: null };
    }

    console.log(`[resolveImageRef] 解析: ${imageRef.substring(0, 100)}`);

    // 外部 URL 直接可用
    if (imageRef.startsWith('http') && !imageRef.startsWith('http://localhost') && !imageRef.startsWith('http://127.0.0.1')) {
      console.log(`[resolveImageRef] 外部 URL 直接使用`);
      return { base64: null, publicUrl: imageRef };
    }

    // 从各种本地路径提取文件名
    let filename = null;
    if (imageRef.startsWith('http://localhost') || imageRef.startsWith('http://127.0.0.1')) {
      const m = imageRef.match(/\/([^\/]+\.(?:png|jpg|jpeg|webp))$/i);
      if (m) filename = m[1];
    } else if (imageRef.startsWith('/api/story/character-image/')) {
      filename = imageRef.replace('/api/story/character-image/', '');
    } else if (imageRef.startsWith('/api/i2v/images/')) {
      filename = imageRef.replace('/api/i2v/images/', '');
      // i2v 上传目录
      const filePath = path.join(OUTPUT_DIR, 'i2v_uploads', filename);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filename).toLowerCase().replace('.', '') || 'png';
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        console.log(`[resolveImageRef] 找到 i2v 图片: ${filePath}`);
        return { base64: `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`, publicUrl: null };
      }
      console.warn(`[resolveImageRef] i2v 图片不存在: ${filePath}`);
      return { base64: null, publicUrl: null };
    }

    if (!filename) {
      console.warn(`[resolveImageRef] 无法从路径提取文件名: ${imageRef}`);
      return { base64: null, publicUrl: null };
    }

    const local = resolveLocalFile(filename);
    if (!local) {
      console.warn(`[resolveImageRef] 本地文件未找到: ${filename}（已搜索 characters/ scenes/ outputs/）`);
      return { base64: null, publicUrl: null };
    }
    console.log(`[resolveImageRef] 本地文件已解析: ${local.filePath} (${Math.round(local.base64.length / 1024)}KB base64)`);
    return { base64: local.base64, publicUrl: null, _filePath: local.filePath, _mime: local.mime, _ext: local.ext };
  } catch (e) {
    console.warn('[resolveImageRef] 解析失败:', e.message);
    return { base64: null, publicUrl: null };
  }
}

// 上传本地图片到免费图床获取公网 URL（供不支持 base64 的视频API使用）
// 优先级：PUBLIC_URL 自托管 → smms → catbox → 0x0.st
async function uploadImageToTempHost(base64DataUri, cacheKey) {
  if (!base64DataUri || !base64DataUri.startsWith('data:')) {
    console.warn('[Upload] 无效的 base64 数据，跳过上传');
    return null;
  }

  // 检查缓存
  if (cacheKey && _publicUrlCache.has(cacheKey)) {
    const cached = _publicUrlCache.get(cacheKey);
    console.log(`[Upload] 使用缓存 URL: ${cached}`);
    return cached;
  }

  const matches = base64DataUri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!matches) {
    console.warn('[Upload] base64 数据格式不正确，无法解析');
    return null;
  }

  const mimeType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const ext = mimeType.includes('jpeg') ? 'jpg' : (mimeType.split('/')[1] || 'png');
  console.log(`[Upload] 准备上传图片: ${Math.round(buffer.length / 1024)}KB, type=${mimeType}, cacheKey=${cacheKey ? cacheKey.substring(0, 60) : 'none'}`);

  // 方法0: 自托管（如果配置了 PUBLIC_URL，直接构造本服务器的公网 URL）
  const publicBaseUrl = process.env.PUBLIC_URL;
  if (publicBaseUrl && cacheKey) {
    // cacheKey 通常是 /api/story/character-image/xxx.png 格式
    if (cacheKey.startsWith('/api/')) {
      const selfUrl = publicBaseUrl.replace(/\/+$/, '') + cacheKey;
      console.log(`[Upload] 使用 PUBLIC_URL 自托管: ${selfUrl}`);
      _publicUrlCache.set(cacheKey, selfUrl);
      return selfUrl;
    }
    // cacheKey 也可能是外部 URL（已缓存的情况）
    if (cacheKey.startsWith('http')) {
      console.log(`[Upload] cacheKey 已是外部 URL: ${cacheKey}`);
      _publicUrlCache.set(cacheKey, cacheKey);
      return cacheKey;
    }
  }

  // 方法1: sm.ms（中国图床，国内访问快）
  try {
    const boundary = '----VidoUpload' + Date.now().toString(36);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="smfile"; filename="ref.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, buffer, tail]);

    const resp = await axios.post('https://sm.ms/api/v2/upload', body, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'User-Agent': 'VIDO/1.0'
      },
      timeout: 30000,
      maxBodyLength: 50 * 1024 * 1024
    });
    const url = resp.data?.data?.url || resp.data?.images;
    if (url && typeof url === 'string' && url.startsWith('http')) {
      console.log(`[Upload] sm.ms 成功: ${url}`);
      if (cacheKey) _publicUrlCache.set(cacheKey, url);
      return url;
    }
    // sm.ms 返回 "Image upload repeated limit" 时图片已存在，使用已有URL
    if (resp.data?.code === 'image_repeated' && resp.data?.images) {
      const existUrl = resp.data.images;
      console.log(`[Upload] sm.ms 图片已存在: ${existUrl}`);
      if (cacheKey) _publicUrlCache.set(cacheKey, existUrl);
      return existUrl;
    }
  } catch (e) {
    console.warn(`[Upload] sm.ms 失败: ${e.message}`);
  }

  // 方法2: catbox.moe（国际图床，长期保存）
  try {
    const boundary = '----VidoUpload' + Date.now().toString(36);
    const parts = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="ref.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const resp = await axios.post('https://catbox.moe/user/api.php', parts, {
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      timeout: 30000,
      maxBodyLength: 50 * 1024 * 1024
    });
    const url = (resp.data || '').toString().trim();
    if (url.startsWith('http')) {
      console.log(`[Upload] catbox 成功: ${url}`);
      if (cacheKey) _publicUrlCache.set(cacheKey, url);
      return url;
    }
  } catch (e) {
    console.warn(`[Upload] catbox 失败: ${e.message}`);
  }

  // 方法3: 0x0.st（极简图床）
  try {
    const boundary = '----VidoUpload' + Date.now().toString(36);
    const parts = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ref.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const resp = await axios.post('https://0x0.st', parts, {
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      timeout: 30000,
      maxBodyLength: 50 * 1024 * 1024
    });
    const url = (resp.data || '').toString().trim();
    if (url.startsWith('http')) {
      console.log(`[Upload] 0x0.st 成功: ${url}`);
      if (cacheKey) _publicUrlCache.set(cacheKey, url);
      return url;
    }
  } catch (e) {
    console.warn(`[Upload] 0x0.st 失败: ${e.message}`);
  }

  console.warn('[Upload] 所有图床上传失败，将使用 base64 模式（提示：可设置环境变量 PUBLIC_URL=https://your-domain.com 使用自托管方式绕过图床）');
  return null;
}

// 兼容旧接口：resolveImageToBase64
function resolveImageToBase64(imageRef) {
  const { base64, publicUrl } = resolveImageRef(imageRef);
  return publicUrl || base64 || null;
}

// 加载用户自定义风格模板（合并内置预设）
function loadStyleTemplates() {
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    if (settings.style_templates && Object.keys(settings.style_templates).length) {
      return { ...ANIM_STYLE_PROMPTS, ...settings.style_templates };
    }
  } catch {}
  return ANIM_STYLE_PROMPTS;
}

// 动画风格 → prompt 前缀 + 负向提示词（实际影响视频模型输出）
const ANIM_STYLE_PROMPTS = {
  anime: {
    prefix: 'anime style, cel-shaded, vibrant colors, clean lineart, Japanese animation,',
    negative: 'photorealistic, live action, 3D render, blurry, grainy',
    storyHint: '日系动漫'
  },
  realistic: {
    prefix: 'cinematic, photorealistic, dramatic lighting, film grain, shallow depth of field, 8K,',
    negative: 'cartoon, anime, illustration, painting, drawing, low quality',
    storyHint: '电影写实'
  },
  '3dcg': {
    prefix: '3D CGI animation, Pixar quality, volumetric lighting, octane render, smooth shading,',
    negative: '2D, flat, hand-drawn, sketch, watercolor, pixel art',
    storyHint: '3D CG动画'
  },
  ink: {
    prefix: 'Chinese ink wash painting, shuimo style, flowing brush strokes, rice paper texture, misty atmosphere,',
    negative: 'neon, cyberpunk, 3D render, photorealistic, modern',
    storyHint: '水墨国风'
  },
  cyberpunk: {
    prefix: 'cyberpunk, neon lights, dark futuristic city, holographic HUD, purple and cyan glow, rain-slicked streets,',
    negative: 'nature, pastoral, bright daylight, watercolor, ink painting',
    storyHint: '赛博朋克科幻'
  },
  ghibli: {
    prefix: 'Studio Ghibli style, warm watercolor, lush green scenery, soft diffused lighting, hand-painted feel, gentle atmosphere,',
    negative: 'dark, grim, cyberpunk, photorealistic, 3D render, neon',
    storyHint: '吉卜力风格'
  },
  concept: {
    prefix: 'digital concept art style, semi-realistic painterly rendering, dramatic cinematic lighting, rich color palette, detailed textures, epic composition, artstation trending, matte painting quality,',
    negative: 'pure anime cel-shaded, flat colors, pixel art, low detail, blurry, watermark',
    storyHint: '概念画/CG插画（半写实画风，适合史诗战斗）'
  },
  battle: {
    prefix: 'epic battle scene, digital concept art, dramatic volumetric lighting, fire and particle effects, motion blur on action, cinematic wide-angle, dust and debris atmosphere, high contrast, intense color grading,',
    negative: 'static pose, calm scene, flat lighting, soft colors, blurry, low quality',
    storyHint: '史诗战斗（概念画风+动作特效优化）'
  },
  // ═══ 中国国风动画风格（长篇剧情动画专用） ═══
  xianxia: {
    prefix: 'Chinese xianxia fantasy animation, celestial immortal realm, flowing robes with luminous qi trails, mystical clouds and floating mountains, jade-green and gold energy effects, cinematic donghua quality, dramatic cultivation power-up scenes, ethereal lighting with lens flares, epic Chinese fantasy,',
    negative: 'Japanese anime style, western cartoon, modern city, sci-fi, pixel art, chibi, low quality',
    storyHint: '仙侠修真（玄幻仙界，修仙飞升，参考《完美世界》《一念永恒》风格）'
  },
  wuxia: {
    prefix: 'Chinese wuxia martial arts animation, dynamic kung-fu combat, ink-splash impact effects, bamboo forest and ancient architecture, silk robes flowing in wind, dramatic sword qi slashes with luminous trails, donghua cinematic quality, traditional Chinese aesthetic with modern rendering,',
    negative: 'Japanese anime, western cartoon, modern setting, sci-fi elements, pixel art, low quality',
    storyHint: '武侠江湖（刀光剑影，快意恩仇，参考《斗破苍穹》《斗罗大陆》风格）'
  },
  guoman: {
    prefix: 'Chinese donghua animation, modern Chinese animation quality, vibrant color palette, detailed character design, dynamic action sequences, cinematic lighting, blend of 2D and 3D elements, expressive character acting, professional animation production quality,',
    negative: 'Japanese anime cel-shaded, western 3D cartoon, pixel art, low quality, static image',
    storyHint: '国漫新潮（高品质国产动画，参考《凡人修仙传》《灵笼》风格）'
  },
  guofeng_3d: {
    prefix: 'Chinese 3D donghua animation, high-quality 3D CG rendering, realistic character models with Chinese aesthetic, volumetric lighting, particle effects, flowing cloth simulation, detailed environment, cinematic camera work, professional 3D animation quality comparable to top Chinese studios,',
    negative: 'Japanese anime, western cartoon, 2D flat, hand-drawn, pixel art, low quality, blurry',
    storyHint: '3D国风（高精度3D渲染，参考《完美世界》《吞噬星空》《武动乾坤》风格）'
  },
  ink_battle: {
    prefix: 'Chinese ink wash battle scene, shuimo martial arts combat, dynamic brush-stroke sword slashes, ink-splash impact effects, rice paper texture with dramatic splatter, misty mountain backdrop, calligraphic energy trails, traditional Chinese painting meets dynamic action,',
    negative: 'neon, cyberpunk, modern, photorealistic, 3D render, Japanese style',
    storyHint: '水墨战斗（水墨画风+动态打斗，适合仙侠/武侠战斗场景）'
  },
};

// === 取消制作 ===
const cancelledProjects = new Set();
function cancelPipeline(projectId) {
  cancelledProjects.add(projectId);
  emitProgress(projectId, { step: 'error', status: 'error', message: '制作已取消' });
}
function isCancelled(projectId) { return cancelledProjects.has(projectId); }

// SSE 进度推送
const progressListeners = new Map();

function emitProgress(projectId, data) {
  (progressListeners.get(projectId) || []).forEach(res => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  });
}

function addProgressListener(projectId, res) {
  const existing = progressListeners.get(projectId) || [];
  progressListeners.set(projectId, [...existing, res]);
}

function removeProgressListener(projectId, res) {
  progressListeners.set(projectId, (progressListeners.get(projectId) || []).filter(r => r !== res));
}

function createProject({ title, theme, genre, duration, music_path, music_trim_start, music_trim_end, music_volume, music_loop, custom_content, mode, anim_style, aspect_ratio, scene_dim, char_dim, voice_enabled, voice_gender, voice_id, voice_speed, video_provider, video_model, creation_mode, episode_count, episode_index, previous_summary, user_id }) {
  const id = uuidv4();
  db.insertProject({
    id,
    title: title || theme,
    theme,
    genre,
    duration,
    status: 'pending',
    music_path: music_path || null,
    music_trim_start: music_trim_start || null,
    music_trim_end: music_trim_end || null,
    music_volume: music_volume ?? 0.5,
    music_loop: music_loop !== false,
    custom_content: custom_content ? JSON.stringify(custom_content) : null,
    mode: mode || 'quick',
    anim_style: anim_style || 'anime',
    aspect_ratio: aspect_ratio || '16:9',
    scene_dim: scene_dim || '2d',
    char_dim: char_dim || '2d',
    voice_enabled: !!voice_enabled,
    voice_gender: voice_gender || 'female',
    voice_id: voice_id || null,
    voice_speed: voice_speed || 1.0,
    video_provider: video_provider || null,
    video_model: video_model || null,
    creation_mode: creation_mode || 'ai',
    episode_count: episode_count || null,
    episode_index: episode_index || null,
    previous_summary: previous_summary || null,
    user_id: user_id || null
  });
  return id;
}

function getProject(id) { return db.getProject(id); }
function listProjects() { return db.listProjects(); }
function updateProjectStatus(id, status) { db.updateProject(id, { status }); }

// 语音配音叠加到单个场景片段
function mixVoiceIntoClip(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .input(audioPath)
      .complexFilter([
        '[0:a]volume=0.25[orig]',
        '[orig][1:a]amix=inputs=2:duration=first[aout]'
      ])
      .outputOptions(['-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-shortest'])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', () => {
        // 视频无音轨时直接添加语音
        ffmpeg(videoPath)
          .input(audioPath)
          .outputOptions(['-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest'])
          .output(outputPath)
          .on('end', () => resolve(outputPath))
          .on('error', reject)
          .run();
      })
      .run();
  });
}

// 音乐叠加（使用 execSync 确保 ffmpeg 参数顺序正确）
function mixMusicIntoVideo(videoPath, musicPath, outputPath, volume = 0.5, loop = true, trimStart = null, trimEnd = null) {
  const { execSync } = require('child_process');
  return new Promise((resolve, reject) => {
    const loopFlag = loop ? '-stream_loop -1' : '';
    // 裁剪参数：-ss 起点 -t 时长（应用于音乐输入）
    const trimFlags = [];
    if (trimStart && trimStart > 0) trimFlags.push(`-ss ${trimStart}`);
    if (trimEnd && trimStart != null) {
      const dur = trimEnd - (trimStart || 0);
      if (dur > 0 && !loop) trimFlags.push(`-t ${dur}`);
    }
    const trimStr = trimFlags.length ? trimFlags.join(' ') + ' ' : '';
    // 先尝试混合（视频有音轨时 amix）
    const cmd1 = `"${ffmpegPath}" -i "${videoPath}" ${loopFlag} ${trimStr}-i "${musicPath}" -filter_complex "[1:a]volume=${volume}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -shortest -y "${outputPath}"`;
    try {
      execSync(cmd1, { stdio: 'pipe', timeout: 120000 });
      resolve(outputPath);
    } catch {
      // 视频无音轨，直接用音乐作为唯一音轨
      const cmd2 = `"${ffmpegPath}" -i "${videoPath}" ${loopFlag} ${trimStr}-i "${musicPath}" -map 0:v -map 1:a -c:v copy -c:a aac -af "volume=${volume}" -shortest -y "${outputPath}"`;
      try {
        execSync(cmd2, { stdio: 'pipe', timeout: 120000 });
        resolve(outputPath);
      } catch (e) {
        reject(new Error('音乐叠加失败: ' + (e.message || '').substring(0, 200)));
      }
    }
  });
}

async function runFullPipeline(projectId, userId = null) {
  const project = getProject(projectId);
  if (!project) throw new Error('项目不存在');

  try {
    // === 第0步：跑工作流分析 ===
    let workflowAnalysis = null;
    try {
      emitProgress(projectId, { step: 'workflow', status: 'start', message: '🎬 调用 AI 视频工作流分析...' });
      const wfResult = await orchestrator.runWorkflow(
        `视频主题: ${project.theme}\n类型: ${project.genre || 'drama'}\n时长: ${project.duration}s\n风格: ${project.anim_style || 'anime'}`,
        { taskType: 'business', workflowName: 'video' }
      );
      workflowAnalysis = wfResult;
      emitProgress(projectId, { step: 'workflow', status: 'done', message: `🎬 工作流完成 (${wfResult.total_agents_involved} agent / ${(wfResult.total_duration_ms/1000).toFixed(0)}s)` });
    } catch (wfErr) {
      console.warn(`[Project ${projectId}] orchestrator workflow failed (non-fatal):`, wfErr.message);
      emitProgress(projectId, { step: 'workflow', status: 'skip', message: '⚠️ 工作流分析跳过' });
    }

    // === 第1步：生成剧情 ===
    updateProjectStatus(projectId, 'generating_story');
    emitProgress(projectId, { step: 'story', status: 'start', message: '正在生成剧情故事...' });
    deductCredits(userId, 'story_gen', '剧情生成', projectId);

    const allStyles = loadStyleTemplates();
    const styleConf = allStyles[project.anim_style] || allStyles.anime || ANIM_STYLE_PROMPTS.anime;
    const dimParams = {
      scene_dim: project.scene_dim || '2d',
      char_dim: project.char_dim || '2d',
      anim_style: styleConf.storyHint
    };

    let story;
    if (project.creation_mode === 'longform' && project.episode_count) {
      // 长篇模式：按集生成剧情
      const episodeLabel = `第${project.episode_index || 1}/${project.episode_count}集`;
      emitProgress(projectId, { step: 'story', status: 'start', message: `正在生成长篇剧情 ${episodeLabel}...` });
      story = await generateLongStory({
        theme: project.theme,
        genre: project.genre,
        duration: project.duration,
        episode_count: project.episode_count,
        episode_index: project.episode_index || 1,
        previous_summary: project.previous_summary || '',
        ...dimParams
      });
    } else if (project.custom_content) {
      const custom = JSON.parse(project.custom_content);
      story = await generateStoryCustom({
        title: project.title,
        genre: project.genre,
        duration: project.duration,
        ...custom,
        ...dimParams
      });
    } else {
      story = await generateStory({ theme: project.theme, genre: project.genre, duration: project.duration, ...dimParams });
    }

    db.insertStory({
      id: uuidv4(),
      project_id: projectId,
      title: story.title,
      synopsis: story.synopsis,
      full_script: story.full_script,
      scenes_json: JSON.stringify(story.scenes)
    });

    emitProgress(projectId, {
      step: 'story', status: 'done', message: '剧情生成完成',
      data: { title: story.title, synopsis: story.synopsis, sceneCount: story.scenes.length, scenes: story.scenes }
    });

    // === 第1.5步：自动生成角色形象图 + 场景背景图 ===
    const { generateCharacterImage, generateSceneImage } = require('./imageService');
    const dim = project.scene_dim || '2d';

    // 构建角色信息（从剧情中提取）
    let storyCharacters = [];
    let customChars = [];
    let customScenesList = [];
    try {
      if (project.custom_content) {
        const custom = typeof project.custom_content === 'string' ? JSON.parse(project.custom_content) : project.custom_content;
        customChars = custom.characters || [];
        customScenesList = custom.custom_scenes || [];
        // 从角色库填充完整信息（如果角色携带 _libraryId）
        for (const c of customChars) {
          if (c._libraryId) {
            const dbChar = db.getAIChar(c._libraryId);
            if (dbChar) {
              if (!c.description && dbChar.appearance_prompt) c.description = dbChar.appearance_prompt;
              if (!c.imageUrl && dbChar.ref_images?.length) c.imageUrl = dbChar.ref_images[0];
            }
          }
        }
        // 从场景库填充（如果场景携带 _libraryId）
        for (const s of customScenesList) {
          if (s._libraryId) {
            const dbScene = db.getAIScene(s._libraryId);
            if (dbScene) {
              if (!s.description && dbScene.scene_prompt) s.description = dbScene.scene_prompt;
              if (!s.imageUrl && dbScene.ref_images?.length) s.imageUrl = dbScene.ref_images[0];
            }
          }
        }
      }
    } catch {}

    // 从 story.scenes 中提取所有角色名
    const allCharNames = new Set();
    story.scenes.forEach(s => (s.characters || []).forEach(name => allCharNames.add(name)));
    // 合并用户自定义角色和剧情角色
    storyCharacters = [...allCharNames].map(name => {
      const userChar = customChars.find(c => c.name === name);
      return {
        name,
        role: userChar?.role || 'main',
        description: userChar?.description || '',
        race: userChar?.race || '人',
        species: userChar?.species || '',
        imageUrl: userChar?.imageUrl || null
      };
    });

    // 自动生成缺失的角色形象图 + 场景背景图（并行，快速完成）
    let charImageLookup = {};
    let allCharImages = [];
    let sceneImageLookup = {};

    // 补充已有形象图
    storyCharacters.filter(c => c.imageUrl).forEach(c => {
      charImageLookup[c.name] = c.imageUrl;
      allCharImages.push(c.imageUrl);
    });
    // 补充已有场景图
    customScenesList.forEach((s, idx) => {
      if (s.imageUrl) {
        sceneImageLookup[idx] = s.imageUrl;
        if (s.title) sceneImageLookup[`title:${s.title}`] = s.imageUrl;
      }
    });

    const charsToGenerate = storyCharacters.filter(c => !c.imageUrl);
    const scenesToGenerate = story.scenes.map((s, idx) => ({ scene: s, idx })).filter(({ idx }) => !sceneImageLookup[idx]);
    const totalImages = charsToGenerate.length + scenesToGenerate.length;

    if (totalImages > 0 && !isCancelled(projectId)) {
      emitProgress(projectId, { step: 'image', status: 'start', message: `正在并行生成 ${charsToGenerate.length} 个角色 + ${scenesToGenerate.length} 个场景图片...` });

      // 所有图片任务并行执行（限制并发 3 个避免 API 限流）
      const allTasks = [];

      // 角色图片任务
      const projAnimStyle = project.anim_style || 'anime';
      for (const c of charsToGenerate) {
        allTasks.push({ type: 'char', name: c.name, fn: () => {
          deductCredits(userId, 'image_gen', `角色: ${c.name}`, projectId);
          return generateCharacterImage({ name: c.name, role: c.role, description: c.description, dim, race: c.race, species: c.species, animStyle: projAnimStyle });
        }});
      }
      // 场景图片任务（用 description 而非 visual_prompt，避免包含人物动作描述）
      for (const { scene, idx } of scenesToGenerate) {
        allTasks.push({ type: 'scene', name: scene.title, idx, fn: () => {
          deductCredits(userId, 'image_gen', `场景: ${scene.title}`, projectId);
          return generateSceneImage({ title: scene.title, description: scene.description || '', theme: scene.setting || '', timeOfDay: scene.time_of_day || '', category: '', dim, animStyle: projAnimStyle });
        }});
      }

      // 并发控制：最多 2 个同时生成（避免 API 限流）
      let completed = 0;
      const concurrency = 2;
      const queue = [...allTasks];
      async function runNext() {
        while (queue.length > 0 && !isCancelled(projectId)) {
          const task = queue.shift();
          try {
            const result = await task.fn();
            const imgUrl = `/api/story/character-image/${result.filename}`;
            if (task.type === 'char') {
              charImageLookup[task.name] = imgUrl;
              allCharImages.push(imgUrl);
            } else {
              sceneImageLookup[task.idx] = imgUrl;
              if (task.name) sceneImageLookup[`title:${task.name}`] = imgUrl;
            }
            completed++;
            emitProgress(projectId, { step: 'image', status: 'generating', message: `图片生成 ${completed}/${totalImages}：${task.name}` });
          } catch (err) {
            completed++;
            console.warn(`[Pipeline] ${task.type}「${task.name}」图片生成失败: ${err.message}`);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, allTasks.length) }, () => runNext()));

      emitProgress(projectId, {
        step: 'image', status: 'done',
        message: `图片生成完成（${Object.keys(charImageLookup).length} 角色 + ${Object.keys(sceneImageLookup).filter(k => !k.startsWith('title:')).length} 场景）`
      });
    }

    // === 第2步：逐场景生成视频 ===
    updateProjectStatus(projectId, 'generating_videos');
    const clipPaths = [];
    const projectOutputDir = path.join(OUTPUT_DIR, 'videos', projectId);
    const totalScenes = story.scenes.length;

    // === 构建角色外貌描述查询表 ===
    let charLookup = {};
    let sceneModelOverrides = {};
    try {
      if (project.custom_content) {
        const custom = typeof project.custom_content === 'string' ? JSON.parse(project.custom_content) : project.custom_content;
        if (custom.characters?.length) {
          for (const c of custom.characters) {
            const parts = [];
            if (c.description) parts.push(c.description);
            if (c.race && c.race !== '人') parts.push(`race: ${c.race}`);
            if (c.species) parts.push(`species: ${c.species}`);
            charLookup[c.name] = parts.join(', ');
          }
        }
        if (custom.custom_scenes?.length) {
          custom.custom_scenes.forEach((s, idx) => {
            if (s.video_provider && s.video_model) {
              sceneModelOverrides[idx] = { video_provider: s.video_provider, video_model: s.video_model };
              if (s.title) sceneModelOverrides[`title:${s.title}`] = { video_provider: s.video_provider, video_model: s.video_model };
            }
          });
        }
      }
    } catch {}
    // 补充从剧情中提取的角色描述
    storyCharacters.forEach(c => {
      if (!charLookup[c.name] && c.description) charLookup[c.name] = c.description;
    });

    // 模糊匹配角色名：AI 生成的名字可能和用户定义的不完全一致
    function fuzzyCharLookup(name, lookup) {
      if (lookup[name]) return lookup[name];
      // 尝试子串匹配：用户定义 "少女（苏姑娘）", AI 可能用 "苏姑娘"
      for (const key of Object.keys(lookup)) {
        if (key.includes(name) || name.includes(key)) return lookup[key];
      }
      // 尝试去括号匹配
      const clean = name.replace(/[（()）]/g, '');
      for (const key of Object.keys(lookup)) {
        const kClean = key.replace(/[（()）]/g, '');
        if (kClean.includes(clean) || clean.includes(kClean)) return lookup[key];
      }
      return null;
    }

    console.log(`[Pipeline] charImageLookup keys: [${Object.keys(charImageLookup).join(', ')}] (${allCharImages.length} images)`);
    console.log(`[Pipeline] sceneImageLookup keys: [${Object.keys(sceneImageLookup).join(', ')}]`);
    console.log(`[Pipeline] charLookup keys: [${Object.keys(charLookup).join(', ')}]`);
    console.log(`[Pipeline] sceneModelOverrides keys: [${Object.keys(sceneModelOverrides).join(', ')}]`);
    console.log(`[Pipeline] video_provider=${project.video_provider}, video_model=${project.video_model}, anim_style=${project.anim_style}`);
    console.log(`[Pipeline] story scenes: ${story.scenes.map((s,i) => `${i}:"${s.title}" chars=[${(s.characters||[]).join(',')}]`).join(' | ')}`);

    for (let i = 0; i < totalScenes; i++) {
      // 检查是否被取消
      if (isCancelled(projectId)) {
        console.log(`[Pipeline] 项目 ${projectId} 已被取消，停止生成`);
        updateProjectStatus(projectId, 'cancelled');
        cancelledProjects.delete(projectId);
        return;
      }

      const scene = story.scenes[i];
      const clipId = uuidv4();

      // === 增强 visual_prompt：注入风格前缀 + 角色外貌 + 动作增强 ===
      let enhancedPrompt = scene.visual_prompt || '';

      // 注入出场角色外貌描述（模糊匹配）+ 一致性约束
      if (scene.characters?.length && Object.keys(charLookup).length) {
        const charDescs = scene.characters
          .map(name => {
            const desc = fuzzyCharLookup(name, charLookup);
            return desc ? `[Character "${name}": ${desc}]` : '';
          })
          .filter(Boolean).join(' ');
        if (charDescs) {
          enhancedPrompt = charDescs + ' ' + enhancedPrompt;
          // 角色一致性强化约束
          enhancedPrompt += ', maintain exact character appearance consistency, same face same hair same outfit as reference image, consistent character design across all shots';
        }
      }

      // 注入动画风格 prompt 前缀 + 2D/3D 维度强制约束
      if (styleConf.prefix) {
        enhancedPrompt = styleConf.prefix + ' ' + enhancedPrompt;
      }
      // 强制维度约束：确保 2D 不会渲染成 3D，3D 不会渲染成 2D
      const pDim = project.scene_dim || '2d';
      if (pDim === '2d') {
        enhancedPrompt += ', 2D animation, flat illustration, hand-drawn style, NO 3D rendering, NO photorealistic';
      } else {
        enhancedPrompt += ', 3D rendered, volumetric lighting, realistic textures, depth of field, NOT flat 2D, NOT hand-drawn';
      }
      if (styleConf.negative) {
        enhancedPrompt += `, avoid: ${styleConf.negative}`;
      }

      // ═══ 镜头运动 + 景别注入 ═══
      const CAMERA_MOVE_PROMPTS = {
        static:       'static camera, locked-off shot, no camera movement',
        push_in:      'camera slowly pushing in, dolly forward, gradually closing in on subject',
        pull_out:     'camera pulling out, dolly backward, revealing wider scene',
        pan_left:     'camera panning left, smooth horizontal movement left',
        pan_right:    'camera panning right, smooth horizontal movement right',
        tilt_up:      'camera tilting up, vertical upward movement revealing sky/ceiling',
        tilt_down:    'camera tilting down, vertical downward movement',
        tracking:     'tracking shot following subject, camera moving alongside character, dynamic follow',
        dolly_zoom:   'dolly zoom effect, vertigo effect, background stretching while subject stays same size',
        orbit:        'orbiting camera, 360 degree rotation around subject, circular tracking shot',
        crane_up:     'crane shot rising upward, ascending aerial reveal, sweeping upward movement',
        crane_down:   'crane shot descending, camera lowering from above, descending reveal',
        handheld:     'handheld camera, slight shake and wobble, documentary realism, organic movement',
        first_person: 'first person POV, subjective camera, seeing through character eyes',
        over_shoulder:'over-the-shoulder shot, character in foreground frame edge, depth perspective',
        aerial:       'aerial drone shot, bird eye view, sweeping overhead, establishing shot from above',
        whip_pan:     'whip pan, rapid camera swish, fast horizontal blur transition',
        slow_zoom:    'very slow subtle zoom in, barely perceptible push, building tension',
        bullet_time:  'bullet time effect, frozen moment with orbiting camera, time-slice photography'
      };
      const SHOT_TYPE_PROMPTS = {
        extreme_wide: 'extreme wide shot, vast landscape, tiny figures in grand environment',
        wide:         'wide shot, full environment visible, characters in context',
        full:         'full shot, character from head to toe, complete body visible',
        medium:       'medium shot, character from waist up, conversational framing',
        medium_close: 'medium close-up, chest and face, intimate but contextual',
        close_up:     'close-up shot, face filling frame, emotional detail, facial expression focus',
        extreme_close:'extreme close-up, detail shot, eyes or specific object detail',
        low_angle:    'low angle shot, camera below subject looking up, powerful imposing perspective',
        high_angle:   'high angle shot, camera above subject looking down, vulnerable diminished perspective',
        birds_eye:    'bird\'s eye view, directly overhead, top-down perspective',
        dutch_angle:  'dutch angle, tilted camera, diagonal horizon, unease tension'
      };

      const cameraMove = scene.camera_move || '';
      const shotType = scene.shot_type || '';
      if (cameraMove && CAMERA_MOVE_PROMPTS[cameraMove]) {
        enhancedPrompt += ', ' + CAMERA_MOVE_PROMPTS[cameraMove];
      }
      if (shotType && SHOT_TYPE_PROMPTS[shotType]) {
        enhancedPrompt += ', ' + SHOT_TYPE_PROMPTS[shotType];
      }
      // AI 生成的 camera 字段也注入（如果用户没手动选择）
      if (!cameraMove && scene.camera) {
        enhancedPrompt += `, camera: ${scene.camera}`;
      }

      // 动作/打斗场景视频 prompt 增强：基于 action_type + vfx 标签精准增强
      const actionType = scene.action_type || 'normal';
      const vfxTags = Array.isArray(scene.vfx) ? scene.vfx : [];

      // action_type → 专用 prompt 增强映射
      const ACTION_PROMPT_MAP = {
        combat:    'dynamic close-quarters combat, motion blur on strikes, impact flash, sparks on weapon clash, speed lines, dramatic camera tracking, intense physical action',
        ranged:    'ranged combat, projectile trails, energy beams, muzzle flash, bullet trails with particle effects, dramatic zoom, explosion impacts',
        chase:     'high-speed chase, dynamic tracking shot, motion blur, dust trail, wind effects, rapid camera movement, adrenaline intensity',
        explosion: 'massive explosion, shockwave expanding outward, debris flying, fire and smoke billowing, ground cracking, screen shake intensity, dramatic wide shot',
        power:     'energy power-up, aura glow emanating from character, lightning crackling, particle vortex, ground trembling, slow-motion buildup to burst, dramatic backlight',
        stealth:   'stealth action, shadows and silhouettes, subtle motion blur, sudden strike flash, contrast between dark calm and violent burst',
        aerial:    'aerial combat, high-altitude action, wind rushing, clouds parting, dynamic vertical camera, freefall momentum, bird-eye tracking shot'
      };

      // vfx 标签 → prompt 片段映射
      const VFX_PROMPT_MAP = {
        shockwave: 'visible shockwave ring expanding from impact',
        sparks: 'shower of bright sparks scattering',
        debris: 'fragments and debris flying through air',
        energy_burst: 'burst of concentrated energy radiating outward',
        speed_lines: 'dynamic speed lines emphasizing rapid movement',
        impact_flash: 'bright white flash at point of impact',
        dust_cloud: 'cloud of dust and debris billowing up',
        fire: 'flames and fire spreading dramatically',
        lightning: 'crackling lightning bolts and electrical arcs',
        water_splash: 'dramatic water splash and spray',
        screen_shake: 'intense screen shake conveying impact force',
        slow_motion: 'slow-motion cinematic moment capturing detail',
        afterimage: 'ghostly afterimage trail showing movement path',
        particle_trail: 'glowing particle trail following movement',
        aura_glow: 'luminous aura glow surrounding character',
        ground_crack: 'ground cracking and splitting from impact force',
        explosion_ring: 'circular explosion ring with debris wave',
        lens_flare: 'cinematic lens flare from bright energy source',
        motion_blur: 'heavy motion blur on rapid movement',
        // 中国国风专用 VFX
        sword_qi: 'luminous sword qi energy slash arc, visible blade energy trail cutting through air',
        qi_flow: 'visible qi energy flowing through body meridians, glowing internal energy channels',
        ink_splash: 'ink wash splash effect on impact, black ink splattering like traditional Chinese painting',
        celestial_light: 'celestial golden-white light descending from heavens, divine radiance and heavenly glow'
      };

      if (actionType !== 'normal' && ACTION_PROMPT_MAP[actionType]) {
        enhancedPrompt += ', ' + ACTION_PROMPT_MAP[actionType];
      } else {
        // 回退到关键词检测（兼容旧数据）
        const sceneText = (scene.action || '') + ' ' + (scene.title || '') + ' ' + enhancedPrompt;
        const isActionScene = /fight|combat|battle|strike|slash|kick|punch|sword|explosion|attack|dodge|block|打斗|战斗|交锋|出拳|挥剑|爆炸|冲击|格挡|闪避|追击/i.test(sceneText);
        if (isActionScene) {
          enhancedPrompt += ', dynamic action, motion blur, speed lines, impact effects, dramatic camera movement, intense energy';
        }
      }

      // 注入 vfx 特效标签到 prompt
      if (vfxTags.length) {
        const vfxPrompts = vfxTags
          .map(tag => VFX_PROMPT_MAP[tag])
          .filter(Boolean);
        if (vfxPrompts.length) {
          enhancedPrompt += ', [VFX: ' + vfxPrompts.join(', ') + ']';
        }
      }

      // 注入动作资源增强 prompt（基于 FBX 动作目录匹配）
      const sceneText = (scene.action || '') + ' ' + (scene.title || '') + ' ' + enhancedPrompt;
      const motionRef = buildMotionPrompt(sceneText, actionType, project.anim_style || '');
      if (motionRef) {
        enhancedPrompt += ', ' + motionRef;
      }

      db.insertClip({
        id: clipId,
        project_id: projectId,
        scene_index: i,
        scene_description: scene.title,
        prompt: enhancedPrompt,
        status: 'generating'
      });

      emitProgress(projectId, {
        step: 'video', status: 'generating',
        message: `正在生成第 ${i + 1}/${totalScenes} 个场景：${scene.title}`,
        data: { sceneIndex: i, sceneTitle: scene.title, clipId, total: totalScenes }
      });

      try {
        // 生成视频，限流错误时最多重试 2 次（间隔 15s），仍失败则直接报错终止
        let result;
        // 尝试找到场景参考图（改进匹配逻辑）：
        // 1. 精确 index 匹配
        // 2. 按场景标题模糊匹配用户自定义场景
        // 3. 出场角色形象图（模糊匹配）
        // 4. 任意场景图/角色图兜底
        let sceneImage = sceneImageLookup[i] || null;

        // 标题模糊匹配：AI 生成的场景标题 vs 用户定义的场景标题
        if (!sceneImage && scene.title) {
          for (const key of Object.keys(sceneImageLookup)) {
            if (!key.startsWith('title:')) continue;
            const userTitle = key.substring(6);
            const aiTitle = scene.title;
            // 子串匹配或关键词重叠
            if (userTitle.includes(aiTitle) || aiTitle.includes(userTitle)) {
              sceneImage = sceneImageLookup[key];
              console.log(`[Pipeline] 场景 ${i} 标题匹配: AI="${aiTitle}" ↔ 用户="${userTitle}"`);
              break;
            }
            // 至少2个共同汉字关键词
            const aiChars = aiTitle.replace(/[^\u4e00-\u9fff]/g, '');
            const userChars = userTitle.replace(/[^\u4e00-\u9fff]/g, '');
            let overlap = 0;
            for (const ch of aiChars) { if (userChars.includes(ch)) overlap++; }
            if (overlap >= 2) {
              sceneImage = sceneImageLookup[key];
              console.log(`[Pipeline] 场景 ${i} 关键词匹配 (${overlap}字): AI="${aiTitle}" ↔ 用户="${userTitle}"`);
              break;
            }
          }
        }

        // 角色形象图匹配 — 优先使用主角的形象图（保持角色一致性，这是 I2V 的核心技巧）
        if (!sceneImage && scene.characters?.length) {
          // 优先找主角（main role）的形象图
          if (project.custom_content) {
            try {
              const custom = typeof project.custom_content === 'string' ? JSON.parse(project.custom_content) : project.custom_content;
              const mainChars = (custom.characters || []).filter(c => c.role === 'main' && c.imageUrl);
              if (mainChars.length) {
                // 主角形象图优先：即使场景中未列出主角，也使用主角图保持一致性
                sceneImage = mainChars[0].imageUrl;
                console.log(`[Pipeline] 场景 ${i} 使用主角形象图保持一致性: ${mainChars[0].name}`);
              }
            } catch {}
          }
          // 再尝试按出场角色匹配
          if (!sceneImage) {
            for (const cName of scene.characters) {
              const img = fuzzyCharLookup(cName, charImageLookup);
              if (img) { sceneImage = img; break; }
            }
          }
        }
        // 兜底：强制使用任何可用的角色形象图（保证每个场景都有参考图做 I2V）
        if (!sceneImage && allCharImages.length) {
          // 所有场景都使用同一个主角图，确保角色造型一致
          sceneImage = allCharImages[0];
          console.log(`[Pipeline] 场景 ${i} 兜底使用角色图保持一致性`);
        }
        if (!sceneImage) {
          const sceneImgVals = Object.entries(sceneImageLookup).filter(([k]) => !k.startsWith('title:')).map(([,v]) => v);
          if (sceneImgVals.length) {
            sceneImage = sceneImgVals[i % sceneImgVals.length];
          }
        }
        console.log(`[Pipeline] 场景 ${i} "${scene.title}" → 参考图: ${sceneImage ? sceneImage.substring(0, 80) : '无'}`);
        // 解析参考图：优先获取公网 URL（供云端 API 使用），base64 作为备选
        let imageUrlForVideo = null;
        let imageBase64ForVideo = null;
        if (sceneImage) {
          const imgRef = resolveImageRef(sceneImage);
          imageBase64ForVideo = imgRef.base64 || null;
          imageUrlForVideo = imgRef.publicUrl || null;

          // 如果只有 base64 没有公网 URL，尝试上传到图床获取公网 URL
          if (imageBase64ForVideo && !imageUrlForVideo) {
            try {
              emitProgress(projectId, { step: 'video', status: 'info', message: `场景 ${i + 1} 正在上传参考图到图床...` });
              imageUrlForVideo = await uploadImageToTempHost(imageBase64ForVideo, sceneImage);
            } catch (uploadErr) {
              console.warn(`[Pipeline] 场景 ${i} 参考图上传失败: ${uploadErr.message}`);
              emitProgress(projectId, { step: 'video', status: 'warn', message: `场景 ${i + 1} 参考图上传图床失败，将使用 base64 模式（部分模型可能不支持）` });
            }
          }

          if (imageUrlForVideo) {
            console.log(`[Pipeline] 场景 ${i} 参考图公网 URL: ${imageUrlForVideo.substring(0, 80)}`);
          } else if (imageBase64ForVideo) {
            console.log(`[Pipeline] 场景 ${i} 参考图仅有 base64 (${Math.round(imageBase64ForVideo.length/1024)}KB)`);
          }
        }

        // 智谱 CogVideoX 优先用 base64（公网图床 URL 容易被拒绝返回 1210），其他 provider 优先公网 URL
        const isZhipuProvider = (project.video_provider === 'zhipu') && !(sceneModelOverrides[i]?.video_provider);
        let effectiveImageUrl = isZhipuProvider
          ? (imageBase64ForVideo || imageUrlForVideo || null)
          : (imageUrlForVideo || imageBase64ForVideo || null);
        // Override with user-specified first frame if available
        const userSceneData = customScenesList[i];
        if (userSceneData?.firstFrameUrl) {
          const ffRef = resolveImageRef(userSceneData.firstFrameUrl);
          const ffUrl = ffRef.publicUrl || ffRef.base64 || null;
          if (ffUrl) {
            effectiveImageUrl = ffUrl;
            emitProgress(projectId, { step: 'video', status: 'info', message: `场景 ${i + 1}: 使用用户指定首帧图` });
          }
        }
        // 查找场景级模型覆盖（优先按 index，其次按 title 匹配）
        const sceneOverride = sceneModelOverrides[i] || (scene.title && sceneModelOverrides[`title:${scene.title}`]) || null;
        const effectiveProvider = sceneOverride?.video_provider || project.video_provider || null;
        const effectiveModel = sceneOverride?.video_model || project.video_model || null;
        if (sceneOverride) {
          emitProgress(projectId, { step: 'video', status: 'info', message: `场景 ${i + 1} 使用独立模型: ${effectiveProvider}/${effectiveModel}` });
        }
        // Kling V3 支持最长 120 秒，其他模型限制更短
        const isKlingV3 = effectiveModel === 'kling-v3';
        const maxDuration = isKlingV3 ? 120 : 20;
        // 有参考图时，prompt 中强调必须严格参照参考图
        let finalPrompt = enhancedPrompt;
        if (effectiveImageUrl) {
          finalPrompt = `Strictly follow the reference image. Keep the exact same character appearance, costume, and scene environment as shown in the reference image. ${enhancedPrompt}`;
        }
        const clipOptions = {
          prompt: finalPrompt,
          negative_prompt: styleConf.negative || '',
          duration: Math.min(scene.duration || 10, maxDuration),
          outputDir: projectOutputDir,
          filename: `scene_${String(i).padStart(3, '0')}`,
          sceneTitle: scene.title,
          sceneIndex: i,
          video_provider: effectiveProvider,
          video_model: effectiveModel,
          image_url: effectiveImageUrl,
          last_frame_url: userSceneData?.lastFrameUrl || null,
          aspectRatio: project.aspect_ratio || '16:9'
        };
        if (effectiveImageUrl) {
          const mode = imageUrlForVideo ? 'URL' : 'base64';
          emitProgress(projectId, { step: 'video', status: 'info', message: `场景 ${i + 1} 使用参考图生成视频 (i2v, ${mode})` });
        }
        // 认证/Key 错误不重试，直接失败
        const isAuthError = (msg) => /access.?denied|unauthorized|forbidden|invalid.?key|api.?key|认证|50400|401|403/i.test(msg || '');
        const isRetryable = (msg) => !isAuthError(msg) && /访问量过大|rate.?limit|too.?many|capacity|quota|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket.?disconnect|TLS|network|EAI_AGAIN|EPIPE|ECONNREFUSED|fetch.?failed|abort|参数有误|1210/i.test(msg || '');
        // 视频片段积分扣减
        deductCredits(userId, 'video_gen', `场景${i+1}: ${scene.title || ''}`, projectId, clipOptions.model || '');
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            result = await generateVideoClip(clipOptions);
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            if (isRetryable(e.message) && attempt < 2) {
              if (isCancelled(projectId)) break;
              const wait = 15; // 固定15秒，3次共45秒
              emitProgress(projectId, { step: 'video', status: 'retry', message: `场景 ${i + 1} 第${attempt + 1}次失败: ${e.message.substring(0, 50)}，${wait}s 后重试...` });
              await new Promise(r => setTimeout(r, wait * 1000));
            } else {
              break;
            }
          }
        }
        if (!result) {
          const reason = lastErr?.message || '未知错误';
          emitProgress(projectId, { step: 'video', status: 'error', message: `场景 ${i + 1} 生成失败（3次重试均失败）: ${reason.substring(0, 100)}` });
          throw new Error(`场景 ${i + 1}「${scene.title || ''}」视频生成失败: ${reason}`);
        }

        const duration = await getVideoDuration(result.filePath).catch(() => scene.duration || 10);

        // 语音配音：如果启用且场景有对白，生成 TTS 并混入视频
        if (project.voice_enabled && scene.dialogue && scene.dialogue.trim()) {
          try {
            emitProgress(projectId, { step: 'video', status: 'voice', message: `场景 ${i + 1} 生成语音配音...` });
            const voiceDir = path.join(OUTPUT_DIR, 'voice', projectId);
            const voiceBase = path.join(voiceDir, `scene_${String(i).padStart(3, '0')}`);
            const audioFile = await generateSpeech(scene.dialogue, voiceBase, {
              gender: project.voice_gender || 'female',
              speed: project.voice_speed || 1.0,
              voiceId: project.voice_id || null
            });
            if (audioFile && fs.existsSync(audioFile)) {
              const withVoicePath = result.filePath.replace('.mp4', '_v.mp4');
              await mixVoiceIntoClip(result.filePath, audioFile, withVoicePath);
              fs.unlinkSync(result.filePath);
              fs.renameSync(withVoicePath, result.filePath);
              try { fs.unlinkSync(audioFile); } catch {}
            } else {
              console.warn(`[TTS] 场景 ${i + 1} 语音生成返回空（无可用 TTS 供应商或文本为空）`);
              emitProgress(projectId, { step: 'video', status: 'voice_warn', message: `场景 ${i + 1} 无法生成语音，请检查 TTS 配置` });
            }
          } catch (voiceErr) {
            console.warn(`[TTS] 场景 ${i + 1} 配音失败（跳过）:`, voiceErr.message);
            emitProgress(projectId, { step: 'video', status: 'voice_warn', message: `场景 ${i + 1} 配音失败: ${voiceErr.message}` });
          }
        }

        // 动作场景后处理特效（基于 action_type + vfx 标签）
        let finalClipPath = result.filePath;
        if (actionType !== 'normal' && vfxTags.length > 0) {
          try {
            const vfxOutputPath = result.filePath.replace(/\.mp4$/, '_vfx.mp4');
            await applyPostVFX({ inputPath: result.filePath, outputPath: vfxOutputPath, vfxTags, actionType });
            if (fs.existsSync(vfxOutputPath) && fs.statSync(vfxOutputPath).size > 1000) {
              fs.unlinkSync(result.filePath);
              fs.renameSync(vfxOutputPath, result.filePath);
              console.log(`[PostVFX] 场景 ${i + 1} 特效增强完成 (${actionType}, ${vfxTags.join(',')})`);
            }
          } catch (vfxErr) {
            console.warn(`[PostVFX] 场景 ${i + 1} 特效处理失败（使用原始片段）:`, vfxErr.message);
          }
        }

        // 字幕烧录：将场景文本（对白或动作描述）烧录为字幕
        const subtitleText = (scene.dialogue && scene.dialogue.trim()) || '';
        if (subtitleText && project.subtitle_enabled !== false) {
          try {
            emitProgress(projectId, { step: 'video', status: 'subtitle', message: `场景 ${i + 1} 烧录字幕...` });
            const subOutputPath = result.filePath.replace(/\.mp4$/, '_sub.mp4');
            await burnSubtitle(result.filePath, subOutputPath, subtitleText, {
              fontSize: project.subtitle_size || 32,
              color: project.subtitle_color || 'white',
              position: project.subtitle_position || 'bottom'
            });
            if (fs.existsSync(subOutputPath) && fs.statSync(subOutputPath).size > 1000) {
              fs.unlinkSync(result.filePath);
              fs.renameSync(subOutputPath, result.filePath);
              console.log(`[Subtitle] 场景 ${i + 1} 字幕烧录完成: "${subtitleText.slice(0, 30)}..."`);
            }
          } catch (subErr) {
            console.warn(`[Subtitle] 场景 ${i + 1} 字幕烧录失败（跳过）:`, subErr.message);
          }
        }

        db.updateClip(clipId, { status: 'done', file_path: result.filePath, duration });
        clipPaths.push(result.filePath);

        emitProgress(projectId, {
          step: 'video', status: 'scene_done',
          message: `场景 ${i + 1} 完成：${scene.title}`,
          data: { sceneIndex: i, sceneTitle: scene.title, clipId, duration, total: totalScenes, completed: clipPaths.length }
        });
      } catch (err) {
        db.updateClip(clipId, { status: 'error', error_message: err.message });
        emitProgress(projectId, {
          step: 'video', status: 'scene_error',
          message: `场景 ${i + 1} 生成失败：${err.message}`,
          data: { sceneIndex: i, clipId }
        });
      }
    }

    if (clipPaths.length === 0) throw new Error('所有场景视频生成失败，无法合成');

    // === 第3步：合成 + 叠加音乐 ===
    updateProjectStatus(projectId, 'merging');
    emitProgress(projectId, { step: 'merge', status: 'start', message: '正在合成视频片段...' });

    const finalOutputDir = path.join(OUTPUT_DIR, 'projects');
    fs.mkdirSync(finalOutputDir, { recursive: true });

    let finalPath = path.join(finalOutputDir, `${projectId}_final.mp4`);
    await mergeVideoClips({ clipPaths, outputPath: finalPath });

    // 叠加音乐
    if (project.music_path && fs.existsSync(project.music_path)) {
      emitProgress(projectId, { step: 'merge', status: 'music', message: '正在叠加背景音乐...' });
      const withMusicPath = path.join(finalOutputDir, `${projectId}_final_music.mp4`);
      await mixMusicIntoVideo(finalPath, project.music_path, withMusicPath, project.music_volume ?? 0.5, project.music_loop !== false, project.music_trim_start, project.music_trim_end);
      fs.unlinkSync(finalPath);
      fs.renameSync(withMusicPath, finalPath);
    }

    const totalDuration = await getVideoDuration(finalPath).catch(() => null);
    db.insertFinalVideo({ id: uuidv4(), project_id: projectId, file_path: finalPath, duration: totalDuration, status: 'done' });

    updateProjectStatus(projectId, 'done');
    emitProgress(projectId, {
      step: 'final', status: 'done', message: '视频制作完成！',
      data: { filePath: finalPath, duration: totalDuration, downloadUrl: `/api/projects/${projectId}/download`, hasMusic: !!(project.music_path), hasVoice: !!project.voice_enabled }
    });

    return { finalPath, duration: totalDuration };

  } catch (err) {
    db.updateProject(projectId, { status: 'error', last_error: err.message });
    emitProgress(projectId, { step: 'error', status: 'error', message: err.message });
    throw err;
  }
}

function getProjectDetails(projectId) {
  const project = getProject(projectId);
  if (!project) return null;
  const story = db.getStoryByProject(projectId);
  const clips = db.getClipsByProject(projectId);
  const finalVideo = db.getFinalVideoByProject(projectId);
  return {
    ...project,
    story: story ? { ...story, scenes: story.scenes_json ? JSON.parse(story.scenes_json) : [] } : null,
    clips,
    finalVideo
  };
}

module.exports = { createProject, getProject, listProjects, runFullPipeline, getProjectDetails, addProgressListener, removeProgressListener, cancelPipeline, ANIM_STYLE_PROMPTS };
