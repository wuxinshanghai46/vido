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
  // 支持 fx_ 和 final_ 前缀
  let filePath = path.join(fxDir, `fx_${req.params.id}.mp4`);
  if (!fs.existsSync(filePath)) filePath = path.join(fxDir, `final_${req.params.id}.mp4`);
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

// POST /api/workflow/concat — 拼接多个视频片段为一个最终视频
router.post('/concat', async (req, res) => {
  const { videoUrls } = req.body;
  if (!videoUrls || videoUrls.length === 0) return res.status(400).json({ success: false, error: '无视频片段' });

  const taskId = 'concat_' + Date.now();
  effectsTasks.set(taskId, { status: 'running', progress: 0, detail: '准备拼接...' });
  res.json({ success: true, taskId });

  (async () => {
    try {
      const ffmpeg = require('fluent-ffmpeg');
      const ffmpegStatic = require('ffmpeg-static');
      ffmpeg.setFfmpegPath(ffmpegStatic);
      try { ffmpeg.setFfprobePath(require('ffprobe-static').path); } catch {}

      const db = require('../models/database');
      const outputDir = path.resolve(process.env.OUTPUT_DIR || './outputs', 'effects');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `final_${taskId}.mp4`);

      // 解析 URL 为本地路径
      const localPaths = [];
      for (const url of videoUrls) {
        let localPath = url;
        const i2vMatch = url.match(/\/api\/i2v\/tasks\/([^/]+)\/stream/);
        const fxMatch = url.match(/\/api\/workflow\/effects\/result\/([^/]+)/);
        const projMatch = url.match(/\/api\/projects\/([^/]+)\/stream/);
        if (i2vMatch) {
          const task = db.getI2VTask?.(i2vMatch[1]);
          localPath = task?.file_path || path.join(outputDir, '..', 'i2v_videos', i2vMatch[1], 'result.mp4');
        } else if (fxMatch) {
          localPath = path.join(outputDir, `fx_${fxMatch[1]}.mp4`);
        } else if (projMatch) {
          const proj = db.getProject?.(projMatch[1]);
          localPath = proj?.final_video || proj?.video_path || '';
        }
        // 去掉 #t=0.1
        localPath = localPath.replace(/#.*$/, '');
        if (fs.existsSync(localPath)) localPaths.push(localPath);
      }

      if (localPaths.length === 0) {
        effectsTasks.set(taskId, { status: 'error', error: '无有效视频文件' });
        return;
      }

      if (localPaths.length === 1) {
        fs.copyFileSync(localPaths[0], outputPath);
        effectsTasks.set(taskId, { status: 'done', outputPath, outputUrl: `/api/workflow/effects/result/${taskId}` });
        return;
      }

      effectsTasks.set(taskId, { status: 'running', progress: 20, detail: '分析视频片段...' });

      // 获取每个视频的时长
      const ffprobeAsync = (f) => new Promise((resolve, reject) => {
        ffmpeg.ffprobe(f, (err, meta) => err ? reject(err) : resolve(meta));
      });

      const durations = [];
      for (const p of localPaths) {
        try {
          const meta = await ffprobeAsync(p);
          durations.push(meta.format?.duration || 10);
        } catch { durations.push(10); }
      }

      const FADE_DUR = 0.8; // 交叉淡入淡出时长（秒）

      effectsTasks.set(taskId, { status: 'running', progress: 30, detail: '拼接视频（交叉淡入淡出）...' });

      if (localPaths.length === 2) {
        // 两个视频：用 xfade 滤镜
        const offset = Math.max(0, durations[0] - FADE_DUR);
        await new Promise((resolve, reject) => {
          const cmd = ffmpeg();
          localPaths.forEach(p => cmd.input(p));
          cmd.complexFilter([
            `[0:v][1:v]xfade=transition=fade:duration=${FADE_DUR}:offset=${offset}[vout]`,
            `[0:a][1:a]acrossfade=d=${FADE_DUR}[aout]`
          ].join(';'))
          .outputOptions(['-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'])
          .output(outputPath)
          .on('end', resolve)
          .on('error', (err) => {
            // 音频 acrossfade 可能失败（无音轨），回退只做视频淡入淡出
            console.warn('[Concat] 带音频转场失败，回退视频转场:', err.message);
            const cmd2 = ffmpeg();
            localPaths.forEach(p => cmd2.input(p));
            cmd2.complexFilter(`[0:v][1:v]xfade=transition=fade:duration=${FADE_DUR}:offset=${offset}[vout]`)
            .outputOptions(['-map', '[vout]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-shortest'])
            .output(outputPath).on('end', resolve).on('error', reject).run();
          })
          .run();
        });
      } else {
        // 3+ 个视频：逐步 xfade 链式拼接
        let prevPath = localPaths[0];
        let prevDur = durations[0];
        for (let i = 1; i < localPaths.length; i++) {
          effectsTasks.set(taskId, { status: 'running', progress: 30 + Math.round(i / localPaths.length * 50), detail: `拼接片段 ${i+1}/${localPaths.length}...` });
          const tempOut = path.join(outputDir, `temp_${taskId}_${i}.mp4`);
          const offset = Math.max(0, prevDur - FADE_DUR);
          await new Promise((resolve, reject) => {
            const cmd = ffmpeg();
            cmd.input(prevPath).input(localPaths[i]);
            cmd.complexFilter(`[0:v][1:v]xfade=transition=fade:duration=${FADE_DUR}:offset=${offset}[vout]`)
            .outputOptions(['-map', '[vout]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-shortest'])
            .output(tempOut).on('end', resolve).on('error', reject).run();
          });
          // 清理上一轮临时文件
          if (i > 1) try { fs.unlinkSync(prevPath); } catch {}
          prevPath = tempOut;
          // 获取新时长
          try { const m = await ffprobeAsync(tempOut); prevDur = m.format?.duration || prevDur + durations[i] - FADE_DUR; } catch { prevDur = prevDur + durations[i] - FADE_DUR; }
        }
        // 移动最终文件
        fs.renameSync(prevPath, outputPath);
      }

      effectsTasks.set(taskId, { status: 'done', outputPath, outputUrl: `/api/workflow/effects/result/${taskId}` });
    } catch (e) {
      console.error('[Concat] 拼接失败:', e.message);
      effectsTasks.set(taskId, { status: 'error', error: '拼接失败: ' + e.message });
    }
  })();
});

