require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const ffmpegStatic = require('ffmpeg-static');
const { exec } = require('child_process');
const { getApiKey } = require('./settingsService');

const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
  ? process.env.FFMPEG_PATH
  : ffmpegStatic;

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const CHAR_IMG_DIR = path.join(OUTPUT_DIR, 'characters');
const SCENE_IMG_DIR = path.join(OUTPUT_DIR, 'scenes');

function ensureDir() {
  fs.mkdirSync(CHAR_IMG_DIR, { recursive: true });
  fs.mkdirSync(SCENE_IMG_DIR, { recursive: true });
}

// 根据文件名前缀决定输出目录：scene_ 开头 → scenes/，其他 → characters/
function imgDir(filename) {
  return filename.startsWith('scene_') ? SCENE_IMG_DIR : CHAR_IMG_DIR;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, { headers: { 'User-Agent': 'VIDO/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        file.close();
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
    }).on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

const STYLE_PROMPTS = {
  celulose:  'in the style of Japanese anime, cel-shaded coloring, flat vibrant colors, bold clean linework, large expressive eyes, anime aesthetic, manga illustration, soft pastel tones',
  urban:     'in Korean manhwa webtoon art style, modern sleek digital illustration, clean precise linework, manhwa character proportions, urban fashion, cool color palette',
  '3dcg':    'in Chinese 3D donghua style, high quality 3D CGI render, cinematic dramatic lighting, Unreal Engine quality, octane render, volumetric lighting, detailed textures',
  shadow:    'in traditional Chinese shadow puppet art style (皮影戏), amber and warm gold tones, silhouette paper-cut design, traditional folk art aesthetic, ornate patterns',
  cyberpunk: 'in cyberpunk sci-fi style, neon purple and cyan lights, dark futuristic environment, holographic effects, volumetric fog, high contrast, Blade Runner aesthetic',
  pixel:     'in pixel art style, 16-bit retro game sprite, limited color palette, crisp sharp pixels, nostalgic 8-bit aesthetic, Game Boy color style',
  chinese:   'in traditional Chinese ink wash painting style (水墨画), flowing brush strokes, rice paper texture, red seal stamp, misty mountains, classical Chinese aesthetics, 国风',
  ghibli:    'in Studio Ghibli anime style, soft watercolor painting, warm pastoral tones, hand-painted textures, whimsical and dreamlike, Hayao Miyazaki aesthetic, gentle atmosphere',
  western:   'in Pixar/DreamWorks 3D animation style, high-quality CGI render, expressive cartoon proportions, warm cinematic lighting, subsurface scattering skin',
  shonen:    'in shonen manga battle style, dynamic action lines, intense expressions, dramatic speed lines, impact frames, bold ink strokes, Japanese battle manga aesthetic',
  wuxia:     'in Chinese wuxia martial arts style (武侠), flowing robes and silk, ancient Chinese architecture, bamboo forests, moonlit night, dramatic kung fu poses, 仙侠古风',
  darkfanta: 'in dark fantasy epic style, grim atmosphere, dramatic chiaroscuro lighting, medieval armor and creatures, dark color palette with fire accents, Lord of the Rings aesthetic',
  mecha:     'in mecha anime style, detailed mechanical robot design, chrome and neon accents, cockpit details, Gundam-inspired proportions, sci-fi military aesthetic, energy weapons',
};

// 2D/3D 维度附加提示词
const DIM_SUFFIX = {
  '2d': 'flat 2D illustration, anime style, clean linework, cell shading',
  '3d': 'photorealistic 3D render, subsurface scattering, cinematic lighting, octane render, 8K',
};

// 即梦AI 专用中文风格提示词（中文模型用中文 prompt 效果更好）
const STYLE_PROMPTS_CN = {
  celulose:  '日系动漫风格，赛璐璐上色，鲜艳平涂色彩，干净线条，大眼睛，动漫插画',
  urban:     '韩国漫画风格，现代都市插画，精致干净线条，时尚造型，冷色调',
  '3dcg':    '3D CG渲染风格，电影级光影，高质量三维建模，体积光，精细纹理',
  shadow:    '中国皮影戏风格，琥珀色暖金色调，剪影纸雕设计，传统民间艺术，华丽纹饰',
  cyberpunk: '赛博朋克科幻风格，紫色青色霓虹灯光，暗色未来感环境，全息效果，高对比度',
  pixel:     '像素画风格，16位复古游戏精灵图，有限色板，清晰锐利的像素',
  chinese:   '中国传统水墨画风格，流畅笔触，宣纸质感，古典意境，国风',
  ghibli:    '吉卜力动画风格，柔和水彩画风，温暖田园色调，手绘质感，梦幻温馨氛围',
  western:   '皮克斯/梦工厂3D动画风格，高质量CG渲染，夸张卡通比例，温暖电影光影',
  shonen:    '少年漫画战斗风格，动感线条，激烈表情，速度线，浓墨线条',
  wuxia:     '中国武侠风格，飘逸衣袍，古代建筑，竹林，月夜，仙侠古风',
  darkfanta: '暗黑奇幻史诗风格，阴暗氛围，明暗对比光影，中世纪铠甲，暗色调配火焰色',
  mecha:     '机甲动漫风格，精细机械设计，铬合金与霓虹色，科幻军事美学',
};

const DIM_SUFFIX_CN = {
  '2d': '2D平面插画，动漫风格，干净线条',
  '3d': '写实3D渲染，电影级光影，超高清8K',
};

const ANIMAL_RACES = ['动物','宠物','神兽','怪兽'];

// 即梦AI 专用 prompt — 多角度角色转面图
function buildJimengPrompt(name, role, description, dim = '2d', race = '人', species = '', animStyle = '') {
  const isAnimal = ANIMAL_RACES.includes(race);
  const styleKey = animStyle && STYLE_PROMPTS_CN[animStyle] ? animStyle : 'celulose';
  const styleCN = STYLE_PROMPTS_CN[styleKey];
  const dimCN = DIM_SUFFIX_CN[dim] || DIM_SUFFIX_CN['2d'];

  if (isAnimal) {
    const creatureType = species || race;
    const parts = [`角色设定图，多角度参考，${creatureType}，${name}`];
    if (description) parts.push(description.replace(/\n/g, ' ').substring(0, 200));
    parts.push(styleCN);
    parts.push(dimCN);
    parts.push('角色转面图，正面侧面背面三视图排列，完整身体，从头到尾，白色干净背景，高质量，精细设定');
    return parts.join('，');
  }

  const roleMap = { main: '主角', supporting: '配角', villain: '反派', mentor: '导师', other: '角色' };
  const roleLabel = roleMap[role] || '角色';
  const parts = [`角色设定图，多角度转面图，${name}，${roleLabel}`];
  if (description) parts.push(description.replace(/\n/g, ' ').substring(0, 250));
  parts.push(styleCN);
  parts.push(dimCN);
  parts.push('角色360度多视角参考图，正面视图、3/4侧面视图、背面视图，同一角色三个角度并排排列，全身站立姿势，统一比例，精细面部和服装细节，纯白干净背景，专业角色设定参考');
  return parts.join('，');
}

// 英文 prompt — 多角度角色转面图 (character turnaround sheet)
function buildPrompt(name, role, description, dim = '2d', race = '人', species = '', animStyle = '') {
  const styleKey = animStyle && STYLE_PROMPTS[animStyle] ? animStyle : (dim === '3d' ? '3dcg' : 'celulose');
  const isAnimal = ANIMAL_RACES.includes(race);
  if (isAnimal) {
    const creatureType = species || race;
    const parts = [`character turnaround reference sheet of ${name}, ${creatureType}`];
    if (description) parts.push(description.replace(/\n/g, ' ').substring(0, 180));
    parts.push(STYLE_PROMPTS[styleKey]);
    if (dim && DIM_SUFFIX[dim]) parts.push(DIM_SUFFIX[dim]);
    parts.push('360 degree multi-angle character model sheet, front view, 3/4 side view, back view, three poses of same creature side by side, full body from head to tail, consistent proportions, clean white background, professional concept art');
    return parts.join(', ');
  }
  const roleMap = { main: 'protagonist', supporting: 'supporting character', villain: 'villain', mentor: 'mentor', other: 'character' };
  const roleLabel = roleMap[role] || 'character';
  const parts = [`character turnaround reference sheet of ${name}, ${roleLabel}`];
  if (description) parts.push(description.replace(/\n/g, ' ').substring(0, 250));
  parts.push(STYLE_PROMPTS[styleKey]);
  if (dim && DIM_SUFFIX[dim]) parts.push(DIM_SUFFIX[dim]);
  parts.push('360 degree multi-angle character model sheet, front view, 3/4 side view, back view, three poses of the same character arranged side by side, full body standing pose from head to feet, consistent proportions and design, detailed face and clothing, clean white background, professional character design reference');
  return parts.join(', ');
}

// 单张人物肖像 prompt（用于工作流分镜，非转面图）
function buildPortraitPrompt(name, role, description, dim = '2d', race = '人', species = '', animStyle = '') {
  const styleKey = animStyle && STYLE_PROMPTS[animStyle] ? animStyle : (dim === '3d' ? '3dcg' : 'celulose');
  const isAnimal = ANIMAL_RACES.includes(race);
  if (isAnimal) {
    const creatureType = species || race;
    const parts = [`single portrait of ${name}, ${creatureType}`];
    if (description) parts.push(description.replace(/\n/g, ' ').substring(0, 200));
    parts.push(STYLE_PROMPTS[styleKey]);
    if (dim && DIM_SUFFIX[dim]) parts.push(DIM_SUFFIX[dim]);
    parts.push('single character portrait, front 3/4 view, full body, detailed, expressive, cinematic lighting, high quality illustration');
    return parts.join(', ');
  }
  const roleMap = { main: 'protagonist', supporting: 'supporting', villain: 'villain', mentor: 'mentor', other: 'character' };
  const roleLabel = roleMap[role] || 'character';
  const parts = [`single character portrait of ${name}, ${roleLabel}`];
  if (description) parts.push(description.replace(/\n/g, ' ').substring(0, 250));
  parts.push(STYLE_PROMPTS[styleKey]);
  if (dim && DIM_SUFFIX[dim]) parts.push(DIM_SUFFIX[dim]);
  parts.push('single character portrait, front 3/4 view, full body from head to feet, expressive face, detailed clothing, cinematic lighting, beautiful composition, high quality character illustration, clean simple background');
  return parts.join(', ');
}

// 从描述中提取纯环境信息，彻底去除所有人物/角色/动作内容
function stripCharacterContent(desc) {
  if (!desc) return '';
  // 1. 优先提取方括号中的环境标签
  const envTags = desc.match(/\[(?:地理环境|地点|光影|细节|场景|环境|背景|天气|氛围|地形|建筑|植被)[^\]]*\][^[]*(?=\[|$)/g);
  if (envTags && envTags.length > 0) {
    return envTags.map(t => t.replace(/\[.*?\]\s*/, '').trim()).filter(Boolean).join('，');
  }
  // 2. 提取【地点】标记后的内容
  const locMatch = desc.match(/【地点】\s*([^【\n]+)/);
  const envParts = [];
  if (locMatch) envParts.push(locMatch[1].trim());
  // 3. 按句拆分，只保留环境/地点类句子
  const sentences = desc.split(/[，。！？；\n]+/).filter(Boolean);
  const envKeywords = /山|水|河|海|湖|林|森|天|云|雾|雨|雪|风|沙|石|岩|洞|城|宫|殿|楼|塔|庙|寺|村|镇|街|道|路|桥|门|墙|屋|房|院|园|花|草|树|竹|瀑|泉|池|谷|崖|峰|岭|地|原|漠|冰|火|光|影|暗|明|阳|月|星|空|夜|晨|晚|黄昏|日落|日出|建筑|地面|天花板|窗|景色|景观|环境|场地|空间|氛围/;
  const charKeywords = /他|她|它们|人|角色|主角|少年|少女|男|女|老|孩|穿|戴|持|拿|握|挥|走|跑|站|坐|飞|打|战|斗|冲|跳|踢|砍|刺|射|追|逃|躲|闪|看|说|喊|叫|笑|哭|怒|惊|悲|身|手|头|脸|眼|臂|腿|肩|发|孙悟空|二郎神|唐僧|猪八戒|沙僧|武|侠|剑|刀|枪|弓|盾|甲|铠/;
  for (const s of sentences) {
    const t = s.trim();
    if (!t || t.length < 2) continue;
    if (charKeywords.test(t)) continue; // 含人物关键词，跳过
    if (envKeywords.test(t)) envParts.push(t); // 含环境关键词，保留
  }
  return envParts.join('，') || '电影级场景环境';
}

// 场景图片 prompt — 纯环境，绝对无人物
function buildScenePrompt(title, description, theme, timeOfDay, category, dim = '2d', animStyle = '') {
  const parts = [];
  const cleanDesc = stripCharacterContent(description);
  parts.push(`empty landscape environment painting: ${title || 'scene'}`);
  if (cleanDesc) parts.push(cleanDesc);
  if (theme) parts.push(`${theme} genre atmosphere`);
  if (timeOfDay) {
    const timeMap = { '白天': 'bright daylight', '傍晚': 'sunset golden hour', '夜晚': 'night scene, moonlight', '清晨': 'early morning, dawn', '黄昏': 'twilight, dusk' };
    parts.push(timeMap[timeOfDay] || timeOfDay);
  }
  if (category) {
    const catMap = { '室外': 'outdoor', '室内': 'indoor interior', '战场': 'empty battlefield aftermath', '自然': 'nature landscape', '城市': 'cityscape urban' };
    parts.push(catMap[category] || category);
  }
  const styleKey = animStyle && STYLE_PROMPTS[animStyle] ? animStyle : (dim === '3d' ? '3dcg' : 'celulose');
  parts.push(STYLE_PROMPTS[styleKey]);
  if (dim && DIM_SUFFIX[dim]) parts.push(DIM_SUFFIX[dim]);
  parts.push('wide angle establishing shot, matte painting, environment concept art, background plate, completely empty scene, absolutely no people, no characters, no figures, no silhouettes, no creatures, uninhabited, desolate, high quality');
  return parts.join(', ');
}

function resolveProvider(dim) {
  const explicit = process.env.IMAGE_PROVIDER;
  if (explicit && explicit !== 'auto') return explicit;

  // 按维度选择（优先选有 use=image 模型的供应商）
  const settings = require('./settingsService').loadSettings();
  const hasImageModel = (pid) => {
    const p = (settings.providers || []).find(p => p.id === pid);
    return p && (p.models || []).some(m => m.use === 'image') && getApiKey(pid);
  };
  // 优先级：mxapi(NANO) > zhipu > jimeng > 其他
  const order = dim === '3d'
    ? ['mxapi', 'nanobanana', 'zhipu', 'jimeng', 'stability', 'openai', 'replicate']
    : ['mxapi', 'nanobanana', 'zhipu', 'jimeng', 'replicate', 'stability', 'openai'];
  for (const pid of order) {
    if (hasImageModel(pid)) return pid;
  }
  // 搜索所有自定义供应商（不在硬编码列表中的）
  for (const p of (settings.providers || [])) {
    if (!p.enabled || !p.api_key) continue;
    if (order.includes(p.id)) continue;
    if ((p.models || []).some(m => m.use === 'image')) return p.id;
  }
  throw new Error(`无可用的图片生成供应商（dim=${dim}）。请在管理后台配置至少一个图片生成API Key。`);
}

const DEMO_COLORS = {
  celulose:  ['0x7a3a8c', '0x5a2a6c', '0x3e1a5c'],
  urban:     ['0x1a0830', '0x180828', '0x0d0518'],
  '3dcg':    ['0x0d1b3e', '0x1a3060', '0x0f2050'],
  shadow:    ['0x6b2800', '0x4a1800', '0x2d1000'],
  cyberpunk: ['0x000040', '0x00003a', '0x000028'],
  pixel:     ['0x3a1888', '0x2a1060', '0x150a28'],
  chinese:   ['0x4a0e0e', '0x3a0808', '0x200505'],
  ghibli:    ['0x1e4a20', '0x2e6030', '0x1a3a1a'],
  western:   ['0x181828', '0x101020', '0x080810'],
};

// Demo: FFmpeg 生成占位图（异步，不阻塞事件循环）
async function generateDemoImage({ name, filename }) {
  ensureDir();
  const outputPath = path.join(imgDir(filename), `${filename}.png`);
  const palette = DEMO_COLORS.celulose;
  const color = palette[Math.floor(Math.random() * palette.length)];
  const safeName = (name || '角色').replace(/['"\\:<>]/g, ' ').substring(0, 12);
  const styleLabel = 'Demo';

  const cmd = [
    `"${ffmpegPath}"`,
    `-f lavfi -i "color=c=${color}:size=512x512:duration=1"`,
    `-vframes 1`,
    `-vf "drawtext=text='${safeName}':fontsize=60:fontcolor=white:x=(w-text_w)/2:y=h/2-30:alpha=0.9,`,
    `drawtext=text='${styleLabel}':fontsize=18:fontcolor=0x888888:x=(w-text_w)/2:y=h/2+50:alpha=0.5"`,
    `-y "${outputPath}"`
  ].join(' ');

  await new Promise((resolve, reject) => {
    exec(cmd, { stdio: 'pipe' }, (err) => err ? reject(err) : resolve());
  });
  return outputPath;
}

// OpenAI DALL-E 3
async function generateOpenAIImage({ name, role, description, filename, race, species, imageType = 'character', scenePrompt = '' }) {
  const apiKey = getApiKey('openai') || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('未配置 OPENAI_API_KEY');
  ensureDir();
  const outputPath = path.join(imgDir(filename), `${filename}.png`);
  const prompt = imageType === 'scene'
    ? (scenePrompt || buildScenePrompt(name, description, '', '', ''))
    : buildPrompt(name, role, description, '2d', race, species);
  // Full body character → portrait; scene → landscape
  // 角色转面图和场景都用横向比例
  const size = '1792x1024';

  const body = JSON.stringify({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size,
    response_format: 'url'
  });

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });

  if (result.error) throw new Error(`DALL-E: ${result.error.message}`);
  const imageUrl = result.data?.[0]?.url;
  if (!imageUrl) throw new Error('DALL-E 未返回图片');
  await downloadFile(imageUrl, outputPath);
  return outputPath;
}

// NanoBanana AI — generate-2 API (async task + polling)
async function generateNanoBananaImage({ prompt, filename, aspectRatio = '1:1', resolution = '1K', referenceImages = [] }) {
  const apiKey = getApiKey('nanobanana') || process.env.NANOBANANA_API_KEY;
  if (!apiKey) throw new Error('未配置 NANOBANANA_API_KEY');
  ensureDir();
  const outputPath = path.join(imgDir(filename), `${filename}.png`);

  // referenceImages: 用于角色一致性的参考图 URL 数组（最多14张）
  const imageUrls = (referenceImages || []).slice(0, 14);
  console.log(`[ImageService] NanoBanana generate-2 → refs=${imageUrls.length}, ratio=${aspectRatio}, prompt: ${prompt.substring(0, 100)}`);

  // Step 1: Submit generation task
  const axios = require('axios');
  const submitRes = await axios.post('https://api.nanobananaapi.ai/api/v1/nanobanana/generate-2', {
    prompt,
    imageUrls,
    aspectRatio,
    resolution,
    outputFormat: 'png',
  }, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  if (submitRes.data?.code !== 200 || !submitRes.data?.data?.taskId) {
    throw new Error(`NanoBanana 提交失败: ${submitRes.data?.message || JSON.stringify(submitRes.data)}`);
  }

  const taskId = submitRes.data.data.taskId;
  console.log(`[ImageService] NanoBanana taskId=${taskId}, polling...`);

  // Step 2: Poll for completion (max 120s)
  const maxWait = 120000;
  const interval = 3000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, interval));
    const pollRes = await axios.get('https://api.nanobananaapi.ai/api/v1/nanobanana/record-info', {
      params: { taskId },
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: 15000,
    });

    const data = pollRes.data?.data;
    if (!data) continue;

    if (data.successFlag === 1) {
      // Success — download the image
      const imageUrl = data.response?.resultImageUrl || data.response?.originImageUrl;
      if (!imageUrl) throw new Error('NanoBanana 成功但无图片URL');
      console.log(`[ImageService] NanoBanana 完成, 下载图片...`);
      await downloadFile(imageUrl, outputPath);
      return outputPath;
    } else if (data.successFlag === 2 || data.successFlag === 3) {
      throw new Error(`NanoBanana 生成失败: ${data.errorMessage || `flag=${data.successFlag}`}`);
    }
    // successFlag === 0 — still generating, continue polling
  }

  throw new Error('NanoBanana 生成超时（120秒）');
}

