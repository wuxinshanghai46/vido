/**
 * Hifly 路由
 *   /api/hifly/avatar/*     数字人克隆
 *   /api/hifly/voice/*      声音克隆
 *   /api/hifly/video/*      视频创作（TTS / 音频驱动）
 *   /api/hifly/credit       查询积分
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const hifly = require('../services/hiflyService');

const upload = multer({
  dest: path.join(__dirname, '../../outputs/hifly-uploads'),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// 持久化产物目录（复用 jimeng-assets 已在 server.js 挂载 /public/jimeng-assets）
const outputDir = path.join(__dirname, '../../outputs/jimeng-assets');
fs.mkdirSync(outputDir, { recursive: true });

// 内存任务表
const avatarCloneTasks = new Map();  // 克隆（视频/图片 → avatar id）
const voiceCloneTasks = new Map();   // 声音克隆（音频 → voice id）
const videoCreateTasks = new Map();  // 视频创作（avatar+voice+text → mp4）

function _publicBaseUrl(req) {
  // 优先 env（生产设 PUBLIC_BASE_URL=https://vido.smsend.cn）
  const fromEnv = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:4600';
  return `${proto}://${host}`;
}

// ═══════════════════════════════════════════════
// GET /api/hifly/credit
// ═══════════════════════════════════════════════
router.get('/credit', async (req, res) => {
  try {
    const left = await hifly.getCredit();
    res.json({ success: true, credit: left });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════
// ⭐ POST /api/hifly/quick-generate
//   一键生成：text → 免费对口型数字人视频
//   body: { text, digital_human_id?, speaker_id?, title? }
//   （可选，不传走公共默认 avatar + 公共声音）
//
// 异步：先返回 VIDO taskId，后台轮询 Hifly，完成后自动下载 mp4 持久化
// ═══════════════════════════════════════════════
const quickGenTasks = new Map();

router.post('/quick-generate', async (req, res) => {
  try {
    const { text, digital_human_id, speaker_id, title = '未命名', subtitle } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ success: false, error: 'text 必填' });
    if (String(text).length > 1000) return res.status(400).json({ success: false, error: '免费路径文本上限约 1000 字，请分段' });

    const coze = require('../services/cozeService');
    const taskId = uuidv4();
    const baseUrl = _publicBaseUrl(req);
    const task = {
      id: taskId,
      status: 'submitting',
      stage: 'submit_to_hifly',
      text,
      digital_human_id: digital_human_id || coze.HIFLY_FREE_DEFAULTS.digital_human_id,
      speaker_id: speaker_id || coze.HIFLY_FREE_DEFAULTS.speaker_id,
      title,
      created_at: Date.now(),
      job_id: null,
      video_url: null,
      error: null,
    };
    quickGenTasks.set(taskId, task);
    res.json({ success: true, taskId });

    (async () => {
      try {
        // Step 1: 提交到飞影（通过 Coze bot）
        const sub = await coze.submitHiflyFreeLipsync({ text, digital_human_id: task.digital_human_id, speaker_id: task.speaker_id, subtitle });
        task.job_id = sub.job_id;
        task.stage = 'hifly_rendering';
        task.status = 'running';
        console.log(`[hifly-quick] submitted job_id=${sub.job_id} for VIDO task ${taskId}`);

        // Step 2: 轮询
        const result = await coze.waitHiflyFreeTask(sub.job_id, {
          intervalMs: 10000,
          timeoutMs: 10 * 60 * 1000,
          onProgress: (s) => {
            task.hifly_status = s.status;
            task.duration = s.duration;
          },
        });
        task.hifly_video_url = result.video_url;
        task.duration = result.duration;

        // Step 3: 下载到本地持久化
        try {
          const axios = require('axios');
          const dl = await axios.get(result.video_url, { responseType: 'arraybuffer', timeout: 300000 });
          const publicName = `hifly_quick_${taskId}.mp4`;
          fs.writeFileSync(path.join(outputDir, publicName), Buffer.from(dl.data));
          task.video_url = `${baseUrl}/public/jimeng-assets/${publicName}`;
          task.local_path = path.join(outputDir, publicName);
          console.log(`[hifly-quick] downloaded → ${task.video_url}`);
        } catch (e) {
          console.warn('[hifly-quick] 下载失败，用 Hifly 临时 URL:', e.message);
          task.video_url = result.video_url;
        }

        task.status = 'done';
        task.stage = 'done';
        task.finished_at = Date.now();
      } catch (err) {
        task.status = 'error';
        task.error = err.message;
        console.error(`[hifly-quick] VIDO task ${taskId} 失败:`, err.message);
      }
    })();
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/quick-generate/:taskId/status', (req, res) => {
  const t = quickGenTasks.get(req.params.taskId);
  if (!t) return res.status(404).json({ success: false, error: 'task not found' });
  res.json({ success: true, task: t });
});

router.get('/quick-generate/tasks', (req, res) => {
  const tasks = Array.from(quickGenTasks.values())
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 50);
  res.json({ success: true, tasks });
});

// ═══════════════════════════════════════════════
// POST /api/hifly/coze-tool  — 通用飞影工具调用（通过 Coze bot 代理）
//   body: { tool, args }
//   示例: { tool: 'get_account_credit', args: {} }
//         { tool: 'query_avatar', args: {page:1,size:20,kind:2} }
//         { tool: 'video_create_by_tts', args: {avatar, voice, text, title} }
// ═══════════════════════════════════════════════
router.post('/coze-tool', async (req, res) => {
  try {
    const { tool, args = {} } = req.body || {};
    if (!tool) return res.status(400).json({ success: false, error: 'tool 必填' });
    const coze = require('../services/cozeService');
    const result = await coze.callHiflyTool(tool, args, { timeoutMs: 10 * 60 * 1000 });
    const parsed = coze.parseHiflyResult(result);
    res.json({
      success: true,
      tool,
      parsed,
      finalAnswer: result.finalAnswer,
      toolResponseCount: (result.toolResponses || []).length,
      chat_id: result.chat_id,
      conversation_id: result.conversation_id,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════
// GET /api/hifly/avatars  (公共 avatar 列表)
// ═══════════════════════════════════════════════
router.get('/avatars', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 30;
    const kind = parseInt(req.query.kind) || 2;
    const list = await hifly.listAvatars({ page, size, kind });
    res.json({ success: true, avatars: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════
// GET /api/hifly/voices  (声音列表)
// ═══════════════════════════════════════════════
router.get('/voices', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 300;
    const list = await hifly.listVoices({ page, size });
    res.json({ success: true, voices: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════
// Helper: 把本地上传的文件写到 jimeng-assets 目录，返回可公网访问的 URL
// ═══════════════════════════════════════════════
function _moveToPublic(localPath, originalName) {
  const ext = path.extname(originalName || '').toLowerCase() || '.bin';
  const publicName = `hifly_upload_${uuidv4()}${ext}`;
  const destPath = path.join(outputDir, publicName);
  fs.copyFileSync(localPath, destPath);
  try { fs.unlinkSync(localPath); } catch {}
  return publicName;
}

// ═══════════════════════════════════════════════
// POST /api/hifly/avatar/clone-from-image
//   body: { image_url? | 上传 file } + title? + model?
//   走 Coze bot（因为 agent_token 无法直调 REST API）
// ═══════════════════════════════════════════════
router.post('/avatar/clone-from-image', upload.single('file'), async (req, res) => {
  try {
    const { title = '未命名', model = 2 } = req.body || {};
    let image_url = req.body?.image_url || null;
    if (req.file) {
      const publicName = _moveToPublic(req.file.path, req.file.originalname);
      image_url = `${_publicBaseUrl(req)}/public/jimeng-assets/${publicName}`;
    }
    if (!image_url) return res.status(400).json({ success: false, error: '需 image_url 或上传 file' });

    const cloneId = uuidv4();
    avatarCloneTasks.set(cloneId, { id: cloneId, status: 'running', stage: 'submitting', image_url, title, created_at: Date.now() });
    res.json({ success: true, taskId: cloneId });

    (async () => {
      const task = avatarCloneTasks.get(cloneId);
      try {
        const coze = require('../services/cozeService');
        const sub = await coze.submitHiflyCloneFromImage({ image_url, title, model: parseInt(model) });
        task.hifly_task_id = sub.task_id;
        task.stage = 'hifly_cloning';
        const result = await coze.waitHiflyAvatarTask(sub.task_id, { onProgress: s => { task.hifly_status = s.status; } });
        task.avatar = result.avatar;
        task.status = 'done';
        task.finished_at = Date.now();
      } catch (err) {
        task.status = 'error';
        task.error = err.message;
        console.error('[hifly/clone-image]', err.message);
      }
    })();
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════
// POST /api/hifly/avatar/clone-from-video
// ═══════════════════════════════════════════════
router.post('/avatar/clone-from-video', upload.single('file'), async (req, res) => {
  try {
    const { title = '未命名' } = req.body || {};
    let video_url = req.body?.video_url || null;
    if (req.file) {
      const publicName = _moveToPublic(req.file.path, req.file.originalname);
      video_url = `${_publicBaseUrl(req)}/public/jimeng-assets/${publicName}`;
    }
    if (!video_url) return res.status(400).json({ success: false, error: '需 video_url 或上传 file' });

    const cloneId = uuidv4();
    avatarCloneTasks.set(cloneId, { id: cloneId, status: 'running', stage: 'submitting', video_url, title, created_at: Date.now() });
    res.json({ success: true, taskId: cloneId });

    (async () => {
      const task = avatarCloneTasks.get(cloneId);
      try {
        const coze = require('../services/cozeService');
        const sub = await coze.submitHiflyCloneFromVideo({ video_url, title });
        task.hifly_task_id = sub.task_id;
        task.stage = 'hifly_cloning';
        const result = await coze.waitHiflyAvatarTask(sub.task_id, {
          timeoutMs: 20 * 60 * 1000,
          onProgress: s => { task.hifly_status = s.status; }
        });
        task.avatar = result.avatar;
        task.status = 'done';
        task.finished_at = Date.now();
      } catch (err) {
        task.status = 'error';
        task.error = err.message;
        console.error('[hifly/clone-video]', err.message);
      }
    })();
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════
// GET /api/hifly/avatar/tasks/:id
// ═══════════════════════════════════════════════
router.get('/avatar/tasks/:id', (req, res) => {
  const t = avatarCloneTasks.get(req.params.id);
  if (!t) return res.status(404).json({ success: false, error: 'task not found' });
  res.json({ success: true, task: t });
});

router.get('/avatar/tasks', (req, res) => {
  const tasks = Array.from(avatarCloneTasks.values()).sort((a, b) => b.created_at - a.created_at).slice(0, 50);
  res.json({ success: true, tasks });
});

// ═══════════════════════════════════════════════
// POST /api/hifly/voice/clone
// ═══════════════════════════════════════════════
router.post('/voice/clone', upload.single('file'), async (req, res) => {
  try {
    const { title, languages } = req.body || {};
    if (!title) return res.status(400).json({ success: false, error: 'title 必填' });
    let audio_url = req.body?.audio_url || null;
    if (req.file) {
      const publicName = _moveToPublic(req.file.path, req.file.originalname);
      audio_url = `${_publicBaseUrl(req)}/public/jimeng-assets/${publicName}`;
    }
    if (!audio_url) return res.status(400).json({ success: false, error: '需 audio_url 或上传 file' });

    const cloneId = uuidv4();
    voiceCloneTasks.set(cloneId, { id: cloneId, status: 'running', stage: 'submitting', title, audio_url, created_at: Date.now() });
    res.json({ success: true, taskId: cloneId });

    (async () => {
      const task = voiceCloneTasks.get(cloneId);
      try {
        const coze = require('../services/cozeService');
        const sub = await coze.submitHiflyVoiceClone({ audio_url, title, languages });
        task.hifly_task_id = sub.task_id;
        task.stage = 'hifly_cloning';
        const result = await coze.waitHiflyVoiceTask(sub.task_id, { onProgress: s => { task.hifly_status = s.status; } });
        task.voice = result.voice;
        task.demo_url = result.demo_url;
        task.status = 'done';
        task.finished_at = Date.now();
      } catch (err) {
        task.status = 'error';
        task.error = err.message;
        console.error('[hifly/voice-clone]', err.message);
      }
    })();
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/voice/tasks', (req, res) => {
  const tasks = Array.from(voiceCloneTasks.values()).sort((a, b) => b.created_at - a.created_at).slice(0, 50);
  res.json({ success: true, tasks });
});

router.get('/voice/tasks/:id', (req, res) => {
  const t = voiceCloneTasks.get(req.params.id);
  if (!t) return res.status(404).json({ success: false, error: 'task not found' });
  res.json({ success: true, task: t });
});

// ═══════════════════════════════════════════════
// POST /api/hifly/video/create-by-tts
//   body: { avatar, voice, text, title?, subtitle?: {...} }
//   会异步轮询，完成后把结果 mp4 下载到 jimeng-assets 持久化
// ═══════════════════════════════════════════════
router.post('/video/create-by-tts', async (req, res) => {
  try {
    const { avatar, voice, text, title = '未命名', subtitle } = req.body || {};
    if (!avatar || !voice || !text) return res.status(400).json({ success: false, error: 'avatar / voice / text 均必填' });

    const taskId = uuidv4();
    const baseUrl = _publicBaseUrl(req);
    videoCreateTasks.set(taskId, { id: taskId, status: 'running', stage: 'submitting', avatar, voice, created_at: Date.now() });
    res.json({ success: true, taskId });

    (async () => {
      const task = videoCreateTasks.get(taskId);
      try {
        const hiflyTaskId = await hifly.createVideoByTTS({ avatar, voice, text, title, subtitle });
        task.hifly_task_id = hiflyTaskId;
        task.stage = 'hifly_rendering';
        const result = await hifly.waitVideoTask(hiflyTaskId, {
          onProgress: s => { task.stage = s.label; },
        });
        task.hifly_video_url = result.video_url;
        task.duration = result.duration;

        // 下载到本地持久化（Hifly 视频 URL 是临时带 query 的，必须尽快转存）
        try {
          const dl = await axios.get(result.video_url, { responseType: 'arraybuffer', timeout: 300000 });
          const publicName = `hifly_${taskId}.mp4`;
          fs.writeFileSync(path.join(outputDir, publicName), Buffer.from(dl.data));
          task.video_url = `${baseUrl}/public/jimeng-assets/${publicName}`;
          task.local_path = path.join(outputDir, publicName);
        } catch (e) {
          console.warn('[hifly] 下载视频失败，保留临时 URL:', e.message);
          task.video_url = result.video_url;
        }
        task.status = 'done';
        task.finished_at = Date.now();
      } catch (err) {
        task.status = 'error';
        task.error = err.message;
      }
    })();
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/video/create-by-audio', upload.single('file'), async (req, res) => {
  try {
    const { avatar, audio_url, title = '未命名' } = req.body || {};
    if (!avatar) return res.status(400).json({ success: false, error: 'avatar 必填' });

    let file_id = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname).replace('.', '') || 'mp3';
      file_id = await hifly.uploadFile({ filePath: req.file.path, fileExtension: ext });
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    if (!audio_url && !file_id) return res.status(400).json({ success: false, error: '需 audio_url 或上传 file' });

    const taskId = uuidv4();
    const baseUrl = _publicBaseUrl(req);
    videoCreateTasks.set(taskId, { id: taskId, status: 'running', stage: 'submitting', avatar, created_at: Date.now() });
    res.json({ success: true, taskId });

    (async () => {
      const task = videoCreateTasks.get(taskId);
      try {
        const hiflyTaskId = await hifly.createVideoByAudio({ audio_url, file_id, avatar, title });
        task.hifly_task_id = hiflyTaskId;
        task.stage = 'hifly_rendering';
        const result = await hifly.waitVideoTask(hiflyTaskId, {
          onProgress: s => { task.stage = s.label; },
        });
        task.hifly_video_url = result.video_url;
        task.duration = result.duration;
        try {
          const dl = await axios.get(result.video_url, { responseType: 'arraybuffer', timeout: 300000 });
          const publicName = `hifly_${taskId}.mp4`;
          fs.writeFileSync(path.join(outputDir, publicName), Buffer.from(dl.data));
          task.video_url = `${baseUrl}/public/jimeng-assets/${publicName}`;
          task.local_path = path.join(outputDir, publicName);
        } catch (e) {
          task.video_url = result.video_url;
        }
        task.status = 'done';
        task.finished_at = Date.now();
      } catch (err) {
        task.status = 'error';
        task.error = err.message;
      }
    })();
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/video/tasks/:id', (req, res) => {
  const t = videoCreateTasks.get(req.params.id);
  if (!t) return res.status(404).json({ success: false, error: 'task not found' });
  res.json({ success: true, task: t });
});

router.get('/video/tasks', (req, res) => {
  const tasks = Array.from(videoCreateTasks.values())
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 50);
  res.json({ success: true, tasks });
});

module.exports = router;
