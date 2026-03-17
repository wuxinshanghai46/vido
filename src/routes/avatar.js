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

// 任务存储
const avatarTasks = new Map();
const avatarSSE = new Map();

// POST /api/avatar/generate - 生成数字人视频
router.post('/generate', async (req, res) => {
  try {
    const { avatar, text, voiceId, ratio, model } = req.body;
    if (!avatar) return res.status(400).json({ success: false, error: '请选择数字人形象' });

    const { generateAvatarVideo } = require('../services/avatarService');
    const taskId = uuidv4();

    // 解析图片路径
    let imageUrl = avatar;
    if (avatar.startsWith('/api/avatar/images/')) {
      imageUrl = path.join(uploadDir, path.basename(avatar));
    } else if (avatar.startsWith('/api/avatar/preset-img/')) {
      imageUrl = path.join(presetsDir, path.basename(avatar));
    } else if (PRESET_AVATARS[avatar]) {
      // 预设 ID（如 "female-1"），查找已生成的预设图片
      const presetFiles = fs.readdirSync(presetsDir).filter(f => f.startsWith(`avatar_${avatar}.`));
      if (presetFiles.length > 0) {
        imageUrl = path.join(presetsDir, presetFiles[0]);
      } else {
        return res.status(400).json({ success: false, error: `预设形象 "${avatar}" 的图片尚未生成，请先在设置中生成预设图片` });
      }
    } else if (!avatar.startsWith('http') && !fs.existsSync(avatar)) {
      return res.status(400).json({ success: false, error: '无效的形象图片: ' + avatar });
    }

    // 记录任务
    avatarTasks.set(taskId, { id: taskId, status: 'processing', created_at: new Date().toISOString(), text, user_id: req.user?.id });
    res.json({ success: true, taskId });

    // 异步生成
    generateAvatarVideo({
      imageUrl,
      text: text || '',
      voiceId: voiceId || '',
      ratio: ratio || '9:16',
      model: model || 'cogvideox-flash',
      onProgress: (data) => {
        const listeners = avatarSSE.get(taskId) || [];
        listeners.forEach(r => { try { r.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} });
      }
    }).then(result => {
      avatarTasks.set(taskId, { ...avatarTasks.get(taskId), status: 'done', videoPath: result.videoPath, videoUrl: result.videoUrl });
      const listeners = avatarSSE.get(taskId) || [];
      listeners.forEach(r => { try { r.write(`data: ${JSON.stringify({ step: 'done', videoUrl: result.videoUrl })}\n\n`); } catch {} });
    }).catch(err => {
      console.error('[Avatar] 生成失败:', err.message);
      avatarTasks.set(taskId, { ...avatarTasks.get(taskId), status: 'error', error: err.message });
      const listeners = avatarSSE.get(taskId) || [];
      listeners.forEach(r => { try { r.write(`data: ${JSON.stringify({ step: 'error', message: err.message })}\n\n`); } catch {} });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/avatar/tasks/:id/progress - SSE 进度
router.get('/tasks/:id/progress', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.write(`data: ${JSON.stringify({ step: 'connected' })}\n\n`);
  const list = avatarSSE.get(req.params.id) || [];
  avatarSSE.set(req.params.id, [...list, res]);
  req.on('close', () => {
    const updated = (avatarSSE.get(req.params.id) || []).filter(r => r !== res);
    avatarSSE.set(req.params.id, updated);
  });
  // 如果任务已完成，立即发送结果
  const task = avatarTasks.get(req.params.id);
  if (task?.status === 'done') {
    res.write(`data: ${JSON.stringify({ step: 'done', videoUrl: task.videoUrl })}\n\n`);
  } else if (task?.status === 'error') {
    res.write(`data: ${JSON.stringify({ step: 'error', message: task.error })}\n\n`);
  }
});

// GET /api/avatar/tasks/:id/stream - 流式播放结果视频
router.get('/tasks/:id/stream', (req, res) => {
  const task = avatarTasks.get(req.params.id);
  if (!task?.videoPath || !fs.existsSync(task.videoPath)) {
    return res.status(404).json({ error: '视频不存在' });
  }
  const stat = fs.statSync(task.videoPath);
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(s, 10);
    const end = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4'
    });
    fs.createReadStream(task.videoPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' });
    fs.createReadStream(task.videoPath).pipe(res);
  }
});

// GET /api/avatar/tasks/:id/download - 下载结果视频
router.get('/tasks/:id/download', (req, res) => {
  const task = avatarTasks.get(req.params.id);
  if (!task?.videoPath || !fs.existsSync(task.videoPath)) {
    return res.status(404).json({ error: '视频不存在' });
  }
  res.download(task.videoPath, `avatar_${req.params.id.slice(0,8)}.mp4`);
});

// GET /api/avatar/tasks - 任务列表
router.get('/tasks', (req, res) => {
  const tasks = [];
  avatarTasks.forEach(t => {
    if (!req.user || t.user_id === req.user.id || req.user.role === 'admin') {
      tasks.push({ id: t.id, status: t.status, text: t.text, created_at: t.created_at, videoUrl: t.videoUrl });
    }
  });
  tasks.sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json({ success: true, tasks });
});

// ═══════ 预设图片管理 ═══════

const PRESET_AVATARS = {
  'female-1': { name: '商务女性', prompt: 'Professional business woman portrait headshot, formal blazer, confident warm smile, studio lighting, soft background, upper body, photorealistic, 4K' },
  'male-1':   { name: '商务男性', prompt: 'Professional business man portrait headshot, navy suit and tie, confident expression, studio lighting, soft background, upper body, photorealistic, 4K' },
  'female-2': { name: '新闻主播', prompt: 'Female TV news anchor portrait, professional makeup, broadcast studio backdrop, elegant appearance, studio lighting, upper body, photorealistic, 4K' },
  'male-2':   { name: '教育讲师', prompt: 'Male education instructor portrait, smart casual outfit, warm friendly smile, modern classroom background, upper body, photorealistic, 4K' },
  'anime-1':  { name: '动漫角色', prompt: 'Anime character portrait, colorful hair, expressive large eyes, vibrant colors, digital anime art style, detailed, upper body, 4K' }
};

const PRESET_BACKGROUNDS = {
  'office':    { name: '办公室', prompt: 'Modern corporate office interior, clean desk, large window with city skyline view, minimalist design, warm lighting, professional workspace, no people, 4K' },
  'studio':    { name: '演播室', prompt: 'Professional TV broadcast studio, blue and purple lighting, news desk, camera equipment, modern broadcast set, no people, 4K' },
  'classroom': { name: '教室', prompt: 'Modern bright classroom interior, whiteboard, neat rows of desks, educational posters on wall, natural light from windows, no people, 4K' },
  'outdoor':   { name: '户外', prompt: 'Beautiful outdoor park scene, green trees, sunlight filtering through leaves, stone pathway, flowers, peaceful natural landscape, no people, 4K' }
};

// GET /api/avatar/presets - 获取预设图片列表
router.get('/presets', (req, res) => {
  const avatars = {};
  const backgrounds = {};
  for (const [key] of Object.entries(PRESET_AVATARS)) {
    const files = fs.readdirSync(presetsDir).filter(f => f.startsWith(`avatar_${key}.`));
    avatars[key] = files.length > 0 ? `/api/avatar/preset-img/${files[0]}` : null;
  }
  for (const [key] of Object.entries(PRESET_BACKGROUNDS)) {
    const files = fs.readdirSync(presetsDir).filter(f => f.startsWith(`bg_${key}.`));
    backgrounds[key] = files.length > 0 ? `/api/avatar/preset-img/${files[0]}` : null;
  }
  res.json({ success: true, avatars, backgrounds });
});

// GET /api/avatar/preset-img/:filename - 提供预设图片
router.get('/preset-img/:filename', (req, res) => {
  const filePath = path.join(presetsDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filePath);
});

// POST /api/avatar/generate-presets - 批量生成预设图片
router.post('/generate-presets', async (req, res) => {
  const { type, keys } = req.body; // type: 'avatar'|'background'|'all', keys: optional specific keys
  const { getApiKey } = require('../services/settingsService');
  const settings = require('../services/settingsService').loadSettings();

  // 查找 image 模型
  let targetProvider = null, targetModel = null;
  for (const p of (settings.providers || [])) {
    const imgModel = (p.models || []).find(m => m.use === 'image');
    if (imgModel) { targetProvider = p; targetModel = imgModel.id; break; }
  }
  if (!targetProvider) return res.status(400).json({ success: false, error: '未配置图像生成模型，请在 AI 配置中添加 use=image 的模型' });

  const apiKey = getApiKey(targetProvider.id);
  if (!apiKey) return res.status(400).json({ success: false, error: `供应商 ${targetProvider.name} 未配置 API Key` });

  const OpenAI = require('openai');
  const axios = require('axios');
  const client = new OpenAI({ apiKey, baseURL: targetProvider.baseURL || 'https://api.openai.com/v1' });

  const results = { avatars: {}, backgrounds: {} };
  const errors = [];

  // 生成头像
  const doAvatars = type === 'avatar' || type === 'all' || !type;
  const doBgs = type === 'background' || type === 'all' || !type;

  async function generateOne(prefix, key, prompt, size) {
    try {
      const result = await client.images.generate({ model: targetModel, prompt, n: 1, size });
      const imgData = result.data?.[0];
      if (!imgData) throw new Error('No image returned');

      let filePath;
      if (imgData.url) {
        // 下载图片
        const resp = await axios.get(imgData.url, { responseType: 'arraybuffer', timeout: 30000 });
        const ext = '.png';
        filePath = path.join(presetsDir, `${prefix}_${key}${ext}`);
        fs.writeFileSync(filePath, resp.data);
      } else if (imgData.b64_json) {
        filePath = path.join(presetsDir, `${prefix}_${key}.png`);
        fs.writeFileSync(filePath, Buffer.from(imgData.b64_json, 'base64'));
      }
      return `/api/avatar/preset-img/${path.basename(filePath)}`;
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
    const bgKeys = keys?.length ? keys.filter(k => PRESET_BACKGROUNDS[k]) : Object.keys(PRESET_BACKGROUNDS);
    for (const key of bgKeys) {
      const url = await generateOne('bg', key, PRESET_BACKGROUNDS[key].prompt, '1792x1024');
      if (url) results.backgrounds[key] = url;
    }
  }

  res.json({ success: true, results, errors, model: targetModel, provider: targetProvider.id });
});

module.exports = router;
