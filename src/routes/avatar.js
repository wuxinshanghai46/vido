const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// 上传目录
const uploadDir = path.join(__dirname, '../../outputs/avatar');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// 预设图片目录
const presetsDir = path.join(__dirname, '../../outputs/presets');
if (!fs.existsSync(presetsDir)) fs.mkdirSync(presetsDir, { recursive: true });

// 背景视频目录（P1: 视频背景合成）
const bgVideoDir = path.join(__dirname, '../../outputs/avatar/bg_videos');
if (!fs.existsSync(bgVideoDir)) fs.mkdirSync(bgVideoDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// POST /api/avatar/upload-image - 上传数字人形象图
router.post('/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename, path: `/api/avatar/images/${req.file.filename}` });
});

// POST /api/avatar/upload-audio - 上传驱动音频
router.post('/upload-audio', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename, path: `/api/avatar/audios/${req.file.filename}` });
});

// GET /api/avatar/images/:filename
router.get('/images/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filePath);
});

// GET /api/avatar/audios/:filename — 提供上传的音频文件
router.get('/audios/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filePath);
});

// POST /api/avatar/upload-bg-video — 上传背景视频（绿幕抠像合成用）
const bgVideoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, bgVideoDir),
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname) || '.mp4'}`)
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (req, file, cb) => {
    const ok = /video\/(mp4|webm|quicktime|x-matroska)/.test(file.mimetype) || /\.(mp4|mov|webm|mkv)$/i.test(file.originalname);
    cb(ok ? null : new Error('仅支持 mp4/mov/webm/mkv 视频'), ok);
  }
});
router.post('/upload-bg-video', bgVideoUpload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ success: true, filename: req.file.filename, path: `/api/avatar/bg-videos/${req.file.filename}` });
});

// GET /api/avatar/bg-videos/:filename — 提供背景视频文件
router.get('/bg-videos/:filename', (req, res) => {
  const filePath = path.join(bgVideoDir, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  // 支持 range 请求以便前端预览
  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(s, 10);
    const end = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' });
    fs.createReadStream(filePath).pipe(res);
  }
});

// 任务存储（内存 + 数据库持久化）
const avatarTasks = new Map();
const avatarSSE = new Map();
// 多机位参考图生成任务（内存态，重启丢失）
// 结构: { id, status: 'processing'|'done'|'error', images: {front_medium, side_45, front_closeup}, failed: [], created_at, source, bodyFrame }
const multiAngleTasks = new Map();
const db = require('../models/database');

// 启动时从数据库恢复已完成的任务到内存
(function restoreAvatarTasks() {
  try {
    const saved = db.listAvatarTasks();
    for (const t of saved) {
      if (!avatarTasks.has(t.id)) avatarTasks.set(t.id, t);
    }
    if (saved.length) console.log(`[Avatar] 从数据库恢复 ${saved.length} 个历史任务`);
  } catch {}
})();

// 解析 avatar 图片路径的公共函数
function resolveAvatarImage(avatar) {
  let imageUrl = avatar;
  const outputDir = path.resolve(process.env.OUTPUT_DIR || './outputs');
  if (avatar.startsWith('/api/avatar/images/')) {
    imageUrl = path.join(uploadDir, path.basename(avatar));
  } else if (avatar.startsWith('/api/avatar/preset-img/')) {
    imageUrl = path.join(presetsDir, path.basename(avatar));
  } else if (avatar.startsWith('custom_')) {
    // 自定义生成的 avatar — 在 presetsDir 中找 avatar_custom_xxx.png
    const custFiles = fs.readdirSync(presetsDir).filter(f => f === `avatar_${avatar}.png`);
    if (custFiles.length > 0) imageUrl = path.join(presetsDir, custFiles[0]);
    else return { error: `自定义形象 "${avatar}" 图片不存在` };
  } else if (avatar.startsWith('/api/story/character-image/')) {
    // AI 角色图 — 在 characters/ 和 scenes/ 目录中查找
    const fname = path.basename(avatar);
    const charsPath = path.join(outputDir, 'characters', fname);
    const scenesPath = path.join(outputDir, 'scenes', fname);
    imageUrl = fs.existsSync(charsPath) ? charsPath : fs.existsSync(scenesPath) ? scenesPath : charsPath;
  } else if (avatar.startsWith('/api/i2v/images/')) {
    // i2v 上传的图片
    imageUrl = path.join(outputDir, 'i2v', path.basename(avatar));
  } else if (PRESET_AVATARS[avatar]) {
    const presetFiles = fs.readdirSync(presetsDir).filter(f => f.startsWith(`avatar_${avatar}.`));
    if (presetFiles.length > 0) {
      imageUrl = path.join(presetsDir, presetFiles[0]);
    } else {
      return { error: `预设形象 "${avatar}" 的图片尚未生成，请先在设置中生成预设图片` };
    }
  } else if (!avatar.startsWith('http') && !fs.existsSync(avatar)) {
    return { error: '无效的形象图片: ' + avatar };
  }
  return { imageUrl };
}

// POST /api/avatar/smart-camera — AI 智能镜头推荐（根据业务场景+内容）
// body: { text, scenario: 'promo'|'knowledge'|'news'|'story'|'tutorial'|'live' }
router.post('/smart-camera', async (req, res) => {
  try {
    const { text, scenario = 'live' } = req.body;
    if (!text || text.trim().length < 10) return res.status(400).json({ success: false, error: '文本太短，至少 10 字' });
    const { agentSmartCameraShots } = require('../services/avatarService');
    const shots = await agentSmartCameraShots(text, scenario);
    if (!shots) return res.status(500).json({ success: false, error: 'AI 推荐失败，请重试' });
    res.json({ success: true, shots });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/avatar/prompt-preview — 根据当前参数返回最终送到 I2V 的 prompt（英文 + 中文对照，前端默认显示中文）
// body: { text, emotion, emotion_intensity, camera, background, expression, customSuffix, bodyFrame }
router.post('/prompt-preview', (req, res) => {
  try {
    const { text = '', emotion = 'neutral', emotion_intensity = 0.5, camera = 'medium', background = 'office', customSuffix = '', bodyFrame = 'head_shoulders' } = req.body;
    const BG_DESC = {
      office: 'in a modern corporate office with city skyline view through glass windows, warm professional lighting',
      studio: 'in a professional TV broadcast studio with blue and purple neon lighting, LED screen background',
      classroom: 'in a modern bright classroom with whiteboard and bookshelves, warm natural lighting',
      outdoor: 'in a beautiful outdoor garden with cherry blossoms and soft golden sunlight',
      green: 'against a solid green chroma key background',
      custom: '',
    };
    const BG_DESC_ZH = {
      office: '在现代企业办公室内，透过落地玻璃窗可见城市天际线，暖色专业灯光',
      studio: '在专业电视演播室内，蓝紫色霓虹灯 + LED 屏幕背景',
      classroom: '在现代明亮教室内，白板和书架，暖色自然光',
      outdoor: '在美丽的户外花园，樱花盛开，柔和金色阳光',
      green: '绿幕纯色抠像背景',
      custom: '',
    };
    const EMO_WORDS = {
      neutral:{low:'slightly flat',mid:'natural',high:'pronounced composure',extreme:'stoic intensity'},
      happy:{low:'subtle smile',mid:'warm genuine smile',high:'big joyful smile',extreme:'radiant beaming grin'},
      serious:{low:'slightly focused',mid:'focused serious',high:'intense serious',extreme:'grave intense stare'},
      excited:{low:'mildly enthused',mid:'excited',high:'very excited and animated',extreme:'electrifying excited energy'},
      sad:{low:'slight melancholy',mid:'sad',high:'visibly sad',extreme:'deeply sorrowful'},
      surprised:{low:'slightly surprised',mid:'surprised',high:'visibly shocked',extreme:'mouth agape in astonishment'},
      confident:{low:'calm confidence',mid:'confident',high:'strongly confident',extreme:'powerfully commanding'},
      warm:{low:'subtle warmth',mid:'warm friendly',high:'deeply warm',extreme:'overflowing warmth'},
    };
    const EMO_WORDS_ZH = {
      neutral:{low:'略显平淡',mid:'自然',high:'沉稳克制',extreme:'凝重坚毅'},
      happy:{low:'浅浅微笑',mid:'温暖真挚的笑容',high:'开怀灿笑',extreme:'光芒四射的笑容'},
      serious:{low:'略为专注',mid:'严肃专注',high:'极度严肃',extreme:'凝重逼人'},
      excited:{low:'略带激动',mid:'兴奋',high:'非常兴奋活跃',extreme:'爆发式的激昂'},
      sad:{low:'略带忧郁',mid:'悲伤',high:'明显悲伤',extreme:'深切悲痛'},
      surprised:{low:'略感惊讶',mid:'惊讶',high:'明显震惊',extreme:'目瞪口呆'},
      confident:{low:'平静自信',mid:'自信',high:'强烈自信',extreme:'气场全开'},
      warm:{low:'略带温暖',mid:'温暖友善',high:'深深的温暖',extreme:'温暖四溢'},
    };
    const i = Math.max(0, Math.min(1, emotion_intensity));
    const band = i < 0.3 ? 'low' : i < 0.6 ? 'mid' : i < 0.85 ? 'high' : 'extreme';
    const emoDesc = `${(EMO_WORDS[emotion] || EMO_WORDS.neutral)[band]} expression (emotion intensity ${(i*100).toFixed(0)}/100)`;
    const emoDescZh = `${(EMO_WORDS_ZH[emotion] || EMO_WORDS_ZH.neutral)[band]}表情（情绪强度 ${(i*100).toFixed(0)}/100）`;

    const CAM_HINTS = {
      medium: '', close_up: 'close-up shot of the face', full: 'wide establishing shot',
      zoom_in: 'slow zoom in on the subject', zoom_out: 'slow zoom out revealing the environment',
      pan_left: 'camera pans to the left', pan_right: 'camera pans to the right',
      orbit: 'camera orbits around the subject', tilt_up: 'camera tilts upward', tilt_down: 'camera tilts downward',
    };
    const CAM_HINTS_ZH = {
      medium: '', close_up: '面部特写镜头', full: '全景大景别',
      zoom_in: '慢速推镜', zoom_out: '慢速拉镜揭示环境',
      pan_left: '镜头左摇', pan_right: '镜头右摇',
      orbit: '环绕镜头', tilt_up: '镜头上仰', tilt_down: '镜头下俯',
    };
    const BODY_DESC = {
      head_shoulders: 'head and shoulders composition, talking head shot with confident direct eye contact',
      half_body: 'half body medium shot visible from waist up, hands and forearms in frame, natural hand gestures while speaking, subtle shoulder and chest movement',
      full_body: 'full body shot, entire figure visible from head to feet, natural body posture, expressive hand and arm movements while speaking',
    };
    const BODY_DESC_ZH = {
      head_shoulders: '头肩构图，头部特写口播景别，自信直视镜头',
      half_body: '半身中景（腰部以上入镜），手部和前臂可见，说话时自然的手势，肩部胸部轻微起伏',
      full_body: '全身镜头（从头到脚完整入镜），自然站姿，说话时丰富的手臂和身体动作',
    };
    const camKey = typeof camera === 'string' ? camera : (camera.simple || camera.type || 'medium');
    const camHint = CAM_HINTS[camKey] || '';
    const camHintZh = CAM_HINTS_ZH[camKey] || '';
    const bgDesc = BG_DESC[background] || BG_DESC.office;
    const bgDescZh = BG_DESC_ZH[background] || BG_DESC_ZH.office;
    const bodyHint = BODY_DESC[bodyFrame] || BODY_DESC.head_shoulders;
    const bodyHintZh = BODY_DESC_ZH[bodyFrame] || BODY_DESC_ZH.head_shoulders;
    const motion = 'gentle breathing motion visible in shoulders, natural subtle weight shifts, occasional slight head tilts, realistic eye blinks every 3-4 seconds, smooth fluid body language';
    const motionZh = '肩部可见的自然呼吸起伏，身体重心细微转换，偶尔轻微歪头，每 3-4 秒自然眨眼，流畅的肢体语言';
    const camHintStr = camHint ? `, ${camHint}` : '';
    const camHintZhStr = camHintZh ? `，${camHintZh}` : '';
    const suffixStr = customSuffix && customSuffix.trim() ? `. ${customSuffix.trim()}` : '';
    const suffixZhStr = customSuffix && customSuffix.trim() ? `。${customSuffix.trim()}` : '';

    const prompt = text
      ? `The person in the image is speaking directly to the camera with confident eye contact ${bgDesc ? bgDesc + ', ' : ''}with ${emoDesc}. ${bodyHint}. ${motion}${camHintStr}. They say: "${text.slice(0, 100)}"${suffixStr}. Realistic lip sync, natural hand gestures while talking, cinematic smooth motion, 24fps film quality.`
      : `The person in the image is looking at the camera with confident eye contact ${bgDesc ? bgDesc + ', ' : ''}with ${emoDesc}. ${bodyHint}. ${motion}${camHintStr}${suffixStr}. Professional demeanor, cinematic smooth motion, 24fps film quality.`;

    const promptZh = text
      ? `画面中的人物直视镜头自信地说话，${bgDescZh ? bgDescZh + '，' : ''}${emoDescZh}。${bodyHintZh}。${motionZh}${camHintZhStr}。他/她说："${text.slice(0, 100)}"${suffixZhStr}。真实的唇形同步，说话时自然的手势，电影级平滑运动，24 帧电影质感。`
      : `画面中的人物直视镜头，${bgDescZh ? bgDescZh + '，' : ''}${emoDescZh}。${bodyHintZh}。${motionZh}${camHintZhStr}${suffixZhStr}。专业仪态，电影级平滑运动，24 帧电影质感。`;

    res.json({ success: true, prompt, prompt_zh: promptZh });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/avatar/translate-prompt — 用户编辑中文后，同步翻译回英文（用 LLM）
// body: { prompt_zh }
router.post('/translate-prompt', async (req, res) => {
  try {
    const { prompt_zh } = req.body;
    if (!prompt_zh || !prompt_zh.trim()) return res.status(400).json({ success: false, error: 'prompt_zh 为空' });

    const { callLLM } = require('../services/storyService');
    const sys = `You are a prompt translation assistant. Translate the following Chinese video generation prompt into concise English. Keep all technical terms (lip sync, camera control, eye contact, etc.) in English. Preserve structure, quoted dialogue (keep Chinese in the quotes untranslated if user wrote Chinese dialogue), and cinematography language. Output ONLY the English prompt, no prefix/suffix or explanation.`;
    const en = await callLLM({
      system: sys,
      user: prompt_zh.slice(0, 4000),
      temperature: 0.3,
      max_tokens: 800,
    });
    if (!en || !en.trim()) throw new Error('LLM 返回空');
    res.json({ success: true, prompt: en.trim(), prompt_zh });
  } catch (err) {
    console.error('[translate-prompt]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// P0: 多机位参考图生成 (3 机位 i2i)
// ═══════════════════════════════════════════════

// POST /api/avatar/generate-multi-angle
// body: { avatar, bodyFrame?, aspectRatio? }
// 异步启动：立即返回 taskId，前端轮询 GET /api/avatar/multi-angle/:taskId
// ═══════════════════════════════════════════════
// 全身扩图（Omni + full_body 用）
// 用户选 bodyFrame='full_body' 但输入图是头肩/半身 → Omni 生成时无腿无脚
// 这里用 Seedream/NanoBanana i2i 把人物扩成全身照，保脸，给 Omni 作为输入
// ═══════════════════════════════════════════════
const fullBodyCache = new Map(); // avatar-key → { path, url, ts }
const fullBodyTasks = new Map();

router.post('/outpaint-fullbody', async (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar) return res.status(400).json({ success: false, error: '请提供 avatar' });

    // 缓存命中：同一 key 24h 内不重跑
    const cached = fullBodyCache.get(avatar);
    if (cached && (Date.now() - cached.ts) < 24 * 3600 * 1000 && fs.existsSync(cached.path)) {
      return res.json({ success: true, cached: true, image_url: cached.url });
    }

    const resolved = resolveAvatarImage(avatar);
    if (resolved.error) return res.status(400).json({ success: false, error: resolved.error });

    const taskId = uuidv4();
    fullBodyTasks.set(taskId, { id: taskId, status: 'processing', avatar });
    res.json({ success: true, taskId });

    (async () => {
      try {
        const { generateFullBodyOutpaint } = require('../services/avatarService');
        const outPath = await generateFullBodyOutpaint(resolved.imageUrl, { aspectRatio: '9:16', filenamePrefix: `fullbody_${avatar}` });
        // 复制到 presetsDir 对外暴露（沿用 /api/avatar/preset-img/ 路径）
        const destName = `fullbody_${avatar}_${Date.now()}.png`;
        const destPath = path.join(presetsDir, destName);
        fs.copyFileSync(outPath, destPath);
        const url = `/api/avatar/preset-img/${destName}`;
        fullBodyCache.set(avatar, { path: destPath, url, ts: Date.now() });
        const t = fullBodyTasks.get(taskId);
        if (t) { t.status = 'done'; t.image_url = url; }
      } catch (err) {
        console.error('[outpaint-fullbody]', err.message);
        const t = fullBodyTasks.get(taskId);
        if (t) { t.status = 'error'; t.error = err.message; }
      }
    })();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/outpaint-fullbody/:taskId', (req, res) => {
  const t = fullBodyTasks.get(req.params.taskId);
  if (!t) return res.status(404).json({ success: false, error: 'task not found' });
  res.json({ success: true, task: t });
});

router.post('/generate-multi-angle', async (req, res) => {
  try {
    const { avatar, bodyFrame = 'half_body', aspectRatio = '9:16' } = req.body;
    if (!avatar) return res.status(400).json({ success: false, error: '请提供 avatar' });
    if (!['head_shoulders', 'half_body', 'full_body'].includes(bodyFrame)) {
      return res.status(400).json({ success: false, error: '无效的 bodyFrame' });
    }
    const resolved = resolveAvatarImage(avatar);
    if (resolved.error) return res.status(400).json({ success: false, error: resolved.error });

    const taskId = uuidv4();
    multiAngleTasks.set(taskId, {
      id: taskId,
      status: 'processing',
      images: {},
      failed: [],
      source: avatar,
      bodyFrame,
      aspectRatio,
      created_at: new Date().toISOString(),
      progress: [],
    });
    res.json({ success: true, taskId });

    // 异步执行
    (async () => {
      try {
        const { generateMultiAngleReferenceSet } = require('../services/avatarService');
        const onProgress = (info) => {
          const t = multiAngleTasks.get(taskId);
          if (t) t.progress.push(info);
        };
        const result = await generateMultiAngleReferenceSet(resolved.imageUrl, {
          aspectRatio,
          bodyFrame,
          onProgress,
          filenamePrefix: `multi_angle_${taskId.slice(0, 8)}`,
        });

        // result: { front_medium?, side_45?, front_closeup?, failed: [] }
        // 每张本地磁盘文件 → 复制到 presetsDir 并转为 /api/avatar/preset-img/xxx URL
        const imageUrls = {};
        for (const key of ['front_medium', 'side_45', 'front_closeup']) {
          const filePath = result[key];
          if (filePath && fs.existsSync(filePath)) {
            const destName = `multi_angle_${taskId.slice(0, 8)}_${key}.png`;
            const destPath = path.join(presetsDir, destName);
            try {
              fs.copyFileSync(filePath, destPath);
              imageUrls[key] = `/api/avatar/preset-img/${destName}`;
            } catch (copyErr) {
              fs.writeFileSync(destPath, fs.readFileSync(filePath));
              imageUrls[key] = `/api/avatar/preset-img/${destName}`;
            }
          }
        }

        const task = multiAngleTasks.get(taskId);
        if (task) {
          task.status = 'done';
          task.images = imageUrls;
          task.failed = result.failed || [];
        }
      } catch (err) {
        console.error('[multi-angle] 失败:', err.message);
        const t = multiAngleTasks.get(taskId);
        if (t) { t.status = 'error'; t.error = err.message; }
      }
    })();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/avatar/multi-angle/:taskId — 查询多机位任务状态
router.get('/multi-angle/:taskId', (req, res) => {
  const task = multiAngleTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
  res.json({
    success: true,
    status: task.status,
    images: task.images,
    failed: task.failed,
    bodyFrame: task.bodyFrame,
    error: task.error || null,
    progress: task.progress?.slice(-3) || [],
  });
});

// POST /api/avatar/regenerate-angle — 单独重生成某一角度
// body: { avatar, angle: 'front_medium'|'side_45'|'front_closeup', bodyFrame?, aspectRatio? }
router.post('/regenerate-angle', async (req, res) => {
  try {
    const { avatar, angle, bodyFrame = 'half_body', aspectRatio = '9:16' } = req.body;
    if (!avatar) return res.status(400).json({ success: false, error: '请提供 avatar' });
    if (!['front_medium', 'side_45', 'front_closeup'].includes(angle)) {
      return res.status(400).json({ success: false, error: '无效的 angle' });
    }
    const resolved = resolveAvatarImage(avatar);
    if (resolved.error) return res.status(400).json({ success: false, error: resolved.error });

    const { generateDramaImage } = require('../services/imageService');
    // 统一源图为 base64
    let refBase64;
    const src = resolved.imageUrl;
    if (src.startsWith('http')) {
      const axios = require('axios');
      const r = await axios.get(src, { responseType: 'arraybuffer', timeout: 30000 });
      refBase64 = Buffer.from(r.data).toString('base64');
    } else if (fs.existsSync(src)) {
      refBase64 = fs.readFileSync(src).toString('base64');
    } else {
      return res.status(400).json({ success: false, error: '源图无法读取' });
    }

    const bodyZh = { full_body: '全身', half_body: '半身（腰部以上，含手部）', head_shoulders: '头肩' }[bodyFrame];
    const PROMPTS = {
      front_medium: `严格保留图中人物的脸型、五官、发型、肤色、服装完全不变，改为正对镜头的${bodyZh}中景站姿，自然站立，双手自然放松或轻微手势，柔和光线，干净简约背景，电影级写实摄影，8K`,
      side_45:      `严格保留图中人物的脸型、五官、发型、肤色、服装完全不变，改为身体转向 45 度侧面的${bodyZh}姿态，眼神朝向镜头方向，自然转身动态，柔和光线，干净简约背景，电影级写实摄影，8K`,
      front_closeup:`严格保留图中人物的脸型、五官、发型、肤色完全不变，改为正对镜头的头肩近景特写，面部占画面 60% 以上，柔和正面自然光，虚化背景，浅景深人像摄影，电影级写实 8K`,
    };

    const result = await generateDramaImage({
      prompt: PROMPTS[angle],
      filename: `multi_angle_${angle}_${Date.now()}`,
      aspectRatio,
      referenceImages: [refBase64],
      image_model: 'nanobanana',
    });
    if (!result?.filePath || !fs.existsSync(result.filePath)) {
      return res.status(500).json({ success: false, error: '图片生成失败' });
    }
    const destName = `multi_angle_${angle}_${Date.now()}.png`;
    const destPath = path.join(presetsDir, destName);
    fs.copyFileSync(result.filePath, destPath);
    res.json({ success: true, angle, imageUrl: `/api/avatar/preset-img/${destName}` });
  } catch (err) {
    console.error('[regenerate-angle] 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/avatar/storyboard - AI 分镜预览（不生成视频，只返回分镜结果）
router.post('/storyboard', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length < 10) return res.status(400).json({ error: '文本太短，至少 10 字' });
    const { agentStoryboard, agentEmotionCurve } = require('../services/avatarService');
    let shots = await agentStoryboard(text);
    shots = await agentEmotionCurve(shots);
    res.json({ success: true, shots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/avatar/generate - 生成数字人视���（支持多段/分镜/多场景模式）
router.post('/generate', async (req, res) => {
  try {
    const {
      avatar, text, voiceId, speed, ratio, model, expression, background, segments, title,
      bgm, voiceVolume, bgmVolume, textEffects, stickers, pointers, autoStoryboard, scenes,
      // P1/P2 新参数
      camera,             // 'medium' | 'zoom_in' | ... | {type,config} 结构化运镜
      emotion,            // 情绪标签（覆盖 expression）
      emotion_intensity,  // 0-1 情绪强度
      backgroundVideo,    // 视频背景 URL / 本地路径（需 background='green'）
      // P0 新参数
      bodyFrame,          // 'head_shoulders' | 'half_body' | 'full_body'
      multiAngleImages,   // { front_medium, side_45, front_closeup } URL 映射
      // 用户在前端编辑过的最终 prompt（英文或中文，直接送给 I2V）
      promptOverride,
    } = req.body;
    if (!avatar) return res.status(400).json({ success: false, error: '请选择数字人形象' });

    const { generateAvatarVideo, generateMultiSegmentVideo, generateMultiSceneVideo } = require('../services/avatarService');
    const taskId = uuidv4();

    const resolved = resolveAvatarImage(avatar);
    if (resolved.error) return res.status(400).json({ success: false, error: resolved.error });

    // 记录任务（含 ratio 和 model 以便历史记录显示）
    const taskRatio = req.body.ratio || '9:16';
    const taskModel = req.body.model || 'cogvideox-flash';
    avatarTasks.set(taskId, { id: taskId, status: 'processing', created_at: new Date().toISOString(), title: title || '', text, segments: segments || null, scenes: scenes || null, user_id: req.user?.id, ratio: taskRatio, model: taskModel });
    res.json({ success: true, taskId });

    const onProgress = (data) => {
      const listeners = avatarSSE.get(taskId) || [];
      listeners.forEach(r => { try { r.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} });
    };

    // v2: 判断生成模式
    //  A) segments.length > 1 → 用户手动多段
    //  B) autoStoryboard=true + text → AI 分镜多段
    //  C) scenes 数组 → 多场景模式（每个 scene 不同背景/avatar）
    //  D) 其他 → 单段
    const useMultiSegment = (segments && segments.length > 1) || (autoStoryboard && text && text.trim().length > 30) || (scenes && scenes.length > 0);

    let genPromise;
    if (scenes && scenes.length > 0) {
      // 方案 C: 多场景模式 — 每个场景独立的 avatar/background/text
      genPromise = generateMultiSceneVideo({
        scenes: scenes.map(sc => ({
          ...sc,
          imageUrl: resolveAvatarImage(sc.avatar || avatar).imageUrl || resolved.imageUrl,
        })),
        voiceId: voiceId || '',
        speed: typeof speed === 'number' ? speed : parseFloat(speed) || 1.0,
        ratio: ratio || '9:16',
        model: model || 'cogvideox-flash',
        onProgress,
      });
    } else if (useMultiSegment) {
      genPromise = generateMultiSegmentVideo({
          imageUrl: resolved.imageUrl,
          segments: (segments && segments.length > 1) ? segments : undefined,
          text: (!segments || segments.length <= 1) ? text : undefined,
          autoStoryboard: !!autoStoryboard,
          voiceId: voiceId || '',
          speed: typeof speed === 'number' ? speed : parseFloat(speed) || 1.0,
          ratio: ratio || '9:16',
          model: model || 'cogvideox-flash',
          background: background || 'office',
          // P0 新增
          bodyFrame: bodyFrame || 'head_shoulders',
          multiAngleImages: multiAngleImages || null,
          onProgress
        });
    } else {
      genPromise = generateAvatarVideo({
          imageUrl: resolved.imageUrl,
          text: text || '',
          voiceId: voiceId || '',
          speed: typeof speed === 'number' ? speed : parseFloat(speed) || 1.0,
          ratio: ratio || '9:16',
          model: model || 'cogvideox-flash',
          expression: expression || 'natural',
          background: background || 'office',
          bgm: bgm || null,
          voiceVolume: voiceVolume ?? 1.0,
          bgmVolume: bgmVolume ?? 0.15,
          // P1/P2 新增
          camera: camera || undefined,
          emotion: emotion || undefined,
          emotion_intensity: typeof emotion_intensity === 'number' ? emotion_intensity : parseFloat(emotion_intensity) || 0.5,
          backgroundVideo: backgroundVideo || undefined,
          customPromptSuffix: req.body.customPromptSuffix || '',
          // P0 新增
          bodyFrame: bodyFrame || 'head_shoulders',
          // 用户编辑后的 prompt（优先）
          promptOverride: promptOverride || '',
          onProgress
        });
    }

    genPromise.then(async result => {
      let finalPath = result.videoPath;

      // 应用后期特效（花字 / 产品贴图 / 招引动画）
      const hasEffects = (textEffects?.length || 0) > 0 || (stickers?.length || 0) > 0 || (pointers?.length || 0) > 0;
      if (hasEffects) {
        try {
          onProgress({ step: 'effects', message: '应用后期特效...' });
          const { applyEffects } = require('../services/effectsService');

          // 解析 sticker 路径（前端传来 /api/avatar/images/xxx）
          const resolvedStickers = (stickers || []).map((s, i) => {
            let p = s.path || s.url || '';
            if (p.startsWith('/api/avatar/images/')) {
              p = path.join(uploadDir, path.basename(p));
            }
            return {
              path: p,
              width: s.width || 240,
              height: s.height || 240,
              x: s.x ?? 40,
              y: s.y ?? (40 + i * 260),
              startTime: s.startTime ?? 0,
              endTime: s.endTime,
            };
          }).filter(s => s.path && fs.existsSync(s.path));

          // 映射文字特效样式到 effectsService preset
          // effectsService 识别的 position: top / top-left / top-right / center / bottom / ...
          const posMap = { 'top-center': 'top', 'bottom-center': 'bottom', 'center': 'center' };
          const resolvedTexts = (textEffects || []).map((e, i) => ({
            text: e.text,
            preset: e.style || 'title',
            position: posMap[e.position] || e.position || 'top',
            startTime: e.startTime ?? 0,
            endTime: e.endTime,
          })).filter(t => t.text);

          // 招引动画映射：前端 type (arrow/finger/fire/sparkle/circle) → effectsService icon
          const iconMap = {
            arrow: 'arrow_down', finger: 'finger_point', fire: 'fire',
            sparkle: 'sparkle', circle: 'star',
          };
          const resolvedPointers = (pointers || []).map(p => {
            const posXY = {
              'top-center':    { x: '50%', y: '15%' },
              'center':        { x: '50%', y: '50%' },
              'bottom-center': { x: '50%', y: '75%' },
              'bottom-left':   { x: '15%', y: '75%' },
              'bottom-right':  { x: '85%', y: '75%' },
            }[p.position || 'bottom-center'] || { x: '50%', y: '75%' };
            return {
              icon: iconMap[p.type] || p.type || 'arrow_down',
              ...posXY,
              startTime: p.startTime ?? 0,
              endTime: p.endTime,
            };
          });

          const fx = await applyEffects({
            videoPath: finalPath,
            texts: resolvedTexts,
            images: resolvedStickers,
            pointers: resolvedPointers,
            onProgress: (d) => onProgress({ step: 'effects', message: d.detail || '应用特效中...', progress: d.progress }),
          });
          if (fx?.outputPath && fs.existsSync(fx.outputPath)) {
            finalPath = fx.outputPath;
            console.log(`[Avatar] 特效合成完成: ${finalPath}`);
          }
        } catch (fxErr) {
          console.warn('[Avatar] 特效合成失败（保留原始视频）:', fxErr.message);
          // 特效失败不阻塞整体 — 用原视频输出
        }
      }

      const videoUrl = `/api/avatar/tasks/${taskId}/stream`;
      const taskData = { ...avatarTasks.get(taskId), status: 'done', videoPath: finalPath, videoUrl };
      avatarTasks.set(taskId, taskData);
      // 持久化到数据库
      try {
        if (!db.getAvatarTask(taskId)) {
          db.insertAvatarTask(taskData);
        } else {
          db.updateAvatarTask(taskId, { status: 'done', videoPath: result.videoPath, videoUrl });
        }
      } catch (dbErr) { console.warn('[Avatar] DB 写入失败:', dbErr.message); }
      const listeners = avatarSSE.get(taskId) || [];
      listeners.forEach(r => { try { r.write(`data: ${JSON.stringify({ step: 'done', videoUrl })}\n\n`); } catch {} });
    }).catch(err => {
      console.error('[Avatar] 生成失败:', err.message);
      const taskData = { ...avatarTasks.get(taskId), status: 'error', error: err.message };
      avatarTasks.set(taskId, taskData);
      // 持久化失败状态
      try {
        if (!db.getAvatarTask(taskId)) {
          db.insertAvatarTask(taskData);
        } else {
          db.updateAvatarTask(taskId, { status: 'error', error: err.message });
        }
      } catch {}
      const listeners = avatarSSE.get(taskId) || [];
      listeners.forEach(r => { try { r.write(`data: ${JSON.stringify({ step: 'error', message: err.message })}\n\n`); } catch {} });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/avatar/multi-speaker - 多人数字人同框对话 (P0 差异化)
// body: { speakers: [{id, avatar, voiceId, name?, emotion?}], dialogue: [{speakerId, text, ...}], layout, background, ratio, model, speed, title }
router.post('/multi-speaker', async (req, res) => {
  try {
    const { speakers, dialogue, layout = 'cut-to-speaker', background = 'studio', ratio = '16:9', model = 'cogvideox-flash', speed = 1.0, title = '' } = req.body;

    if (!Array.isArray(speakers) || speakers.length < 1) return res.status(400).json({ success: false, error: '至少 1 个 speaker' });
    if (!Array.isArray(dialogue) || dialogue.length < 1) return res.status(400).json({ success: false, error: '至少 1 条 dialogue' });
    if (!['cut-to-speaker', 'side-by-side'].includes(layout)) return res.status(400).json({ success: false, error: `不支持的 layout: ${layout}` });
    if (layout === 'side-by-side' && speakers.length !== 2) return res.status(400).json({ success: false, error: 'side-by-side 目前只支持 2 个 speakers' });

    // 解析每个 speaker 的 avatar 图片路径
    const resolvedSpeakers = [];
    for (const s of speakers) {
      if (!s.id || !s.avatar) return res.status(400).json({ success: false, error: `speaker 缺 id/avatar: ${JSON.stringify(s)}` });
      const r = resolveAvatarImage(s.avatar);
      if (r.error) return res.status(400).json({ success: false, error: `speaker ${s.id}: ${r.error}` });
      resolvedSpeakers.push({
        id: s.id,
        name: s.name || s.id,
        imageUrl: r.imageUrl,
        voiceId: s.voiceId || '',
        emotion: s.emotion || 'neutral',
      });
    }

    const { generateMultiSpeakerScene } = require('../services/avatarService');
    const taskId = uuidv4();

    avatarTasks.set(taskId, {
      id: taskId, status: 'processing', created_at: new Date().toISOString(),
      title: title || `多人对话 (${speakers.length} 角色 × ${dialogue.length} 发言)`,
      mode: 'multi-speaker', layout,
      speakers: resolvedSpeakers.map(s => ({ id: s.id, name: s.name })),
      dialogue,
      user_id: req.user?.id, ratio, model,
    });
    res.json({ success: true, taskId });

    const onProgress = (data) => {
      const listeners = avatarSSE.get(taskId) || [];
      listeners.forEach(r => { try { r.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} });
    };

    generateMultiSpeakerScene({
      speakers: resolvedSpeakers,
      dialogue,
      layout,
      background,
      ratio,
      model,
      speed: typeof speed === 'number' ? speed : parseFloat(speed) || 1.0,
      onProgress,
    }).then(result => {
      const videoUrl = `/api/avatar/tasks/${taskId}/stream`;
      const taskData = { ...avatarTasks.get(taskId), status: 'done', videoPath: result.videoPath, videoUrl };
      avatarTasks.set(taskId, taskData);
      try {
        if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
        else db.updateAvatarTask(taskId, { status: 'done', videoPath: result.videoPath, videoUrl });
      } catch (dbErr) { console.warn('[Avatar-multi] DB 写入失败:', dbErr.message); }
      const listeners = avatarSSE.get(taskId) || [];
      listeners.forEach(r => { try { r.write(`data: ${JSON.stringify({ step: 'done', videoUrl })}\n\n`); } catch {} });
    }).catch(err => {
      console.error('[Avatar-multi] 生成失败:', err.message);
      const taskData = { ...avatarTasks.get(taskId), status: 'error', error: err.message };
      avatarTasks.set(taskId, taskData);
      try {
        if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
        else db.updateAvatarTask(taskId, { status: 'error', error: err.message });
      } catch {}
      const listeners = avatarSSE.get(taskId) || [];
      listeners.forEach(r => { try { r.write(`data: ${JSON.stringify({ step: 'error', message: err.message })}\n\n`); } catch {} });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 归属检查辅助：内存任务 or 数据库都要校验 user_id
function resolveOwnedAvatar(req) {
  const id = req.params.id;
  let task = avatarTasks.get(id);
  if (!task) task = db.getAvatarTask(id);
  if (!task) return null;
  const isAdmin = req.user && req.user.role === 'admin';
  if (!isAdmin && task.user_id && req.user && task.user_id !== req.user.id) return null;
  return task;
}

// GET /api/avatar/tasks/:id/progress - SSE 进度
router.get('/tasks/:id/progress', (req, res) => {
  const task = resolveOwnedAvatar(req);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.write(`data: ${JSON.stringify({ step: 'connected' })}\n\n`);
  const list = avatarSSE.get(req.params.id) || [];
  avatarSSE.set(req.params.id, [...list, res]);
  req.on('close', () => {
    const updated = (avatarSSE.get(req.params.id) || []).filter(r => r !== res);
    avatarSSE.set(req.params.id, updated);
  });
  // 如果任务已完成，立即发送结果
  if (task.status === 'done') {
    res.write(`data: ${JSON.stringify({ step: 'done', videoUrl: task.videoUrl })}\n\n`);
  } else if (task.status === 'error') {
    res.write(`data: ${JSON.stringify({ step: 'error', message: task.error })}\n\n`);
  }
});

// GET /api/avatar/tasks/:id/status - REST 轮询任务状态（SSE 断线兜底）
router.get('/tasks/:id/status', (req, res) => {
  const task = resolveOwnedAvatar(req);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json({ status: task.status, videoUrl: task.videoUrl || null, error: task.error || null });
});

// GET /api/avatar/tasks/:id/stream - 流式播放结果视频
router.get('/tasks/:id/stream', (req, res) => {
  const task = resolveOwnedAvatar(req);
  if (!task?.videoPath || !fs.existsSync(task.videoPath)) {
    return res.status(404).json({ error: '视频不存在' });
  }
  const stat = fs.statSync(task.videoPath);
  const range = req.headers.range;
  const etag = `"${stat.mtimeMs}-${stat.size}"`;
  if (range) {
    const [s, e] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(s, 10);
    const end = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4',
      'Cache-Control': 'no-cache', 'ETag': etag
    });
    fs.createReadStream(task.videoPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4', 'Cache-Control': 'no-cache', 'ETag': etag });
    fs.createReadStream(task.videoPath).pipe(res);
  }
});

// GET /api/avatar/tasks/:id/download - 下载结果视频
router.get('/tasks/:id/download', (req, res) => {
  const task = resolveOwnedAvatar(req);
  if (!task?.videoPath || !fs.existsSync(task.videoPath)) {
    return res.status(404).json({ error: '视频不存在' });
  }
  res.download(task.videoPath, `avatar_${req.params.id.slice(0,8)}.mp4`);
});

// GET /api/avatar/tasks - 任务列表（内存 + 数据库合并）
router.get('/tasks', (req, res) => {
  const taskMap = new Map();
  // 先从数据库加载历史记录
  const userId = req.user?.id;
  const dbTasks = db.listAvatarTasks(userId);
  for (const t of dbTasks) {
    taskMap.set(t.id, { id: t.id, status: t.status, text: t.text, created_at: t.created_at, videoUrl: t.videoUrl, ratio: t.ratio, model: t.model });
  }
  // 用内存中的最新状态覆盖
  avatarTasks.forEach(t => {
    if (!req.user || t.user_id === req.user.id || req.user.role === 'admin') {
      taskMap.set(t.id, { id: t.id, status: t.status, text: t.text, created_at: t.created_at, videoUrl: t.videoUrl, ratio: t.ratio, model: t.model });
    }
  });
  const tasks = [...taskMap.values()].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  res.json({ success: true, tasks });
});

// ═══════ 预设图片管理 ═══════

const PRESET_AVATARS = {
  // —— 商务 ——
  'female-1': { name: '商务女性', category: 'business', gender: 'female', prompt: '真人摄影照片，一位25岁左右的年轻漂亮亚洲女性，穿着白色西装外套，淡妆，自信温柔的微笑，柔和的影棚灯光，干净的渐变背景，半身照，超高清皮肤纹理，真实人像摄影，8K写实照片，photorealistic portrait photography, NOT illustration NOT cartoon NOT anime' },
  'male-1':   { name: '商务男性', category: 'business', gender: 'male', prompt: '真人摄影照片，一位28岁左右的英俊亚洲男性，穿着深藏青色修身西装配开领衬衫，迷人微笑，现代发型，柔和灯光，干净背景，半身照，超清晰，8K写实照片，photorealistic portrait photography, NOT illustration NOT cartoon NOT anime' },
  'female-biz-2': { name: '精英女高管', category: 'business', gender: 'female', prompt: '真人摄影照片，单人独照，一位 32 岁中国女性高管，黑色剪裁西装搭配白色内搭，简约金耳钉，利落齐肩短发，知性自信直视镜头，柔和影棚主光，纯色浅灰渐变背景，干净背景无任何环境元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },
  'male-biz-2':   { name: '资深顾问',   category: 'business', gender: 'male',   prompt: '真人摄影照片，单人独照，一位 38 岁中国男性金融顾问，深灰色三件套西装配浅色衬衫和领带，文质彬彬，稳重微笑直视镜头，柔和影棚主光，纯色深灰渐变背景，干净背景无任何环境元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },
  'female-biz-3': { name: '创业女性',   category: 'business', gender: 'female', prompt: '真人摄影照片，单人独照，一位 28 岁亚洲创业女性，浅粉色针织衫外搭米色西装，马尾发型，自然妆容，阳光温暖笑容直视镜头，柔和影棚主光，纯色米白渐变背景，干净背景无任何环境元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },

  // —— 新闻 / 主持 ——
  'female-2': { name: '新闻主播', category: 'news', gender: 'female', prompt: '真人摄影照片，一位25岁左右的美丽中国女性电视新闻主播，专业优雅的外表，淡妆，珍珠耳环，演播室柔和灯光，自信温暖的表情，半身照，超清晰，8K写实照片，photorealistic portrait, NOT illustration NOT anime' },
  'male-news-1': { name: '男主播',   category: 'news', gender: 'male',   prompt: '真人摄影照片，单人独照，一位 35 岁中国男性新闻主播，深蓝色西装白衬衫红领带，庄重表情直视镜头，柔和影棚主光，纯色深蓝渐变背景，干净背景无任何演播室元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },
  'female-news-2': { name: '财经主持', category: 'news', gender: 'female', prompt: '真人摄影照片，单人独照，一位 30 岁亚洲女性财经主持人，红色西装外套配白色内搭，职业气质，长发整齐披肩，亲和自然笑容直视镜头，柔和影棚主光，纯色浅蓝渐变背景，干净背景无任何演播室元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },

  // —— 教育 / 讲师 ——
  'male-2':   { name: '教育讲师', category: 'education', gender: 'male', prompt: '真人摄影照片，一位30岁左右的友善亚洲男性教师，穿着休闲毛衣配衬衫，温暖平易近人的微笑，现代教室背景虚化，半身照，超清晰，8K写实照片，photorealistic portrait, NOT illustration NOT anime' },
  'female-edu-1': { name: '知性女教师', category: 'education', gender: 'female', prompt: '真人摄影照片，单人独照，一位 28 岁亚洲女性大学老师，浅色衬衫配细框眼镜，长发自然垂肩，温柔自信笑容直视镜头，柔和影棚主光，纯色米白渐变背景，干净背景无任何环境元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },
  'male-edu-2':   { name: '理工教授',   category: 'education', gender: 'male',   prompt: '真人摄影照片，单人独照，一位 45 岁亚洲男性大学教授，灰色休闲西装配白衬衫，方框眼镜，稍有白发，睿智表情直视镜头，柔和影棚主光，纯色浅灰渐变背景，干净背景无任何环境元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },

  // —— 医疗 / 健康 ——
  'female-med-1': { name: '女医生', category: 'medical', gender: 'female', prompt: '真人摄影照片，单人独照，一位 30 岁亚洲女性医生，白色医生袍配听诊器，马尾发型，亲切专业微笑直视镜头，柔和影棚主光，纯色浅灰渐变背景，干净背景无任何医院元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },
  'male-med-1':   { name: '男医生', category: 'medical', gender: 'male',   prompt: '真人摄影照片，单人独照，一位 40 岁亚洲男性医生，白大褂配浅蓝色衬衫，短发，沉稳微笑直视镜头，柔和影棚主光，纯色浅灰渐变背景，干净背景无任何医院元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },

  // —— 科技 / 直播 ——
  'male-tech-1': { name: '科技博主', category: 'tech', gender: 'male', prompt: '真人摄影照片，单人独照，一位 27 岁亚洲男性科技 up 主，黑色 T 恤外搭拉链卫衣，短发精神，充满活力的微笑直视镜头，柔和影棚主光，纯色深蓝渐变背景，干净背景无任何环境元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },
  'female-tech-1': { name: '游戏主播', category: 'tech', gender: 'female', prompt: '真人摄影照片，单人独照，一位 23 岁亚洲女性游戏主播，粉色耳机，马尾发型，俏皮活力微笑直视镜头，柔和影棚主光，纯色粉紫渐变背景，干净背景无任何环境元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },

  // —— 生活 / 带货 ——
  'female-life-1': { name: '时尚达人', category: 'lifestyle', gender: 'female', prompt: '真人摄影照片，单人独照，一位 26 岁亚洲女性时尚博主，米色大衣配丝巾，化妆精致，自信直视镜头，柔和影棚主光，纯色米白渐变背景，干净背景无任何环境元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },
  'male-life-1':   { name: '健身教练', category: 'lifestyle', gender: 'male',   prompt: '真人摄影照片，单人独照，一位 30 岁亚洲男性健身教练，黑色紧身运动衫，体形健美，短发短胡，自信微笑直视镜头，柔和影棚主光，纯色深灰渐变背景，干净背景无任何健身房元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },
  'female-life-2': { name: '美食博主', category: 'lifestyle', gender: 'female', prompt: '真人摄影照片，单人独照，一位 25 岁亚洲女性美食博主，浅色围裙配白色内搭，亲切微笑直视镜头，柔和影棚主光，纯色米白渐变背景，干净背景无任何厨房元素，正面半身照一人，8K photorealistic solo portrait, clean studio backdrop, single person only, NOT anime' },

  // —— 儿童 / 长辈 ——
  'child-1': { name: '小男孩', category: 'child', gender: 'male',   prompt: '真人儿童摄影照片，单人独照，一位 8 岁中国亚洲男孩，圆脸阳光，干净短发整齐，浅蓝色纯色圆领 T 恤，天真灿烂露齿笑直视镜头，柔和 45 度影棚主光 + 正面补光，纯色浅蓝到白色渐变无纹理背景，皮肤细节清晰，睫毛可见，瞳孔反光自然，只有一个小孩，干净背景无任何环境元素、无玩具、无道具、无兄弟姐妹，正面半身照一人，真实儿童摄影 DSLR 照片，photorealistic solo child portrait photo, hyperrealistic skin and hair detail, single asian child only, studio portrait, NOT anime NOT illustration NOT cartoon NOT 3D render, ABSOLUTELY NOT a doll' },
  'child-2': { name: '小女孩', category: 'child', gender: 'female', prompt: '真人儿童摄影照片，单人独照，一位 7 岁中国亚洲女孩，圆脸大眼睛睫毛长，整齐双马尾扎粉色发圈，淡粉色纯色纯棉圆领 T 恤（不是连衣裙、不是纱裙），甜美天真微笑轻露牙齿直视镜头，柔和 45 度影棚主光 + 眼神光，纯色浅粉到白色渐变无纹理背景，皮肤细腻红润，瞳孔反光自然，只有一个小孩，干净背景无任何玩具、花朵、动物、兄弟姐妹，正面半身照一人，真实儿童摄影 DSLR 照片，photorealistic solo child portrait photo, hyperrealistic skin and hair detail, single asian child only, studio portrait, NOT anime NOT illustration NOT cartoon NOT 3D render, ABSOLUTELY NOT a doll' },
  'elder-1': { name: '长者爷爷', category: 'elder', gender: 'male',   prompt: '真人老年人摄影照片，单人独照，一位 65 岁中国亚洲男性长者，一头整齐的银白短发，有真实的岁月感面部皱纹和法令纹但精神矍铄，戴细边老花眼镜（可选），浅灰色纯色针织开衫内搭白衬衫，肩膀放松自然坐姿，慈祥温和含蓄微笑直视镜头，柔和 45 度影棚主光凸显皮肤肌理，纯色浅灰到白色渐变无纹理背景，皮肤有真实老年细节（雀斑、毛孔、皱纹、岁月痕迹），眼神有智慧感和温暖感，只有一位老人，干净背景无任何家具、茶杯、书架、家人，正面半身照一人，DSLR 高清真实人像照片 85mm f/2.8，photorealistic senior portrait photograph of ONE elderly asian man, hyperrealistic skin texture with natural aging wrinkles and pores, single person studio portrait, NOT anime NOT illustration NOT cartoon NOT 3D render' },
  'elder-2': { name: '长者奶奶', category: 'elder', gender: 'female', prompt: '真人老年人摄影照片，单人独照，一位 62 岁中国亚洲女性长者，一头短款银灰色卷发打理得干净优雅，有真实岁月感的温和皱纹法令纹眼角纹但不显老态，戴珍珠耳钉，米白色纯色纯棉针织衫（不是花色、不是印花），肩膀放松坐姿自然，温和慈爱含蓄笑容直视镜头，柔和 45 度影棚主光 + 眼神光凸显皮肤肌理，纯色米白到浅粉渐变无纹理背景，皮肤有真实老年细节（雀斑、毛孔、细纹、岁月痕迹），眼神温暖有智慧感，只有一位老人，干净背景无任何家具、茶杯、花瓶、家人，正面半身照一人，DSLR 高清真实人像照片 85mm f/2.8，photorealistic senior portrait photograph of ONE elderly asian woman, hyperrealistic skin texture with natural aging wrinkles pores and laugh lines, single person studio portrait, NOT anime NOT illustration NOT cartoon NOT 3D render' },

  // —— 外国 ——
  'western-1': { name: '欧美男性',  category: 'western', gender: 'male',   prompt: 'Hyperrealistic DSLR portrait photograph of ONE single caucasian european male executive age 32, well-groomed short brown hair with slight natural wave, clean-shaven defined jawline, deep navy single-breasted wool suit with crisp white dress shirt and subtle burgundy silk tie, calm confident charming smile showing natural teeth, looking directly into lens, soft 45-degree studio key light with rim light and eye catchlight, plain gradient medium-gray paper backdrop, hyperrealistic skin texture with visible pores and subtle stubble shadow, sharp iris detail with natural catchlights, 85mm f/2 lens bokeh, half-body frontal centered composition, ONLY ONE PERSON in frame, clean background with zero environmental props, studio portrait photography, 8K ultra-realistic raw photo. NEGATIVE: multiple people, cartoon, anime, illustration, 3D render, painting, CGI, video game character, stylized, uncanny valley, waxy skin, plastic doll, digital art' },
  'western-2': { name: '欧美女性',  category: 'western', gender: 'female', prompt: 'Hyperrealistic DSLR portrait photograph of ONE single caucasian european female professional age 28, soft natural blonde shoulder-length wavy hair with subtle highlights, porcelain skin with visible natural pores, cream-colored silk blouse with delicate pearl earrings, gentle warm smile showing a hint of natural teeth, looking directly into lens, soft 45-degree studio key light with rim light and eye catchlight, plain gradient beige paper backdrop, hyperrealistic skin texture with visible pores and tiny imperfections, sharp iris detail with natural catchlights, 85mm f/2 lens bokeh, half-body frontal centered composition, ONLY ONE PERSON in frame, clean background with zero environmental props, studio portrait photography, 8K ultra-realistic raw photo. NEGATIVE: multiple people, cartoon, anime, illustration, 3D render, painting, CGI, video game character, stylized, uncanny valley, waxy skin, plastic doll, digital art' },
  'africa-1':  { name: '非裔女性',  category: 'western', gender: 'female', prompt: 'Hyperrealistic DSLR portrait photograph of ONE single african black female journalist age 28, rich dark brown skin with beautiful natural melanin glow, natural afro-textured curly hair styled neat and voluminous, small gold hoop earrings, solid warm terracotta colored blouse with subtle texture, confident warm genuine smile showing natural teeth, looking directly into lens, soft 45-degree studio key light with strong rim light highlighting skin texture and eye catchlight, plain gradient warm cream paper backdrop, hyperrealistic skin texture with visible pores and natural sheen, sharp iris detail with natural catchlights, 85mm f/2 lens bokeh, half-body frontal centered composition, ONLY ONE PERSON in frame, clean background with zero environmental props, studio portrait photography, 8K ultra-realistic raw photo. NEGATIVE: multiple people, cartoon, anime, illustration, 3D render, painting, CGI, video game character, stylized, uncanny valley, waxy skin, plastic doll, bleached skin, lightened skin tone' },
  'india-1':   { name: '印度男性',  category: 'western', gender: 'male',   prompt: 'Hyperrealistic DSLR portrait photograph of ONE single indian south-asian male software engineer age 32, warm brown skin tone, neat short black hair with natural texture, well-groomed short black beard with defined jawline, dark chestnut brown eyes with natural catchlights, charcoal gray casual collared shirt with subtle fabric texture, confident intelligent friendly smile showing natural teeth, looking directly into lens, soft 45-degree studio key light with rim light and eye catchlight, plain gradient deep blue paper backdrop, hyperrealistic skin texture with visible pores and subtle beard shadow, sharp iris detail with natural catchlights, 85mm f/2 lens bokeh, half-body frontal centered composition, ONLY ONE PERSON in frame, clean background with zero environmental props, studio portrait photography, 8K ultra-realistic raw photo. NEGATIVE: multiple people, cartoon, anime, illustration, 3D render, painting, CGI, video game character, stylized, uncanny valley, waxy skin, plastic doll, bollywood poster, overly smooth skin' },

  // —— 动漫 / 虚拟 ——
  'anime-1':  { name: '动漫少女',  category: 'anime', gender: 'female', prompt: 'Beautiful anime solo character portrait, one single young girl with flowing pastel gradient hair, large sparkling crystal eyes, delicate facial features, wearing futuristic outfit, soft glowing particles, clean gradient pastel backdrop, no crowd no multi-character, digital anime illustration, Makoto Shinkai style lighting, upper body, single character only, 4K' },
  'anime-2':  { name: '动漫少年',  category: 'anime', gender: 'male',   prompt: 'Anime solo boy portrait, one single 17 yo boy, spiky black hair, determined eyes, modern school uniform with cyber accents, clean gradient blue backdrop, no crowd no multi-character, vibrant anime illustration, Makoto Shinkai style, single character only, 4K' },
  'anime-3':  { name: '国风女侠',  category: 'anime', gender: 'female', prompt: 'Chinese ink painting anime solo portrait, one single young wuxia heroine, long black hair with hairpin, cyan silk hanfu, elegant expression, clean gradient ink-wash backdrop, no crowd no multi-character, classical Chinese ink style, single character only, 4K' },
  'vtuber-1': { name: 'VTuber少女', category: 'anime', gender: 'female', prompt: 'VTuber anime solo portrait, one single cute girl with twin pink ponytails, cat ears headband, sparkly blue eyes, school uniform, energetic smile, clean gradient pastel backdrop with subtle stars, no crowd no multi-character, single character only, 4K' },
};

const BG_NEGATIVE = '，绝对不要出现任何人物、人像、角色、动物，只画纯环境背景，空旷无人';
const PRESET_BACKGROUNDS = {
  'office':    { name: '办公室', prompt: '写实摄影风格，现代豪华办公室内景，落地玻璃窗外是城市夜景全景，温暖氛围灯光，极简白色办公桌配显示器，绿植盆栽，空旷无人的房间' + BG_NEGATIVE + '，8K超清照片' },
  'studio':    { name: '演播室', prompt: '写实摄影风格，专业现代电视演播室，深蓝色和青色霓虹灯带，弧形LED屏幕墙，流线型主播台，体积光束，空旷无人的演播室' + BG_NEGATIVE + '，8K超清照片' },
  'classroom': { name: '教室', prompt: '写实摄影风格，现代智慧教室内景，大型交互式数字白板，整齐排列的木桌，温暖阳光透过高窗洒入，书架，明亮温馨，空旷无人的教室' + BG_NEGATIVE + '，8K超清照片' },
  'outdoor':   { name: '户外', prompt: '写实摄影风格，美丽的城市公园户外场景，绿树成荫的小径，湖边长椅，温暖的黄金时刻阳光，虚化背景，宁静祥和的氛围，空旷无人的风景' + BG_NEGATIVE + '，8K超清照片' }
};

// GET /api/avatar/presets - 获取预设图片列表（含分类/性别元数据）
router.get('/presets', (req, res) => {
  const avatars = {};
  const avatarMeta = {};
  const backgrounds = {};
  for (const [key, preset] of Object.entries(PRESET_AVATARS)) {
    const files = fs.readdirSync(presetsDir).filter(f => f.startsWith(`avatar_${key}.`));
    avatars[key] = files.length > 0 ? `/api/avatar/preset-img/${files[0]}` : null;
    avatarMeta[key] = {
      name: preset.name,
      category: preset.category || 'general',
      gender: preset.gender || 'neutral',
    };
  }
  for (const [key, preset] of Object.entries(PRESET_BACKGROUNDS)) {
    const files = fs.readdirSync(presetsDir).filter(f => f.startsWith(`bg_${key}.`));
    backgrounds[key] = files.length > 0 ? `/api/avatar/preset-img/${files[0]}` : null;
  }
  // 分类标签（供前端分组显示）
  const categories = [
    { id: 'business',  name: '商务' },
    { id: 'news',      name: '新闻/主持' },
    { id: 'education', name: '教育' },
    { id: 'medical',   name: '医疗' },
    { id: 'tech',      name: '科技/直播' },
    { id: 'lifestyle', name: '生活/带货' },
    { id: 'child',     name: '儿童' },
    { id: 'elder',     name: '长辈' },
    { id: 'western',   name: '外国' },
    { id: 'anime',     name: '动漫/虚拟' },
  ];
  res.json({ success: true, avatars, avatarMeta, backgrounds, categories });
});

// GET /api/avatar/preset-img/:filename - 提供预设图片
router.get('/preset-img/:filename', (req, res) => {
  const filePath = path.join(presetsDir, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  // 检测实际文件格式（扩展名可能不匹配实际格式）
  try {
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    // JPEG magic bytes: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
      res.type('image/jpeg');
    } else if (buf[0] === 0x89 && buf[1] === 0x50) {
      res.type('image/png');
    }
  } catch {}
  res.sendFile(filePath);
});

// ═══════════════════════════════════════════════
// 自定义用户素材（AI 生成的单独人物/背景，持久化为独立卡片）
// ═══════════════════════════════════════════════
const customMetaFile = path.join(__dirname, '../../outputs/presets/_custom_meta.json');
function loadCustomMeta() {
  try {
    if (fs.existsSync(customMetaFile)) return JSON.parse(fs.readFileSync(customMetaFile, 'utf-8'));
  } catch {}
  return { avatars: [], backgrounds: [] };
}
function saveCustomMeta(m) {
  try { fs.writeFileSync(customMetaFile, JSON.stringify(m, null, 2)); } catch (e) { console.warn('[custom-meta] 保存失败:', e.message); }
}

// 选择图像模型（公共）
function _pickImageModel() {
  const { getApiKey } = require('../services/settingsService');
  const settings = require('../services/settingsService').loadSettings();
  const preferOrder = ['mxapi', 'jimeng', 'zhipu', 'openai', 'stability', 'replicate'];
  for (const pid of preferOrder) {
    const p = (settings.providers || []).find(p => p.id === pid || p.preset === pid);
    if (!p) continue;
    const m = (p.models || []).find(m => m.use === 'image' && m.enabled !== false);
    if (m && getApiKey(p.id)) return { provider: p, model: m.id, apiKey: getApiKey(p.id) };
  }
  for (const p of (settings.providers || [])) {
    const m = (p.models || []).find(m => m.use === 'image' && m.enabled !== false);
    if (m) { const k = getApiKey(p.id); if (k) return { provider: p, model: m.id, apiKey: k }; }
  }
  return null;
}

// ═══════════════════════════════════════════════
// 头像/背景专用生成器（强约束，避免动漫化 + 多人物/无人背景带人）
// ═══════════════════════════════════════════════

// 为 avatar 增强 prompt — 强制单人、写实、无动漫、**禁止三视图/多视图布局**
function _enhanceAvatarPrompt(desc) {
  return `ONE SINGLE PERSON SOLO in a single frame, photorealistic portrait photograph of exactly one person, ${desc}, professional studio photography, shallow depth of field, DSLR photo, 8K ultra realistic skin texture, cinematic lighting, half-body shot, only one person in the frame, face centered, no split screen, no triptych, single viewpoint, 真人摄影写实人像照片，单人单视角.
