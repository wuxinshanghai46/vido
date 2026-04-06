const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../models/database');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');

// 项目创建前上传背景音乐
const musicStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(OUTPUT_DIR, 'music');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `pre_${Date.now()}${ext}`);
  }
});
const uploadMusic = multer({
  storage: musicStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('audio/') ||
               /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(file.originalname);
    cb(null, ok);
  }
});

router.post('/upload-music', uploadMusic.single('music'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '请上传音频文件' });
  const filename = path.basename(req.file.path);
  res.json({ success: true, data: { file_path: req.file.path, original_name: req.file.originalname, file_url: `/api/projects/music/${filename}` } });
});

// 提供上传音乐文件的预听
router.get('/music/:filename', (req, res) => {
  const filePath = path.join(OUTPUT_DIR, 'music', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: '文件不存在' });
  res.sendFile(filePath);
});

// AI 配乐生成
router.post('/generate-music', async (req, res) => {
  try {
    const { genre, mood, duration, scenes, projectId } = req.body;
    const { generateMusic } = require('../services/musicService');
    const result = await generateMusic({ scenes, genre, mood, duration: duration || 60, projectId: projectId || 'preview' });
    if (!result) return res.status(500).json({ success: false, error: 'AI 配乐生成失败，请配置 Suno API key 或手动上传音乐' });
    res.json({
      success: true,
      data: {
        file_path: result.filePath,
        file_url: `/api/projects/music/${path.basename(result.filePath)}`,
        source: result.source,
        prompt: result.prompt
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
const {
  createProject,
  getProjectDetails,
  listProjects,
  runFullPipeline,
  addProgressListener,
  removeProgressListener,
  cancelPipeline
} = require('../services/projectService');

router.get('/', (req, res) => {
  try {
    const all = listProjects();
    // admin 看全部，普通用户只看自己的
    const filtered = req.user?.role === 'admin' ? all : all.filter(p => p.user_id === req.user?.id);
    res.json({ success: true, data: filtered });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  const {
    title, theme, genre = 'drama', duration = 60,
    mode, custom_content, skip_parse,
    anim_style, aspect_ratio,
    music_path, music_trim_start, music_trim_end, music_volume, music_loop,
    scene_dim, char_dim,
    voice_enabled, voice_gender, voice_id, voice_speed,
    subtitle_enabled, subtitle_size, subtitle_position, subtitle_color,
    video_provider, video_model,
    creation_mode, episode_count, episode_index, previous_summary
  } = req.body;
  if (!theme) return res.status(400).json({ success: false, error: '请提供视频主题' });

  try {
    const projectId = createProject({
      type: 'original',
      title: title || theme, theme, genre, duration,
      mode: mode || 'quick',
      custom_content: custom_content || null,
      anim_style: anim_style || 'anime',
      aspect_ratio: aspect_ratio || '16:9',
      music_path: music_path || null,
      music_trim_start: music_trim_start || null,
      music_trim_end: music_trim_end || null,
      music_volume: music_volume ?? 0.5,
      music_loop: music_loop !== false,
      scene_dim: scene_dim || '2d',
      char_dim: char_dim || '2d',
      voice_enabled: !!voice_enabled,
      voice_gender: voice_gender || 'female',
      voice_id: voice_id || null,
      voice_speed: voice_speed || 1.0,
      subtitle_enabled: subtitle_enabled !== false,
      subtitle_size: subtitle_size || 32,
      subtitle_position: subtitle_position || 'bottom',
      subtitle_color: subtitle_color || 'white',
      video_provider: video_provider || null,
      video_model: video_model || null,
      creation_mode: creation_mode || 'ai',
      episode_count: episode_count || null,
      episode_index: episode_index || null,
      previous_summary: previous_summary || null,
      user_id: req.user?.id || null
    });
    res.json({ success: true, data: { projectId } });

    // 异步执行，不阻塞响应
    runFullPipeline(projectId, req.user?.id).catch(err => {
      console.error(`[Project ${projectId}] Pipeline error:`, err.message);
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const details = getProjectDetails(req.params.id);
  if (!details) return res.status(404).json({ success: false, error: '项目不存在' });
  res.json({ success: true, data: details });
});

// 取消制作
router.post('/:id/cancel', (req, res) => {
  try {
    cancelPipeline(req.params.id);
    // 返回项目最后的错误信息
    const details = getProjectDetails(req.params.id);
    const lastError = details?.error || details?.last_error || '';
    res.json({ success: true, data: { last_error: lastError } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SSE 实时进度
router.get('/:id/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(`data: ${JSON.stringify({ step: 'connected', message: '已连接进度监听' })}\n\n`);
  addProgressListener(req.params.id, res);
  req.on('close', () => removeProgressListener(req.params.id, res));
});

// 解析视频文件路径（支持原始项目和剪辑项目）
function resolveVideoPath(projectId) {
  const project = db.getProject(projectId);
  // 剪辑项目：直接使用 final_video_path
  if (project?.final_video_path && fs.existsSync(project.final_video_path)) {
    return project.final_video_path;
  }
  // 原始项目：使用 finalVideo 记录
  const details = getProjectDetails(projectId);
  if (details?.finalVideo?.file_path && fs.existsSync(details.finalVideo.file_path)) {
    return details.finalVideo.file_path;
  }
  return null;
}

// 下载最终视频（支持格式转换: ?format=mp4|webm|gif）
router.get('/:id/download', async (req, res) => {
  const filePath = resolveVideoPath(req.params.id);
  if (!filePath) return res.status(404).json({ success: false, error: '视频尚未生成完成' });

  const project = db.getProject(req.params.id);
  const format = (req.query.format || 'mp4').toLowerCase();
  const baseName = project?.title || req.params.id;

  if (format === 'mp4') {
    return res.download(filePath, `${baseName}_final.mp4`);
  }

  // 其他格式：FFmpeg 实时转换
  const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
    ? process.env.FFMPEG_PATH : require('ffmpeg-static');
  const outputDir = path.join(OUTPUT_DIR, 'exports');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const FORMAT_OPTS = {
    webm: { ext: 'webm', args: ['-c:v', 'libvpx-vp9', '-c:a', 'libopus', '-b:v', '2M', '-crf', '30'], mime: 'video/webm' },
    gif:  { ext: 'gif', args: ['-vf', 'fps=12,scale=480:-1:flags=lanczos', '-loop', '0'], mime: 'image/gif' },
    mov:  { ext: 'mov', args: ['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart'], mime: 'video/quicktime' },
  };

  const fmt = FORMAT_OPTS[format];
  if (!fmt) return res.status(400).json({ success: false, error: `不支持的格式: ${format}，可选: mp4, webm, gif, mov` });

  const outputPath = path.join(outputDir, `${req.params.id}_final.${fmt.ext}`);

  // 如果已有转换缓存，直接下载
  if (fs.existsSync(outputPath)) {
    return res.download(outputPath, `${baseName}_final.${fmt.ext}`);
  }

  try {
    const { execSync } = require('child_process');
    const args = fmt.args.join(' ');
    execSync(`"${ffmpegPath}" -i "${filePath}" ${args} -y "${outputPath}"`, { stdio: 'pipe', timeout: 300000 });
    res.download(outputPath, `${baseName}_final.${fmt.ext}`);
  } catch (err) {
    res.status(500).json({ success: false, error: `格式转换失败: ${err.message}` });
  }
});

// 流式播放最终视频（支持 Range 请求，浏览器原生播放）
router.get('/:id/stream', (req, res) => {
  const filePath = resolveVideoPath(req.params.id);
  if (!filePath) return res.status(404).json({ success: false, error: '视频尚未生成完成' });

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  const etag = `"${stat.mtimeMs}-${fileSize}"`;
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-cache',
      'ETag': etag
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'ETag': etag
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// 流式播放单个场景片段
router.get('/:id/clips/:clipId/stream', (req, res) => {
  const clip = db.getClip(req.params.clipId, req.params.id);
  if (!clip?.file_path || !fs.existsSync(clip.file_path)) {
    return res.status(404).json({ success: false, error: '片段不存在' });
  }

  const stat = fs.statSync(clip.file_path);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4'
    });
    fs.createReadStream(clip.file_path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(clip.file_path).pipe(res);
  }
});

// 预览片段（兼容旧接口）
// 删除项目
router.delete('/:id', (req, res) => {
  const project = db.getProject(req.params.id);
  if (!project) return res.status(404).json({ success: false, error: '项目不存在' });
  // 仅允许项目所有者或管理员删除
  if (project.user_id && project.user_id !== req.user?.id && req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: '无权删除此项目' });
  }
  // 清理视频文件
  const projectDir = path.join(OUTPUT_DIR, 'projects');
  const patterns = [`${req.params.id}_final.mp4`, `${req.params.id}_*.mp4`];
  try {
    const files = fs.readdirSync(projectDir).filter(f => f.startsWith(req.params.id));
    files.forEach(f => { try { fs.unlinkSync(path.join(projectDir, f)); } catch {} });
  } catch {}
  db.deleteProject(req.params.id);
  res.json({ success: true });
});

router.get('/:id/clips/:clipId/preview', (req, res) => {
  const clip = db.getClip(req.params.clipId, req.params.id);
  if (!clip?.file_path || !fs.existsSync(clip.file_path)) {
    return res.status(404).json({ success: false, error: '片段不存在' });
  }
  res.setHeader('Content-Type', 'video/mp4');
  fs.createReadStream(clip.file_path).pipe(res);
});

module.exports = router;