// POST /api/workflow/save-to-works — 保存合成视频到作品库
router.post('/save-to-works', (req, res) => {
  const { title, videoUrl, workflowId } = req.body;
  if (!videoUrl) return res.status(400).json({ success: false, error: '无视频URL' });

  const db = require('../models/database');
  const fxDir = path.resolve(process.env.OUTPUT_DIR || './outputs', 'effects');

  // 解析视频本地路径
  let videoPath = '';
  const fxMatch = videoUrl.match(/effects\/result\/([^#?]+)/);
  const i2vMatch = videoUrl.match(/i2v\/tasks\/([^/]+)\/stream/);
  if (fxMatch) {
    videoPath = path.join(fxDir, `fx_${fxMatch[1]}.mp4`);
    if (!fs.existsSync(videoPath)) videoPath = path.join(fxDir, `final_${fxMatch[1]}.mp4`);
  } else if (i2vMatch) {
    const task = db.getI2VTask?.(i2vMatch[1]);
    videoPath = task?.file_path || '';
  }

  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(400).json({ success: false, error: '视频文件不存在' });
  }

  // 插入到 i2v 任务表（复用现有的作品聚合逻辑）
  const workId = 'wk_' + uuidv4().split('-')[0];
  try {
    db.insertI2VTask({
      id: workId,
      image_url: '',
      prompt: title || '工作流合成视频',
      video_provider: 'workflow',
      video_model: 'concat',
      duration: 0,
      aspect_ratio: '16:9',
      status: 'done',
      file_path: videoPath,
      user_id: req.user?.id
    });
    res.json({ success: true, workId });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

module.exports = router;