NEGATIVE STRONG: illustration, cartoon, anime, manga, 3D render, painting, drawing, multiple people, group photo, two people, three people, four people, crowd, character sheet, model sheet, multi-view, three-view, triptych, split screen, front/side/back views, multiple angles, variant poses, turnaround, reference sheet, 多人, 群体, 三视图, 多视图, 角色设定, 正面侧面背面, 分屏, 多角度, 拼图`;
}

// 为 bg 增强 prompt — 强制无人、写实风景（LLM 也会读懂"empty"在最前面的强暗示）
function _enhanceBackgroundPrompt(desc) {
  // 先清洗掉用户描述里隐含"人"的词
  const cleaned = (desc || '')
    .replace(/(人员|员工|职员|工作人员|顾客|客户|学生|老师|孩子|医生|护士|主播|观众|人群|角色|行人)/g, '')
    .replace(/(working|people|person|character|worker|employee|student|customer)/gi, '');
  return `EMPTY UNOCCUPIED INTERIOR / LANDSCAPE PHOTOGRAPH — architectural real estate photography style — ZERO PEOPLE ZERO CHARACTERS — completely vacant space — ${cleaned}. Shot with professional DSLR on a tripod in an empty room with nobody present, clean composition, no human silhouettes in windows or reflections, no mannequins, no portraits on walls, no humanoid figures anywhere. Architectural interior magazine quality, Architectural Digest style, empty showroom photography, 8K ultra realistic, photojournalism of a scene without any living beings.
