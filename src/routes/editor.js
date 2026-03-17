const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getEdit, saveEdit } = require('../models/editStore');
const { renderWithEdits, getVideoDuration } = require('../services/editService');
const db = require('../models/database');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');

// 音乐上传
const musicStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(OUTPUT_DIR, 'music');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `${Date.now()}${ext}`);
  }
});
const uploadMusic = multer({
  storage: musicStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /audio\/(mpeg|mp3|wav|ogg|flac|aac)/.test(file.mimetype) || /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(file.originalname);
    cb(null, ok);
  }
});

// 获取项目编辑数据
router.get('/:id', (req, res) => {
  const project = db.getProject(req.params.id);
  if (!project) return res.status(404).json({ success: false, error: '项目不存在' });

  const clips = db.getClipsByProject(req.params.id).filter(c => c.status === 'done');
  const story = db.getStoryByProject(req.params.id);
  const edit = getEdit(req.params.id);
  const scenes = story?.scenes_json ? JSON.parse(story.scenes_json) : [];

  res.json({
    success: true,
    data: {
      project,
      clips,
      scenes,
      edit
    }
  });
});

// 保存编辑数据
router.put('/:id', (req, res) => {
  const { scenes_order, scene_trims, deleted_scenes, music, dialogues, voiceovers, splits } = req.body;
  const edit = getEdit(req.params.id);

  if (scenes_order !== undefined) edit.scenes_order = scenes_order;
  if (scene_trims !== undefined) edit.scene_trims = scene_trims;
  if (deleted_scenes !== undefined) edit.deleted_scenes = deleted_scenes;
  if (music !== undefined) edit.music = music;
  if (dialogues !== undefined) edit.dialogues = dialogues;
  if (voiceovers !== undefined) edit.voiceovers = voiceovers;
  if (splits !== undefined) edit.splits = splits;

  saveEdit(req.params.id, edit);
  res.json({ success: true, data: edit });
});

// 上传音乐
router.post('/:id/music', uploadMusic.single('music'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '请上传音频文件' });

  const edit = getEdit(req.params.id);
  edit.music = {
    file_path: req.file.path,
    original_name: req.file.originalname,
    volume: parseFloat(req.body.volume) || 0.5,
    loop: req.body.loop !== 'false'
  };
  saveEdit(req.params.id, edit);
  res.json({ success: true, data: { music: edit.music } });
});

// 音乐流式播放（供前端 Audio 元素加载）
router.get('/:id/music-stream', (req, res) => {
  const edit = getEdit(req.params.id);
  const filePath = edit.music?.file_path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: '音乐文件不存在' });
  }
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4' };
  const contentType = mimeMap[ext] || 'audio/mpeg';

  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(s, 10);
    const end = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
  }
});

// 删除音乐
router.delete('/:id/music', (req, res) => {
  const edit = getEdit(req.params.id);
  edit.music = null;
  saveEdit(req.params.id, edit);
  res.json({ success: true });
});

// 获取片段时长（用于裁剪 UI）
router.get('/:id/clips/:clipId/duration', async (req, res) => {
  const clip = db.getClip(req.params.clipId, req.params.id);
  if (!clip?.file_path) return res.status(404).json({ success: false, error: '片段不存在' });
  try {
    const duration = await getVideoDuration(clip.file_path);
    res.json({ success: true, data: { duration } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 渲染（重新生成加工后的视频）
const renderListeners = new Map();

router.post('/:id/render', async (req, res) => {
  const projectId = req.params.id;
  res.json({ success: true, data: { message: '渲染已开始，请监听进度' } });

  const listeners = renderListeners.get(projectId) || [];

  const emitRender = (data) => {
    listeners.forEach(r => { try { r.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} });
  };

  try {
    const finalPath = await renderWithEdits(projectId, emitRender);

    // 保存渲染结果路径到编辑数据
    const edit = getEdit(projectId);
    edit.last_render_path = finalPath;
    const { saveEdit: _saveEdit } = require('../models/editStore');
    _saveEdit(projectId, edit);

    // 创建/更新一条 "已剪辑" 项目记录
    const { v4: uuidv4 } = require('uuid');
    const originalProject = db.getProject(projectId);
    const editedId = edit.edited_project_id || uuidv4();
    const editedTitle = (originalProject?.title || '未命名') + '（已剪辑）';

    // 获取渲染视频时长
    let editedDuration = 0;
    try { editedDuration = await getVideoDuration(finalPath); } catch {}

    const existingEdited = db.getProject(editedId);
    if (existingEdited) {
      // 更新已有的剪辑项目
      db.updateProject(editedId, {
        status: 'done',
        title: editedTitle,
        duration: editedDuration,
        final_video_path: finalPath
      });
    } else {
      // 新建剪辑项目
      db.insertProject({
        id: editedId,
        type: 'edited',
        source_project_id: projectId,
        title: editedTitle,
        theme: originalProject?.theme || '',
        genre: originalProject?.genre || '',
        status: 'done',
        duration: editedDuration,
        final_video_path: finalPath,
        user_id: req.user?.id || originalProject?.user_id || null
      });
    }

    // 记录 editedId 到编辑数据，下次渲染覆盖同一条
    edit.edited_project_id = editedId;
    _saveEdit(projectId, edit);

    emitRender({ step: 'done', filePath: finalPath, editedProjectId: editedId, downloadUrl: `/api/editor/${projectId}/download-render` });
  } catch (err) {
    emitRender({ step: 'error', message: err.message });
  }
});

// SSE 渲染进度
router.get('/:id/render/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write(`data: ${JSON.stringify({ step: 'connected' })}\n\n`);
  const projectId = req.params.id;
  const list = renderListeners.get(projectId) || [];
  renderListeners.set(projectId, [...list, res]);
  req.on('close', () => {
    const updated = (renderListeners.get(projectId) || []).filter(r => r !== res);
    renderListeners.set(projectId, updated);
  });
});

// 下载渲染结果
router.get('/:id/download-render', (req, res) => {
  const edit = getEdit(req.params.id);
  if (!edit.last_render_path || !fs.existsSync(edit.last_render_path)) {
    return res.status(404).json({ success: false, error: '渲染文件不存在' });
  }
  res.download(edit.last_render_path, `${req.params.id}_edited.mp4`);
});

// 流式预览渲染结果
router.get('/:id/stream-render', (req, res) => {
  const edit = getEdit(req.params.id);
  const filePath = edit.last_render_path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: '渲染文件不存在' });
  }

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
      'Content-Type': 'video/mp4'
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
  }
});

module.exports = router;
