const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const ASSETS_DIR = path.join(OUTPUT_DIR, 'assets');

// 确保目录存在
['music', 'characters', 'scenes'].forEach(sub => {
  fs.mkdirSync(path.join(ASSETS_DIR, sub), { recursive: true });
});

// 上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isAudio = file.mimetype.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(file.originalname);
    const sub = isAudio ? 'music' : 'scenes';
    cb(null, path.join(ASSETS_DIR, sub));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `asset_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/assets — 列表
router.get('/', (req, res) => {
  const { type } = req.query;
  const assets = db.listAssets(req.user.id, type || 'all');
  res.json({ success: true, data: assets });
});

// GET /api/assets/:id — 详情
router.get('/:id', (req, res) => {
  const asset = db.getAsset(req.params.id);
  if (!asset) return res.status(404).json({ success: false, error: '素材不存在' });
  res.json({ success: true, data: asset });
});

// POST /api/assets/upload — 上传素材
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '请选择文件' });

  const isAudio = req.file.mimetype.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(req.file.originalname);
  const type = isAudio ? 'music' : (req.body.type || 'scene');
  const filename = path.basename(req.file.path);

  const asset = {
    id: uuidv4(),
    user_id: req.user.id,
    type,
    name: req.body.name || req.file.originalname,
    original_name: req.file.originalname,
    file_path: req.file.path,
    file_url: `/api/assets/file/${filename}`,
    duration: null,
    source: 'uploaded',
    created_at: new Date().toISOString()
  };

  db.insertAsset(asset);
  res.json({ success: true, data: asset });
});

// POST /api/assets/trim-music — 裁剪音乐并保存
router.post('/trim-music', async (req, res) => {
  const { source_path, source_url, start, end, name } = req.body;

  // 确定源文件路径
  let srcPath = source_path;
  if (!srcPath && source_url) {
    // 从 URL 推断路径 (/api/projects/music/xxx -> outputs/music/xxx)
    const match = source_url.match(/\/music\/([^?]+)/);
    if (match) srcPath = path.join(OUTPUT_DIR, 'music', match[1]);
  }
  if (!srcPath || !fs.existsSync(srcPath)) {
    return res.status(400).json({ success: false, error: '源音乐文件不存在' });
  }
  if (start == null || end == null || end <= start) {
    return res.status(400).json({ success: false, error: '无效的裁剪范围' });
  }

  const ext = path.extname(srcPath) || '.mp3';
  const outFilename = `trim_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
  const outPath = path.join(ASSETS_DIR, 'music', outFilename);

  try {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('ffmpeg-static');
    ffmpeg.setFfmpegPath(ffmpegPath);

    await new Promise((resolve, reject) => {
      ffmpeg(srcPath)
        .setStartTime(start)
        .setDuration(end - start)
        .output(outPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const stat = fs.statSync(outPath);
    const asset = {
      id: uuidv4(),
      user_id: req.user.id,
      type: 'music',
      name: name || `裁剪片段 ${Math.floor(start)}s-${Math.floor(end)}s`,
      original_name: path.basename(srcPath),
      file_path: outPath,
      file_url: `/api/assets/file/${outFilename}`,
      duration: Math.round((end - start) * 100) / 100,
      file_size: stat.size,
      source: 'trimmed',
      trim_start: start,
      trim_end: end,
      source_ref: srcPath,
      created_at: new Date().toISOString()
    };

    db.insertAsset(asset);
    res.json({ success: true, data: asset });
  } catch (err) {
    console.error('Music trim error:', err.message);
    res.status(500).json({ success: false, error: '裁剪失败: ' + err.message });
  }
});

// POST /api/assets/import — 导入已有文件到素材库
router.post('/import', (req, res) => {
  const { type, source_path, name } = req.body;
  if (!type || !source_path) return res.status(400).json({ success: false, error: '缺少参数' });
  if (!fs.existsSync(source_path)) return res.status(400).json({ success: false, error: '文件不存在' });

  const ext = path.extname(source_path);
  const subDir = type === 'music' ? 'music' : type === 'character' ? 'characters' : 'scenes';
  const newFilename = `asset_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
  const newPath = path.join(ASSETS_DIR, subDir, newFilename);

  // 复制文件
  fs.copyFileSync(source_path, newPath);

  const asset = {
    id: uuidv4(),
    user_id: req.user.id,
    type,
    name: name || path.basename(source_path, ext),
    original_name: path.basename(source_path),
    file_path: newPath,
    file_url: `/api/assets/file/${newFilename}`,
    source: 'generated',
    created_at: new Date().toISOString()
  };

  db.insertAsset(asset);
  res.json({ success: true, data: asset });
});

// PUT /api/assets/:id — 更新
router.put('/:id', (req, res) => {
  const asset = db.getAsset(req.params.id);
  if (!asset) return res.status(404).json({ success: false, error: '素材不存在' });
  const { name, tags } = req.body;
  const fields = {};
  if (name !== undefined) fields.name = name;
  if (tags !== undefined) fields.tags = tags;
  db.updateAsset(req.params.id, fields);
  res.json({ success: true, data: { ...asset, ...fields } });
});

// DELETE /api/assets/:id — 删除
router.delete('/:id', (req, res) => {
  const asset = db.getAsset(req.params.id);
  if (!asset) return res.status(404).json({ success: false, error: '素材不存在' });
  // 删除文件
  if (asset.file_path && fs.existsSync(asset.file_path)) {
    try { fs.unlinkSync(asset.file_path); } catch {}
  }
  db.deleteAsset(req.params.id);
  res.json({ success: true });
});

module.exports = router;
