const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.resolve(process.env.OUTPUT_DIR || './outputs', 'workflow_db.json');

function loadDB() {
  if (fs.existsSync(DB_PATH)) {
    try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch {}
  }
  return { workflows: [] };
}

function saveDB(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// POST /api/workflow/save — 保存工作流
router.post('/save', (req, res) => {
  const { id, name, drawflow } = req.body;
  const db = loadDB();
  const userId = req.user?.id || null;

  if (id) {
    // 更新已有工作流
    const idx = db.workflows.findIndex(w => w.id === id);
    if (idx >= 0) {
      db.workflows[idx].name = name || db.workflows[idx].name;
      db.workflows[idx].drawflow = drawflow;
      db.workflows[idx].updated_at = new Date().toISOString();
      saveDB(db);
      return res.json({ success: true, data: db.workflows[idx] });
    }
  }

  // 创建新工作流
  const wf = {
    id: 'wf_' + uuidv4().split('-')[0],
    name: name || '未命名项目',
    drawflow,
    user_id: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.workflows.push(wf);
  saveDB(db);
  res.json({ success: true, data: wf });
});

// GET /api/workflow/:id — 加载工作流
router.get('/:id', (req, res) => {
  const db = loadDB();
  const wf = db.workflows.find(w => w.id === req.params.id);
  if (!wf) return res.status(404).json({ success: false, error: '工作流不存在' });
  res.json({ success: true, data: wf });
});

// GET /api/workflow — 列表
router.get('/', (req, res) => {
  const db = loadDB();
  const userId = req.user?.id || null;
  const list = userId
    ? db.workflows.filter(w => w.user_id === userId || !w.user_id)
    : db.workflows;
  res.json({ success: true, data: list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).map(w => ({
    id: w.id, name: w.name, drawflow: w.drawflow,
    created_at: w.created_at, updated_at: w.updated_at
  })) });
});

// DELETE /api/workflow/:id
router.delete('/:id', (req, res) => {
  const db = loadDB();
  const idx = db.workflows.findIndex(w => w.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: '不存在' });
  db.workflows.splice(idx, 1);
  saveDB(db);
  res.json({ success: true });
});

// 活跃的 pipeline 任务进度
const pipelineProgress = new Map();

// POST /api/workflow/execute — 自动执行 pipeline（异步，返回任务ID）
router.post('/execute', (req, res) => {
  const { text, style = '2d', sceneCount = 6, genre = 'drama', aspectRatio = '16:9', resolution = '2K' } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, error: '请提供内容文本' });
  }

  const taskId = 'pipe_' + Date.now();
  pipelineProgress.set(taskId, { status: 'running', stage: 'init', detail: '启动中...', progress: 0 });

  const { executePipeline } = require('../services/pipelineService');

  // 异步执行，不阻塞响应
  executePipeline({
    text: text.trim(),
    style, sceneCount, genre, aspectRatio, resolution,
    onProgress: (stage, detail, progress) => {
      pipelineProgress.set(taskId, { status: 'running', stage, detail, progress });
    }
  }).then(result => {
    pipelineProgress.set(taskId, { status: 'done', result, progress: 100, detail: '完成' });
  }).catch(e => {
    pipelineProgress.set(taskId, { status: 'error', error: e.message, progress: -1 });
  });

  res.json({ success: true, taskId });
});

// GET /api/workflow/execute/:taskId — 轮询 pipeline 进度
router.get('/execute/:taskId', (req, res) => {
  const data = pipelineProgress.get(req.params.taskId);
  if (!data) return res.status(404).json({ success: false, error: '任务不存在' });
  res.json({ success: true, data });
  // 完成后清理
  if (data.status === 'done' || data.status === 'error') {
    setTimeout(() => pipelineProgress.delete(req.params.taskId), 60000);
  }
});

