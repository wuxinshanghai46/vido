const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// 上传目录
const uploadDir = path.join(__dirname, '../../outputs/avatar');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

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

module.exports = router;