// MXAPI 聚合平台 — 图片生成（NANO/Gemini3Pro/即梦4.5/豆包Seedream）
async function generateMxapiImage({ prompt, filename, aspectRatio = '1:1', resolution = '1K', referenceImages = [], name, role, description, race, species, imageType = 'character', scenePrompt = '', image_model }) {
  const apiKey = getApiKey('mxapi') || process.env.MXAPI_API_KEY;
  if (!apiKey) throw new Error('未配置 MXAPI API Key');
  ensureDir();
  const outputPath = path.join(imgDir(filename), `${filename}.png`);
  const axios = require('axios');
  const baseUrl = 'https://open.mxapi.org/api/v2';
  const headers = { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' };

  const finalPrompt = prompt || (imageType === 'scene'
    ? (scenePrompt || buildScenePrompt(name, description, '', '', ''))
    : buildPrompt(name, role, description, '2d', race, species));

  const model = image_model || 'mxapi-draw';

  // Gemini 3 Pro — 同步接口（需长超时）
  if (model === 'mxapi-gemini3pro') {
    console.log(`[ImageService] MXAPI Gemini 3 Pro → prompt: ${finalPrompt.substring(0, 80)}`);
    const res = await axios.post(`${baseUrl}/images/gemini3pro`, {
      prompt: finalPrompt, image_size: resolution === '4K' ? '2048x2048' : '1024x1024', aspect_ratio: aspectRatio,
    }, { headers, timeout: 600000 });
    const imgUrl = res.data?.data?.url || res.data?.url || res.data?.data?.[0]?.url;
    if (!imgUrl) throw new Error('MXAPI Gemini 3 Pro 未返回图片: ' + JSON.stringify(res.data).substring(0, 300));
    await downloadFile(imgUrl, outputPath);
    return outputPath;
  }

  // 其他模型 — 通过 messages 流式/异步接口
  const endpointMap = {
    'mxapi-draw': '/draw',
    'mxapi-draw-pro': '/draw-pro',
    'mxapi-draw-4-5': '/draw-4-5',
    'mxapi-seedream': '/draw-4-5',  // 豆包 Seedream 走即梦4.5接口
  };
  const endpoint = endpointMap[model] || '/draw';

  console.log(`[ImageService] MXAPI ${model} → endpoint=${endpoint}, prompt: ${finalPrompt.substring(0, 80)}`);
  const res = await axios.post(`${baseUrl}${endpoint}`, {
    messages: [{ role: 'user', content: finalPrompt }],
    stream: false,
  }, { headers, timeout: 120000 });

  // 返回可能在 data.data.url / data.choices[0].message.content (含图片URL) / data.url
  const data = res.data?.data || res.data;
  let imgUrl = data?.url || data?.image_url;
  if (!imgUrl && data?.choices?.[0]?.message?.content) {
    // 从 markdown 图片语法中提取 URL
    const match = data.choices[0].message.content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
    if (match) imgUrl = match[1];
    // 或直接是 URL
    if (!imgUrl && data.choices[0].message.content.startsWith('http')) imgUrl = data.choices[0].message.content.trim();
  }
  if (!imgUrl) throw new Error('MXAPI 图片 未返回图片 URL: ' + JSON.stringify(res.data).substring(0, 300));
  await downloadFile(imgUrl, outputPath);
  return outputPath;
}

// 智谱 CogView-3-Flash
async function generateZhipuImage({ name, role, description, filename, race, species, imageType = 'character', scenePrompt = '' }) {
  const apiKey = getApiKey('zhipu') || process.env.ZHIPU_API_KEY;
  if (!apiKey) throw new Error('未配置 ZHIPU_API_KEY');
  ensureDir();
  const outputPath = path.join(imgDir(filename), `${filename}.png`);
  const prompt = imageType === 'scene'
    ? (scenePrompt || buildScenePrompt(name, description, '', '', ''))
    : buildPrompt(name, role, description, '2d', race, species);

  const body = JSON.stringify({ model: 'cogview-3-flash', prompt, size: '1024x1024' });

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'open.bigmodel.cn',
      path: '/api/paas/v4/images/generations',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });

  if (result.error) throw new Error(`CogView: ${result.error.message || JSON.stringify(result.error)}`);
  const imageUrl = result.data?.[0]?.url;
  if (!imageUrl) throw new Error('CogView 未返回图片');
  await downloadFile(imageUrl, outputPath);
  return outputPath;
}