空无一人的纯建筑/景观摄影：画面中严禁出现任何人类、人像、卡通角色、动漫人物、剪影、轮廓、面孔、身体、动物、生物。只拍摄空旷无人的建筑内部或户外环境，像样板间/建筑摄影杂志风格.
NEGATIVE (STRONG): person, people, human, humans, man, woman, child, character, figure, silhouette, face, body, animal, creature, cartoon, anime, manga, illustration, drawing, painting, 3D render of characters, multiple people, crowd, employee, worker, staff, student, customer, 人物, 人像, 角色, 人影, 动漫, 插画, 卡通, 多人, 群体, 员工, 工作人员`;
}

// 数字人专用：强制只用写实/3D 拟真模型；显式黑名单动漫/低品质模型
const AVATAR_REALISTIC_MODELS = {
  // Jimeng: 优先 V4.0 写实通用（高美学版），其次 V3.0 真实风，最后 V4.0 文生图
  jimeng: ['jimeng_high_aes_general_v40', 'jimeng_t2i_v40', 'jimeng_high_aes_general_v30', 'jimeng_t2i_v30', 'jimeng_high_aes_general_v21', 'jimeng_high_aes_general_v20'],
  // MXAPI: Gemini 3 Pro 最拟真，再 draw-4-5（豆包 Seedream）
  mxapi: ['mxapi-gemini3pro', 'mxapi-draw-4-5', 'mxapi-seedream', 'mxapi-draw-pro'],
  // OpenAI: DALL-E 3
  openai: ['dall-e-3', 'gpt-image-1'],
  // Zhipu: 只有 cogview 系列，cogview-4 还算真实，cogview-3-flash 品质太差（禁用）
  zhipu: ['cogview-4', 'cogview-4-250304'],
};
const AVATAR_MODEL_BLACKLIST = [
  'cogview-3-flash', // 智谱 flash 免费模型品质极差，经常出卡通
  'jimeng_high_aes_anime_v10', // 即梦动漫风（明确排除）
  'jimeng_i2i_v30', // i2i 模型不适合 t2i 场景
];

// 即梦 V3+ 异步接口直连，显式锁定写实模型 + 独立 negative_prompt
async function _generateJimengDirect({ reqKey, prompt, negativePrompt, aspectRatio, outputPath, apiKey, seed = -1 }) {
  if (!apiKey.includes(':')) throw new Error('Jimeng key 格式错误，应为 AccessKeyId:SecretAccessKey');
  const [ak, sk] = apiKey.split(':');
  const crypto = require('crypto');
  const https = require('https');
  const axios = require('axios');

  function _jimengSign(method, path, query, body) {
    // 火山引擎签名 — 简化用 imageService 的私有 helper
    // 这里直接借道：调用 imageService 暴露的 generateJimengImage 但用 settings override 技巧
    return null;
  }

  // 直接复用 imageService 的 generateJimengImage（它会自己从 settings 读 model）
  // 为锁定模型，临时写一个 settings override
  const { loadSettings, saveSettings } = require('../services/settingsService');
  const snapshot = loadSettings();
  // 深拷贝 + 临时把 jimeng 所有 image 模型置 disabled，只留目标 reqKey 一个
  const temp = JSON.parse(JSON.stringify(snapshot));
  const jp = (temp.providers || []).find(p => p.id === 'jimeng' || p.preset === 'jimeng');
  if (jp) {
    jp.models = (jp.models || []).map(m => {
      if (m.use === 'image') return { ...m, enabled: m.id === reqKey };
      return m;
    });
  }
  // 不写文件，直接内存 require 缓存 — 但 imageService 每次都 loadSettings → 会读文件
  // → 这里还是要临时写文件 + 写完恢复，或者更优雅：绕过走原生调用

  // ——— 最可靠：原生调用 jimeng API + 显式 req_key ———
  const { generateJimengImage } = require('../services/imageService');

  // 拦截法不优雅；改用更直接的方式：复制 generateJimengImage 核心逻辑但用 reqKey 参数
  const ratioMap = {
    '9:16': [768, 1344], '16:9': [1344, 768], '1:1': [1024, 1024],
    '4:3':  [1216, 912], '3:4': [912, 1216],
  };
  const [imgW, imgH] = ratioMap[aspectRatio] || [1024, 1024];

  const submitBody = JSON.stringify({
    req_key: reqKey,
    prompt: prompt.substring(0, 800),
    negative_prompt: negativePrompt || '',
    seed: typeof seed === 'number' ? seed : -1,
    width: imgW, height: imgH,
    use_pre_llm: true,
    return_url: true,
    req_json: JSON.stringify({ logo_info: { add_logo: false } }),
  });

  // 火山引擎 signing v4
  const region = 'cn-north-1', service = 'cv';
  const hostname = 'visual.volcengineapi.com';
  const action = 'CVSync2AsyncSubmitTask';
  const version = '2022-08-31';

  function sign(method, body, query) {
    const now = new Date();
    const shortDate = now.toISOString().substring(0, 10).replace(/-/g, '');
    const dateStamp = now.toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
    const canonicalUri = '/';
    const canonicalQuery = Object.entries(query).sort().map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const hashedPayload = crypto.createHash('sha256').update(body || '').digest('hex');
    const canonicalHeaders = `content-type:application/json\nhost:${hostname}\nx-content-sha256:${hashedPayload}\nx-date:${dateStamp}\n`;
    const signedHeaders = 'content-type;host;x-content-sha256;x-date';
    const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
    const scope = `${shortDate}/${region}/${service}/request`;
    const stringToSign = `HMAC-SHA256\n${dateStamp}\n${scope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;
    const kDate = crypto.createHmac('sha256', sk).update(shortDate).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const authorization = `HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { 'Content-Type': 'application/json', 'X-Date': dateStamp, 'X-Content-Sha256': hashedPayload, 'Authorization': authorization };
  }

  async function call(action, body) {
    const query = { Action: action, Version: version };
    const headers = sign('POST', body, query);
    const url = `https://${hostname}/?Action=${action}&Version=${version}`;
    const res = await axios.post(url, body, { headers, timeout: 60000 });
    return res.data;
  }

  const submitRes = await call(action, submitBody);
  const taskId = submitRes?.Result?.task_id || submitRes?.data?.task_id;
  if (!taskId) throw new Error('Jimeng 提交失败: ' + JSON.stringify(submitRes).slice(0, 300));

  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const statusBody = JSON.stringify({
      req_key: reqKey, task_id: taskId, req_json: JSON.stringify({ return_url: true }),
    });
    const statusRes = await call('CVSync2AsyncGetResult', statusBody);
    const status = statusRes?.Result?.status || statusRes?.data?.status;
    if (status === 'done') {
      const urls = statusRes?.Result?.image_urls || statusRes?.data?.image_urls || [];
      if (!urls.length) throw new Error('Jimeng 无返回图片');
      const dl = await axios.get(urls[0], { responseType: 'arraybuffer', timeout: 60000 });
      fs.writeFileSync(outputPath, Buffer.from(dl.data));
      return true;
    }
    if (status === 'failed' || status === 'not_found') throw new Error('Jimeng 任务失败: ' + (statusRes?.Result?.reason || 'unknown'));
  }
  throw new Error('Jimeng 轮询超时');
}

