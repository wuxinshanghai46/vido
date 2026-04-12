/**
 * 形象生成 API — 上传照片 → 生成 2D/3D 卡通形象
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const { generatePortrait, PORTRAIT_DIR } = require('../services/portraitService');
const { ownedBy, scopeUserId } = require('../middleware/auth');

// 上传目录
const UPLOAD_DIR = path.join(PORTRAIT_DIR, 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || /\.(png|jpg|jpeg|webp|bmp)$/i.test(file.originalname);
    cb(null, ok);
  }
});

// POST /api/portrait/upload — 上传照片
router.post('/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '请选择照片' });
  res.json({
    success: true,
    data: {
      filename: req.file.filename,
      image_url: `/api/portrait/image/${req.file.filename}`,
      file_path: req.file.path
    }
  });
});

// POST /api/portrait/generate — 生成卡通形象
router.post('/generate', async (req, res) => {
  try {
    const { photo_filename, dim = '2d', name = '', image_model = 'auto' } = req.body;
    if (!photo_filename) return res.status(400).json({ success: false, error: '请先上传照片' });

    const photoPath = path.join(UPLOAD_DIR, path.basename(photo_filename));
    if (!fs.existsSync(photoPath)) return res.status(404).json({ success: false, error: '照片不存在' });

    const taskId = uuidv4();
    const task = {
      id: taskId,
      user_id: req.user?.id,
      name: name || '未命名形象',
      photo_filename: photo_filename,
      photo_url: `/api/portrait/image/${photo_filename}`,
      dim,
      image_model: image_model || 'auto',
      status: 'processing',
      progress: 0,
      message: '初始化...',
      result_2d: null,
      result_3d: null,
      analysis: null
    };
    db.insertPortrait(task);
    res.json({ success: true, data: { id: taskId } });

    // 异步生成
    const genDims = dim === 'both' ? ['2d', '3d'] : [dim];

    (async () => {
      try {
        for (const d of genDims) {
          const result = await generatePortrait(photoPath, d, (update) => {
            const scaledPct = d === '2d' && genDims.length === 2
              ? Math.round(update.progress / 2)
              : d === '3d' && genDims.length === 2
                ? Math.round(50 + update.progress / 2)
                : update.progress;
            db.updatePortrait(taskId, { progress: scaledPct, message: `[${d.toUpperCase()}] ${update.message}` });
          }, image_model);

          const field = d === '3d' ? 'result_3d' : 'result_2d';
          db.updatePortrait(taskId, {
            [field]: { filename: result.filename, url: `/api/portrait/image/${result.filename}` },
            analysis: result.analysis
          });
        }
        db.updatePortrait(taskId, { status: 'done', progress: 100, message: '完成' });
      } catch (err) {
        console.error('[Portrait] 生成失败:', err);
        db.updatePortrait(taskId, { status: 'error', error_message: err.message });
      }
    })();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/portrait/list — 形象列表
router.get('/list', (req, res) => {
  const portraits = db.listPortraits(scopeUserId(req));
  res.json({ success: true, data: portraits });
});

// GET /api/portrait/:id — 形象详情
router.get('/:id', (req, res) => {
  // 排除固定路由名
  if (['list', 'upload', 'generate', 'image'].includes(req.params.id)) return res.status(404).end();
  const portrait = db.getPortrait(req.params.id);
  if (!portrait || !ownedBy(req, portrait)) return res.status(404).json({ success: false, error: '形象不存在' });
  res.json({ success: true, data: portrait });
});

// DELETE /api/portrait/:id — 删除形象
router.delete('/:id', (req, res) => {
  const portrait = db.getPortrait(req.params.id);
  if (!portrait || !ownedBy(req, portrait)) return res.status(404).json({ success: false, error: '形象不存在' });
  // 删除文件
  const filesToDelete = [
    portrait.result_2d?.filename,
    portrait.result_3d?.filename,
    portrait.photo_filename
  ].filter(Boolean);
  for (const f of filesToDelete) {
    try { fs.unlinkSync(path.join(PORTRAIT_DIR, f)); } catch {}
    try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch {}
  }
  db.deletePortrait(req.params.id);
  res.json({ success: true });
});

module.exports = router;