// ——— Stability AI SD 3.5 ———
async function generateStabilityImage({ name, role, description, dim, filename, race, species }) {
  const apiKey = getApiKey('stability') || process.env.STABILITY_API_KEY;
  if (!apiKey) throw new Error('未配置 STABILITY_API_KEY');
  ensureDir();
  const outputPath = path.join(imgDir(filename), `${filename}.png`);
  const prompt = buildPrompt(name, role, description, dim, race, species);
  const model = dim === '3d' ? 'sd3.5-large' : 'sd3.5-large-turbo';

  // Stability API uses multipart/form-data
  const boundary = '----VIDOBoundary' + Date.now();
  const formParts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="output_format"\r\n\r\npng`,
    `--${boundary}--`,
  ];
  const body = Buffer.from(formParts.join('\r\n'), 'utf8');

  const imgData = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.stability.ai',
      path: '/v2beta/stable-image/generate/sd3',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'image/*',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Stability AI HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString().substring(0, 200)}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  fs.writeFileSync(outputPath, imgData);
  return outputPath;
}

// ——— Replicate FLUX ———
async function generateReplicateImage({ name, role, description, dim, filename, race, species }) {
  const apiKey = getApiKey('replicate') || process.env.REPLICATE_API_KEY;
  if (!apiKey) throw new Error('未配置 REPLICATE_API_KEY');
  ensureDir();
  const outputPath = path.join(imgDir(filename), `${filename}.png`);
  const prompt = buildPrompt(name, role, description, dim, race, species);
  // Use flux-schnell for 2D (fast), flux-dev for 3D (quality)
  const model = dim === '3d'
    ? 'black-forest-labs/flux-dev'
    : 'black-forest-labs/flux-schnell';

  const body = JSON.stringify({ input: { prompt, num_outputs: 1, aspect_ratio: '16:9', output_format: 'png', num_inference_steps: dim === '3d' ? 28 : 4 } });

  // Submit prediction
  const prediction = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.replicate.com',
      path: `/v1/models/${model}/predictions`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Prefer': 'wait=30',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  // Poll until complete
  let result = prediction;
  let attempts = 0;
  while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < 30) {
    await new Promise(r => setTimeout(r, 2000));
    result = await new Promise((resolve, reject) => {
      https.get({
        hostname: 'api.replicate.com',
        path: `/v1/predictions/${result.id}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
    attempts++;
  }

  if (result.status !== 'succeeded') throw new Error('Replicate 生成失败: ' + (result.error || result.status));
  const imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
  if (!imageUrl) throw new Error('Replicate 未返回图片 URL');
  await downloadFile(imageUrl, outputPath);
  return outputPath;
}

