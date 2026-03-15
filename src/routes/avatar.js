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

// POST /api/avatar/generate - 生成数字人视频
router.post('/generate', async (req, res) => {
  try {
    const { avatar, text, voiceId, background, expression, gesture, ratio, resolution } = req.body;

    // 数字人视频生成需要专门的API（如 HeyGen, D-ID, Synthesia 等）
    // 目前返回待实现状态
    res.json({
      status: 'pending',
      taskId: uuidv4(),
      message: '数字人视频生成功能正在开发中。需要配置数字人 API 供应商（如 HeyGen、D-ID 等）。',
      params: { avatar, voiceId, background, expression, gesture, ratio, resolution }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/avatar/tasks - 任务列表
router.get('/tasks', (req, res) => {
  res.json({ tasks: [] });
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
