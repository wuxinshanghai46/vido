/**
 * Hifly 数字人 + 声音克隆 + 视频创作 API 封装
 *   文档：https://api.lingverse.co/hifly.html
 *   根端点：https://hfw-api.hifly.cc
 *   鉴权：Authorization: Bearer ${token}
 *
 * 核心流程：
 *   1. 克隆 avatar（一次，免积分）→ 得到 avatar 标识
 *   2. 克隆 voice（一次，免积分）→ 得到 voice 标识
 *   3. 反复调用 video/create_by_tts 出片（消耗积分，<=10000 字/段）
 */
const axios = require('axios');
const fs = require('fs');
const { loadSettings } = require('./settingsService');

const BASE = 'https://hfw-api.hifly.cc';
const TIMEOUT = 30000;

function getHiflyToken() {
  const settings = loadSettings();
  for (const p of (settings.providers || [])) {
    const hay = ((p.id||'') + '|' + (p.preset||'') + '|' + (p.name||'') + '|' + (p.api_url||'')).toLowerCase();
    if (hay.includes('hifly') || hay.includes('lingverse')) {
      if (p.api_key) return p.api_key;
    }
  }
  return process.env.HIFLY_TOKEN || process.env.HIFLY_AGENT_TOKEN || null;
}

function _headers() {
  const token = getHiflyToken();
  if (!token) throw new Error('未配置 Hifly token（settings 或 env HIFLY_TOKEN）');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function _post(url, body, opts = {}) {
  const r = await axios.post(BASE + url, body, { headers: _headers(), timeout: opts.timeout || TIMEOUT });
  _checkCode(r.data, url);
  return r.data;
}

async function _get(url, params, opts = {}) {
  const r = await axios.get(BASE + url, { headers: _headers(), params, timeout: opts.timeout || TIMEOUT });
  _checkCode(r.data, url);
  return r.data;
}

function _checkCode(data, url) {
  if (data && typeof data === 'object' && data.code !== undefined && data.code !== 0) {
    const err = new Error(`Hifly ${url} 业务错误 code=${data.code}: ${data.message || '-'}`);
    err.code = data.code;
    err.raw = data;
    throw err;
  }
}

// ═══════════════════════════════════════════════
// 账户 / 通用
// ═══════════════════════════════════════════════
async function getCredit() {
  const r = await _get('/api/v2/hifly/account/credit');
  return r.left;
}

async function getUploadUrl(file_extension) {
  if (!file_extension) throw new Error('file_extension 必填');
  const r = await _post('/api/v2/hifly/tool/create_upload_url', { file_extension });
  return { upload_url: r.upload_url, content_type: r.content_type, file_id: r.file_id };
}

/**
 * PUT 上传一个本地/内存文件到预签名 URL，返回 file_id
 */
async function uploadFile({ filePath, buffer, fileExtension }) {
  const { upload_url, content_type, file_id } = await getUploadUrl(fileExtension);
  const body = buffer || fs.readFileSync(filePath);
  await axios.put(upload_url, body, {
    headers: { 'Content-Type': content_type },
    maxBodyLength: Infinity, maxContentLength: Infinity,
    timeout: 600000,
  });
  return file_id;
}

// ═══════════════════════════════════════════════
// 数字人（avatar）
// ═══════════════════════════════════════════════
async function createAvatarByVideo({ video_url, file_id, title = '未命名', aigc_flag = 0 }) {
  if (!video_url && !file_id) throw new Error('video_url 与 file_id 至少一个');
  const r = await _post('/api/v2/hifly/avatar/create_by_video', { video_url, file_id, title, aigc_flag });
  return r.task_id;
}

async function createAvatarByImage({ image_url, file_id, title = '未命名', model = 2, aigc_flag = 0 }) {
  if (!image_url && !file_id) throw new Error('image_url 与 file_id 至少一个');
  const r = await _post('/api/v2/hifly/avatar/create_by_image', { image_url, file_id, title, model, aigc_flag });
  return r.task_id;
}

async function queryAvatarTask(task_id) {
  const r = await _get('/api/v2/hifly/avatar/task', { task_id });
  return { status: r.status, avatar: r.avatar, raw: r };
}

async function listAvatars({ page = 1, size = 20, kind = 2 } = {}) {
  const r = await _get('/api/v2/hifly/avatar/list', { page, size, kind });
  return r.data || [];
}

// ═══════════════════════════════════════════════
// 声音（voice）
// ═══════════════════════════════════════════════
async function createVoice({ audio_url, file_id, title, voice_type = 8, languages }) {
  if (!title) throw new Error('title 必填（<=20字）');
  if (!audio_url && !file_id) throw new Error('audio_url 与 file_id 至少一个');
  const body = { audio_url, file_id, title, voice_type };
  if (languages) body.languages = languages;
  const r = await _post('/api/v2/hifly/voice/create', body);
  return r.task_id;
}

async function editVoice({ voice, rate = '1.0', volume = '1.0', pitch = '1.0' }) {
  if (!voice) throw new Error('voice 必填');
  return await _post('/api/v2/hifly/voice/edit', { voice, rate, volume, pitch });
}

async function listVoices({ page = 1, size = 300 } = {}) {
  const r = await _get('/api/v2/hifly/voice/list', { page, size });
  return r.data || [];
}

async function queryVoiceTask(task_id) {
  const r = await _get('/api/v2/hifly/voice/task', { task_id });
  return { status: r.status, voice: r.voice, demo_url: r.demo_url, raw: r };
}

// ═══════════════════════════════════════════════
// 创作（video/audio）
// ═══════════════════════════════════════════════
async function createVideoByAudio({ audio_url, file_id, avatar, title = '未命名', aigc_flag = 0 }) {
  if (!avatar) throw new Error('avatar 必填');
  if (!audio_url && !file_id) throw new Error('audio_url 与 file_id 至少一个');
  const r = await _post('/api/v2/hifly/video/create_by_audio', { audio_url, file_id, avatar, title, aigc_flag });
  return r.task_id;
}

async function createVideoByTTS({
  voice, text, avatar, title = '未命名', aigc_flag = 0,
  subtitle = null, // { show:bool, fontName?, fontSize?, primaryColor?, outlineColor?, width?, height?, posX?, posY? }
}) {
  if (!voice) throw new Error('voice 必填');
  if (!avatar) throw new Error('avatar 必填');
  if (!text || !text.trim()) throw new Error('text 必填');
  const body = { voice, text, avatar, title, aigc_flag };
  if (subtitle && subtitle.show) {
    body.st_show = 1;
    if (subtitle.fontName) body.st_font_name = subtitle.fontName;
    if (subtitle.fontSize) body.st_font_size = subtitle.fontSize;
    if (subtitle.primaryColor) body.st_primary_color = subtitle.primaryColor;
    if (subtitle.outlineColor) body.st_outline_color = subtitle.outlineColor;
    if (subtitle.width) body.st_width = subtitle.width;
    if (subtitle.height) body.st_height = subtitle.height;
    if (subtitle.posX != null) body.st_pos_x = subtitle.posX;
    if (subtitle.posY != null) body.st_pos_y = subtitle.posY;
  }
  const r = await _post('/api/v2/hifly/video/create_by_tts', body);
  return r.task_id;
}

async function createAudioByTTS({ voice, text, title = '未命名', aigc_flag = 0 }) {
  if (!voice) throw new Error('voice 必填');
  if (!text || !text.trim()) throw new Error('text 必填');
  const r = await _post('/api/v2/hifly/audio/create_by_tts', { voice, text, title, aigc_flag });
  return r.task_id;
}

async function queryVideoTask(task_id) {
  const r = await _get('/api/v2/hifly/video/task', { task_id });
  // 注意文档里 video_Url 是大写 U
  return { status: r.status, video_url: r.video_Url || r.video_url, duration: r.duration, raw: r };
}

// ═══════════════════════════════════════════════
// 通用轮询
// ═══════════════════════════════════════════════
function _describeStatus(s) { return { 1: 'waiting', 2: 'processing', 3: 'done', 4: 'failed' }[s] || `unknown(${s})`; }

async function _wait(queryFn, task_id, { intervalMs = 5000, timeoutMs = 15 * 60 * 1000, onProgress } = {}) {
  const start = Date.now();
  let lastStatus = null;
  while (Date.now() - start < timeoutMs) {
    const s = await queryFn(task_id);
    if (s.status !== lastStatus) {
      lastStatus = s.status;
      if (onProgress) try { onProgress({ ...s, label: _describeStatus(s.status) }); } catch {}
    }
    if (s.status === 3) return s;
    if (s.status === 4) throw new Error(`Hifly 任务失败 task_id=${task_id}: ${s.raw?.message || ''}`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Hifly 任务轮询超时 task_id=${task_id}`);
}

async function waitAvatarTask(task_id, opts) { return _wait(queryAvatarTask, task_id, opts); }
async function waitVoiceTask(task_id, opts) { return _wait(queryVoiceTask, task_id, opts); }
async function waitVideoTask(task_id, opts) { return _wait(queryVideoTask, task_id, opts); }

// ═══════════════════════════════════════════════
// 一步到位封装
// ═══════════════════════════════════════════════
async function cloneAvatarFromImage(opts) {
  const tid = await createAvatarByImage(opts);
  const r = await waitAvatarTask(tid, opts);
  return { task_id: tid, avatar: r.avatar };
}

async function cloneAvatarFromVideo(opts) {
  const tid = await createAvatarByVideo(opts);
  const r = await waitAvatarTask(tid, opts);
  return { task_id: tid, avatar: r.avatar };
}

async function cloneVoice(opts) {
  const tid = await createVoice(opts);
  const r = await waitVoiceTask(tid, opts);
  return { task_id: tid, voice: r.voice, demo_url: r.demo_url };
}

async function generateVideoByTTS(opts) {
  const _started = Date.now();
  let _ok = false; let _err = null; let _tid = null; let _duration = 0;
  try {
    _tid = await createVideoByTTS(opts);
    const r = await waitVideoTask(_tid, opts);
    _duration = Number(r.duration) || 0;
    _ok = true;
    return { task_id: _tid, video_url: r.video_url, duration: r.duration };
  } catch (e) { _err = e.message; throw e; }
  finally {
    try {
      require('./tokenTracker').record({
        provider: 'hifly', model: 'hifly-tts-video',
        category: 'video', videoSeconds: _duration || (opts.text ? Math.max(3, Math.round(opts.text.length / 4)) : 0),
        durationMs: Date.now() - _started,
        status: _ok ? 'success' : 'fail', errorMsg: _err,
        userId: opts.userId, agentId: opts.agentId, requestId: _tid,
      });
    } catch {}
  }
}

async function generateVideoByAudio(opts) {
  const _started = Date.now();
  let _ok = false; let _err = null; let _tid = null; let _duration = 0;
  try {
    _tid = await createVideoByAudio(opts);
    const r = await waitVideoTask(_tid, opts);
    _duration = Number(r.duration) || 0;
    _ok = true;
    return { task_id: _tid, video_url: r.video_url, duration: r.duration };
  } catch (e) { _err = e.message; throw e; }
  finally {
    try {
      require('./tokenTracker').record({
        provider: 'hifly', model: 'hifly-audio-video',
        category: 'video', videoSeconds: _duration,
        durationMs: Date.now() - _started,
        status: _ok ? 'success' : 'fail', errorMsg: _err,
        userId: opts.userId, agentId: opts.agentId, requestId: _tid,
      });
    } catch {}
  }
}

module.exports = {
  getHiflyToken, getCredit,
  getUploadUrl, uploadFile,
  // avatar
  createAvatarByVideo, createAvatarByImage, queryAvatarTask, waitAvatarTask, listAvatars,
  cloneAvatarFromImage, cloneAvatarFromVideo,
  // voice
  createVoice, editVoice, listVoices, queryVoiceTask, waitVoiceTask,
  cloneVoice,
  // video
  createVideoByAudio, createVideoByTTS, createAudioByTTS,
  queryVideoTask, waitVideoTask,
  generateVideoByTTS, generateVideoByAudio,
};