// ——— 即梦AI（Volcengine）图片生成 ———
function _signJimeng(ak, sk, { method, query, body }) {
  const crypto = require('crypto');
  const now = new Date();
  const xDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z').replace('Z', '').replace('T', 'T') + 'Z';
  const dateStr = xDate.substring(0, 8);
  const host = 'visual.volcengineapi.com';
  const region = 'cn-north-1';
  const service = 'cv';
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  const sortedQuery = Object.keys(query).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
  const canonHeaders = `content-type:application/json\nhost:${host}\nx-content-sha256:${bodyHash}\nx-date:${xDate}\n`;
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonRequest = [method.toUpperCase(), '/', sortedQuery, canonHeaders, signedHeaders, bodyHash].join('\n');
  const credentialScope = `${dateStr}/${region}/${service}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, crypto.createHash('sha256').update(canonRequest).digest('hex')].join('\n');
  const hmac = (key, data, enc) => require('crypto').createHmac('sha256', key).update(data).digest(enc || undefined);
  const signingKey = hmac(hmac(hmac(hmac(sk, dateStr), region), service), 'request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  return {
    'Authorization': `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'X-Date': xDate, 'X-Content-Sha256': bodyHash, 'Content-Type': 'application/json', 'Host': host
  };
}

// 即梦 API 通用请求
function _jimengRequest(ak, sk, query, body) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = _signJimeng(ak, sk, { method: 'POST', query, body: bodyStr });
  return new Promise((resolve, reject) => {
    const qs = Object.keys(query).sort().map(k => `${k}=${query[k]}`).join('&');
    const req = https.request({
      hostname: 'visual.volcengineapi.com', path: '/?' + qs, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          if (json.ResponseMetadata?.Error) {
            let errMsg = json.ResponseMetadata.Error.Message || JSON.stringify(json.ResponseMetadata.Error);
            // 过滤掉错误信息中的 API Key/Token（防止泄露到前端）
            errMsg = errMsg.replace(/token\[[^\]]*\]/gi, 'token[***]').replace(/key\[[^\]]*\]/gi, 'key[***]');
            return reject(new Error('即梦AI: ' + errMsg));
          }
          resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(bodyStr); req.end();
  });
}