// POST /api/workflow/refine-video-prompt — AI 优化视频提示词
router.post('/refine-video-prompt', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ success: false, error: '请提供原始提示词' });
  try {
    const { callLLM } = require('../services/storyService');
    const system = `You are a professional AI video prompt engineer. Refine the user's rough description into a detailed, cinematic video generation prompt.

Include: visual style, lighting (direction, color temperature, shadows), camera movement (pan/tilt/dolly/crane/tracking/handheld), character details, action choreography, atmosphere, particle effects, color grading.
For action/fighting: emphasize dynamic motion blur, impact sparks, speed lines, debris, dramatic angles.
Output ONLY the refined prompt in English, under 300 words. No explanation.`;
    const refined = await callLLM(system, `Refine this into a professional video AI prompt:\n\n${prompt.trim()}`);
    res.json({ success: true, prompt: refined.trim() });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ═══ 后期特效 API ═══

const multer = require('multer');
const effectsUploadDir = path.resolve(process.env.OUTPUT_DIR || './outputs', 'effects_assets');
if (!fs.existsSync(effectsUploadDir)) fs.mkdirSync(effectsUploadDir, { recursive: true });
const effectsUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, effectsUploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '')}`)
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// GET /api/workflow/effects/presets — 获取特效预设列表
router.get('/effects/presets', (req, res) => {
  const { getPresetsInfo } = require('../services/effectsService');
  res.json({ success: true, data: getPresetsInfo() });
});

// POST /api/workflow/effects/upload — 上传特效素材（产品图/BGM）
router.post('/effects/upload', effectsUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '未上传文件' });
  const filePath = req.file.path;
  const fileUrl = `/api/workflow/effects/assets/${req.file.filename}`;
  res.json({ success: true, data: { filename: req.file.filename, path: filePath, url: fileUrl } });
});

// GET /api/workflow/effects/assets/:filename — 提供特效素材文件
router.get('/effects/assets/:filename', (req, res) => {
  const filePath = path.join(effectsUploadDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filePath);
});

// 活跃的特效任务
const effectsTasks = new Map();

// POST /api/workflow/effects/apply — 应用特效到视频
router.post('/effects/apply', async (req, res) => {
  const { videoUrl, texts, images, pointers, bgm, template } = req.body;
  if (!videoUrl) return res.status(400).json({ success: false, error: '请提供视频路径' });

  const taskId = 'fx_' + Date.now();
  effectsTasks.set(taskId, { status: 'running', progress: 0, detail: '启动中...' });
  res.json({ success: true, taskId });

  // 异步执行
  (async () => {
    try {
      const { applyEffects, applyEcommerceTemplate } = require('../services/effectsService');

      // 解析视频路径：可能是 /api/... URL 或绝对路径
      let videoPath = videoUrl;
      const avatarMatch = videoUrl.match(/\/api\/avatar\/tasks\/([^/]+)\/stream/);
      const projectMatch = videoUrl.match(/\/api\/projects\/([^/]+)\/stream/);
      const i2vMatch = videoUrl.match(/\/api\/i2v\/tasks\/([^/]+)\/stream/);
      const fxMatch = videoUrl.match(/\/api\/workflow\/effects\/result\/([^/]+)/);

      if (avatarMatch) {
        // 从 avatar 任务获取视频路径
        const db = require('../models/database');
        const task = db.getAvatarTask(avatarMatch[1]);
        if (task?.videoPath) videoPath = task.videoPath;
      } else if (projectMatch) {
        const db = require('../models/database');
        const project = db.getProject(projectMatch[1]);
        if (project?.video_path) videoPath = project.video_path;
      } else if (i2vMatch) {
        const db = require('../models/database');
        const task = db.getI2VTask?.(i2vMatch[1]);
        if (task?.file_path) videoPath = task.file_path;
        else if (task?.videoPath) videoPath = task.videoPath;
      } else if (fxMatch) {
        const fxDir = path.resolve(process.env.OUTPUT_DIR || './outputs', 'effects');
        videoPath = path.join(fxDir, `fx_${fxMatch[1]}.mp4`);
      }

      if (!fs.existsSync(videoPath)) {
        effectsTasks.set(taskId, { status: 'error', error: '视频文件不存在: ' + videoPath });
        return;
      }

      const onProgress = (data) => {
        effectsTasks.set(taskId, { status: 'running', ...data });
      };

      // 解析图片路径（将 URL 转换为本地路径）
      const resolvedImages = (images || []).map(img => ({
        ...img,
        path: img.path?.startsWith('/api/') ? path.join(effectsUploadDir, path.basename(img.path)) : img.path
      }));

      // 解析 BGM 路径
      const resolvedBgm = bgm?.path ? {
        ...bgm,
        path: bgm.path.startsWith('/api/') ? path.join(effectsUploadDir, path.basename(bgm.path)) : bgm.path
      } : null;

      let result;
      if (template === 'ecommerce') {
        result = await applyEcommerceTemplate({
          videoPath,
          title: texts?.[0]?.text || '',
          price: texts?.find(t => t.preset === 'price')?.text || '',
          promo: texts?.find(t => t.preset === 'promo')?.text || '',
          productImage: resolvedImages[0]?.path || '',
          bgmPath: resolvedBgm?.path || '',
          onProgress
        });
      } else {
        result = await applyEffects({
          videoPath,
          texts: texts || [],
          images: resolvedImages,
          pointers: pointers || [],
          bgm: resolvedBgm,
          onProgress
        });
      }

      const resultUrl = `/api/workflow/effects/result/${path.basename(result.outputPath, '.mp4').replace('fx_', '')}`;
      effectsTasks.set(taskId, { status: 'done', resultUrl, outputPath: result.outputPath, duration: result.duration, progress: 100 });
    } catch (e) {
      console.error('[Effects] 特效处理失败:', e);
      effectsTasks.set(taskId, { status: 'error', error: e.message, progress: -1 });
    }
  })();
});

// GET /api/workflow/effects/status/:taskId — 轮询特效任务状态
router.get('/effects/status/:taskId', (req, res) => {
  const data = effectsTasks.get(req.params.taskId);
  if (!data) return res.status(404).json({ success: false, error: '任务不存在' });
  res.json({ success: true, data });
  if (data.status === 'done' || data.status === 'error') {
    setTimeout(() => effectsTasks.delete(req.params.taskId), 120000);
  }
});

// GET /api/workflow/effects/result/:id — 获取特效处理结果视频
router.get('/effects/result/:id', (req, res) => {
  const fxDir = path.resolve(process.env.OUTPUT_DIR || './outputs', 'effects');
  const filePath = path.join(fxDir, `fx_${req.params.id}.mp4`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '结果不存在' });

  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4'
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' });
    fs.createReadStream(filePath).pipe(res);
  }
});

module.exports = router;
