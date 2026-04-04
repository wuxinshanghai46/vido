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

// 任务存储（内存 + 数据库持久化）
const avatarTasks = new Map();
const avatarSSE = new Map();
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
  if (avatar.startsWith('/api/avatar/images/')) {
    imageUrl = path.join(uploadDir, path.basename(avatar));
  } else if (avatar.startsWith('/api/avatar/preset-img/')) {
    imageUrl = path.join(presetsDir, path.basename(avatar));
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

// POST /api/avatar/generate - 生成数字人视频（支持多段模式）
router.post('/generate', async (req, res) => {
  try {
    const { avatar, text, voiceId, ratio, model, expression, background, segments, title } = req.body;
    if (!avatar) return res.status(400).json({ success: false, error: '请选择数字人形象' });

    const { generateAvatarVideo, generateMultiSegmentVideo } = require('../services/avatarService');
    const taskId = uuidv4();

    const resolved = resolveAvatarImage(avatar);
    if (resolved.error) return res.status(400).json({ success: false, error: resolved.error });

    // 记录任务（含 ratio 和 model 以便历史记录显示）
    const taskRatio = req.body.ratio || '9:16';
    const taskModel = req.body.model || 'cogvideox-flash';
    avatarTasks.set(taskId, { id: taskId, status: 'processing', created_at: new Date().toISOString(), title: title || '', text, segments: segments || null, user_id: req.user?.id, ratio: taskRatio, model: taskModel });
    res.json({ success: true, taskId });

    const onProgress = (data) => {
      const listeners = avatarSSE.get(taskId) || [];
      listeners.forEach(r => { try { r.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} });
    };

    // 选择单段或多段生成
    const genPromise = (segments && segments.length > 1)
      ? generateMultiSegmentVideo({
          imageUrl: resolved.imageUrl,
          segments,
          voiceId: voiceId || '',
          ratio: ratio || '9:16',
          model: model || 'cogvideox-flash',
          background: background || 'office',
          onProgress
        })
      : generateAvatarVideo({
          imageUrl: resolved.imageUrl,
          text: text || '',
          voiceId: voiceId || '',
          ratio: ratio || '9:16',
          model: model || 'cogvideox-flash',
          expression: expression || 'natural',
          background: background || 'office',
          onProgress
        });

    genPromise.then(result => {
      const videoUrl = `/api/avatar/tasks/${taskId}/stream`;
      const taskData = { ...avatarTasks.get(taskId), status: 'done', videoPath: result.videoPath, videoUrl };
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

// GET /api/avatar/tasks/:id/status - REST 轮询任务状态（SSE 断线兜底）
router.get('/tasks/:id/status', (req, res) => {
  const task = avatarTasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json({ status: task.status, videoUrl: task.videoUrl || null, error: task.error || null });
});

// GET /api/avatar/tasks/:id/stream - 流式播放结果视频
router.get('/tasks/:id/stream', (req, res) => {
  const task = avatarTasks.get(req.params.id);
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
  const task = avatarTasks.get(req.params.id);
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
  'female-1': { name: '商务女性', prompt: 'AI generated portrait of a young attractive Asian woman in her mid-20s, wearing elegant white blazer, natural makeup, gentle confident smile, soft studio lighting, clean gradient background, half body shot, ultra detailed skin texture, 8K, hyperrealistic digital art' },
  'male-1':   { name: '商务男性', prompt: 'AI generated portrait of a young handsome Asian man in his late 20s, wearing slim-fit dark navy suit with open collar shirt, charming smile, modern hairstyle, soft studio lighting, clean gradient background, half body shot, ultra detailed, 8K, hyperrealistic digital art' },
  'female-2': { name: '新闻主播', prompt: 'AI generated portrait of a beautiful young Chinese woman TV news anchor in her mid-20s, professional elegant appearance, natural makeup, pearl earrings, broadcast studio soft lighting, confident warm expression, half body shot, ultra detailed, 8K, hyperrealistic' },
  'male-2':   { name: '教育讲师', prompt: 'AI generated portrait of a young friendly Asian male teacher in his early 30s, wearing smart casual sweater over button shirt, warm approachable smile, modern classroom background blurred, half body shot, ultra detailed, 8K, hyperrealistic digital art' },
  'anime-1':  { name: '动漫角色', prompt: 'Beautiful anime character portrait, young girl with flowing pastel gradient hair, large sparkling crystal eyes, delicate facial features, wearing futuristic outfit, soft glowing particles, vibrant colors, digital anime illustration, Makoto Shinkai style lighting, detailed, upper body, 4K' }
};

const BG_NEGATIVE = ', absolutely no people, no humans, no person, no characters, no figures, no faces, no body parts, empty scene only, pure environment background, uninhabited';
const PRESET_BACKGROUNDS = {
  'office':    { name: '办公室', prompt: 'Modern luxury corporate office interior, floor-to-ceiling glass windows with panoramic city skyline night view, warm ambient lighting, minimalist white desk with monitor, potted green plants, clean elegant design, empty room' + BG_NEGATIVE + ', cinematic lighting, 8K' },
  'studio':    { name: '演播室', prompt: 'Professional modern TV broadcast studio, deep blue and cyan neon accent lighting, curved LED screen wall, sleek news anchor desk, volumetric light beams, futuristic design, empty studio' + BG_NEGATIVE + ', cinematic, 8K' },
  'classroom': { name: '教室', prompt: 'Modern smart classroom interior, large interactive digital whiteboard, wooden desks arranged neatly, warm sunlight streaming through tall windows, bookshelves, educational tech atmosphere, bright and welcoming, empty classroom' + BG_NEGATIVE + ', 8K' },
  'outdoor':   { name: '户外', prompt: 'Beautiful Japanese garden outdoor scene, cherry blossom trees in full bloom, stone pathway beside a calm pond, soft golden hour sunlight, bokeh background, peaceful serene atmosphere, dreamy lighting, empty landscape' + BG_NEGATIVE + ', 8K' }
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
      userPrompt = `请基于以下草稿，扩写成一段完整的数字人口播台词（200-500字，自然口语化，必须有完整的结尾）：\n\n${draft}`;
    } else if (template && templatePrompts[template]) {
      userPrompt = templatePrompts[template];
    } else {
      userPrompt = `请为"${avatar_name}"角色生成一段在"${bg_name}"场景中的口播台词。要求：\n- 字数：200-400字\n- 风格：自然口语化，像真人在说话\n- 结构：有吸引力的开场 → 充实的内容 → 完整的结尾\n- 必须输出完整台词，不要中途截断`;
    }

    const result = await callLLM(systemPrompt, userPrompt);
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

    const result = await callLLM(systemPrompt, userPrompt);
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

module.exports = router;