async function generateJimengImage({ prompt, filename, dim = '2d', negativePrompt = '', referenceImages = [] }) {
  const rawKey = getApiKey('jimeng') || process.env.JIMENG_API_KEY;
  if (!rawKey) throw new Error('未配置即梦AI Key');
  if (!rawKey.includes(':')) throw new Error('即梦AI Key 格式错误，应为 AccessKeyId:SecretAccessKey');
  const [ak, sk] = rawKey.split(':');
  ensureDir();
  const outputPath = path.join(imgDir(filename), `${filename}.png`);

  // 选择模型：从 settings 读取 use=image 的模型，否则用默认 3.0
  let reqKey = 'jimeng_t2i_v30';
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === 'jimeng' && p.enabled);
    const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'image');
    if (m?.id) reqKey = m.id;
  } catch {}

  // 判断是否 3.0+ 异步接口（jimeng_ 开头）还是旧版同步接口
  const isAsync = reqKey.startsWith('jimeng_');

  console.log(`[Jimeng Image] reqKey=${reqKey}, async=${isAsync}`);

  if (isAsync) {
    // ——— 3.0 异步接口：CVSync2AsyncSubmitTask + CVSync2AsyncGetResult ———
    const query = { Action: 'CVSync2AsyncSubmitTask', Version: '2022-08-31' };
    const reqJson = JSON.stringify({
      logo_info: { add_logo: false }
    });
    // 即梦 3.0+: image_urls 用于参考图 (角色一致性), 仅传公网 URL
    const refUrls = (referenceImages || []).filter(u => /^https?:\/\//.test(u));
    const submitBody = JSON.stringify({
      req_key: reqKey,
      prompt: prompt.substring(0, 800),
      ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      ...(refUrls.length ? { image_urls: refUrls.slice(0, 3) } : {}),
      seed: -1,
      width: 1536,
      height: 768,
      use_pre_llm: true,
      return_url: true,
      req_json: reqJson
    });

    const task = await _jimengRequest(ak, sk, query, submitBody);
    console.log('[Jimeng Image] submit response:', JSON.stringify(task).substring(0, 500));

    const taskId = task.data?.task_id;
    if (!taskId) throw new Error('即梦AI 未返回任务ID: ' + JSON.stringify(task).substring(0, 300));

    // 轮询结果（最多 2 分钟）
    const queryAction = { Action: 'CVSync2AsyncGetResult', Version: '2022-08-31' };
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const queryBody = JSON.stringify({ req_key: reqKey, task_id: taskId });
      const result = await _jimengRequest(ak, sk, queryAction, queryBody);
      const rd = result.data || {};
      console.log(`[Jimeng Image] poll #${i+1}: status=${rd.status}`);
      if (rd.status === 'done') {
        const images = rd.image_urls || [];
        const b64List = rd.binary_data_base64 || [];
        if (images.length) { await downloadFile(images[0], outputPath); return outputPath; }
        if (b64List.length) { fs.writeFileSync(outputPath, Buffer.from(b64List[0], 'base64')); return outputPath; }
        throw new Error('即梦AI 已完成但未返回图片');
      }
      if (rd.status === 'failed') throw new Error('即梦AI 生成失败: ' + (rd.message || ''));
    }
    throw new Error('即梦AI 图片生成超时');

  } else {
    // ——— 旧版同步接口：CVProcess ———
    const query = { Action: 'CVProcess', Version: '2022-08-31' };
    const submitBody = JSON.stringify({
      req_key: reqKey,
      prompt: prompt.substring(0, 2000),
      seed: -1,
      width: 1536,
      height: 768
    });
    const result = await _jimengRequest(ak, sk, query, submitBody);
    console.log('[Jimeng Image] CVProcess response:', JSON.stringify(result).substring(0, 500));

    if (result.code !== 10000 && result.data?.status_code !== 0) {
      throw new Error('即梦AI 生成失败: ' + (result.message || JSON.stringify(result).substring(0, 200)));
    }
    const images = result.data?.image_urls || [];
    const b64List = result.data?.binary_data_base64 || [];
    if (images.length) { await downloadFile(images[0], outputPath); return outputPath; }
    if (b64List.length) { fs.writeFileSync(outputPath, Buffer.from(b64List[0], 'base64')); return outputPath; }
    throw new Error('即梦AI 未返回图片: ' + JSON.stringify(result).substring(0, 300));
  }
}

