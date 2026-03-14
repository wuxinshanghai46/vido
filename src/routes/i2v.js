const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const { generateVideoClip } = require('../services/videoService');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const I2V_IMG_DIR = path.join(OUTPUT_DIR, 'i2v_images');
const I2V_VID_DIR = path.join(OUTPUT_DIR, 'i2v_videos');

// 图片上传
const imgStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(I2V_IMG_DIR, { recursive: true });
    cb(null, I2V_IMG_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `i2v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const uploadImg = multer({
  storage: imgStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') ||
               /\.(png|jpg|jpeg|webp|bmp|gif)$/i.test(file.originalname);
    cb(null, ok);
  }
});

// 上传图片
router.post('/upload-image', uploadImg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '请上传图片文件' });
  const filename = path.basename(req.file.path);
  res.json({
    success: true,
    data: {
      filename,
      image_url: `/api/i2v/images/${filename}`,
      file_path: req.file.path
    }
  });
});

// 提供图片文件
router.get('/images/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(I2V_IMG_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  res.sendFile(filePath);
});

// 启动图生视频任务
router.post('/generate', async (req, res) => {
  const { image_url, prompt = '', duration = 5, aspect_ratio = '16:9', video_provider, video_model } = req.body;

  if (!image_url) {
    return res.status(400).json({ success: false, error: '请提供图片（上传或输入 URL）' });
  }
  if (!video_provider || !video_model) {
    return res.status(400).json({ success: false, error: '请选择视频模型' });
  }

  const taskId = uuidv4();

  // 如果是本地上传的相对路径，转成绝对 URL 以便发给 API
  // 大部分 API 需要公网 URL；本地路径仅供 demo 模式或已有公网转发时使用
  let resolvedImageUrl = image_url;
  if (image_url.startsWith('/api/i2v/images/')) {
    const fname = path.basename(image_url);
    const localPath = path.join(I2V_IMG_DIR, fname);
    if (!fs.existsSync(localPath)) {
      return res.status(400).json({ success: false, error: '上传的图片文件不存在' });
    }
    // 尝试用本机地址构建 URL（适合已有 ngrok 等转发的情况）
    const port = process.env.PORT || 3007;
    resolvedImageUrl = `http://localhost:${port}${image_url}`;
  }

  db.insertI2VTask({
    id: taskId,
    image_url,
    resolved_image_url: resolvedImageUrl,
    prompt,
    video_provider,
    video_model,
    duration,
    aspect_ratio,
    status: 'processing',
    error_message: null,
    file_path: null
  });

  res.json({ success: true, data: { taskId } });

  // 异步执行生成
  const outputDir = path.join(I2V_VID_DIR, taskId);
  fs.mkdirSync(outputDir, { recursive: true });

  generateVideoClip({
    prompt: prompt || 'Animate this image with natural motion',
    duration,
    outputDir,
    filename: 'result',
    video_provider,
    video_model,
    image_url: resolvedImageUrl,
    aspectRatio: aspect_ratio
  }).then(result => {
    db.updateI2VTask(taskId, { status: 'done', file_path: result.filePath });
    console.log(`[I2V] 任务 ${taskId.slice(0, 8)} 完成: ${result.filePath}`);
  }).catch(err => {
    db.updateI2VTask(taskId, { status: 'error', error_message: err.message });
    console.error(`[I2V] 任务 ${taskId.slice(0, 8)} 失败:`, err.message);
  });
});

// 任务列表
router.get('/tasks', (req, res) => {
  res.json({ success: true, data: db.listI2VTasks() });
});

// 任务详情
router.get('/tasks/:id', (req, res) => {
  const task = db.getI2VTask(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
  res.json({ success: true, data: task });
});

// 视频流播放
router.get('/tasks/:id/stream', (req, res) => {
  const task = db.getI2VTask(req.params.id);
  if (!task || !task.file_path || !fs.existsSync(task.file_path)) {
    return res.status(404).json({ error: '视频不存在' });
  }
  const stat = fs.statSync(task.file_path);
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
    fs.createReadStream(task.file_path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' });
    fs.createReadStream(task.file_path).pipe(res);
  }
});

// 下载视频
router.get('/tasks/:id/download', (req, res) => {
  const task = db.getI2VTask(req.params.id);
  if (!task || !task.file_path || !fs.existsSync(task.file_path)) {
    return res.status(404).json({ error: '视频不存在' });
  }
  res.download(task.file_path, `i2v_${task.id.slice(0, 8)}.mp4`);
});

// 删除任务
router.delete('/tasks/:id', (req, res) => {
  const task = db.getI2VTask(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
  // 删除视频文件
  const vidDir = path.join(I2V_VID_DIR, task.id);
  if (fs.existsSync(vidDir)) fs.rmSync(vidDir, { recursive: true, force: true });
  // 从 DB 删除
  const data = require('../models/database');
  // 直接操作
  const allData = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'vido_db.json'), 'utf8'));
  allData.i2v_tasks = (allData.i2v_tasks || []).filter(t => t.id !== req.params.id);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'vido_db.json'), JSON.stringify(allData, null, 2), 'utf8');
  res.json({ success: true });
});

module.exports = router;