// 尝试多个 provider 直接生成（不走 generateDramaImage 的"分镜"路径）
async function _directGenerateImage({ prompt, negativePrompt, filename, aspectRatio, type, seed }) {
  const { getApiKey } = require('../services/settingsService');
  const settings = require('../services/settingsService').loadSettings();
  const axios = require('axios');

  // 真实风优先顺序 — 2026-04-19 调整：即梦（中文 prompt 理解最好）放第一
  //   avatar: jimeng/mxapi/openai/zhipu/stability/replicate
  //   background: 背景沿用老顺序
  const realisticOrder = type === 'background'
    ? ['jimeng', 'mxapi', 'openai', 'stability', 'replicate']
    : ['jimeng', 'mxapi', 'openai', 'zhipu', 'stability', 'replicate'];

  const outDir = path.resolve(process.env.OUTPUT_DIR || './outputs');
  const charsDir = path.join(outDir, 'characters');
  const scenesDir = path.join(outDir, 'scenes');
  fs.mkdirSync(charsDir, { recursive: true });
  fs.mkdirSync(scenesDir, { recursive: true });
  const destDir = type === 'avatar' ? charsDir : scenesDir;
  const outPath = path.join(destDir, `${filename}.png`);

  const errors = [];

  for (const pid of realisticOrder) {
    const p = (settings.providers || []).find(x => (x.id === pid || x.preset === pid) && x.enabled);
    if (!p) continue;
    // 选真实风模型：优先列表里排前、且未入黑名单
    const preferred = AVATAR_REALISTIC_MODELS[pid] || [];
    const modelsAvailable = (p.models || []).filter(m => m.use === 'image' && m.enabled !== false && !AVATAR_MODEL_BLACKLIST.includes(m.id));
    if (!modelsAvailable.length) {
      console.log(`[avatar/direct-image] ${pid} 无可用写实模型（已过滤黑名单）`);
      continue;
    }
    // 按偏好排序
    const m = preferred.map(id => modelsAvailable.find(mm => mm.id === id)).find(Boolean) || modelsAvailable[0];
    const apiKey = getApiKey(pid);
    if (!apiKey) continue;
    console.log(`[avatar/direct-image] 尝试 ${pid} / ${m.id}（${type === 'avatar' ? '拟真人像' : '空景背景'}）`);

    try {
      if (pid === 'jimeng') {
        // 即梦：显式传入指定的写实模型 id + 独立 negative_prompt + 固定 seed（保证同 key 每次出一样的图）
        const result = await _generateJimengDirect({
          reqKey: m.id, // 显式锁定写实模型
          prompt, negativePrompt, aspectRatio, outputPath: outPath, apiKey,
          seed: typeof seed === 'number' ? seed : -1,
        });
        if (result) return { filePath: outPath, provider: 'jimeng', model: m.id };
      } else if (pid === 'mxapi') {
        // MXAPI：优先 gemini3pro（真实感最好），然后 draw-4-5
        const baseUrl = 'https://open.mxapi.org/api/v2';
        const headers = { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' };
        const sizeMap = { '16:9': '1792x1024', '9:16': '1024x1792', '1:1': '1024x1024' };
        const imageSize = sizeMap[aspectRatio] || '1024x1024';
        const modelId = m.id || 'mxapi-draw';
        let url;
        if (modelId.includes('gemini3')) {
          const res = await axios.post(`${baseUrl}/images/gemini3pro`, {
            prompt, image_size: imageSize, aspect_ratio: aspectRatio,
          }, { headers, timeout: 180000 });
          url = res.data?.data?.url || res.data?.url || res.data?.data?.[0]?.url;
        } else {
          const endpoint = modelId.includes('4-5') ? '/draw-4-5' : modelId.includes('pro') ? '/draw-pro' : '/draw';
          const res = await axios.post(`${baseUrl}${endpoint}`, {
            messages: [{ role: 'user', content: prompt }], stream: false,
          }, { headers, timeout: 120000 });
          const data = res.data?.data || res.data;
          url = data?.url || data?.image_url;
          if (!url && data?.choices?.[0]?.message?.content) {
            const match = data.choices[0].message.content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
            if (match) url = match[1];
          }
        }
        if (!url) throw new Error('MXAPI 未返回图片 URL');
        const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
        fs.writeFileSync(outPath, Buffer.from(resp.data));
        return { filePath: outPath, provider: 'mxapi', model: m.id };
      } else if (pid === 'openai' || pid === 'zhipu') {
        // OpenAI DALL-E 3 / 智谱 CogView-4 — 走 openai SDK 兼容
        const OpenAI = require('openai');
        const client = new OpenAI({ apiKey, baseURL: p.api_url || (pid === 'zhipu' ? 'https://open.bigmodel.cn/api/paas/v4' : undefined) });
        const sizeMap = { '16:9': '1792x1024', '9:16': '1024x1792', '1:1': '1024x1024' };
        const size = sizeMap[aspectRatio] || '1024x1024';
        const r = await client.images.generate({ model: m.id, prompt, n: 1, size });
        const imgData = r.data?.[0];
        if (imgData?.url) {
          const dl = await axios.get(imgData.url, { responseType: 'arraybuffer', timeout: 60000 });
          fs.writeFileSync(outPath, Buffer.from(dl.data));
          return { filePath: outPath, provider: pid, model: m.id };
        } else if (imgData?.b64_json) {
          fs.writeFileSync(outPath, Buffer.from(imgData.b64_json, 'base64'));
          return { filePath: outPath, provider: pid, model: m.id };
        }
        throw new Error(`${pid} 未返回图片`);
      }
      // 其他 provider 先跳过，交给 generateDramaImage
    } catch (err) {
      errors.push(`${pid}: ${err.message?.slice(0, 100)}`);
      console.warn(`[avatar/direct-image] ${pid} 失败: ${err.message?.slice(0, 100)}`);
    }
  }

  // 所有直连都失败 → 回退到 generateDramaImage
  try {
    const { generateDramaImage } = require('../services/imageService');
    const result = await generateDramaImage({ prompt, filename, aspectRatio, resolution: '2K', image_model: 'auto' });
    if (result?.filePath && fs.existsSync(result.filePath)) {
      fs.copyFileSync(result.filePath, outPath);
      return { filePath: outPath, provider: result.provider_used || 'drama' };
    }
  } catch (e) {
    errors.push(`drama-fallback: ${e.message?.slice(0, 100)}`);
  }

  throw new Error('全部 provider 失败: ' + errors.join(' | '));
}

// POST /api/avatar/generate-custom — AI 生成单张自定义头像或背景
// body: { type: 'avatar'|'background', name: '...', description: '...' }
router.post('/generate-custom', async (req, res) => {
  try {
    const { type, name, description } = req.body;
    if (!['avatar', 'background'].includes(type)) return res.status(400).json({ success: false, error: 'type 必须是 avatar 或 background' });
    if (!description || !description.trim()) return res.status(400).json({ success: false, error: '描述不能为空' });

    // 构建强约束 prompt（写实 + 单人/无人）+ 独立 negative_prompt
    const fullPrompt = type === 'avatar' ? _enhanceAvatarPrompt(description.trim()) : _enhanceBackgroundPrompt(description.trim());
    const negativePrompt = type === 'avatar'
      ? 'multiple people, two people, three people, group photo, crowd, anime, cartoon, illustration, painting, 3D render, low quality, blurry, 多人, 群体, 动漫, 卡通, 插画'
      : 'person, people, human, character, figure, face, body, silhouette, anime, cartoon, illustration, drawing, 人物, 人像, 角色, 动漫, 插画';

    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const aspectRatio = type === 'avatar' ? '1:1' : '16:9';

    let result;
    try {
      result = await _directGenerateImage({
        prompt: fullPrompt,
        negativePrompt,
        filename: `avatar_custom_${id}`,
        aspectRatio,
        type,
      });
    } catch (imgErr) {
      console.error('[generate-custom] 所有 provider 失败:', imgErr.message);
      return res.status(500).json({ success: false, error: imgErr.message });
    }

    if (!result?.filePath || !fs.existsSync(result.filePath)) {
      return res.status(500).json({ success: false, error: '图片未保存到磁盘' });
    }

    // 复制到 presetsDir 并规范命名
    const prefix = type === 'avatar' ? 'avatar' : 'bg';
    const destPath = path.join(presetsDir, `${prefix}_${id}.png`);
    try {
      fs.copyFileSync(result.filePath, destPath);
    } catch (copyErr) {
      console.warn('[generate-custom] 复制失败，尝试读写：', copyErr.message);
      fs.writeFileSync(destPath, fs.readFileSync(result.filePath));
    }

    // 元数据入库
    const meta = loadCustomMeta();
    const item = {
      id,
      type,
      name: (name || description.slice(0, 12)).trim(),
      description: description.trim(),
      prompt: fullPrompt,
      negativePrompt,
      imgPath: `/api/avatar/preset-img/${path.basename(destPath)}`,
      user_id: req.user?.id || null,
      created_at: new Date().toISOString(),
      provider: result.provider || result.provider_used || 'unknown',
      model: result.model || null,
    };
    (type === 'avatar' ? meta.avatars : meta.backgrounds).push(item);
    saveCustomMeta(meta);

    res.json({ success: true, item });
  } catch (err) {
    console.error('[generate-custom] 失败:', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/avatar/custom-items — 列出所有自定义素材（全局共享；上线可加 user_id 过滤）
router.get('/custom-items', (req, res) => {
  const meta = loadCustomMeta();
  // 按 user_id 过滤（若登录）+ 只返回文件仍存在的
  const isAdmin = req.user?.role === 'admin';
  const uid = req.user?.id || null;
  const filter = arr => arr.filter(it => {
    if (!isAdmin && it.user_id && uid && it.user_id !== uid) return false;
    const fname = path.basename(it.imgPath);
    return fs.existsSync(path.join(presetsDir, fname));
  });
  res.json({ success: true, avatars: filter(meta.avatars || []), backgrounds: filter(meta.backgrounds || []) });
});

// DELETE /api/avatar/custom-items/:id — 删除自定义素材
router.delete('/custom-items/:id', (req, res) => {
  const meta = loadCustomMeta();
  let removed = null;
  for (const key of ['avatars', 'backgrounds']) {
    const idx = (meta[key] || []).findIndex(it => it.id === req.params.id);
    if (idx >= 0) {
      const isAdmin = req.user?.role === 'admin';
      const it = meta[key][idx];
      if (!isAdmin && it.user_id && req.user && it.user_id !== req.user.id) return res.status(403).json({ success: false, error: '无权限删除' });
      removed = meta[key].splice(idx, 1)[0];
      try { fs.unlinkSync(path.join(presetsDir, path.basename(removed.imgPath))); } catch {}
      break;
    }
  }
  saveCustomMeta(meta);
  res.json({ success: !!removed, removed });
});

// POST /api/avatar/generate-presets - 批量生成预设图片（走 imageService 多 provider 回退链）
router.post('/generate-presets', async (req, res) => {
  const { type, keys } = req.body; // type: 'avatar'|'background'|'all'

  // 验证至少有一个 provider 配了 image 模型（用 _pickImageModel 只是探测）
  if (!_pickImageModel()) {
    return res.status(400).json({ success: false, error: '未配置图像生成模型，请在 AI 配置中启用 use=image 的模型（jimeng/mxapi/zhipu/openai 等）' });
  }

  const results = { avatars: {}, backgrounds: {} };
  const errors = [];

  // 生成头像
  const doAvatars = type === 'avatar' || type === 'all' || !type;
  const doBgs = type === 'background' || type === 'all' || !type;

  // 统一走强约束的 _directGenerateImage（写实风 + negative_prompt）
  async function generateOne(prefix, key, basePrompt, size) {
    const aspectRatio = /^1792x/.test(size) ? '16:9' : /x1792$/.test(size) ? '9:16' : '1:1';
    const type = prefix === 'avatar' ? 'avatar' : 'background';
    // 即使 basePrompt 已经写得比较细，再包一层强约束（负面词 + solo/empty 关键词）
    const fullPrompt = type === 'avatar' ? _enhanceAvatarPrompt(basePrompt) : _enhanceBackgroundPrompt(basePrompt);
    const negativePrompt = type === 'avatar'
      ? 'multiple people, group photo, anime, cartoon, illustration, different person, wrong age, wrong gender, wrong ethnicity, 多人, 动漫, 插画, 不同人, 换脸'
      : 'person, people, human, character, figure, anime, cartoon, 人物, 动漫';
    // 按 key 名字做固定 seed，让同一 key 每次生成同一张图（可复现）
    const crypto = require('crypto');
    const seedHash = parseInt(crypto.createHash('md5').update(`${prefix}_${key}`).digest('hex').slice(0, 8), 16);
    const seed = type === 'avatar' ? (seedHash % 2147483647) : -1;
    try {
      const result = await _directGenerateImage({
        prompt: fullPrompt,
        negativePrompt,
        filename: `${prefix}_${key}_src`,
        aspectRatio,
        type,
        seed,
      });
      if (!result?.filePath || !fs.existsSync(result.filePath)) throw new Error('图片未保存');
      const destPath = path.join(presetsDir, `${prefix}_${key}.png`);
      fs.copyFileSync(result.filePath, destPath);
      return `/api/avatar/preset-img/${path.basename(destPath)}`;
    } catch (err) {
      errors.push({ key, error: err.message });
      return null;
    }
  }

  if (doAvatars) {
    const avatarKeys = keys?.length ? keys.filter(k => PRESET_AVATARS[k]) : Object.keys(PRESET_AVATARS);
    for (const key of avatarKeys) {
      const url = await generateOne('avatar', key, PRESET_AVATARS[key].prompt, '1024x1024');
      if (url) results.avatars[key] = url;
    }
  }

  if (doBgs) {
    // 注意：customPrompt 不再在这里用（会覆盖所有预设）→ 改用 /generate-custom 新建单独卡片
    const bgKeys = keys?.length ? keys.filter(k => PRESET_BACKGROUNDS[k]) : Object.keys(PRESET_BACKGROUNDS);
    for (const key of bgKeys) {
      const basePrompt = PRESET_BACKGROUNDS[key]?.prompt || '';
      const url = await generateOne('bg', key, basePrompt, '1792x1024');
      if (url) results.backgrounds[key] = url;
    }
  }

  res.json({ success: true, results, errors });
});

// POST /api/avatar/generate-text - AI 生成台词
router.post('/generate-text', async (req, res) => {
  try {
    const { avatar_name = '数字人', bg_name = '办公室', draft = '', template = '' } = req.body;
    const { callLLM } = require('../services/storyService');

    const systemPrompt = '你是一个专业的短视频台词撰写人。直接输出完整的纯台词文本，不要加角色名、括号注释、舞台指示、序号或任何格式标记。确保台词完整，不要中途截断。';

    // 模板化 prompt
    const templatePrompts = {
      promo: `请为"${avatar_name}"角色生成一段产品推广口播台词。要求：
- 字数：300-500字
- 结构：痛点引入（制造共鸣）→ 产品亮点（3个核心卖点）→ 使用场景 → 行动号召
- 风格：口语化、有感染力，像抖音/视频号爆款文案
- 要有"钩子"开场，例如"你是不是也遇到过这种情况？"`,
      knowledge: `请为"${avatar_name}"角色生成一段知识分享口播台词。要求：
- 字数：300-500字
- 结构：引发好奇的问题 → 核心知识点（1-3个）→ 实用建议 → 总结升华
- 风格：专业但不枯燥，有干货，像一位亲切的老师在讲课`,
      news: `请为"${avatar_name}"角色生成一段新闻播报口播台词。要求：
- 字数：200-400字
- 结构：新闻导入 → 事件描述 → 背景分析 → 观点总结
- 风格：正式但不生硬，有权威感，节奏明快`,
      story: `请为"${avatar_name}"角色生成一段故事叙述口播台词。要求：
- 字数：300-600字
- 结构：悬念开场 → 人物登场 → 情节发展 → 高潮反转 → 结尾感悟
- 风格：生动有画面感，善用对话和细节描写，像在讲一个引人入胜的故事`,
      tutorial: `请为"${avatar_name}"角色生成一段教程讲解口播台词。要求：
- 字数：300-500字
- 结构：问题场景 → 步骤讲解（3-5步）→ 注意事项 → 效果预期
- 风格：清晰简洁、步骤分明，像手把手教学`
    };

    let userPrompt;
    if (draft) {
      userPrompt = `请基于以下草稿，将其调整成适合「${bg_name}」场景的数字人口播台词（200-500字，自然口语化，场景氛围要跟「${bg_name}」匹配，保留原意但场景元素可替换。必须有完整的结尾，不要中途截断）：\n\n${draft}`;
    } else if (template && templatePrompts[template]) {
      userPrompt = templatePrompts[template] + `\n\n场景背景：${bg_name}（台词里要有跟「${bg_name}」氛围匹配的细节）`;
    } else {
      userPrompt = `请为"${avatar_name}"角色生成一段在"${bg_name}"场景中的口播台词。要求：\n- 字数：200-400字\n- 风格：自然口语化，像真人在说话\n- 结构：有吸引力的开场 → 充实的内容 → 完整的结尾\n- 场景细节要符合「${bg_name}」氛围\n- 必须输出完整台词，不要中途截断`;
    }

    // 注入数字人 KB（结合话术、口播、带货、角色资产）
    const kbQuery = [avatar_name, bg_name, template, draft].filter(Boolean).join(' ');
    const result = await callLLM(systemPrompt, userPrompt, { kb: { scene: 'digital_human', query: kbQuery, limit: 4 } });
    res.json({ success: true, text: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/avatar/segment-script - AI 智能分段
router.post('/segment-script', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length < 10) return res.status(400).json({ success: false, error: '台词太短，无需分段' });

    const { callLLM } = require('../services/storyService');
    const systemPrompt = `你是一个专业的视频台词分段专家。你需要将一段口播台词分成多个自然语段，每段适合独立的数字人视频片段。
核心原则：每段说话时长控制在 8-12 秒（中文约 30-50 字，按每秒 4 字计算），因为底层视频生成引擎每段输出 10 秒基础素材。
输出严格的 JSON 数组格式，不要输出任何其他内容。`;

    const userPrompt = `请将以下口播台词分成多个自然语段。规则：
- 每段 30-50 字（约 8-12 秒说话时长，按中文每秒 4 字计算）
- 绝对不要超过 60 字/段（否则视频会出现明显循环感）
- 按自然的语义/呼吸节点分段，不要在句子中间切开
- 每段应该是一个完整的意思表达
- 为每段标注合适的表情：natural / smile / serious / excited / calm
- 为每段标注适合的动作描述（英文，用于视频生成 prompt）

直接输出 JSON 数组，格式：
[
  {"text": "段落文本", "expression": "smile", "motion": "slight nod with warm smile, looking at camera"},
  ...
]

台词内容：
${text}`;

    const result = await callLLM(systemPrompt, userPrompt, { kb: { scene: 'avatar_script', query: text.slice(0, 200), limit: 2 } });
    // 解析 JSON
    let segments;
    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      segments = JSON.parse(jsonMatch ? jsonMatch[0] : result);
    } catch {
      // 回退：按标点/换行简单分段
      segments = text.match(/[^。！？\n]+[。！？]?/g)
        ?.filter(s => s.trim().length > 5)
        ?.map(s => ({ text: s.trim(), expression: 'natural', motion: 'natural speaking with subtle head movements' })) || [];
    }

    // 确保每段不超过 60 字（约 15 秒说话），过长的进一步切分
    const finalSegments = [];
    for (const seg of segments) {
      if (seg.text.length > 60) {
        const parts = seg.text.match(/[^，。！？、；]+[，。！？、；]?/g) || [seg.text];
        let buf = '';
        for (const p of parts) {
          if ((buf + p).length > 50 && buf.length > 15) {
            finalSegments.push({ ...seg, text: buf.trim() });
            buf = p;
          } else {
            buf += p;
          }
        }
        if (buf.trim()) finalSegments.push({ ...seg, text: buf.trim() });
      } else if (seg.text.trim().length > 3) {
        finalSegments.push(seg);
      }
    }

    res.json({ success: true, segments: finalSegments, totalChars: text.length, segmentCount: finalSegments.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/avatar/templates - 获取脚本模板列表
router.get('/templates', (req, res) => {
  res.json({ success: true, templates: [
    { id: 'promo', name: '产品推广', desc: '痛点引入 → 产品亮点 → 行动号召', icon: 'megaphone' },
    { id: 'knowledge', name: '知识分享', desc: '引发好奇 → 核心知识 → 实用建议', icon: 'lightbulb' },
    { id: 'news', name: '新闻播报', desc: '新闻导入 → 事件描述 → 观点总结', icon: 'newspaper' },
    { id: 'story', name: '故事叙述', desc: '悬念开场 → 情节发展 → 结尾感悟', icon: 'book' },
    { id: 'tutorial', name: '教程讲解', desc: '问题场景 → 步骤讲解 → 效果预期', icon: 'graduation' }
  ]});
});

// POST /api/avatar/preview-voice — TTS 音色试听
router.post('/preview-voice', async (req, res) => {
  const { text, voiceId, gender, speed } = req.body;
  const sampleText = (text || '').trim() || '大家好，欢迎来到我的频道，今天给大家分享一个特别实用的技巧。';

  // 直接传递 voiceId 给 TTS（火山引擎等供应商需要精确音色 ID）
  const safeVoiceId = voiceId || null;
  const safeGender = gender || (voiceId?.includes('female') || voiceId?.includes('girl') ? 'female' : voiceId?.includes('male') || voiceId?.includes('boy') ? 'male' : 'female');

  try {
    const taskDir = path.join(path.resolve(process.env.OUTPUT_DIR || './outputs'), 'avatar', '__preview');
    const fs = require('fs');
    fs.mkdirSync(taskDir, { recursive: true });
    const outPath = path.join(taskDir, `preview_${Date.now()}.mp3`);
    const { generateSpeech } = require('../services/ttsService');
    const result = await generateSpeech(sampleText, outPath, {
      gender: safeGender,
      speed: speed || 1.0,
      voiceId: safeVoiceId || null,
    });

    if (!result) {
      return res.status(500).json({ success: false, error: `TTS 试听失败：${generateSpeech.lastError || '所有 TTS 供应商均不可用'}` });
    }

    // TTS 可能生成 .wav 或 .mp3，检查实际文件
    const wavPath = outPath.replace(/\.[^.]+$/, '') + '.wav';
    const actualPath = fs.existsSync(outPath) ? outPath : fs.existsSync(wavPath) ? wavPath : null;
    if (actualPath) {
      const isWav = actualPath.endsWith('.wav');
      res.setHeader('Content-Type', isWav ? 'audio/wav' : 'audio/mpeg');
      const stream = fs.createReadStream(actualPath);
      stream.pipe(res);
      stream.on('end', () => { setTimeout(() => { try { fs.unlinkSync(actualPath); } catch {} }, 5000); });
    } else {
      res.status(500).json({ success: false, error: 'TTS 文件生成失败' });
    }
  } catch (err) {
    console.error('[preview-voice] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/avatar/voice-list — 获取可用音色列表
// 单一数据源：ttsService.getAvailableVoices()（已按 _getTTSKey() 过滤未配 key 的供应商）
// 这样 voice id 一定能被 generateSpeech() 实际合成，避免"声音错乱"
router.get('/voice-list', (req, res) => {
  try {
    const { getAvailableVoices } = require('../services/ttsService');
    const { loadSettings } = require('../services/settingsService');
    let settings; try { settings = loadSettings(); } catch { settings = { providers: [] }; }

    // 构建"已测试通过 + 启用 + 有 key"的供应商集合
    // 规则：test_status==='success' 即可信；test_status==='error' 必须排除
    //       从未测试过（无 last_tested）的暂时也信任，避免误屏蔽新供应商
    const trustedProviders = new Set();
    const blockedProviders = [];
    for (const p of settings.providers || []) {
      if (!p.enabled || !p.api_key) continue;
      if (p.test_status === 'error') { blockedProviders.push(p.id); continue; }
      trustedProviders.add(p.id);
    }
    if (blockedProviders.length) console.log('[voice-list] 已屏蔽测试失败的供应商:', blockedProviders.join(','));

    // 供应商名 → id 反查表（用于 ttsService 返回的对象）
    const nameToId = {
      '智谱AI':'zhipu', '智谱':'zhipu', '火山引擎':'volcengine', '百度语音':'baidu', '百度':'baidu',
      '阿里云':'aliyun-tts', '科大讯飞':'xunfei', '讯飞':'xunfei', 'Fish Audio':'fishaudio',
      'MiniMax':'minimax', 'ElevenLabs':'elevenlabs', 'OpenAI':'openai',
    };

    const real = getAvailableVoices();
    const filtered = real.filter(v => {
      // Windows SAPI 总是允许
      if (v.provider === 'Windows') return true;
      const pid = nameToId[v.provider] || (v.provider || '').toLowerCase();
      return trustedProviders.has(pid);
    });

    // 用户已在「声音克隆」工作台克隆过的自定义音色（db.listVoices）
    // 只返回"真克隆 ready"的：aliyun_voice_id 有 / volc_speaker_id 有且 status!=volc_failed / fish_ref_id 有
    // 训练中 / 失败 / 超时的一律不出现在这里（否则用户会误选 → 合成报错）
    let clonedVoices = [];
    try {
      const userId = req.user?.id || null;
      const dbVoices = db.listVoices(userId) || [];
      clonedVoices = dbVoices
        .filter(v => {
          if (!v.file_path || !fs.existsSync(v.file_path)) return false;
          // 真 ready 的才挂出来
          if (v.aliyun_voice_id) return true;
          if (v.volc_speaker_id && v.status === 'ready') return true;
          if (v.fish_ref_id) return true;
          return false;
        })
        .map(v => {
          // 优先级：阿里 CosyVoice > 火山 > Fish（同时有阿里和火山时显示阿里）
          const providerLabel = v.aliyun_voice_id ? '阿里 CosyVoice'
            : v.volc_speaker_id ? '火山复刻'
            : 'Fish Audio';
          const providerId = v.aliyun_voice_id ? 'aliyun-tts'
            : v.volc_speaker_id ? 'volcengine'
            : 'fishaudio';
          return {
            // 用 v.id (custom_xxx) 才能在 ttsService.generateSpeech 里触发 _generateWithCustomVoice
            id: v.id,
            name: v.name || '我的音色',
            gender: v.gender || 'female',
            provider: providerLabel,
            providerId,
            providerIcon: '🎤',
            isCloned: true,
            originId: v.id,
            // 调试用：让前端能区分到底走哪条链
            has_aliyun: !!v.aliyun_voice_id,
            has_volc: !!(v.volc_speaker_id && v.status === 'ready'),
          };
        });
    } catch (e) { console.warn('[voice-list] listVoices failed:', e.message); }

    const voices = [
      { id: '', name: '自动（按可用链回退）', gender: 'auto', provider: '系统', providerIcon: '⚡' },
      ...clonedVoices,
      ...filtered,
    ];

    // 附加：settings 里 user-defined TTS 模型（仅 trusted 供应商）
    const safeAliyunVoiceIds = new Set(['longxiaochun', 'longxiaoxia', 'longmiao', 'longwan', 'longshu', 'longshuo']);
    for (const provider of settings.providers || []) {
      if (!trustedProviders.has(provider.id)) continue;
      const ttsModels = (provider.models || []).filter(m => m.use === 'tts' && m.enabled !== false);
      for (const m of ttsModels) {
        if (provider.id === 'aliyun-tts' && !safeAliyunVoiceIds.has(m.id)) continue;
        if (voices.find(v => v.id === m.id)) continue;
        const name = m.name || m.id;
        const gender = /female|girl|女|甜美|温柔|知性/.test(name + m.id) ? 'female'
          : /male|boy|男|磁性|开朗|成熟/.test(name + m.id) ? 'male'
          : /child|kid|童/.test(name + m.id) ? 'child' : 'neutral';
        voices.push({
          id: m.id, name, gender,
          provider: provider.name || provider.id,
          providerId: provider.id,
        });
      }
    }

    res.json({ success: true, voices, blocked: blockedProviders });
  } catch (err) {
    console.error('[voice-list] error:', err.message);
    res.json({ success: true, voices: [{ id: '', name: '自动', gender: 'auto', provider: '系统' }] });
  }
});

// ═══════════════════════════════════════════════
// 即梦数字人 Omni v1.5（照片+音频驱动）
// 文档：https://www.volcengine.com/docs/85128/1773810
// ═══════════════════════════════════════════════

const jimengAvatarService = require('../services/jimengAvatarService');
const { generateSpeech } = require('../services/ttsService');
const pms = require('../services/pipelineModelService');

// ═══════════════════════════════════════════════
// 飞影 avatar ID 缓存（图片 → hifly avatar 映射）
// 飞影 createVideoByAudio 需要的是它自己侧的 avatar ID，不能直接吃 imageUrl；
// 同一张图片每次都新建会浪费配额，所以按 imageUrl 的 sha1 缓存到磁盘。
// ═══════════════════════════════════════════════
const HIFLY_AVATAR_CACHE_FILE = path.join(__dirname, '../../outputs/hifly_avatar_cache.json');

function _readHiflyAvatarCache() {
  try { return JSON.parse(fs.readFileSync(HIFLY_AVATAR_CACHE_FILE, 'utf8')); } catch { return {}; }
}
function _writeHiflyAvatarCache(cache) {
  try { fs.writeFileSync(HIFLY_AVATAR_CACHE_FILE, JSON.stringify(cache, null, 2)); }
  catch (e) { console.warn('[hifly] avatar cache write failed:', e.message); }
}
function _hashUrl(url) {
  return require('crypto').createHash('sha1').update(String(url || '')).digest('hex').slice(0, 16);
}

async function _ensureHiflyAvatar(imageUrl, hifly, onProgress, modelId) {
  const key = _hashUrl(imageUrl);
  const cache = _readHiflyAvatarCache();
  if (cache[key] && cache[key].avatar) {
    console.log(`[hifly] 命中 avatar 缓存: ${key} → ${cache[key].avatar}`);
    return cache[key].avatar;
  }
  console.log(`[hifly] 首次此图片，创建 hifly avatar: ${imageUrl}`);
  if (typeof onProgress === 'function') onProgress({ stage: 'hifly_creating_avatar', model_id: modelId });
  const tid = await hifly.createAvatarByImage({
    image_url: imageUrl,
    title: 'vido-auto-' + key,
    model: 2,        // 文档默认值
    aigc_flag: 1,    // AI 生成内容标识
  });
  const r = await hifly.waitAvatarTask(tid, {
    intervalMs: 5000,
    timeoutMs: 10 * 60 * 1000,
    onProgress: (s) => {
      if (typeof onProgress === 'function') onProgress({ stage: `hifly_avatar_${s.label}`, taskId: tid, model_id: modelId });
    },
  });
  cache[key] = { avatar: r.avatar, image_url: imageUrl, created_at: new Date().toISOString(), task_id: tid };
  _writeHiflyAvatarCache(cache);
  return r.avatar;
}

// ═══════════════════════════════════════════════
// 数字人 Step3 调度器：按 admin 后台「模型调用管理 → avatar.lip_sync」
// 优先级链遍历调用真实可用的口型同步模型；并发限流自动跳到下一个候选；
// 不可执行 lip-sync 的模型（如 sora-2/kling/seedance — 它们只支持文生视频，无音频驱动）
// 会被跳过并打 warn 日志。
// ═══════════════════════════════════════════════
async function _dispatchLipSync({ imageUrl, audioUrl, maskUrls, prompt, baseUrl, taskId, onProgress, userId, agentId }) {
  // 已知支持 image+audio 真口型同步的模型（白名单）
  const LIP_SYNC_CAPABLE = new Set([
    'jimeng_realman_avatar_picture_omni_v15',  // 火山即梦 Omni v1.5
    'wan2.2-animate-move',                      // 阿里万相 (注：需要模板视频，不仅是音频)
    'character-3', 'character-2',               // Hedra
    'hifly-free', 'hifly',                      // 飞影
  ]);

  let chain = pms.pickAllEnabled('avatar.lip_sync');
  if (!chain || !chain.length) {
    // 没配置 → 用代码默认
    chain = pms.getStageDefaults('avatar.lip_sync');
  }

  const wantsHifly = chain.some(m => m.model_id === 'hifly' || m.model_id === 'hifly-free' || m.provider_id === 'hifly');
  if (wantsHifly) {
    // 用户明确把飞影放进 lip_sync 链时，Step3 必须严格走飞影。
    // 之前飞影未配置/失败后会继续尝试即梦，导致“后台改成飞影但前端仍调用即梦”的错觉和额外消耗。
    chain = chain.filter(m => m.model_id === 'hifly' || m.model_id === 'hifly-free' || m.provider_id === 'hifly');
  }

  console.log(`[lip-sync:dispatch] 用户配置链: ${chain.map(m => `${m.provider_id}/${m.model_id}`).join(' → ')}`);

  let lastError = null;
  let triedAny = false;
  for (const m of chain) {
    if (!LIP_SYNC_CAPABLE.has(m.model_id)) {
      console.warn(`[lip-sync:dispatch] 跳过 ${m.provider_id}/${m.model_id} — 该模型不支持 image+audio 口型同步（仅文生视频）`);
      continue;
    }
    triedAny = true;
    console.log(`[lip-sync:dispatch] 尝试 ${m.provider_id}/${m.model_id}...`);
    try {
      // —— 火山即梦 Omni ——
      if (m.model_id === 'jimeng_realman_avatar_picture_omni_v15') {
        const r = await jimengAvatarService.generateDigitalHumanVideo({
          imageUrl, audioUrl, maskUrls,
          prompt: prompt || '',
          timeoutMs: 15 * 60 * 1000,
          intervalMs: 5000,
          userId, agentId,
          onProgress: (info) => {
            if (typeof onProgress === 'function') onProgress({ ...info, model_id: m.model_id });
          },
        });
        return { ...r, model_id: m.model_id, provider_id: m.provider_id };
      }
      // —— 飞影 Hifly（火山限流/欠费时的备份链）——
      if (m.model_id === 'hifly' || m.model_id === 'hifly-free' || m.provider_id === 'hifly') {
        const hifly = require('../services/hiflyService');
        // Pre-flight：没配 api_key 就跳过（避免 dispatcher 抛"未配置"误导用户）
        const _settings = require('../services/settingsService').loadSettings();
        const _hiflyProv = (_settings.providers || []).find(p => p.id === 'hifly' || /hifly|lingverse/i.test((p.preset || '') + '|' + (p.name || '') + '|' + (p.api_url || '')));
        const hasHiflyToken = !!(_hiflyProv?.api_key || process.env.HIFLY_TOKEN || process.env.HIFLY_AGENT_TOKEN);
        if (!hasHiflyToken) {
          throw new Error('飞影未配置 API Token：请在「AI 配置」新增 hifly/lingverse provider，或设置 HIFLY_TOKEN / HIFLY_AGENT_TOKEN。已禁止回退即梦。');
        }
        // Step a: 用 imageUrl 拿到飞影 avatar ID（带磁盘缓存，同图二次零开销）
        const hiflyAvatar = await _ensureHiflyAvatar(imageUrl, hifly, onProgress, m.model_id);
        // Step b: 提交 audio→video 任务
        if (typeof onProgress === 'function') onProgress({ stage: 'hifly_submitting', model_id: m.model_id });
        const tid = await hifly.createVideoByAudio({
          audio_url: audioUrl,
          avatar: hiflyAvatar,
          title: `vido-${taskId || Date.now()}`,
          aigc_flag: 1,
        });
        // Step c: 轮询到完成
        const r = await hifly.waitVideoTask(tid, {
          intervalMs: 5000,
          timeoutMs: 15 * 60 * 1000,
          onProgress: (s) => {
            if (typeof onProgress === 'function') onProgress({
              stage: `hifly_${s.label}`, taskId: tid, status: s.status, model_id: m.model_id,
            });
          },
        });
        return {
          videoUrl: r.video_url,
          taskId: tid,
          duration: r.duration,
          model_id: m.model_id,
          provider_id: m.provider_id,
        };
      }
      // —— 阿里万相 wan2.2-animate-move ——
      // 注：wan-animate 需要模板视频，不只是音频；当前 Step3 输入是 image+audio，能力不匹配
      if (m.model_id === 'wan2.2-animate-move') {
        console.warn(`[lip-sync:dispatch] wan2.2-animate-move 需要模板视频（不接受单纯 audio），跳过`);
        continue;
      }
      // 其他能力暂未实现的模型一律跳过
      console.warn(`[lip-sync:dispatch] 模型 ${m.model_id} 路由器尚未对接，跳过`);
    } catch (err) {
      lastError = err;
      // 并发限流 → 自动 fallback 到下一个候选
      if (err.code === 'CONCURRENT_LIMIT' || /Concurrent\s*Limit|Reached\s*API\s*Concurrent/i.test(err.message)) {
        if (wantsHifly) throw err;
        console.warn(`[lip-sync:dispatch] ${m.model_id} 命中并发限流，切到下一候选`);
        if (typeof onProgress === 'function') onProgress({ stage: 'fallback', message: `${m.model_id} 限流，正在切换备用模型`, model_id: m.model_id });
        continue;
      }
      // 账户欠费 / 余额不足 → 也跳到下一候选（不要让单一供应商欠费阻断流程）
      if (/AccountOverdue|InsufficientBalance|账户欠费|余额不足|owed|not\s*authorized|资源未授权/i.test(err.message)) {
        if (wantsHifly) throw err;
        console.warn(`[lip-sync:dispatch] ${m.model_id} 账户问题: ${err.message}，切到下一候选`);
        if (typeof onProgress === 'function') onProgress({ stage: 'fallback', message: `${m.model_id} 账户/授权异常，切换备用`, model_id: m.model_id });
        continue;
      }
      // 其他错误 — 立即抛，避免无限烧钱
      throw err;
    }
  }
  if (!triedAny) {
    throw new Error('avatar.lip_sync 调度失败：当前优先级链中没有任何"可口型同步"的模型（请在管理后台「模型调用管理」启用 jimeng_realman_avatar_picture_omni_v15 等支持 image+audio 的模型）');
  }
  if (lastError) throw lastError;
  throw new Error('avatar.lip_sync 调度失败：所有候选模型均不可用');
}

// 即梦公网素材目录（图片/音频）— server.js 已暴露 /public/jimeng-assets/:filename
const jimengAssetsDir = path.join(__dirname, '../../outputs/jimeng-assets');
if (!fs.existsSync(jimengAssetsDir)) fs.mkdirSync(jimengAssetsDir, { recursive: true });

// 任务内存表
const jimengTasks = new Map();
const jimengSSE = new Map();

function _publicBaseUrl(req) {
  const fromEnv = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  // 从请求头推断（本地开发兜底，生产建议设 PUBLIC_BASE_URL）
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function _saveBufferToAssets(buffer, ext) {
  const filename = `${uuidv4()}${ext}`;
  const filePath = path.join(jimengAssetsDir, filename);
  fs.writeFileSync(filePath, buffer);
  return filename;
}

// 从 /api/avatar/images/:filename 之类已上传的路径复制一份到公开素材目录
function _copyUploadToAssets(inputPath, extFallback = '.jpg') {
  if (!fs.existsSync(inputPath)) throw new Error('源文件不存在: ' + inputPath);
  const ext = path.extname(inputPath) || extFallback;
  const dstName = `${uuidv4()}${ext}`;
  const dstPath = path.join(jimengAssetsDir, dstName);
  fs.copyFileSync(inputPath, dstPath);
  return dstName;
}

async function _downloadToAssets(url, extFallback = '.jpg') {
  const axios = require('axios');
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  // 尝试从 content-type 推断扩展
  const ct = resp.headers['content-type'] || '';
  let ext = extFallback;
  if (ct.includes('png')) ext = '.png';
  else if (ct.includes('jpeg') || ct.includes('jpg')) ext = '.jpg';
  else if (ct.includes('webp')) ext = '.webp';
  else if (ct.includes('mpeg') || ct.includes('mp3')) ext = '.mp3';
  else if (ct.includes('wav')) ext = '.wav';
  return _saveBufferToAssets(Buffer.from(resp.data), ext);
}

// 上传图片接口（也可复用 /upload-image，但为清晰单独给一条）
router.post('/jimeng-omni/upload', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'audio', maxCount: 1 },
]), (req, res) => {
  try {
    const out = {};
    if (req.files?.image?.[0]) {
      const f = req.files.image[0];
      const dstName = _copyUploadToAssets(f.path, path.extname(f.originalname) || '.jpg');
      out.image_url = `${_publicBaseUrl(req)}/public/jimeng-assets/${dstName}`;
    }
    if (req.files?.audio?.[0]) {
      const f = req.files.audio[0];
      const dstName = _copyUploadToAssets(f.path, path.extname(f.originalname) || '.mp3');
      out.audio_url = `${_publicBaseUrl(req)}/public/jimeng-assets/${dstName}`;
    }
    res.json({ success: true, ...out });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 主入口：生成数字人口播视频
// body: { image_url?, image (base64 dataURL)?, audio_url?, text?, voiceId?, prompt?, auto_detect? }
// - 如传 text 会用 TTS 合成音频；传 audio_url 优先
// - image_url 可以是：http(s) 公网 URL、/api/avatar/... 内部路径、或 data URL
// - auto_detect=true 时先跑主体检测取第一个 mask
// ═══════════════════════════════════════════════
// Omni 后期特效 helper（花字/产品贴图/招引动画）
// 在 Omni 原生成片 / 抠像合成成片 之后再叠一层 FFmpeg 特效
// 与老 /generate 路由用的 effectsService.applyEffects 同一套 preset
// ═══════════════════════════════════════════════
async function _applyAvatarPostEffects(videoPath, fx, outDir) {
  const textEffects = fx?.textEffects || [];
  const stickers   = fx?.stickers   || [];
  const pointers   = fx?.pointers   || [];
  if (!textEffects.length && !stickers.length && !pointers.length) return null;

  const posMap = { 'top-center': 'top', 'bottom-center': 'bottom', 'center': 'center' };
  const resolvedTexts = textEffects.map((e, i) => ({
    text: e.text,
    preset: e.style || 'title',
    position: posMap[e.position] || e.position || 'top',
    startTime: e.startTime ?? 0,
    endTime: e.endTime,
    // 透传用户字幕样式（fontSize / 颜色 / 描边）
    fontSize: e.fontSize,
    fontName: e.fontName,
    fontcolor: e.fontcolor || e.color,
    bordercolor: e.bordercolor || e.outlineColor,
    borderw: e.borderw,
    bold: e.bold,
  })).filter(t => t.text);

  const resolvedStickers = stickers.map((s, i) => {
    let p = s.path || s.url || '';
    if (p.startsWith('/api/avatar/images/')) p = path.join(uploadDir, path.basename(p));
    else if (p.startsWith('/public/jimeng-assets/')) p = path.join(jimengAssetsDir, path.basename(p));
    return {
      path: p,
      width: s.width || 240, height: s.height || 240,
      x: s.x ?? 40, y: s.y ?? (40 + i * 260),
      startTime: s.startTime ?? 0, endTime: s.endTime,
    };
  }).filter(s => s.path && fs.existsSync(s.path));

  const iconMap = { arrow: 'arrow_down', finger: 'finger_point', fire: 'fire', sparkle: 'sparkle', circle: 'star' };
  const resolvedPointers = pointers.map(p => {
    const posXY = {
      'top-center':    { x: '50%', y: '15%' },
      'center':        { x: '50%', y: '50%' },
      'bottom-center': { x: '50%', y: '75%' },
      'bottom-left':   { x: '15%', y: '75%' },
      'bottom-right':  { x: '85%', y: '75%' },
    }[p.position || 'bottom-center'] || { x: '50%', y: '75%' };
    return { icon: iconMap[p.type] || p.type || 'arrow_down', ...posXY, startTime: p.startTime ?? 0, endTime: p.endTime };
  });

  if (!resolvedTexts.length && !resolvedStickers.length && !resolvedPointers.length) return null;

  try {
    const { applyEffects } = require('../services/effectsService');
    console.log(`[Omni-FX] 开始叠加 ${resolvedTexts.length} 条字幕 · ${resolvedStickers.length} 张贴图 · ${resolvedPointers.length} 个招引`);
    const out = await applyEffects({
      videoPath,
      texts: resolvedTexts,
      images: resolvedStickers,
      pointers: resolvedPointers,
    });
    if (out?.outputPath && fs.existsSync(out.outputPath)) {
      console.log(`[Omni-FX] 后期特效合成完成: ${out.outputPath}`);
      return out.outputPath;
    }
    console.warn('[Omni-FX] applyEffects 返回空，字幕未烧录');
  } catch (err) {
    // 打详细错误 + stderr（最常见是 Linux 缺 Noto CJK 字体，drawtext 渲染中文失败）
    console.error('[Omni-FX] 特效合成失败（保留原视频）:', err.message);
    if (err.stderr) console.error('[Omni-FX] ffmpeg stderr:', String(err.stderr).slice(0, 1500));
    if (resolvedTexts.length) {
      console.error('[Omni-FX] 提示：含中文字幕且失败 → 99% 是服务器缺中文字体，请装 fonts-noto-cjk 或确认 public/fonts/NotoSansSC-Regular.otf 已部署');
    }

    // ─── 兜底：逐段烧 ───
    // 多 drawtext 链式可能因为 filter_complex 某段语法错就全挂；改成一段一段链式叠加，至少救活 N-1 段
    if (resolvedTexts.length > 1) {
      console.log(`[Omni-FX] 启动兜底：逐段烧 ${resolvedTexts.length} 条字幕`);
      try {
        const { applyEffects: ae } = require('../services/effectsService');
        let cur = videoPath;
        let okCount = 0;
        for (let i = 0; i < resolvedTexts.length; i++) {
          try {
            const r = await ae({ videoPath: cur, texts: [resolvedTexts[i]], images: i === 0 ? resolvedStickers : [], pointers: i === 0 ? resolvedPointers : [] });
            if (r?.outputPath && fs.existsSync(r.outputPath)) {
              cur = r.outputPath;
              okCount++;
            }
          } catch (e2) {
            console.warn(`[Omni-FX] 段 #${i + 1} 烧录失败（继续下一段）:`, e2.message);
          }
        }
        if (okCount > 0) {
          console.log(`[Omni-FX] 兜底完成：${okCount}/${resolvedTexts.length} 段成功烧录 → ${cur}`);
          return cur;
        }
      } catch (e2) {
        console.error('[Omni-FX] 兜底逐段烧录也失败:', e2.message);
      }
    }
  }
  return null;
}

router.post('/jimeng-omni/generate', async (req, res) => {
  const taskId = uuidv4();
  const baseUrl = _publicBaseUrl(req);
  const {
    image_url, image, audio_url, text, voiceId, prompt, auto_detect, speed = 1.0,
    // 后期特效（花字/贴图/招引）— Omni 生成完后（或 compose 完后）再叠
    textEffects, stickers, pointers,
    // 作品分类：'sample' (形象预览) / 'production' (数字人正片)
    kind,
  } = req.body || {};

  // 初始化任务状态
  const task = {
    id: taskId,
    status: 'preparing',
    stage: 'init',
    created_at: Date.now(),
    image_url: null,
    audio_url: null,
    video_url: null,
    error: null,
    // 存起来，后续 compose 路径也能读到
    post_effects: { textEffects: textEffects || [], stickers: stickers || [], pointers: pointers || [] },
  };
  jimengTasks.set(taskId, task);

  // 同步返回 taskId，异步跑生成
  res.json({ success: true, taskId });

  (async () => {
    try {
      // Step 1: 准备 image_url（公网可访问）
      task.stage = 'prepare_image';
      let imgName;
      if (image_url) {
        // 先做同源归一化：http://host/api/avatar/... → /api/avatar/...（避免服务端 axios 撞鉴权）
        const normalizedImg = _stripSameOrigin(image_url, baseUrl);
        if (normalizedImg.startsWith('/api/avatar/images/') || normalizedImg.startsWith('/api/avatar/preset-img/')) {
          // 内部上传/预设路径 — 找到本地文件
          const basename = path.basename(normalizedImg.split('?')[0]);
          const candidates = [
            path.join(uploadDir, basename),
            path.join(presetsDir, basename),
          ];
          const found = candidates.find(p => fs.existsSync(p));
          if (!found) throw new Error('图片文件不存在: ' + normalizedImg);
          imgName = _copyUploadToAssets(found, path.extname(basename) || '.jpg');
          task.image_url = `${baseUrl}/public/jimeng-assets/${imgName}`;
        } else if (normalizedImg.startsWith('/public/jimeng-assets/')) {
          // 已经在公开素材目录 — 直接拼完整 URL
          task.image_url = baseUrl + normalizedImg;
        } else if (/^https?:\/\//i.test(normalizedImg)) {
          // 外部 URL — 下载一份
          imgName = await _downloadToAssets(normalizedImg, '.jpg');
          task.image_url = `${baseUrl}/public/jimeng-assets/${imgName}`;
        } else {
          throw new Error('不支持的 image_url 格式: ' + String(image_url).slice(0, 60));
        }
      } else if (image && /^data:image\//.test(image)) {
        const match = image.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!match) throw new Error('image dataURL 格式错误');
        const ext = '.' + (match[1] === 'jpeg' ? 'jpg' : match[1]);
        imgName = _saveBufferToAssets(Buffer.from(match[2], 'base64'), ext);
        task.image_url = `${baseUrl}/public/jimeng-assets/${imgName}`;
      } else {
        throw new Error('image_url 或 image 必填');
      }

      // Step 2: 准备 audio_url
      task.stage = 'prepare_audio';
      if (audio_url) {
        const normalizedAudio = _stripSameOrigin(audio_url, baseUrl);
        if (normalizedAudio.startsWith('/api/avatar/audios/')) {
          const basename = path.basename(normalizedAudio.split('?')[0]);
          const src = path.join(uploadDir, basename);
          if (!fs.existsSync(src)) throw new Error('音频文件不存在: ' + normalizedAudio);
          const dstName = _copyUploadToAssets(src, path.extname(basename) || '.mp3');
          task.audio_url = `${baseUrl}/public/jimeng-assets/${dstName}`;
        } else if (normalizedAudio.startsWith('/public/jimeng-assets/')) {
          task.audio_url = baseUrl + normalizedAudio;
        } else if (/^https?:\/\//i.test(normalizedAudio)) {
          const audName = await _downloadToAssets(normalizedAudio, '.mp3');
          task.audio_url = `${baseUrl}/public/jimeng-assets/${audName}`;
        } else {
          throw new Error('不支持的 audio_url 格式');
        }
      } else if (text && text.trim()) {
        const audioBase = path.join(jimengAssetsDir, uuidv4());
        const result = await generateSpeech(text, audioBase, { voiceId: voiceId || null, speed: Number(speed) || 1.0 });
        if (!result) throw new Error(`TTS 合成失败：${generateSpeech.lastError || '没有可用的语音供应商'}`);
        const finalName = path.basename(result);
        task.audio_url = `${baseUrl}/public/jimeng-assets/${finalName}`;
      } else {
        throw new Error('audio_url 或 text 必填');
      }

      // Step 3: 可选主体检测
      task.stage = 'detecting';
      let maskUrls = [];
      if (auto_detect) {
        try {
          const masks = await jimengAvatarService.detectSubjects(task.image_url);
          if (masks.length) maskUrls = [masks[0]];
        } catch (e) {
          console.warn('[jimeng-omni] 主体检测失败（继续不带 mask）:', e.message);
        }
      }

      // Step 4: 提交生成 + 轮询（按 admin 后台「模型调用管理 → avatar.lip_sync」优先级链调度）
      task.stage = 'submitting';
      task.status = 'running';
      // 强保留面部特征的默认 prompt（用户传了自定义就用用户的）
      const DEFAULT_OMNI_PROMPT = '严格保持原图人物面部特征不变，不要改变发型/年龄/肤色/五官/脸型，自然表情，嘴型清晰与音频同步，眼神坚定有感染力，身体微动稳定，真人摄影质感，preserve exact facial identity, do not change face, stable lip sync';
      const dispResult = await _dispatchLipSync({
        imageUrl: task.image_url,
        audioUrl: task.audio_url,
        maskUrls,
        prompt: prompt || DEFAULT_OMNI_PROMPT,
        baseUrl,
        taskId,
        userId: req.user?.id,
        agentId: 'avatar.lip_sync',
        onProgress: (info) => {
          task.stage = info.stage || task.stage;
          task.cv_task_id = info.taskId || task.cv_task_id;
          task.cv_status = info.status || task.cv_status;
          task.elapsed = info.elapsed;
          if (info.model_id) task.actual_model = info.model_id;
          if (info.message) task.fallback_message = info.message;
        },
      });
      const cvTaskId = dispResult.taskId;
      const videoUrl = dispResult.videoUrl;
      task.cv_task_id = cvTaskId;
      task.actual_model = dispResult.model_id;
      task.actual_provider = dispResult.provider_id;
      task.finished_at = Date.now();

      // 立刻下载成品到本地（即梦 CDN URL 短时过期，务必立即下载）+ 同时复制到 jimeng-assets 供公网访问
      // 这样前端拿到的 video_url 是我们自己的 URL，不会 403
      try {
        const axios = require('axios');
        const dl = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
        const resultDir = path.join(__dirname, '../../outputs/avatar', taskId);
        fs.mkdirSync(resultDir, { recursive: true });
        const finalPath = path.join(resultDir, 'avatar_raw.mp4');
        fs.writeFileSync(finalPath, Buffer.from(dl.data));
        task.local_path = finalPath;
        // 暴露一份公网 URL（由 /public/jimeng-assets 提供访问）
        const publicName = `omni_${taskId}.mp4`;
        fs.copyFileSync(finalPath, path.join(jimengAssetsDir, publicName));
        task.video_url = `${baseUrl}/public/jimeng-assets/${publicName}`;
        task.cdn_url = videoUrl; // 保留原 CDN URL 作调试

        // === 后期特效（花字/贴图/招引）—— 仅当用户没选百度抠像（doMatting=false）时在这里叠 ===
        // 如果是 matte 流程，compose 路径会在更晚的阶段叠（避免叠两次）
        // 前端 pollAvatarJimengOmni 会在 doMatting=true 时跳到 compose，此处不叠
        // 判断方式：前端 post_effects 存在 + 任务没有 skipPostEffects 标记
        if (task.post_effects && !task.skip_post_effects_here) {
          const subtitleCount = (task.post_effects.textEffects || []).length;
          if (subtitleCount > 0 || (task.post_effects.stickers || []).length > 0 || (task.post_effects.pointers || []).length > 0) {
            task.stage = 'post_effects';
            console.log(`[jimeng-omni:${taskId}] 开始叠加字幕/特效 · ${subtitleCount} 段字幕`);
            const fxOut = await _applyAvatarPostEffects(finalPath, task.post_effects, path.dirname(finalPath));
            if (fxOut) {
              const fxName = `omni_${taskId}_fx.mp4`;
              fs.copyFileSync(fxOut, path.join(jimengAssetsDir, fxName));
              task.video_url = `${baseUrl}/public/jimeng-assets/${fxName}`;
              task.local_path = fxOut;
              task.subtitle_burned = subtitleCount > 0;
              console.log(`[jimeng-omni:${taskId}] 字幕/特效已烧录 → ${fxName}`);
            } else {
              task.subtitle_burned = false;
              task.subtitle_warning = `字幕烧录失败（${subtitleCount} 段未生效）— 请查服务器日志 [Omni-FX] 行`;
              console.warn(`[jimeng-omni:${taskId}] 字幕/特效叠加失败，返回原视频`);
            }
          }
        }
      } catch (e) {
        console.warn('[jimeng-omni] 下载视频到本地失败:', e.message);
        // 兜底：没下载成功就用 CDN URL（可能已过期）
        task.video_url = videoUrl;
      }
      task.status = 'done';
      task.stage = 'done';
      // 持久化到 avatar_db 让"我的作品"能查到（以前只用内存 Map，重启丢）
      try {
        const relVideoUrl = task.video_url ? task.video_url.replace(baseUrl, '') : '';
        // image_url 存相对路径方便前端直接用作 poster
        const relImageUrl = task.image_url ? task.image_url.replace(baseUrl, '') : '';
        const row = {
          id: taskId,
          status: 'done',
          user_id: req.user?.id || null,
          text: text || '',
          title: req.body?.title || '',
          videoPath: task.local_path,
          videoUrl: relVideoUrl,
          imageUrl: relImageUrl,
          model: task.actual_model || 'avatar-lip-sync',
          ratio: '9:16',
          created_at: new Date(task.created_at).toISOString(),
          finished_at: new Date().toISOString(),
          cv_task_id: task.cv_task_id,
          source: task.actual_provider || 'avatar',
          // 区分: 'sample' = Step 1 动态预览样片；'production' = Step 3 正式数字人；其他旧数据默认 production
          kind: kind === 'sample' ? 'sample' : 'production',
          // 字幕烧录状态（让作品库能展示）
          subtitle_burned: !!task.subtitle_burned,
          subtitle_warning: task.subtitle_warning || null,
        };
        if (!db.getAvatarTask(taskId)) db.insertAvatarTask(row);
        else db.updateAvatarTask(taskId, { status: 'done', videoPath: task.local_path, videoUrl: relVideoUrl, finished_at: row.finished_at, subtitle_burned: row.subtitle_burned, subtitle_warning: row.subtitle_warning });
      } catch (dbErr) {
        console.warn('[jimeng-omni] DB 持久化失败:', dbErr.message);
      }
    } catch (err) {
      task.status = 'error';
      task.error = err.message;
      console.error('[jimeng-omni] 任务失败:', err.message);
    }
  })();
});

// 查询任务
router.get('/jimeng-omni/tasks/:id', (req, res) => {
  const task = jimengTasks.get(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'task not found' });
  res.json({ success: true, task });
});

// 列表
router.get('/jimeng-omni/tasks', (req, res) => {
  const tasks = Array.from(jimengTasks.values())
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 50);
  res.json({ success: true, tasks });
});

// ═══════════════════════════════════════════════
// 抠像 + 背景合成（百度 body_seg）
// ═══════════════════════════════════════════════

const jimengMattedDir = path.join(__dirname, '../../outputs/jimeng-matted');
if (!fs.existsSync(jimengMattedDir)) fs.mkdirSync(jimengMattedDir, { recursive: true });

// 把 http(s) 同域 URL 归一化成 pathname（让后续走本地文件分支，避免 axios 再去请求鉴权路径）
function _stripSameOrigin(url, baseUrl) {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    const candidates = new Set();
    if (baseUrl) { try { candidates.add(new URL(baseUrl).host); } catch {} }
    // 生产域名固定兜底（即便 baseUrl 不准）
    candidates.add('vido.smsend.cn');
    candidates.add('43.98.167.151:4600');
    candidates.add('127.0.0.1:4600');
    candidates.add('localhost:4600');
    candidates.add('localhost:3007');
    if (candidates.has(u.host)) return u.pathname + (u.search || '');
  } catch (e) {}
  return url;
}

async function _resolveSourceVideoPath(source, uploadedFile, baseUrl) {
  // 优先文件上传
  if (uploadedFile) return uploadedFile.path;
  if (!source) throw new Error('source 必填：taskId / 本地路径 / 公网 URL');
  // 1. jimeng-omni 任务 ID
  const existingTask = jimengTasks.get(source);
  if (existingTask && existingTask.local_path && fs.existsSync(existingTask.local_path)) {
    return existingTask.local_path;
  }
  // 归一化同源 URL 到路径
  const normalized = _stripSameOrigin(source, baseUrl);
  // 2. /public/jimeng-assets/xxx → 本地路径
  if (normalized.startsWith('/public/jimeng-assets/') || normalized.includes('/public/jimeng-assets/')) {
    const name = path.basename(normalized.split('?')[0]);
    const p = path.join(__dirname, '../../outputs/jimeng-assets', name);
    if (fs.existsSync(p)) return p;
  }
  // /api/avatar/images/ or preset-img
  if (normalized.startsWith('/api/avatar/images/') || normalized.startsWith('/api/avatar/preset-img/')) {
    const name = path.basename(normalized.split('?')[0]);
    const candidates = [
      path.join(uploadDir, name),
      path.join(presetsDir, name),
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (found) return found;
  }
  // 3. 外部 http(s) URL → 下载
  if (/^https?:\/\//i.test(normalized)) {
    const axios = require('axios');
    const dl = await axios.get(normalized, { responseType: 'arraybuffer', timeout: 120000 });
    const tmp = path.join(jimengMattedDir, `_src_${uuidv4()}.mp4`);
    fs.writeFileSync(tmp, Buffer.from(dl.data));
    return tmp;
  }
  // 4. 绝对路径
  if (fs.existsSync(source)) return source;
  throw new Error('无法解析 source: ' + String(source).slice(0, 100));
}

async function _resolveBgPath(bg, uploadedFile, baseUrl) {
  if (uploadedFile) return uploadedFile.path;
  if (!bg) throw new Error('bg 必填');
  // 同源归一化
  const normalized = _stripSameOrigin(bg, baseUrl);
  if (normalized.startsWith('/public/jimeng-assets/')) {
    const p = path.join(__dirname, '../../outputs/jimeng-assets', path.basename(normalized.split('?')[0]));
    if (fs.existsSync(p)) return p;
  }
  if (normalized.startsWith('/api/avatar/preset-img/') || normalized.startsWith('/api/avatar/images/')) {
    const name = path.basename(normalized.split('?')[0]);
    const candidates = [
      path.join(presetsDir, name),
      path.join(uploadDir, name),
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (found) return found;
  }
  if (/^https?:\/\//i.test(normalized)) {
    const axios = require('axios');
    const dl = await axios.get(normalized, { responseType: 'arraybuffer', timeout: 60000 });
    const ct = dl.headers['content-type'] || '';
    const ext = ct.includes('png') ? '.png' : ct.includes('mp4') ? '.mp4' : ct.includes('webp') ? '.webp' : '.jpg';
    const tmp = path.join(jimengMattedDir, `_bg_${uuidv4()}${ext}`);
    fs.writeFileSync(tmp, Buffer.from(dl.data));
    return tmp;
  }
  if (fs.existsSync(bg)) return bg;
  throw new Error('无法解析 bg: ' + String(bg).slice(0, 100));
}

const mattingTasks = new Map();

// 上传 matte 源视频 + 背景素材
router.post('/jimeng-omni/upload-matte', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'bg', maxCount: 1 },
]), (req, res) => {
  const out = {};
  const base = _publicBaseUrl(req);
  if (req.files?.video?.[0]) {
    const f = req.files.video[0];
    const dst = path.join(jimengAssetsDir, `${uuidv4()}${path.extname(f.originalname) || '.mp4'}`);
    fs.copyFileSync(f.path, dst);
    out.video_url = `${base}/public/jimeng-assets/${path.basename(dst)}`;
  }
  if (req.files?.bg?.[0]) {
    const f = req.files.bg[0];
    const ext = path.extname(f.originalname) || (/video/i.test(f.mimetype) ? '.mp4' : '.jpg');
    const dst = path.join(jimengAssetsDir, `${uuidv4()}${ext}`);
    fs.copyFileSync(f.path, dst);
    out.bg_url = `${base}/public/jimeng-assets/${path.basename(dst)}`;
  }
  res.json({ success: true, ...out });
});

/**
 * 对一个视频做：抠像 + 叠背景 → 新视频
 * body: { source, bg, width?, height?, scaleMode?, qps?, keep_matte? }
 *   - source: taskId | 本地路径 | 公网 URL | /public/jimeng-assets/xxx
 *   - bg:     公网 URL | 本地路径 | /public/jimeng-assets/xxx（支持 jpg/png/mp4）
 */
router.post('/jimeng-omni/compose', async (req, res) => {
  const {
    source, bg, width = 720, height = 1280, scaleMode = 'cover', qps = 8, keep_matte = true,
    // 新：后期特效（花字/贴图/招引）— 合成完背景后再叠一层
    textEffects, stickers, pointers,
    // 新：如果是从 Omni task 来的，允许传 omni_task_id，自动继承 post_effects
    omni_task_id,
  } = req.body || {};
  if (!source) return res.status(400).json({ success: false, error: 'source 必填' });
  if (!bg) return res.status(400).json({ success: false, error: 'bg 必填' });

  // 组装 effects 配置：优先用请求体里带的，其次继承 omni_task_id 的 post_effects
  let postEffects = { textEffects: textEffects || [], stickers: stickers || [], pointers: pointers || [] };
  if ((!postEffects.textEffects.length && !postEffects.stickers.length && !postEffects.pointers.length) && omni_task_id) {
    const parent = jimengTasks.get(omni_task_id);
    if (parent?.post_effects) postEffects = parent.post_effects;
  }

  const taskId = uuidv4();
  const baseUrl = _publicBaseUrl(req);
  const task = {
    id: taskId,
    source,
    bg,
    status: 'preparing',
    stage: 'init',
    created_at: Date.now(),
    matte_url: null,
    output_url: null,
    error: null,
    post_effects: postEffects,
  };
  mattingTasks.set(taskId, task);
  res.json({ success: true, taskId });

  (async () => {
    let tmpDir = null;
    try {
      task.status = 'running';
      task.stage = 'resolve_source';
      const srcPath = await _resolveSourceVideoPath(source, null, baseUrl);
      task.stage = 'resolve_bg';
      const bgPath = await _resolveBgPath(bg, null, baseUrl);

      const { matteVideo, composeWithBackground, probeVideo, cleanup } = require('../services/videoMattingPipeline');
      const info = await probeVideo(srcPath);
      task.src_fps = info.fps;
      task.src_duration = info.duration;

      // 抠像
      const mattedPath = path.join(jimengMattedDir, `matte_${taskId}.mov`);
      task.stage = 'matting';
      const matteRes = await matteVideo(srcPath, mattedPath, {
        fps: info.fps,
        qps,
        onProgress: (p) => {
          task.stage = p.stage;
          if (p.total) task.matte_total = p.total;
          if (p.done) task.matte_done = p.done;
        },
      });
      tmpDir = matteRes.tmpDir;
      task.matte_path = mattedPath;
      // 防御：matte 文件太大（qtrle 无损 1GB+）或 0 字节都是异常
      const matteStat = fs.existsSync(mattedPath) ? fs.statSync(mattedPath) : null;
      if (!matteStat || matteStat.size < 10000) {
        throw new Error('抠像中间文件异常：' + (matteStat ? matteStat.size + ' 字节' : '不存在'));
      }
      task.matte_size_mb = (matteStat.size / 1024 / 1024).toFixed(1);

      // 合成
      task.stage = 'composing';
      const outPath = path.join(jimengMattedDir, `composed_${taskId}.mp4`);
      await composeWithBackground(mattedPath, bgPath, outPath, { width, height, scaleMode });
      // 防御：输出必须存在且 > 50KB（纯黑或空 mp4 也就 10KB 左右）
      const outStat = fs.existsSync(outPath) ? fs.statSync(outPath) : null;
      if (!outStat || outStat.size < 50000) {
        throw new Error('合成输出异常：' + (outStat ? outStat.size + ' 字节（文件过小，可能合成失败）' : '文件不存在'));
      }
      // 暴露成片
      const outName = `composed_${taskId}.mp4`;
      fs.copyFileSync(outPath, path.join(jimengAssetsDir, outName));
      task.output_url = `${baseUrl}/public/jimeng-assets/${outName}`;
      task.output_size_mb = (outStat.size / 1024 / 1024).toFixed(1);
      task.local_path = outPath;

      // === 后期特效（花字/贴图/招引）在抠像合成完后叠上去 ===
      if (task.post_effects && (task.post_effects.textEffects?.length || task.post_effects.stickers?.length || task.post_effects.pointers?.length)) {
        task.stage = 'post_effects';
        const fxOut = await _applyAvatarPostEffects(outPath, task.post_effects, path.dirname(outPath));
        if (fxOut) {
          const fxName = `composed_${taskId}_fx.mp4`;
          fs.copyFileSync(fxOut, path.join(jimengAssetsDir, fxName));
          task.output_url = `${baseUrl}/public/jimeng-assets/${fxName}`;
          task.local_path = fxOut;
        }
      }

      task.stage = 'done';
      // 持久化到 avatar_db（抠像合成的成品也入"我的作品"）
      try {
        const relVideoUrl = task.output_url ? task.output_url.replace(baseUrl, '') : '';
        const row = {
          id: taskId,
          status: 'done',
          user_id: req.user?.id || null,
          text: '',
          title: req.body?.title || '',
          videoPath: task.local_path,
          videoUrl: relVideoUrl,
          model: 'jimeng-omni-matte',
          ratio: `${width}x${height}`,
          created_at: new Date(task.created_at).toISOString(),
          finished_at: new Date().toISOString(),
          source: 'omni-matte',
          source_omni_task: omni_task_id || null,
        };
        if (!db.getAvatarTask(taskId)) db.insertAvatarTask(row);
        else db.updateAvatarTask(taskId, { status: 'done', videoPath: task.local_path, videoUrl: relVideoUrl, finished_at: row.finished_at });
      } catch (dbErr) {
        console.warn('[jimeng-compose] DB 持久化失败:', dbErr.message);
      }
      task.status = 'done';
      task.finished_at = Date.now();

      // 清理 tmp 但保留 matte MOV（用户可能还要换背景）
      if (!keep_matte) {
        try { fs.unlinkSync(matteAssetPath); } catch {}
      }
      cleanup(tmpDir);
    } catch (err) {
      task.status = 'error';
      task.error = err.message;
      console.error('[jimeng-compose] 失败:', err.message, err.stack);
    }
  })();
});

router.get('/jimeng-omni/matte-tasks/:id', (req, res) => {
  const t = mattingTasks.get(req.params.id);
  if (!t) return res.status(404).json({ success: false, error: 'not found' });
  res.json({ success: true, task: t });
});

// AI 按主题写口播稿（黄金 4 段·~4 字/秒）
router.post('/jimeng-omni/write-script', async (req, res) => {
  try {
    const { topic, duration_sec = 20 } = req.body || {};
    if (!topic || !String(topic).trim()) return res.status(400).json({ success: false, error: 'topic 必填' });
    const { generateScript } = require('../services/tutorialProducer');
    const script = await generateScript({ topic, durationSec: duration_sec });
    res.json({ success: true, script });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// 一条龙：主题 → 人像 + 口播稿 + TTS + 数字人视频
// ═══════════════════════════════════════════════
router.post('/jimeng-omni/auto-produce', async (req, res) => {
  const { topic, duration_sec = 20, portrait_prompt = '', voiceId = '' } = req.body || {};
  if (!topic || !String(topic).trim()) {
    return res.status(400).json({ success: false, error: 'topic 必填' });
  }
  if (duration_sec < 5 || duration_sec > 120) {
    return res.status(400).json({ success: false, error: 'duration_sec 必须在 5-120 秒' });
  }

  const taskId = uuidv4();
  const baseUrl = _publicBaseUrl(req);
  const task = {
    id: taskId,
    mode: 'auto',
    status: 'preparing',
    stage: 'init',
    created_at: Date.now(),
    topic,
    duration_sec,
    image_url: null,
    audio_url: null,
    video_url: null,
    script: null,
    error: null,
  };
  jimengTasks.set(taskId, task);
  res.json({ success: true, taskId });

  (async () => {
    try {
      const { produceTutorialVideo } = require('../services/tutorialProducer');
      task.status = 'running';
      const result = await produceTutorialVideo({
        topic,
        durationSec: duration_sec,
        portraitPrompt: portrait_prompt,
        voiceId,
        publicBaseUrl: baseUrl,
        assetsDir: jimengAssetsDir,
        onStage: ({ name, meta }) => {
          task.stage = name;
          if (meta) {
            if (meta.preview) task.script_preview = meta.preview;
            if (meta.length) task.script_length = meta.length;
            if (meta.videoUrl) task.video_url = meta.videoUrl;
            if (meta.status) task.cv_status = meta.status;
            if (meta.elapsed != null) task.elapsed = meta.elapsed;
            if (meta.taskId) task.cv_task_id = meta.taskId;
          }
        },
      });
      task.image_url = result.portrait_url;
      task.audio_url = result.audio_url;
      task.video_url = result.video_url;
      task.script = result.script;
      task.cv_task_id = result.cv_task_id;
      task.status = 'done';
      task.stage = 'done';
      task.finished_at = Date.now();

      // 下载一份到本地持久化
      try {
        const axios = require('axios');
        const dl = await axios.get(result.video_url, { responseType: 'arraybuffer', timeout: 120000 });
        const resultDir = path.join(__dirname, '../../outputs/avatar', taskId);
        fs.mkdirSync(resultDir, { recursive: true });
        const finalPath = path.join(resultDir, 'avatar_raw.mp4');
        fs.writeFileSync(finalPath, Buffer.from(dl.data));
        fs.writeFileSync(path.join(resultDir, 'script.txt'), result.script);
        task.local_path = finalPath;
        // 同样暴露公网 URL（避免 CDN 过期 403）
        const publicName = `omni_auto_${taskId}.mp4`;
        fs.copyFileSync(finalPath, path.join(jimengAssetsDir, publicName));
        task.cdn_url = task.video_url;
        task.video_url = `${baseUrl}/public/jimeng-assets/${publicName}`;
      } catch (e) {
        console.warn('[jimeng-auto] 下载视频失败:', e.message);
      }
    } catch (err) {
      task.status = 'error';
      task.error = err.message;
      console.error('[jimeng-auto] 任务失败:', err.message);
    }
  })();
});

// ═══════════════════════════════════════════════
// Wan 2.2-Animate（阿里百炼 DashScope）— 动作/表情/口型三合一迁移
// ═══════════════════════════════════════════════
const wanAnimateTasks = new Map(); // taskId → { id, status, image_url, video_url, result_url, error, created_at, finished_at }

router.post('/wan-animate/generate', async (req, res) => {
  try {
    const { image_url, video_url, mode = 'wan-pro', watermark = false } = req.body || {};
    if (!image_url || !video_url) {
      return res.status(400).json({ success: false, error: 'image_url 与 video_url 均必填（需公网可访问）' });
    }
    const wan = require('../services/wanAnimateService');
    const baseUrl = _publicBaseUrl(req);

    // 若传入的是本地 /api/... 或 /public/... 路径，归一化成公网 URL 传给 DashScope
    const normalizeToPublic = (u) => {
      if (!u) return u;
      if (u.startsWith('http://') || u.startsWith('https://')) return u;
      return `${baseUrl}${u.startsWith('/') ? u : '/' + u}`;
    };
    const imgPub = normalizeToPublic(image_url);
    const vidPub = normalizeToPublic(video_url);

    const taskId = uuidv4();
    const task = {
      id: taskId,
      status: 'submitting',
      image_url: imgPub,
      video_url: vidPub,
      mode,
      created_at: Date.now(),
      dashscope_task_id: null,
      result_url: null,
      error: null,
    };
    wanAnimateTasks.set(taskId, task);
    res.json({ success: true, taskId });

    (async () => {
      try {
        const dsTaskId = await wan.submitAnimateTask({
          imageUrl: imgPub,
          videoUrl: vidPub,
          mode,
          watermark,
        });
        task.dashscope_task_id = dsTaskId;
        task.status = 'running';

        const result = await wan.waitAnimateTask(dsTaskId, {
          onProgress: (s) => {
            task.dashscope_status = s.status;
          },
        });

        // 下载到本地 jimeng-assets 做持久化（DashScope URL 24h 过期）
        try {
          const axios = require('axios');
          const dl = await axios.get(result.videoUrl, { responseType: 'arraybuffer', timeout: 180000 });
          const publicName = `wan_animate_${taskId}.mp4`;
          const localPath = path.join(jimengAssetsDir, publicName);
          fs.writeFileSync(localPath, Buffer.from(dl.data));
          task.result_url = `${baseUrl}/public/jimeng-assets/${publicName}`;
          task.dashscope_result_url = result.videoUrl;
          task.local_path = localPath;
        } catch (e) {
          console.warn('[wan-animate] 本地持久化失败，用 DashScope URL:', e.message);
          task.result_url = result.videoUrl;
        }

        task.status = 'done';
        task.finished_at = Date.now();
        console.log(`[wan-animate] ✅ 完成 ${taskId} → ${task.result_url}`);
      } catch (err) {
        task.status = 'error';
        task.error = err.message;
        console.error('[wan-animate] 失败:', err.message);
      }
    })();
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/wan-animate/tasks/:id', (req, res) => {
  const t = wanAnimateTasks.get(req.params.id);
  if (!t) return res.status(404).json({ success: false, error: 'task not found' });
  res.json({ success: true, task: t });
});

router.get('/wan-animate/tasks', (req, res) => {
  const tasks = Array.from(wanAnimateTasks.values())
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 50);
  res.json({ success: true, tasks });
});

module.exports = router;