// ——— 主入口 ———
async function generateCharacterImage({ name, role = 'main', description = '', dim = '2d', race = '人', species = '', animStyle = '', mode = 'turnaround', aspectRatio = '1:1', resolution = '2K', referenceImages = [], provider: explicitProvider = null, model: explicitModel = null }) {
  const provider = explicitProvider || resolveProvider(dim);
  const dimTag = dim === '3d' ? '3d' : '2d';
  const filename = `char_${dimTag}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  let prompt;
  if (mode === 'portrait') {
    // 单张人物肖像/全身图（用于工作流分镜）
    if (provider === 'jimeng') {
      // 即梦用中文 prompt 效果更好
      const dimCN = dim === '3d' ? '3D写实CG渲染风格，三维立体建模质感，真实光影和材质' : dim === 'realistic' ? '真人摄影照片风格，8K超清写实' : '2D手绘动画风格，平面插画，赛璐珞上色';
      prompt = `单人角色全身立绘：${name}，${description || ''}，${dimCN}，干净简洁背景，高质量角色设定图，电影级光线`;
    } else {
      prompt = buildPortraitPrompt(name, role, description, dim, race, species, animStyle);
    }
  } else {
    // 多角度转面图（用于角色设定）
    prompt = provider === 'jimeng'
      ? buildJimengPrompt(name, role, description, dim, race, species, animStyle)
      : buildPrompt(name, role, description, dim, race, species, animStyle);
  }

  console.log(`[ImageService] 角色「${name}」→ provider=${provider}, dim=${dim}, mode=${mode}`);
  console.log(`[ImageService] prompt: ${prompt.substring(0, 200)}`);

  let filePath;
  switch (provider) {
    case 'jimeng':      filePath = await generateJimengImage({ prompt, filename, dim }); break;
    case 'mxapi':      filePath = await generateMxapiImage({ prompt, filename, aspectRatio, resolution, referenceImages, name, role, description, race, species, imageType: 'character' }); break;
    case 'nanobanana': filePath = await generateNanoBananaImage({ prompt, filename, aspectRatio, resolution, referenceImages }); break;
    case 'openai':     filePath = await generateOpenAIImage({ name, role, description, filename, race, species }); break;
    case 'zhipu':      filePath = await generateZhipuImage({ name, role, description, filename, race, species });  break;
    case 'stability':  filePath = await generateStabilityImage({ name, role, description, dim, filename, race, species }); break;
    case 'replicate':  filePath = await generateReplicateImage({ name, role, description, dim, filename, race, species }); break;
    default:
      // 自定义供应商：尝试 OpenAI 兼容 images/generations 接口
      filePath = await generateCustomProviderImage({ provider, prompt, filename, aspectRatio });
      break;
  }
  return { filePath, filename: path.basename(filePath) };
}

// 自定义供应商通用图片生成（OpenAI 兼容接口）
async function generateCustomProviderImage({ provider, prompt, filename, aspectRatio }) {
  const apiKey = getApiKey(provider);
  if (!apiKey) throw new Error(`供应商 ${provider} 无 API Key`);
  const settings = require('./settingsService').loadSettings();
  const providerConfig = (settings.providers || []).find(p => p.id === provider);
  if (!providerConfig) throw new Error(`供应商 ${provider} 不存在`);

  const baseURL = providerConfig.api_url;
  const imageModel = (providerConfig.models || []).find(m => m.use === 'image');
  const modelId = imageModel?.id || 'dall-e-3';

  console.log(`[ImageService] 自定义供应商 ${provider} (${providerConfig.name}), model=${modelId}`);

  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey, baseURL: baseURL || undefined });

  try {
    const resp = await client.images.generate({
      model: modelId,
      prompt: prompt.substring(0, 1000),
      n: 1,
      size: aspectRatio === '16:9' ? '1024x576' : '1024x1024',
    });
    const url = resp.data?.[0]?.url;
    if (!url) throw new Error('未返回图片 URL');

    const destDir = imgDir(filename);
    ensureDir();
    const destPath = path.join(destDir, `${filename}.png`);
    await downloadFile(url, destPath);
    return destPath;
  } catch (err) {
    console.error(`[ImageService] 自定义供应商 ${provider} 生图失败:`, err.message);
    throw err;
  }
}

// 即梦AI 专用中文场景 prompt — 纯环境，绝对无人物
function buildJimengScenePrompt(title, description, theme, timeOfDay, category, dim = '2d', animStyle = '') {
  const parts = [];
  const cleanDesc = stripCharacterContent(description);
  parts.push(`无人空旷风景画：${title || '场景'}`);
  if (cleanDesc) parts.push(cleanDesc);
  if (theme) parts.push(`${theme}题材氛围`);
  if (timeOfDay) parts.push(timeOfDay);
  if (category) {
    const catCN = { '战场': '空旷战后废墟', '室内': '空荡室内空间' };
    parts.push(catCN[category] || category);
  }
  const styleKey = animStyle && STYLE_PROMPTS_CN[animStyle] ? animStyle : (dim === '3d' ? '3dcg' : 'celulose');
  parts.push(STYLE_PROMPTS_CN[styleKey]);
  parts.push(DIM_SUFFIX_CN[dim] || DIM_SUFFIX_CN['2d']);
  parts.push('广角全景，环境概念画，场景设定图，完全空旷无人，严禁出现任何人物角色动物生物，只画地形建筑天空植被，无人荒凉空境，高质量精细');
  return parts.join('，');
}

// ——— 场景图片生成（复用 provider，但使用场景 prompt） ———

async function generateSceneImage({ title = '', description = '', theme = '', timeOfDay = '', category = '', dim = '2d', animStyle = '', aspectRatio = '16:9', resolution = '2K', referenceImages = [] }) {
  ensureDir();
  const provider = resolveProvider(dim);
  const filename = `scene_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const prompt = provider === 'jimeng'
    ? buildJimengScenePrompt(title, description, theme, timeOfDay, category, dim, animStyle)
    : buildScenePrompt(title, description, theme, timeOfDay, category, dim, animStyle);
  ensureDir();

  console.log(`[ImageService] 场景「${title}」→ provider=${provider}, dim=${dim}, ratio=${aspectRatio}`);

  let filePath;
  switch (provider) {
    case 'jimeng':
      filePath = await generateJimengImage({ prompt, filename, dim, negativePrompt: '人物，角色，人，人类，动物，生物，面孔，身体，person, people, human, character, figure, face, body, animal, creature' });
      break;
    case 'mxapi':
      filePath = await generateMxapiImage({ prompt, filename, aspectRatio, resolution, referenceImages, imageType: 'scene' });
      break;
    case 'nanobanana':
      filePath = await generateNanoBananaImage({ prompt, filename, aspectRatio, resolution, referenceImages });
      break;
    case 'zhipu':
      filePath = await generateZhipuImage({ name: title, role: '', description, filename, race: '', species: '', imageType: 'scene', scenePrompt: prompt });
      break;
    case 'openai':
      filePath = await generateOpenAIImage({ name: title, role: '', description, filename, race: '', species: '', imageType: 'scene', scenePrompt: prompt });
      break;
    case 'stability':
      filePath = await generateStabilityImage({ name: title, role: '', description, dim, filename, race: '', species: '' });
      break;
    case 'replicate':
      filePath = await generateReplicateImage({ name: title, role: '', description, dim, filename, race: '', species: '' });
      break;
    default:
      throw new Error(`不支持的图片生成供应商: ${provider}`);
  }
  return { filePath, filename: path.basename(filePath) };
}

// ——— 速率限制自动重试包装器 ———
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY = 8000; // 8秒起步

function isRateLimitError(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('rate') || msg.includes('速率') || msg.includes('频率') || msg.includes('限制')
    || msg.includes('429') || msg.includes('too many') || msg.includes('quota');
}

async function withRetry(fn, label) {
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRateLimitError(err) && attempt < RATE_LIMIT_MAX_RETRIES) {
        const delay = RATE_LIMIT_BASE_DELAY * (attempt + 1);
        console.log(`[ImageService] ${label} 速率限制，${delay/1000}秒后重试 (${attempt+1}/${RATE_LIMIT_MAX_RETRIES})...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

const _origGenerateCharacterImage = generateCharacterImage;
const _origGenerateSceneImage = generateSceneImage;

async function generateCharacterImageWithRetry(opts) {
  return withRetry(() => _origGenerateCharacterImage(opts), `角色「${opts.name}」`);
}
async function generateSceneImageWithRetry(opts) {
  return withRetry(() => _origGenerateSceneImage(opts), `场景「${opts.title}」`);
}

// ——— 分镜图生成（prompt 原样传入，不加前缀/后缀） ———
async function generateDramaImage({ prompt, filename, aspectRatio = '16:9', resolution = '2K', referenceImages = [] }) {
  ensureDir();
  const provider = resolveProvider('2d');
  const destFilename = filename || `drama_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const refCount = (referenceImages || []).length;

  console.log(`[ImageService] 分镜图 → provider=${provider}, prompt长度=${prompt?.length}, 参考图=${refCount}`);

  let filePath;
  switch (provider) {
    case 'jimeng':
      filePath = await generateJimengImage({ prompt, filename: destFilename, dim: '2d', referenceImages });
      break;
    case 'mxapi':
      filePath = await generateMxapiImage({ prompt, filename: destFilename, aspectRatio, resolution, referenceImages, imageType: 'scene' });
      break;
    case 'nanobanana':
      filePath = await generateNanoBananaImage({ prompt, filename: destFilename, aspectRatio, resolution, referenceImages });
      break;
    case 'zhipu':
      // CogView 不支持 reference image, 通过 prompt 注入
      filePath = await generateZhipuImage({ name: destFilename, role: '', description: prompt, filename: destFilename, race: '', species: '' });
      break;
    case 'openai':
      filePath = await generateOpenAIImage({ name: destFilename, role: '', description: prompt, filename: destFilename, race: '', species: '' });
      break;
    case 'stability':
      filePath = await generateStabilityImage({ name: destFilename, role: '', description: prompt, dim: '2d', filename: destFilename, race: '', species: '' });
      break;
    case 'replicate':
      filePath = await generateReplicateImage({ name: destFilename, role: '', description: prompt, dim: '2d', filename: destFilename, race: '', species: '' });
      break;
    default:
      filePath = await generateCustomProviderImage({ provider, prompt, filename: destFilename, aspectRatio });
      break;
  }
  return { filePath, filename: path.basename(filePath) };
}

// ——— 三视图生成：并行生成正/侧/背 3 张独立图，比依赖 LLM 在单图里画 3 角度更可靠 ———
async function generateCharacterThreeView(opts) {
  const { name, role, description, dim, race, species, animStyle, aspectRatio, resolution, referenceImages } = opts || {};
  if (!name) throw new Error('name 必填');

  const baseDesc = description || '';
  const views = [
    { key: 'front', cn: '正面视图', en: 'front view, facing camera, full body, T-pose, neutral expression, character reference sheet, white clean background' },
    { key: 'side',  cn: '侧面视图', en: 'side view profile, full body, T-pose, neutral expression, character reference sheet, white clean background' },
    { key: 'back',  cn: '背面视图', en: 'back view facing away, full body, T-pose, neutral expression, character reference sheet, white clean background' },
  ];

  const tasks = views.map(v => {
    const suffixedDesc = baseDesc + (baseDesc ? '，' : '') + v.cn + '，' + v.en;
    return generateCharacterImageWithRetry({
      name: `${name}_${v.key}`,
      role,
      description: suffixedDesc,
      dim, race, species, animStyle,
      mode: 'portrait',  // 关键：每张都是单角度全身图，不是 turnaround 拼图
      aspectRatio: aspectRatio || '1:1',
      resolution,
      referenceImages,
    }).then(r => ({ key: v.key, label: v.cn, ...r }))
      .catch(e => ({ key: v.key, label: v.cn, error: e.message }));
  });

  const results = await Promise.all(tasks);
  const ok = results.filter(r => !r.error);
  if (ok.length === 0) {
    throw new Error('三视图全部失败: ' + results.map(r => r.error).join('; '));
  }

  // 整理成 { front: {filename}, side: {...}, back: {...}, succeeded: 3, failed: 0 }
  const out = { succeeded: ok.length, failed: results.length - ok.length };
  results.forEach(r => { out[r.key] = r; });
  return out;
}

module.exports = {
  generateCharacterImage: generateCharacterImageWithRetry,
  generateCharacterThreeView,
  generateSceneImage: generateSceneImageWithRetry,
  generateDramaImage,
  CHAR_IMG_DIR, SCENE_IMG_DIR
};
