/**
 * 数字人板块 3 步向导后端
 *   /api/dh/images/generate   — Seedream 文生图（人+背景一体）
 *   /api/dh/images/upload     — 上传真人照片
 *   /api/dh/my-avatars        — 我的形象 CRUD（落 portrait_db, kind=digital_human）
 *
 *   Step3 的 AI 写稿 / 按秒拆分 / 出片 全部复用已有 /api/avatar/* 路由
 *   此处只补"形象生成 + 永久保存"这一块原先完全缺失的能力
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { execFileSync } = require('child_process');
const db = require('../models/database');
const { scopeUserId, ownedBy } = require('../middleware/auth');
const avatarService = require('../services/avatarService');
const adDigitalHumanTrackService = require('../services/adDigitalHumanTrackService');

const JIMENG_ASSETS_DIR = path.join(__dirname, '../../outputs/jimeng-assets');
const DH_IMAGES_DIR = path.join(__dirname, '../../outputs/dh-images');
const OUTPUT_ROOT_DIR = path.join(__dirname, '../../outputs');
fs.mkdirSync(JIMENG_ASSETS_DIR, { recursive: true });
fs.mkdirSync(DH_IMAGES_DIR, { recursive: true });

const productFuseTasks = new Map();

function _dhKbQuery(...parts) {
  return parts
    .flat()
    .filter(Boolean)
    .map(v => (typeof v === 'string' ? v : JSON.stringify(v)))
    .join('\n')
    .slice(0, 1800);
}

function _buildDhKbContext(scene, query, opts = {}) {
  try {
    const kb = require('../services/knowledgeBaseService');
    const ctx = kb.injectKB({
      scene,
      query,
      limit: opts.limit || 4,
      maxCharsPerDoc: opts.maxCharsPerDoc || 500,
    }) || '';
    return ctx.slice(0, opts.maxTotalChars || 4200);
  } catch (err) {
    console.warn('[DH/KB] inject skipped:', err.message);
    return '';
  }
}

function _productFuseTaskReq(req) {
  const protocol = req.protocol || 'http';
  const headers = { ...(req.headers || {}) };
  const host = req.get('host') || headers.host || 'localhost:3007';
  return {
    protocol,
    headers,
    user: req.user,
    get(name) {
      const key = String(name || '').toLowerCase();
      if (key === 'host') return host;
      return headers[key] || headers[name];
    },
    _lastProductFusion: null,
  };
}

function _patchProductFuseTask(taskId, patch = {}) {
  const current = productFuseTasks.get(taskId);
  if (!current) return;
  productFuseTasks.set(taskId, { ...current, ...patch, updatedAt: Date.now() });
}

function _publicProductFuseTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    status: task.status,
    stage: task.stage || '',
    imageUrl: task.imageUrl || '',
    topview: task.topview || null,
    error: task.error || '',
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function _toneTtsParams(tone) {
  const t = String(tone || 'natural').toLowerCase();
  const map = {
    natural: { speed: 1.0, pitch: 1.0 },
    calm: { speed: 0.96, pitch: 0.98 },
    serious: { speed: 0.97, pitch: 0.97 },
    professional: { speed: 1.0, pitch: 0.99 },
    focused: { speed: 1.01, pitch: 0.99 },
    friendly: { speed: 1.02, pitch: 1.01 },
    excited: { speed: 1.07, pitch: 1.04 },
    encouraging: { speed: 1.04, pitch: 1.03 },
    warm: { speed: 0.99, pitch: 1.01 },
    firm: { speed: 0.99, pitch: 0.98 },
    curious: { speed: 1.03, pitch: 1.03 },
    confident: { speed: 1.02, pitch: 0.98 },
    gentle: { speed: 0.97, pitch: 1.01 },
    urgent: { speed: 1.08, pitch: 1.02 },
    humorous: { speed: 1.05, pitch: 1.03 },
  };
  return map[t] || map.natural;
}

function _cleanTtsSegmentText(text) {
  return String(text || '')
    .replace(/\[[^\]]{1,80}\]/g, '')
    .replace(/（[^）]{1,80}）/g, '')
    .replace(/\([^)]{1,80}\)/g, '')
    .replace(/[·•●◆◇★☆]+/g, '，')
    .replace(/[…]{2,}|\.{3,}/g, '。')
    .replace(/[，,、]{2,}/g, '，')
    .replace(/[；;：:]{1,}/g, '，')
    .replace(/[。.!！？?]{2,}/g, '。')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[，。！？、\s]+|[，、\s]+$/g, '');
}

function _segmentPauseSeconds(seg, nextSeg) {
  const explicit = Number(seg?.pause_ms ?? seg?.pauseMs ?? seg?.pause);
  if (Number.isFinite(explicit)) return Math.max(0.04, Math.min(0.28, explicit > 2 ? explicit / 1000 : explicit));
  const tail = String(seg?.text || '').trim().slice(-1);
  const nextLen = String(nextSeg?.text || '').trim().length;
  if (/^[。！？!?]$/.test(tail)) return 0.14;
  if (/^[，,、]$/.test(tail)) return 0.07;
  return nextLen <= 8 ? 0.06 : 0.10;
}

function _tightenSpeechPauses(ffmpegPath, audioPath, { maxSilence = 0.28 } = {}) {
  if (!ffmpegPath || !audioPath || !fs.existsSync(audioPath)) return audioPath;
  const ext = path.extname(audioPath) || '.mp3';
  const outPath = audioPath.replace(new RegExp(`${ext.replace('.', '\\.')}$`), `_tight${ext}`);
  const keep = Math.max(0.12, Math.min(0.45, Number(maxSilence) || 0.28)).toFixed(2);
  try {
    execFileSync(ffmpegPath, [
      '-y',
      '-i', audioPath,
      '-af', `silenceremove=stop_periods=-1:stop_duration=0.55:stop_threshold=-48dB:stop_silence=${keep},afade=t=in:st=0:d=0.02`,
      '-c:a', 'libmp3lame',
      '-q:a', '3',
      outPath,
    ], { stdio: 'pipe', timeout: 120000 });
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 500) {
      try { fs.unlinkSync(audioPath); } catch {}
      fs.renameSync(outPath, audioPath);
    }
  } catch (err) {
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
    console.warn('[DH/segtts] pause tightening skipped:', err.message);
  }
  return audioPath;
}

async function _synthesizeSegmentedSpeech(req, { text, voiceId, segments }) {
  const usable = (Array.isArray(segments) ? segments : [])
    .map(s => ({ ...s, text: _cleanTtsSegmentText(s?.text || s?.voiceover || '') }))
    .filter(s => s?.text && String(s.text).trim())
    .slice(0, 20);
  if (usable.length < 2) return null;
  const { generateSpeech } = require('../services/ttsService');
  const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
    ? process.env.FFMPEG_PATH
    : require('ffmpeg-static');
  const workDir = path.join(JIMENG_ASSETS_DIR, `segtts_${Date.now()}_${uuidv4().slice(0, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });
  const files = [];
  let silencePath = '';
  for (let i = 0; i < usable.length; i++) {
    const seg = usable[i];
    const tone = seg.tone || seg.delivery || seg.voice_tone || 'natural';
    const p = _toneTtsParams(tone);
    const outBase = path.join(workDir, `seg_${String(i).padStart(2, '0')}`);
    const file = await generateSpeech(seg.text, outBase, { voiceId: voiceId || null, speed: p.speed, pitch: p.pitch });
    if (!file || !fs.existsSync(file)) throw new Error(`第 ${i + 1} 段语气合成失败`);
    files.push(file);
    if (i < usable.length - 1) {
      try {
        if (!silencePath) {
          silencePath = path.join(workDir, 'pause_100ms.mp3');
          execFileSync(ffmpegPath, [
            '-y',
            '-f', 'lavfi',
            '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-t', '0.10',
            '-c:a', 'libmp3lame',
            '-q:a', '5',
            silencePath,
          ], { stdio: 'pipe', timeout: 15000 });
        }
        const pauseSec = _segmentPauseSeconds(seg, usable[i + 1]);
        if (silencePath && fs.existsSync(silencePath) && pauseSec >= 0.09) files.push(silencePath);
      } catch (pauseErr) {
        console.warn('[DH/segtts] pause insert skipped:', pauseErr.message);
      }
    }
  }
  const listPath = path.join(workDir, 'concat.txt');
  fs.writeFileSync(listPath, files.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  const finalName = `segtts_${Date.now()}_${uuidv4().slice(0, 8)}.mp3`;
  const finalPath = path.join(JIMENG_ASSETS_DIR, finalName);
  execFileSync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-q:a', '3', finalPath], { stdio: 'pipe', timeout: 120000 });
  _tightenSpeechPauses(ffmpegPath, finalPath, { maxSilence: 0.28 });
  if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 500) throw new Error('分段语气音频拼接失败');
  return `${_publicBaseUrl(req)}/public/jimeng-assets/${finalName}`;
}

async function _synthesizeSegmentedSpeechFile(req, { text, voiceId, segments, outputBase }) {
  const audioUrl = await _synthesizeSegmentedSpeech(req, { text, voiceId, segments });
  if (!audioUrl) return null;
  const rel = new URL(audioUrl, _publicBaseUrl(req)).pathname;
  const source = path.join(JIMENG_ASSETS_DIR, path.basename(rel));
  if (!fs.existsSync(source)) return null;
  const target = outputBase ? outputBase.replace(/\.[^.]+$/, '') + '.mp3' : source;
  if (target !== source) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  return target;
}

function _productVoiceTone(role, index, total) {
  const r = String(role || '').toLowerCase();
  if (r === 'pain') return 'curious';
  if (r === 'closeup') return 'confident';
  if (r === 'presenter') return index >= total - 1 ? 'encouraging' : 'warm';
  if (index >= total - 1) return 'encouraging';
  if (index === 0) return 'warm';
  return 'excited';
}

function _voiceSegmentsFromKeyframes(keyframes, fallbackText = '') {
  const src = (Array.isArray(keyframes) ? keyframes : [])
    .filter(k => k?.voiceover && String(k.voiceover).trim());
  if (src.length) {
    return src.map((k, i) => ({
      text: String(k.voiceover).trim(),
      tone: k.tone || _productVoiceTone(k.role, i, src.length),
    }));
  }
  return _fallbackGuideSegments(fallbackText, 18).map((s, i, arr) => ({
    text: s.text,
    tone: _productVoiceTone('', i, arr.length),
  }));
}

function _segmentControlPrompt(seg = {}) {
  const tone = seg.tone || seg.delivery || seg.voice_tone || 'natural';
  const expression = seg.expression || 'natural';
  const motion = seg.motion || 'natural speaking, subtle head movement';
  const camera = seg.camera || 'static';
  return [
    `Delivery tone: ${tone}.`,
    `Facial expression: ${expression}.`,
    `Presenter action: ${motion}.`,
    `Camera movement: ${camera}.`,
    'The action and camera must match this exact segment, stay subtle and physically realistic.',
  ].join(' ');
}

function _productScenesFromSegments(product, segments = [], durationSec = 18) {
  const name = product?.name || product?.image_name || 'the uploaded product';
  const clean = (Array.isArray(segments) ? segments : [])
    .filter(s => s?.text && String(s.text).trim())
    .slice(0, 6);
  if (!clean.length) return null;
  const fallbackDur = Math.max(3, Math.round((Number(durationSec) || 18) / clean.length));
  return clean.map((s, i) => ({
    title: i === 0 ? '开场钩子' : i === clean.length - 1 ? '行动引导' : `卖点 ${i}`,
    role: i === 0 ? 'scene' : i === clean.length - 1 ? 'presenter' : i % 2 ? 'closeup' : 'pain',
    duration: Math.max(3, Math.min(8, Math.round(Number(s.duration) || (Number(s.end) - Number(s.start)) || fallbackDur))),
    voiceover: String(s.text || '').trim(),
    tone: s.tone || 'natural',
    expression: s.expression || 'natural',
    motion: s.motion || 'natural speaking',
    camera: s.camera || 'static',
    visual_prompt: [
      `Realistic ecommerce keyframe for ${name}.`,
      'Use the exact uploaded product and presenter reference, preserve identity, face, outfit and product geometry.',
      _segmentControlPrompt(s),
      'Clean TikTok-style product introduction frame, no text overlay, no watermark.',
    ].join(' '),
    video_prompt: [
      `The presenter says: ${String(s.text || '').trim()}.`,
      _segmentControlPrompt(s),
      'Keep the product visible and unchanged, natural lip-sync friendly movement, no morphing, no scene replacement.',
    ].join(' '),
  }));
}

function _splitSubtitleText(text, maxChars = 14) {
  const src = String(text || '').replace(/\s+/g, '').trim();
  if (!src) return [];
  const parts = src.match(/[^。！？!?，,；;、]+[。！？!?，,；;、]?/g) || [src];
  const out = [];
  for (const part of parts) {
    let s = part.trim();
    while (s.length > maxChars) {
      let cut = maxChars;
      const near = s.slice(0, maxChars + 4).search(/[。！？!?，,；;、]/);
      if (near >= Math.floor(maxChars * 0.55)) cut = near + 1;
      out.push(s.slice(0, cut));
      s = s.slice(cut);
    }
    if (s) out.push(s);
  }
  return out.filter(Boolean);
}

function _normalizeSubtitleSegments(segments, text) {
  const source = Array.isArray(segments) && segments.length
    ? segments
    : [{ text, start: 0, end: Math.max(1, String(text || '').length * 0.25) }];
  const normalized = [];
  let fallbackCursor = 0;
  for (const seg of source) {
    const segText = String(seg?.text || '').trim();
    if (!segText) continue;
    const chunks = _splitSubtitleText(segText, 14);
    if (!chunks.length) continue;
    const start = Number.isFinite(Number(seg.start ?? seg.startTime)) ? Number(seg.start ?? seg.startTime) : fallbackCursor;
    const rawEnd = Number(seg.end ?? seg.endTime);
    const estimated = Math.max(0.8, segText.length * 0.25);
    const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + estimated;
    const totalUnits = chunks.reduce((sum, chunk) => sum + Math.max(1, chunk.length), 0) || 1;
    let cursor = start;
    chunks.forEach((chunk, i) => {
      const isLast = i === chunks.length - 1;
      const dur = isLast ? (end - cursor) : Math.max(0.55, (end - start) * (Math.max(1, chunk.length) / totalUnits));
      const next = isLast ? end : Math.min(end - 0.05, cursor + dur);
      normalized.push({ ...seg, text: chunk, start: cursor, end: Math.max(cursor + 0.35, next) });
      cursor = next;
    });
    fallbackCursor = Math.max(fallbackCursor, end);
  }
  return normalized;
}

const upload = multer({
  dest: path.join(__dirname, '../../outputs/dh-uploads'),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype?.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(file.originalname || '');
    cb(null, ok);
  },
});

const _sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const productAdTasks = new Map();
const strictSpaceKeyframes = new Map();
const OUTPUT_SIZE_PRESETS = {
  '9:16': { standard: [720, 1280], hd: [900, 1600], fullhd: [1080, 1920] },
  '16:9': { standard: [1280, 720], hd: [1600, 900], fullhd: [1920, 1080] },
  '1:1': { standard: [1024, 1024], hd: [1280, 1280], fullhd: [1536, 1536] },
  '3:4': { standard: [768, 1024], hd: [960, 1280], fullhd: [1080, 1440] },
  '4:3': { standard: [1024, 768], hd: [1280, 960], fullhd: [1440, 1080] },
};
function _normalizeAspectRatio(v, fallback = '9:16') {
  return ['9:16', '16:9', '1:1', '3:4', '4:3'].includes(v) ? v : fallback;
}
function _normalizeOutputSize(v) {
  return ['standard', 'hd', 'fullhd'].includes(v) ? v : 'standard';
}
function _outputPixels(aspectRatio = '9:16', outputSize = 'standard') {
  const ar = _normalizeAspectRatio(aspectRatio);
  const size = _normalizeOutputSize(outputSize);
  return OUTPUT_SIZE_PRESETS[ar]?.[size] || OUTPUT_SIZE_PRESETS['9:16'].standard;
}
function _outputSizeString(aspectRatio, outputSize) {
  const [w, h] = _outputPixels(aspectRatio, outputSize);
  return `${w}x${h}`;
}

function _pickPipelineModel(stageId) {
  try {
    return require('../services/pipelineModelService').pickModelWithDefault(stageId);
  } catch {
    return null;
  }
}

class DhStrictError extends Error {
  constructor(code, stage, message, details = {}, status = 400, retryable = true) {
    super(message);
    this.name = 'DhStrictError';
    this.code = code;
    this.stage = stage;
    this.details = details;
    this.status = status;
    this.retryable = retryable;
  }
}

function _strictErrorBody(err) {
  const strict = err instanceof DhStrictError;
  return {
    success: false,
    code: strict ? err.code : 'STRICT_INTERNAL_ERROR',
    stage: strict ? err.stage : 'internal',
    error: err.message,
    message: err.message,
    details: strict ? (err.details || {}) : {},
    retryable: strict ? err.retryable !== false : false,
  };
}

function _sendStrictError(res, err) {
  const status = err instanceof DhStrictError ? (err.status || 400) : 500;
  return res.status(status).json(_strictErrorBody(err));
}

function _extractPublicError(err, fallback = '接口请求失败') {
  const raw = err?.response?.data?.error || err?.response?.data || err?.error || err;
  const source = raw && typeof raw === 'object' ? raw : err;
  const code = source?.code || source?.type || err?.code || '';
  let message = '';
  if (typeof raw === 'string') message = raw;
  else if (raw && typeof raw === 'object') {
    message = raw.message || raw.msg || raw.error_description || raw.error?.message || raw.error || '';
  }
  message = message || err?.message || fallback;
  let status = Number(err?.status || err?.response?.status || 500) || 500;
  let publicCode = code || 'INTERNAL_ERROR';
  if (String(code).toLowerCase() === 'setlimitexceeded' || /inference limit|safe experience mode|quota|rate limit/i.test(message)) {
    status = 429;
    publicCode = 'PROVIDER_LIMIT_EXCEEDED';
    message = '当前图片/视频生成模型额度已达上限，供应商服务暂停。请切换可用模型、调整供应商额度，或稍后再试。';
  }
  const body = { success: false, error: message, message, code: publicCode };
  const attempts = err?.luxuryKeyframeAttempts || err?.details?.luxuryKeyframeAttempts;
  if (Array.isArray(attempts) && attempts.length) {
    body.details = { attempts };
  }
  return { status, body };
}

function _sendApiError(res, err, fallback = '接口请求失败') {
  const { status, body } = _extractPublicError(err, fallback);
  return res.status(status).json(body);
}

function _isStrictPreviewBusinessBlock(err) {
  return err instanceof DhStrictError && [
    'KEYFRAME_TEMPLATE_COMPOSITE_REJECTED',
    'QA_KEYFRAME_FAILED',
  ].includes(err.code);
}

function _sendStrictPreviewResult(res, err) {
  const body = _strictErrorBody(err);
  if (_isStrictPreviewBusinessBlock(err)) {
    return res.status(200).json({
      ...body,
      quality_blocked: true,
      http_status: err.status || 422,
    });
  }
  return _sendStrictError(res, err);
}

function _strictProviderForModel(model) {
  const providerId = String(model?.provider_id || '').toLowerCase();
  const modelId = String(model?.model_id || '').toLowerCase();
  if (modelId === 'topview-avatar4' || modelId === 'topview-avatar4-fast' || providerId === 'topview') return 'topview';
  if (modelId === 'hifly' || modelId === 'hifly-free' || providerId === 'hifly') return 'hifly';
  if (modelId.includes('omni') || providerId === 'jimeng') return 'jimeng';
  if (providerId === 'volcengine' || providerId === 'api-key-20260404180437') return model.provider_id;
  return model?.provider_id;
}

function _pickStrictStageModel(stageId, supported = () => true) {
  const pms = require('../services/pipelineModelService');
  const list = (typeof pms.pickAllEnabled === 'function' ? pms.pickAllEnabled(stageId) : [])
    .filter(m => m && m.enabled !== false)
    .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999));
  if (!list.length) {
    throw new DhStrictError('CFG_STAGE_MISSING', 'preflight', `强制链路缺少模型配置：${stageId}`, { stage_id: stageId }, 400, false);
  }
  const model = list[0];
  if (!supported(model)) {
    throw new DhStrictError('CFG_MODEL_UNSUPPORTED', 'preflight', `${stageId} 当前模型不支持强制链路：${model.provider_id}/${model.model_id}`, { stage_id: stageId, model }, 400, false);
  }
  const providerId = _strictProviderForModel(model);
  const provider = _findEnabledProvider(providerId);
  if (!provider) {
    throw new DhStrictError('CFG_PROVIDER_AUTH_MISSING', 'preflight', `${stageId} 对应供应商未启用或缺少授权：${providerId}`, { stage_id: stageId, model, provider_id: providerId }, 400, false);
  }
  return model;
}

function _findEnabledProvider(providerId) {
  try {
    const { loadSettings } = require('../services/settingsService');
    const providers = loadSettings().providers || [];
    return providers.find(p =>
      (p.id === providerId || p.preset === providerId)
      && p.enabled !== false
      && (p.api_key || (providerId === 'topview' && process.env.TOPVIEW_API_KEY))
    ) || null;
  } catch {
    return null;
  }
}

function _strictProviderReady(providerId) {
  try {
    const { loadSettings } = require('../services/settingsService');
    const providers = loadSettings().providers || [];
    return providers.find(p => {
      const matched = p.id === providerId || p.preset === providerId;
      if (!matched || p.enabled === false) return false;
      if (providerId === 'topview') {
        return !!(p.api_key || process.env.TOPVIEW_API_KEY)
          && !!(p.topview_uid || p.api_uid || p.uid || process.env.TOPVIEW_UID);
      }
      return !!p.api_key;
    }) || null;
  } catch {
    return null;
  }
}

function _pickRunnableStrictStageModel(stageId, supported = () => true) {
  const pms = require('../services/pipelineModelService');
  const list = (typeof pms.pickAllEnabled === 'function' ? pms.pickAllEnabled(stageId) : [])
    .filter(m => m && m.enabled !== false)
    .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999));
  if (!list.length) {
    throw new DhStrictError('CFG_STAGE_MISSING', 'preflight', `${stageId} has no strict model configured`, { stage_id: stageId }, 400, false);
  }
  const rejected = [];
  for (const model of list) {
    if (!supported(model)) {
      rejected.push({ model, reason: 'unsupported' });
      continue;
    }
    const providerId = _strictProviderForModel(model);
    if (!_strictProviderReady(providerId)) {
      rejected.push({ model, provider_id: providerId, reason: 'provider_auth_missing' });
      continue;
    }
    return model;
  }
  throw new DhStrictError('CFG_NO_RUNNABLE_MODEL', 'preflight', `${stageId} has no runnable strict model`, { stage_id: stageId, candidates: list, rejected }, 400, false);
}

function _findRunnableSeedanceProvider(preferred = null) {
  try {
    const { loadSettings } = require('../services/settingsService');
    const providers = loadSettings().providers || [];
    const modelId = String(preferred?.model_id || '');
    if (preferred?.provider_id) {
      return providers.find(p => {
        if (!(p.enabled !== false && p.api_key && (p.id === preferred.provider_id || p.preset === preferred.provider_id))) return false;
        const models = Array.isArray(p.models) ? p.models : [];
        return !modelId || !models.length || models.some(m => m.id === modelId && m.enabled !== false);
      }) || null;
    }
    const candidates = providers.filter(p => p.enabled !== false && p.api_key && (
      /火山方舟|seedance|^ark$/i.test(p.name || p.id || '')
      || String(p.id || '').includes('202604')
      || (Array.isArray(p.models) && p.models.some(m => /seedance/i.test(m.id || '') || (modelId && m.id === modelId)))
    ));
    return candidates.find(p =>
      !modelId
      || (Array.isArray(p.models) && p.models.some(m => m.id === modelId && m.enabled !== false))
      || /seedance/i.test(modelId)
    ) || candidates[0] || null;
  } catch {
    return null;
  }
}

function _pipelineModelRunnable(model) {
  if (!model?.provider_id || !model?.model_id) return false;
  const providerId = String(model.provider_id).toLowerCase();
  const modelId = String(model.model_id).toLowerCase();
  if (providerId === 'topview' || modelId.startsWith('topview-')) {
    const p = _findEnabledProvider('topview');
    return !!((p?.api_key || process.env.TOPVIEW_API_KEY)
      && (p?.topview_uid || p?.api_uid || p?.uid || process.env.TOPVIEW_UID));
  }
  if (_isSeedancePipelineModel(model)) return !!_findRunnableSeedanceProvider(model);
  return !!_findEnabledProvider(model.provider_id);
}

function _pickRunnablePipelineModel(stageId) {
  try {
    const pms = require('../services/pipelineModelService');
    const list = typeof pms.pickAllEnabledWithDefault === 'function'
      ? pms.pickAllEnabledWithDefault(stageId)
      : [_pickPipelineModel(stageId)].filter(Boolean);
    return (list || []).find(_pipelineModelRunnable) || null;
  } catch {
    return null;
  }
}

function _pickRunnablePipelineModels(stageId) {
  try {
    const pms = require('../services/pipelineModelService');
    const list = typeof pms.pickAllEnabledWithDefault === 'function'
      ? pms.pickAllEnabledWithDefault(stageId)
      : [_pickPipelineModel(stageId)].filter(Boolean);
    return (list || [])
      .filter(m => m && m.enabled !== false)
      .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999))
      .filter(_pipelineModelRunnable);
  } catch {
    return [];
  }
}

function _uniquePipelineModels(models = []) {
  const seen = new Set();
  return (models || []).filter(m => {
    if (!m?.provider_id || !m?.model_id) return false;
    const key = `${m.provider_id}/${m.model_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

router.post('/products/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请选择商品图片' });
    const ext = (path.extname(req.file.originalname || '') || '.jpg').toLowerCase();
    const filename = `product_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
    const dst = path.join(JIMENG_ASSETS_DIR, filename);
    fs.copyFileSync(req.file.path, dst);
    try { fs.unlinkSync(req.file.path); } catch {}
    const base = _publicBaseUrl(req);
    const absUrl = `${base}/public/jimeng-assets/${filename}`;
    res.json({
      success: true,
      url: absUrl,
      preparedUrl: absUrl,
      cutoutUrl: '',
      name: req.file.originalname || filename,
    });
    _prepareProductAsset(dst, `product_cutout_${Date.now()}_${uuidv4().slice(0, 8)}.png`).catch(err => {
      console.warn('[DH/product-upload] async product cutout skipped:', err.message);
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/products/fuse-image', async (req, res) => {
  try {
    const { image_url, product = null } = req.body || {};
    if (!image_url) return res.status(400).json({ success: false, error: '缺少人物形象图' });
    if (!product?.image_url) return res.status(400).json({ success: false, error: '缺少商品图' });

    const imageUrl = await _generateProductIntegratedAvatarImage(req, { image_url }, product);
    if (!imageUrl) return res.status(500).json({ success: false, error: '商品数字人融合失败，请更换更清晰的人物图或商品图后重试' });
    if (_samePublicImageUrl(imageUrl, image_url)) {
      return res.status(500).json({ success: false, error: '商品数字人合成没有产生新成品图，请重新点击合成或更换更清晰的商品图' });
    }
    res.json({ success: true, imageUrl, topview: req._lastProductFusion || null });
  } catch (err) {
    console.error('[DH/product-fuse] 接口失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/products/fuse-image/async', async (req, res) => {
  try {
    const { image_url, product = null } = req.body || {};
    if (!image_url) return res.status(400).json({ success: false, error: '???????' });
    if (!product?.image_url) return res.status(400).json({ success: false, error: '?????' });

    const taskId = uuidv4();
    const taskReq = _productFuseTaskReq(req);
    productFuseTasks.set(taskId, {
      id: taskId,
      status: 'running',
      stage: '????????',
      imageUrl: '',
      topview: null,
      error: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    setTimeout(() => productFuseTasks.delete(taskId), 30 * 60 * 1000).unref?.();

    Promise.resolve()
      .then(async () => {
        const imageUrl = await _generateProductIntegratedAvatarImage(taskReq, { image_url }, product);
        if (!imageUrl) throw new Error('???????????????????????????');
        if (_samePublicImageUrl(imageUrl, image_url)) {
          throw new Error('商品数字人合成没有产生新成品图，请重新点击合成或更换更清晰的商品图');
        }
        _patchProductFuseTask(taskId, {
          status: 'done',
          stage: '??',
          imageUrl,
          topview: taskReq._lastProductFusion || null,
        });
      })
      .catch((err) => {
        console.error('[DH/product-fuse/async] failed:', err);
        _patchProductFuseTask(taskId, {
          status: 'error',
          stage: '??',
          error: err.message || '?????????',
        });
      });

    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[DH/product-fuse/async] submit failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/products/fuse-image/tasks/:taskId', (req, res) => {
  const task = productFuseTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, error: '?????????' });
  res.json({ success: true, task: _publicProductFuseTask(task) });
});



// 视觉自检：判一张图是不是真的"全身（脚到画面）"。返回 true=全身 / false=非全身 / null=判不出
// 用 zhipu glm-4v（已在 detect-gender 里用过）；若失败 fallback null（不阻塞主流程）
async function _checkIsFullBodyImage(localPath) {
  try {
    const { loadSettings, getApiKey } = require('../services/settingsService');
    const settings = loadSettings();
    const zhipu = (settings.providers || []).find(p => (p.id === 'zhipu' || p.preset === 'zhipu') && p.enabled && p.api_key);
    if (!zhipu) return null;
    const b64 = fs.readFileSync(localPath).toString('base64');
    const ext = path.extname(localPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const sys = 'You are a strict image composition checker. Reply ONLY with one token: YES or NO.';
    const user = [
      { type: 'text', text: 'Question: Does this photograph show a STANDING FULL BODY shot of one person, from head all the way to feet, with both feet/shoes clearly visible at the bottom of the frame? If the image is a headshot, half-body, waist-up, sitting pose, or the legs are cropped at the waist/hip/thigh/knee, answer NO. Reply with EXACTLY one word: YES or NO.' },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
    ];
    const r = await axios.post(`${(zhipu.api_url || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '')}/chat/completions`, {
      model: 'glm-4v-flash',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      temperature: 0,
      max_tokens: 5,
    }, {
      headers: { Authorization: 'Bearer ' + zhipu.api_key, 'Content-Type': 'application/json' },
      timeout: 25000,
    });
    const ans = String(r.data?.choices?.[0]?.message?.content || '').trim().toUpperCase();
    if (ans.startsWith('YES')) return true;
    if (ans.startsWith('NO')) return false;
    return null;
  } catch (err) {
    console.warn('[DH/images] full-body 视觉自检失败:', err.message);
    return null;
  }
}

function _imageFileToDataUrl(localPath) {
  const ext = path.extname(localPath || '').toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(localPath).toString('base64')}`;
}

async function _imageUrlToDataUrl(req, url) {
  const local = _localAssetPathFromUrl(url);
  if (local) return _imageFileToDataUrl(local);
  const buf = await _fetchImageBuffer(_absolutePublicUrl(req, url));
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function _describeAdBackgroundForGuide(req, backgroundUrl) {
  const fallback = [
    'warm luxury showroom interior with bronze and champagne-gold metallic wall panels',
    'dark vertical left partition, product/display wall centered, shelf with warm accent lights on the right, lounge chair at lower right',
    'low-key commercial lighting, warm spotlights, glossy brushed metal texture, premium material showroom atmosphere',
    'camera is straight-on wide 16:9, guide should stand on the left side without covering the central product wall',
  ].join('; ');
  try {
    const { loadSettings } = require('../services/settingsService');
    const settings = loadSettings();
    const zhipu = (settings.providers || []).find(p => (p.id === 'zhipu' || p.preset === 'zhipu') && p.enabled && p.api_key);
    if (!zhipu) return fallback;
    const dataUrl = await _imageUrlToDataUrl(req, backgroundUrl);
    const user = [
      {
        type: 'text',
        text: [
          'Describe this advertising background for placing a realistic showroom guide into it.',
          'Return one concise English paragraph under 90 words.',
          'Include: material/color palette, lighting direction, camera perspective, visible objects, where a person can stand, and what must not be covered.',
          'Do not mention models or AI.',
        ].join(' '),
      },
      { type: 'image_url', image_url: { url: dataUrl } },
    ];
    const r = await axios.post(`${(zhipu.api_url || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '')}/chat/completions`, {
      model: 'glm-4v-flash',
      messages: [{ role: 'user', content: user }],
      temperature: 0.1,
      max_tokens: 180,
    }, {
      headers: { Authorization: 'Bearer ' + zhipu.api_key, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    const text = String(r.data?.choices?.[0]?.message?.content || '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 700) : fallback;
  } catch (err) {
    console.warn('[DH/space-ad] background vision describe skipped:', err.message);
    return fallback;
  }
}

async function _analyzeGuidePlacementForBackground(req, backgroundUrl, aspectRatio = '16:9') {
  const fallback = {
    side: 'left',
    left_pct: aspectRatio === '9:16' ? 0.12 : 0.18,
    height_pct: aspectRatio === '9:16' ? 0.68 : 0.64,
    max_width_pct: aspectRatio === '9:16' ? 0.42 : 0.22,
    bottom_pct: 0,
    framing: 'thigh-up medium shot',
    lighting: 'warm low-key showroom spotlights, presenter slightly underexposed to match the room',
    clothing: 'dark matte business outfit that blends with the low-key showroom',
    avoid: 'do not cover the central display wall or stand inside glass cabinets',
    reason: 'fallback: keep presenter in the foreground and preserve the central display area',
  };
  try {
    const { loadSettings } = require('../services/settingsService');
    const settings = loadSettings();
    const zhipu = (settings.providers || []).find(p => (p.id === 'zhipu' || p.preset === 'zhipu') && p.enabled && p.api_key);
    if (!zhipu) return fallback;
    const dataUrl = await _imageUrlToDataUrl(req, backgroundUrl);
    const prompt = [
      'You are an advertising-video art director. Analyze this background and decide how a showroom presenter should be placed so the result looks like a real shot, not a pasted sticker.',
      'Return ONLY compact JSON, no markdown.',
      'Fields:',
      'side: "left" or "right";',
      'left_pct: number 0.02-0.72, the presenter cutout x position as fraction of image width;',
      'height_pct: number 0.45-0.78, visible presenter height as fraction of image height;',
      'max_width_pct: number 0.14-0.30, presenter maximum width as fraction of image width;',
      'bottom_pct: number 0-0.06;',
      'framing: short phrase like "waist-up", "thigh-up", "full-body only if floor is visible";',
      'lighting: short phrase describing exposure, color temperature, contrast and shadow;',
      'clothing: short phrase for outfit color/style that belongs in this room;',
      'avoid: what areas/objects must not be covered;',
      'reason: one short reason.',
      'Important: if there is no clear floor or walkway, choose waist-up or thigh-up foreground presenter, never a tiny full-body person. Avoid glass cabinets and display cases.',
    ].join(' ');
    const r = await axios.post(`${(zhipu.api_url || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '')}/chat/completions`, {
      model: 'glm-4v-flash',
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] }],
      temperature: 0,
      max_tokens: 260,
    }, {
      headers: { Authorization: 'Bearer ' + zhipu.api_key, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    const raw = String(r.data?.choices?.[0]?.message?.content || '').trim();
    const jsonText = (raw.match(/\{[\s\S]*\}/) || [raw])[0];
    const parsed = JSON.parse(jsonText);
    const num = (v, min, max, fb) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb;
    };
    const side = parsed.side === 'right' ? 'right' : 'left';
    return {
      side,
      left_pct: num(parsed.left_pct, 0.02, 0.72, fallback.left_pct),
      height_pct: num(parsed.height_pct, 0.45, 0.78, fallback.height_pct),
      max_width_pct: num(parsed.max_width_pct, 0.14, 0.30, fallback.max_width_pct),
      bottom_pct: num(parsed.bottom_pct, 0, 0.06, fallback.bottom_pct),
      framing: String(parsed.framing || fallback.framing).slice(0, 120),
      lighting: String(parsed.lighting || fallback.lighting).slice(0, 180),
      clothing: String(parsed.clothing || fallback.clothing).slice(0, 160),
      avoid: String(parsed.avoid || fallback.avoid).slice(0, 220),
      reason: String(parsed.reason || fallback.reason).slice(0, 180),
    };
  } catch (err) {
    console.warn('[DH/space-ad] guide placement vision analysis skipped:', err.message);
    return fallback;
  }
}

async function _checkProductVisibleInResult(req, resultPath, product, productName = '') {
  try {
    const { loadSettings } = require('../services/settingsService');
    const settings = loadSettings();
    const zhipu = (settings.providers || []).find(p => (p.id === 'zhipu' || p.preset === 'zhipu') && p.enabled && p.api_key);
    if (!zhipu || !resultPath || !fs.existsSync(resultPath)) return null;
    const productUrl = product?.image_url || product?.imageUrl || _productSourceUrl(product);
    if (!productUrl) return null;
    const productDataUrl = await _imageUrlToDataUrl(req, productUrl);
    const resultDataUrl = _imageFileToDataUrl(resultPath);
    const sys = 'You are a strict ecommerce image QA checker. Reply ONLY with YES or NO.';
    const user = [
      {
        type: 'text',
        text: [
          'Image 1 is the required product reference. Image 2 is the generated presenter image.',
          'Question: Is the product from image 1 clearly visible as a physical item in image 2?',
          `Product name hint: ${productName || product?.image_name || product?.name || 'uploaded product'}.`,
          'Answer YES only if the product or a very recognizable matching item is visibly present in the generated image.',
          'Answer NO if image 2 only shows the presenter/person, clothing text, background, or an unrelated object.',
          'Reply with exactly one word: YES or NO.',
        ].join(' '),
      },
      { type: 'image_url', image_url: { url: productDataUrl } },
      { type: 'image_url', image_url: { url: resultDataUrl } },
    ];
    const r = await axios.post(`${(zhipu.api_url || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '')}/chat/completions`, {
      model: 'glm-4v-flash',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      temperature: 0,
      max_tokens: 5,
    }, {
      headers: { Authorization: 'Bearer ' + zhipu.api_key, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    const ans = String(r.data?.choices?.[0]?.message?.content || '').trim().toUpperCase();
    if (ans.startsWith('YES')) return true;
    if (ans.startsWith('NO')) return false;
    return null;
  } catch (err) {
    console.warn('[DH/product-fuse] product visibility QA skipped:', err.message);
    return null;
  }
}

async function _checkShowroomGuideIntegration(req, backgroundUrl, resultPath, placement = null) {
  try {
    const { loadSettings } = require('../services/settingsService');
    const settings = loadSettings();
    const zhipu = (settings.providers || []).find(p => (p.id === 'zhipu' || p.preset === 'zhipu') && p.enabled && p.api_key);
    if (!zhipu || !resultPath || !fs.existsSync(resultPath)) return null;
    const bgDataUrl = await _imageUrlToDataUrl(req, backgroundUrl);
    const resultDataUrl = _imageFileToDataUrl(resultPath);
    const prompt = [
      'You are a strict advertising-video art director and compositor QA checker.',
      'Image 1 is the original showroom background. Image 2 is the generated keyframe with a showroom guide.',
      'Judge whether Image 2 looks like one coherent real camera shot, not a pasted cutout or picture-in-picture.',
      'Return ONLY compact JSON, no markdown.',
      'Schema: {"pass":boolean,"score":0-100,"has_person":boolean,"person_count":number,"gender_match":boolean,"no_picture_in_picture":boolean,"background_preserved":boolean,"issues":["short issue"],"naturalness":"short"}',
      'Hard fail if: no visible presenter, person_count is not exactly 1, wrong gender, a duplicated/reflection/poster person appears, picture-in-picture/inset/card/collage appears, the original showroom is replaced, or the result is only the background without a guide.',
      'Also fail if: the guide is a sticker/cutout, edge halo is obvious, lighting/exposure does not match, the guide stands inside a cabinet/wall/display case, or scale is implausible.',
      'Pass only when the presenter is naturally integrated into the uploaded background with believable scale, shadow, color temperature, contrast, grain and usable standing/framing logic.',
      placement?.source === 'approved_template' ? 'This candidate uses an approved presenter template composited into the scene. Do not fail merely because a presenter template was used; fail only if there is a visible rectangular card, remaining template background, obvious hard halo, implausible scale, or the original showroom background is not preserved.' : '',
      placement?.expected_gender ? `Expected presenter gender: ${placement.expected_gender}. gender_match must be true only when the visible presenter matches this expected gender.` : '',
      placement ? `Expected placement plan: ${JSON.stringify(placement)}.` : '',
    ].filter(Boolean).join(' ');
    const r = await axios.post(`${(zhipu.api_url || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '')}/chat/completions`, {
      model: 'glm-4v-flash',
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: bgDataUrl } },
        { type: 'image_url', image_url: { url: resultDataUrl } },
      ] }],
      temperature: 0,
      max_tokens: 260,
    }, {
      headers: { Authorization: 'Bearer ' + zhipu.api_key, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    const raw = String(r.data?.choices?.[0]?.message?.content || '').trim();
    const jsonText = (raw.match(/\{[\s\S]*\}/) || [raw])[0];
    const parsed = JSON.parse(jsonText);
    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map(x => String(x).slice(0, 120)).slice(0, 6)
      : [];
    const hasPerson = parsed.has_person === true;
    const rawPersonCount = Number(parsed.person_count);
    const personCount = Number.isFinite(rawPersonCount) ? rawPersonCount : null;
    const genderMatch = parsed.gender_match === false ? false : (parsed.gender_match === true ? true : null);
    const noPictureInPicture = parsed.no_picture_in_picture === false ? false : (parsed.no_picture_in_picture === true ? true : null);
    const backgroundPreserved = parsed.background_preserved === false ? false : (parsed.background_preserved === true ? true : null);
    const hardFailures = [];
    if (parsed.has_person === false) hardFailures.push('missing_presenter');
    if (personCount !== null && personCount !== 1) hardFailures.push('person_count_not_one');
    if (genderMatch === false) hardFailures.push('gender_mismatch');
    if (noPictureInPicture === false) hardFailures.push('picture_in_picture_or_inset');
    if (backgroundPreserved === false) hardFailures.push('background_not_preserved');
    const qa = {
      pass: parsed.pass === true && score >= 72,
      score,
      has_person: parsed.has_person === undefined ? null : hasPerson,
      person_count: personCount,
      gender_match: genderMatch,
      no_picture_in_picture: noPictureInPicture,
      background_preserved: backgroundPreserved,
      hard_failures: hardFailures,
      issues,
      naturalness: String(parsed.naturalness || '').slice(0, 220),
    };
    qa.pass = qa.pass && !_isHardShowroomGuideReject(qa);
    return qa;
  } catch (err) {
    console.warn('[DH/space-ad] showroom guide QA skipped:', err.message);
    return null;
  }
}

function _isHardShowroomGuideReject(qa) {
  if (!qa) return false;
  if (Array.isArray(qa.hard_failures) && qa.hard_failures.length) return true;
  if (qa.has_person === false) return true;
  if (qa.person_count !== null && qa.person_count !== undefined && Number(qa.person_count) !== 1) return true;
  if (qa.gender_match === false) return true;
  if (qa.no_picture_in_picture === false) return true;
  if (qa.background_preserved === false) return true;
  const text = [
    ...(Array.isArray(qa.issues) ? qa.issues : []),
    qa.naturalness || '',
  ].join(' ').toLowerCase();
  return [
    'duplicated',
    'duplicate',
    'more than one',
    'second person',
    'extra person',
    'two people',
    'background replaced',
    'different room',
    'wrong room',
    'tiny person',
    'inside cabinet',
    'inside a cabinet',
    'sticker',
    'cutout',
    'pasted',
    'edge halo',
    'picture-in-picture',
    'inset',
    'portrait card',
    'floating portrait',
    'missing presenter',
    'no visible presenter',
    'no person',
    'without a guide',
    'only background',
    'person absent',
    'wrong gender',
    'gender mismatch',
    'collage',
    'small inset',
    'small picture',
    'embedded image',
  ].some(x => text.includes(x));
}

function _isTemplateShowroomComposite(plan = {}) {
  const kind = String(plan?.kind || plan?.reference_mode || '').toLowerCase();
  const fusionModel = String(plan?.fusion_model || plan?.model || '').toLowerCase();
  return kind === 'showroom_guide_template_composite'
    || kind === 'template_showroom_guide'
    || fusionModel === 'deterministic-template-composite';
}

function _strictShowroomReferenceMode(plan = {}) {
  return _isTemplateShowroomComposite(plan)
    ? 'showroom_guide_template_composite'
    : 'showroom_guide_strict';
}

function _showroomGuideMotionBible({ text = '', scenePrompt = '' } = {}) {
  return [
    'Showroom guide motion bible: this is not a talking-head avatar video.',
    'The presenter must behave like an on-site docent: slow 1-2 small forward or diagonal steps, settle into a mark, torso turns toward the display wall, one hand lifts into frame, open palm points or sweeps across material/product details, then the eyes return to the camera.',
    'The background must feel like real continuous footage: a gentle dolly-in or lateral truck move, foreground/background parallax, slight change of visible wall depth, natural focus transition from presenter to material details and back.',
    'Avoid pure digital zoom, avoid static standing, avoid locked feet, avoid only head/lip movement, avoid random diagonal gaze.',
    'Keep one continuous shot, no hard cuts, no scene replacement, no extra people, no captions generated by the model.',
    scenePrompt ? `Scene intent: ${scenePrompt}` : '',
    text ? `Narration intent: ${String(text).slice(0, 240)}` : '',
  ].filter(Boolean).join(' ');
}

// 把 URL 解析成 Buffer。若指向本机 /public/jimeng-assets/ → 直接读盘（避免回环 HTTP +
// 在 PUBLIC_BASE_URL 写错时 axios.get 跨网拿不到自己的图）
async function _fetchImageBuffer(url) {
  if (!url) throw new Error('image url empty');
  // 同源静态资源：尝试直接读盘
  const localMarker = '/public/jimeng-assets/';
  const idx = url.indexOf(localMarker);
  if (idx >= 0) {
    const name = path.basename(url.slice(idx + localMarker.length).split('?')[0]);
    const local = path.join(JIMENG_ASSETS_DIR, name);
    if (fs.existsSync(local)) return fs.readFileSync(local);
  }
  if (url.startsWith('/public/')) {
    const local = path.resolve(__dirname, '..', '..', url.replace(/^\//, ''));
    if (fs.existsSync(local)) return fs.readFileSync(local);
  }
  // 远端：axios 拉
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 50 * 1024 * 1024 });
  return Buffer.from(r.data);
}

function _publicBaseUrl(req) {
  const fromEnv = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3007';
  const requestBase = `${proto}://${host}`;
  // When the app is visited through the HTTPS domain, prefer that origin over an
  // older PUBLIC_BASE_URL that still points at the raw server IP. Otherwise media
  // URLs become mixed-content HTTP links and fail in the browser.
  if (fromEnv) {
    const envHost = (() => {
      try { return new URL(fromEnv).hostname; } catch { return ''; }
    })();
    const reqHost = String(host || '').split(':')[0];
    const envIsIp = /^(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})$/.test(envHost);
    const reqIsDomain = !!reqHost && !/^(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})$/.test(reqHost);
    if (envIsIp && reqIsDomain) return requestBase;
    return fromEnv;
  }
  return requestBase;
}

function _localJimengAssetUrl(url, req) {
  if (!url) return url;
  const clean = String(url).split('?')[0];
  const marker = '/public/jimeng-assets/';
  const idx = clean.indexOf(marker);
  if (idx < 0) return url;
  const name = path.basename(clean.slice(idx + marker.length));
  if (!name) return url;
  const local = path.join(JIMENG_ASSETS_DIR, name);
  if (!fs.existsSync(local)) return url;
  return `${_publicBaseUrl(req)}/public/jimeng-assets/${name}`;
}

function _isStaleJimengAssetUrl(url) {
  return !!url && /https?:\/\/vido\.smsend\.cn\/public\/jimeng-assets\//i.test(String(url));
}

function normalizeMyAvatarAssetUrls(row, req) {
  const out = { ...row };
  out.image_url = _localJimengAssetUrl(out.image_url, req);
  out.photo_url = _localJimengAssetUrl(out.photo_url, req);
  out.sample_video_url = _localJimengAssetUrl(out.sample_video_url, req);
  out.video_url = _localJimengAssetUrl(out.video_url, req);
  out.product_image_url = _localJimengAssetUrl(out.product_image_url, req);
  return out;
}

// ═══════════════════════════════════════════════
// 人物 + 背景（完整场景）Seedream 提示词模板
// 所有 style 的 prompt 必须包含明确的 detailed background，确保画面里有完整场景而不只是纯色肖像
// ═══════════════════════════════════════════════
const STYLE_PROMPTS = {
  // 自由模式：不预设风格 / 背景，完全靠用户描述 + framing 主导
  // 给"全身"等构图指令最大主导权
  free: {
    desc: '自由（按描述生成）',
    prompt: 'realistic photograph of one single person, natural lighting, photorealistic',
    negative: 'multiple people, triptych, character sheet, multi-view, duplicated face',
  },
  idol_warm: {
    desc: '偶像暖调',
    prompt: 'beautiful magazine-cover quality photograph of one single person standing in a cozy warmly-lit interior — bright wooden cafe with hanging edison bulbs, lush green plants, soft afternoon sunlight streaming through large windows behind, bokeh background with visible depth — flawless porcelain skin, golden ratio facial proportions, warm gentle smile, stylish casual outfit, DSLR 85mm f/2.0, cinematic shallow depth of field, waist-up composition, rich environmental detail',
    negative: 'plain backdrop, empty background, studio seamless, pure color background, multiple people, triptych, character sheet, triple view, duplicated face, multi-view',
  },
  idol_cool: {
    desc: '偶像冷调',
    prompt: 'editorial magazine photograph of one single person in a sleek urban nighttime rooftop setting — distant city skyline with warm building lights, glass railings, cool blue ambient lighting, visible background with modern architecture — sharp jawline, clean flawless skin, composed confident expression, designer outfit, DSLR 85mm f/2.0, cinematic cool toning, waist-up composition with clear background depth',
    negative: 'plain backdrop, empty background, studio seamless, pure color background, multiple people, triptych, character sheet',
  },
  documentary: {
    desc: '写实纪录',
    prompt: 'authentic documentary-style photograph of one single person in their natural workspace — lived-in home studio with books, plants, warm desk lamp, art on the walls visible behind, textured realistic environment — natural skin with pores and authentic texture, genuine warm expression, everyday clothing, DSLR 50mm f/2.8, natural window light, waist-up composition, rich believable background detail',
    negative: 'plain backdrop, empty background, studio seamless, pure color background, multiple people, painting, cartoon, character sheet, triptych, multi-view',
  },
  office: {
    desc: '办公室职场',
    prompt: 'professional corporate photograph of one single person standing in a modern open-plan office — glass meeting rooms, greenery, colleagues working in soft bokeh behind, laptop and monitors visible on a clean desk, warm natural daylight — smart casual business attire, confident slight smile, well-lit face, DSLR 85mm f/2.8, shallow depth of field, waist-up composition, clear office environment visible',
    negative: 'plain backdrop, empty background, studio seamless, pure color background, multiple people, triptych, character sheet',
  },
  beach: {
    desc: '海边清新',
    prompt: 'golden hour photograph of one single person on a sunlit beach — turquoise ocean waves, soft sand, palm trees at the edge of frame, sunset colored sky with warm clouds, distant sailboats — casual summer outfit, carefree gentle smile, sun-kissed skin, DSLR 85mm f/2.0, cinematic golden-hour rim lighting, waist-up composition with full beach scenery visible',
    negative: 'plain backdrop, empty background, studio seamless, pure color background, multiple people, triptych, character sheet',
  },
  studio_plain: {
    desc: '纯色影棚',
    prompt: 'clean professional studio portrait of one single person — seamless soft gradient backdrop (subtle warm gray to cream), professional three-point softbox lighting with gentle rim light, minimalist aesthetic with visible backdrop texture and light falloff — natural pleasant expression, smart simple outfit, DSLR 85mm f/4, sharp focus, waist-up composition, the studio backdrop clearly visible as part of the composition',
    negative: 'outdoor, street, nature, random room, cluttered background, multiple people, triptych, character sheet',
  },
  // —— 新增 6 风格 ——
  live_studio: {
    desc: '直播间',
    prompt: 'professional live-streaming studio photograph of one single person sitting in front of a ring light — visible background: softbox lighting, ring light reflection in eyes, studio curtain or neon backdrop, camera setup partially in frame, modern streamer desk with RGB accents — enthusiastic friendly expression, trendy hoodie or blazer, DSLR 50mm f/2.0, sharp focus on face, waist-up composition, clear streamer-studio vibe',
    negative: 'outdoor, random room, amateur setup, multiple people, triptych, character sheet',
  },
  business_formal: {
    desc: '商务正装',
    prompt: 'corporate executive photograph of one single person in tailored suit — visible background: glass high-rise conference room, cityscape through floor-to-ceiling windows, subtle corporate art, leather chair hint — sharp authoritative expression, neat hair, premium watch, DSLR 85mm f/2.8, sophisticated lighting, waist-up composition, executive polish',
    negative: 'casual clothing, outdoor nature, multiple people, triptych, character sheet',
  },
  tech_lab: {
    desc: '科技实验室',
    prompt: 'futuristic tech-lab photograph of one single person — visible background: glowing holographic displays, server rack with blue LEDs, clean minimalist lab, subtle blue-cyan accent lighting on metallic surfaces — intelligent focused expression, smart casual tech outfit, DSLR 50mm f/2.0, cinematic tech ambience, waist-up composition, rich sci-fi/tech environment',
    negative: 'outdoor nature, pastoral scene, multiple people, triptych, character sheet',
  },
  cafe_cozy: {
    desc: '咖啡馆漫谈',
    prompt: 'warm cafe-shop photograph of one single person sitting at a window table with a latte — visible background: brick wall with shelves, hanging plants, pastries in display, barista-busy ambience blurred, afternoon light streaming through big windows — relaxed chatty smile, soft sweater, DSLR 85mm f/1.8, cozy bokeh, waist-up composition, authentic cafe atmosphere',
    negative: 'studio, plain backdrop, multiple people, triptych, character sheet',
  },
  fitness_energy: {
    desc: '运动活力',
    prompt: 'sport-style photograph of one single person in a modern gym or outdoor park — visible background: running tracks or gym equipment, morning sunlight, green trees or urban fitness space — energetic confident smile, athletic sportswear, healthy glow, DSLR 85mm f/2.2, dynamic bright lighting, waist-up composition, vibrant fitness environment',
    negative: 'indoor office, formal attire, multiple people, triptych, character sheet',
  },
  anime_illus: {
    desc: '动漫插画',
    prompt: 'high-quality anime illustration of one single person — visible background: vibrant anime cityscape or dreamy landscape, cel-shaded style, bright saturated colors, clean linework, large expressive eyes, stylized hair — cheerful expression, trendy anime-character outfit, waist-up composition, Studio Ghibli meets Makoto Shinkai aesthetic',
    negative: 'photorealistic, photograph, realistic skin, multiple people, triptych, character sheet',
  },
};

// 紧凑版真实感引导（避免 prompt 撞 2000 字符 cap，把构图/bg 指令挤掉）
const REALISTIC_PHOTO_GUIDE = [
  'photorealistic, shot on real digital camera, visible skin pores and micro imperfections, natural facial asymmetry',
  'soft realistic lighting with neck shadows, subsurface scattering on cheeks, real fabric texture with folds',
  'anatomically correct hands, real candid photo not painting/3D/anime',
].join(', ');

const DEFAULT_STUDIO_BACKDROP_SCENE = [
  'clean neutral studio curtain backdrop',
  'soft fabric drape or seamless cloth background',
  'subtle warm gray color, gentle studio light falloff',
  'empty background, no cafe, no office, no furniture, no outdoor scenery',
].join(', ');

const STYLE_PERSON_QUALITY = {
  free: 'natural realistic portrait quality, clean lighting',
  idol_warm: 'warm soft key light, friendly natural presenter look, tasteful casual styling',
  idol_cool: 'cool editorial light, composed confident expression, refined styling',
  documentary: 'authentic documentary realism, natural skin texture, everyday clothing',
  office: 'professional business-presenter styling, clean confident appearance',
  beach: 'fresh sunny complexion, relaxed casual styling, light natural colors',
  studio_plain: 'clean professional studio portrait lighting, simple polished styling',
  live_studio: 'friendly livestream presenter look, clear face lighting, approachable expression',
  business_formal: 'tailored business styling, authoritative calm expression, premium grooming',
  tech_lab: 'modern tech-presenter styling, crisp cool light on the subject',
  cafe_cozy: 'warm cozy presenter mood, soft sweater or casual refined outfit',
  fitness_energy: 'energetic healthy presenter look, athletic styling, bright natural expression',
  anime_illus: 'high-quality anime character illustration, clean linework, expressive eyes',
};

function _buildSceneClause({ sceneDescription = '', hasBgRef = false } = {}) {
  const scene = String(sceneDescription || '').trim();
  if (hasBgRef) {
    return [
      'Background scene: use the uploaded reference background image as the exact environment.',
      'Keep the person naturally composited in front of that background.',
      'Do not invent a different room, cafe, office, street or outdoor place.',
    ].join(' ');
  }
  if (scene) {
    return [
      `Background scene requirement: ${scene}.`,
      'Treat this as background/environment only; do not merge background objects into the person.',
      'Keep the person clearly separated from the scene with natural depth and lighting.',
    ].join(' ');
  }
  return [
    `Background scene: ${DEFAULT_STUDIO_BACKDROP_SCENE}.`,
    'This default backdrop is intentional because the user did not provide a scene prompt.',
    'Do not create cafe, office, bedroom, street, beach, lab, showroom or other random scenery.',
  ].join(' ');
}

const REALISTIC_NEGATIVE = [
  // 强化对"塑料感/AI 感/瓷娃娃"的拒绝
  'cgi, 3d render, plastic skin, wax figure, doll face, porcelain skin, over-smoothed face, over-beautified influencer face, AI-generated look, uncanny valley',
  'perfect symmetric face, airbrushed skin, fantasy lighting, neon studio glamour, anime, cartoon, illustration, anime style face, big sparkly anime eyes, glossy plastic-doll hair',
  'overly saturated colors, oversaturated makeup, instagram filter, snapchat filter, beauty cam filter, smoothing filter',
  'fake hands, deformed fingers, extra fingers, broken wrist, floating object, pasted product, product sticker, product card',
].join(', ');

function _realisticBasePrompt(prompt) {
  return String(prompt || '')
    .replace(/beautiful magazine-cover quality photograph/gi, 'realistic phone-camera portrait')
    .replace(/editorial magazine photograph/gi, 'realistic candid portrait')
    .replace(/flawless porcelain skin/gi, 'natural skin texture with pores and slight imperfections')
    .replace(/clean flawless skin/gi, 'natural skin texture')
    .replace(/golden ratio facial proportions/gi, 'ordinary natural facial proportions')
    .replace(/DSLR 85mm f\/2\.0/gi, 'phone camera, realistic lens perspective')
    .replace(/DSLR 85mm f\/2\.8/gi, 'phone camera, realistic lens perspective')
    .replace(/DSLR 50mm f\/2\.0/gi, 'phone camera, realistic lens perspective')
    .replace(/cinematic shallow depth of field/gi, 'natural depth of field')
    .replace(/magazine cover quality/gi, 'real-life social media frame');
}

// 动作 → 英文动作描述（与 public/js/digital-human.js ACTION_PRESETS 同步）
// lip-sync 模型（Hifly / 即梦 Omni）不接受动作 prompt，所以把动作 baked 进形象图里
const ACTION_PROMPTS = {
  natural:      'natural speaking, subtle head movements, look at camera',
  greet:        'waving hello, friendly greeting gesture',
  nod:          'nodding in agreement, confident expression',
  shake_head:   'gently shaking head, reflective expression',
  lean_in:      'leaning slightly forward to emphasize the point',
  wave_bye:     'waving goodbye warmly, friendly closing gesture',
  open_palms:   'both hands open palms up explaining, welcoming posture',
  raise_hand:   'raising one hand to explain clearly',
  count_finger: 'counting on fingers, explaining points one by one',
  compare:      'comparing two ideas with left and right hand gestures',
  point_down:   'pointing downward with index finger, looking at camera',
  point_up:     'pointing upward with index finger, directing attention',
  point_side:   'pointing to the side, guiding viewer attention naturally',
  number1:      'holding up one finger, counting gesture',
  push_forward: 'pushing both hands forward, stopping or emphasizing a boundary',
  excited:      'excited gesture, eyes wide, energetic smile',
  thoughtful:   'thinking expression, hand near chin, eyes thoughtful',
  look_down:    'looking down briefly, thoughtful pause before speaking',
  surprised:    'exaggerated surprised reaction, wide eyes, jaw drop',
  celebrate:    'raising both fists in celebration, joyful expression',
  whisper:      'leaning close as if sharing a secret, hushed conspiratorial tone',
  serious_look: 'serious direct eye contact, authoritative upright posture',
  heart:        'making a heart sign with both hands, warm smile',
  like:         'giving a thumbs up, encouraging smile',
  peace:        'making peace/victory sign with two fingers, playful smile',
  ok_sign:      'making OK sign with hand, approval gesture',
  high_five:    'offering a high-five gesture toward the viewer',
  hug:          'spreading arms wide in welcoming hug gesture',
  invite:       'inviting gesture towards the viewer, friendly smile',
  clap:         'clapping hands enthusiastically, celebrating achievement',
  hold_item:    'holding up a product to camera, presenting with pride',
  bow:          'respectful bow, grateful sincere expression',
  arms_cross:   'arms crossed, authoritative confident posture',
  look_around:  'looking around with curiosity, as if discovering something new',
  think_deep:   'deep in thought, rubbing chin slowly, eyes looking sideways',
};

// LRU-ish cache：相同 description 不重复跑 LLM 翻译
const _DESC_TRANS_CACHE = new Map();
const _DESC_TRANS_CACHE_MAX = 200;

const PERSON_DESC_SCENE_LEAK_RE = /(背景|场景|环境|室内|室外|窗边|窗外|窗户|房间|卧室|客厅|办公室|咖啡馆|咖啡店|街景|街道|海边|沙滩|树林|花园|影棚|幕布|墙面|艺术墙|金属墙|岩板|家具|桌|椅|沙发|书架|绿植|展厅|展馆|展墙|展柜|展架|展台|展示|陈列|橱窗|柜台|广告|海报|招牌|标语|字幕|文字|LOGO|logo|品牌墙|产品|商品|珠宝|首饰|金属板|Time Patina|time patina|bokeh|background|scene|environment|room|window|office|cafe|street|beach|studio|backdrop|furniture|sofa|desk|chair|shelf|plant|showroom|gallery|poster|signage|display|exhibit|jewelry|counter|logo|text|caption|wall|product|advertisement)/i;

const PERSON_DESC_OVERBEAUTY_RE = /(瓷娃娃|洋娃娃|娃娃脸|无瑕|完美比例|漫画感|大眼萌|网红脸|少女感过强|幼态|萝莉|夸张红唇|广告海报|奢华背景|porcelain|doll|perfect symmetry|anime eyes|influencer face)/i;

function _trimPersonDescription(text, max = 150) {
  let s = String(text || '').trim();
  if (s.length <= max) return s;
  const parts = s.split(/(?<=[。！？!?；;])/).map(x => x.trim()).filter(Boolean);
  let out = '';
  for (const part of parts) {
    if ((out + part).length > max) break;
    out += part;
  }
  return (out || s.slice(0, max)).replace(/[,，、。；;\s]+$/g, '').trim();
}

function _stripSceneLeakFromPersonDescription(text) {
  let s = String(text || '').trim();
  if (!s) return '';
  const sentenceParts = s
    .split(/(?<=[。！？!?；;])|\n+/)
    .map(x => x.trim())
    .filter(Boolean);
  if (sentenceParts.length > 1) {
    s = sentenceParts.filter(x => !PERSON_DESC_SCENE_LEAK_RE.test(x)).join('');
  }
  s = s
    .replace(/(背景|场景|环境)[^。！？!?；;\n]{0,120}[。！？!?；;]?/g, '')
    .replace(/(窗边|窗外|室内|办公室|咖啡馆|咖啡店|街景|海边|影棚|幕布|沙发|书架|绿植|展厅|展馆|展墙|展柜|展架|展台|展示|陈列|橱窗|柜台|广告|海报|招牌|标语|字幕|文字|LOGO|logo|品牌墙|艺术墙|金属墙|岩板|产品|商品|珠宝|首饰)[^。！？!?；;\n]{0,120}[。！？!?；;]?/g, '')
    .replace(/\b(background|scene|environment|room|window|office|cafe|street|beach|studio|backdrop|furniture|sofa|desk|chair|shelf|plant|showroom|gallery|poster|signage|display|exhibit|jewelry|counter|logo|text|caption|wall|product|advertisement)[^,.|;]{0,120}[,.|;]?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,，、。；;\s]+|[,，、。；;\s]+$/g, '')
    .trim();
  if (PERSON_DESC_SCENE_LEAK_RE.test(s)) {
    s = s.split(/[。！？!?；;\n]+/).map(x => x.trim()).filter(x => x && !PERSON_DESC_SCENE_LEAK_RE.test(x)).join('。');
  }
  return _trimPersonDescription(s, 180);
}

// 把用户的中文描述翻译/改写为图像生成模型友好的英文属性 prompt
// 关键：保留所有具体属性（颜色/服饰/道具/场景元素）；用逗号分隔短语；前置主体特征
//   hasBgRef=true：用户已上传自定义背景图，描述里的背景部分会与之冲突 → LLM 强制剥掉背景描述
async function _translateDescToEnAttrPrompt(description, { style, gender, hasBgRef = false } = {}) {
  description = _stripSceneLeakFromPersonDescription(description);
  if (!description || !description.trim()) return '';
  // 已经是英文（80% 以上是 ASCII）就不必翻译
  const ascii = (description.match(/[\x00-\x7F]/g) || []).length;
  if (ascii / description.length > 0.8) return description.trim();

  const key = `${style || ''}|${gender || ''}|${hasBgRef ? 'bg' : 'nobg'}|${description.trim().slice(0, 500)}`;
  if (_DESC_TRANS_CACHE.has(key)) return _DESC_TRANS_CACHE.get(key);

  try {
    const { callLLM } = require('../services/storyService');
    const bgStripRule = '\n\n4. BACKGROUND / SCENE / ENVIRONMENT: STRIP ALL background descriptions (e.g. cafe, office, room, window sunlight, street, beach, lab, furniture, plants, shelves, curtain, wall, store, showroom, exhibition hall, display cabinet, poster, signage, wall text, product display, jewelry counter). Scene is controlled by a separate scene field or uploaded background image. Only output PERSON-related attributes (face / skin / hair / clothing / accessories / simple mood / lighting on the person). DROP all environment, scenery, furniture, surrounding objects, text/signage, and background props.';
    const sys = `You convert a Chinese character/scene description into a tightly structured ENGLISH prompt for image generation models (Flux, Seedream, nano-banana). Rules:
- Preserve EVERY specific *person appearance* attribute from the input: hair color/length/texture, clothing color and material, accessories (necklace/earrings/glasses/watch), handheld personal props, simple lighting on the person, mood.
- Use comma-separated short phrases (image-gen style), not full sentences.
- Front-load identity-defining attributes: hair color first, then face/skin, then clothing colors, then accessories, then simple person mood/lighting.
- Translate Chinese color words EXACTLY: 深蓝→deep navy blue, 银白→silver white, 浅金→soft gold, 冷色调→cool tone, 暖色调→warm tone, 蓝色LED灯带→glowing blue LED light strips.
- Keep numerical / measurement details: 1米7→1.7m tall, 25岁→around 25 years old.

CRITICAL — STRIP THESE from the output even if they appear in input:
1. POSE / GESTURE / hand position / body language: e.g. "一只手轻托起脸颊", "微微倾斜", "手放在桌上", "靠近镜头", "侧身", "抱胸". Pose is controlled separately by user chip selection.
2. COMPOSITION / FRAMING / CAMERA / LENS / depth-of-field: e.g. "中长焦镜头", "浅景深", "聚焦于面庞", "特写", "半身", "全身", "DSLR 85mm", "shallow depth of field", "focus on face", "headshot", "waist-up", "full body". Framing is controlled separately by user chip selection.
3. EXPRESSION specifics tied to motion: keep simple "smiling/calm/serious" but strip "微微上扬的嘴角", "轻轻歪头" etc that imply specific motion.${bgStripRule}

Do NOT mention any framing/composition/lens/pose words in the English output. The downstream system adds those.

- Length: 80-180 English tokens.
- Output ONLY the prompt string. No quotes, no preamble, no markdown, no explanation.`;
    const user = `Style: ${style || 'unspecified'}\nGender: ${gender || 'unspecified'}\n\nChinese description:\n${description.trim()}`;
    const raw = await callLLM(sys, user, {});
    let en = String(raw || '').trim()
      .replace(/^["'『「《]+|["'』」》]+$/g, '')
      .replace(/^(prompt|english|en|output)[:：]\s*/i, '')
      .replace(/\n+/g, ' ')
      .slice(0, 1200);
    // 后处理：强制剥掉姿势/构图/镜头泄漏（LLM 即使被命令也会偷偷塞）
    const POSE_COMP_PATTERNS = [
      /\b(slight |gently |softly )?(tilt(ed|ing)? of the |tilt(ed|ing)? )?head\b[^,.|]*/gi,
      /\b(one |both |left |right )?hand[s]? (gently |softly |lightly )?(cradling|holding|touching|resting on|placed on|on|near|by) (her |his |the )?(cheek|chin|face|jaw|hair|head|shoulder|hip|waist)[^,.|]*/gi,
      /\b(focus(ed|ing)? on (the )?face|focused on her face|center of focus on the face)\b[^,.|]*/gi,
      /\b(shallow|narrow|deep) depth[ -]of[ -]field[^,.|]*/gi,
      /\b(close[ -]up|extreme close[ -]up|headshot|head shot|waist[ -]up|half[ -]body|full[ -]body) (shot|composition|portrait|framing)\b[^,.|]*/gi,
      /\b(medium|long|short|tele|wide)[ -](focal|telephoto|focus|focal length) (lens|shot)\b[^,.|]*/gi,
      /\bDSLR[^,.|]*/gi,
      /\b\d+mm\s*(f\/[\d.]+)?\b/gi,
      /,\s*(?=,)/g,  // 清理留下的连续逗号
      /,\s*$/g,
    ];
    for (const re of POSE_COMP_PATTERNS) en = en.replace(re, '');
    en = en.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').replace(/^[,\s|]+|[,\s|]+$/g, '').trim();
    _DESC_TRANS_CACHE.set(key, en);
    if (_DESC_TRANS_CACHE.size > _DESC_TRANS_CACHE_MAX) {
      _DESC_TRANS_CACHE.delete(_DESC_TRANS_CACHE.keys().next().value);
    }
    console.log(`[DH/images] 中文描述 → 英文属性 prompt (${en.length} 字符)`);
    return en;
  } catch (e) {
    console.warn('[DH/images] 描述翻译失败，回退原中文:', e.message);
    return description.trim();
  }
}

// 构图 → 强力英文指令（前置 + 后置叠加，确保模型不输出脸部特写）
const FRAMING_PROMPTS = {
  headshot:  { en: 'TIGHT HEADSHOT, head and shoulders only, formal portrait framing', neg: 'full body, legs visible' },
  half_body: { en: 'HALF BODY SHOT, upper body and waist clearly visible, hands visible in frame, both arms visible, waist-up composition', neg: 'face close-up, headshot only, cropped at neck, only face visible, extreme close-up' },
  full_body: {
    en: 'FULL BODY SHOT, COMPLETE FIGURE from HEAD to FEET, the ENTIRE PERSON visible in frame including head, torso, legs and shoes, tall vertical full-length photograph with subject occupying full vertical frame from top to bottom',
    neg: 'face close-up, headshot, head and shoulders only, portrait crop, cropped at waist, cropped at hip, cropped at thigh, cropped at knee, cropped at chest, only upper body, partial body, half body shot, bust shot, only torso visible',
  },
  close_up:  { en: 'extreme close-up portrait of face, beauty shot framing', neg: 'full body, half body, legs visible' },
};

// 风格感知的 negative：tech_lab/anime_illus 不该 ban 掉自身核心元素
function _buildNegativeForStyle(style, styleNegative, { allowPlainBackdrop = false } = {}) {
  let styleNeg = String(styleNegative || '');
  if (allowPlainBackdrop) {
    styleNeg = styleNeg
      .replace(/\bplain backdrop,\s*/gi, '')
      .replace(/\bempty background,\s*/gi, '')
      .replace(/\bstudio seamless,\s*/gi, '')
      .replace(/\bpure color background,\s*/gi, '')
      .replace(/\bplain backdrop\b/gi, '')
      .replace(/\bempty background\b/gi, '')
      .replace(/\bstudio seamless\b/gi, '')
      .replace(/\bpure color background\b/gi, '')
      .replace(/,\s*,/g, ',')
      .replace(/^[,\s]+|[,\s]+$/g, '');
  }
  let neg = REALISTIC_NEGATIVE;
  if (style === 'tech_lab') {
    // 科技实验室本来就靠"未来感蓝光/全息霓虹"立住，禁掉这些等于自相矛盾
    neg = neg
      .replace(/,\s*fantasy lighting/g, '')
      .replace(/,\s*neon studio glamour/g, '')
      .replace(/,\s*airbrushed skin/g, '');
  }
  if (style === 'anime_illus') {
    // 动漫插画风本来就是动漫，不能 ban anime/cartoon/illustration
    neg = neg
      .replace(/,\s*anime/g, '')
      .replace(/,\s*cartoon/g, '')
      .replace(/,\s*illustration/g, '');
  }
  return `${styleNeg}, ${neg}`;
}

// userEnPrompt 是已经处理好的英文属性 prompt（由调用方提前 await _translateDescToEnAttrPrompt 得到）
// 关键改动：
//   - 用户描述前置（主导）
//   - framing 在 prompt 头/中/尾三处重复，避免被 2000 字符 cap 截断
//   - hasBgRef=true 时把 style 自带的"cozy cafe / glass conference room / lab"等背景关键词剥掉，让用户上传的 bg 主导场景
// 两阶段管线 Stage1 专用 prompt 构造器
//   目标：在纯灰背景上生成指定 framing 的人物，便于 stage2 抠像
//   设计原则：
//     - 关键 framing 约束 PUT FIRST（避免 prompt 超 2000 字符 cap 时被尾部截断）
//     - userClause cap 到 400 字符（用户描述常 800+，用了之后会顶掉关键约束）
//     - 总长度 cap 到 1400 字符，给余量
//     - aspectRatio 自适应（16:9 横屏全身物理冲突 → 改"环境 establishing 镜头"）
function _buildStage1Prompt({ gender, userEnPrompt, framing, aspectRatio = '9:16' }) {
  const g = gender === 'male' ? 'a young man' : gender === 'female' ? 'a young woman' : 'a real person';
  // userClause cap 到 400 字符，避免顶掉关键约束
  const userClauseRaw = (userEnPrompt && userEnPrompt.trim()) ? userEnPrompt.trim() : '';
  const userClause = userClauseRaw.length > 400 ? userClauseRaw.slice(0, 400) + '…' : userClauseRaw;
  const isVertical = aspectRatio === '9:16' || aspectRatio === '3:4';

  if (framing === 'full_body') {
    // 关键 framing 约束在最前——任何截断都不会丢
    if (isVertical) {
      return [
        // 关键指令前置（被截不丢）
        'FULL BODY STANDING SHOT. The image MUST show the entire person from head to feet. Feet and shoes visible at the very bottom of the frame. Both legs straight and clearly visible.',
        'NO half body. NO waist-up. NO portrait crop. NO sitting.',
        `Subject: ${g}, standing upright on a plain grey studio backdrop.`,
        // 给"下半身要画的内容"
        'Lower body (REQUIRED — render even if not specified): casual full-length pants or knee-length skirt, simple shoes/sneakers, both feet visible on the floor.',
        'Pose: standing upright, weight balanced, arms relaxed by the sides, gentle natural smile, looking at camera.',
        userClause ? `Appearance: ${userClause}` : '',
        'Setting: PLAIN SOLID NEUTRAL GREY (#888888) seamless backdrop, empty, no furniture, no props.',
        'Photography: 35mm wide-angle, low camera angle from waist height to fit head-to-feet vertically, fashion editorial quality, photorealistic skin.',
        'ABSOLUTELY ONE SINGLE PERSON.',
      ].filter(Boolean).join(' ');
    } else {
      // 16:9 / 1:1 横屏：物理上塞不下站立全身。改"WIDE ESTABLISHING SHOT"风格
      // 人物占画面中心垂直条带，左右留环境
      return [
        'WIDE CINEMATIC ESTABLISHING SHOT. Camera pulled back to fit the entire standing figure from head to feet within the wide frame.',
        'Person stands centered in the frame. Head visible. Feet and shoes visible at the bottom. Both legs straight.',
        'NO half body. NO waist-up. NO closeup.',
        `Subject: ${g}, standing upright on a plain grey studio backdrop.`,
        'Lower body (REQUIRED): full-length pants or knee-length skirt, simple shoes, both feet visible.',
        'Pose: standing upright, weight balanced, arms relaxed by the sides.',
        userClause ? `Appearance: ${userClause}` : '',
        'Setting: PLAIN SOLID NEUTRAL GREY (#888888) seamless backdrop, empty, no furniture.',
        'Photography: 28mm wide-angle establishing lens, eye-level, fashion editorial quality, photorealistic.',
        'ABSOLUTELY ONE SINGLE PERSON, centered in frame.',
      ].filter(Boolean).join(' ');
    }
  }

  if (framing === 'headshot' || framing === 'close_up') {
    return [
      framing === 'close_up' ? 'EDITORIAL BEAUTY CLOSE-UP. Tight crop on face and eyes.' : 'PROFESSIONAL HEADSHOT. Head and shoulders only.',
      `Subject: ${g}.`,
      userClause ? `Appearance: ${userClause}` : '',
      'Pose: looking at camera, gentle natural expression.',
      'Setting: PLAIN SOLID NEUTRAL GREY (#888888) seamless backdrop, empty.',
      'Photography: 85mm f/2.8 portrait lens, soft beauty dish key, fashion editorial quality.',
      'NO full body. NO legs visible.',
      'ABSOLUTELY ONE SINGLE PERSON.',
    ].filter(Boolean).join(' ');
  }

  // 半身 (默认)
  return [
    'PROFESSIONAL HALF-BODY PHOTO. Waist-up — head, torso and hands visible.',
    `Subject: ${g}.`,
    userClause ? `Appearance: ${userClause}` : '',
    'Pose: standing front-facing, arms relaxed, hands visible.',
    'Setting: PLAIN SOLID NEUTRAL GREY (#888888) seamless backdrop, empty.',
    'Photography: 50mm f/4, fashion editorial quality.',
    'NO closeup. NO sitting. NO furniture.',
    'ABSOLUTELY ONE SINGLE PERSON.',
  ].filter(Boolean).join(' ');
}

function _buildPrompt({ style, gender, description, sceneDescription = '', action, userEnPrompt, framing, hasBgRef = false }) {
  const s = STYLE_PROMPTS[style] || STYLE_PROMPTS.free;
  const g = gender === 'male' ? 'ordinary real young man' : gender === 'female' ? 'ordinary real young woman' : 'real person';
  const genderLock = gender === 'female'
    ? 'FEMALE WOMAN ONLY, unmistakably adult female, no male, no masculine facial features, no beard.'
    : gender === 'male'
      ? 'MALE MAN ONLY, unmistakably adult male, no female, no feminine facial features.'
      : '';
  const userClause = (userEnPrompt && userEnPrompt.trim())
    ? userEnPrompt.trim()
    : (description ? _stripSceneLeakFromPersonDescription(description) : '');
  const hasSceneDesc = !!String(sceneDescription || '').trim();
  const sceneClause = _buildSceneClause({ sceneDescription, hasBgRef });
  const personQuality = STYLE_PERSON_QUALITY[style] || STYLE_PERSON_QUALITY.free;
  const mediumGuide = style === 'anime_illus'
    ? 'high-quality anime illustration of one single person, consistent character design'
    : `realistic photo of one single ${g}, ${personQuality}`;
  const cleanIdentityGuide = [
    'This is a reusable digital-human identity photo, not an advertising poster.',
    'The person must be the only subject; keep background plain and secondary.',
      'No signs, no poster text, no brand slogans, no wall text, no product showroom, no display shelves, no advertisement layout.',
      'Natural adult face, realistic skin pores, ordinary human proportions, no doll-like or cartoon facial features.',
      'Avoid over-beautified influencer look; keep a normal adult presenter identity.',
  ].join(' ');

  // 剥掉 style 模板里旧的构图硬编码（让 framing chip 说了算）
  let basePrompt = `${mediumGuide}. ${cleanIdentityGuide} ${sceneClause}`;

  // 自定义背景：style 模板里很多场景描述（"cozy warmly-lit interior — bright wooden cafe with hanging edison bulbs, lush green plants..."）
  // 会跟用户上传的 bg 冲突。直接简化 basePrompt，只保留人物质感关键词
  if (hasBgRef) {
    basePrompt = `realistic photo of one single ${g}, ${personQuality}. ${cleanIdentityGuide} ${sceneClause}`;
  }

  // ⚠️ full_body 时：style 模板里的"standing in a cozy interior"等长描述会让 nano-banana
  // 倾向 portrait crop。完全替换 basePrompt 用极简 full-body 骨架，让构图 chip 说了算
  if (framing === 'full_body') {
    basePrompt = [
      `vertical full-length photograph showing one single ${g} from head to feet`,
      'the entire body must fit inside the frame, face, hair, torso, arms, hands, legs, ankles, shoes and both feet visible',
      'camera pulled back far enough, subject smaller in frame, visible floor under the shoes, clear headroom above the head',
      'standing upright, no sitting, no sofa, no portrait crop, no waist-up crop',
      `${personQuality}. ${cleanIdentityGuide} ${sceneClause}`,
    ].join(', ');
  }

  const actionEn = action && ACTION_PROMPTS[action] ? ACTION_PROMPTS[action] : '';
  const actionClause = actionEn ? `Pose: ${actionEn}, anatomically correct hands. ` : '';
  const fr = FRAMING_PROMPTS[framing] || FRAMING_PROMPTS.half_body;

  // framing 在 prompt 多处重复（头/中/尾），任何位置被截断都还能命中
  const framingHead = `${fr.en}. `;
  const framingMid = framing === 'full_body'
    ? 'CRITICAL: This is a FULL-LENGTH photo. The subject MUST be visible from head all the way to feet. Show the legs and shoes. Do NOT crop at the waist or hip. '
    : '';
  const framingTail = `, ${fr.en}`;

  const headClause = `${genderLock ? `${genderLock}. ` : ''}${userClause ? `${userClause}. ` : ''}`;
  return {
    prompt: `${framingHead}${headClause}${framingMid}${basePrompt.replace(/one single person/g, `one single ${g}`)}. ${actionClause}${REALISTIC_PHOTO_GUIDE}${framingTail}, ABSOLUTELY ONE SINGLE PERSON, no duplicates`,
    negative: `${_buildNegativeForStyle(style, s.negative, { allowPlainBackdrop: !hasBgRef && !hasSceneDesc })}, ${fr.neg}, ${gender === 'female' ? 'male, man, beard, masculine face,' : gender === 'male' ? 'female, woman, feminine face,' : ''} text, letters, words, captions, poster, signage, logo, watermark, showroom wall, exhibition hall, display shelf, jewelry display, product display, advertisement background, Time Patina text, giant head, face-only crop, doll face, wax doll, porcelain doll, over-beautified influencer`,
  };
}

function _buildIntegratedBackgroundPrompt({ gender, userEnPrompt, framing, action }) {
  const g = gender === 'male' ? 'adult male digital-human presenter'
    : gender === 'female' ? 'adult female digital-human presenter'
      : 'adult digital-human presenter';
  const genderLock = gender === 'female'
    ? 'Gender lock: FEMALE WOMAN ONLY. The presenter must read unmistakably as an adult woman; no male presenter, no masculine face, no beard, no short masculine haircut.'
    : gender === 'male'
      ? 'Gender lock: MALE MAN ONLY. The presenter must read unmistakably as an adult man; no female presenter, no feminine face, no long feminine hairstyle.'
      : 'Gender: adult presenter, realistic and unambiguous.';
  const fr = framing === 'full_body'
    ? [
      'Full-body presenter integrated naturally into the uploaded background scene.',
      'The complete person must be visible from head to feet, including legs, shoes and both feet.',
      'Camera pulled back enough to fit the entire standing figure inside the frame.',
      'The presenter should stand naturally on the floor plane of the uploaded scene, not sit on furniture.',
    ].join(' ')
    : framing === 'headshot'
      ? 'Head-and-shoulders presenter integrated naturally into the uploaded background scene.'
      : framing === 'close_up'
        ? 'Close-up speaking presenter integrated naturally into the uploaded background scene.'
        : 'Half-body presenter integrated naturally into the uploaded background scene, upper body and hands visible.';
  const actionEn = action && ACTION_PROMPTS[action] ? ACTION_PROMPTS[action] : 'standing naturally, looking at camera';
  const appearance = userEnPrompt && userEnPrompt.trim()
    ? `Presenter appearance: ${userEnPrompt.trim().slice(0, 520)}.`
    : '';
  return [
    'Use the uploaded image as the exact background reference and keep its commercial interior, wall texture, display area, lighting direction and overall color mood recognizable.',
    'Generate one single realistic presenter directly inside this uploaded scene; this is NOT a cutout composite.',
    'Match the presenter to the background perspective, camera angle, shadows, color temperature, contrast and ambient light.',
    'Add natural contact shadow and believable edge lighting so the person belongs to the scene.',
    fr,
    `Subject: one single ${g}.`,
    genderLock,
    appearance,
    `Pose: ${actionEn}; natural speaking posture, calm professional expression.`,
    REALISTIC_PHOTO_GUIDE,
    'No pasted cutout look, no hard edge halo, no mismatched studio lighting, no duplicated person, no wrong gender.',
  ].filter(Boolean).join(' ');
}

function _buildProductAvatarPrompt({ gender, description, product }) {
  const g = gender === 'male'
    ? 'ordinary real young male product presenter'
    : gender === 'female'
      ? 'ordinary real young female product presenter'
      : 'ordinary real product presenter';
  const productName = product?.name || 'the exact uploaded reference product';
  const userDesc = description
    ? `Use only realistic, non-fantasy details from this user note: ${description}. Ignore fantasy, cosplay, anime, sci-fi, blue hair, neon lab, idol glamour, heavy beauty makeup, porcelain skin, magazine retouching, and any cue that changes the product category.`
    : '';
  return {
    prompt: [
      `Ultra-realistic phone-camera product introduction photo of one single ${g}, waist-up, looking directly at the camera while introducing a product.`,
      'This is a product introduction shot, not a product usage shot.',
      'The presenter is showing the product to the audience, not playing with it, not typing, not gaming, not scrolling, not making a call, and not looking down at the screen.',
      'The exact uploaded reference product is held at chest or shoulder level, front side facing the camera, clearly visible, correctly scaled, and physically integrated with natural fingers and contact shadows.',
      'If the uploaded product is a smartphone: keep it as a smartphone, vertical portrait orientation, screen facing camera, visible phone frame and camera module, one hand holding the side or bottom, the other hand lightly supporting or pointing at it.',
      `Product identity: ${productName}. Preserve the uploaded product category, shape, color, screen content, logo area, proportions and visual identity exactly.`,
      `${REALISTIC_PHOTO_GUIDE}. Real livestream room or simple indoor product-review setting, natural outfit, authentic phone snapshot, no studio idol poster look.`,
      userDesc,
      'No product replacement, no skincare bottle, no perfume, no cosmetic bottle, no product card, no floating sticker, no horizontal gaming grip, no looking at the phone, no duplicated person.',
      'ABSOLUTELY ONE SINGLE PERSON, natural hands, natural grip tension, realistic skin texture.',
    ].filter(Boolean).join(' '),
    negative: `${REALISTIC_NEGATIVE}, playing phone, gaming, typing, tapping screen, scrolling, phone call, horizontal phone, looking down, using product, bottle, skincare, cosmetics, perfume, product card, floating sticker, blue hair, sci-fi lab, idol glamour`,
  };
}

const SPACE_GUIDE_SCENES = {
  auto: {
    name: 'prompt driven space',
    scene: 'infer the exact commercial/interior space from the uploaded background, title and copy; do not force a preset scene',
  },
  gallery_wall: {
    name: 'gallery art wall',
    scene: 'premium interior gallery with a large textured art wall, warm ceiling spotlights, dark floor, quiet luxury mood',
  },
  showroom: {
    name: 'brand showroom',
    scene: 'modern brand showroom with a large display wall on the right, premium materials, warm commercial lighting',
  },
  retail_store: {
    name: 'retail store guide',
    scene: 'high-end retail store interior with a feature wall and product display area on the right, realistic shopping environment',
  },
  model_room: {
    name: 'model room tour',
    scene: 'real estate model room or home showroom with a feature wall on the right, warm interior lighting, elegant spatial depth',
  },
  museum_gallery: {
    name: 'museum gallery',
    scene: 'museum or cultural exhibition gallery with curated displays, controlled lighting, refined visitor route and clear exhibit focus',
  },
  exhibition_booth: {
    name: 'exhibition booth',
    scene: 'trade show exhibition booth with brand wall, booth lighting, product display island and professional visitor flow',
  },
  hotel_lobby: {
    name: 'hotel lobby',
    scene: 'premium hotel lobby or hospitality reception space with warm ambient lighting, textured materials and elegant spatial depth',
  },
  office_showroom: {
    name: 'corporate showroom',
    scene: 'corporate exhibition hall or office showroom with brand display wall, technology panels and polished business atmosphere',
  },
  real_estate: {
    name: 'real estate space',
    scene: 'real estate sales center, model apartment or property interior tour with clear room features and premium residential styling',
  },
  auto_showroom: {
    name: 'automotive showroom',
    scene: 'automotive showroom with vehicle display area, glossy floor, lighting reflections and premium brand atmosphere',
  },
  custom: {
    name: 'custom scene',
    scene: 'custom user-described space; follow the uploaded background and user prompt as the primary source of truth',
  },
};

function _spaceCameraPrompt(camera = 'push_in', cameraPrompt = '') {
  const presets = {
    auto: 'AI-directed single-take commercial camera movement chosen from the uploaded background and narration: start with a clear establishing composition, then use subtle push-in, pan, focus shift, or detail emphasis only when it supports the ad message; no cuts',
    push_in: 'very slow smooth camera push-in, no cuts',
    static: 'stable locked-off camera, no cuts',
    handheld: 'very subtle handheld camera movement, smooth and realistic',
    pan_right: 'slow pan from presenter on the left toward the display area on the right',
    walkthrough: 'gentle walkthrough feel, as if the viewer is being guided through the space',
    orbit: 'subtle parallax/orbit around the presenter while keeping the display wall visible',
    wide_to_detail: 'begin with a wide spatial overview, then gently emphasize material and display details',
    rack_focus: 'subtle rack focus between presenter and the important wall/display details',
    custom: '',
  };
  return [presets[camera] || presets.auto, cameraPrompt].filter(Boolean).join('; ');
}

function _buildSpaceGuideKeyframePrompt({ scene = 'auto', title = '', text = '', scenePrompt = '', camera = 'push_in', cameraPrompt = '', kbContext = '' }) {
  const s = SPACE_GUIDE_SCENES[scene] || SPACE_GUIDE_SCENES.auto;
  const contentContext = [title, scenePrompt, String(text || '').slice(0, 260)].filter(Boolean).join(' | ');
  return [
    'Create a brand-new photorealistic 16:9 video keyframe from the two references.',
    'Reference 1 is the presenter identity and outfit. Preserve the presenter face identity, hairstyle, clothing style and natural body proportions.',
    'Reference 2 is the real space/background. Preserve the room layout, wall texture, lighting direction, materials and perspective.',
    `Scene logic: ${s.scene}.`,
    contentContext ? `User content context: ${contentContext}. Use this context to decide the correct commercial scene details, not a fixed preset.` : '',
    kbContext ? `Knowledge-base direction: ${kbContext}` : '',
    'Composition: one presenter begins on or near the LEFT THIRD of the frame, full upper body visible from head to at least mid-thigh, with enough room for one or two small guided steps or a forward settling movement.',
    'The RIGHT TWO THIRDS must remain open and clearly show the wall/display area. Do not cover the wall with the presenter, but allow the presenter to angle body, hand and gaze toward it.',
    'Pose: first frame of a guided walkthrough, not a static portrait. Presenter is mid-introduction: one hand beginning to lift or point toward the wall/display, body slightly angled, gaze aligned with the target or returning to camera.',
    `Camera intent: wide cinematic establishing shot, 28mm realistic lens, eye-level, subtle interior depth. Later video motion should feel like a slow walkthrough reveal with spatial parallax: ${_spaceCameraPrompt(camera, cameraPrompt)}.`,
    'Lighting: the presenter must match the warm interior spotlights, with believable shadows and color temperature.',
    'Style: real estate/showroom docent video still, authentic phone/camera footage, no beauty poster look, no sticker, no floating product, no duplicated person.',
    'Strict negatives: close-up, selfie, centered presenter blocking the wall, half face crop, extra people, deformed hands, floating body, pasted cutout, cartoon, CGI, text overlay, subtitle.',
  ].filter(Boolean).join(' ');
}

function _fallbackGuideSegments(text, totalDur = 10) {
  const chunks = _splitSubtitleText(String(text || '').trim(), 16);
  if (!chunks.length) return [];
  const dur = Math.max(6, Math.min(30, totalDur || Math.ceil(String(text).length / 4)));
  const each = dur / chunks.length;
  return chunks.map((t, i) => ({
    text: t,
    start: i * each,
    end: i === chunks.length - 1 ? dur : (i + 1) * each,
  }));
}

// ═══════════════════════════════════════════════
// Step 1 辅助 · POST /api/dh/describe/enhance
//   根据 style + gender + 用户零散关键词 → LLM 补全成完整中文描述
// ═══════════════════════════════════════════════
router.post('/describe/enhance', async (req, res) => {
  try {
    const { style = 'idol_warm', gender = 'female', keywords = '' } = req.body || {};
    const styleMeta = STYLE_PROMPTS[style] || STYLE_PROMPTS.idol_warm;
    const { callLLM } = require('../services/storyService');

    const sys = `你是专业的数字人形象照美术指导（参考飞影/硅基/腾讯智影的高标准）。任务：为"${styleMeta.desc}"风格的数字人形象生成详尽的中文“人物描述”。这是人物字段，不是场景字段。

输出只覆盖以下 4 个维度，每项至少 1 句具体描述，整体要像真实可复用的口播数字人，不要网红写真、娃娃脸、海报广告感：
1. 人物形象：身高气质、面部特征（脸型/五官/肤色/眼神）、发型（长度/颜色/质感）
2. 服装搭配：上衣风格/颜色/面料、下装或搭配、配饰（项链/耳环/眼镜/手表）
3. 妆容：妆感（日系/欧美/干净/复古）、表情整体氛围（如"温暖治愈"/"专业自信"）
4. 人物身上的光线氛围：只写打在人物脸部、头发、服装上的光感，不写光线来自哪个房间/窗户/场景。

⚠️ 严禁出现以下内容（这些由用户在前端用 chip 单独选择，描述里出现会跟 chip 选择冲突）：
- 任何背景/场景/环境/空间/家具/道具/窗户/墙面/街景/咖啡馆/办公室/影棚/幕布/室内室外描述。场景在单独字段填写；如果用户没写场景，就默认干净棚拍背景。
- 任何"姿势/手部动作/头部角度/身体朝向"（如"一只手托脸""微微倾斜""叉腰""手放桌上"）
- 任何"构图/镜头/景深/焦距/特写/半身/全身"（如"中长焦镜头""浅景深""聚焦面庞""半身像"）
- 任何过度美化词：瓷娃娃、洋娃娃、无瑕、完美比例、漫画感、大眼萌、网红脸、少女感过强、夸张红唇、广告海报、奢华背景。

全文用中文，以顿号/句号自然衔接，目标 80-130 字。不要编号，不要分点，不要加引号/标题/前缀后缀。只输出正文。`;

    const user = `风格：${styleMeta.desc}
风格参考：只参考"${styleMeta.desc}"的人物气质，不参考任何背景或场景。
性别：${gender === 'male' ? '男性' : gender === 'female' ? '女性' : '不限'}
用户关键词（必须融入、不能漏）：${keywords || '(留空，你自由发挥)'}

请基于以上写一段 80-130 字的详细人物描述。人物必须是成年人、真实普通口播数字人，不要写任何背景或场景，不要写广告背景，不要写海报字，不要写少女感/娃娃感。`;

    const personOnlyUser = user + '\n\nIMPORTANT: This response fills only the 人物描述 field. Do NOT write background, scene, environment, furniture, window, wall, street, cafe, office, bedroom, curtain, store, showroom, weather, poster, text, signage, product display, or place details. 场景会在单独的“场景描述”字段填写；这里必须只写人物。';

    let text = _stripSceneLeakFromPersonDescription((await callLLM(sys, personOnlyUser, {
      kb: { scene: 'digital_human_portrait', query: `${styleMeta.desc} ${keywords}`.slice(0, 120), limit: 3, collection: 'digital_human' },
    })).trim().replace(/^["'『「]+|["'』」]+$/g, '').replace(/\n+/g, ''));
    text = text.replace(PERSON_DESC_OVERBEAUTY_RE, '').replace(/\s{2,}/g, ' ').trim();
    text = _trimPersonDescription(text, 150);
    if (!text || text.length < 30 || PERSON_DESC_SCENE_LEAK_RE.test(text)) {
      text = gender === 'male'
        ? '一位成年男性数字人，五官端正自然，肤质保留真实纹理，短发整洁，眼神稳定亲和。穿简洁衬衫或休闲西装，整体气质专业可信，妆发干净不过度修饰，适合口播和讲解。'
        : '一位成年女性数字人，五官端正自然，肤质保留真实纹理，长发或中长发打理清爽，眼神稳定亲和。穿简洁衬衫或通勤上衣，整体气质专业可信，妆容干净不过度修饰，适合口播和讲解。';
    }

    res.json({ success: true, description: text, char_count: text.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Step 1 · POST /api/dh/images/generate
//   body: { style, gender, description, aspectRatio? }
//   return: { imageUrl, filename }
// ═══════════════════════════════════════════════
// 通过 deyunai 漫路聚合调 nano-banana（OpenAI 兼容图像生成接口）
router.post('/scene/enhance', async (req, res) => {
  try {
    const { style = 'free', gender = '', keywords = '', person_description = '' } = req.body || {};
    const styleMeta = STYLE_PROMPTS[style] || STYLE_PROMPTS.free;
    const { callLLM } = require('../services/storyService');
    const sys = `你是数字人形象照的场景美术指导。你只负责写背景空间/光线/布景，不写人物长相、服装、姿势、全身半身、镜头焦段。
输出要求：
- 中文一段话，60-120 字。
- 只描述背景空间、主要陈设、光线、色调、虚化层次。
- 不要写人物、脸、头发、服装、动作、构图、全身、半身、特写。
- 如果用户没有给场景想法，默认生成“干净影棚幕布/布景”方向，适合 AI 数字人抠像和口播。
- 只输出正文，不要标题、编号、解释。`;
    const user = `风格参考：${styleMeta.desc || style}
人物气质参考（只用于匹配场景，不要复述人物）：${String(person_description || '').slice(0, 260) || '未填写'}
性别参考：${gender || '不限'}
用户场景想法：${keywords || '未填写，请生成干净影棚幕布类背景'}`;
    let text = (await callLLM(sys, user, {
      kb: { scene: 'digital_human_scene', query: `${styleMeta.desc || style} ${keywords || person_description}`.slice(0, 120), limit: 2, collection: 'digital_human' },
    })).trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/\n+/g, ' ');
    if (!text || text.length < 10) {
      text = '干净浅灰影棚幕布背景，柔和棚拍主光和轻微轮廓光，背景带细腻布纹和自然明暗层次，空间简洁不抢人物。';
    }
    res.json({ success: true, scene_description: text, char_count: text.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function _extractGeneratedImageUrl(payload) {
  const seen = new Set();
  const preferredKeys = new Set([
    'url', 'image_url', 'imageUrl', 'image', 'result_url', 'resultUrl',
    'output_url', 'outputUrl', 'b64_json', 'base64', 'content',
  ]);
  function walk(value) {
    if (!value) return '';
    if (typeof value === 'object') {
      if (seen.has(value)) return '';
      seen.add(value);
    }
    if (typeof value === 'string') {
      const v = value.trim();
      if (/^data:image\//i.test(v)) return v;
      if (/^https?:\/\//i.test(v)) return v;
      if (/^[A-Za-z0-9+/=]{800,}$/.test(v)) return v;
      return '';
    }
    if (typeof value !== 'object') return '';
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = walk(item);
        if (hit) return hit;
      }
      return '';
    }
    for (const key of Object.keys(value)) {
      if (preferredKeys.has(key)) {
        const hit = walk(value[key]);
        if (hit) return hit;
      }
    }
    for (const key of Object.keys(value)) {
      const hit = walk(value[key]);
      if (hit) return hit;
    }
    return '';
  }
  return walk(payload);
}

function _extractAsyncTaskId(payload) {
  return payload?.data?.task_id
    || payload?.data?.id
    || payload?.task_id
    || payload?.id
    || payload?.taskId
    || payload?.data?.taskId
    || '';
}

function _extractTaskStatus(payload) {
  return String(
    payload?.data?.task_status
    || payload?.data?.status
    || payload?.task_status
    || payload?.status
    || ''
  ).toLowerCase();
}

async function _generateViaDeyunaiNanoBanana({ prompt, aspectRatio, filename, destDir, referenceImages = [], outputSize = 'standard', resolution = '' }) {
  const { loadSettings } = require('../services/settingsService');
  const settings = loadSettings();
  const dy = (settings.providers || []).find(p => (p.id === 'deyunai' || p.preset === 'deyunai') && p.enabled && p.api_key);
  if (!dy) throw new Error('未配置 deyunai 漫路 provider');
  // 严格按 candidates 顺序优先（之前用 dy.models.find 是按 settings 数组顺序，pro 排在 base 后面会被跳过）
  const candidates = ['nano-banana-pro', 'nano-banana'];
  const modelMap = new Map((dy.models || []).map(m => [m.id, m]));
  let enabledModel = null;
  for (const id of candidates) {
    const m = modelMap.get(id);
    if (m && m.enabled !== false) { enabledModel = id; break; }
  }
  if (!enabledModel) throw new Error('deyunai 没启用 nano-banana / nano-banana-pro 模型');
  // ⚠️ deyunai nano-banana 硬限制：文档说 ≤ 2500 字符，但实测：
  //   - prompt.length == 2500 → HTTP 400 + `module not exists:v1`（边界 bug）
  //   - 长 prompt（2000+）含特殊字符/被截断的 UTF-8 半字符 → 也可能 400 + `module not exists:v1`
  // 安全做法：① cap 降到 2000；② 截断时按 unicode codepoint，避免破坏多字节字符；
  //          ③ 失败时把 prompt 头/尾片段打印到日志，方便定位脏字符。
  if (typeof prompt === 'string' && prompt.length > 2000) {
    const original = prompt.length;
    // 用 Array.from 按 codepoint 切，避免破坏 surrogate pair
    const chars = Array.from(prompt);
    if (chars.length > 2000) prompt = chars.slice(0, 2000).join('');
    console.warn(`[DH/images] prompt ${original} 字符 → 截断到 ${prompt.length}（cap=2000，防 deyunai 边界 bug）`);
  }
  // 移除控制字符（非打印 ASCII / 零宽字符），保留 \n \t
  if (typeof prompt === 'string') {
    prompt = prompt.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\uFEFF]/g, '');
  }

  const size = /^\d+x\d+$/i.test(String(resolution || ''))
    ? String(resolution).toLowerCase()
    : _outputSizeString(aspectRatio, outputSize);

  const axios = require('axios');
  // 经线上对照测试：nano-banana / nano-banana-pro 走 /v1 国内通道（200 SUCCEED）；
  // /c35/v1 海外通道反而报 `method not exists`。所以 baseUrl 固定 /v1。
  const baseUrl = (dy.api_url || 'https://api.deyunai.com/v1').replace(/\/$/, '');
  const headers = { Authorization: 'Bearer ' + dy.api_key, 'Content-Type': 'application/json' };

  const body = {
    model: enabledModel,
    prompt,
    n: 1,
    size,
  };
  const refs = (referenceImages || []).filter(Boolean).slice(0, 4);
  if (refs.length) {
    body.image_url = refs[0];
    if (refs.length > 1) body.image_urls = refs;
  }
  console.log(`[DH/images] 调 deyunai ${enabledModel} (refs=${refs.length}, prompt=${prompt.length}c)`);
  // 重试机制：deyunai 偶发 400 + `module not exists:v1` / 其它代理层错误，重试 2 次（间隔 2s/4s）
  let r;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      r = await axios.post(`${baseUrl}/images/generations`, body, { headers, timeout: 120000 });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message;
      console.warn(`[DH/images] 提交失败 attempt=${attempt+1}/3 status=${status} msg=${String(msg).slice(0, 120)}`);
      // 失败时把 prompt 头/尾片段打到日志，方便定位脏字符 / 编码问题
      if (attempt === 0) {
        const head = prompt.slice(0, 80).replace(/[\r\n]+/g, ' ');
        const tail = prompt.slice(-80).replace(/[\r\n]+/g, ' ');
        console.warn(`[DH/images] prompt[len=${prompt.length}] head="${head}" tail="${tail}" refs=${refs.length}`);
      }
      // 5xx / 429 / module-not-exists / network 类错误才重试；4xx 业务错（如 1201 prompt 超长）不重试
      const retriable = !status || status >= 500 || status === 429 || /module not exists|temporary|timeout|gateway|proxy/i.test(String(msg));
      if (!retriable) throw err;
      if (attempt < 2) await _sleep((attempt + 1) * 2000);
    }
  }
  if (!r) throw lastErr || new Error('deyunai 提交失败');
  let url = _extractGeneratedImageUrl(r.data);
  const taskId = _extractAsyncTaskId(r.data);
  if (!url && taskId) {
    const pollUrls = [
      `${baseUrl}/images/generations/${encodeURIComponent(taskId)}`,
      `${baseUrl}/images/${encodeURIComponent(taskId)}`,
      `${baseUrl}/tasks/${encodeURIComponent(taskId)}`,
      `${baseUrl}/task/${encodeURIComponent(taskId)}`,
      `${baseUrl}/images/tasks/${encodeURIComponent(taskId)}`,
    ];
    let lastPayload = r.data;
    for (let i = 0; i < 50 && !url; i++) {
      await _sleep(i < 2 ? 1800 : 3000);
      for (const pollUrl of pollUrls) {
        try {
          const pr = await axios.get(pollUrl, {
            headers,
            timeout: 30000,
          });
          lastPayload = pr.data;
          url = _extractGeneratedImageUrl(pr.data);
          const status = _extractTaskStatus(pr.data);
          if (url) break;
          if (/(fail|failed|error|cancel|rejected)/i.test(status)) {
            throw new Error('deyunai nano-banana 任务失败: ' + JSON.stringify(pr.data).slice(0, 240));
          }
        } catch (pollErr) {
          // 只在我们自己抛出的"任务失败"错误时再抛；axios 通讯错误（"Request failed with status code 400/404"
          // 也会含 failed 子串）必须吞掉继续尝试其它 pollUrl，否则会被误判为任务失败。
          if (pollErr.message && pollErr.message.startsWith('deyunai nano-banana 任务失败')) throw pollErr;
        }
      }
      if (!url && i % 5 === 4) {
        console.log(`[DH/images] nano-banana task ${taskId} waiting ${i + 1}/50 status=${_extractTaskStatus(lastPayload) || 'unknown'}`);
      }
    }
    if (!url) {
      throw new Error('deyunai nano-banana 异步任务超时，task_id=' + taskId + ' last=' + JSON.stringify(lastPayload).slice(0, 240));
    }
  }
  if (!url) throw new Error('deyunai nano-banana 未返回图片 URL: ' + JSON.stringify(r.data).slice(0, 200));

  fs.mkdirSync(destDir, { recursive: true });
  const outPath = path.join(destDir, filename + '.png');

  if (url.startsWith('data:image/')) {
    const b64 = url.replace(/^data:image\/\w+;base64,/i, '');
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  } else if (url.startsWith('http')) {
    const img = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    fs.writeFileSync(outPath, Buffer.from(img.data));
  } else {
    // base64
    fs.writeFileSync(outPath, Buffer.from(url, 'base64'));
  }
  console.log(`[DH/images] ✓ deyunai ${enabledModel} 完成: ${outPath}`);
  return outPath;
}

async function _generateViaDeyunaiSpecificImageModel({ model, prompt, aspectRatio, filename, destDir, referenceImages = [], outputSize = 'standard', resolution = '' }) {
  if (!model) throw new Error('missing image model');
  if (typeof prompt === 'string' && prompt.length > 2000) {
    const original = prompt.length;
    prompt = Array.from(prompt).slice(0, 2000).join('');
    console.warn(`[DH/images] ${model} prompt ${original} 字符 → 截断到 ${prompt.length}`);
  }
  if (typeof prompt === 'string') {
    prompt = prompt.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\uFEFF]/g, '');
  }
  const { loadSettings } = require('../services/settingsService');
  const settings = loadSettings();
  const dy = (settings.providers || []).find(p => (p.id === 'deyunai' || p.preset === 'deyunai') && p.enabled && p.api_key);
  const m = (dy?.models || []).find(x => x.id === model && x.enabled !== false);
  if (!dy || !m) throw new Error(`deyunai 未启用 ${model}`);

  const size = /^\d+x\d+$/i.test(String(resolution || ''))
    ? String(resolution).toLowerCase()
    : _outputSizeString(aspectRatio, outputSize);
  const dyClient = require('../services/deyunaiService');
  console.log(`[DH/images] 调 deyunai ${model} (refs=${(referenceImages || []).filter(Boolean).length}, prompt=${prompt.length}c)`);
  const r = await dyClient.generateImage({
    model,
    prompt,
    n: 1,
    size,
    referenceImages: (referenceImages || []).filter(Boolean).slice(0, 4),
    timeoutMs: 180000,
    agentId: 'digital_human_step1',
  });
  const url = r.urls?.[0];
  if (!url) throw new Error(`${model} 未返回图片 URL`);
  fs.mkdirSync(destDir, { recursive: true });
  const outPath = path.join(destDir, `${filename}.png`);
  if (url.startsWith('data:image/')) {
    const b64 = url.replace(/^data:image\/\w+;base64,/i, '');
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  } else if (url.startsWith('http')) {
    const img = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    fs.writeFileSync(outPath, Buffer.from(img.data));
  } else {
    fs.writeFileSync(outPath, Buffer.from(url, 'base64'));
  }
  console.log(`[DH/images] ✓ deyunai ${model} 完成: ${outPath}`);
  return outPath;
}

const DEYUNAI_SHOWROOM_EDIT_MODELS = [
  'qwen-image-edit',
  'doubao-seedream-4-0-250828',
  'qwen-image',
];

function _absolutePublicUrl(req, url) {
  if (!url || typeof url !== 'string') return '';
  if (/^https?:\/\//i.test(url)) return url;
  return _publicBaseUrl(req) + (url.startsWith('/') ? url : `/${url}`);
}

// Convert a URL (which may point to our own server) into a base64 data URI so
// external AI providers (Replicate / deyunai) can use it without needing to reach our port.
async function _resolveImageForExternalApi(req, url) {
  if (!url) return '';
  const localPath = _localAssetPathFromUrl(url);
  if (localPath) {
    try {
      const data = fs.readFileSync(localPath);
      const ext = path.extname(localPath).toLowerCase().replace('.', '');
      const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
      const mime = mimeMap[ext] || 'image/jpeg';
      return `data:${mime};base64,${data.toString('base64')}`;
    } catch (e) {
      console.warn('[DH] 转 base64 失败，回退 URL:', e.message);
    }
  }
  return _absolutePublicUrl(req, url);
}

function _localAssetPathFromUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let clean = url.split('?')[0];
  try {
    const u = new URL(clean);
    clean = u.pathname;
  } catch {}
  if (clean.includes('/public/jimeng-assets/')) {
    const p = path.join(JIMENG_ASSETS_DIR, path.basename(clean));
    return fs.existsSync(p) ? p : '';
  }
  if (clean.includes('/api/dh/my-avatars/')) return '';
  if (clean.startsWith('/public/jimeng-assets/')) {
    const p = path.join(JIMENG_ASSETS_DIR, path.basename(clean));
    return fs.existsSync(p) ? p : '';
  }
  return '';
}

async function _prepareProductAsset(inputPath, outName) {
  const sharp = _loadSharp();
  if (!sharp) return null;
  const maxSize = 1200;
  const src = sharp(inputPath).rotate().resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true }).ensureAlpha();
  const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels || 4;
  const sample = [];
  const pts = [
    [0, 0], [Math.max(0, info.width - 1), 0],
    [0, Math.max(0, info.height - 1)], [Math.max(0, info.width - 1), Math.max(0, info.height - 1)],
  ];
  for (const [x, y] of pts) {
    const i = (y * info.width + x) * channels;
    sample.push([data[i], data[i + 1], data[i + 2]]);
  }
  const bg = sample.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]).map(v => v / sample.length);
  const bgBright = (bg[0] + bg[1] + bg[2]) / 3;
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += channels) {
    const dr = out[i] - bg[0];
    const dg = out[i + 1] - bg[1];
    const db = out[i + 2] - bg[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    const bright = (out[i] + out[i + 1] + out[i + 2]) / 3;
    if ((bgBright > 210 && bright > 205 && dist < 46) || (bgBright > 235 && bright > 230 && dist < 70)) {
      out[i + 3] = 0;
    }
  }
  const outPath = path.join(JIMENG_ASSETS_DIR, outName);
  await sharp(out, { raw: info })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .png()
    .toFile(outPath);
  return { path: outPath, url: `/public/jimeng-assets/${path.basename(outPath)}` };
}

function _productSourceUrl(product) {
  return product?.image_url || product?.imageUrl || product?.prepared_url || product?.preparedUrl || product?.cutout_url || product?.cutoutUrl || '';
}

function _normalizePublicImageUrl(url) {
  try {
    const u = new URL(String(url || ''), 'http://local.invalid');
    return `${u.pathname.replace(/\/+/g, '/')}${u.search || ''}`;
  } catch {
    return String(url || '').split('#')[0].trim();
  }
}

function _samePublicImageUrl(a, b) {
  const aa = _normalizePublicImageUrl(a).split('?')[0];
  const bb = _normalizePublicImageUrl(b).split('?')[0];
  return !!aa && !!bb && aa === bb;
}

function _loadSharp() {
  try {
    return require('sharp');
  } catch (err) {
    console.warn('[DH/product-fuse] sharp unavailable, fallback to ffmpeg:', err.message.split('\n')[0]);
    return null;
  }
}

async function _createVisibleProductCompositeFallback(req, avatar, product, baseUrl, productName = '') {
  const sharp = _loadSharp();
  if (!sharp) throw new Error('商品合成兜底需要 sharp 支持');
  const personBuffer = await _fetchImageBuffer(_absolutePublicUrl(req, avatar.image_url));
  const productBuffer = await _fetchImageBuffer(_absolutePublicUrl(req, _productSourceUrl(product) || product.image_url));
  const base = sharp(personBuffer).rotate();
  const meta = await base.metadata();
  const width = meta.width || 900;
  const height = meta.height || 1600;
  const productWidth = Math.max(180, Math.min(Math.round(width * 0.34), 360));
  const productPng = await sharp(productBuffer)
    .rotate()
    .resize({ width: productWidth, withoutEnlargement: true })
    .png()
    .toBuffer();
  const pMeta = await sharp(productPng).metadata();
  const pad = Math.max(10, Math.round(productWidth * 0.045));
  const cardW = (pMeta.width || productWidth) + pad * 2;
  const cardH = (pMeta.height || productWidth) + pad * 2;
  const left = Math.max(12, Math.round(width * 0.08));
  const top = Math.min(height - cardH - 18, Math.max(18, Math.round(height * 0.55)));
  const shadowSvg = Buffer.from(`
    <svg width="${cardW + 16}" height="${cardH + 16}" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="8" width="${cardW}" height="${cardH}" rx="18" fill="rgba(0,0,0,0.28)"/>
      <rect x="0" y="0" width="${cardW}" height="${cardH}" rx="18" fill="rgba(255,255,255,0.96)"/>
    </svg>
  `);
  const outName = `product_visible_${Date.now()}_${uuidv4().slice(0, 8)}.jpg`;
  const outPath = path.join(JIMENG_ASSETS_DIR, outName);
  await base
    .composite([
      { input: shadowSvg, left, top },
      { input: productPng, left: left + pad, top: top + pad },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(outPath);
  console.log(`[DH/product-fuse] visible product fallback completed: ${path.basename(outPath)} (${productName || product?.image_name || 'product'})`);
  return `${baseUrl}/public/jimeng-assets/${outName}`;
}

async function _ensureVisibleProductDisplay(req, imageUrl, product, baseUrl, productName = '') {
  const sharp = _loadSharp();
  if (!sharp || !imageUrl || !product?.image_url) return imageUrl;
  if (process.env.DH_PRODUCT_VISIBLE_OVERLAY !== '1') return imageUrl;
  try {
    const imageBuffer = await _fetchImageBuffer(_absolutePublicUrl(req, imageUrl));
    const productBuffer = await _fetchImageBuffer(_absolutePublicUrl(req, product.image_url || product.imageUrl || _productSourceUrl(product)));
    const base = sharp(imageBuffer).rotate();
    const meta = await base.metadata();
    const width = meta.width || 900;
    const height = meta.height || 1600;
    const productWidth = Math.max(180, Math.min(Math.round(width * 0.28), 340));
    const productPng = await sharp(productBuffer)
      .rotate()
      .resize({ width: productWidth, withoutEnlargement: true })
      .png()
      .toBuffer();
    const pMeta = await sharp(productPng).metadata();
    const pad = Math.max(10, Math.round(productWidth * 0.05));
    const labelH = productName ? Math.max(28, Math.round(productWidth * 0.12)) : 0;
    const cardW = (pMeta.width || productWidth) + pad * 2;
    const cardH = (pMeta.height || productWidth) + pad * 2 + labelH;
    const left = Math.max(12, width - cardW - Math.round(width * 0.05));
    const top = Math.max(12, height - cardH - Math.round(height * 0.06));
    const safeLabel = String(productName || product?.image_name || '').replace(/[<>&]/g, '').slice(0, 18);
    const cardSvg = Buffer.from(`
      <svg width="${cardW + 16}" height="${cardH + 16}" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="8" width="${cardW}" height="${cardH}" rx="18" fill="rgba(0,0,0,0.28)"/>
        <rect x="0" y="0" width="${cardW}" height="${cardH}" rx="18" fill="rgba(255,255,255,0.96)"/>
        ${safeLabel ? `<text x="${pad}" y="${cardH - Math.round(labelH * 0.35)}" font-family="Arial, sans-serif" font-size="${Math.max(16, Math.round(productWidth * 0.055))}" fill="#222">${safeLabel}</text>` : ''}
      </svg>
    `);
    const outName = `product_visible_final_${Date.now()}_${uuidv4().slice(0, 8)}.jpg`;
    const outPath = path.join(JIMENG_ASSETS_DIR, outName);
    await base
      .composite([
        { input: cardSvg, left, top },
        { input: productPng, left: left + pad, top: top + pad },
      ])
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(outPath);
    console.log(`[DH/product-fuse] ensured visible product display: ${path.basename(outPath)} (${productName || product?.image_name || 'product'})`);
    return `${baseUrl}/public/jimeng-assets/${outName}`;
  } catch (err) {
    console.warn('[DH/product-fuse] ensure visible product failed:', err.message);
    throw err;
  }
}

function _ffmpegBin() {
  return process.env.FFMPEG_PATH || require('ffmpeg-static') || 'ffmpeg';
}

// 注：以前这里有 _createProductCompositeFallbackFfmpeg / _createProductCompositeFallback 两个贴图兜底函数
// （sharp/FFmpeg 把商品 PNG overlay 到人物图 + 加假肉色"手块"），效果像 PS 贴图，与 Topview 真融合差距巨大。
// 2026-05-03 已删除 — 商品融合只走 nano-banana / Seedream 等真正 AI 图像融合模型。
// 模型失败时直接抛错让用户重试或换图，绝不返回贴图假成品。


function _replicateAuthMessage(msg) {
  const text = String(msg || '');
  if (/valid authentication token|authentication token|unauthorized|401|invalid api key|invalid token/i.test(text)) {
    return 'Replicate API Key 无效或已失效：这不是余额不足，请到后台 AI 供应商配置里更新 Replicate Token（通常以 r8_ 开头）。';
  }
  if (/payment|billing|credit|balance|insufficient/i.test(text)) {
    return 'Replicate 余额或账单状态异常：请检查 Replicate 账户余额/账单后重试。';
  }
  return '';
}

function _formatReplicateError(prefix, err) {
  const status = err?.response?.status;
  const msg = err?.response?.data?.detail || err?.response?.data?.error || err?.message || err;
  const normalized = _replicateAuthMessage(`${status || ''} ${msg}`);
  return `${prefix}: ${normalized || String(msg).slice(0, 200)}`;
}

// ════════════════════════════════════════════════
// flux-kontext-multi (Black Forest Labs / Replicate) — 多 ref 图像融合
// 接 multi-image-kontext-pro 模型：输入 input_image_1（人物）+ input_image_2（商品）+ prompt
// 商品 SKU 保真度业界第一，明显优于 nano-banana。
// 价格 ≈ ¥0.4/张（pro），¥0.8/张（max）。
// 需要在 settings 配 Replicate provider + REPLICATE_API_TOKEN。
// ════════════════════════════════════════════════
async function _generateViaFluxKontextMulti({ prompt, image1Url, image2Url, aspectRatio, filename, destDir, modelTier = 'pro' }) {
  const { loadSettings, getApiKey } = require('../services/settingsService');
  const settings = loadSettings();
  const apiKey = getApiKey('replicate') || process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  if (!apiKey) throw new Error('未配置 Replicate API key（settings 加 replicate provider 或 export REPLICATE_API_TOKEN）');

  // 模型路径：multi-image-kontext-pro / max
  // Replicate namespace is flux-kontext-apps, not black-forest-labs/flux-kontext-apps.
  const modelPath = modelTier === 'max'
    ? 'flux-kontext-apps/multi-image-kontext-max'
    : 'flux-kontext-apps/multi-image-kontext-pro';

  // Replicate 接受 9:16 / 16:9 / 1:1 / 4:3 / 3:4
  const aspect = ['9:16','16:9','1:1','4:3','3:4'].includes(aspectRatio) ? aspectRatio : '9:16';

  const axios = require('axios');
  const submitUrl = `https://api.replicate.com/v1/models/${modelPath}/predictions`;
  const headers = {
    Authorization: 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
    Prefer: 'wait=60', // 提交时同步等最多 60s，多数情况下直接拿到结果不用轮询
  };
  const body = {
    input: {
      input_image_1: image1Url,
      input_image_2: image2Url,
      prompt,
      aspect_ratio: aspect,
      output_format: 'png',
      safety_tolerance: 2,
    },
  };

  console.log(`[DH/flux-kontext] 调 ${modelPath} 提交任务…`);
  let prediction;
  try {
    const r = await axios.post(submitUrl, body, { headers, timeout: 90000 });
    prediction = r.data;
  } catch (err) {
    throw new Error(_formatReplicateError('flux-kontext 提交失败', err));
  }

  // 轮询 — 如果 wait=60 已经返回 succeeded 就直接拿结果
  let result = prediction;
  let attempts = 0;
  while (result?.status && !['succeeded', 'failed', 'canceled'].includes(result.status) && attempts < 30) {
    await _sleep(2500);
    const pollR = await axios.get(`https://api.replicate.com/v1/predictions/${result.id}`, { headers: { Authorization: 'Bearer ' + apiKey }, timeout: 25000 });
    result = pollR.data;
    attempts++;
  }
  if (result.status !== 'succeeded') {
    throw new Error('flux-kontext 任务失败: status=' + result.status + ' error=' + String(result.error || '').slice(0, 200));
  }
  const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
  if (!outputUrl) throw new Error('flux-kontext 未返回图片 URL');

  fs.mkdirSync(destDir, { recursive: true });
  const outPath = path.join(destDir, filename + '.png');
  const img = await axios.get(outputUrl, { responseType: 'arraybuffer', timeout: 60000 });
  fs.writeFileSync(outPath, Buffer.from(img.data));
  console.log(`[DH/flux-kontext] ✓ 融合完成 ${path.basename(outPath)}`);
  return outPath;
}

// ════════════════════════════════════════════════════════════════
// 商品数字人融合 — 两步法（人脸保真级）
//   Step A: flux-kontext-multi-pro  →  注入商品到一张构图正确的"持物图"
//   Step B: InstantID (Replicate)   →  把脸换成上传的真人脸（ID 锁定）
// 这是当前唯一能同时保人脸+保商品 SKU 的稳定通路。
// 没有 Replicate Key 直接抛错——绝不再用 nano-banana 兜底（会生成随机脸）。
// ════════════════════════════════════════════════════════════════
async function _generateProductIntegratedAvatarImage(req, avatar, product) {
  if (!product?.image_url || !avatar?.image_url) return null;
  const baseUrl = _publicBaseUrl(req);

  try {
    const topview = require('../services/topviewService');
    const fuseModel = _pickPipelineModel('product_avatar.fuse_image');
    if (fuseModel && fuseModel.provider_id !== 'topview') {
      throw new Error(`模型调用管理当前将商品融合形象图配置为 ${fuseModel.provider_id}/${fuseModel.model_id}，当前商品融合接口只支持 Topview Product Avatar，请在模型调用管理切回 topview-product-avatar-v3`);
    }
    const rawName = (product.name || '').replace(/^[0-9a-f-]{8,}(\.(jpg|jpeg|png|webp))?$/i, '').trim();
    const productName = rawName || product.image_name || 'the uploaded product';
    const motionStyle = product.motion_style || 'hold';
    const productPosePrompt = {
      hold: [
        'The presenter holds the exact uploaded product naturally near chest or face level.',
        'One hand clearly grips the product, product front label/screen faces the camera.',
      ],
      point: [
        'The presenter holds the exact uploaded product with one hand and points to the product with the other index finger.',
        'The pointing gesture must be clear and natural, like explaining a key feature.',
      ],
      explain: [
        'The presenter holds or places the exact uploaded product close to the body while using an open-palm explanation gesture.',
        'The pose should feel like a live commerce presenter recommending the product.',
      ],
      demo: [
        'The presenter demonstrates the exact uploaded product in use with both hands visible.',
        'Show realistic hand contact, usage gesture, and natural finger occlusion on the product.',
      ],
      closeup: [
        'Create a tighter product-focused presenter shot with the exact uploaded product close to camera.',
        'The product remains sharp and readable while the presenter naturally frames it with one hand.',
      ],
      compare: [
        'The presenter holds the exact uploaded product while making a left-right comparison gesture.',
        'The product must remain the main focus and face the camera.',
      ],
    }[motionStyle] || [
      'The presenter naturally presents the exact uploaded product.',
      'The product must look physically present in the hand or directly beside the hand.',
    ];
    const personUrl = await _resolveImageForExternalApi(req, avatar.image_url);
    const productUrl = await _resolveImageForExternalApi(req, _productSourceUrl(product));
    const startedAt = Date.now();
    const tv = await topview.generateProductAvatarImage({
      personImageUrl: personUrl,
      productImageUrl: productUrl,
      productName,
      gender: product.gender || avatar.gender || '',
      motionStyle,
      prompt: [
        'Create a realistic product presenter image from the uploaded person and product.',
        ...productPosePrompt,
        'Preserve face identity, hairstyle, outfit style and product SKU details.',
        'Avoid floating stickers, pasted product cards, extra products, warped hands, unreadable labels and product category changes.',
      ].join(' '),
    });
    if (tv?.imageUrl) {
      const finalPath = path.join(JIMENG_ASSETS_DIR, `topview_product_${Date.now()}_${uuidv4().slice(0, 8)}.png`);
      const imgResp = await axios.get(tv.imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
      fs.writeFileSync(finalPath, Buffer.from(imgResp.data));
      const hasProduct = await _checkProductVisibleInResult(req, finalPath, product, productName);
      if (hasProduct === false) {
        console.warn(`[DH/product-fuse] Topview result rejected: product not visible (${path.basename(finalPath)})`);
        throw new Error('商品未出现在融合成品中');
      }
      console.log(`[DH/product-fuse] Topview Product Avatar completed: ${path.basename(finalPath)}`);
      req._lastProductFusion = {
        imageId: tv.imageId || '',
        taskId: tv.taskId || '',
        removeBackgroundTaskId: tv.removeBackgroundTaskId || '',
        provider: 'topview',
      };
      try {
        require('../services/tokenTracker').record({
          provider: 'topview',
          model: fuseModel?.model_id || 'topview-product-avatar-v3',
          category: 'image',
          agentId: 'product_avatar.fuse_image',
          imageCount: 1,
          durationMs: Date.now() - startedAt,
          status: 'success',
        });
      } catch {}
      const visibleUrl = await _ensureVisibleProductDisplay(req, `${baseUrl}/public/jimeng-assets/${path.basename(finalPath)}`, product, baseUrl, productName);
      if (visibleUrl !== `${baseUrl}/public/jimeng-assets/${path.basename(finalPath)}`) {
        req._lastProductFusion = { ...(req._lastProductFusion || {}), product_visible_overlay: true };
      }
      return visibleUrl;
    }
  } catch (topviewErr) {
    console.error('[DH/product-fuse] Topview Product Avatar failed:', topviewErr);
    console.warn('[DH/product-fuse] Topview failed, fallback to Replicate flux-kontext + InstantID:', topviewErr.message);
  }

  try {
    const rawName = (product.name || '').replace(/^[0-9a-f-]{8,}(\.(jpg|jpeg|png|webp))?$/i, '').trim();
    const productName = rawName || product.image_name || 'the uploaded product';
    const motionStyle = product.motion_style || 'hold';
    const productPosePrompt = {
      hold: 'The presenter naturally holds the exact uploaded product at chest level, product front side facing camera.',
      point: 'The presenter holds the exact uploaded product and points to it with the other hand.',
      explain: 'The presenter holds or places the exact uploaded product close to the body while explaining with an open-palm gesture.',
      demo: 'The presenter demonstrates the exact uploaded product with realistic hand contact.',
      closeup: 'Create a closer product-focused presenter shot with the exact product near camera.',
    }[motionStyle] || 'The presenter naturally presents the exact uploaded product.';
    const personUrl = await _resolveImageForExternalApi(req, avatar.image_url);
    const productUrl = await _resolveImageForExternalApi(req, _productSourceUrl(product));
    const fallbackPrompt = [
      'Create one photorealistic ecommerce product presenter image from exactly two reference images.',
      'Reference image 1 is the presenter/person. Preserve the same face identity, age, hairstyle, body type and outfit impression.',
      'Reference image 2 is the exact uploaded product. Preserve its category, silhouette, proportions, color, logo/screen area and visible details.',
      productPosePrompt,
      `Product name/reference: ${productName}.`,
      'The product must be physically present in the hand or directly beside the hand, with natural contact shadows and finger occlusion.',
      'If the uploaded product is a texture swatch, sample card, fabric sheet, sticker sheet or flat square item, the presenter must visibly hold that exact flat item toward the camera.',
      'The generated image is invalid if the product is absent, hidden, only implied, or replaced by text on clothing/background.',
      'No floating sticker, no pasted product card, no extra products, no product category swap, no deformed hands, no text overlay, no watermark.',
      'Realistic phone-camera photo, natural lighting, waist-up framing, clean ecommerce presenter composition.',
    ].join(' ');
    const fallbackPath = await _generateViaDeyunaiNanoBanana({
      prompt: fallbackPrompt,
      aspectRatio: '9:16',
      filename: `product_fused_deyunai_${Date.now()}_${uuidv4().slice(0, 8)}`,
      destDir: JIMENG_ASSETS_DIR,
      referenceImages: [personUrl, productUrl],
      outputSize: 'standard',
    });
    const hasProduct = await _checkProductVisibleInResult(req, fallbackPath, product, productName);
    if (hasProduct === false) {
      console.warn(`[DH/product-fuse] DeyunAI fallback rejected: product not visible (${path.basename(fallbackPath)})`);
      throw new Error('商品未出现在融合成品中');
    }
    console.log(`[DH/product-fuse] DeyunAI fallback completed: ${path.basename(fallbackPath)}`);
    req._lastProductFusion = { provider: 'deyunai', model: 'nano-banana', fallback: true };
    const visibleUrl = await _ensureVisibleProductDisplay(req, `${baseUrl}/public/jimeng-assets/${path.basename(fallbackPath)}`, product, baseUrl, productName);
    if (visibleUrl !== `${baseUrl}/public/jimeng-assets/${path.basename(fallbackPath)}`) {
      req._lastProductFusion = { ...(req._lastProductFusion || {}), product_visible_overlay: true };
    }
    return visibleUrl;
  } catch (deyunaiErr) {
    console.error('[DH/product-fuse] DeyunAI fallback failed:', deyunaiErr);
  }

  const { getApiKey } = require('../services/settingsService');
  const replicateKey = getApiKey('replicate') || process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  if (!replicateKey) {
    const compositeUrl = await _createVisibleProductCompositeFallback(req, avatar, product, baseUrl, product.name || product.image_name || '');
    req._lastProductFusion = { provider: 'visible-composite', fallback: true, product_visible: true };
    return compositeUrl;
  }

  const rawName = (product.name || '').replace(/^[0-9a-f-]{8,}(\.(jpg|jpeg|png|webp))?$/i, '').trim();
  const productName = rawName || product.image_name || 'the uploaded product';
  const motionStyle = product.motion_style || 'hold';

  const actionHint = {
    hold: 'one hand visibly grips the product at chest level with all fingers wrapped, knuckles visible, front face of product toward camera',
    point: 'one hand holds the product up to camera, the other hand points at it with index finger',
    compare: 'one hand holds the product upright, the other hand gestures comparison',
    demo: 'one hand holds the product up at chest height, the other hand mid-presenter-gesture',
  }[motionStyle] || 'one hand grips the product naturally';

  // Prompt for Step A (flux-kontext): 商品+构图，人脸允许漂（反正 Step B 会换）
  const kontextPrompt = [
    `A young person holding the EXACT product from image 2 in their hand, waist-up framing, both hands visible, photorealistic.`,
    `The product MUST physically appear in this photo, exactly matching image 2 in shape, color, logo, screen content, proportions. NEVER omit, NEVER replace.`,
    `Composition: vertical 9:16, waist-up, hand grips product with five fingers wrapped, contact shadows, natural finger occlusion.`,
    `Pose: ${actionHint}. Anatomically correct hands.`,
    `Product: ${productName}. Front face toward camera, not cropped. If smartphone: vertical orientation, screen ON.`,
    `Photography: candid 85mm DSLR snapshot, real depth of field, natural ambient light.`,
    `Avoid: empty hands, floating product, product card/sticker, deformed fingers, multiple persons, category swap.`,
  ].join(' ');

  const personUrl = await _resolveImageForExternalApi(req, avatar.image_url);
  const productUrl = await _resolveImageForExternalApi(req, _productSourceUrl(product));
  console.log(`[DH/product-fuse] 图像解析: person=${personUrl.startsWith('data:') ? `base64(${Math.round(personUrl.length/1024)}KB)` : personUrl}, product=${productUrl.startsWith('data:') ? `base64(${Math.round(productUrl.length/1024)}KB)` : productUrl}`);

  const filename = `product_fused_${Date.now()}_${uuidv4().slice(0, 8)}`;

  // ── Step A: flux-kontext-multi-pro 注入商品 ──
  console.log('[DH/product-fuse] Step A: flux-kontext 注入商品（脸不重要，下一步会换）');
  let stepAPath;
  try {
    stepAPath = await _generateViaFluxKontextMulti({
      prompt: kontextPrompt,
      image1Url: personUrl,
      image2Url: productUrl,
      aspectRatio: '9:16',
      filename: filename + '_kontext',
      destDir: JIMENG_ASSETS_DIR,
      modelTier: 'pro',
    });
  } catch (e) {
    const hint = _replicateAuthMessage(e.message);
    throw new Error(`Step A flux-kontext 失败: ${hint || e.message}`);
  }
  const stepAUrl = `${baseUrl}/public/jimeng-assets/${path.basename(stepAPath)}`;
  console.log(`[DH/product-fuse] Step A ✓ 持物图: ${path.basename(stepAPath)}`);

  // ── Step B: InstantID 把脸换成上传的真人脸（人脸 ID 锁定） ──
  console.log('[DH/product-fuse] Step B: InstantID 锁定真人脸');
  let stepBImageUrl;
  try {
    const instantPrompt = `photorealistic portrait, holding ${productName}, natural skin, sharp focus, identity preserved`;
    const negPrompt = 'low quality, distorted, plastic skin, cartoon, blurry, deformed, multiple faces, child';
    stepBImageUrl = await _runInstantIDForProduct({
      apiKey: replicateKey,
      refFaceUrl: personUrl,
      poseImageUrl: stepAUrl,
      prompt: instantPrompt,
      negativePrompt: negPrompt,
    });
  } catch (e) {
    throw new Error(`Step B InstantID 换脸失败: ${e.message}。Step A 已生成持物图但人脸非真人，未保存。`);
  }

  // 下载最终图到本地
  const finalPath = path.join(JIMENG_ASSETS_DIR, filename + '.png');
  try {
    const imgResp = await axios.get(stepBImageUrl, { responseType: 'arraybuffer', timeout: 60000 });
    fs.writeFileSync(finalPath, Buffer.from(imgResp.data));
  } catch (e) {
    throw new Error(`下载 Step B 结果失败: ${e.message}`);
  }
  const finalHasProduct = await _checkProductVisibleInResult(req, finalPath, product, productName);
  if (finalHasProduct === false) {
    console.warn(`[DH/product-fuse] Replicate result rejected: product not visible (${path.basename(finalPath)})`);
    const compositeUrl = await _createVisibleProductCompositeFallback(req, avatar, product, baseUrl, productName);
    req._lastProductFusion = { provider: 'visible-composite', fallback: true, product_visible: true };
    return compositeUrl;
  }
  console.log(`[DH/product-fuse] ✓ 两步融合完成: ${path.basename(finalPath)}`);
  const visibleUrl = await _ensureVisibleProductDisplay(req, `${baseUrl}/public/jimeng-assets/${path.basename(finalPath)}`, product, baseUrl, productName);
  if (visibleUrl !== `${baseUrl}/public/jimeng-assets/${path.basename(finalPath)}`) {
    req._lastProductFusion = { ...(req._lastProductFusion || {}), product_visible_overlay: true };
  }
  return visibleUrl;
}

// 调用 Replicate zsxkib/instant-id —— 锁定参考人脸 + pose 引导
async function _runInstantIDForProduct({ apiKey, refFaceUrl, poseImageUrl, prompt, negativePrompt }) {
  const submitUrl = 'https://api.replicate.com/v1/models/zsxkib/instant-id/predictions';
  const headers = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', Prefer: 'wait=60' };
  const input = {
    image: refFaceUrl,
    pose_image: poseImageUrl,
    prompt: prompt || 'photorealistic, preserve facial identity',
    negative_prompt: negativePrompt || 'low quality, distorted, plastic skin',
    num_inference_steps: 30,
    guidance_scale: 5,
    ip_adapter_scale: 0.85,           // 高 ID 还原
    controlnet_conditioning_scale: 0.9, // 高 pose 跟随，保留 Step A 构图（手+商品）
  };
  let r;
  try {
    r = await axios.post(submitUrl, { input }, { headers, timeout: 120000 });
  } catch (err) {
    throw new Error(_formatReplicateError('InstantID 提交失败', err));
  }
  let result = r.data;
  for (let i = 0; i < 40 && result?.status && !['succeeded', 'failed', 'canceled'].includes(result.status); i++) {
    await _sleep(2500);
    try {
      const pollR = await axios.get(`https://api.replicate.com/v1/predictions/${result.id}`, { headers: { Authorization: 'Bearer ' + apiKey }, timeout: 25000 });
      result = pollR.data;
    } catch (err) {
      throw new Error(_formatReplicateError('InstantID 轮询失败', err));
    }
  }
  if (result.status !== 'succeeded') throw new Error('InstantID status=' + result.status + ' err=' + String(result.error || '').slice(0, 200));
  const out = Array.isArray(result.output) ? result.output[0] : result.output;
  if (!out) throw new Error('InstantID 未返回 URL');
  return out;
}

function _getSeedanceAdConfig(preferred = null) {
  const { loadSettings } = require('../services/settingsService');
  const settings = loadSettings();
  const providers = settings.providers || [];
  let p = preferred?.provider_id
    ? providers.find(x => (x.id === preferred.provider_id || x.preset === preferred.provider_id) && x.enabled && x.api_key)
    : null;
  if (preferred && _isSeedancePipelineModel(preferred)) {
    p = _findRunnableSeedanceProvider(preferred);
    if (!p) throw new Error(`模型调用管理配置了 ${preferred.provider_id}/${preferred.model_id}，但该供应商或模型未启用`);
  }
  if (!p) p = providers.find(x => x.enabled && x.api_key && (
      /火山方舟|seedance|^ark$/i.test(x.name || x.id || '') || String(x.id || '').includes('202604')
    ));
  if (!p) throw new Error('未配置火山方舟 Seedance API Key');
  const models = Array.isArray(p.models) ? p.models : [];
  const unsupportedModels = new Set([
    'doubao-seedance-2-0-i2v-250428',
    'doubao-seedance-2-0-t2v-250428',
  ]);
  const preferredModels = [
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-1-5-pro-251215',
    'doubao-seedance-1-0-pro-250528',
    'doubao-seedance-1-0-pro-fast-251015',
  ];
  if (preferred?.model_id && !unsupportedModels.has(preferred.model_id)) {
    return { apiKey: p.api_key, model: preferred.model_id, providerId: p.id };
  }
  const model = preferredModels.find(id => models.some(m => m.id === id && m.enabled !== false))
    || models.find(m => /seedance/i.test(m.id || '') && m.enabled !== false && !unsupportedModels.has(m.id))?.id
    || 'doubao-seedance-2-0-260128';
  return { apiKey: p.api_key, model };
}

function _taskPatch(taskId, patch) {
  const t = productAdTasks.get(taskId);
  if (!t) return null;
  Object.assign(t, patch, { updated_at: new Date().toISOString() });
  productAdTasks.set(taskId, t);
  return t;
}

function _markTaskSuperseded(oldTaskId, newTaskId, userId = null) {
  const oldId = String(oldTaskId || '').trim();
  if (!oldId || !newTaskId || oldId === String(newTaskId)) return;
  const memoryTask = productAdTasks.get(oldId);
  if (memoryTask && (!userId || !memoryTask.user_id || memoryTask.user_id === userId)) {
    productAdTasks.set(oldId, {
      ...memoryTask,
      hidden: true,
      superseded_by: newTaskId,
      status: memoryTask.status === 'done' ? memoryTask.status : 'superseded',
      updated_at: new Date().toISOString(),
    });
  }
  try {
    const stored = db.getAvatarTask(oldId);
    if (stored && (!userId || !stored.user_id || stored.user_id === userId)) {
      db.updateAvatarTask(oldId, {
        hidden: true,
        superseded_by: newTaskId,
        status: stored.status === 'done' ? stored.status : 'superseded',
        updated_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[DH/tasks] mark superseded failed:', err.message);
  }
}

function _cleanJsonArray(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/\[[\s\S]*\]/);
  return JSON.parse(m ? m[0] : raw);
}

function _cleanJsonObject(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed[0] || {};
    return parsed || {};
  } catch {}
  const arr = raw.match(/\[[\s\S]*\]/);
  if (arr) {
    const parsed = JSON.parse(arr[0]);
    return Array.isArray(parsed) ? (parsed[0] || {}) : (parsed || {});
  }
  const obj = raw.match(/\{[\s\S]*\}/);
  return obj ? JSON.parse(obj[0]) : {};
}

function _fallbackProductAdScenes(product, topic, durationSec) {
  const name = product?.name || product?.image_name || 'this product';
  const selling = product?.selling_points || 'portable, useful, easy to use';
  const each = Math.max(3, Math.min(6, Math.round((durationSec || 18) / 4)));
  return [
    {
      title: '生活场景',
      role: 'scene',
      duration: each,
      voiceover: `${name}，让日常使用更轻松。`,
      visual_prompt: `A realistic ecommerce lifestyle scene showing ${name} in use, the exact uploaded product clearly visible, natural daylight, social media ad style. Context: ${topic || selling}.`,
      video_prompt: `Slow camera push-in on the product in a real use scene. Keep the exact product shape, color and category unchanged. Smooth commercial ad motion.`,
    },
    {
      title: '痛点对比',
      role: 'pain',
      duration: each,
      voiceover: `不用忍受麻烦和低效率，它把关键问题一次解决。`,
      visual_prompt: `A realistic comparison scene where people face the pain point, while ${name} appears as the clear solution. Exact uploaded product preserved, no redesign.`,
      video_prompt: `Show a subtle before-and-after feeling, camera pans from the problem to the product. Product remains stable and realistic.`,
    },
    {
      title: '商品特写',
      role: 'closeup',
      duration: each,
      voiceover: `核心亮点是${selling}。`,
      visual_prompt: `Premium close-up ecommerce product hero shot of ${name}, exact uploaded product, clear details, realistic shadows, clean background, TikTok ad style.`,
      video_prompt: `Macro product close-up with gentle rotation and light movement. Preserve exact product identity and visible details.`,
    },
    {
      title: '真人介绍',
      role: 'presenter',
      duration: each,
      voiceover: `现在就把它加入你的必备清单。`,
      visual_prompt: `A realistic product presenter holding ${name} facing the camera, product front side clearly visible, natural hands, livestream room, exact uploaded product unchanged.`,
      video_prompt: `Presenter looks at camera and introduces the product, natural hand gesture, product held upright and clear, smooth ending shot.`,
    },
  ];
}

function _sceneNeedsPresenter(scene = {}) {
  const role = String(scene.role || '').toLowerCase();
  return ['scene', 'pain', 'presenter', 'demo', 'lifestyle'].includes(role);
}

function _productAdIdentityLockPrompt({ product, scene }) {
  const name = product?.name || product?.image_name || 'the uploaded product';
  return [
    'Topview Image2-style controlled storyboard keyframe.',
    `Use the uploaded product reference as ${name}; preserve its category, silhouette, proportions, colors, logo area and visible details exactly.`,
    _sceneNeedsPresenter(scene)
      ? 'If a human presenter appears, use the uploaded presenter/avatar reference as the same person across all keyframes: same face identity, hairstyle, age, body type and outfit style.'
      : 'This shot may focus on product details; do not introduce a different presenter unless the storyboard explicitly needs one.',
    'Stable commercial composition, realistic lighting, no product morphing, no identity drift, no extra text, no watermark.',
  ].join(' ');
}

async function _buildProductAdStoryboard({ product, topic, durationSec }) {
  const { callLLM } = require('../services/storyService');
  const name = product?.name || product?.image_name || '商品';
  const target = Math.max(12, Math.min(40, Number(durationSec) || 18));
  const kbQuery = _dhKbQuery(name, product?.selling_points, product?.audience, product?.offer, topic, 'product ad digital human presenter gesture hand close-up multi-shot ecommerce');
  const sys = '你是跨境电商短视频广告导演。你会把单张商品图设计成 Topview/Image2+Seedance 风格的多关键帧产品广告。只输出 JSON。';
  const user = `商品名称：${name}
商品卖点：${product?.selling_points || '未填写'}
目标人群：${product?.audience || '未指定'}
优惠/行动号召：${product?.offer || '未指定'}
广告重点：${topic || '生成一条产品介绍短视频'}
目标总时长：${target} 秒

请输出 4 个镜头的 JSON 数组。每项字段：
{
  "title": "短标题",
  "role": "scene|pain|closeup|presenter",
  "duration": 3到6之间的整数,
  "voiceover": "中文口播短句",
  "visual_prompt": "英文关键帧生成提示词，必须强调 exact uploaded product unchanged",
  "video_prompt": "英文图生视频提示词，描述镜头运动和动作"
}

镜头必须覆盖：使用场景、痛点对比、商品特写、真人手持介绍。商品外观绝对不能变品类。`;
  try {
    const out = await callLLM(sys, user, {
      kb: { scene: 'product_ad', query: kbQuery, limit: 5, maxCharsPerDoc: 650 },
    });
    const scenes = _cleanJsonArray(out)
      .filter(x => x && x.visual_prompt && x.video_prompt)
      .slice(0, 5)
      .map((x, i) => ({
        title: String(x.title || `镜头 ${i + 1}`).slice(0, 20),
        role: ['scene', 'pain', 'closeup', 'presenter'].includes(x.role) ? x.role : (i === 3 ? 'presenter' : i === 2 ? 'closeup' : i === 1 ? 'pain' : 'scene'),
        duration: Math.max(3, Math.min(6, Math.round(Number(x.duration) || target / 4))),
        voiceover: String(x.voiceover || '').trim(),
        visual_prompt: String(x.visual_prompt || '').trim(),
        video_prompt: String(x.video_prompt || '').trim(),
      }));
    if (scenes.length >= 3) return scenes;
  } catch (err) {
    console.warn('[DH/product-ad] storyboard fallback:', err.message);
  }
  return _fallbackProductAdScenes(product, topic, target);
}

async function _concatVideosSmooth(videoPaths, outputPath, ratio = '9:16', outputSize = 'standard') {
  if (!Array.isArray(videoPaths) || !videoPaths.length) throw new Error('没有可拼接的视频片段');
  if (videoPaths.length === 1) {
    fs.copyFileSync(videoPaths[0], outputPath);
    return;
  }
  const ffmpeg = _ffmpegBin();
  const durations = videoPaths.map(p => _probeMediaDuration(ffmpeg, p, 5));
  const xfadeDur = 0.35;
  const [w, h] = _outputPixels(ratio, outputSize);
  const size = { w, h };
  const args = ['-y'];
  videoPaths.forEach(p => args.push('-i', p));
  let filter = '';
  for (let i = 0; i < videoPaths.length; i++) {
    filter += `[${i}:v]scale=${size.w}:${size.h}:force_original_aspect_ratio=increase,crop=${size.w}:${size.h},setsar=1,fps=30,format=yuv420p[v${i}];`;
  }
  let vLabel = '[v0]';
  let offset = Math.max(0.1, durations[0] - xfadeDur);
  for (let i = 1; i < videoPaths.length; i++) {
    const outV = i === videoPaths.length - 1 ? '[outv]' : `[xv${i}]`;
    filter += `${vLabel}[v${i}]xfade=transition=fade:duration=${xfadeDur}:offset=${offset.toFixed(2)}${outV};`;
    vLabel = outV;
    offset += Math.max(0.1, durations[i] - xfadeDur);
  }
  args.push('-filter_complex', filter.replace(/;$/, ''));
  args.push('-map', '[outv]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-movflags', '+faststart', outputPath);
  try {
    execFileSync(ffmpeg, args, { stdio: 'pipe', timeout: 240000 });
  } catch (err) {
    console.warn('[DH/ad] smooth concat failed, fallback to copy concat:', err.message);
    await _concatVideos(videoPaths, outputPath);
  }
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
    throw new Error('视频平滑拼接失败');
  }
}

async function _trimVideoClipToStoryboardDuration(inputPath, outputPath, durationSec, ratio = '9:16', outputSize = 'standard') {
  const target = Math.max(1, Math.min(12, Number(durationSec) || 5));
  const [w, h] = _outputPixels(ratio, outputSize);
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p`;
  execFileSync(_ffmpegBin(), [
    '-y',
    '-i', inputPath,
    '-t', target.toFixed(2),
    '-vf', vf,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '22',
    '-movflags', '+faststart',
    outputPath,
  ], { stdio: 'pipe', timeout: 180000 });
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
    throw new Error('分镜视频裁切失败');
  }
}

function _probeMediaDuration(ffmpegPath, filePath, fallback = 5) {
  try {
    const out = execFileSync(ffmpegPath, ['-i', filePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    const m = String(out).match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
  } catch (err) {
    const s = String(err.stderr || err.stdout || '');
    const m = s.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
  }
  return fallback;
}

async function _concatVideos(videoPaths, outputPath) {
  const listPath = path.join(path.dirname(outputPath), 'concat.txt');
  fs.writeFileSync(listPath, videoPaths.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  execFileSync(_ffmpegBin(), ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath], { stdio: 'pipe', timeout: 180000 });
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
    throw new Error('产品广告片拼接失败');
  }
}

async function _muxAudio(videoPath, audioPath, outputPath) {
  execFileSync(_ffmpegBin(), [
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-shortest',
    outputPath,
  ], { stdio: 'pipe', timeout: 180000 });
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
    throw new Error('产品广告片音频合成失败');
  }
}

function _luxuryBgmAssetFromPayload(payload = {}) {
  const bgm = payload.bgm_asset || payload.background_music || payload.bgm || {};
  if (bgm && typeof bgm === 'object') return bgm;
  const raw = payload.bgm_url || payload.background_music_url || payload.music_url || payload.music_path || '';
  return raw ? { url: raw, file_url: raw, file_path: raw } : {};
}

function _luxuryBgmRef(bgm = {}) {
  return String(bgm.file_path || bgm.path || bgm.file_url || bgm.url || bgm.background_music_url || '').trim();
}

function _resolveLuxuryBgmPath(bgm = {}) {
  const raw = _luxuryBgmRef(bgm);
  if (!raw) return '';
  const clean = decodeURIComponent(raw.split('?')[0].replace(/^https?:\/\/[^/]+/i, ''));
  const filename = path.basename(clean);
  const candidates = [
    raw,
    clean,
    path.join(OUTPUT_ROOT_DIR, 'music', filename),
    path.join(OUTPUT_ROOT_DIR, 'assets', 'music', filename),
  ];
  for (const p of candidates) {
    if (!p) continue;
    const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p.replace(/^\/+/, ''));
    const resolved = path.resolve(abs);
    if (!resolved.startsWith(path.resolve(OUTPUT_ROOT_DIR))) continue;
    if (fs.existsSync(resolved)) return resolved;
  }
  return '';
}

async function _applyLuxuryBgmIfConfigured(taskId, videoPath, bgm = {}) {
  const bgmRef = _luxuryBgmRef(bgm);
  if (!bgmRef) return videoPath;
  const bgmPath = _resolveLuxuryBgmPath(bgm);
  if (!bgmPath) throw new Error('高定广告片背景音乐文件不存在，请重新上传后期配乐');
  _taskPatch(taskId, { stage: 'post_bgm', progress: 92, message: '叠加高定广告片后期配乐' });
  const { applyEffects } = require('../services/effectsService');
  const fx = await applyEffects({
    videoPath,
    bgm: {
      path: bgmPath,
      volume: Number(bgm.volume) > 0 ? Number(bgm.volume) : 0.18,
      fadeIn: 1,
      fadeOut: 2,
    },
  });
  if (fx?.outputPath && fs.existsSync(fx.outputPath)) return fx.outputPath;
  throw new Error('高定广告片背景音乐叠加失败');
}

async function _muxAudioWithLoopedVideo(videoPath, audioPath, outputPath, ratio = '16:9', outputSize = 'standard') {
  const [w, h] = _outputPixels(ratio, outputSize);
  execFileSync(_ffmpegBin(), [
    '-y',
    '-stream_loop', '-1',
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '22',
    '-c:a', 'aac',
    '-shortest',
    '-movflags', '+faststart',
    outputPath,
  ], { stdio: 'pipe', timeout: 240000 });
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
    throw new Error('广告数字人音频合成失败');
  }
}

function _compressAdVideoIfUseful(inputPath, outputPath) {
  if (!inputPath || !fs.existsSync(inputPath)) return { path: inputPath, compressed: false };
  const originalSize = fs.statSync(inputPath).size;
  if (originalSize < 2 * 1024 * 1024) return { path: inputPath, compressed: false, originalSize, finalSize: originalSize };
  try {
    execFileSync(_ffmpegBin(), [
      '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '25',
      '-maxrate', '1800k',
      '-bufsize', '3600k',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ], { stdio: 'pipe', timeout: 300000 });
    const finalSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
    if (finalSize > 1000 && finalSize < originalSize * 0.95) {
      return { path: outputPath, compressed: true, originalSize, finalSize };
    }
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
  } catch (err) {
    console.warn('[DH/ad] video compression skipped:', err.message);
  }
  return { path: inputPath, compressed: false, originalSize, finalSize: originalSize };
}

function _publishAdVideoAsset(req, taskId, sourcePath, prefix = 'ad_avatar') {
  const safePrefix = String(prefix || 'ad_avatar').replace(/[^a-z0-9_-]/gi, '_');
  const compressedPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}_web.mp4`);
  const optimized = _compressAdVideoIfUseful(sourcePath, compressedPath);
  const publicName = `${safePrefix}_${taskId}.mp4`;
  const publicPath = path.join(JIMENG_ASSETS_DIR, publicName);
  if (path.resolve(optimized.path) !== path.resolve(publicPath)) {
    fs.copyFileSync(optimized.path, publicPath);
  }
  return {
    localPath: optimized.path,
    publicName,
    publicUrl: `${_publicBaseUrl(req)}/public/jimeng-assets/${publicName}`,
    compressed: optimized.compressed,
    originalSize: optimized.originalSize || 0,
    finalSize: optimized.finalSize || optimized.originalSize || 0,
  };
}

function _publishAdClipAssets(req, taskId, clipPaths = [], prefix = 'ad_clip') {
  const safePrefix = String(prefix || 'ad_clip').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'ad_clip';
  const base = _publicBaseUrl(req);
  return (Array.isArray(clipPaths) ? clipPaths : [])
    .map((sourcePath, i) => {
      if (!sourcePath || !fs.existsSync(sourcePath)) return null;
      const ext = path.extname(sourcePath) || '.mp4';
      const publicName = `${safePrefix}_${taskId}_${String(i + 1).padStart(2, '0')}${ext}`;
      const publicPath = path.join(JIMENG_ASSETS_DIR, publicName);
      if (path.resolve(sourcePath) !== path.resolve(publicPath)) {
        fs.copyFileSync(sourcePath, publicPath);
      }
      return {
        index: i,
        shot: i + 1,
        local_path: sourcePath,
        public_path: publicPath,
        url: `/public/jimeng-assets/${publicName}`,
        video_url: `${base}/public/jimeng-assets/${publicName}`,
      };
    })
    .filter(Boolean);
}

async function _runProductAdTask(req, taskId, { avatar, product, topic, title = '', durationSec, voiceId, voiceProvider, subtitle, segments = [], aspectRatio = '9:16', outputSize = 'standard' }) {
  const taskDir = path.join(JIMENG_ASSETS_DIR, `product_ad_${taskId}`);
  fs.mkdirSync(taskDir, { recursive: true });
  const base = _publicBaseUrl(req);
  const videoModel = _pickPipelineModel('product_avatar.marketing_video') || { provider_id: 'topview', model_id: 'topview-product-avatar-i2v' };
  const ttsModel = _pickPipelineModel('product_avatar.tts') || { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3-flash' };
  const productVideoTitle = String(title || `${product?.name || product?.image_name || '商品'} 商品口播视频`).trim().slice(0, 100);
  const manualVoiceSegments = Array.isArray(segments) && segments.length
    ? segments.map((s, i) => ({
      text: s.text || s.speech_text || '',
      start: Number(s.start) || 0,
      end: Number(s.end) || (Number(s.start) || 0) + (Number(s.duration) || 3),
      tone: s.tone || s.delivery || s.voice_tone || '',
      expression: s.expression || '',
      camera: s.camera || '',
      motion: s.motion || '',
      index: i,
    })).filter(s => s.text)
    : null;
  try {
    if (videoModel.provider_id === 'topview') try {
      const topview = require('../services/topviewService');
      const topviewImageId =
        avatar?.topview_product_image_id ||
        avatar?.product?.topview_image_id ||
        avatar?.product?.topviewImageId ||
        avatar?.product?.topview?.imageId ||
        '';
      if (!topviewImageId) {
        throw new Error('缺少 Topview 商品形象 imageId，请重新生成商品数字人形象后再生成视频');
      }
      _taskPatch(taskId, { status: 'running', stage: 'topview_product_avatar_video', progress: 10, message: 'Topview 商品口播视频生成中' });
      const script = topic || `${product?.name || product?.image_name || '这款商品'} 的商品口播介绍`;
      const startedAt = Date.now();
      const voiceScenes = await _buildProductAdStoryboard({ product, topic, durationSec });
      const voiceSegments = manualVoiceSegments || _voiceSegmentsFromKeyframes(voiceScenes, topic || product?.name || '');
      const expressiveScript = voiceSegments.map(s => s.text).filter(Boolean).join('，') || script;
      const effectiveVoiceProvider = voiceProvider || ttsModel.provider_id || '';
      const useTopviewTts = String(effectiveVoiceProvider || '').toLowerCase() === 'topview';
      let audioPath = '';
      if (!useTopviewTts) {
        _taskPatch(taskId, { stage: 'aliyun_tts', progress: 18, message: '阿里 TTS 生成配音中' });
        const { generateSpeech } = require('../services/ttsService');
        const voiceBase = path.join(taskDir, 'product_voice');
        audioPath = await _synthesizeSegmentedSpeechFile(req, {
          text: expressiveScript,
          voiceId: voiceId || null,
          segments: voiceSegments,
          outputBase: voiceBase,
        });
        if (!audioPath) audioPath = await generateSpeech(expressiveScript, voiceBase, { voiceId: voiceId || null, speed: 1.0 });
        if (!audioPath || !fs.existsSync(audioPath)) throw new Error('阿里 TTS 配音生成失败');
        _taskPatch(taskId, { stage: 'topview_audio_upload', progress: 28, message: '上传阿里配音到 Topview' });
      }
      const tv = await topview.generateProductAvatarVideo({
        imageId: topviewImageId,
        imageUrl: avatar?.image_url ? _absolutePublicUrl(req, avatar.image_url) : '',
        title: productVideoTitle,
        text: expressiveScript,
        voiceId: useTopviewTts ? (voiceId || '') : '',
        audioPath,
        duration: Math.max(10, Math.min(60, Number(durationSec) || 18)),
        onProgress: info => _taskPatch(taskId, {
          stage: info.stage || 'topview_product_avatar_video',
          progress: Math.max(10, Math.min(95, Number(info.progress) || 10)),
          message: `Topview ${info.status || info.stage || 'processing'}`,
        }),
      });
      if (tv?.videoUrl) {
        const dl = await axios.get(tv.videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
        let finalPath = path.join(taskDir, 'topview_product_ad.mp4');
        fs.writeFileSync(finalPath, Buffer.from(dl.data));
        if (subtitle?.show !== false && expressiveScript) {
          try {
            _taskPatch(taskId, { stage: 'burn_subtitles', progress: 96, message: '烧录商品口播字幕' });
            const { applyEffects } = require('../services/effectsService');
            const subtitleStyle = subtitle?.style || 'popup';
            const textEffects = _normalizeSubtitleSegments(voiceSegments, expressiveScript).map(s => ({
              text: s.text,
              preset: 'subtitle',
              style: 'subtitle',
              subtitleStyle,
              smartEmphasis: subtitle?.smartEmphasis !== false,
              position: subtitleStyle === 'comic' ? 'top-center' : 'bottom-center',
              startTime: s.start ?? 0,
              endTime: s.end,
              fontName: subtitle?.fontName || '抖音美好体',
              fontSize: subtitle?.fontSize || 64,
              fontcolor: subtitle?.color || '#FFFFFF',
              bordercolor: subtitle?.outlineColor || '#000000',
            }));
            const fx = await applyEffects({
              videoPath: finalPath,
              texts: textEffects,
              subtitleStyle,
              asrAlign: true,
            });
            if (fx?.outputPath && fs.existsSync(fx.outputPath)) finalPath = fx.outputPath;
          } catch (fxErr) {
            console.warn('[DH/product-ad] topview subtitle failed:', fxErr.message);
            _taskPatch(taskId, { subtitle_warning: fxErr.message });
          }
        }
        const publicName = `topview_product_ad_${taskId}.mp4`;
        fs.copyFileSync(finalPath, path.join(JIMENG_ASSETS_DIR, publicName));
        const taskData = {
          id: taskId,
          status: 'done',
          stage: 'done',
          title: productVideoTitle,
          text: topic || '',
          videoPath: finalPath,
          videoUrl: `/api/avatar/tasks/${taskId}/stream`,
          video_url: `${base}/public/jimeng-assets/${publicName}`,
          image_url: avatar?.image_url || product?.image_url || '',
          thumbnail_url: avatar?.image_url || product?.image_url || '',
          kind: 'production',
          mode: 'product_ad',
          generation_mode: 'topview',
          pipeline_video_provider: videoModel.provider_id,
          pipeline_video_model: videoModel.model_id,
          pipeline_tts_provider: ttsModel.provider_id,
          pipeline_tts_model: ttsModel.model_id,
          user_id: productAdTasks.get(taskId)?.user_id,
          ratio: '9:16',
          model: tv.model_id || 'topview-product-avatar-i2v',
          provider_id: 'topview',
          topview_task_id: tv.taskId,
          subtitle_burned: subtitle?.show !== false,
          created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
        };
        productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
        if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
        else db.updateAvatarTask(taskId, taskData);
        try {
          require('../services/tokenTracker').record({
            provider: videoModel.provider_id,
            model: videoModel.model_id || tv.model_id || 'topview-product-avatar-i2v',
            category: 'video',
            agentId: 'product_avatar.marketing_video',
            videoSeconds: Math.max(10, Math.min(60, Number(durationSec) || 18)),
            durationMs: Date.now() - startedAt,
            status: 'success',
          });
        } catch {}
        return;
      }
    } catch (topviewErr) {
      console.error('[DH/product-ad] Topview failed:', topviewErr);
      const friendlyError = _formatTopviewProductVideoError(topviewErr);
      _taskPatch(taskId, {
        status: 'error',
        stage: 'topview_product_avatar_video_error',
        error: friendlyError,
        message: friendlyError,
      });
      try {
        require('../services/tokenTracker').record({
          provider: videoModel.provider_id,
          model: videoModel.model_id || 'topview-product-avatar-i2v',
          category: 'video',
          agentId: 'product_avatar.marketing_video',
          videoSeconds: Math.max(10, Math.min(60, Number(durationSec) || 18)),
          status: 'fail',
          errorMsg: friendlyError,
        });
      } catch {}
      try {
        if (!db.getAvatarTask(taskId)) {
          const t = productAdTasks.get(taskId);
          db.insertAvatarTask({ ...t, status: 'error', error: friendlyError, kind: 'production', mode: 'product_ad', generation_mode: 'topview' });
        }
      } catch {}
      return;
    }
    if (!['volcengine', 'api-key-20260404180437', 'jimeng'].includes(videoModel.provider_id)) {
      throw new Error(`商品介绍片生成当前配置为 ${videoModel.provider_id}/${videoModel.model_id}，暂不支持该供应商执行商品数字人成片`);
    }

    _taskPatch(taskId, { status: 'running', stage: 'storyboard', progress: 8, message: '生成产品广告分镜' });
    const scenes = manualVoiceSegments
      ? _productScenesFromSegments(product, manualVoiceSegments, durationSec)
      : await _buildProductAdStoryboard({ product, topic, durationSec });
    _taskPatch(taskId, { scenes, progress: 15 });

    const productUrl = _absolutePublicUrl(req, _productSourceUrl(product));
    const avatarUrl = avatar?.image_url ? _absolutePublicUrl(req, avatar.image_url) : '';
    const keyframes = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      _taskPatch(taskId, { stage: 'keyframes', progress: 15 + Math.round((i / scenes.length) * 28), message: `生成关键帧 ${i + 1}/${scenes.length}` });
      const refs = [productUrl];
      if (_sceneNeedsPresenter(scene) && avatarUrl) refs.unshift(avatarUrl);
      const prompt = [
        scene.visual_prompt,
        _productAdIdentityLockPrompt({ product, scene }),
        `Product reference: ${product?.name || product?.image_name || 'the uploaded product'}.`,
        'The exact uploaded product must remain the same category, shape, color, logo area, proportions and visual identity.',
        _sceneNeedsPresenter(scene)
          ? 'Keep the same presenter identity as the reference avatar. Do not change face, hairstyle or outfit between shots.'
          : '',
        'No product replacement, no generic object, no floating sticker, no extra text, no watermark, realistic ecommerce advertising frame.',
      ].join(' ');
      const filePath = await _generateViaDeyunaiNanoBanana({
        prompt,
        aspectRatio,
        outputSize,
        filename: `product_ad_${taskId}_kf_${String(i + 1).padStart(2, '0')}`,
        destDir: JIMENG_ASSETS_DIR,
        referenceImages: refs.filter(Boolean),
      });
      const url = `${base}/public/jimeng-assets/${path.basename(filePath)}`;
      keyframes.push({ ...scene, image_url: url, local_path: filePath });
      _taskPatch(taskId, { keyframes });
    }

    const { _seedanceAVGenerate } = require('../services/avatarService');
    const { apiKey, model } = _getSeedanceAdConfig(videoModel);
    const clips = [];
    const videoKbContext = _buildDhKbContext(
      'product_ad',
      _dhKbQuery(productVideoTitle, topic, product, scenes, keyframes),
      { limit: 4, maxCharsPerDoc: 520 }
    );
    for (let i = 0; i < keyframes.length; i++) {
      const kf = keyframes[i];
      _taskPatch(taskId, { stage: 'video', progress: 45 + Math.round((i / keyframes.length) * 35), message: `生成视频镜头 ${i + 1}/${keyframes.length}` });
      const prompt = [
        kf.video_prompt,
        videoKbContext ? `Knowledge-base direction:\n${videoKbContext}` : '',
        `Shot title: ${kf.title}.`,
        `Voiceover meaning: ${kf.voiceover || ''}`,
        _segmentControlPrompt(kf),
        'Keep the product visually identical to the keyframe. Smooth commercial video, stable product geometry, no morphing, no text overlay, no watermark.',
      ].join(' ');
      const { videoBuffer } = await _seedanceAVGenerate(
        kf.image_url,
        prompt,
        model,
        apiKey,
        info => _taskPatch(taskId, { message: info.message || `Seedance 镜头 ${i + 1}` }),
        { ratio: aspectRatio, duration: kf.duration || 4, hasAudio: false }
      );
      const clipPath = path.join(taskDir, `clip_${String(i + 1).padStart(2, '0')}.mp4`);
      fs.writeFileSync(clipPath, videoBuffer);
      clips.push(clipPath);
    }

    _taskPatch(taskId, { stage: 'post_effects', progress: 84, message: '拼接视频' });
    const concatPath = path.join(taskDir, 'product_ad_concat.mp4');
    await _concatVideosSmooth(clips, concatPath, aspectRatio, outputSize);

    const voiceSegments = manualVoiceSegments || _voiceSegmentsFromKeyframes(keyframes, topic || product?.name || '');
    const voiceover = voiceSegments.map(s => s.text).filter(Boolean).join('，');
    let finalPath = concatPath;
    if (voiceover) {
      try {
        _taskPatch(taskId, { message: '合成口播音频' });
        const { generateSpeech } = require('../services/ttsService');
        const audioBase = path.join(taskDir, 'voiceover');
        let audioPath = await _synthesizeSegmentedSpeechFile(req, {
          text: voiceover,
          voiceId: voiceId || null,
          segments: voiceSegments,
          outputBase: audioBase,
        });
        if (!audioPath) audioPath = await generateSpeech(voiceover, audioBase, { voiceId: voiceId || null, speed: 1.0 });
        const muxPath = path.join(taskDir, 'product_ad_audio.mp4');
        await _muxAudio(concatPath, audioPath, muxPath);
        finalPath = muxPath;
      } catch (audioErr) {
        console.warn('[DH/product-ad] voiceover failed:', audioErr.message);
      }
    }

    const showSubtitles = subtitle?.show !== false;
    if (showSubtitles && voiceover) {
      try {
        _taskPatch(taskId, { message: '烧录字幕' });
        const { applyEffects } = require('../services/effectsService');
        let cursor = 0;
        const texts = keyframes.filter(k => k.voiceover).map(k => {
          const startTime = cursor;
          cursor += Number(k.duration) || 4;
          return {
            text: k.voiceover,
            preset: 'subtitle',
            position: 'bottom',
            startTime,
            endTime: cursor,
            fontName: subtitle?.fontName || '抖音美好体',
            fontSize: subtitle?.fontSize || 64,
            color: subtitle?.color || '#FFFFFF',
            outlineColor: subtitle?.outlineColor || '#000000',
          };
        });
        const fx = await applyEffects({ videoPath: finalPath, texts });
        if (fx?.outputPath && fs.existsSync(fx.outputPath)) finalPath = fx.outputPath;
      } catch (fxErr) {
        console.warn('[DH/product-ad] subtitle failed:', fxErr.message);
      }
    }

    const taskData = {
      id: taskId,
      status: 'done',
      stage: 'done',
      title: productVideoTitle,
      text: voiceover || topic || '',
      scenes,
      keyframes: keyframes.map(k => ({
        title: k.title,
        role: k.role,
        image_url: k.image_url,
        voiceover: k.voiceover,
        reference_mode: k.reference_mode || '',
        source_avatar_url: k.source_avatar_url || avatar?.image_url || '',
        source_background_url: k.source_background_url || product?.image_url || '',
      })),
      videoPath: finalPath,
      videoUrl: `/api/avatar/tasks/${taskId}/stream`,
      image_url: keyframes[0]?.image_url || avatar?.image_url || product?.image_url || '',
      thumbnail_url: keyframes[0]?.image_url || '',
      kind: 'production',
      mode: 'product_ad',
      user_id: productAdTasks.get(taskId)?.user_id,
      ratio: aspectRatio,
      output_size: outputSize,
      resolution: _outputSizeString(aspectRatio, outputSize),
      model,
      created_at: task.created_at,
    };
    productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
    if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
    else db.updateAvatarTask(taskId, taskData);
  } catch (err) {
    console.error('[DH/product-ad] failed:', err);
    _taskPatch(taskId, { status: 'error', stage: 'error', error: err.message, message: err.message });
    try {
      if (!db.getAvatarTask(taskId)) {
        const t = productAdTasks.get(taskId);
        db.insertAvatarTask({ ...t, status: 'error', error: err.message, kind: 'production', mode: 'product_ad' });
      }
    } catch {}
  }
}

function _formatTopviewProductVideoError(err) {
  const raw = String(err?.message || err || '');
  if (/task timeout|timeout/i.test(raw)) {
    return 'Topview 商品口播视频生成超时：第三方生成队列未在限定时间内返回结果，当前任务不会继续产出。请点击重新提交再跑一次；如连续超时，建议缩短文案或切换 Topview 配音音色后重试。';
  }
  return `Topview 商品口播视频生成失败：${raw}`;
}

function _pipelineModelLabel(model) {
  return [model?.provider_id, model?.model_id].filter(Boolean).join('/') || '未配置';
}

function _isSeedancePipelineModel(model) {
  const provider = String(model?.provider_id || '').toLowerCase();
  const modelId = String(model?.model_id || '').toLowerCase();
  return ['volcengine', 'api-key-20260404180437', 'jimeng'].includes(provider)
    || /seedance|doubao-seedance/i.test(modelId);
}

function _isTopviewPipelineModel(model) {
  const provider = String(model?.provider_id || '').toLowerCase();
  const modelId = String(model?.model_id || '').toLowerCase();
  return provider === 'topview' || modelId.startsWith('topview-');
}

function _isTopviewImageToVideoPipelineModel(model) {
  const provider = String(model?.provider_id || '').toLowerCase();
  const modelId = String(model?.model_id || '').toLowerCase();
  return (provider === 'topview' || modelId.startsWith('topview-'))
    && /(image2video|i2v)/i.test(modelId);
}

function _isDeyunaiVideoPipelineModel(model) {
  const provider = String(model?.provider_id || '').toLowerCase();
  const modelId = String(model?.model_id || '').toLowerCase();
  return provider === 'deyunai'
    && /^(kling-|hailuo-|minimax-video-|sora-|veo-|jimeng-(t2v|i2v))/.test(modelId);
}

function _isLipSyncPipelineModel(model) {
  const provider = String(model?.provider_id || '').toLowerCase();
  const modelId = String(model?.model_id || '').toLowerCase();
  return ['topview', 'hifly', 'jimeng'].includes(provider)
    || modelId.startsWith('topview-avatar')
    || modelId.includes('hifly')
    || modelId.includes('omni');
}

function _adPresenterActionPrompt({ scenePrompt = '', text = '' } = {}) {
  return [
    'Photorealistic advertising digital human video, showroom walkthrough guide style. Use the uploaded background as the real location and preserve its wall texture, lighting direction, material scale, perspective, floor line, shadows, reflections, and display area.',
    'The presenter is a real showroom docent, not a static talking-head avatar. Keep the presenter in the left third when possible and keep the right two thirds open for the product wall, material wall, display area, or brand background.',
    'MANDATORY ACTION TIMELINE: 0-18% start as a slow walkthrough reveal. The presenter enters or advances from the left foreground with one or two visible small steps, body angled toward the display wall, shoulders relaxed. The camera slowly glides forward at half walking speed.',
    '18-32% the presenter arrives at the left-third mark, plants the front foot naturally, turns the torso toward the display, then the presentation hand pops/lifts up from waist level into frame with an open palm.',
    '32-62% active explanation: the hand sweeps or points from the presenter toward the exact wall/product/detail area being discussed. Eyes first follow the hand to the target, then return to the camera at the end of each phrase. This must read as introducing a real object, not staring diagonally into space.',
    '62-82% the camera slowly reveals more of the background and detail area with a gentle forward move plus slight lateral parallax. The presenter takes a small half-step forward or weight transfer and continues an open-palm guide gesture.',
    '82-100% finish by returning eye contact to the camera, lower the hand naturally, then give one final confident recommendation gesture. Do not freeze after speaking.',
    'Visible motion required: slow walking/settling steps, natural weight shift, breathing, blinking, torso rotation toward the display, hand rising into frame, open-palm sweep, clear directional pointing, hand returning to relaxed position.',
    'Gaze rules: never keep the eyes locked at a random diagonal. Look at the display only while the hand is pointing at it; otherwise reconnect with the camera lens. Eye direction, head angle, and hand direction must agree.',
    'Camera motion required: single continuous commercial walkthrough shot with slow dolly forward, slight lateral parallax, or slow pull-back/reveal. The camera should feel like it is entering the showroom and discovering the display, with subtle rack focus between presenter and background details.',
    'Background extension required: the uploaded room must feel spatial and continuous, not a flat poster. Preserve panels, material pattern, light fixtures, floor perspective, shadows, reflections, and color temperature.',
    'NEGATIVE: static mannequin, frozen presenter, only lip movement, talking-head crop, locked feet, rigid arms, hands outside frame, stiff fingers, deformed hands, extra fingers, leaving the presenter zone, aimless wandering, running, dancing, presenter blocking the wall, eyes staring away from the pointed target, face drift, outfit change, background replacement, scene jump, duplicated person, extra people, pasted cutout, poster-like flat background, generated captions, watermark.',
    scenePrompt ? `The actions should reference this scene: ${String(scenePrompt).slice(0, 300)}.` : '',
    text ? `Match gestures to this narration meaning: ${String(text).slice(0, 360)}.` : '',
  ].filter(Boolean).join(' ');
}

function _staticShowroomGuidePosePrompt({ text = '', placement = null } = {}) {
  return [
    'Static keyframe only. Create one clean still frame that can pass compositor QA; do not describe video timing, camera movement, walking sequence, parallax, rack focus, or scene extension.',
    'The guide is already settled in a natural showroom-docent pose: body slightly angled toward the display, one open palm or soft pointing hand already visible, face clear, eyes either on the display target or returning to camera.',
    'Keep the pose calm and physically plausible. No motion blur, no ghost limbs, no walking trail, no duplicated hands, no dramatic step, no action timeline.',
    'Preserve the uploaded showroom structure and crop. The wall/display area remains readable and the guide must look like part of the same photographed space.',
    placement ? `Placement guidance: ${JSON.stringify(placement).slice(0, 500)}.` : '',
    text ? `Narration meaning for choosing the still gesture: ${String(text).slice(0, 180)}.` : '',
  ].filter(Boolean).join(' ');
}

function _staticIsolatedGuideAssetPrompt({ text = '', placement = null } = {}) {
  return [
    'Static isolated guide asset only. Generate one clean presenter on a pure white studio background for later compositing.',
    'Do not generate a showroom, wall, furniture, product display, camera move, walking sequence, video timeline, background extension, captions, or any room scenery.',
    'The guide is in a simple settled docent pose: front or three-quarter front, face visible, torso and hands clear, one open palm or soft pointing hand aimed toward viewer right.',
    'Clean silhouette for matting, natural hands, no motion blur, no ghost limb, no second person, no cropped face.',
    placement ? `Target composite placement context: ${JSON.stringify(placement).slice(0, 500)}.` : '',
    text ? `Narration meaning for choosing the still gesture: ${String(text).slice(0, 180)}.` : '',
  ].filter(Boolean).join(' ');
}

function _qaSummary(qa) {
  if (!qa) return null;
  return {
    pass: !!qa.pass,
    score: Number(qa.score) || 0,
    has_person: qa.has_person ?? null,
    person_count: qa.person_count ?? null,
    gender_match: qa.gender_match ?? null,
    no_picture_in_picture: qa.no_picture_in_picture ?? null,
    background_preserved: qa.background_preserved ?? null,
    hard_failures: Array.isArray(qa.hard_failures) ? qa.hard_failures.slice(0, 6) : [],
    issues: Array.isArray(qa.issues) ? qa.issues.slice(0, 6) : [],
    naturalness: qa.naturalness || '',
  };
}

function _compactGuidePlacement(placement = {}) {
  if (!placement || typeof placement !== 'object') return {};
  return {
    side: placement.side,
    framing: placement.framing,
    left_pct: placement.left_pct,
    height_pct: placement.height_pct,
    max_width_pct: placement.max_width_pct,
    avoid: placement.avoid,
    lighting: placement.lighting,
  };
}

async function _runDeyunaiAdMarketingVideo(req, taskId, {
  text,
  voiceId,
  title,
  scenePrompt,
  durationSec,
  keyframes = [],
  scenes = [],
  aspectRatio,
  outputSize,
  adMode,
  adStyle,
  subtitle,
  bgmAsset = null,
  pipelineVideoModel,
}) {
  if (!pipelineVideoModel?.model_id) throw new Error('DeyunAI video model is missing');
  if (!Array.isArray(keyframes) || !keyframes.some(k => k?.image_url)) {
    throw new Error('DeyunAI video requires at least one confirmed keyframe');
  }
  const dyClient = require('../services/deyunaiService');
  const taskDir = path.join(JIMENG_ASSETS_DIR, `digital_ad_${taskId}`);
  fs.mkdirSync(taskDir, { recursive: true });
  const clips = [];
  const isLuxury = adMode === 'luxury_ad';
  const isShowroomGuide = adMode === 'showroom_guide';
  const videoKbContext = isLuxury ? '' : _buildDhKbContext(
    isShowroomGuide ? 'showroom_guide' : 'digital_ad',
    _dhKbQuery(title, text, scenePrompt, keyframes, scenes, adMode, adStyle),
    { limit: 4, maxCharsPerDoc: 520 }
  );
  const size = _outputSizeString(aspectRatio, outputSize);
  const modelId = pipelineVideoModel.model_id;

  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i];
    if (!kf?.image_url) continue;
    const shotDuration = Math.max(5, Math.min(10, Math.round(Number(kf.duration) || Number(durationSec) / Math.max(1, keyframes.length) || 5)));
    _taskPatch(taskId, {
      stage: 'deyunai_i2v',
      progress: 45 + Math.round((i / Math.max(1, keyframes.length)) * 35),
      message: `DeyunAI ${modelId} video shot ${i + 1}/${keyframes.length}`,
    });
    const prompt = isLuxury ? _buildLuxuryI2VPrompt(kf, {
      text,
      title,
      scenePrompt,
      adStyle,
      maxChars: 1400,
    }) : [
        'Create a premium commercial image-to-video shot from the uploaded keyframe.',
        'Preserve the exact presenter identity, product/display area, background, layout, lighting direction, material texture and color palette.',
        'Use controlled cinematic motion: slow push-in, gentle parallax, elegant hand gesture, natural blinking and subtle body movement.',
        kf.workflow_type === 'luxury_ad_storyboard' ? `Luxury workflow metadata: ${JSON.stringify(_compactLuxuryShotMeta(kf)).slice(0, 1000)}.` : '',
        isShowroomGuide ? _showroomGuideMotionBible({ text: kf.voiceover || text, scenePrompt }) : '',
        kf.video_prompt || kf.action_prompt || kf.motion_prompt || '',
        videoKbContext ? `Knowledge-base direction:\n${videoKbContext}` : '',
        scenePrompt ? `Scene context: ${scenePrompt}` : '',
        `Voiceover meaning: ${kf.voiceover || text || title || ''}`,
        'No generated subtitles, no watermark, no extra people, no scene replacement, no product redesign, no identity drift.',
      ].filter(Boolean).join('\n');
    const result = await dyClient.generateVideo({
      model: modelId,
      prompt,
      duration: shotDuration,
      size,
      imageUrl: _absolutePublicUrl(req, kf.image_url),
      timeoutMs: 12 * 60 * 1000,
      userId: productAdTasks.get(taskId)?.user_id || null,
      agentId: 'project_assistant',
    });
    if (!result?.url) throw new Error(`DeyunAI ${modelId} returned no video url`);
    const dl = await axios.get(result.url, { responseType: 'arraybuffer', timeout: 180000 });
    const clipPath = path.join(taskDir, `deyunai_${String(i + 1).padStart(2, '0')}.mp4`);
    fs.writeFileSync(clipPath, Buffer.from(dl.data));
    clips.push(clipPath);
  }

  if (!clips.length) throw new Error('DeyunAI video produced no downloadable clips');
  _taskPatch(taskId, { stage: 'post_effects', progress: 84, message: 'Stitching DeyunAI commercial shots' });
  const concatPath = path.join(taskDir, 'deyunai_ad_concat.mp4');
  await _concatVideosSmooth(clips, concatPath, aspectRatio, outputSize);

  const voiceSegments = _voiceSegmentsFromKeyframes(keyframes, text || title || '');
  const voiceover = voiceSegments.map(s => s.text).filter(Boolean).join(' ') || text;
  let finalPath = concatPath;
  if (voiceover) {
    try {
      _taskPatch(taskId, { message: 'Mixing ad voiceover audio' });
      const { generateSpeech } = require('../services/ttsService');
      const audioBase = path.join(taskDir, 'voiceover');
      let audioPath = await _synthesizeSegmentedSpeechFile(req, {
        text: voiceover,
        voiceId: voiceId || null,
        segments: voiceSegments,
        outputBase: audioBase,
      });
      if (!audioPath) audioPath = await generateSpeech(voiceover, audioBase, { voiceId: voiceId || null, speed: 1.0 });
      const muxPath = path.join(taskDir, 'deyunai_ad_audio.mp4');
      await _muxAudioWithLoopedVideo(concatPath, audioPath, muxPath, aspectRatio, outputSize);
      finalPath = muxPath;
    } catch (audioErr) {
      console.warn('[DH/space-ad/deyunai] voiceover failed:', audioErr.message);
    }
  }

  if (subtitle?.show !== false && voiceover) {
    try {
      _taskPatch(taskId, { message: 'Burning ad subtitles' });
      const { applyEffects } = require('../services/effectsService');
      let cursor = 0;
      const texts = keyframes.filter(k => k.voiceover).map(k => {
        const startTime = cursor;
        cursor += Number(k.duration) || 5;
        return {
          text: k.voiceover,
          preset: 'subtitle',
          position: 'bottom',
          startTime,
          endTime: cursor,
          fontName: subtitle?.fontName || 'Douyin Sans',
          fontSize: subtitle?.fontSize || 64,
          color: subtitle?.color || '#FFFFFF',
          outlineColor: subtitle?.outlineColor || '#000000',
        };
      });
      const fx = await applyEffects({ videoPath: finalPath, texts });
      if (fx?.outputPath && fs.existsSync(fx.outputPath)) finalPath = fx.outputPath;
    } catch (fxErr) {
      console.warn('[DH/space-ad/deyunai] subtitle failed:', fxErr.message);
    }
  }

  if (adMode === 'luxury_ad') {
    finalPath = await _applyLuxuryBgmIfConfigured(taskId, finalPath, bgmAsset);
  }

  const primaryKeyframe = keyframes.find(k => k?.image_url)?.image_url || '';
  const publishedVideo = _publishAdVideoAsset(req, taskId, finalPath, 'deyunai_ad_avatar');
  const clipAssets = _publishAdClipAssets(req, taskId, clips, isLuxury ? 'deyunai_luxury_clip' : 'deyunai_ad_clip');
  const taskData = {
    id: taskId,
    status: 'done',
    stage: 'done',
    title: title || (isLuxury ? 'Luxury ad film' : 'Ad digital human'),
    text: voiceover || text,
    scenes,
    keyframes: keyframes.map(_publicAdKeyframeMeta),
    clips: clipAssets,
    clip_urls: clipAssets.map(x => x.video_url || x.url).filter(Boolean),
    videoPath: publishedVideo.localPath,
    videoUrl: `/api/avatar/tasks/${taskId}/stream`,
    video_url: publishedVideo.publicUrl,
    image_url: primaryKeyframe,
    thumbnail_url: primaryKeyframe,
    keyframeUrl: primaryKeyframe,
    kind: 'production',
    mode: isLuxury ? 'luxury_ad' : 'digital_ad',
    generation_mode: isLuxury ? 'luxury_storyboard' : (isShowroomGuide ? 'showroom_guide' : 'storyboard'),
    ad_mode: adMode,
    ad_style: adStyle,
    shot_count: scenes.length || keyframes.length || 1,
    user_id: productAdTasks.get(taskId)?.user_id,
    ratio: aspectRatio,
    output_size: outputSize,
    resolution: size,
    model: modelId,
    provider_id: 'deyunai',
    pipeline_video_provider: pipelineVideoModel.provider_id,
    pipeline_video_model: modelId,
    compressed: publishedVideo.compressed,
    original_video_size: publishedVideo.originalSize,
    final_video_size: publishedVideo.finalSize,
    created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
  };
  productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
  if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
  else db.updateAvatarTask(taskId, taskData);
}

async function _runTopviewAdMarketingVideo(req, taskId, {
  avatar,
  backgroundUrl,
  text,
  voiceId,
  title,
  scenePrompt,
  durationSec,
  keyframes = [],
  scenes = [],
  aspectRatio,
  outputSize,
  adMode,
  adStyle,
  pipelineVideoModel,
}) {
  if (adMode === 'luxury_ad') {
    throw new Error('高定广告片不能走 Topview Marketing Video 成片接口，请使用逐分镜图生视频链路');
  }
  const topview = require('../services/topviewService');
  const base = _publicBaseUrl(req);
  const taskDir = path.join(JIMENG_ASSETS_DIR, `digital_ad_${taskId}`);
  fs.mkdirSync(taskDir, { recursive: true });
  const primaryKeyframe = keyframes.find(k => k?.image_url)?.image_url || '';
  const materialImageUrl = backgroundUrl || primaryKeyframe || '';
  const avatarImageUrl = primaryKeyframe || avatar?.image_url || '';
  const kbContext = _buildDhKbContext(
    adMode === 'showroom_guide' ? 'showroom_guide' : 'digital_ad',
    _dhKbQuery(title, text, scenePrompt, scenes, keyframes, adMode, adStyle),
    { limit: 4, maxCharsPerDoc: 520 }
  );
  const script = [
    'STRICT INPUT LOCK: use the uploaded/configured background as the scene material and the confirmed keyframe as presenter/action reference. Do not replace the background, gender, presenter identity, product, or composition.',
    kbContext ? `Knowledge-base direction:\n${kbContext}` : '',
    text,
    scenePrompt ? `Scene requirements: ${scenePrompt}` : '',
    _adPresenterActionPrompt({ scenePrompt, text }),
    _showroomGuideMotionBible({ text, scenePrompt }),
    'Motion requirement: presenter must visibly explain with open-palm gestures, point toward display/material details, slightly turn body toward the wall/product and return to camera. The camera should have slow showroom extension with real parallax and spatial reveal, not a static still image and not a simple post-production crop/zoom.',
    keyframes.map((kf, i) => {
      const line = kf?.voiceover || kf?.text || '';
      const action = kf?.action_prompt || kf?.motion_prompt || kf?.video_prompt || '';
      return line || action ? `Shot ${i + 1}: ${line}${action ? `\nAction: ${String(action).slice(0, 500)}` : ''}` : '';
    }).filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n');

  _taskPatch(taskId, {
    status: 'running',
    stage: 'topview_m2v',
    progress: 48,
    message: `按模型调用管理使用 ${_pipelineModelLabel(pipelineVideoModel)} 生成广告视频`,
  });
  const tv = await topview.generateMarketingVideo({
    avatarImageUrl: avatarImageUrl ? _absolutePublicUrl(req, avatarImageUrl) : '',
    materialImageUrl: materialImageUrl ? _absolutePublicUrl(req, materialImageUrl) : '',
    title: title || '广告数字人',
    text: script || text || title || '广告数字人口播视频',
    voiceId: voiceId || '',
    duration: Math.max(10, Math.min(60, Number(durationSec) || 18)),
    aspectRatio,
    actionPrompt: [
      _showroomGuideMotionBible({ text: script || text || title || '', scenePrompt }),
      _adPresenterActionPrompt({ scenePrompt, text: script || text || title || '' }),
      kbContext,
    ].filter(Boolean).join('\n\n'),
    onProgress: info => _taskPatch(taskId, {
      stage: info.stage || 'topview_m2v',
      progress: Math.max(50, Math.min(95, Number(info.progress) || 60)),
      message: `Topview ${info.status || info.stage || 'processing'}`,
    }),
  });
  if (!tv?.videoUrl) throw new Error('Topview 没有返回成片地址');

  const dl = await axios.get(tv.videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
  const finalPath = path.join(taskDir, 'topview_ad_avatar.mp4');
  fs.writeFileSync(finalPath, Buffer.from(dl.data));
  const publishedVideo = _publishAdVideoAsset(req, taskId, finalPath, 'topview_ad_avatar');
  const taskData = {
    id: taskId,
    status: 'done',
    stage: 'done',
    title: title || '广告数字人',
    text,
    scenes,
    keyframes: keyframes.map(_publicAdKeyframeMeta),
    videoPath: publishedVideo.localPath,
    videoUrl: `/api/avatar/tasks/${taskId}/stream`,
    video_url: publishedVideo.publicUrl,
    image_url: primaryKeyframe || backgroundUrl || avatar?.image_url || '',
    thumbnail_url: primaryKeyframe || backgroundUrl || avatar?.image_url || '',
    keyframeUrl: primaryKeyframe,
    kind: 'production',
    mode: 'digital_ad',
    generation_mode: 'topview',
    ad_mode: adMode,
    ad_style: adStyle,
    shot_count: scenes.length || keyframes.length || 1,
    user_id: productAdTasks.get(taskId)?.user_id,
    ratio: aspectRatio,
    output_size: outputSize,
    resolution: _outputSizeString(aspectRatio, outputSize),
    model: tv.model_id || pipelineVideoModel?.model_id || 'topview-m2v',
    provider_id: 'topview',
    pipeline_video_provider: pipelineVideoModel?.provider_id || 'topview',
    pipeline_video_model: pipelineVideoModel?.model_id || tv.model_id || 'topview-m2v',
    topview_task_id: tv.taskId,
    compressed: publishedVideo.compressed,
    original_video_size: publishedVideo.originalSize,
    final_video_size: publishedVideo.finalSize,
    created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
  };
  productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
  if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
  else db.updateAvatarTask(taskId, taskData);
}

async function _runTopviewLuxuryImageToVideo(req, taskId, {
  text,
  voiceId,
  title,
  scenePrompt,
  keyframes = [],
  scenes = [],
  aspectRatio,
  outputSize,
  adMode,
  adStyle,
  subtitle,
  bgmAsset = null,
  pipelineVideoModel,
}) {
  if (adMode !== 'luxury_ad') throw new Error('Topview Image2Video is only enabled for luxury ads');
  if (!Array.isArray(keyframes) || !keyframes.some(k => k?.image_url)) {
    throw new Error('Topview Image2Video requires confirmed luxury keyframes');
  }
  const topview = require('../services/topviewService');
  const modelId = pipelineVideoModel?.model_id || 'topview-image2video-pro';
  const taskDir = path.join(JIMENG_ASSETS_DIR, `digital_ad_${taskId}`);
  fs.mkdirSync(taskDir, { recursive: true });
  const clips = [];
  const topviewTaskIds = [];
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i];
    const characterLock = kf.character_lock || kf.shot_plan?.character_lock || null;
    const progress = 48 + Math.round((i / keyframes.length) * 32);
    _taskPatch(taskId, {
      stage: 'topview_i2v',
      progress,
      message: `Topview Image2Video luxury shot ${i + 1}/${keyframes.length}`,
    });
    const prompt = _buildLuxuryI2VPrompt(kf, {
      text,
      title,
      scenePrompt,
      adStyle,
      characterLock,
      maxChars: 1100,
    });
    const storyboardDuration = Math.max(1, Math.min(12, Number(kf.duration) || 5));
    const apiDuration = Math.max(5, Math.min(10, storyboardDuration));
    const tv = await topview.generateImageToVideo({
      imageUrl: _absolutePublicUrl(req, kf.image_url),
      prompt,
      duration: apiDuration,
      model: modelId,
      aspectRatio,
      outputSize,
      onProgress: info => _taskPatch(taskId, {
        stage: info.stage || 'topview_i2v',
        progress: Math.max(progress, Math.min(82, Number(info.progress) || progress)),
        message: `Topview Image2Video shot ${i + 1}: ${info.status || info.stage || 'processing'}`,
      }),
    });
    if (!tv?.videoUrl) throw new Error(`Topview Image2Video shot ${i + 1} succeeded without video URL`);
    if (tv.taskId) topviewTaskIds.push(tv.taskId);
    const dl = await axios.get(tv.videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
    const rawClipPath = path.join(taskDir, `topview_i2v_clip_${String(i + 1).padStart(2, '0')}_raw.mp4`);
    const clipPath = path.join(taskDir, `topview_i2v_clip_${String(i + 1).padStart(2, '0')}.mp4`);
    fs.writeFileSync(rawClipPath, Buffer.from(dl.data));
    await _trimVideoClipToStoryboardDuration(rawClipPath, clipPath, storyboardDuration, aspectRatio, outputSize);
    clips.push(clipPath);
  }

  _taskPatch(taskId, { stage: 'post_effects', progress: 84, message: 'Stitching Topview luxury shots' });
  const concatPath = path.join(taskDir, 'topview_i2v_concat.mp4');
  await _concatVideosSmooth(clips, concatPath, aspectRatio, outputSize);
  const voiceSegments = _voiceSegmentsFromKeyframes(keyframes, text || title || '');
  const voiceover = voiceSegments.map(s => s.text).filter(Boolean).join(' ') || text;
  let finalPath = concatPath;
  if (voiceover) {
    try {
      _taskPatch(taskId, { message: 'Mixing luxury ad voiceover' });
      const { generateSpeech } = require('../services/ttsService');
      const audioBase = path.join(taskDir, 'voiceover');
      let audioPath = await _synthesizeSegmentedSpeechFile(req, {
        text: voiceover,
        voiceId: voiceId || null,
        segments: voiceSegments,
        outputBase: audioBase,
      });
      if (!audioPath) audioPath = await generateSpeech(voiceover, audioBase, { voiceId: voiceId || null, speed: 1.0 });
      const muxPath = path.join(taskDir, 'topview_i2v_audio.mp4');
      await _muxAudio(concatPath, audioPath, muxPath);
      finalPath = muxPath;
    } catch (audioErr) {
      console.warn('[DH/luxury/topview-i2v] voiceover failed:', audioErr.message);
    }
  }

  if (subtitle?.show !== false && voiceover) {
    try {
      _taskPatch(taskId, { message: 'Rendering luxury ad subtitles' });
      const { applyEffects } = require('../services/effectsService');
      let cursor = 0;
      const texts = keyframes.filter(k => k.voiceover).map(k => {
        const startTime = cursor;
        cursor += Number(k.duration) || 5;
        return {
          text: k.voiceover,
          preset: 'subtitle',
          position: 'bottom',
          startTime,
          endTime: cursor,
          fontName: subtitle?.fontName || 'Douyin Sans',
          fontSize: subtitle?.fontSize || 64,
          color: subtitle?.color || '#FFFFFF',
          outlineColor: subtitle?.outlineColor || '#000000',
        };
      });
      const fx = await applyEffects({ videoPath: finalPath, texts });
      if (fx?.outputPath && fs.existsSync(fx.outputPath)) finalPath = fx.outputPath;
    } catch (fxErr) {
      console.warn('[DH/luxury/topview-i2v] subtitle failed:', fxErr.message);
    }
  }

  finalPath = await _applyLuxuryBgmIfConfigured(taskId, finalPath, bgmAsset);

  const publishedVideo = _publishAdVideoAsset(req, taskId, finalPath, 'topview_luxury_i2v');
  const clipAssets = _publishAdClipAssets(req, taskId, clips, 'topview_luxury_clip');
  const taskData = {
    id: taskId,
    status: 'done',
    stage: 'done',
    title: title || 'Luxury ad',
    text: voiceover || text,
    scenes,
    keyframes: keyframes.map(_publicAdKeyframeMeta),
    clips: clipAssets,
    clip_urls: clipAssets.map(x => x.video_url || x.url).filter(Boolean),
    videoPath: publishedVideo.localPath,
    videoUrl: `/api/avatar/tasks/${taskId}/stream`,
    video_url: publishedVideo.publicUrl,
    image_url: keyframes[0]?.image_url || '',
    thumbnail_url: keyframes[0]?.image_url || '',
    keyframeUrl: keyframes[0]?.image_url || '',
    kind: 'production',
    mode: 'luxury_ad',
    generation_mode: 'luxury_storyboard',
    ad_mode: adMode,
    ad_style: adStyle,
    shot_count: scenes.length || keyframes.length || 1,
    user_id: productAdTasks.get(taskId)?.user_id,
    ratio: aspectRatio,
    output_size: outputSize,
    resolution: _outputSizeString(aspectRatio, outputSize),
    model: modelId,
    provider_id: 'topview',
    pipeline_video_provider: pipelineVideoModel?.provider_id || 'topview',
    pipeline_video_model: modelId,
    topview_task_ids: topviewTaskIds,
    compressed: publishedVideo.compressed,
    original_video_size: publishedVideo.originalSize,
    final_video_size: publishedVideo.finalSize,
    created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
  };
  productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
  if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
  else db.updateAvatarTask(taskId, taskData);
}

async function _runAdLipSyncPipelineVideo(req, taskId, {
  keyframes = [],
  scenes = [],
  text,
  voiceId,
  title,
  scenePrompt,
  cameraPrompt,
  durationSec,
  segments = [],
  speechSegments = [],
  subtitle,
  aspectRatio,
  outputSize,
  adMode,
  adStyle,
  pipelineLipSyncModel,
}) {
  const base = _publicBaseUrl(req);
  const keyframeUrl = keyframes.find(k => k?.image_url)?.image_url;
  if (!keyframeUrl) throw new Error('缺少广告数字人预览图，无法提交口型同步生成');
  const guideSegments = Array.isArray(speechSegments) && speechSegments.some(s => s?.text)
    ? speechSegments.filter(s => s?.text)
    : (Array.isArray(segments) && segments.length ? segments : _voiceSegmentsFromKeyframes(keyframes, text || title || ''));
  const showSubtitles = subtitle?.show !== false;
  const subtitleStyle = subtitle?.style || 'popup';
  const textEffects = showSubtitles
    ? _normalizeSubtitleSegments(guideSegments, text).map(s => ({
      text: s.text,
      position: subtitleStyle === 'comic' ? 'top-center' : 'bottom-center',
      style: 'subtitle',
      subtitleStyle,
      smartEmphasis: subtitle?.smartEmphasis !== false,
      startTime: s.start ?? 0,
      endTime: s.end,
      fontName: subtitle?.fontName || '抖音美好体',
      fontSize: subtitle?.fontSize || 64,
      color: subtitle?.color || '#FFFFFF',
      outlineColor: subtitle?.outlineColor || '#000000',
    }))
    : [];
  const kbContext = _buildDhKbContext(
    adMode === 'showroom_guide' ? 'showroom_guide' : 'ad_avatar',
    _dhKbQuery(title, text, scenePrompt, cameraPrompt, keyframes, scenes, adMode, adStyle),
    { limit: 4, maxCharsPerDoc: 520 }
  );
  const motionPrompt = [
    'STRICT MATERIAL LOCK: preserve the uploaded/configured background, presenter identity, gender, outfit, product/display area, material texture, lighting direction and visual style. The confirmed keyframe is the first-frame reference, not a frozen pose.',
    kbContext ? `Knowledge-base direction:\n${kbContext}` : '',
    'Create one continuous realistic showroom walkthrough introduction video from this keyframe. The presenter must move like a real guide: small forward/side steps, torso turns toward the display, hand rising into frame, open-palm pointing/sweeping toward the exact details, then returning gaze to the lens.',
    'Preserve identity and scene continuity, but do not preserve a static pose or static composition. Allow the camera to slowly reveal more of the uploaded room while keeping the same space recognizable.',
    _adPresenterActionPrompt({ scenePrompt, text }),
    'Animate natural lip sync, blinking, head movement, arm movement and presenter gestures. The guide must visibly walk/settle, point, present, and guide attention, not just stand still.',
    'Gaze must be intentional: when introducing an object or wall, the eyes and head briefly look at that target while the hand points; after the phrase, the eyes return to the camera. Do not keep diagonal off-camera staring.',
    scenePrompt ? `Scene context: ${scenePrompt}` : '',
    cameraPrompt ? `Camera intent: ${cameraPrompt}` : 'Camera intent: slow walkthrough reveal with forward glide and slight lateral parallax, no hard cuts.',
    'No extra people, no face replacement, no scene replacement, no generated captions inside the model.',
  ].filter(Boolean).join(' ');

  _taskPatch(taskId, {
    status: 'running',
    stage: 'ad_lip_sync',
    progress: 55,
    message: `按模型调用管理使用 ${_pipelineModelLabel(pipelineLipSyncModel)} 生成口播视频`,
  });
  const resp = await axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
    image_url: keyframeUrl,
    text,
    audio_url: null,
    voiceId: voiceId || null,
    title: title || '广告数字人',
    prompt: motionPrompt,
    speed: 1.0,
    textEffects,
    stickers: [],
    cameraMotion: 'handheld',
    cameraSegments: [
      { start: 0, end: 0.22, camera: 'pull_back', intent: 'start as a wider showroom reveal so the uploaded room feels spatial and continuous' },
      { start: 0.22, end: 0.72, camera: 'pan_product', intent: 'glide with slight lateral parallax, following the guide hand and gaze toward the wall/product details' },
      { start: 0.72, end: 1, camera: 'push_in', intent: 'settle on the presenter recommendation after the guide has pointed and returned eye contact' },
    ],
    coverWatermark: true,
    aspectRatio,
    ratio: aspectRatio,
    output_size: outputSize,
    resolution: _outputSizeString(aspectRatio, outputSize),
    kind: 'production',
    agentId: 'ad_avatar.lip_sync',
  }, {
    headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
    timeout: 30000,
  });
  if (!resp.data?.success) throw new Error(resp.data?.error || '提交广告数字人口型同步任务失败');
  const linkedTaskId = resp.data.taskId;
  _taskPatch(taskId, { linkedTaskId, stage: 'ad_lip_sync_submitted', progress: 68, message: '广告数字人口播视频渲染中' });

  const started = Date.now();
  while (Date.now() - started < 50 * 60 * 1000) {
    await _sleep(6000);
    let statusResp = null;
    try {
      statusResp = await axios.get(`${base}/api/avatar/jimeng-omni/tasks/${linkedTaskId}`, {
        headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
        timeout: 20000,
      });
    } catch (pollErr) {
      console.warn('[DH/space-ad/lip-sync] poll failed:', pollErr.message);
      continue;
    }
    const t = statusResp.data?.task;
    if (!t) continue;
    _taskPatch(taskId, {
      progress: Math.min(95, 70 + Math.round((Date.now() - started) / 1000 / Math.max(1, Number(durationSec) || 18) * 12)),
      message: t.fallback_message || t.stage || '广告数字人口播视频渲染中',
      actual_model: t.actual_model,
      actual_provider: t.actual_provider,
    });
    if (t.status === 'done' && t.video_url) {
      const publishedVideo = t.local_path && fs.existsSync(t.local_path)
        ? _publishAdVideoAsset(req, taskId, t.local_path, 'ad_lip_sync')
        : { localPath: t.local_path, publicUrl: t.video_url, compressed: false, originalSize: 0, finalSize: 0 };
      const taskData = {
        id: taskId,
        status: 'done',
        stage: 'done',
        title: title || '广告数字人',
        text,
        scenes,
        keyframes: keyframes.map(_publicAdKeyframeMeta),
        videoPath: publishedVideo.localPath,
        videoUrl: `/api/avatar/tasks/${taskId}/stream`,
        video_url: publishedVideo.publicUrl || t.video_url,
        image_url: keyframeUrl,
        thumbnail_url: keyframeUrl,
        keyframeUrl,
        kind: 'production',
        mode: 'digital_ad',
        generation_mode: 'ad_lip_sync',
        ad_mode: adMode,
        ad_style: adStyle,
        shot_count: scenes.length || keyframes.length || 1,
        user_id: productAdTasks.get(taskId)?.user_id,
        ratio: aspectRatio,
        output_size: outputSize,
        resolution: _outputSizeString(aspectRatio, outputSize),
        model: t.actual_model || pipelineLipSyncModel?.model_id,
        provider_id: t.actual_provider || pipelineLipSyncModel?.provider_id,
        pipeline_lip_sync_provider: pipelineLipSyncModel?.provider_id,
        pipeline_lip_sync_model: pipelineLipSyncModel?.model_id,
        linkedTaskId,
        compressed: publishedVideo.compressed,
        original_video_size: publishedVideo.originalSize,
        final_video_size: publishedVideo.finalSize,
        subtitle_burned: !!t.subtitle_burned,
        subtitle_warning: t.subtitle_warning || '',
        created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
      };
      productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
      if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
      else db.updateAvatarTask(taskId, taskData);
      return;
    }
    if (t.status === 'error') throw new Error(t.error || '广告数字人口型同步渲染失败');
  }
  throw new Error('广告数字人口型同步轮询超时：已等待 50 分钟，远端任务仍未完成');
}

router.post('/product-ads/generate', async (req, res) => {
  try {
    const {
      avatar_id,
      product = null,
      topic = '',
      title = '',
      duration_sec = 18,
      voice_id = null,
      voice_provider = '',
      subtitle = null,
      segments = [],
      aspect_ratio,
      aspectRatio: aspectRatioBody,
      output_size,
      outputSize,
      replaces_task_id = '',
    } = req.body || {};
    const aspectRatio = _normalizeAspectRatio(aspect_ratio || aspectRatioBody, '9:16');
    const normalizedOutputSize = _normalizeOutputSize(output_size || outputSize);
    if (!avatar_id) return res.status(400).json({ success: false, error: '请选择商品数字人形象' });
    if (!String(voice_id || '').trim()) return res.status(400).json({ success: false, error: 'voice_id 必填，请先选择 Topview 配音音色' });
    const avatar = db.getPortrait(avatar_id);
    if (!avatar || avatar.kind !== 'digital_human' || !ownedBy(req, avatar)) {
      return res.status(404).json({ success: false, error: '形象不存在' });
    }
    const effectiveProduct = product?.image_url
      ? product
      : ((avatar.avatar_type === 'product' || avatar.type === 'product') ? (avatar.product || null) : null);
    if (!effectiveProduct?.image_url) return res.status(400).json({ success: false, error: '商品广告片需要商品图' });
    const taskId = uuidv4();
    _markTaskSuperseded(replaces_task_id, taskId, req.user?.id || null);
    const task = {
      id: taskId,
      taskId,
      status: 'submitted',
      stage: 'submitted',
      progress: 3,
      message: '已提交商品口播视频生成',
      title: String(title || `${effectiveProduct?.name || effectiveProduct?.image_name || '商品'} 商品口播视频`).trim().slice(0, 100),
      avatar_id,
      product: effectiveProduct,
      topic,
      duration_sec,
      voice_id,
      voice_provider,
      segments: Array.isArray(segments) ? segments : [],
      subtitle,
      user_id: req.user?.id,
      created_at: new Date().toISOString(),
      started_at: Date.now(),
      kind: 'production',
      mode: 'product_ad',
      ratio: aspectRatio,
      output_size: normalizedOutputSize,
      resolution: _outputSizeString(aspectRatio, normalizedOutputSize),
    };
    productAdTasks.set(taskId, task);
    res.json({ success: true, taskId, message: '已提交商品口播视频任务' });
    _runProductAdTask(req, taskId, { avatar, product: effectiveProduct, topic, title, durationSec: duration_sec, voiceId: voice_id, voiceProvider: voice_provider, subtitle, segments, aspectRatio, outputSize: normalizedOutputSize });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/product-ads/preview-voice', async (req, res) => {
  try {
    const { voice_id = '', text = '', segments = [] } = req.body || {};
    if (!String(voice_id || '').trim()) return res.status(400).json({ success: false, error: 'voice_id 必填' });
    if (!String(text || '').trim()) return res.status(400).json({ success: false, error: 'text 必填' });
    const taskDir = path.join(JIMENG_ASSETS_DIR, `preview_product_voice_${Date.now()}_${uuidv4().slice(0, 8)}`);
    fs.mkdirSync(taskDir, { recursive: true });
    const outBase = path.join(taskDir, 'preview');
    let audioPath = await _synthesizeSegmentedSpeechFile(req, {
      text,
      voiceId: voice_id,
      segments,
      outputBase: outBase,
    });
    if (!audioPath || !fs.existsSync(audioPath)) {
      const { generateSpeech } = require('../services/ttsService');
      audioPath = await generateSpeech(String(text).slice(0, 1000), outBase, { voiceId: voice_id, speed: 1.0 });
    }
    if (!audioPath || !fs.existsSync(audioPath) || fs.statSync(audioPath).size < 2048) {
      return res.status(500).json({ success: false, error: '试听音频生成失败或为空' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', audioPath.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
    fs.createReadStream(audioPath).pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/product-ads/:taskId', (req, res) => {
  const task = productAdTasks.get(req.params.taskId) || db.getAvatarTask(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
  if (task.user_id && req.user?.id && task.user_id !== req.user.id) {
    return res.status(404).json({ success: false, error: '任务不存在' });
  }
  res.json({ success: true, task });
});

router.post('/images/generate', async (req, res) => {
  try {
    const { style = 'idol_warm', gender = '', description = '', scene_description = '', aspectRatio: rawAspectRatio = '9:16', avatar_type = 'normal', product = null, action = 'natural', framing = 'half_body', background_image_url = '', use_background_image = false, output_size = 'standard', resolution = '' } = req.body || {};
    const isProduct = avatar_type === 'product' && product?.image_url;
    // 自定义背景：把图当 reference 喂给 nano-banana，并往 prompt 加"以参考图作为背景场景"
    // 只有用户本次明确选择了自定义背景（前端传 use_background_image=true）才启用；
    // 旧页面状态/跨流程残留的 background_image_url 不应污染普通形象生成。
    const allowBgRef = use_background_image === true || use_background_image === 'true';
    const bgRef = allowBgRef && background_image_url && /^https?:\/\//i.test(background_image_url)
      ? background_image_url : '';

    // 用户上传 bg → 画布尺寸跟随 bg 比例，避免 stage3 cover 裁切丢失大块背景
    let aspectRatio = rawAspectRatio;
    let cachedBgBuf = null;
    if (bgRef) {
      try {
        const sharp = require('sharp');
        cachedBgBuf = await _fetchImageBuffer(bgRef);
        const bgMeta = await sharp(cachedBgBuf).metadata();
        const bgRatio = bgMeta.width / bgMeta.height;
        // 找最接近的预设比例
        let chosen = rawAspectRatio;
        if (bgRatio > 1.6) chosen = '16:9';
        else if (bgRatio < 0.65) chosen = '9:16';
        else if (Math.abs(bgRatio - 1) < 0.1) chosen = '1:1';
        else if (bgRatio < 1) chosen = '3:4';
        else chosen = '4:3';
        if (chosen !== rawAspectRatio) {
          console.log(`[DH/images] 背景图实际尺寸 ${bgMeta.width}x${bgMeta.height} (≈${chosen}) ≠ 用户选 ${rawAspectRatio} → 自动跟随背景比例避免裁切`);
          aspectRatio = chosen;
        }
      } catch (e) {
        console.warn('[DH/images] 读 bg 比例失败，沿用用户选的比例:', e.message);
      }
    }

    const baseUrl = _publicBaseUrl(req);
    const filename = `dh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // ════════════════════════════════════════════════
    // 商品数字人（Topview 模式）：两阶段
    //   阶段 A: 用 STYLE_PROMPTS[style] 生成基础人物（无商品）
    //   阶段 B: 用人物图 + 商品图 + 场景模板做 nano-banana 多 ref 融合
    // 不再单 ref（只商品图）+ 强 prompt — 那样模型不知道人是谁，商品也很难塞进去
    // ════════════════════════════════════════════════
    if (isProduct) {
      // ─── 阶段 A: 生成基础人物图 ───
      // 商品数字人阶段 A 不注入 action（持物姿势由阶段 B 商品融合时决定）
      const userEnPrompt = await _translateDescToEnAttrPrompt(description, { style, gender });
      // 商品数字人阶段 A 默认 half_body，让人物半身可见，方便阶段 B 持物融合
      const stylePack = _buildPrompt({ style, gender, description, sceneDescription: scene_description, userEnPrompt, framing: framing || 'half_body' });
      console.log(`[DH/images] 阶段A: 生成基础人物 style=${style} gender=${gender}`);
      const baseFilename = filename + '_base';
      let baseFilePath = null;
      try {
        baseFilePath = await _generateViaDeyunaiNanoBanana({
          prompt: stylePack.prompt,
          aspectRatio,
          filename: baseFilename,
          destDir: JIMENG_ASSETS_DIR,
          referenceImages: [],
        });
      } catch (eA1) {
        console.warn('[DH/images] 阶段A nano-banana 失败，fallback Seedream:', eA1.message);
        baseFilePath = await avatarService._arkSeedreamGenerate({
          prompt: stylePack.prompt, aspectRatio, filename: baseFilename, outputSize: output_size, resolution,
          watermark: false, cropBottomPx: 100, destDir: JIMENG_ASSETS_DIR,
        });
      }
      if (!baseFilePath) throw new Error('阶段A 基础人物生成失败');
      const baseImgUrl = `${baseUrl}/public/jimeng-assets/${path.basename(baseFilePath)}`;
      console.log(`[DH/images] 阶段A ✓ 基础人物 ${path.basename(baseFilePath)}`);

      // ─── 阶段 B: 人物 + 商品 + 场景融合（Topview 真融合）───
      console.log(`[DH/images] 阶段B: 融合人物+商品`);
      const fusedUrl = await _generateProductIntegratedAvatarImage(
        req,
        { image_url: baseImgUrl },
        product,
      );
      if (!fusedUrl) throw new Error('阶段B 商品融合失败');
      const fusedName = fusedUrl.split('/').pop();
      console.log(`[DH/images] 阶段B ✓ 融合完成 ${fusedName}`);
      res.json({ success: true, imageUrl: fusedUrl, filename: fusedName, topview: req._lastProductFusion || null });
      return;
    }

    // ════════════════════════════════════════════════
    // 普通数字人：单图生成
    // ════════════════════════════════════════════════
    // 关键：先把用户中文描述 LLM 翻译为英文属性 prompt（前置占主导权重）
    // 有 bgRef 时强制告诉 LLM 剥掉描述里的背景部分，避免污染 stage1（用户上传的 bg 才是最终背景）
    const userEnPrompt = await _translateDescToEnAttrPrompt(description, { style, gender, hasBgRef: !!bgRef });
    const promptPack = _buildPrompt({ style, gender, description, sceneDescription: scene_description, action, userEnPrompt, framing, hasBgRef: !!bgRef });
    const { prompt } = promptPack;
    if (action && action !== 'natural') {
      console.log(`[DH/images] 注入动作姿势 action=${action} → 烘焙到形象图（lip-sync 不接受动作 prompt，只能在生成时 baked-in）`);
    }
    if (framing && framing !== 'half_body') {
      console.log(`[DH/images] 构图 framing=${framing}（前置+后置双重强化覆盖 style 模板默认）`);
    }

    let filePath = null;
    let lastError = null;
    const attempts = [];

    // 自定义背景管线：用户明确上传背景时，优先让图像模型在背景参考图内“直接生成”
    // 场景中的人物。之前的灰底人物 → 抠像 → Sharp 贴图方案融合感差，容易像剪辑贴上去。
    let composePath = 'single-stage';
    let composeStageError = null;
    if (bgRef) {
      console.log(`[DH/images] 自定义背景一体生成启动 → bg=${bgRef.slice(0, 80)}…`);
      let stageMark = 'init';
      try {
        stageMark = 'integrated-bg-generation';
        const integratedPrompt = _buildIntegratedBackgroundPrompt({ gender, userEnPrompt, framing, action });
        console.log(`[DH/images] 背景内一体生成… framing=${framing} ar=${aspectRatio} promptLen=${integratedPrompt.length}`);
        try {
          filePath = await _generateViaDeyunaiSpecificImageModel({
            model: 'gpt-image-1',
            prompt: integratedPrompt, aspectRatio, filename: filename + '_gpt_image', outputSize: output_size, resolution,
            destDir: JIMENG_ASSETS_DIR,
            referenceImages: [bgRef],
          });
          attempts.push({ provider: 'deyunai-gpt-image-1', ok: true, bgRef: true });
        } catch (gptImageErr) {
          console.warn('[DH/images] gpt-image-1 背景一体生成失败，回退 nano-banana:', gptImageErr.message);
          attempts.push({ provider: 'deyunai-gpt-image-1', ok: false, error: gptImageErr.message });
          filePath = await _generateViaDeyunaiNanoBanana({
            prompt: integratedPrompt, aspectRatio, filename: filename + '_integrated', outputSize: output_size, resolution,
            destDir: JIMENG_ASSETS_DIR,
            referenceImages: [bgRef],
          });
          attempts.push({ provider: 'deyunai-nano-banana', ok: true, bgRef: true });
        }
        if (framing === 'full_body') {
          const ok = await _checkIsFullBodyImage(filePath);
          if (ok === false) {
            console.warn('[DH/images] 背景一体生成视觉自检：判定非全身 → 重 try 一次');
            const retryPrompt = [
              'Use the uploaded background as the exact commercial interior scene.',
              'Generate one single adult presenter directly inside the scene with matching shadows and light.',
              'EXTREME WIDE FULL-BODY STANDING SHOT: head, torso, arms, legs, ankles, shoes and both feet must all be visible.',
              'The presenter must be smaller in frame, standing on the visible floor plane, not sitting, not cropped.',
              'No half body, no waist-up, no portrait crop, no chair sitting, no pasted cutout edges.',
              userEnPrompt ? `Appearance: ${userEnPrompt.trim().slice(0, 420)}.` : '',
              REALISTIC_PHOTO_GUIDE,
            ].filter(Boolean).join(' ');
            try {
              const retryPath = await _generateViaDeyunaiSpecificImageModel({
                model: 'gpt-image-1',
                prompt: retryPrompt, aspectRatio, filename: filename + '_gpt_image_r', outputSize: output_size, resolution,
                destDir: JIMENG_ASSETS_DIR,
                referenceImages: [bgRef],
              });
              const ok2 = await _checkIsFullBodyImage(retryPath);
              if (ok2 !== false) {
                filePath = retryPath;
                console.log('[DH/images] 背景一体生成重试：' + (ok2 === true ? '✓ 全身通过' : '⚠ 视觉判不出，沿用 retry 结果'));
              } else {
                console.warn('[DH/images] 背景一体生成重试仍非全身，用最后结果继续（用户可再点重新生成）');
                filePath = retryPath;
              }
            } catch (retryErr) {
              console.warn('[DH/images] 背景一体生成重试失败，用首次结果继续:', retryErr.message);
            }
          } else if (ok === true) {
            console.log('[DH/images] 背景一体生成视觉自检：✓ 全身通过');
          }
        }
        composePath = 'integrated-bg-generation';
        attempts.push({ provider: 'integrated-bg-generation', ok: true, bgRef: true, preferredModel: 'gpt-image-1' });
        console.log(`[DH/images] ✓ 背景一体生成完成: ${path.basename(filePath)}`);
      } catch (composeErr) {
        composeStageError = `${stageMark}: ${composeErr.message}`;
        console.error(`[DH/images] 背景一体生成失败 @ ${composeStageError}`);
        attempts.push({ provider: 'integrated-bg-generation', ok: false, stage: stageMark, error: composeErr.message });
        return res.status(500).json({
          success: false,
          error: `自定义背景一体生成失败 @ ${stageMark}: ${composeErr.message}`,
          hint: '请重试；如果要严格保留背景不变，可上传完整首帧到广告数字人流程。',
          attempts,
        });
      }
    }

    // 单阶段（无自定义背景，或两阶段失败 fallback）
    if (!filePath) {
      try {
        console.log('[DH/images] 尝试 deyunai 漫路 nano-banana (单阶段)...');
        filePath = await _generateViaDeyunaiNanoBanana({
          prompt, aspectRatio, filename, outputSize: output_size, resolution,
          destDir: JIMENG_ASSETS_DIR,
          referenceImages: bgRef ? [bgRef] : [],  // fallback: 还是把 bg 当 ref 试一下
        });
        attempts.push({ provider: 'deyunai-nano-banana', ok: true, bgRef: !!bgRef });
      } catch (e1) {
        console.warn('[DH/images] nano-banana 失败:', e1.message);
        attempts.push({ provider: 'deyunai-nano-banana', ok: false, error: e1.message });
        lastError = e1;
        try {
          console.log('[DH/images] fallback 火山 Seedream...');
          filePath = await avatarService._arkSeedreamGenerate({
            prompt, aspectRatio, filename, outputSize: output_size, resolution,
            watermark: false, cropBottomPx: 100, destDir: JIMENG_ASSETS_DIR,
          });
          attempts.push({ provider: 'volces-seedream', ok: true });
        } catch (e2) {
          attempts.push({ provider: 'volces-seedream', ok: false, error: e2.message });
          lastError = e2;
        }
      }
    }

    if (!filePath) {
      const msg = '所有图像 provider 失败：' + attempts.map(a => `${a.provider}=${a.error || 'ok'}`).join('；');
      throw new Error(msg);
    }

    let generationWarning = '';
    if (framing === 'full_body') {
      const fullBodyOk = await _checkIsFullBodyImage(filePath);
      attempts.push({ provider: 'full-body-check', ok: fullBodyOk });
      if (fullBodyOk !== true) {
        console.warn('[DH/images] full_body 结果未通过全身检测，继续返回预览并提示用户');
        if (bgRef) {
          generationWarning = fullBodyOk === false
            ? '已生成预览，但「全身」检测未通过，可能仍有半身或脚部裁切；建议减少近景/坐姿/复杂背景后重试。'
            : '已生成预览，但全身检测暂时不可用，请人工确认是否头到脚完整。';
        }
        if (!bgRef) {
          const originalPath = filePath;
          const strictFullBodyPrompt = [
            'STRICT FULL BODY GENERATION. The output should show one complete standing person from head to feet.',
            'Head, torso, arms, hands, legs, ankles, shoes and both feet should all be visible inside the frame.',
            'Full-length vertical fashion photograph, far camera distance, floor visible under both feet.',
            'No sitting, no sofa crop, no waist-up crop, no portrait crop, no half-body.',
            prompt,
            'FINAL CHECK: entire body visible, both feet visible, one single person, clean simple studio floor.',
          ].join(' ');
          try {
            const retryPath = await _generateViaDeyunaiNanoBanana({
              prompt: strictFullBodyPrompt,
              aspectRatio,
              filename: filename + '_fullbody_retry',
              outputSize: output_size,
              resolution,
              destDir: JIMENG_ASSETS_DIR,
              referenceImages: [],
            });
            const retryOk = await _checkIsFullBodyImage(retryPath);
            attempts.push({ provider: 'full-body-retry', ok: retryOk, file: path.basename(retryPath) });
            filePath = retryPath;
            if (retryOk !== true) {
              generationWarning = retryOk === false
                ? '已生成预览，但模型连续两次未通过「完整全身」检测，可能仍有半身或脚部裁切；请确认效果，不满意再减少近景/复杂描述后重试。'
                : '已生成预览，但全身检测暂时不可用，请人工确认是否头到脚完整。';
            }
          } catch (retryErr) {
            attempts.push({ provider: 'full-body-retry', ok: false, error: retryErr.message });
            filePath = originalPath;
            generationWarning = '已生成初版预览，但全身强化重试失败；请确认效果，不满意再减少近景/复杂描述后重试。';
          }
        }
      }
    }

    const imgName = path.basename(filePath);
    const imageUrl = `${baseUrl}/public/jimeng-assets/${imgName}`;
    console.log('[DH/images] 全链路:', JSON.stringify(attempts));
    res.json({ success: true, imageUrl, filename: imgName, warning: generationWarning || undefined, attempts });
  } catch (err) {
    const detail = err.response?.data
      ? (typeof err.response.data === 'object' ? (err.response.data.error?.message || err.response.data.message || JSON.stringify(err.response.data).slice(0, 300)) : String(err.response.data).slice(0, 300))
      : null;
    const msg = detail ? `${detail}` : err.message;
    console.error('[DH] generate image 失败:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// ═══════════════════════════════════════════════
// Step 1 · POST /api/dh/images/detect-gender
//   body: { imageUrl }  → { gender: 'male'|'female'|'unknown' }
//   使用多模态 LLM（优先 zhipu glm-4v，回退 openai gpt-4o-mini）识别图中人物性别
// ═══════════════════════════════════════════════
router.post('/images/detect-gender', async (req, res) => {
  try {
    const { imageUrl } = req.body || {};
    if (!imageUrl) return res.status(400).json({ success: false, error: 'imageUrl 必填' });

    // 同源图转成本地文件，再 base64（避免外网模型回拉走 IP/鉴权）
    let b64 = null, mime = 'image/jpeg';
    try {
      const base = _publicBaseUrl(req);
      let localPath = null;
      if (imageUrl.startsWith(base) || imageUrl.startsWith('/public/jimeng-assets/')) {
        const name = path.basename(imageUrl.split('?')[0]);
        localPath = path.join(JIMENG_ASSETS_DIR, name);
      }
      if (localPath && fs.existsSync(localPath)) {
        b64 = fs.readFileSync(localPath).toString('base64');
        if (/\.png$/i.test(localPath)) mime = 'image/png';
        else if (/\.webp$/i.test(localPath)) mime = 'image/webp';
      } else {
        const r = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
        b64 = Buffer.from(r.data).toString('base64');
        mime = r.headers['content-type'] || 'image/jpeg';
      }
    } catch (e) {
      return res.status(400).json({ success: false, error: '图片加载失败: ' + e.message });
    }

    const { loadSettings, getApiKey } = require('../services/settingsService');
    const settings = loadSettings();

    // 优先顺序：zhipu glm-4v > openai gpt-4o-mini
    const tryProvider = async (keywords, model, payloadBuilder) => {
      const prov = (settings.providers || []).find(p => {
        const hay = ((p.id || '') + '|' + (p.preset || '') + '|' + (p.name || '')).toLowerCase();
        return keywords.some(k => hay.includes(k)) && p.api_key && p.enabled;
      });
      if (!prov) return null;
      const key = getApiKey(prov.id);
      if (!key) return null;
      const baseUrl = prov.base_url || (prov.preset === 'zhipu' ? 'https://open.bigmodel.cn/api/paas/v4' : 'https://api.openai.com/v1');
      try {
        const r = await axios.post(`${baseUrl}/chat/completions`, payloadBuilder(model), {
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        });
        return r.data?.choices?.[0]?.message?.content || '';
      } catch (e) {
        console.warn(`[detect-gender] ${prov.id} 失败:`, e.response?.data?.error?.message || e.message);
        return null;
      }
    };

    const promptText = '请看这张照片，判断其中主要人物的性别。只回答以下三个词之一：male / female / unknown。不要加任何解释。';
    const imgDataUrl = `data:${mime};base64,${b64}`;

    let reply = null;
    reply = await tryProvider(['zhipu', '智谱'], 'glm-4v-flash', (model) => ({
      model,
      messages: [{ role: 'user', content: [
        { type: 'text', text: promptText },
        { type: 'image_url', image_url: { url: imgDataUrl } },
      ] }],
      temperature: 0,
    }));
    if (!reply) {
      reply = await tryProvider(['openai'], 'gpt-4o-mini', (model) => ({
        model,
        messages: [{ role: 'user', content: [
          { type: 'text', text: promptText },
          { type: 'image_url', image_url: { url: imgDataUrl } },
        ] }],
        max_tokens: 10,
        temperature: 0,
      }));
    }

    if (!reply) return res.json({ success: true, gender: 'unknown', note: '未配置多模态模型（zhipu/openai）' });
    const low = String(reply).toLowerCase();
    const gender = /female|女/.test(low) ? 'female' : /male|男/.test(low) ? 'male' : 'unknown';
    res.json({ success: true, gender, raw: reply.slice(0, 40) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Step 1.bis · POST /api/dh/images/compose-scene
//   用户已上传一张「人物图」+ 一张「背景图」 → 合成
//   body: {
//     person_image_url, background_image_url,
//     aspectRatio?='9:16',
//     placement?='center'|'bottom'|'fit',
//     mode?='fast',                        // 上传真人照只允许保真抠像合成
//     person_height_pct?=0.8,              // 0.5-0.95
//   }
//   - 百度抠像 + sharp 合成（秒级、保留原人物）+ alpha 软边
//   - 禁止上传人物图进入 AI 生成/融合模型，避免身份和长相被重绘
//   return: { success, imageUrl, filename, mode }
// ═══════════════════════════════════════════════
router.post('/images/compose-scene', async (req, res) => {
  try {
    const {
      person_image_url, background_image_url,
      aspectRatio = '9:16',
      output_size = 'standard',
      placement = 'center',
      mode = 'fast',
      person_height_pct,
    } = req.body || {};
    if (!person_image_url) return res.status(400).json({ success: false, error: '缺少 person_image_url' });
    if (!background_image_url) return res.status(400).json({ success: false, error: '缺少 background_image_url' });
    if (mode && mode !== 'fast') {
      console.warn(`[DH/compose-scene] ignore unsafe upload compose mode=${mode}; force fast matting compose`);
    }

    // ─── 上传人物 + 上传背景：只走百度抠像 + sharp，绝不 fallback 到 AI 重绘 ───
    const sharp = require('sharp');
    const { matteImageBuffer } = require('../services/foregroundMattingService');

    let stage = 'fetch-images';
    try {
      const [personBuf, bgBuf] = await Promise.all([
        _fetchImageBuffer(person_image_url),
        _fetchImageBuffer(background_image_url),
      ]);

      stage = 'professional-matting';
      console.log('[DH/compose-scene] professional foreground matting...');
      const matte = await matteImageBuffer(personBuf, {
        inputUrl: person_image_url,
        resolution: '1024x1024',
      });
      const fgPng = matte.buffer;

      stage = 'sharp-compose';
      const [W, H] = _outputPixels(aspectRatio, output_size);
      const bgResized = await sharp(bgBuf)
        .resize(W, H, { fit: 'cover' })
        .modulate({ brightness: 0.98, saturation: 0.96 })
        .toBuffer();

      // ① trim 去透明边
      const trimmed = await sharp(fgPng).trim({ threshold: 1 }).toBuffer();
      const tMeta = await sharp(trimmed).metadata();

      // ② alpha 软边（高斯模糊 alpha 通道 1.1px → 提取 + 模糊 + 合回）
      // 把硬抠边变成细微过渡，避开"一刀切"的贴纸感。
      let softened = trimmed;
      try {
        const alpha = await sharp(trimmed).extractChannel(3).blur(1.1).toBuffer();
        softened = await sharp(trimmed).removeAlpha().joinChannel(alpha).png().toBuffer();
      } catch (softErr) {
        console.warn('[DH/compose-scene] alpha 软边失败，用硬边继续:', softErr.message);
      }

      // ③ 决定人物大小：默认更克制，脚部贴底，避免漂浮在背景中间。
      const heightPct = (typeof person_height_pct === 'number' && person_height_pct >= 0.4 && person_height_pct <= 0.98)
        ? person_height_pct
        : (placement === 'fit' ? 0.88 : 0.76);
      const requestedH = Math.round(H * heightPct);
      const maxUpscale = placement === 'fit' ? 2.05 : 1.85;
      const targetH = Math.min(requestedH, Math.round(tMeta.height * maxUpscale));
      const scale = targetH / tMeta.height;
      let fgW = Math.round(tMeta.width * scale);
      let fgH = targetH;
      const maxW = Math.round(W * 0.92);
      if (fgW > maxW) {
        const s2 = maxW / tMeta.width;
        fgW = Math.round(tMeta.width * s2);
        fgH = Math.round(tMeta.height * s2);
      }
      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      let foreground = softened;
      try {
        const [bgStats, fgStats] = await Promise.all([
          sharp(bgResized)
            .extract({
              left: Math.round(W * 0.18),
              top: Math.round(H * 0.18),
              width: Math.round(W * 0.64),
              height: Math.round(H * 0.64),
            })
            .stats(),
          sharp(softened).removeAlpha().stats(),
        ]);
        const lum = (s) => 0.2126 * s.channels[0].mean + 0.7152 * s.channels[1].mean + 0.0722 * s.channels[2].mean;
        const bgLum = lum(bgStats);
        const fgLum = lum(fgStats);
        const brightness = clamp((bgLum / Math.max(1, fgLum)) * 0.96, 0.82, 1.12);
        const saturation = clamp((bgStats.channels[0].stdev + bgStats.channels[1].stdev + bgStats.channels[2].stdev)
          / Math.max(1, (fgStats.channels[0].stdev + fgStats.channels[1].stdev + fgStats.channels[2].stdev)) * 0.95, 0.82, 1.08);
        foreground = await sharp(softened)
          .modulate({ brightness, saturation })
          .sharpen({ sigma: 0.45, m1: 0.35, m2: 0.25 })
          .png()
          .toBuffer();
      } catch (toneErr) {
        console.warn('[DH/compose-scene] 色调匹配失败，用原人物继续:', toneErr.message);
      }

      const fgScaled = await sharp(foreground)
        .resize(fgW, fgH, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .sharpen({ sigma: 0.55, m1: 0.45, m2: 0.35 })
        .png()
        .toBuffer();
      const left = Math.round((W - fgW) / 2);
      const bottomMargin = placement === 'fit' ? 0 : Math.round(H * 0.025);
      const top = Math.max(0, H - fgH - bottomMargin);

      const shadowAlpha = await sharp(fgScaled)
        .extractChannel(3)
        .blur(Math.max(8, Math.round(W * 0.018)))
        .linear(0.18, 0)
        .toBuffer();
      const dropShadow = await sharp({
        create: { width: fgW, height: fgH, channels: 3, background: { r: 0, g: 0, b: 0 } },
      }).joinChannel(shadowAlpha).png().toBuffer();
      const contactShadowSvg = Buffer.from(`
        <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <filter id="b"><feGaussianBlur stdDeviation="${Math.max(10, W * 0.02)}"/></filter>
          <ellipse cx="${left + fgW / 2}" cy="${Math.min(H - 8, top + fgH - H * 0.015)}"
            rx="${Math.max(36, fgW * 0.34)}" ry="${Math.max(12, H * 0.018)}"
            fill="rgba(0,0,0,0.20)" filter="url(#b)"/>
        </svg>`);
      const edgeWrap = await sharp(fgScaled)
        .extractChannel(3)
        .blur(6)
        .threshold(10)
        .linear(0.025, 0)
        .toBuffer()
        .then(alpha => sharp({
          create: { width: fgW, height: fgH, channels: 3, background: { r: 210, g: 190, b: 160 } },
        }).joinChannel(alpha).png().toBuffer());

      const composed = await sharp(bgResized).composite([
        { input: contactShadowSvg, top: 0, left: 0, blend: 'over' },
        { input: dropShadow, top: Math.min(H - fgH, top + Math.round(H * 0.012)), left: clamp(left + Math.round(W * 0.012), 0, W - fgW), blend: 'over' },
        { input: edgeWrap, top, left, blend: 'screen' },
        { input: fgScaled, top, left, blend: 'over' },
      ]).jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer();

      stage = 'write-output';
      const filename = `dh_compose_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const outPath = path.join(JIMENG_ASSETS_DIR, filename);
      fs.writeFileSync(outPath, composed);

      const baseUrl = _publicBaseUrl(req);
      console.log(`[DH/compose-scene] ✓ ${filename} (canvas=${W}x${H}, fg=${fgW}x${fgH}, top=${top}, left=${left}, hPct=${heightPct.toFixed(2)})`);
      res.json({
        success: true,
        imageUrl: `${baseUrl}/public/jimeng-assets/${filename}`,
        filename,
        mode: 'fast',
        identity_preserved: true,
        ai_generation_used: false,
        matting_provider: matte.provider,
        matting_model: matte.model,
      });
    } catch (err) {
      const msg = `合成失败 @ ${stage}: ${err.message}`;
      console.error('[DH/compose-scene]', msg);
      const hint = stage === 'professional-matting'
        ? '专业抠图失败：检查 settings 里的 replicate 或 baidu-aip provider 是否启用且 key 有效'
        : (stage === 'fetch-images' ? '图片 URL 拉取失败 — 检查 URL 是否对外可访问' : '请重试或换图');
      res.status(500).json({ success: false, error: msg, stage, hint });
    }
  } catch (outer) {
    res.status(500).json({ success: false, error: outer.message });
  }
});

// ═══════════════════════════════════════════════
// Step 1 · POST /api/dh/images/upload
//   form-data: image
//   return: { imageUrl, filename }
// ═══════════════════════════════════════════════
router.post('/images/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请选择图片' });
    const ext = path.extname(req.file.originalname || '').toLowerCase() || '.png';
    const dstName = `dh_upload_${uuidv4()}${ext}`;
    const dstPath = path.join(JIMENG_ASSETS_DIR, dstName);
    fs.copyFileSync(req.file.path, dstPath);
    try { fs.unlinkSync(req.file.path); } catch {}
    const baseUrl = _publicBaseUrl(req);
    res.json({ success: true, imageUrl: `${baseUrl}/public/jimeng-assets/${dstName}`, filename: dstName });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Step 2 · 我的形象 CRUD（落 portrait_db, kind='digital_human'）
// ═══════════════════════════════════════════════

// GET /api/dh/my-avatars
router.get('/my-avatars', (req, res) => {
  try {
    const all = db.listPortraits(scopeUserId(req));
    const dh = all.filter(p => p.kind === 'digital_human').map(p => normalizeMyAvatarAssetUrls(p, req));
    res.json({ success: true, data: dh });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dh/my-avatars/:id
router.get('/my-avatars/:id', (req, res) => {
  const p = db.getPortrait(req.params.id);
  if (!p || p.kind !== 'digital_human' || !ownedBy(req, p)) {
    return res.status(404).json({ success: false, error: '形象不存在' });
  }
  res.json({ success: true, data: normalizeMyAvatarAssetUrls(p, req) });
});

// POST /api/dh/my-avatars
//   body: { name, imageUrl, sampleVideoUrl?, gender?, style?, tags?, source? }
router.post('/my-avatars', (req, res) => {
  try {
    const { name, imageUrl, sampleVideoUrl = null, gender = '', style = '', tags = [], source = 'generate', description = '', scene_description = '', avatar_type = 'normal', product = null } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ success: false, error: '请输入形象名称' });
    if (!imageUrl) return res.status(400).json({ success: false, error: '缺少图片' });
    if (avatar_type === 'product') {
      const topviewProductImageId = product?.topview_image_id || product?.topviewImageId || product?.topview?.imageId || '';
      if (!product?.image_url) {
        return res.status(400).json({ success: false, error: '商品数字人需要先上传商品图' });
      }
      if (!topviewProductImageId) {
        return res.status(400).json({ success: false, error: '商品数字人必须先完成 Topview 商品融合，不能直接保存未融合的上传图' });
      }
    }

    const id = uuidv4();
    const row = {
      id,
      user_id: req.user?.id || null,
      name: name.trim(),
      kind: 'digital_human',
      image_url: imageUrl,
      photo_url: imageUrl,  // 兼容 portrait 表老字段
      sample_video_url: sampleVideoUrl, // 动态预览 5-8s 样片（可选）
      gender,
      style,
      avatar_type: avatar_type === 'product' ? 'product' : 'normal',
      type: avatar_type === 'product' ? 'product' : 'normal',
      product: product || null,
      product_image_url: product?.image_url || '',
      product_image_name: product?.image_name || '',
      product_cutout_url: product?.cutout_url || product?.cutoutUrl || product?.prepared_url || product?.preparedUrl || '',
      topview_product_image_id: product?.topview_image_id || product?.topviewImageId || product?.topview?.imageId || '',
      topview_product_task_id: product?.topview_task_id || product?.topviewTaskId || product?.topview?.taskId || '',
      tags: Array.isArray(tags) ? tags : [],
      source,                // 'generate' | 'upload'
      description,
      scene_description,
      status: 'done',        // 数字人形象不走 2D/3D 生成，直接标完成
      progress: 100,
      message: '已保存',
    };
    db.insertPortrait(row);
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Step 1.5 · 动态预览样片（5-8 秒 Jimeng Omni 驱动测试）
//   用户上传/生成图后，马上跑一次 Jimeng Omni 用短招呼语（"你好，我是..."）
//   出一段小视频让用户验证这张脸真的能被驱动、效果是否满意
// ═══════════════════════════════════════════════

// POST /api/dh/samples/generate
//   body: { image_url, sample_text? }
//   → { taskId }  （复用 /api/avatar/jimeng-omni/tasks/:id 查进度）
router.post('/samples/generate', async (req, res) => {
  try {
    const { image_url, sample_text } = req.body || {};
    if (!image_url) return res.status(400).json({ success: false, error: 'image_url 必填' });

    const text = (sample_text?.trim()) || '大家好，我是你的 AI 数字人，很高兴为你服务';

    const base = _publicBaseUrl(req);
    const resp = await axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
      image_url,
      text,
      speed: 1.0,
      title: '[预览样片]',
      kind: 'sample',
    }, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 30000,
    });

    if (!resp.data?.success) {
      return res.status(500).json({ success: false, error: resp.data?.error || '提交样片失败' });
    }
    res.json({ success: true, taskId: resp.data.taskId, sample_text: text });
  } catch (err) {
    const e = err.response?.data?.error || err.message;
    console.error('[DH] samples/generate 失败:', e);
    res.status(500).json({ success: false, error: e });
  }
});

// GET /api/dh/samples/:taskId — 样片任务进度（代理到 jimeng-omni）
router.get('/samples/:taskId', async (req, res) => {
  try {
    const base = _publicBaseUrl(req);
    const r = await axios.get(`${base}/api/avatar/jimeng-omni/tasks/${req.params.taskId}`, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 10000,
    });
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dh/my-avatars/:id/thumbnail — 抽取 sample_video_url 首帧作为封面
//   公开端点（<video poster> 不能带 token），portrait id 是 uuid 不可枚举
router.get('/my-avatars/:id/thumbnail', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const ffmpegService = require('../services/ffmpegService');
    const p = db.getPortrait(req.params.id);
    if (!p) return res.status(404).end();
    const sample = p.sample_video_url || '';
    if (!sample) return res.status(204).end();
    // 优先用 portrait 自带的 image_url（已经是图）
    if (p.image_url && p.image_url.startsWith('/public/')) {
      const local = path.resolve(__dirname, '../..' + p.image_url);
      if (fs.existsSync(local)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return fs.createReadStream(local).pipe(res);
      }
    }
    // 找本地视频文件抽帧
    let localVideo = null;
    if (sample.includes('/public/jimeng-assets/')) {
      const name = path.basename(sample.split('?')[0]);
      const candidate = path.resolve(__dirname, '../../outputs/jimeng-assets', name);
      if (fs.existsSync(candidate)) localVideo = candidate;
    }
    if (!localVideo) return res.status(204).end();

    const thumbPath = localVideo.replace(/\.(mp4|mov|webm|mkv)$/i, '') + '.thumb.jpg';
    const send = () => {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      fs.createReadStream(thumbPath).pipe(res);
    };
    if (fs.existsSync(thumbPath)) return send();
    try {
      await ffmpegService.extractFirstFrame(localVideo, thumbPath, { atSec: 0.5, width: 480 });
      send();
    } catch (e) {
      console.warn('[DH/avatar-thumb] 抽帧失败:', e.message);
      res.status(204).end();
    }
  } catch (err) {
    console.warn('[DH/avatar-thumb] err:', err.message);
    res.status(500).end();
  }
});

// PATCH /api/dh/my-avatars/:id — 改名/附样片
router.patch('/my-avatars/:id', (req, res) => {
  const p = db.getPortrait(req.params.id);
  if (!p || p.kind !== 'digital_human' || !ownedBy(req, p)) {
    return res.status(404).json({ success: false, error: '形象不存在' });
  }
  const fields = {};
  ['name', 'gender', 'tags', 'description', 'sample_video_url',
   'sample_task_id', 'sample_status', 'sample_started_at'].forEach(k => {
    if (req.body?.[k] !== undefined) fields[k] = req.body[k];
  });
  // 当 sample_video_url 写入成功，自动清掉生成中标记
  if (req.body?.sample_video_url) {
    fields.sample_status = 'done';
    fields.sample_task_id = null;
  }
  db.updatePortrait(req.params.id, fields);
  res.json({ success: true });
});

// POST /api/dh/my-avatars/:id/promote-to-video
//   对已有图片素材（image-only）触发 Jimeng Omni 样片生成，完成后回写 sample_video_url
//   → 返回 { taskId }，前端用 /api/dh/samples/:taskId 轮询；完成后前端 PATCH /my-avatars/:id
router.post('/my-avatars/:id/promote-to-video', async (req, res) => {
  try {
    const p = db.getPortrait(req.params.id);
    if (!p || p.kind !== 'digital_human' || !ownedBy(req, p)) {
      return res.status(404).json({ success: false, error: '形象不存在' });
    }
    if (!p.image_url) return res.status(400).json({ success: false, error: '该形象缺少图片' });

    const base = _publicBaseUrl(req);
    const resp = await axios.post(`${base}/api/dh/samples/generate`, {
      image_url: p.image_url,
    }, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 30000,
    });
    if (!resp.data?.success) return res.status(500).json({ success: false, error: resp.data?.error || '提交失败' });
    res.json({ success: true, taskId: resp.data.taskId, avatar_id: req.params.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.response?.data?.error || err.message });
  }
});

// ═══════════════════════════════════════════════
// 双人 · AI 智能生成两位主持人（一次调 Seedream 两次，得 2 个形象并自动存库）
//   body: { gender_combo: 'mf'|'mm'|'ff', age: '青年'|'中年'|'老年', description, brand? }
// ═══════════════════════════════════════════════
router.post('/dual/generate-hosts', async (req, res) => {
  try {
    const { gender_combo = 'mf', age = '青年', description = '', brand = '' } = req.body || {};
    const genderMap = { mf: ['male', 'female'], mm: ['male', 'male'], ff: ['female', 'female'] };
    const [g1, g2] = genderMap[gender_combo] || genderMap.mf;
    const ageMap = { '青年': 'young adult', '中年': 'middle-aged', '老年': 'elderly with gentle wisdom' };
    const ageEn = ageMap[age] || 'young adult';

    const baseUrl = _publicBaseUrl(req);
    const makePrompt = (g) => {
      const gStr = g === 'male' ? `handsome ${ageEn} man` : `beautiful ${ageEn} woman`;
      return `professional podcast host, photograph of one single ${gStr}, sitting on a cozy warm-lit sofa in a modern home lounge — visible background: bookshelves, soft warm lighting, coffee mug on side table, blurred decor — confident friendly expression, smart casual clothing${brand ? `, subtle brand element: ${brand}` : ''}, ${description ? `. creative direction: ${description}` : ''}, DSLR 85mm f/2.0, magazine cover quality, waist-up, ABSOLUTELY ONE SINGLE PERSON, no duplicates, natural podcast-host look`;
    };

    // 并行生成 2 张
    const nameBase = (description || '主持人').slice(0, 12);
    const [p1, p2] = await Promise.all([
      avatarService._arkSeedreamGenerate({
        prompt: makePrompt(g1), aspectRatio: '9:16',
        filename: `dh_host1_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        watermark: false, cropBottomPx: 100, destDir: JIMENG_ASSETS_DIR,
      }),
      avatarService._arkSeedreamGenerate({
        prompt: makePrompt(g2), aspectRatio: '9:16',
        filename: `dh_host2_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        watermark: false, cropBottomPx: 100, destDir: JIMENG_ASSETS_DIR,
      }),
    ]);
    const img1Url = `${baseUrl}/public/jimeng-assets/${path.basename(p1)}`;
    const img2Url = `${baseUrl}/public/jimeng-assets/${path.basename(p2)}`;

    // 落库 2 个 portrait
    const makeRow = (name, imageUrl, gender) => {
      const id = uuidv4();
      const row = {
        id, user_id: req.user?.id || null, name, kind: 'digital_human',
        image_url: imageUrl, photo_url: imageUrl, sample_video_url: null,
        gender, style: 'podcast_host', tags: ['dual', 'host'],
        source: 'dual_generate', description, status: 'done', progress: 100, message: '已保存',
      };
      db.insertPortrait(row);
      return row;
    };

    const a = makeRow(`${nameBase}·A`, img1Url, g1);
    const b = makeRow(`${nameBase}·B`, img2Url, g2);
    res.json({ success: true, hostA: a, hostB: b });
  } catch (err) {
    console.error('[DH/dual/hosts] 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// 双人 · AI 辅助生成剧本（给定主题 + 两位主持人 → 输出 A:/B: 对白）
//   body: { topic, duration_sec?, style?, tone? }
// ═══════════════════════════════════════════════
router.post('/dual/write-script', async (req, res) => {
  try {
    const { topic, duration_sec = 60, style = 'podcast', tone = '轻松专业' } = req.body || {};
    if (!topic?.trim()) return res.status(400).json({ success: false, error: '请输入主题' });

    const targetChars = Math.round(duration_sec * 4);
    const { callLLM } = require('../services/storyService');
    const sys = `你是专业播客剧本撰写助手，为"双人对话数字人"写 A/B 两位主持人的对白。输出必须严格用以下格式（每行一句）：
A: xxx
B: xxx
A: xxx
...
不要输出任何其他说明/引号/标题。`;
    const user = `主题：${topic}
风格：${style === 'podcast' ? '播客访谈' : style}
语气：${tone}
目标时长：约 ${duration_sec} 秒（中文约 ${targetChars} 字）

要求：
1. 严格 A:/B: 交替，A 先开场
2. 每句 15-30 字（播客自然节奏）
3. 总字数 ${targetChars - 20} ~ ${targetChars + 20}
4. 结构：A 开场问候 → B 回应 → A 抛主题 → B 展开 → A 提问 → B 总结 → A 结尾
5. 不要加括号注释、表情、表演提示
6. 只输出 A:/B: 对白行，不要其他内容`;

    const text = await callLLM(sys, user, { kb: { scene: 'dual_podcast', query: topic.slice(0, 120), limit: 2 } });
    const cleaned = text.split(/\n/).filter(l => /^\s*[AB]\s*[:：]/.test(l)).join('\n');
    res.json({ success: true, script: cleaned, char_count: cleaned.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/dh/my-avatars/:id
router.delete('/my-avatars/:id', (req, res) => {
  const p = db.getPortrait(req.params.id);
  if (!p || p.kind !== 'digital_human' || !ownedBy(req, p)) {
    return res.status(404).json({ success: false, error: '形象不存在' });
  }
  db.deletePortrait(req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// Step 3 · POST /api/dh/scripts/write
//   body: { topic, duration_sec?, style?, tone? }
//   return: { text, duration_sec, char_count }
// —— 薄封装：复用 storyService.callLLM
// ═══════════════════════════════════════════════
function _normalizeScriptText(text, targetChars) {
  let out = String(text || '').trim();
  out = out.replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
  const maxChars = Math.max(10, Number(targetChars) + 6);
  if (out.length > maxChars) {
    const clipped = out.slice(0, maxChars);
    const cut = Math.max(
      clipped.lastIndexOf('。'),
      clipped.lastIndexOf('！'),
      clipped.lastIndexOf('？'),
      clipped.lastIndexOf('；')
    );
    out = (cut >= Number(targetChars) - 8 ? clipped.slice(0, cut + 1) : clipped).trim();
  }
  return out;
}

function _fallbackWriteScript({ topic, durationSec = 30, mode = 'script', product = null }) {
  const src = String(topic || '').replace(/\s+/g, ' ').trim();
  const name = product?.name || product?.image_name || '这款产品';
  if (mode === 'luxury_ad') {
    return `请做一条高定广告片，围绕${src || name}讲一个完整的产品宣传故事。开场用高级空间或品牌氛围建立第一印象，中段用镜头推进到产品材质、工艺细节、使用场景和核心卖点，画面要像品牌广告，不要像数字人站桩讲解。最后收束到品牌记忆点和咨询引导，整体节奏克制、有质感，适合直接生成分镜和关键画面。`;
  }
  if (mode === 'product' && product?.name) {
    const points = product?.selling_points || '设计细节、使用体验和日常实用性';
    const offer = product?.offer || '现在就可以了解详情';
    return `你是不是也想找一款真正顺手的${name}？它的重点不是夸张参数，而是把${points}这些体验做得更稳。日常使用时，你能很快感受到它的便利和质感。想要少踩坑、直接选到合适的，可以重点看看这款${name}。${offer}。`;
  }
  if (mode === 'space') {
    return `大家现在看到的是${src || '这个广告展示场景'}。第一眼先看整体空间，它的结构很清晰，视觉重点也很集中。接下来可以把目光放到材质和细节上，表面的层次、光线的变化，会让产品质感更直观。这样的展示方式适合门店、展厅和品牌空间使用，既能讲清卖点，也能让客户更快形成记忆点。如果你也想做类似效果，可以先从场景、材质和预算三个方向开始沟通。`;
  }
  return `今天想和大家聊聊${src || '这个主题'}。很多人一开始只看到表面，但真正影响结果的，是细节和执行方式。先把核心需求想清楚，再选择合适的方法，效率会高很多。接下来你可以按照这个思路去判断：它解决什么问题，适合什么场景，最后能带来什么变化。这样做，决策会更稳，也更容易看到效果。`;
}

function _fallbackSegmentText(text, targetDuration) {
  const src = String(text || '').replace(/\s+/g, '').trim();
  const pieces = (src.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [src])
    .map(s => s.trim())
    .filter(s => s.length > 4);
  const chunks = [];
  let buf = '';
  for (const p of pieces) {
    if (!buf || (buf + p).length <= 32) buf += p;
    else { chunks.push(buf); buf = p; }
  }
  if (buf) chunks.push(buf);
  const list = (chunks.length ? chunks : [src]).slice(0, Math.max(1, Math.min(8, Math.ceil(Number(targetDuration) / 4))));
  const tones = ['curious', 'confident', 'warm', 'encouraging', 'firm', 'encouraging'];
  const expressions = ['friendly', 'confident', 'smile', 'focused', 'confident', 'smile'];
  const motions = ['natural speaking with subtle head movement', 'open-palm gesture toward the display area', 'pointing gently at key details', 'confident summary gesture', 'clear call-to-action gesture'];
  return list.map((segText, i) => ({
    text: segText,
    expression: expressions[i] || 'friendly',
    tone: tones[i] || 'warm',
    motion: motions[i % motions.length],
    camera: i === 0 ? 'push_in' : i === list.length - 1 ? 'static' : 'pan_product',
  }));
}

router.post('/scripts/write', async (req, res) => {
  try {
    const { topic, duration_sec = 30, style = 'tutorial', tone = '亲切自然', mode = 'script', product = null } = req.body || {};
    if (!topic?.trim()) return res.status(400).json({ success: false, error: '请输入主题' });

    const targetChars = Math.round(duration_sec * 4);  // 中文约 4 字/秒
    const { callLLM } = require('../services/storyService');

    const styleHint = {
      tutorial: '教程讲解（问题 → 方法 → 效果）',
      promo:    '产品推广（痛点 → 亮点 → 行动号召）',
      story:    '故事叙述（悬念 → 发展 → 感悟）',
      knowledge:'知识分享（好奇 → 知识 → 建议）',
      news:     '新闻播报（导入 → 事件 → 观点）',
      daily:    '日常分享（自然口语）',
    }[style] || '口播自然风格';

    const isLuxuryAd = mode === 'luxury_ad';
    const isProduct = mode === 'product' && product?.name;
    const isSpace = mode === 'space';
    const sysPrompt = isLuxuryAd
      ? `你是高定品牌广告片策划。输出内容必须是一段可直接进入分镜生成的广告需求/脚本，不是口播稿，不要写镜头编号。`
      : isProduct
      ? `你是专业电商商品数字人口播策划。输出内容必须可直接被 TTS 朗读，适合真人数字人边展示商品边讲解。`
      : isSpace
        ? `你是专业空间导览数字人口播策划。输出内容必须可直接被 TTS 朗读，像真实导览员一样有停顿、强调和情绪起伏。`
        : `你是专业的短视频口播稿撰写助手。输出内容必须可直接被 TTS 朗读。`;
    const userPrompt = isLuxuryAd ? `用户提供的信息：${topic}
广告类型：${style || 'auto'}
语气/质感：${tone || '高端、克制、有品牌感'}
目标时长：约 ${duration_sec} 秒

要求：
1. 输出一段可直接放入“高定广告片”输入框的广告需求/脚本，只输出正文，不要标题、编号、解释
2. 不是数字人口播稿，不要写“大家好/大家现在看到的是”，要像品牌广告策划
3. 必须包含：广告目标、产品/品牌核心卖点、目标受众、画面风格、镜头故事推进、结尾行动引导
4. 如果用户只给一句话，要主动补全合理的广告故事，但不要虚构具体价格、资质、医疗/金融承诺
5. 字数控制在 120-220 字，适合后续拆成 4-6 个分镜`
      : isProduct ? `商品名称：${product.name}
商品场景/口播重点：${topic}
目标人群：${product.audience || '未指定'}
核心卖点：${product.selling_points || '未指定'}
优惠/行动号召：${product.offer || '未指定'}
展示动作偏好：${product.motion_style || 'hold'}
已融合商品：${product.image_url ? `来自商品数字人形象（${product.image_name || product.name || '商品'}），无需再次上传商品素材` : '未提供'}
目标时长：约 ${duration_sec} 秒（中文约 ${targetChars} 字）

要求：
1. 输出一段连贯电商口播稿，只输出正文，不要标题/编号/括号注释
2. 结构必须是：3 秒痛点钩子 → 商品亮点 → 使用场景/信任理由 → 行动号召
3. 必须自然提到商品名和核心卖点，不要夸大医疗、金融、绝对化效果
4. 句子短促易读，适合数字人边手持/指向/展示已融合商品边说；不要把商品当作额外浮层素材或商品卡片
5. 字数控制在 ${targetChars - 10} ~ ${targetChars + 10} 之间`
      : isSpace ? `空间/场景信息：${topic}
语气：${tone}
目标时长：约 ${duration_sec} 秒（中文约 ${targetChars} 字）

要求：
1. 输出一段连贯空间导览口播稿，只输出正文，不要标题、编号、括号注释
2. 结构必须是：开场引入 → 讲空间/材质/灯光亮点 → 引导观众看右侧展示区 → 收束一句记忆点
3. 根据输入自行判断场景，不要局限在展厅/门店/样板间几个固定类型
4. 句子要短，适合后续拆分；每 1-2 句就有一个自然停顿，语气要有起伏，不要全程平铺直叙
5. 字数控制在 ${targetChars - 10} ~ ${targetChars + 10} 之间`
      : `主题：${topic}
风格：${styleHint}
语气：${tone}
目标时长：约 ${duration_sec} 秒（中文约 ${targetChars} 字）

要求：
1. 输出一段连贯口播稿，只输出正文，不要加引号/标题/"以下是"等说明
2. 字数控制在 ${targetChars - 10} ~ ${targetChars + 10} 之间
3. 句子短促易读，多用标点分割呼吸节点
4. 不要包含数字人无法读出的内容（括号注释、表情符号等）`;

    let usedFallback = false;
    let text = '';
    try {
      text = (await callLLM(sysPrompt, userPrompt, {
        kb: { scene: 'avatar_script', query: topic.slice(0, 120), limit: 2 },
      })).trim();
    } catch (llmErr) {
      usedFallback = true;
      console.warn('[DH/scripts/write] LLM failed, using local fallback:', llmErr.message);
      text = _fallbackWriteScript({ topic, durationSec: duration_sec, mode, product });
    }
    text = isLuxuryAd
      ? String(text || '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\n{3,}/g, '\n\n')
      : _normalizeScriptText(text, targetChars);
    const maxChars = isLuxuryAd ? 360 : Math.max(10, targetChars + 6);
    if (text.length > maxChars) {
      const clipped = text.slice(0, maxChars);
      const cut = Math.max(
        clipped.lastIndexOf('。'),
        clipped.lastIndexOf('！'),
        clipped.lastIndexOf('？'),
        clipped.lastIndexOf('，')
      );
      text = (cut >= targetChars - 8 ? clipped.slice(0, cut + 1) : clipped).trim();
    }

    res.json({
      success: true,
      text,
      duration_sec,
      char_count: text.length,
      fallback: usedFallback,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Step 3 · POST /api/dh/scripts/segment
//   body: { text }
//   return: { segments: [{text, start, end, expression, motion, char_count}] }
// —— 直接转发到 /api/avatar/segment-script 逻辑，加上 start/end 时间戳
// ═══════════════════════════════════════════════
router.post('/scripts/segment', async (req, res) => {
  try {
    const { text, target_duration_sec = null } = req.body || {};
    if (!text || text.trim().length < 10) {
      return res.status(400).json({ success: false, error: '文本过短' });
    }

    const targetDuration = Math.max(5, Math.min(180, Math.round(Number(target_duration_sec) || Math.ceil(text.trim().length / 4))));
    const { callLLM } = require('../services/storyService');
    const sysPrompt = `你是专业视频口播分段师。按自然语义/呼吸节点拆分，总时长必须严格等于 ${targetDuration} 秒。
输出严格 JSON 数组，每项：{"text":"...","expression":"natural|smile|serious|excited|calm|thoughtful|surprised|concerned|confident|friendly|focused|moved","tone":"natural|calm|serious|excited|encouraging|warm|firm|curious|confident|gentle|urgent|humorous","motion":"英文动作描述","camera":"static|push_in|pull_back|pan_product|close_up|handheld"}
不要输出其他任何内容。`;
    const userPrompt = `台词：\n${text}\n\n目标总时长：${targetDuration} 秒。请按语义拆成适合 ${targetDuration} 秒内讲完的段落，直接输出 JSON 数组。`;
    let out = '';
    let segmentFallback = false;
    try {
      out = await callLLM(sysPrompt, userPrompt);
    } catch (llmErr) {
      segmentFallback = true;
      console.warn('[DH/scripts/segment] LLM failed, using local fallback:', llmErr.message);
    }

    let raw;
    try {
      const m = out.match(/\[[\s\S]*\]/);
      raw = JSON.parse(m ? m[0] : out);
    } catch {
      raw = _fallbackSegmentText(text, targetDuration);
    }
    if (segmentFallback) raw = _fallbackSegmentText(text, targetDuration);
    raw = (Array.isArray(raw) ? raw : []).filter(seg => seg && String(seg.text || '').trim()).map(seg => ({ ...seg, text: String(seg.text || '').trim() }));
    if (!raw.length) raw = [{ text: text.trim(), expression: 'natural', tone: 'natural', motion: 'natural speaking' }];
    if (raw.length > targetDuration) {
      const merged = raw.slice(0, targetDuration).map(x => ({ ...x }));
      for (let i = targetDuration; i < raw.length; i++) {
        merged[merged.length - 1].text += raw[i].text;
      }
      raw = merged;
    }

    // 加时间戳：严格按目标总时长分配，最终 end 必须等于 targetDuration。
    let cursor = 0;
    const totalChars = raw.reduce((sum, seg) => sum + Math.max(1, (seg.text || '').length), 0) || 1;
    const segments = raw.map((seg, i) => {
      const chars = (seg.text || '').length;
      let dur = i === raw.length - 1 ? (targetDuration - cursor) : Math.max(1, Math.round(targetDuration * (Math.max(1, chars) / totalChars)));
      const remainingSlots = Math.max(0, raw.length - i - 1);
      dur = Math.max(1, Math.min(dur, targetDuration - cursor - remainingSlots));
      const s = cursor;
      cursor += dur;
      return {
        index: i,
        text: seg.text,
        expression: seg.expression || 'natural',
        tone: seg.tone || seg.delivery || seg.voice_tone || 'natural',
        motion: seg.motion || 'natural speaking',
        camera: seg.camera || 'static',
        start: s,
        end: cursor,
        char_count: chars,
      };
    });

    res.json({
      success: true,
      segments,
      total_duration: targetDuration,
      target_duration: targetDuration,
      total_chars: text.length,
      fallback: segmentFallback,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function _fallbackLuxuryAdStoryboard({ text = '', durationSec = 30, shotCount = 5, productName = '主商品', assetSummary = '' }) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  const total = Math.max(3, Math.min(8, Number(shotCount) || _suggestLuxuryAdShotCount({ text: source, durationSec, assetSummary }) || 5));
  const baseDur = Math.max(2, Math.round(((Number(durationSec) || 30) / total) * 10) / 10);
  const core = source || `围绕${productName}做一条高定广告片，突出产品质感、核心卖点、使用场景和品牌记忆点。`;
  const names = ['开场分镜', '第二场景', '细节分镜', '场景转折', '卖点分镜', '收尾分镜'];
  const roles = ['hook', 'display', 'macro', 'benefit', 'proof', 'cta'];
  const shotSizes = ['微观全景 / 固定镜头', '中远景 / 缓慢前进', '极近景 / 微距平移', '中景 / 场景切换', '特写 / 轻微环绕', '品牌收尾 / 固定镜头'];
  const isMaterial = /钢|金属|板材|建材|材料|材质|墙|石材|木饰面|岩板|瓷砖/i.test(productName);
  const visualByRole = {
    hook: isMaterial
      ? `纯净深色背景或高端空间中，${productName}被一束侧光缓慢带出，表面纹理先被看见，再过渡到下一镜头。`
      : `干净背景中，${productName}以克制光线缓慢出现，先建立品牌第一印象，再过渡到完整展示。`,
    display: isMaterial
      ? `中远景缓慢推进到${productName}完整应用画面，顶部灯光扫过表面，建立空间高级感和产品第一印象。`
      : `中远景缓慢推进到${productName}完整形态，主体位于画面中心，环境只服务于产品识别。`,
    macro: isMaterial
      ? `极近景贴近材质表面横向平移，纹理、边缘、反光和工艺细节被逐层放大。`
      : `极近景贴近产品细节和关键结构，光线沿边缘移动，强调质感、做工和核心卖点。`,
    benefit: isMaterial
      ? `切入真实会所、展厅或设计空间，${productName}作为空间视觉中心，与灯光、墙面和陈设自然融合。`
      : `切入真实使用场景，${productName}解决需求的瞬间被看见，画面保持高级、真实和克制。`,
    proof: isMaterial
      ? `轻微环绕或移焦强调核心卖点，让观众看到材质差异、定制质感和经得起近看的细节。`
      : `用特写或轻微环绕强化一个可记忆卖点，让观众看见选择它的理由。`,
    cta: `固定收尾镜头留出字幕和行动引导空间，${productName}与品牌记忆点清晰停留。`,
  };
  return Array.from({ length: total }, (_, i) => {
    const role = roles[i] || (i === total - 1 ? 'cta' : 'benefit');
    const voiceover = _fallbackLuxuryAdCopy({ role, productSubject: productName });
    const visual = visualByRole[role] || visualByRole.display;
    const camera = i === 0 ? 'slow_push_in' : i === 2 ? 'macro_push' : i === total - 1 ? 'hold' : 'smooth_slide';
    const transition = i === 0 ? '溶化转场进入下一镜' : (i === total - 1 ? '固定停留收束品牌记忆' : '顺接下一镜');
    const lightingStyle = isMaterial ? '侧逆光强化纹理和反光' : '柔和商业光突出主体识别';
    const materialUsage = i === 0 ? '@主商品' : `@主商品 + @参考${i + 1}`;
    const styleNote = `风格：${isMaterial ? '商业材料广告，高级、克制、重视光影和材质' : '品牌产品广告，高级、真实、重视主体识别'}；光线：${lightingStyle}；转场：${transition}。`;
    return {
      index: i,
      title: names[i] || _luxurySceneStageName(role, i, total),
      role,
      story_stage: names[i] || _luxurySceneStageName(role, i, total),
      shot_size: shotSizes[i] || '中景 / 平滑运动',
      shot_angle: shotSizes[i] || '中景 / 平滑运动',
      objective: [
      `建立${productName}的第一场景和第一印象`,
      `切到第二场景，让主商品或服务关系更清楚`,
      '展示材质、工艺和细节',
      '进入真实场景或转折，说明使用关系',
      '强化一个可记忆卖点或可信理由',
      '收束品牌记忆点和行动引导',
      ][i] || '推进下一段广告场景',
      duration: baseDur,
      start: i * baseDur,
      end: i === total - 1 ? Number(durationSec) || baseDur * total : (i + 1) * baseDur,
      material_usage: materialUsage,
      content_prompt: visual,
      narration: voiceover,
      ad_copy: voiceover,
      style_note: styleNote,
      other: styleNote,
      lighting_style: lightingStyle,
      transition,
      text: voiceover,
      voiceover,
      subtitle: voiceover,
      scene_content: visual,
      visual,
      display_visual: visual,
      visual_prompt: [
      'Premium product advertising keyframe, exact uploaded product as the hero subject.',
      'Use uploaded product/reference images as visual anchors; no text overlay; no watermark.',
      i === 0 ? 'Elegant opening atmosphere, product centered or revealed with controlled lighting.' : '',
      i === 2 ? 'Macro texture/detail close-up, premium material and craft emphasis.' : '',
      i === total - 1 ? 'Clean end-card composition with negative space for subtitles and call to action.' : '',
      ].filter(Boolean).join(' '),
      video_prompt: [
      'Image-to-video commercial shot, preserve product identity and reference composition.',
      i === 0 ? 'Slow push-in reveal.' : i === total - 1 ? 'Elegant slow hold and settle.' : 'Subtle camera slide or focus shift.',
      'No morphing, no scene replacement, no extra people unless a person reference is selected.',
      ].join(' '),
      camera,
      camera_label: _luxuryCameraLabel(camera),
      reference_index: i + 1,
      reference_label: `@参考${i + 1}`,
      reference_mentions: ['@主商品', `@参考${i + 1}`],
      topview_prompt: `使用 @主商品 和 @参考${i + 1} 生成这一镜头：${visual} 镜头运动：${_luxuryCameraLabel(camera)}。保持主商品身份、材质和构图稳定，不生成画面文字。`,
      tone: 'premium',
      expression: 'calm',
      motion: 'premium product camera movement',
      material_hint: materialUsage,
      source_text: core,
    };
  });
}

function _suggestLuxuryAdShotCount({ text = '', durationSec = 30, assetSummary = '' } = {}) {
  const seconds = Math.max(12, Math.min(90, Math.round(Number(durationSec) || 30)));
  let count = seconds <= 18 ? 3 : seconds <= 26 ? 4 : seconds <= 38 ? 5 : seconds <= 52 ? 6 : 7;
  const source = [text, assetSummary].filter(Boolean).join('\n');
  const punctuation = (source.match(/[，。；;、\n]/g) || []).length;
  const keywords = ['开场', '产品', '品牌', '卖点', '痛点', '材质', '工艺', '细节', '场景', '人物', '近景', '远景', '转场', '最后', '引导']
    .filter(k => source.includes(k)).length;
  if (punctuation >= 7 || keywords >= 7) count += 1;
  if (punctuation <= 1 && keywords <= 2 && seconds <= 20) count -= 1;
  return Math.max(3, Math.min(8, count));
}

function _isWeakLuxuryProductName(value = '') {
  const s = String(value || '').trim();
  if (!s) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(s)
    || /^微信图片[_\-\d]/.test(s)
    || /^主商品$|^商品图$|^产品图$/i.test(s)
    || /^(高定广告片|广告片|广告数字人|普通广告数字人|由广告设想识别|上传主商品)$/i.test(s);
}

function _deriveLuxuryProductSubject({ text = '', productName = '', assetSummary = '' } = {}) {
  const namedProduct = String(productName || '').replace(/\s+/g, ' ').trim();
  if (namedProduct && !_isWeakLuxuryProductName(namedProduct)) return namedProduct.slice(0, 40);
  const joined = [text, productName, assetSummary].filter(Boolean).join('\n');
  const explicit = [
    /(?:卖点[\/／]?资料|卖点资料)[:：]\s*([^\n，。；;]{2,40})/i,
    /(?:产品\/品牌|产品品牌|产品名称|产品|品牌|主商品|商品)[:：]\s*([^\n，。；;]{2,40})/i,
    /(?:围绕|关于|做一条|做一个|介绍)([^，。；;\n]{2,40}?)(?:广告|宣传|产品|效果|卖点|视频|片)/i,
    /([^，。；;\n]{2,30}?)(?:成品站|展示站|产品站|效果广告|宣传广告)/i,
  ];
  for (const re of explicit) {
    const m = joined.match(re);
    const v = String(m?.[1] || '')
      .replace(/^(一个|一条|这个|该|的)+/, '')
      .replace(/(?:卖点[\/／]?资料|目标客户|画面风格|广告需求).*$/i, '')
      .trim();
    if (v && !_isWeakLuxuryProductName(v)) return v.slice(0, 40);
  }
  const keywordMap = [
    { re: /成品钢材|钢材成品|钢材|钢板|不锈钢|金属板|金属肌理|金属材料|型材|板材|建材/i, value: '钢材/金属材料' },
    { re: /木饰面|木墙|木材|木纹|护墙板/i, value: '木饰面/木作材料' },
    { re: /石材|岩板|大理石|瓷砖/i, value: '石材/岩板材料' },
    { re: /艺术墙|背景墙|墙面|展墙/i, value: '定制墙面材料' },
    { re: /家具|沙发|椅|桌|柜/i, value: '高端家具' },
  ];
  const hit = keywordMap.find(x => x.re.test(joined));
  if (hit) return hit.value;
  return _isWeakLuxuryProductName(productName) ? '上传主商品' : String(productName || '上传主商品').trim().slice(0, 40);
}

function _luxuryProductLockPrompt(productSubject = '') {
  const subject = String(productSubject || 'uploaded main product').trim();
  const steelLock = /钢|金属|板材|建材|材料|材质/i.test(subject)
    ? 'For steel/metal/material products: use steel sheets, metal panels, material surfaces, architectural installation, showroom wall panels, edge details, brushed texture and reflected light as the hero subject. Do not turn the material into a bottle, jar, tube, perfume, skincare, cosmetics or beverage packaging.'
    : '';
  return [
    `PRODUCT SUBJECT LOCK: the advertised product category is "${subject}".`,
    'The hero subject must stay in this product category and must be visually derived from reference image 1.',
    'Do not invent a different product category, unrelated packaged goods, cosmetics, perfume bottles, skincare bottles, beverage bottles, phones, watches, jewelry or random retail props.',
    'If the uploaded main product is a material, surface, panel, wall, showroom sample or texture reference, treat that material/display as the product itself instead of placing unrelated consumer goods on it.',
    steelLock,
  ].filter(Boolean).join(' ');
}

function _luxuryRoleAt(index = 0, total = 5, role = '') {
  const r = String(role || '').toLowerCase();
  if (['hook', 'display', 'macro', 'benefit', 'proof', 'cta'].includes(r)) return r;
  if (index === 0) return 'hook';
  if (index === 1) return 'display';
  if (index === 2) return 'macro';
  if (index >= total - 1) return 'cta';
  return index === total - 2 ? 'proof' : 'benefit';
}

function _luxurySceneStageName(role = '', index = 0, total = 5) {
  const r = String(role || '').toLowerCase();
  if (index === 0 || r === 'hook') return '开场分镜';
  if (index >= total - 1 || r === 'cta') return '收尾分镜';
  return ({
    display: '第二场景',
    macro: '细节分镜',
    benefit: '场景转折',
    proof: '卖点分镜',
    atmosphere: '氛围分镜',
    endcard: '片尾分镜',
  })[r] || `第${index + 1}场景`;
}

function _normalizeLuxurySceneStage(value = '', role = '', index = 0, total = 5) {
  const raw = String(value || '').replace(/\s+/g, '').trim();
  if (!raw) return _luxurySceneStageName(role, index, total);
  if (/钩子|亮相|卖点讲解|卖点强化|品牌收束|行动引导|场景亮点|广告阶段|产品展示/.test(raw)) {
    return _luxurySceneStageName(role, index, total);
  }
  if (raw === '第二分镜') return '第二场景';
  if (/^第\d+镜头$/.test(raw)) return _luxurySceneStageName(role, index, total);
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

function _fallbackLuxuryAdCopy({ role = '', productSubject = '主商品' } = {}) {
  const name = String(productSubject || '主商品').replace(/\s+/g, '').slice(0, 12) || '主商品';
  const isMaterial = /钢|金属|板材|建材|材料|墙|石材|木饰面|岩板|瓷砖/i.test(name);
  const copy = isMaterial ? {
    hook: '一眼看见材质的高级感',
    display: '让材料成为空间主角',
    macro: '纹理在光影里更清晰',
    benefit: '高级空间，需要高级材质',
    proof: '细节经得起近看',
    cta: '定制方案，现在咨询',
  } : {
    hook: `${name}，第一眼就被记住`,
    display: '主角登场，价值一眼看清',
    macro: '细节被放大，质感被看见',
    benefit: '真实场景里，更懂需求',
    proof: '每一处细节，都是选择理由',
    cta: '现在咨询，了解更多方案',
  };
  return copy[_luxuryRoleAt(0, 1, role)] || copy.display;
}

function _fallbackLuxuryAdVisual({ role = '', productSubject = '主商品' } = {}) {
  const name = String(productSubject || '主商品').trim() || '主商品';
  const isMaterial = /钢|金属|板材|建材|材料|材质|墙|石材|木饰面|岩板|瓷砖/i.test(name);
  const visual = isMaterial ? {
    hook: `纯净深色背景或高端空间中，${name}被一束侧光缓慢带出，表面纹理先被看见，再过渡到下一镜头。`,
    display: `中远景缓慢推进到${name}完整应用画面，顶部灯光扫过表面，建立空间高级感和产品第一印象。`,
    macro: '极近景贴近材质表面横向平移，纹理、边缘、反光和工艺细节被逐层放大。',
    benefit: `切入真实会所、展厅或设计空间，${name}作为空间视觉中心，与灯光、墙面和陈设自然融合。`,
    proof: '轻微环绕或移焦强调核心卖点，让观众看到材质差异、定制质感和经得起近看的细节。',
    cta: `固定收尾镜头留出字幕和行动引导空间，${name}与品牌记忆点清晰停留。`,
  } : {
    hook: `干净背景中，${name}以克制光线缓慢出现，先建立品牌第一印象，再过渡到完整展示。`,
    display: `中远景缓慢推进到${name}完整形态，主体位于画面中心，环境只服务于产品识别。`,
    macro: '极近景贴近产品细节和关键结构，光线沿边缘移动，强调质感、做工和核心卖点。',
    benefit: `切入真实使用场景，${name}解决需求的瞬间被看见，画面保持高级、真实和克制。`,
    proof: '用特写或轻微环绕强化一个可记忆卖点，让观众看见选择它的理由。',
    cta: `固定收尾镜头留出字幕和行动引导空间，${name}与品牌记忆点清晰停留。`,
  };
  return visual[_luxuryRoleAt(0, 1, role)] || visual.display;
}

function _stripLuxuryBriefNoise(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^(旁白|字幕|画面|视觉|镜头|广告词|文案|voiceover|visual)[:：]\s*/i, '')
    .replace(/^(?:产品\/品牌|卖点[\/／]?资料|卖点|目标客户|画面风格|广告需求|用户需求)[:：]\s*/i, '')
    .replace(/微信图片[_\-\d]+\.(png|jpe?g|webp|gif)/ig, '')
    .trim();
}

function _looksLikeLuxuryBrief(value = '') {
  const s = String(value || '').trim();
  if (!s) return true;
  return s.length > 70
    || /(请做|帮我|我想|我要|需求|广告需求|卖点[\/／]?资料|目标客户|画面风格|产品\/品牌|不要像|最后引导|完整的产品宣传故事|按广告需求|按广告内容|参考素材摘要|第一眼看|我要一个|我需要)/.test(s)
    || /(主产品|镜头参考)\s*\d+\s*[:：]/.test(s)
    || /\.(png|jpe?g|webp|gif)/i.test(s);
}

function _cleanLuxuryAdCopy(value = '', fallbackOpts = {}) {
  const s = _stripLuxuryBriefNoise(value)
    .replace(/[。；;，,]\s*$/g, '')
    .trim();
  if (_looksLikeLuxuryBrief(s)) return _fallbackLuxuryAdCopy(fallbackOpts);
  return s.slice(0, 34);
}

function _cleanLuxuryAdVisual(value = '', fallbackOpts = {}) {
  const s = _stripLuxuryBriefNoise(value).trim();
  if (!s
    || _looksLikeLuxuryBrief(s)
    || /^(按|根据).*(生成|推进)/.test(s)
    || /主商品作为视觉中心|主商品占据画面中心|建立高端广告氛围|突出高级感|突出空间搭配效果|按广告需求|按广告内容/.test(s)) {
    return _fallbackLuxuryAdVisual(fallbackOpts);
  }
  return s.length > 90 ? `${s.slice(0, 88)}…` : s;
}

function _luxuryCameraLabel(value = '') {
  const s = String(value || '').toLowerCase().replace(/\s+/g, '_');
  if (s.includes('macro')) return '微距推进';
  if (s.includes('focus')) return '焦点转移';
  if (s.includes('slide') || s.includes('pan')) return '平滑横移';
  if (s.includes('push')) return '缓慢推进';
  if (s.includes('hold') || s.includes('static')) return '稳定停留';
  return '高级产品镜头运动';
}

router.post('/luxury-ad/shot-rewrite', async (req, res) => {
  try {
    const {
      instruction = '',
      brief = '',
      segment = {},
      index = 0,
      total = 1,
      duration_sec = 30,
      product_name = '',
      asset_summary = '',
      output_ratio = '9:16',
      product_asset = null,
      reference_assets = [],
      person_asset = null,
    } = req.body || {};
    const userInstruction = String(instruction || '').trim();
    if (userInstruction.length < 4) {
      return res.status(400).json({ success: false, error: '请先写清楚希望 AI 怎么修改这一镜头' });
    }
    const shotIndex = Math.max(0, Math.round(Number(index) || 0));
    const totalShots = Math.max(1, Math.min(8, Math.round(Number(total) || 1)));
    const targetDuration = Math.max(12, Math.min(90, Math.round(Number(duration_sec) || 30)));
    const productSubject = _deriveLuxuryProductSubject({ text: brief, productName: product_name, assetSummary: asset_summary });
    const productLockPrompt = _luxuryProductLockPrompt(productSubject);
    const role = _luxuryRoleAt(shotIndex, totalShots, segment.role || segment.shot_role || segment.type || '');
    const currentShot = {
      title: segment.title || `镜头 ${shotIndex + 1}`,
      role,
      story_stage: segment.story_stage || '',
      shot_size: segment.shot_size || segment.shot_angle || '',
      objective: segment.objective || segment.intent || segment.purpose || '',
      duration: segment.duration || Math.max(2, Math.round(targetDuration / totalShots)),
      material_usage: segment.material_usage || segment.material_hint || '',
      content_prompt: segment.content_prompt || segment.scene_content || segment.visual || '',
      voiceover: segment.voiceover || segment.narration || segment.ad_copy || segment.subtitle || '',
      camera: segment.camera || segment.camera_label || segment.motion || '',
      style_note: segment.style_note || segment.other || '',
      topview_prompt: segment.topview_prompt || segment.reference_prompt || '',
      reference_index: segment.reference_index || 0,
    };
    const assetNotes = [
      product_asset && (product_asset.name || product_asset.url) ? `主商品：${product_asset.name || product_asset.url}` : '',
      ...(Array.isArray(reference_assets) ? reference_assets.map(x => x && (x.name || x.url) ? `分镜画面${x.index || ''}：${x.name || x.url}` : '') : []),
      person_asset && (person_asset.name || person_asset.id) ? `人物参考：${person_asset.name || person_asset.id}` : '',
    ].filter(Boolean).join('；') || asset_summary || '暂无素材摘要';
    const { callLLM } = require('../services/storyService');
    const sys = [
      '你是一个高定广告片专业小组：品牌策略/编剧、商业摄影指导、AI 视觉提示词专家。',
      '你只修改用户指定的一个镜头，必须输出 JSON object，不要输出解释。',
      '输出要有广告片质感：具体画面、具体镜头语言、具体观众文案，避免“便捷、高效、效率倍增、智能集成、创作只需片刻”等泛泛营销套话，除非用户明确要求这种口径。',
      '这个镜头要服务完整广告顺序，不是普通数字人口播。'
    ].join(' ');
    const user = `广告 brief：
${String(brief || '').slice(0, 1200)}

主商品：${productSubject}
画面比例：${output_ratio}
当前镜头序号：${shotIndex + 1}/${totalShots}
当前镜头数据：
${JSON.stringify(currentShot, null, 2)}

可用素材：
${assetNotes}

用户希望 AI 修改成：
${userInstruction}

请根据用户要求，重写这一镜头的输出内容。必须返回 JSON object，字段如下：
{
  "title": "镜头名称，6 字以内",
  "role": "hook|display|macro|benefit|proof|cta",
  "story_stage": "场景顺序中文名，例如：开场分镜、第二场景、细节分镜、场景转折、卖点分镜、收尾分镜",
  "shot_size": "拍摄角度及镜头（景别），例如：中远景 / 缓慢前推",
  "shot_angle": "同 shot_size，可更完整",
  "objective": "这一段场景在广告故事里要讲什么、起什么作用",
  "duration": 2-12,
  "material_usage": "这一镜使用什么画面素材，例如 @主商品 + @分镜画面1",
  "content_prompt": "镜头内容提示词：写画面、主体、背景、镜头运动和过场，不写广告词",
  "scene_content": "镜头画面说明，只描述看见什么和怎么运动",
  "visual": "镜头画面说明短句",
  "voiceover": "成片旁白/字幕广告词：真正会出现在成片里或朗读出来的话，不是镜头说明或提示词",
  "narration": "同 voiceover",
  "ad_copy": "同 voiceover",
  "style_note": "其他栏内容，包含：风格、光线、转场；旁白请主要放到 voiceover",
  "lighting_style": "光线和画面风格",
  "transition": "过场方式",
  "camera": "slow_push_in|smooth_slide|macro_push|focus_shift|hold",
  "camera_label": "中文镜头运动说明",
  "motion": "中文镜头运动说明",
  "topview_prompt": "Topview 式提示词，说明使用 @主商品/@分镜画面，保持商品身份稳定，无画面文字"
}

硬性规则：
- ${productLockPrompt}
- 先按“编剧”确定这一镜在整条片里的戏剧作用，再按“摄影指导”写景别、光线、焦段、运动和转场，最后按“提示词专家”把镜头意图写成可执行的模型提示词。
- 广告词必须像成片上真实出现的短句，克制、具体、有品牌感；禁止空泛套话：便捷、高效、效率倍增、智能集成、只需片刻、告别繁琐，除非用户原始需求就是这类表达。
- 不要把主商品改成化妆品、香水瓶、护肤品瓶、饮料瓶、手机或其他无关商品。
- content_prompt/scene_content/visual 是镜头画面说明，不是旁白。
- voiceover/narration/ad_copy 是最终给观众听到或看到的广告词/字幕，不能写“我想要、帮我、广告需求、目标客户、画面风格、最后引导”等需求描述，也不能写成镜头提示词。
- 如果用户要求更换表达、角度、场景、情绪或卖点，要同时改镜头、提示词、广告词和 Topview 提示词。
- 不要生成价格、资质、疗效、承诺、虚假品牌信息。`;
    const out = await callLLM(sys, user, {
      kb: { scene: 'luxury_ad', query: `${productSubject} ${brief} ${userInstruction}`.slice(0, 180), limit: 3, maxCharsPerDoc: 450 },
    });
    const x = _cleanJsonObject(out);
    const nextRole = String(x.role || role || 'display').trim();
    const voiceover = _cleanLuxuryAdCopy(x.narration || x.voiceover || x.ad_copy || x.subtitle || '', { role: nextRole, productSubject });
    const visual = _cleanLuxuryAdVisual(x.content_prompt || x.scene_content || x.visual || '', { role: nextRole, productSubject });
    const camera = String(x.camera || x.camera_label || x.motion || currentShot.camera || 'smooth_slide').trim();
    const duration = Math.max(2, Math.min(12, Math.round((Number(x.duration) || Number(currentShot.duration) || 6) * 10) / 10));
    const styleNote = String(x.style_note || x.other || '').trim()
      || `风格：${x.lighting_style || '克制高级'}；转场：${x.transition || '顺接下一镜'}。`;
    res.json({
      success: true,
      segment: {
        ...segment,
        title: String(x.title || currentShot.title || `镜头 ${shotIndex + 1}`).slice(0, 24),
        role: nextRole,
        story_stage: _normalizeLuxurySceneStage(x.story_stage, nextRole, shotIndex, totalShots),
        shot_size: String(x.shot_size || x.shot_angle || currentShot.shot_size || '').trim(),
        shot_angle: String(x.shot_angle || x.shot_size || currentShot.shot_size || '').trim(),
        objective: String(x.objective || currentShot.objective || '').trim(),
        duration,
        material_usage: String(x.material_usage || x.material_hint || currentShot.material_usage || '').trim(),
        material_hint: String(x.material_hint || x.material_usage || currentShot.material_usage || '').trim(),
        content_prompt: visual,
        scene_content: String(x.scene_content || visual).trim(),
        visual: String(x.visual || visual).trim(),
        display_visual: String(x.display_visual || x.visual || visual).trim(),
        narration: voiceover,
        voiceover,
        ad_copy: voiceover,
        subtitle: voiceover,
        text: voiceover,
        style_note: styleNote,
        other: styleNote,
        lighting_style: String(x.lighting_style || '').trim(),
        transition: String(x.transition || '').trim(),
        camera,
        camera_label: String(x.camera_label || x.motion || _luxuryCameraLabel(camera)).trim(),
        motion: String(x.motion || x.camera_label || _luxuryCameraLabel(camera)).trim(),
        topview_prompt: String(x.topview_prompt || x.reference_prompt || currentShot.topview_prompt || '').trim(),
        reference_prompt: String(x.reference_prompt || x.topview_prompt || currentShot.topview_prompt || '').trim(),
        user_edited: true,
        ai_rewritten: true,
      },
    });
  } catch (err) {
    _sendApiError(res, err, '高定广告镜头 AI 修改失败');
  }
});

router.post('/luxury-ad/storyboard', async (req, res) => {
  try {
    const {
      text = '',
      duration_sec = 30,
      shot_count = 5,
      product_name = '主商品',
      asset_summary = '',
      ad_type = 'auto',
      output_ratio = '9:16',
      expand_brief = true,
      planning_mode = 'outline',
      product_asset = null,
      reference_assets = [],
      outline_segments = [],
      person_asset = null,
    } = req.body || {};
    const brief = String(text || '').trim();
    if (brief.length < 6) return res.status(400).json({ success: false, error: '请先填写广告需求' });
    const targetDuration = Math.max(12, Math.min(90, Math.round(Number(duration_sec) || 30)));
    const isDetailedMode = String(planning_mode || '').toLowerCase() === 'detailed';
    const suggestedShots = _suggestLuxuryAdShotCount({ text: brief, durationSec: targetDuration, assetSummary: asset_summary });
    const uploadedReferenceAssets = Array.isArray(reference_assets)
      ? reference_assets.filter(x => x && (x.url || x.previewUrl || x.name))
      : [];
    const requestedShotCount = Math.max(0, Math.min(8, Math.round(Number(shot_count) || 0)));
    const wantedShots = isDetailedMode
      ? (uploadedReferenceAssets.length
        ? Math.max(1, Math.min(uploadedReferenceAssets.length, requestedShotCount || uploadedReferenceAssets.length))
        : Math.max(1, Math.min(8, requestedShotCount || suggestedShots)))
      : suggestedShots;
    const referenceShotLockNote = isDetailedMode && uploadedReferenceAssets.length
      ? `本次用户只上传了 ${uploadedReferenceAssets.length} 张顺序分镜/场景画面，只允许输出 ${wantedShots} 个镜头；不得新增没有上传素材支撑的额外镜头。`
      : '';
    const productSubject = _deriveLuxuryProductSubject({ text: brief, productName: product_name, assetSummary: asset_summary });
    const productLockPrompt = _luxuryProductLockPrompt(productSubject);
    const uploadedAssetNotes = [
      product_asset && (product_asset.name || product_asset.url) ? `主商品图：${product_asset.name || product_asset.url}` : '',
      ...(Array.isArray(reference_assets) ? reference_assets.map(x => x && (x.name || x.url) ? `分镜画面${x.index || ''}：${x.name || x.url}` : '') : []),
      person_asset && (person_asset.name || person_asset.id) ? `人物参考：${person_asset.name || person_asset.id}` : '',
    ].filter(Boolean).join('；');
    const outlineNotes = Array.isArray(outline_segments) && outline_segments.length
      ? outline_segments.slice(0, isDetailedMode ? wantedShots : 8).map((s, i) => ({
          index: i + 1,
          title: s.title || `分镜${i + 1}`,
          role: s.role || s.shot_role || '',
          objective: s.objective || s.intent || s.purpose || '',
          material_need: s.material_need || s.required_material || s.material_requirement || s.material_usage || '',
          copy_direction: s.copy_direction || s.ad_copy || s.voiceover || s.narration || '',
          reference_index: s.reference_index || 0,
        }))
      : [];
    const modeInstruction = isDetailedMode
      ? `当前是第 4 步：用户已经补充了商品/场景/人物素材。请按专业小组协作来写：编剧负责每镜的叙事作用和观众文案；商业摄影指导负责景别、焦段、机位、光质、运动和转场；提示词专家负责把镜头意图改写成可执行的关键帧/图生视频提示词。每个场景都要明确景别、时长、镜头内容提示词、成片旁白/字幕广告词、风格、光线、转场。${referenceShotLockNote}`
      : `当前是第 2 步：用户只填写了广告设想。你只能先把广告设想拆成按时间推进的场景顺序和素材清单：开场分镜 → 第二场景 → 后续场景 → 收尾分镜。自己判断大概需要几个分镜；建议约 ${wantedShots} 个，但可按内容在 3-8 个之间调整。不要只输出 1 个镜头，不要假装已经看过素材，不要给具体景别/镜头运动/Topview 提示词；shot_size/shot_angle 固定写“素材进入后生成”，content_prompt 只写该场景需要什么画面，voiceover 只写旁白/介绍方向。`;
    const { callLLM } = require('../services/storyService');
    const sys = [
      '你是高定广告片专业创作组，由品牌策略/编剧、商业摄影指导、AI 视觉提示词专家共同产出。',
      '你的任务是把用户的“广告设想”拆成按时间推进的多场景广告故事，再在素材进入后写成专业分镜表。',
      '只输出 JSON 数组，不要输出说明文字。第 2 步只输出场景顺序与素材清单；第 4 步才输出分镜号、分镜使用素材（画面）、拍摄角度及镜头（景别）、时长、镜头内容提示词、成片旁白/字幕广告词、风格/光线/转场。',
      '语言标准：像商业广告导演案和摄影分镜，不像普通数字人口播拆句，不重复套模板，不写空泛功能词。',
      '禁止泛泛营销套话：便捷、高效、效率倍增、智能集成、只需片刻、告别繁琐，除非用户原始需求明确要求这种口径。'
    ].join(' ');
    const user = `主商品：${productSubject}
原始上传名称：${product_name || '主商品'}
广告需求：${brief}
参考素材摘要：${asset_summary || '只有主商品图'}
已上传素材详情：${uploadedAssetNotes || '暂未上传素材'}
已有场景顺序：${outlineNotes.length ? JSON.stringify(outlineNotes, null, 2) : '暂无'}
广告类型：${ad_type || 'auto'}
目标时长：${targetDuration} 秒
画面比例：${output_ratio}
是否允许补全合理镜头细节：${expand_brief ? '允许，但不能虚构价格、资质、疗效、金融承诺' : '不允许，只根据用户资料'}
生成阶段：${isDetailedMode ? '第 4 步专业分镜' : '第 2 步场景顺序规划'}
阶段要求：${modeInstruction}

${isDetailedMode ? `请生成 ${wantedShots} 个镜头的 JSON 数组。` : `请先根据广告内容和目标时长自行判断分镜数量，输出 3-8 个镜头的 JSON 数组；建议约 ${wantedShots} 个，简单广告也至少要有开场、产品/场景、细节或价值、行动引导，不允许只输出 1 个镜头。`}每个对象必须包含：
{
  "title": "镜头名，6字以内",
  "role": "hook|display|macro|benefit|proof|cta",
  "story_stage": "开场分镜|第二场景|细节分镜|场景转折|卖点分镜|收尾分镜",
  "shot_size": "微观全景 / 固定镜头、中远景 / 缓慢前进、极近景 / 微距平移等",
  "shot_angle": "拍摄角度及镜头（景别），例如：俯视全景 / 固定镜头、中远景 / 缓慢前推、极近景 / 跟随手部动作平移",
  "objective": "这一段场景在广告故事里要讲什么、起什么作用，中文短句",
  "duration": 2-8,
  "material_usage": "分镜使用素材（画面）：@主商品、@参考1、@参考2、人物参考或 AI 生成场景，并说明该镜头画面来源",
  "ad_copy": "成片屏幕广告词/字幕，8-18 个中文字符，必须能直接给观众看",
  "voiceover": "成片旁白/字幕广告词，8-24 个中文字符，像广告成片上的短文案或介绍，不是镜头说明，不能照抄广告需求",
  "narration": "同 voiceover，明确这一镜最终读出来或显示出来的话",
  "content_prompt": "镜头内容提示词，30-80 个中文字符，写清楚画面主体、背景、动作、镜头运动、过渡方式，不写广告词",
  "scene_content": "镜头画面内容，30-80 个中文字符，只描述看见什么、动作顺序和镜头运动",
  "visual": "镜头画面说明，20-50 个中文字符，只说明这一镜头看见什么和怎么运动，不写广告词",
  "style_note": "其他栏内容，格式为：风格：...；光线：...；转场：...，必要时可补充旁白语气",
  "lighting_style": "光线和画面风格，例如：极简明亮、柔和侧逆光、高级质感柔光",
  "transition": "与上一/下一镜头的过场，例如：溶化转场、轻微推近接下一镜、匹配剪辑",
  "visual_prompt": "英文关键帧提示词，强调 exact uploaded product/reference, premium commercial, no text overlay",
  "video_prompt": "英文图生视频提示词，说明镜头运动，强调 preserve product identity",
  "camera": "slow_push_in|smooth_slide|macro_push|focus_shift|hold",
  "material_hint": "主产品|主产品 + 顺序画面参考|人物参考可选"
}

硬性规则：
- 必须围绕主商品或用户描述的服务讲完整广告故事：开场分镜、第二场景、后续推进场景、收尾分镜都要有清晰顺序；不要只写一个场景，也不要只套“钩子/产品亮相/卖点”模板。
- 主商品类别必须锁定为「${productSubject}」，不能把它改成化妆品、香水瓶、护肤品、饮料瓶、手机、首饰或任何无关消费品。
- ${productLockPrompt}
- 第 4 步专业分镜必须体现三类专业贡献：编剧给出镜头戏剧作用和观众文案；摄影指导写出焦段/景别/光位/机位/运动；提示词专家写出模型可执行的关键帧和图生视频提示词。
- 广告词必须短、准、有品牌记忆点；禁止输出“简介便利、通过AI让视频制作更便捷、更高效、告别繁琐、效率倍增、创作只需片刻”等泛泛句式，除非用户要求原封不动使用。
- 分镜是生成前的广告脚本，不是直接成片，不要写“按广告内容生成画面”这种空话。
- 第 2 步场景顺序规划时，内容必须像制作清单：只写开场到收尾的顺序、这一段讲什么、需要准备什么画面、旁白/介绍方向；不要提前写具体景别和镜头运动。
- 第 4 步专业分镜时，必须沿用“已有场景顺序”的标题、广告任务、素材需求和用户修改内容，只补齐专业景别、时长、镜头内容提示词、成片旁白/字幕广告词、风格光线和转场。不要只写“主商品居中”“突出高级感”。
- 可以参考这种写法：纯色背景上，主商品在侧光里缓慢出现，纹理和反光先被观众看到，通过溶化转场进入下一镜头；中远景缓慢前进，产品置于空间中心，灯光穿过场景形成高级氛围；极近景跟随手部或材质纹理平移，展示细节和触感。
- content_prompt 是镜头内容提示词：描述“画面如何拍”，不是广告语，也不能是文件名或技术参数。
- voiceover/narration 是成片旁白/字幕广告词：描述“观众听到/看到什么话”，不是镜头和场景说明，也不是用户 brief；禁止出现“请做、帮我、我想、广告需求、目标客户、卖点/资料、画面风格、不要像、最后引导”等需求描述。
- visual 是镜头画面说明，不是广告词、不是旁白、不是模型提示词；禁止出现图片文件名、主产品1、顺序画面2、exact uploaded、prompt 等技术词。
- style_note 里必须包含“风格”“光线/转场”，例如：风格：极简明亮，纯净商业感；光线：侧逆光；转场：溶化转场。旁白应主要放在 voiceover/narration/ad_copy。
- 人物只是可选参考，不要默认写成数字人站桩讲解。
- 不要把不同参考图当成多个背景让用户先选；默认按上传顺序绑定：第 1 张参考给第 1 镜，第 2 张参考给第 2 镜，后续可由用户在表格里修改。`;
    let fallback = false;
    let scenes = [];
    try {
      const out = await callLLM(sys, user, {
        kb: { scene: 'luxury_ad', query: `${product_name} ${brief}`.slice(0, 160), limit: 4, maxCharsPerDoc: 500 },
      });
      scenes = _cleanJsonArray(out);
    } catch (err) {
      fallback = true;
      console.warn('[DH/luxury-ad/storyboard] LLM failed, using local fallback:', err.message);
    }
    const maxSceneCount = isDetailedMode ? wantedShots : 8;
    const minSceneCount = isDetailedMode ? Math.max(1, Math.min(2, wantedShots)) : 3;
    scenes = (Array.isArray(scenes) ? scenes : [])
      .filter(x => x && (x.voiceover || x.visual || x.visual_prompt || x.objective || x.material_usage || x.material_need || x.title || x.content_prompt || x.scene_content))
      .slice(0, maxSceneCount)
      .map((x, i) => {
        const roleCount = Math.max(wantedShots, Math.min(maxSceneCount, Array.isArray(scenes) ? scenes.length : wantedShots));
        const role = _luxuryRoleAt(i, roleCount, x.role || _inferSpaceAdRole([x.title, x.voiceover, x.visual].filter(Boolean).join(' '), i, roleCount));
        const fallbackOpts = { role, productSubject };
        const rawCopyDirection = String(x.copy_direction || x.narration || x.voiceover || x.ad_copy || x.subtitle || x.text || '').replace(/\s+/g, ' ').trim();
        const rawMaterialNeed = String(x.material_need || x.required_material || x.material_requirement || x.content_prompt || x.scene_content || x.visual || x.scene || x.display_visual || '').replace(/\s+/g, ' ').trim();
        const voiceover = isDetailedMode
          ? _cleanLuxuryAdCopy(rawCopyDirection, fallbackOpts)
          : (rawCopyDirection || '成片广告词在专业分镜阶段生成').slice(0, 80);
        const visual = isDetailedMode
          ? _cleanLuxuryAdVisual(rawMaterialNeed, fallbackOpts)
          : (rawMaterialNeed || _fallbackLuxuryAdVisual(fallbackOpts)).slice(0, 120);
        const camera = isDetailedMode ? String(x.camera || x.camera_motion || x.motion || 'smooth_slide').trim() : '';
        const shotAngle = isDetailedMode ? String(x.shot_angle || x.angle || x.shot_size || x.framing || '').trim() : '素材进入后生成';
        const materialUsage = String(x.material_usage || x.material_hint || '').trim() || (i === 0 ? '@主商品' : `@主商品 + @参考${i + 1}`);
        const styleNote = String(x.style_note || x.other || '').trim()
          || `风格：高级商业广告，镜头克制；光线：强调主体和材质；转场：${i === 0 ? '由暗到亮开场' : '顺接下一镜'}。`;
        const rawReferenceIndex = Math.max(1, Math.round(Number(x.reference_index ?? x.referenceImageIndex ?? (i + 1)) || (i + 1)));
        const referenceIndex = uploadedReferenceAssets.length ? Math.min(rawReferenceIndex, uploadedReferenceAssets.length) : rawReferenceIndex;
        const referenceLabel = x.reference_label || `@参考${referenceIndex}`;
        return {
          index: i,
          title: String(x.title || `镜头 ${i + 1}`).slice(0, 16),
          role,
          story_stage: _normalizeLuxurySceneStage(x.story_stage, role, i, roleCount),
          shot_size: shotAngle,
          shot_angle: shotAngle,
          objective: _cleanLuxuryAdVisual(x.objective || x.intent || x.purpose || '', {
            role,
            productSubject,
          }).replace(/[。；;，,]\s*$/g, ''),
          material_need: isDetailedMode ? String(x.material_need || x.required_material || x.material_requirement || '').trim() : visual,
          required_material: isDetailedMode ? String(x.required_material || x.material_need || x.material_requirement || '').trim() : visual,
          material_requirement: isDetailedMode ? String(x.material_requirement || x.material_need || x.required_material || '').trim() : visual,
          copy_direction: isDetailedMode ? String(x.copy_direction || '').trim() : voiceover,
          duration: Math.max(2, Math.min(8, Math.round((Number(x.duration) || targetDuration / wantedShots) * 10) / 10)),
          material_usage: materialUsage,
          content_prompt: visual,
          narration: voiceover,
          ad_copy: voiceover,
          style_note: styleNote,
          other: styleNote,
          lighting_style: String(x.lighting_style || x.lighting || '').trim(),
          transition: String(x.transition || x.transition_note || '').trim(),
          voiceover,
          subtitle: voiceover,
          text: voiceover,
          scene_content: visual,
          visual,
          display_visual: visual,
          topview_prompt: String(x.topview_prompt || x.reference_prompt || '').trim(),
          visual_prompt: String(x.visual_prompt || '').trim(),
          video_prompt: String(x.video_prompt || '').trim(),
          camera,
          camera_label: _luxuryCameraLabel(camera),
          reference_index: referenceIndex,
          reference_label: referenceLabel,
          reference_mentions: Array.isArray(x.reference_mentions) && x.reference_mentions.length ? x.reference_mentions : ['@主商品', referenceLabel],
          tone: x.tone || 'premium',
          expression: x.expression || 'calm',
          motion: x.motion || 'premium product camera movement',
          material_hint: materialUsage,
          product_subject: productSubject,
          product_lock_prompt: productLockPrompt,
        };
      });
    if (scenes.length < minSceneCount) {
      fallback = true;
      scenes = _fallbackLuxuryAdStoryboard({
        text: brief,
        durationSec: targetDuration,
        shotCount: wantedShots,
        productName: productSubject,
        assetSummary: asset_summary,
      });
    }
    let cursor = 0;
    scenes = scenes.map((s, i) => {
      const remainingSlots = Math.max(0, scenes.length - i - 1);
      const dur = i === scenes.length - 1
        ? Math.max(2, Math.round((targetDuration - cursor) * 10) / 10)
        : Math.max(2, Math.min(Number(s.duration) || 5, Math.round((targetDuration - cursor - remainingSlots * 2) * 10) / 10));
      const start = cursor;
      cursor += dur;
      const role = _luxuryRoleAt(i, scenes.length, s.role);
      const fallbackOpts = { role, productSubject };
      const voiceover = isDetailedMode
        ? _cleanLuxuryAdCopy(s.narration || s.voiceover || s.ad_copy || s.subtitle || s.text || '', fallbackOpts)
        : String(s.copy_direction || s.narration || s.voiceover || s.ad_copy || s.subtitle || s.text || '成片广告词在专业分镜阶段生成').replace(/\s+/g, ' ').trim().slice(0, 80);
      const visual = isDetailedMode
        ? _cleanLuxuryAdVisual(s.content_prompt || s.scene_content || s.visual || s.display_visual || s.scene || '', fallbackOpts)
        : String(s.material_need || s.required_material || s.material_requirement || s.content_prompt || s.scene_content || s.visual || s.display_visual || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const shotAngle = isDetailedMode ? (s.shot_angle || s.shot_size || s.framing || '') : '素材进入后生成';
      const materialUsage = s.material_usage || s.material_hint || (Number(s.reference_index) > 0 ? `@主商品 + ${s.reference_label || `@参考${s.reference_index}`}` : '@主商品');
      const styleNote = s.style_note || s.other || `风格：高级商业广告，镜头克制，光影和材质清晰；转场：顺接下一镜。`;
      const rawReferenceIndex = Math.max(1, Math.round(Number(s.reference_index ?? s.referenceImageIndex ?? (i + 1)) || (i + 1)));
      const referenceIndex = uploadedReferenceAssets.length ? Math.min(rawReferenceIndex, uploadedReferenceAssets.length) : rawReferenceIndex;
      const referenceLabel = s.reference_label || `@参考${referenceIndex}`;
      return {
        ...s,
        index: i,
        role,
        story_stage: _normalizeLuxurySceneStage(s.story_stage, role, i, scenes.length),
        start,
        end: cursor,
        duration: dur,
        shot_size: shotAngle,
        shot_angle: shotAngle,
        material_need: isDetailedMode ? (s.material_need || s.required_material || s.material_requirement || '') : visual,
        required_material: isDetailedMode ? (s.required_material || s.material_need || s.material_requirement || '') : visual,
        material_requirement: isDetailedMode ? (s.material_requirement || s.material_need || s.required_material || '') : visual,
        copy_direction: isDetailedMode ? (s.copy_direction || '') : voiceover,
        material_usage: materialUsage,
        content_prompt: visual,
        narration: voiceover,
        ad_copy: voiceover,
        style_note: styleNote,
        other: styleNote,
        lighting_style: s.lighting_style || s.lighting || '',
        transition: s.transition || s.transition_note || '',
        voiceover,
        subtitle: voiceover,
        text: voiceover,
        scene_content: visual,
        visual,
        display_visual: visual,
        topview_prompt: s.topview_prompt || s.reference_prompt || `使用 @主商品${Number(referenceIndex) > 0 ? ` 和 ${referenceLabel}` : ''} 生成这一镜头：${visual} 镜头运动：${s.camera_label || _luxuryCameraLabel(s.camera || s.camera_motion || s.motion)}。`,
        camera_label: s.camera_label || _luxuryCameraLabel(s.camera || s.camera_motion || s.motion),
        reference_index: referenceIndex,
        reference_label: referenceLabel,
        reference_mentions: Array.isArray(s.reference_mentions) && s.reference_mentions.length ? s.reference_mentions : ['@主商品', referenceLabel],
        product_subject: productSubject,
        product_lock_prompt: productLockPrompt,
      };
    });
    res.json({ success: true, segments: scenes, scenes, total_duration: targetDuration, fallback, product_subject: productSubject, planning_mode: isDetailedMode ? 'detailed' : 'outline' });
  } catch (err) {
    _sendApiError(res, err, '高定广告片分镜脚本生成失败');
  }
});

// ═══════════════════════════════════════════════
// Space guide · POST /api/dh/spaces/generate
//   body: { avatar_id, background_url, text, voice_id?, title?, scene?, camera?, subtitle? }
//   Builds a 16:9 docent keyframe first, then drives it through the existing digital-human video chain.
// ═══════════════════════════════════════════════
function _fallbackSpaceAdStoryboard({ title = '广告数字人', text = '', durationSec = 30, segments = [] }) {
  const source = Array.isArray(segments) && segments.length
    ? segments
    : _fallbackGuideSegments(text, Math.max(12, Number(durationSec) || 30));
  const picked = source.slice(0, 4);
  const labels = ['开场钩子', '场景亮点', '卖点讲解', '行动引导'];
  const roles = ['hook', 'display', 'benefit', 'cta'];
  return picked.map((seg, i) => ({
    title: labels[i] || `镜头 ${i + 1}`,
    role: roles[i] || 'display',
    duration: Math.max(3, Math.min(6, Math.round(Number(seg.end) - Number(seg.start) || (Number(durationSec) || 24) / picked.length))),
    voiceover: String(seg.text || '').trim(),
    visual_prompt: [
      `A controlled Image2-style keyframe for a realistic ${title} video.`,
      i === 0
        ? 'Presenter is visible in a clean advertising/showroom scene, looking confident at camera.'
        : i === picked.length - 1
          ? 'Presenter makes a clear closing gesture toward the display or product area.'
          : 'Presenter remains consistent while the display/background communicates the selling point.',
      'Use the uploaded presenter/avatar as the same person and the uploaded background as the exact advertising environment.',
      '16:9 cinematic composition, stable identity, natural commercial lighting.',
    ].join(' '),
    video_prompt: [
      i === 0 ? 'Slow confident opening shot with subtle push-in.' : '',
      i > 0 && i < picked.length - 1 ? 'Gentle camera move across the display area while presenter gestures naturally.' : '',
      i === picked.length - 1 ? 'Smooth closing shot, presenter faces camera and completes the call-to-action.' : '',
      'Keep presenter face identity, outfit and background stable. Natural hand gesture, no face morphing, no text overlay, no watermark.',
    ].filter(Boolean).join(' '),
  })).filter(x => x.voiceover || x.visual_prompt);
}

function _luxuryAdStylePrompt(style) {
  return ({
    luxury_soft: 'luxury commercial, soft studio lighting, premium materials, elegant slow camera movement, refined reflections',
    millennial_film: 'millennial film commercial, nostalgic grain, warm flash photography, fashion editorial framing, stylish lifestyle mood',
    dark_fantasy: 'dark fantasy commercial, dramatic contrast, mysterious atmosphere, sculptural product lighting, cinematic shadows',
    epic_cg: 'epic CG advertising film, grand cinematic scale, volumetric light, precise product hero shot, high-end VFX mood',
    lifestyle: 'premium lifestyle advertisement, natural real-life scene, aspirational but authentic, clean product storytelling',
    tech_product: 'high-end technology product film, clean futuristic light, macro details, glossy surfaces, precise motion design',
  })[style] || 'luxury commercial, soft studio lighting, premium materials, elegant slow camera movement';
}

function _luxuryAdStyleName(style) {
  return ({
    luxury_soft: '奢侈品柔光',
    millennial_film: '千禧胶片',
    dark_fantasy: '暗黑奇幻',
    epic_cg: '史诗 CG',
    lifestyle: '生活方式广告',
    tech_product: '科技产品片',
  })[style] || '奢侈品柔光';
}

function _luxuryShotDirection(role = '', index = 0, total = 6, adStyle = 'luxury_soft') {
  const r = String(role || '').toLowerCase();
  const styleName = _luxuryAdStyleName(adStyle);
  const library = {
    hook: {
      photography: {
        framing: 'wide establishing hero frame',
        lens: '28-35mm commercial lens, clean perspective',
        lighting: 'soft key light plus practical highlights',
        color: `${styleName} grade, premium contrast`,
      },
      camera_plan: { movement: 'slow push-in', speed: 'very slow', focus: 'brand atmosphere and full scene' },
      asset_prep: 'Lock the uploaded product/background silhouette before generating any new frame.',
    },
    atmosphere: {
      photography: {
        framing: 'wide atmospheric frame',
        lens: '35mm editorial lens',
        lighting: 'layered ambient light and refined rim highlights',
        color: `${styleName} mood grade`,
      },
      camera_plan: { movement: 'breathing camera drift', speed: 'slow', focus: 'mood, light, material and brand world' },
      asset_prep: 'Use the uploaded background as the scene plate; do not invent a new location.',
    },
    macro: {
      photography: {
        framing: 'macro texture/product close-up',
        lens: '70-100mm macro lens, shallow depth of field',
        lighting: 'grazing highlight that reveals material texture',
        color: `${styleName} detail grade`,
      },
      camera_plan: { movement: 'micro push-in with rack focus', speed: 'slow and precise', focus: 'product texture, edge, material and craft' },
      asset_prep: 'Crop from the uploaded product/background reference; preserve product shape and texture.',
    },
    display: {
      photography: {
        framing: 'medium product display shot',
        lens: '45-55mm commercial lens',
        lighting: 'balanced key light with controlled reflections',
        color: `${styleName} clean commercial grade`,
      },
      camera_plan: { movement: 'lateral slide or subtle pan', speed: 'smooth', focus: 'product placement and selling point reveal' },
      asset_prep: 'Keep product/display geometry stable; avoid adding unrelated props.',
    },
    benefit: {
      photography: {
        framing: 'presenter/product interaction frame',
        lens: '35-50mm advertising lens',
        lighting: 'soft facial key plus product highlight',
        color: `${styleName} trustworthy grade`,
      },
      camera_plan: { movement: 'guided pan from presenter gesture to product', speed: 'controlled', focus: 'one clear benefit' },
      asset_prep: 'If presenter appears, preserve uploaded identity and outfit style.',
    },
    proof: {
      photography: {
        framing: 'proof/detail comparison frame',
        lens: '50-70mm lens, compressed premium detail',
        lighting: 'high clarity product highlight',
        color: `${styleName} proof-focused grade`,
      },
      camera_plan: { movement: 'push from context to proof detail', speed: 'steady', focus: 'credibility and visible evidence' },
      asset_prep: 'Use only visible uploaded material; do not fabricate labels, numbers or logos.',
    },
    cta: {
      photography: {
        framing: 'clean brand ending frame',
        lens: '35-50mm hero lens',
        lighting: 'soft final glow with readable empty space',
        color: `${styleName} final brand grade`,
      },
      camera_plan: { movement: 'settled push-in or hold', speed: 'slow', focus: 'brand memory and conversion ending' },
      asset_prep: 'Reserve clean negative space for later subtitle or brand packaging; no generated text in image.',
    },
    endcard: {
      photography: {
        framing: 'brand end card composition without generated text',
        lens: '50mm clean product hero lens',
        lighting: 'polished final product light',
        color: `${styleName} final grade`,
      },
      camera_plan: { movement: 'minimal elegant hold', speed: 'almost static', focus: 'final product/brand impression' },
      asset_prep: 'Keep image clean for post-production title/subtitle overlay.',
    },
  };
  const inferred = index === 0 ? 'hook' : (index >= total - 1 ? 'cta' : (r || 'display'));
  const base = library[inferred] || library.display;
  return {
    workflow_ref: 'GPT image2 keyframe + Seedance2/Kling/Hailuo image-to-video',
    photography: base.photography,
    camera_plan: base.camera_plan,
    asset_prep: base.asset_prep,
    image2_brief: `${base.photography.framing}; ${base.photography.lens}; ${base.photography.lighting}; preserve exact uploaded references; no text overlay.`,
    i2v_brief: `${base.camera_plan.movement}; ${base.camera_plan.speed}; focus on ${base.camera_plan.focus}; preserve product/background identity.`,
  };
}

function _enrichLuxuryStoryboardScene(scene = {}, index = 0, total = 6, adStyle = 'luxury_soft') {
  const role = _inferSpaceAdRole([scene.role, scene.title, scene.voiceover, scene.visual_prompt].filter(Boolean).join(' '), index, total);
  const direction = _luxuryShotDirection(role, index, total, adStyle);
  const photography = { ...direction.photography, ...(scene.photography && typeof scene.photography === 'object' ? scene.photography : {}) };
  const cameraPlan = { ...direction.camera_plan, ...(scene.camera_plan && typeof scene.camera_plan === 'object' ? scene.camera_plan : {}) };
  const image2Brief = String(scene.image2_brief || direction.image2_brief).trim();
  const i2vBrief = String(scene.i2v_brief || direction.i2v_brief).trim();
  const assetPrep = String(scene.asset_prep || direction.asset_prep).trim();
  return {
    ...scene,
    workflow_type: 'luxury_ad_storyboard',
    reference_alignment: scene.reference_alignment || 'gpt_image2_seedance2',
    shot_index: index + 1,
    shot_count: total,
    shot_role: role,
    role,
    workflow_ref: scene.workflow_ref || direction.workflow_ref,
    photography,
    reverse_cinematography: {
      composition: photography.framing,
      lighting: photography.lighting,
      lens: photography.lens,
      motion: cameraPlan.movement,
      color: photography.color,
    },
    camera_plan: cameraPlan,
    camera_movement: cameraPlan,
    material_pipeline: scene.material_pipeline || {
      background_lock: true,
      product_lock: true,
      identity_lock: true,
      cutout_or_replace: role === 'macro' || role === 'display',
    },
    product_lock: scene.product_lock || 'preserve uploaded product shape, color, logo area, material and geometry',
    identity_lock: scene.identity_lock || 'preserve uploaded presenter face identity, outfit style and body proportions if visible',
    image2_brief: image2Brief,
    i2v_brief: i2vBrief,
    asset_prep: assetPrep,
    visual_prompt: [
      scene.visual_prompt || '',
      `Photography diagnosis: framing=${photography.framing}; lens=${photography.lens}; lighting=${photography.lighting}; color=${photography.color}.`,
      `Image2 keyframe brief: ${image2Brief}`,
      `Asset preparation: ${assetPrep}`,
    ].filter(Boolean).join(' '),
    video_prompt: [
      scene.video_prompt || '',
      `I2V motion brief: ${i2vBrief}`,
      `Camera plan: movement=${cameraPlan.movement}; speed=${cameraPlan.speed}; focus=${cameraPlan.focus}.`,
    ].filter(Boolean).join(' '),
  };
}

function _normalizeProvidedLuxuryStoryboardSegments(segments = [], {
  text = '',
  durationSec = 30,
  shotCount = 6,
  productSubject = '',
  adStyle = 'luxury_soft',
  assetSummary = '',
} = {}) {
  const targetDuration = Math.max(12, Math.min(90, Math.round(Number(durationSec) || 30)));
  const total = Math.max(4, Math.min(8, Number(shotCount) || segments.length || 6));
  const subject = productSubject || _deriveLuxuryProductSubject({ text, productName: '', assetSummary });
  const productLockPrompt = _luxuryProductLockPrompt(subject);
  let list = (Array.isArray(segments) ? segments : [])
    .filter(x => x && (x.voiceover || x.text || x.visual || x.visual_prompt || x.title))
    .slice(0, total);
  if (list.length < Math.min(4, total)) {
    list = _fallbackLuxuryAdStoryboard({
      text,
      durationSec: targetDuration,
      shotCount: total,
      productName: subject,
      assetSummary,
    });
  }
  let cursor = 0;
  return list.map((raw, i) => {
    const remainingSlots = Math.max(0, list.length - i - 1);
    const dur = i === list.length - 1
      ? Math.max(2, Math.round((targetDuration - cursor) * 10) / 10)
      : Math.max(2, Math.min(Number(raw.duration) || Math.round((targetDuration / list.length) * 10) / 10, Math.round((targetDuration - cursor - remainingSlots * 2) * 10) / 10));
    const start = cursor;
    cursor += dur;
    const role = _luxuryRoleAt(i, list.length, raw.role);
    const fallbackOpts = { role, productSubject: subject };
    const voiceover = _cleanLuxuryAdCopy(raw.narration || raw.voiceover || raw.ad_copy || raw.text || '', fallbackOpts);
    const visual = _cleanLuxuryAdVisual(raw.content_prompt || raw.scene_content || raw.visual || raw.scene || '', fallbackOpts);
    const referenceIndex = Math.max(1, Math.round(Number(raw.reference_index ?? raw.referenceImageIndex ?? (i + 1)) || (i + 1)));
    const referenceLabel = raw.reference_label || `@参考${referenceIndex}`;
    const topviewPrompt = String(raw.topview_prompt || raw.reference_prompt || '').trim();
    const shotAngle = String(raw.shot_angle || raw.angle || raw.shot_size || raw.framing || '').trim();
    const materialUsage = String(raw.material_usage || raw.material_hint || '').trim() || `@主商品 + ${referenceLabel}`;
    const styleNote = String(raw.style_note || raw.other || `风格：高级商业广告，镜头克制，光影和材质清晰；转场：顺接下一镜。`).replace(/成片广告词/g, '成片广告词');
    const lockedVisualPrompt = [
      productLockPrompt,
      referenceLabel ? `Topview-style reference binding: @主商品 + ${referenceLabel}.` : '',
      topviewPrompt ? `User editable shot prompt: ${topviewPrompt}` : '',
      raw.visual_prompt || '',
      visual ? `Chinese storyboard visual: ${visual}` : '',
      `Advertised product subject: ${subject}.`,
      'Use reference image 1 as the exact main product/material reference. Keep product category, material, texture, edge, color and selling-point evidence stable.',
      'No cosmetics, perfume bottles, skincare packaging, beverage bottles, phones, watches, jewelry or unrelated props unless they are visibly present in the uploaded main product image.',
    ].filter(Boolean).join(' ');
    return _enrichLuxuryStoryboardScene({
      ...raw,
      index: i,
      role,
      story_stage: _normalizeLuxurySceneStage(raw.story_stage, role, i, list.length),
      shot_size: shotAngle,
      shot_angle: shotAngle,
      start,
      end: cursor,
      duration: dur,
      material_usage: materialUsage,
      content_prompt: visual,
      narration: voiceover,
      ad_copy: voiceover,
      style_note: styleNote,
      other: styleNote,
      lighting_style: raw.lighting_style || raw.lighting || '',
      transition: raw.transition || raw.transition_note || '',
      voiceover,
      text: voiceover,
      scene_content: visual,
      visual,
      visual_prompt: lockedVisualPrompt,
      video_prompt: [
        raw.video_prompt || '',
        productLockPrompt,
        'Preserve the exact product/material category from the confirmed keyframe; do not morph into unrelated consumer products.',
      ].filter(Boolean).join(' '),
      product_subject: subject,
      product_lock_prompt: productLockPrompt,
      material_hint: materialUsage,
      reference_index: referenceIndex,
      reference_label: referenceLabel,
      reference_mentions: Array.isArray(raw.reference_mentions) && raw.reference_mentions.length ? raw.reference_mentions : ['@主商品', referenceLabel],
      topview_prompt: topviewPrompt || `使用 @主商品 和 ${referenceLabel} 生成这一镜头：${visual || voiceover}。保持主商品身份稳定，不生成画面文字。`,
    }, i, list.length, adStyle);
  });
}

async function _buildSpaceAdStoryboard({ title, text, durationSec, segments, scenePrompt, adMode = 'digital_ad', adStyle = 'luxury_soft', shotCount = 4 }) {
  const { callLLM } = require('../services/storyService');
  const target = Math.max(12, Math.min(40, Number(durationSec) || 30));
  const isLuxury = adMode === 'luxury_ad';
  const isShowroomGuide = adMode === 'showroom_guide';
  const kbScene = isShowroomGuide ? 'showroom_guide' : 'digital_ad';
  const kbQuery = _dhKbQuery(title, text, scenePrompt, segments, adMode, adStyle, 'advertising digital human motion walking hand gesture scene extension storyboard');
  const kbContext = _buildDhKbContext(kbScene, kbQuery, { limit: isLuxury ? 6 : 5, maxCharsPerDoc: 650 });
  if (isShowroomGuide) {
    const dur = Math.max(8, Number(durationSec) || Math.ceil(String(text || '').length / 4) || 10);
    const voiceover = String(text || '').trim();
    return [{
      title: title || '单镜头展墙讲解',
      role: 'showroom_guide',
      duration: dur,
      start: 0,
      end: dur,
      voiceover,
      visual_prompt: [
        'Single-shot showroom guide keyframe using the exact uploaded presenter and exact uploaded background.',
        'Presenter stands on the left third, facing camera naturally, already in an active guide pose: open palm toward the display wall or index finger pointing to material/detail areas.',
        'Right two thirds must preserve the uploaded display wall, product area, material texture and lighting.',
        'Do not replace the background, do not add a new model, factory, warehouse, shelves or unrelated room.',
        _adPresenterActionPrompt({ scenePrompt, text: voiceover }),
        kbContext ? `Knowledge-base direction: ${kbContext}` : '',
        scenePrompt ? `Scene emphasis: ${scenePrompt}.` : '',
      ].filter(Boolean).join(' '),
      video_prompt: [
        'Single continuous showroom-guide commercial shot.',
        'Presenter remains on the left third, naturally talking to camera while actively gesturing toward the right display wall.',
        _adPresenterActionPrompt({ scenePrompt, text: voiceover }),
        kbContext ? `Knowledge-base direction: ${kbContext}` : '',
        'The scene should feel extended from the still frame: subtle camera push-in, slight lateral parallax, gentle focus shift from presenter to wall texture, and natural lighting continuity.',
        'Right two thirds preserve the uploaded background/product wall clearly.',
        'Very slow push-in or subtle breathing camera only; no cuts, no scene change, no text overlays, no extra people.',
      ].join(' '),
      action_prompt: _adPresenterActionPrompt({ scenePrompt, text: voiceover }),
      source_text: voiceover,
    }];
  }
  const wantedShots = isLuxury ? Math.max(4, Math.min(8, Number(shotCount) || 6)) : 5;
  const seedSegments = (Array.isArray(segments) && segments.length ? segments : _fallbackGuideSegments(text, target))
    .slice(0, wantedShots)
    .map((s, i) => `${i + 1}. ${s.text}`)
    .join('\n');
  const sys = isLuxury
    ? '你是高定广告片导演。你会把产品/品牌广告拆成 Topview Image2 关键帧 + Seedance 全参考视频的镜头序列。只输出 JSON 数组。'
    : '你是短视频广告导演。你会把广告数字人口播文案拆成 Topview/Image2 + Seedance 风格的可控多关键帧广告分镜。只输出 JSON 数组。';
  const user = `标题：${title || '广告数字人'}
场景/背景要点：${scenePrompt || '根据上传背景自动识别'}
广告模式：${isLuxury ? `高定广告片 / ${_luxuryAdStyleName(adStyle)} / ${_luxuryAdStylePrompt(adStyle)}` : '普通广告数字人'}
目标时长：${target} 秒
文案分段：
${seedSegments || text}

硬性素材约束：
- 人物必须来自上传的数字人形象，不能生成新模特、新工人、新主持人或不同脸。
- 背景必须来自上传的背景/展示图，不能改成仓库、工厂、货架、办公室、街景或其他空间。
- 分镜只能描述镜头如何裁切、推进、平移、强调上传背景中的细节，以及人物如何站位讲解。
- 如果上传背景没有某种产品/场景元素，不要凭空添加。

请输出 ${isLuxury ? `${wantedShots} 个` : '3-5 个'}镜头 JSON 数组。每项字段：
{
  "title": "短标题",
  "role": "hook|atmosphere|macro|display|benefit|proof|cta|endcard",
  "duration": 3到6之间的整数,
  "voiceover": "对应这一镜头的中文口播",
  "visual_prompt": "英文画面生成提示词，必须强调 same presenter identity、exact uploaded background/reference 和 ${isLuxury ? 'premium advertising keyframe' : 'showroom guide composition preview'}",
  "video_prompt": "英文图生视频提示词，描述轻微镜头运动、自然手势、稳定口型"${isLuxury ? `,
  "photography": {"framing":"摄影构图/景别","lens":"焦段/镜头质感","lighting":"光位/光质","color":"色彩/颗粒/调性"},
  "camera_plan": {"movement":"镜头运动","speed":"运动速度","focus":"镜头重点"},
  "image2_brief": "给 Image2/GPT-image 类模型的关键帧 brief，强调摄影参数与素材锁定",
  "i2v_brief": "给 Seedance2/Kling/Hailuo 的图生视频 brief，强调运动与稳定性",
  "asset_prep": "素材预处理建议：抠图、产品替换、背景锁定或片尾留白"` : ''}
}

要求：人物必须来自上传的数字人形象；背景/产品/参考图必须来自上传素材；每个镜头只做一个动作或一个卖点，避免大幅度转身、换装、换脸、换场景。${isLuxury ? '镜头必须包含：氛围建立、产品/材质特写、人物/场景互动、卖点展示、品牌收束；整体要像商业广告片，不是普通口播。必须体现参考视频里的 GPT image2 + Seedance2 工作流思路：先用摄影解构做高定关键帧，再用图生视频做镜头运动。' : ''}`;
  try {
    const out = await callLLM(sys, user, {
      kb: { scene: kbScene, query: kbQuery, limit: isLuxury ? 6 : 5, maxCharsPerDoc: 650 },
    });
    const scenes = _cleanJsonArray(out)
      .filter(x => x && x.visual_prompt && x.video_prompt)
      .slice(0, wantedShots)
      .map((x, i) => ({
        title: String(x.title || `镜头 ${i + 1}`).slice(0, 20),
        role: _inferSpaceAdRole([x.role, x.title, x.voiceover, x.visual_prompt, segments?.[i]?.text].filter(Boolean).join(' '), i, wantedShots),
        duration: Math.max(3, Math.min(6, Math.round(Number(x.duration) || target / 4))),
        voiceover: String(x.voiceover || '').trim(),
        visual_prompt: String(x.visual_prompt || '').trim(),
        video_prompt: String(x.video_prompt || '').trim(),
        photography: x.photography && typeof x.photography === 'object' ? x.photography : null,
        camera_plan: x.camera_plan && typeof x.camera_plan === 'object' ? x.camera_plan : null,
        image2_brief: String(x.image2_brief || '').trim(),
        i2v_brief: String(x.i2v_brief || '').trim(),
        asset_prep: String(x.asset_prep || '').trim(),
        source_text: String(segments?.[i]?.text || '').trim(),
      }))
      .map((scene, i) => isLuxury ? _enrichLuxuryStoryboardScene(scene, i, wantedShots, adStyle) : scene);
    if (scenes.length >= (isLuxury ? Math.min(4, wantedShots) : 3)) return scenes;
  } catch (err) {
    console.warn('[DH/space-ad] storyboard fallback:', err.message);
  }
  const fallback = _fallbackSpaceAdStoryboard({ title, text, durationSec: target, segments });
  if (!isLuxury) return fallback;
  const style = _luxuryAdStylePrompt(adStyle);
  const labels = ['品牌氛围', '产品特写', '场景互动', '卖点证明', '高级转场', '使用场景', '情绪收束', '品牌片尾'];
  return Array.from({ length: wantedShots }, (_, i) => {
    const base = fallback[i % Math.max(1, fallback.length)] || {};
    return {
      ...base,
      title: labels[i] || `高定镜头 ${i + 1}`,
      role: _inferSpaceAdRole([base.role, base.title, base.voiceover, base.visual_prompt, segments?.[i]?.text].filter(Boolean).join(' '), i, wantedShots),
      visual_prompt: [
        `Premium advertising keyframe, ${style}.`,
        base.visual_prompt || '',
        'Use the uploaded reference image as the exact product/background material. Keep presenter identity consistent if visible.',
        'High-end commercial composition, controlled lighting, no text overlay, no watermark.',
      ].join(' '),
      video_prompt: [
        base.video_prompt || '',
        `Commercial camera movement matching ${_luxuryAdStyleName(adStyle)} style, subtle and polished.`,
        'Keep all product/background geometry stable, no morphing, no scene replacement.',
      ].join(' '),
    };
    return _enrichLuxuryStoryboardScene(scene, i, wantedShots, adStyle);
  });
}

function _inferSpaceAdRole(text = '', index = 0, total = 5) {
  const value = String(text || '').toLowerCase();
  if (['hook', 'atmosphere', 'macro', 'display', 'benefit', 'proof', 'cta', 'endcard'].includes(value)) return value;
  const has = (...words) => words.some(w => value.includes(w));
  if (has('纹理', '材质', '细节', '特写', '光泽', '质感', '推近', '靠近', 'macro', 'detail', 'texture', 'close-up', 'closeup')) return 'macro';
  if (has('购买', '咨询', '引导', '下单', '行动', '收束', 'cta', 'call to action', 'end')) return index === total - 1 ? 'cta' : 'benefit';
  if (has('强度', '耐用', '优势', '卖点', 'benefit', 'proof')) return 'benefit';
  if (index === 0 || has('整体', '全景', '空间', '第一眼', '欢迎', 'establish', 'wide')) return 'hook';
  if (index === total - 1) return 'cta';
  return 'display';
}

function _compactLuxuryShotMeta(shot = {}) {
  if (shot?.workflow_type !== 'luxury_ad_storyboard' && shot?.reference_alignment !== 'gpt_image2_seedance2') return {};
  return {
    workflow_type: shot.workflow_type || 'luxury_ad_storyboard',
    reference_alignment: shot.reference_alignment || 'gpt_image2_seedance2',
    shot_index: shot.shot_index,
    shot_count: shot.shot_count,
    shot_role: shot.shot_role || shot.role,
    photography: shot.photography || null,
    reverse_cinematography: shot.reverse_cinematography || null,
    camera_plan: shot.camera_plan || null,
    material_pipeline: shot.material_pipeline || null,
    product_lock: shot.product_lock || '',
    identity_lock: shot.identity_lock || '',
    character_lock: shot.character_lock ? {
      enabled: !!shot.character_lock.enabled,
      mode: shot.character_lock.mode || 'optional_identity_reference',
      identity_name: shot.character_lock.identity_name || '',
      stable_attributes: shot.character_lock.stable_attributes || [],
      mutable_attributes: shot.character_lock.mutable_attributes || [],
    } : null,
    image2_brief: shot.image2_brief || '',
    i2v_brief: shot.i2v_brief || '',
    asset_prep: shot.asset_prep || '',
  };
}

function _compactProviderPromptText(value = '', max = 1600) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\b(PRODUCT SUBJECT LOCK:\s*the advertised product category is "高定广告片"\.?)/ig, '')
    .trim()
    .slice(0, max);
}

function _buildLuxuryI2VPrompt(kf = {}, {
  text = '',
  title = '',
  scenePrompt = '',
  adStyle = 'luxury_soft',
  characterLock = null,
  maxChars = 1500,
} = {}) {
  const meta = _compactLuxuryShotMeta(kf);
  const subject = _deriveLuxuryProductSubject({
    text: [kf.product_subject, kf.content_prompt, kf.scene_content, kf.visual, text, scenePrompt].filter(Boolean).join('\n'),
    productName: kf.product_subject || '',
  });
  const shotVisual = _compactProviderPromptText(kf.content_prompt || kf.scene_content || kf.visual || kf.display_visual || kf.title || title, 260);
  const motion = _compactProviderPromptText([
    kf.video_prompt,
    meta.i2v_brief,
    meta.camera_plan?.movement,
    meta.camera_plan?.focus,
    kf.camera_label || kf.motion || kf.camera,
  ].filter(Boolean).join('; '), 420);
  const voice = _compactProviderPromptText(kf.voiceover || kf.narration || kf.ad_copy || text || '', 180);
  const photo = _compactProviderPromptText([
    meta.photography?.framing,
    meta.photography?.lens,
    meta.photography?.lighting,
    meta.photography?.color,
  ].filter(Boolean).join('; '), 260);
  return _compactProviderPromptText([
    'Image-to-video commercial shot from the provided keyframe only. Use the keyframe as the locked first frame and identity reference.',
    `Advertised subject: ${subject}. Preserve the exact product/material category, shape, texture, color and scene visible in the keyframe.`,
    shotVisual ? `Shot visual: ${shotVisual}.` : '',
    photo ? `Photography: ${photo}.` : '',
    motion ? `Camera motion: ${motion}.` : 'Camera motion: slow premium push-in with subtle parallax and stable composition.',
    voice ? `Voiceover meaning: ${voice}.` : '',
    scenePrompt ? `Brief context: ${_compactProviderPromptText(scenePrompt, 220)}.` : '',
    `Style: ${_luxuryAdStylePrompt(adStyle)}.`,
    characterLock?.enabled
      ? 'Preserve the same person from the keyframe; do not change face identity, age impression, hairstyle, body proportions or outfit family.'
      : 'Do not introduce a random new person if the keyframe is product/scene focused.',
    'No generated subtitles, no text overlay, no watermark, no product redesign, no category drift, no scene replacement, no face morphing.',
  ].filter(Boolean).join('\n'), maxChars);
}

function _publicAdKeyframeMeta(k = {}) {
  return {
    title: k.title,
    role: k.role,
    image_url: k.image_url,
    voiceover: k.voiceover,
    reference_mode: k.reference_mode,
    reference_index: k.reference_index,
    reference_label: k.reference_label,
    active_reference_image: k.active_reference_image,
    ..._compactLuxuryShotMeta(k),
  };
}

function _spaceAdKeyframePrompt({ scene, title, text, scenePrompt }) {
  const luxuryMeta = _compactLuxuryShotMeta(scene);
  return [
    'Topview Image2-style controlled keyframe for an advertising digital human video.',
    'CRITICAL REFERENCE LOCK: Use ONLY the two uploaded reference images as the visual source. Do not invent a new location, warehouse, factory, office, showroom, street, or any unrelated environment.',
    'Reference image 1 is the exact presenter/avatar. If a person appears, it MUST be this same person: same face identity, hairstyle, glasses, age, body type and clothing style. Do not create any new model, actor, worker, or different face.',
    'Reference image 2 is the exact advertising background/display image. Preserve the same wall/display/product/background layout, colors, materials, spatial perspective and lighting direction. Do not replace it with steel shelves, industrial storage, factory racks, or a different room.',
    'The shot may crop, push in, pull back, or place the presenter beside the provided background, but the recognizable content must still come from the uploaded avatar and uploaded background.',
    luxuryMeta.workflow_type ? `Luxury storyboard metadata: ${JSON.stringify(luxuryMeta).slice(0, 1000)}.` : '',
    scene.visual_prompt ? `Storyboard intent, subject to the strict reference lock above: ${scene.visual_prompt}` : '',
    scenePrompt ? `Scene emphasis: ${scenePrompt}.` : '',
    text ? `Narration meaning for this shot: ${String(text).slice(0, 180)}.` : '',
    `Shot title: ${scene.title || title || '广告数字人'}.`,
    '16:9 realistic commercial frame, presenter naturally placed without covering the key display area, no extra people, no subtitles generated in image, no watermark.',
    'NEGATIVE: different person, different gender, different face, warehouse, factory, steel storage racks, random product, extra people, generated text, logo hallucination, background replacement.',
  ].filter(Boolean).join(' ');
}

function _spaceAdShotPlan(scene = {}, index = 0, total = 5, aspectRatio = '16:9') {
  const role = String(scene.role || '').toLowerCase();
  const text = [scene.title, scene.voiceover, scene.visual_prompt, scene.video_prompt]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const has = (...words) => words.some(w => text.includes(w));
  const plan = {
    kind: 'presenter_display',
    bgZoom: 1.0,
    bgPosition: 'center',
    presenterVisible: true,
    presenterPlacement: index % 2 ? 'right' : 'left',
    presenterHeight: aspectRatio === '9:16' ? 0.66 : 0.76,
    presenterMaxWidth: aspectRatio === '9:16' ? 0.54 : 0.30,
    presenterBottom: 0.02,
    overlay: 0.12,
    focus: '人物讲解 + 背景展示',
  };
  if (role === 'showroom_guide' || has('showroom guide', 'single continuous shot', 'left third', '展墙讲解', '单镜头')) {
    const guidePlacement = scene.guidePlacement && typeof scene.guidePlacement === 'object' ? scene.guidePlacement : {};
    const num = (value, min, max, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    };
    const placementSide = guidePlacement.side === 'right' ? 'right' : 'left';
    const defaultHeight = aspectRatio === '9:16' ? 0.70 : 0.66;
    const defaultMaxWidth = aspectRatio === '9:16' ? 0.44 : 0.22;
    const defaultLeft = placementSide === 'right'
      ? (aspectRatio === '9:16' ? 0.48 : 0.70)
      : (aspectRatio === '9:16' ? 0.12 : 0.18);
    Object.assign(plan, {
      kind: 'showroom_guide',
      bgZoom: 1.0,
      bgPosition: 'center',
      presenterVisible: true,
      presenterPlacement: placementSide,
      presenterHeight: num(guidePlacement.height_pct, 0.45, 0.78, defaultHeight),
      presenterMaxWidth: num(guidePlacement.max_width_pct, 0.14, aspectRatio === '9:16' ? 0.48 : 0.30, defaultMaxWidth),
      presenterLeftPct: num(guidePlacement.left_pct, 0.02, 0.72, defaultLeft),
      presenterBottom: num(guidePlacement.bottom_pct, 0, 0.06, 0),
      guidePlacement,
      overlay: 0.12,
      focus: '单镜头展墙讲解',
    });
    return plan;
  }
  if (role === 'hook' || role === 'atmosphere' || index === 0 || has('全景', '整体', '空间', 'establish', 'wide', 'overall')) {
    Object.assign(plan, {
      kind: 'wide_establishing',
      bgZoom: 1.0,
      bgPosition: 'center',
      presenterVisible: true,
      presenterPlacement: has('左侧', 'left') ? 'left' : 'right',
      presenterHeight: aspectRatio === '9:16' ? 0.62 : 0.68,
      presenterMaxWidth: aspectRatio === '9:16' ? 0.50 : 0.26,
      focus: '整体空间建立',
    });
  }
  if (role === 'macro' || has('纹理', '材质', '细节', '特写', '光泽', '质感', 'macro', 'detail', 'texture', 'close-up')) {
    Object.assign(plan, {
      kind: 'material_detail',
      bgZoom: 1.34,
      bgPosition: has('右', 'right') ? 'right' : has('左', 'left') ? 'left' : 'center',
      presenterVisible: false,
      presenterHeight: 0,
      presenterMaxWidth: 0,
      overlay: 0.18,
      focus: '背景/产品细节特写',
    });
  }
  if (plan.kind !== 'material_detail' && (role === 'benefit' || role === 'proof' || has('卖点', '优势', '强度', '耐用', 'benefit', 'proof'))) {
    Object.assign(plan, {
      kind: 'selling_point',
      bgZoom: 1.12,
      bgPosition: has('右', 'right') ? 'right' : 'center',
      presenterVisible: true,
      presenterPlacement: has('左侧', 'left') ? 'left' : 'right',
      presenterHeight: aspectRatio === '9:16' ? 0.60 : 0.64,
      presenterMaxWidth: aspectRatio === '9:16' ? 0.48 : 0.25,
      focus: '卖点讲解',
    });
  }
  if (role === 'cta' || role === 'endcard' || index === total - 1 || has('引导', '购买', '收束', 'cta', 'call to action', 'end')) {
    Object.assign(plan, {
      kind: 'cta_end',
      bgZoom: 1.02,
      bgPosition: 'center',
      presenterVisible: true,
      presenterPlacement: has('左侧', 'left') ? 'left' : 'right',
      presenterHeight: aspectRatio === '9:16' ? 0.66 : 0.70,
      presenterMaxWidth: aspectRatio === '9:16' ? 0.52 : 0.28,
      overlay: 0.15,
      focus: '收束引导',
    });
  }
  if (has('左侧', 'left')) plan.presenterPlacement = 'left';
  if (has('右侧', 'right')) plan.presenterPlacement = 'right';
  return plan;
}

function _showroomGuideIntegrationPrompt({ guideText = 'one professional Chinese showroom guide', side = 'left', placement = null } = {}) {
  const guideSide = placement?.side === 'right' ? 'right' : (side === 'right' ? 'right' : 'left');
  const sideText = guideSide === 'right' ? 'right foreground zone chosen from the background' : 'left foreground zone chosen from the background';
  const framing = placement?.framing || 'waist-up or thigh-up foreground medium shot';
  const lighting = placement?.lighting || 'match the background exposure, warm color temperature, contrast and shadow direction';
  const clothing = placement?.clothing || 'dark matte business outfit that belongs to this showroom';
  const avoid = placement?.avoid || 'avoid glass cabinets, display cases, posters, picture frames and the central product wall';
  const reason = placement?.reason ? `Art-direction reason: ${placement.reason}.` : '';
  return [
    `Place exactly one human presenter total: ${guideText} in the ${sideText}. Do not create any second person, duplicate presenter, mannequin-like person, reflection person, portrait, poster person, or tiny person in the background.`,
    'The presenter is a foreground docent in the usable walking/foreground area of the uploaded room, not standing inside a cabinet, shelf, wall panel, poster, or picture frame.',
    `Use the background-specific framing: ${framing}. If the uploaded background has no visible floor or walkway, use a cropped waist-up/thigh-up composition instead of a tiny full-body person.`,
    'Use a natural foreground presenter scale: in a 16:9 showroom shot the visible presenter should usually take about 55%-70% of image height and 18%-26% of image width, unless the background analysis says otherwise.',
    `Placement safety: ${avoid}.`,
    `Lighting and grade: ${lighting}. Outfit: ${clothing}.`,
    reason,
    'Match the background camera height, lens perspective, color temperature, contrast, grain, edge softness and lighting direction.',
    'Add soft foreground shadow, ambient occlusion near the lower body, and warm rim light from nearby display lighting.',
    'Keep the main display wall and product/material area readable; the guide must support the scene, not dominate it.',
  ].filter(Boolean).join(' ');
}

async function _resizeBackgroundForShot(sharp, bgBuf, W, H, plan) {
  if (plan.preserveFullBackground) {
    const cover = await sharp(bgBuf)
      .rotate()
      .resize(W, H, { fit: 'cover', position: plan.bgPosition || 'center' })
      .blur(Math.max(10, Math.round(W * 0.018)))
      .modulate({ brightness: 0.62, saturation: 0.82 })
      .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
      .toBuffer();
    const full = await sharp(bgBuf)
      .rotate()
      .resize(W, H, { fit: 'contain', background: { r: 5, g: 6, b: 10 } })
      .sharpen({ sigma: 0.25, m1: 0.25, m2: 0.18 })
      .png()
      .toBuffer();
    return sharp(cover)
      .composite([{ input: full, left: 0, top: 0, blend: 'over' }])
      .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
      .toBuffer();
  }
  const zoom = Math.max(1, Math.min(1.55, Number(plan.bgZoom) || 1));
  if (zoom <= 1.01) {
    return sharp(bgBuf)
      .rotate()
      .resize(W, H, { fit: 'cover', position: plan.bgPosition || 'center' })
      .sharpen({ sigma: 0.25, m1: 0.25, m2: 0.18 })
      .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
      .toBuffer();
  }
  const zw = Math.ceil(W * zoom);
  const zh = Math.ceil(H * zoom);
  const resized = await sharp(bgBuf)
    .rotate()
    .resize(zw, zh, { fit: 'cover', position: plan.bgPosition || 'center' })
    .toBuffer();
  const maxLeft = Math.max(0, zw - W);
  const maxTop = Math.max(0, zh - H);
  const left = plan.bgPosition === 'left' ? 0 : plan.bgPosition === 'right' ? maxLeft : Math.round(maxLeft / 2);
  const top = plan.bgPosition === 'top' ? 0 : plan.bgPosition === 'bottom' ? maxTop : Math.round(maxTop / 2);
  return sharp(resized)
    .extract({ left, top, width: W, height: H })
    .sharpen({ sigma: 0.30, m1: 0.28, m2: 0.20 })
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function _createLockedAdKeyframe({
  req,
  avatarUrl,
  backgroundUrl,
  scene = {},
  aspectRatio = '16:9',
  outputSize = 'standard',
  filename,
  destDir = JIMENG_ASSETS_DIR,
  index = 0,
}) {
  const sharp = _loadSharp();
  if (!sharp) throw new Error('sharp unavailable: cannot create locked ad keyframe');
  const [W, H] = _outputPixels(aspectRatio, outputSize);
  const bgBuf = await _fetchImageBuffer(backgroundUrl);
  const personBuf = await _fetchImageBuffer(avatarUrl);
  const plan = _spaceAdShotPlan(scene, index, scene.totalShots || scene.shotCount || 5, aspectRatio);
  const isTemplateComposite = scene.templateComposite === true;
  let bgContentRect = { left: 0, top: 0, width: W, height: H };
  if (scene.preserveFullBackground === true) {
    try {
      const bgMeta = await sharp(bgBuf).rotate().metadata();
      if (bgMeta.width && bgMeta.height) {
        const scale = Math.min(W / bgMeta.width, H / bgMeta.height);
        const rectW = Math.round(bgMeta.width * scale);
        const rectH = Math.round(bgMeta.height * scale);
        bgContentRect = {
          left: Math.round((W - rectW) / 2),
          top: Math.round((H - rectH) / 2),
          width: rectW,
          height: rectH,
        };
      }
    } catch (metaErr) {
      console.warn('[DH/space-ad] background content rect failed, use canvas rect:', metaErr.message);
    }
  }
  if (scene.preserveFullBackground === true) {
    plan.preserveFullBackground = true;
    if (plan.kind === 'showroom_guide') {
      if (isTemplateComposite) {
        plan.presenterHeight = aspectRatio === '9:16' ? 0.58 : 0.50;
        plan.presenterMaxWidth = aspectRatio === '9:16' ? 0.44 : 0.24;
        plan.presenterLeftPct = 0.04;
        plan.presenterBottom = 0;
      } else {
        plan.presenterHeight = Math.max(Number(plan.presenterHeight) || 0, aspectRatio === '9:16' ? 0.76 : 0.82);
        plan.presenterMaxWidth = Math.max(Number(plan.presenterMaxWidth) || 0, aspectRatio === '9:16' ? 0.54 : 0.42);
        plan.presenterLeftPct = Number.isFinite(Number(plan.presenterLeftPct)) ? Number(plan.presenterLeftPct) : null;
      }
    }
  }
  const bgResized = await _resizeBackgroundForShot(sharp, bgBuf, W, H, plan);

  let fgPng = null;
  let cutoutUsed = false;
  let cutoutProvider = '';
  try {
    const meta = await sharp(personBuf).metadata();
    if (meta.hasAlpha) {
      const alpha = await sharp(personBuf).ensureAlpha().extractChannel(3).stats();
      if ((alpha.channels?.[0]?.min ?? 255) < 250) {
        fgPng = await sharp(personBuf).rotate().ensureAlpha().png().toBuffer();
        cutoutUsed = true;
        cutoutProvider = 'input-alpha';
      }
    }
  } catch (alphaErr) {
    console.warn('[DH/space-ad] alpha cutout inspect failed, continue:', alphaErr.message);
  }
  if (!fgPng) {
  try {
    const { matteImageBuffer } = require('../services/foregroundMattingService');
    const matte = await matteImageBuffer(personBuf, {
      inputUrl: avatarUrl,
      resolution: '1024x1024',
    });
    fgPng = matte.buffer;
    const alphaStats = await sharp(fgPng).ensureAlpha().extractChannel(3).stats();
    const alphaMean = alphaStats.channels?.[0]?.mean || 0;
    if (alphaMean < 2) throw new Error('matting returned empty foreground');
    cutoutUsed = true;
    cutoutProvider = `${matte.provider}:${matte.model}`;
  } catch (err) {
    if (plan.kind === 'showroom_guide') {
      throw new DhStrictError('KEYFRAME_MATTING_FAILED', 'keyframe_generate', `AI 导览员人物抠图失败：${err.message}`, {
        provider_chain: 'replicate-birefnet -> baidu-body-seg',
      }, 422, true);
    }
    console.warn('[DH/space-ad] locked keyframe matting failed, using framed avatar fallback:', err.message);
    fgPng = await sharp(personBuf)
      .rotate()
      .resize(Math.round(W * 0.32), Math.round(H * 0.72), { fit: 'inside', withoutEnlargement: true })
      .extend({ top: 14, bottom: 14, left: 14, right: 14, background: { r: 10, g: 12, b: 16, alpha: 0.84 } })
      .png()
      .toBuffer();
  }
  }

  let trimmed = await sharp(fgPng).ensureAlpha().trim({ threshold: 1 }).png().toBuffer();
  let meta = await sharp(trimmed).metadata();
  if (!meta.width || !meta.height) {
    trimmed = await sharp(personBuf).rotate().ensureAlpha().png().toBuffer();
    meta = await sharp(trimmed).metadata();
  }
  const placement = plan.presenterPlacement || (index % 2 ? 'right' : 'left');
  const showPresenter = plan.presenterVisible !== false;
  const isShowroomGuide = plan.kind === 'showroom_guide';
  const heightBase = plan.preserveFullBackground && isShowroomGuide ? bgContentRect.height : H;
  const fallbackHeight = plan.preserveFullBackground && isShowroomGuide ? 0.66 : 0.56;
  const heightPct = showPresenter ? (cutoutUsed ? plan.presenterHeight : Math.min(0.58, plan.presenterHeight || fallbackHeight)) : 0;
  let fgH = Math.round(heightBase * heightPct);
  let fgW = Math.round(fgH * (meta.width / Math.max(1, meta.height)));
  const widthBase = plan.preserveFullBackground && isShowroomGuide ? bgContentRect.width : W;
  const maxW = Math.round(widthBase * (plan.presenterMaxWidth || (aspectRatio === '9:16' ? 0.56 : 0.34)));
  if (showPresenter && fgW > maxW) {
    fgW = maxW;
    fgH = Math.round(fgW * (meta.height / Math.max(1, meta.width)));
  }
  let fgScaled = null;
  if (showPresenter) {
    if (plan.preserveFullBackground && isShowroomGuide && cutoutUsed) {
      const minGuideH = Math.round(heightBase * 0.54);
      if (fgH < minGuideH && fgW < maxW) {
        fgH = minGuideH;
        fgW = Math.round(fgH * (meta.width / Math.max(1, meta.height)));
        if (fgW > maxW) {
          fgW = maxW;
          fgH = Math.round(fgW * (meta.height / Math.max(1, meta.width)));
        }
      }
    }
    fgScaled = await sharp(trimmed)
      .resize(fgW, fgH, { fit: 'inside', kernel: sharp.kernel.lanczos3 })
      .sharpen({ sigma: 0.35, m1: 0.32, m2: 0.22 })
      .png()
      .toBuffer();
    const actual = await sharp(fgScaled).metadata();
    fgW = actual.width || fgW;
    fgH = actual.height || fgH;
  }
  const explicitLeftPct = Number(plan.presenterLeftPct);
  let left;
  if (plan.preserveFullBackground && isShowroomGuide) {
    const pad = Math.round(bgContentRect.width * 0.035);
    left = Number.isFinite(explicitLeftPct)
      ? Math.round(bgContentRect.left + pad + (bgContentRect.width - fgW - pad * 2) * explicitLeftPct)
      : placement === 'right'
        ? Math.round(bgContentRect.left + bgContentRect.width - fgW - pad)
        : Math.round(bgContentRect.left + pad);
  } else {
    left = Number.isFinite(explicitLeftPct)
      ? Math.round(W * explicitLeftPct)
      : placement === 'right'
        ? Math.max(0, W - fgW - Math.round(W * 0.045))
        : Math.round(W * 0.045);
  }
  left = Math.max(0, Math.min(Math.max(0, W - fgW), left));
  const bottomBase = plan.preserveFullBackground && isShowroomGuide ? (bgContentRect.top + bgContentRect.height) : H;
  const top = Math.max(0, Math.min(Math.max(0, H - fgH), bottomBase - fgH - Math.round(heightBase * (plan.presenterBottom || 0.01))));

  if (showPresenter && fgScaled) {
    try {
      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      const cropLeft = clamp(left, 0, Math.max(0, W - fgW));
      const cropTop = clamp(top, 0, Math.max(0, H - fgH));
      const cropW = Math.max(1, Math.min(fgW, W - cropLeft));
      const cropH = Math.max(1, Math.min(fgH, H - cropTop));
      const [bgStats, fgStats] = await Promise.all([
        sharp(bgResized).extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH }).stats(),
        sharp(fgScaled).removeAlpha().stats(),
      ]);
      const lum = (s) => 0.2126 * s.channels[0].mean + 0.7152 * s.channels[1].mean + 0.0722 * s.channels[2].mean;
      const bgLum = lum(bgStats);
      const fgLum = lum(fgStats);
      const brightnessBase = isTemplateComposite ? 0.88 : (isShowroomGuide ? 0.74 : 0.98);
      const brightness = clamp((bgLum / Math.max(1, fgLum)) * brightnessBase, isTemplateComposite ? 0.74 : (isShowroomGuide ? 0.58 : 0.84), isTemplateComposite ? 1.02 : (isShowroomGuide ? 0.90 : 1.10));
      const bgSpread = bgStats.channels[0].stdev + bgStats.channels[1].stdev + bgStats.channels[2].stdev;
      const fgSpread = fgStats.channels[0].stdev + fgStats.channels[1].stdev + fgStats.channels[2].stdev;
      const saturationBase = isTemplateComposite ? 0.86 : (isShowroomGuide ? 0.78 : 0.96);
      const saturation = clamp((bgSpread / Math.max(1, fgSpread)) * saturationBase, isTemplateComposite ? 0.74 : (isShowroomGuide ? 0.62 : 0.82), isTemplateComposite ? 1.00 : (isShowroomGuide ? 0.94 : 1.08));
      fgScaled = await sharp(fgScaled)
        .modulate({ brightness, saturation })
        .sharpen({ sigma: 0.28, m1: 0.22, m2: 0.16 })
        .png()
        .toBuffer();
    } catch (toneErr) {
      console.warn('[DH/space-ad] locked keyframe tone match failed, continue:', toneErr.message);
    }
  }
  if (showPresenter && fgScaled && isShowroomGuide && !isTemplateComposite) {
    try {
      const alpha = await sharp(fgScaled)
        .ensureAlpha()
        .extractChannel(3)
        .blur(0.85)
        .toBuffer();
      const fgRgb = await sharp(fgScaled).removeAlpha().toBuffer();
      const warmVeilAlpha = await sharp(alpha).linear(0.10, 0).toBuffer();
      const warmVeil = await sharp({
        create: { width: fgW, height: fgH, channels: 3, background: { r: 116, g: 78, b: 48 } },
      }).joinChannel(warmVeilAlpha).png().toBuffer();
      const shadeAlpha = await sharp(alpha).linear(0.12, 0).toBuffer();
      const shade = await sharp({
        create: { width: fgW, height: fgH, channels: 3, background: { r: 10, g: 8, b: 6 } },
      }).joinChannel(shadeAlpha).png().toBuffer();
      fgScaled = await sharp(fgRgb)
        .joinChannel(alpha)
        .composite([
          { input: warmVeil, left: 0, top: 0, blend: 'overlay' },
          { input: shade, left: 0, top: 0, blend: 'multiply' },
        ])
        .png()
        .toBuffer();
    } catch (edgeErr) {
      console.warn('[DH/space-ad] showroom foreground grade failed, continue:', edgeErr.message);
    }
  }

  let dropShadow = null;
  let contactShadow = null;
  let edgeWrap = null;
  if (showPresenter && fgScaled) {
    const shadowAlpha = await sharp(fgScaled)
      .extractChannel(3)
      .blur(Math.max(isTemplateComposite ? 6 : (isShowroomGuide ? 12 : 6), Math.round(W * (isTemplateComposite ? 0.010 : (isShowroomGuide ? 0.020 : 0.012)))))
      .linear(isTemplateComposite ? 0.12 : (isShowroomGuide ? 0.30 : 0.18), 0)
      .toBuffer();
    dropShadow = await sharp({
      create: { width: fgW, height: fgH, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).joinChannel(shadowAlpha).png().toBuffer();
    if (isShowroomGuide) {
      const edgeAlpha = await sharp(fgScaled)
        .extractChannel(3)
        .blur(Math.max(4, Math.round(W * 0.006)))
        .linear(0.13, 0)
        .toBuffer();
      edgeWrap = await sharp({
        create: { width: fgW, height: fgH, channels: 3, background: { r: 150, g: 116, b: 76 } },
      }).joinChannel(edgeAlpha).png().toBuffer();
      contactShadow = Buffer.from(`
        <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <filter id="b"><feGaussianBlur stdDeviation="${Math.max(14, W * 0.024)}"/></filter>
          <ellipse cx="${left + fgW / 2}" cy="${Math.min(H - 8, top + fgH - H * 0.012)}"
            rx="${Math.max(42, fgW * (isTemplateComposite ? 0.30 : 0.46))}" ry="${Math.max(10, H * (isTemplateComposite ? 0.014 : 0.022))}"
            fill="#000000" opacity="${isTemplateComposite ? 0.16 : 0.30}" filter="url(#b)"/>
        </svg>`);
    }
  }
  const vignette = Buffer.from(`
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#000000" stop-opacity="${plan.presenterVisible === false ? 0.10 : (isShowroomGuide ? 0.30 : 0.20)}"/>
          <stop offset="0.48" stop-color="#000000" stop-opacity="0.02"/>
          <stop offset="1" stop-color="#000000" stop-opacity="${plan.presenterVisible === false ? 0.10 : (isShowroomGuide ? 0.16 : 0.14)}"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <ellipse cx="${left + fgW / 2}" cy="${Math.min(H - 10, top + fgH - H * 0.012)}"
        rx="${Math.max(36, fgW * 0.30)}" ry="${Math.max(10, H * 0.018)}"
        fill="#000000" opacity="0.20"/>
    </svg>`);

  fs.mkdirSync(destDir, { recursive: true });
  const outPath = path.join(destDir, filename + '.jpg');
  const composites = [
    { input: vignette, top: 0, left: 0, blend: 'over' },
  ];
  if (contactShadow) composites.push({ input: contactShadow, top: 0, left: 0, blend: 'over' });
  if (showPresenter && fgScaled && dropShadow && fgW > 0 && fgH > 0) {
    composites.push(
      { input: dropShadow, top: Math.min(H - fgH, top + Math.round(H * (isShowroomGuide ? 0.016 : 0.01))), left: Math.max(0, Math.min(W - fgW, left + Math.round(W * (isShowroomGuide ? 0.014 : 0.008)))), blend: 'over' },
      ...(edgeWrap ? [{ input: edgeWrap, top, left, blend: 'soft-light' }] : []),
      { input: fgScaled, top, left, blend: 'over' },
    );
  }
  const composed = await sharp(bgResized).composite(composites).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
  fs.writeFileSync(outPath, composed);
  console.log(`[DH/space-ad] locked keyframe ${path.basename(outPath)} source=avatar+background shot=${plan.kind} cutout=${cutoutUsed} matting=${cutoutProvider || 'none'} scene="${scene.title || ''}"`);
  plan.mattingProvider = cutoutProvider || (cutoutUsed ? 'unknown' : 'none');
  return { outPath, plan };
}

async function _prepareShowroomGuideTemplateAsset(req, { guideGender = 'female', filename, destDir = JIMENG_ASSETS_DIR } = {}) {
  const sharp = _loadSharp();
  if (!sharp) throw new Error('sharp unavailable: cannot prepare showroom guide template');
  const normalizedGender = guideGender === 'male' ? 'male' : 'female';
  const srcName = normalizedGender === 'male' ? 'avatar_male-1.png' : 'avatar_female-1.png';
  const srcPath = path.resolve(__dirname, '../../outputs/presets', srcName);
  if (!fs.existsSync(srcPath)) {
    throw new DhStrictError('GUIDE_TEMPLATE_MISSING', 'keyframe_generate', `导览员模板不存在：${srcName}`, { srcName }, 500, false);
  }
  fs.mkdirSync(destDir, { recursive: true });
  const meta = await sharp(srcPath).rotate().metadata();
  const width = meta.width || 1024;
  const height = meta.height || 1024;
  const cropHeight = Math.max(1, height - Math.max(88, Math.round(height * 0.10)));
  const outName = `${filename}_guide_template_${normalizedGender}.png`;
  const outPath = path.join(destDir, outName);
  await sharp(srcPath)
    .rotate()
    .extract({ left: 0, top: 0, width, height: cropHeight })
    .png()
    .toFile(outPath);
  return {
    localPath: outPath,
    publicUrl: `${_publicBaseUrl(req)}/public/jimeng-assets/${outName}`,
    gender: normalizedGender,
    source: srcName,
  };
}

async function _createTemplateShowroomGuideKeyframe({
  req,
  backgroundUrl,
  scene = {},
  aspectRatio = '16:9',
  outputSize = 'standard',
  filename,
  destDir = JIMENG_ASSETS_DIR,
  index = 0,
  guideGender = 'female',
}) {
  const guide = await _prepareShowroomGuideTemplateAsset(req, { guideGender, filename, destDir });
  const guidePlacement = {
    side: 'left',
    framing: aspectRatio === '9:16' ? 'waist_up_foreground' : 'medium_foreground',
    requirement: 'one visible showroom guide composited from approved template; original background locked',
    source: 'approved_template',
  };
  const locked = await _createLockedAdKeyframe({
    req,
    avatarUrl: guide.publicUrl,
    backgroundUrl,
    scene: {
      ...scene,
      role: 'showroom_guide',
      guidePlacement,
      preserveFullBackground: true,
      templateComposite: true,
    },
    aspectRatio,
    outputSize,
    filename,
    destDir,
    index,
  });
  return {
    ...locked,
    referenceMode: 'showroom_guide_template_composite',
    plan: {
      ...locked.plan,
      kind: 'showroom_guide_template_composite',
      focus: '确定性导览员模板合成 + 原背景锁定',
      fusion_model: 'deterministic-template-composite',
      guide_gender: guide.gender,
      guide_asset_url: guide.publicUrl,
      guide_asset_source: guide.source,
      guide_placement: guidePlacement,
      background_lock: 'original_uploaded_background_plate',
    },
  };
}

async function _createNaturalShowroomAdKeyframe({
  req,
  avatarUrl,
  backgroundUrl,
  avatar = null,
  scene = {},
  aspectRatio = '16:9',
  outputSize = 'standard',
  filename,
  destDir = JIMENG_ASSETS_DIR,
  index = 0,
}) {
  const guidePlacement = await _analyzeGuidePlacementForBackground(req, backgroundUrl, aspectRatio);
  const sceneForPlan = { ...scene, guidePlacement };
  const plan = _spaceAdShotPlan(sceneForPlan, index, scene.totalShots || scene.shotCount || 1, aspectRatio);
  const presenterSide = plan.presenterPlacement === 'right' ? 'right third' : 'left third';
  const gender = String(avatar?.gender || '').toLowerCase();
  const genderLock = gender === 'female'
    ? 'The presenter must remain an adult woman, no male face, no masculine features.'
    : gender === 'male'
      ? 'The presenter must remain an adult man, no female face, no feminine features.'
      : 'Keep the same gender as the presenter reference.';
  const prompt = [
    'Create one photorealistic advertising video keyframe from exactly two references.',
    'Reference image 1 is the uploaded background/showroom. Preserve its real wall texture, product display, room layout, perspective, lighting direction and color mood.',
    'Reference image 2 is the selected digital-human presenter. Preserve the presenter identity impression, gender, hairstyle, outfit family and body proportions.',
    'Generate the presenter directly inside the background scene as one coherent photo, not a cutout pasted on top.',
    _showroomGuideIntegrationPrompt({ guideText: 'the presenter', side: plan.presenterPlacement, placement: guidePlacement }),
    `Presenter side hint: ${presenterSide}. Keep the display wall/background dominant and readable.`,
    'Use a natural showroom docent action pose, not a static standing portrait: one hand open-palm toward the display wall or index finger pointing at a detail, slight torso turn, eyes returning to camera.',
    _adPresenterActionPrompt({ scenePrompt: scene.scenePrompt || '', text: scene.voiceover || scene.text || '' }),
    'Match shadows, color temperature, contrast, camera grain, edge softness and ambient light between presenter and background.',
    genderLock,
    scene.visual_prompt ? `Storyboard intent: ${String(scene.visual_prompt).slice(0, 220)}.` : '',
    scene.voiceover || scene.text ? `Narration meaning: ${String(scene.voiceover || scene.text).slice(0, 160)}.` : '',
    'No extra people, no new room, no background replacement, no generated subtitles, no poster text, no watermark, no pasted sticker look, no beauty doll face.',
  ].filter(Boolean).join(' ');
  try {
    const refs = [
      await _resolveImageForExternalApi(req, backgroundUrl),
      await _resolveImageForExternalApi(req, avatarUrl),
    ].filter(Boolean);
    let usedModel = 'nano-banana';
    let outPath = null;
    try {
      outPath = await _generateViaDeyunaiNanoBanana({
        prompt,
        aspectRatio,
        filename,
        destDir,
        referenceImages: refs,
        outputSize,
      });
    } catch (nanoErr) {
      console.warn('[DH/space-ad] nano-banana natural keyframe failed:', nanoErr.message);
      try {
        const bgRef = refs[0];
        const avatarRef = refs[1];
        outPath = await _generateViaFluxKontextMulti({
          prompt,
          image1Url: bgRef,
          image2Url: avatarRef,
          aspectRatio,
          filename: `${filename}_flux`,
          destDir,
          modelTier: 'pro',
        });
        usedModel = 'flux-kontext-pro';
      } catch (fluxErr) {
        console.warn('[DH/space-ad] flux natural keyframe failed:', fluxErr.message);
        throw new Error(`自然融合首帧生成失败：${nanoErr.message}; ${fluxErr.message}`);
      }
    }
    return {
      outPath,
      referenceMode: 'integrated_avatar_background',
      plan: {
        ...plan,
        kind: 'integrated_avatar_background',
        focus: '自然融合：人物 + 背景',
        fusion_model: usedModel,
        guide_placement: guidePlacement,
      },
    };
  } catch (err) {
    console.warn('[DH/space-ad] natural showroom keyframe failed:', err.message);
    throw err;
  }
}

async function _generateViaReplicateFluxFill({ req, imagePath, maskPath, prompt, filename, destDir = JIMENG_ASSETS_DIR }) {
  const { loadSettings } = require('../services/settingsService');
  const settings = loadSettings();
  const provider = (settings.providers || []).find(p => (p.id === 'replicate' || p.preset === 'replicate') && p.enabled !== false && p.api_key);
  const apiKey = provider?.api_key || process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  if (!apiKey) throw new Error('缺少 Replicate API Key，无法做局部重绘');
  const toDataUri = (filePath, mime) => `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  const image = toDataUri(imagePath, 'image/jpeg');
  const mask = toDataUri(maskPath, 'image/png');
  const submitUrl = 'https://api.replicate.com/v1/models/black-forest-labs/flux-fill-pro/predictions';
  const headers = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', Prefer: 'wait=60' };
  const body = {
    input: {
      image,
      mask,
      prompt: String(prompt || '').slice(0, 2400),
      safety_tolerance: 2,
    },
  };
  let r;
  try {
    r = await axios.post(submitUrl, body, { headers, timeout: 120000 });
  } catch (err) {
    throw new Error(_formatReplicateError('flux-fill local repaint submit failed', err));
  }
  let result = r.data;
  for (let i = 0; i < 48 && result?.status && !['succeeded', 'failed', 'canceled'].includes(result.status); i++) {
    await _sleep(2500);
    try {
      const poll = await axios.get(`https://api.replicate.com/v1/predictions/${result.id}`, {
        headers: { Authorization: 'Bearer ' + apiKey },
        timeout: 30000,
      });
      result = poll.data;
    } catch (err) {
      throw new Error(_formatReplicateError('flux-fill local repaint poll failed', err));
    }
  }
  if (result?.status !== 'succeeded') throw new Error(result?.error || result?.status || 'flux-fill-pro 未成功返回');
  const outUrl = Array.isArray(result.output) ? result.output[0] : result.output;
  if (!outUrl) throw new Error('flux-fill-pro 未返回图片 URL');
  const outPath = path.join(destDir, `${filename}.png`);
  const img = await axios.get(outUrl, { responseType: 'arraybuffer', timeout: 60000 });
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(img.data));
  console.log(`[DH/space-ad] flux-fill guide inpaint complete: ${outPath}`);
  return outPath;
}

async function _createGeneratedGuideCompositeFallback({
  req,
  backgroundUrl,
  scene = {},
  aspectRatio = '16:9',
  outputSize = 'standard',
  filename,
  destDir = JIMENG_ASSETS_DIR,
  index = 0,
  guideGender = 'female',
  forceLockedComposite = false,
  allowIsolatedComposite = true,
}) {
  const bgBuf = await _fetchImageBuffer(_absolutePublicUrl(req, backgroundUrl));
  const bgDescription = await _describeAdBackgroundForGuide(req, backgroundUrl);
  const guidePlacement = await _analyzeGuidePlacementForBackground(req, backgroundUrl, aspectRatio);
  const normalizedGuideGender = guideGender === 'male' ? 'male' : 'female';
  const outfitGuide = guidePlacement.clothing || 'dark matte business outfit that blends with the showroom';
  const guideGenderText = normalizedGuideGender === 'male'
    ? `STRICT GENDER LOCK: exactly one adult male Chinese showroom guide only, masculine face and male body proportions, short neat hair, ${outfitGuide}, no woman, no female face, no feminine presenter`
    : `STRICT GENDER LOCK: exactly one adult female Chinese showroom guide only, feminine face and female body proportions, neat professional hair, ${outfitGuide}, no man, no male face, no masculine presenter`;
  const qaAttempts = [];
  const compactPlacement = _compactGuidePlacement(guidePlacement);
  const compactBg = String(bgDescription || '').slice(0, 360);
  const sceneGuidePrompt = [
    'Reference image is the exact showroom background. Preserve its crop, wall/cabinet geometry, camera angle, lights, material texture and color. Do not replace the room.',
    `Background: ${compactBg}.`,
    `Placement: ${JSON.stringify(compactPlacement)}.`,
    `Add exactly one presenter: ${guideGenderText}.`,
    'Place the presenter as a real foreground showroom docent, not in glass/cabinet/poster/reflection areas. Keep the display wall readable.',
    'Use waist-up or thigh-up scale around 18%-26% frame width in 16:9. Clear face and hands, one open-palm or soft pointing gesture toward the display.',
    'Match lighting, shadow softness, grain, contrast, lens perspective and warm color temperature. Add contact shadow where body meets floor/foreground.',
    `Use outfit and styling that belongs to the uploaded room: ${outfitGuide}.`,
    _staticShowroomGuidePosePrompt({ text: scene.voiceover || scene.text || '', placement: guidePlacement }),
    scene.voiceover || scene.text ? `Narration: ${String(scene.voiceover || scene.text).slice(0, 120)}.` : '',
    'Negative: pasted cutout, halo, white background, portrait card, picture-in-picture, duplicated person, reflection person, poster person, extra people, text, watermark.',
  ].filter(Boolean).join(' ');
  const isolatedGuidePrompt = [
    'Generate only one isolated commercial showroom guide asset on pure white background for later compositing. Do not recreate the room.',
    `Target room: ${compactBg}.`,
    `Placement: ${JSON.stringify(compactPlacement)}.`,
    guideGenderText,
    'Medium close docent asset, front or three-quarter view, clear face, torso and presenting hand. Fill most of the frame; clean silhouette.',
    _staticIsolatedGuideAssetPrompt({ text: scene.voiceover || scene.text || '', placement: guidePlacement }),
    `Lighting/style: ${guidePlacement.lighting || 'warm showroom light'}; ${outfitGuide}; low contrast, soft edge light.`,
    'No room, wall, plant, furniture, props, text, watermark, extra people, duplicated limbs, cartoon, CGI doll, beauty poster.',
  ].filter(Boolean).join(' ');

  const avatarService = require('../services/avatarService');
  let guidePath = null;
  let usedModel = forceLockedComposite ? 'seedream-strict-isolated-guide-composite' : 'seedream-scene-conditioned-guide';
  const qaPlacement = { ...guidePlacement, expected_gender: normalizedGuideGender };
  const integratedResult = (outPath, model, qa) => ({
    outPath,
    referenceMode: 'generated_showroom_guide',
    plan: {
      ..._spaceAdShotPlan({ ...scene, role: 'showroom_guide', guidePlacement }, index, scene.totalShots || scene.shotCount || 1, aspectRatio),
      kind: 'generated_showroom_guide',
      focus: 'scene-integrated guide generated from uploaded background',
      fusion_model: model,
      guide_gender: normalizedGuideGender,
      background_context: bgDescription,
      guide_placement: guidePlacement,
      prompt_debug: {
        image_contract: 'showroom_guide_keyframe_v2',
        scene_prompt_chars: sceneGuidePrompt.length,
        isolated_prompt_chars: isolatedGuidePrompt.length,
      },
      quality_check: qa,
    },
  });
  if (!forceLockedComposite) {
    try {
      guidePath = await avatarService._arkSeedreamGenerate({
        prompt: sceneGuidePrompt,
        referenceBase64: bgBuf.toString('base64'),
        aspectRatio,
        filename: `${filename}_guide_scene_seedream`,
        watermark: false,
        cropBottomPx: 0,
        destDir,
      });
      const qa = await _checkShowroomGuideIntegration(req, backgroundUrl, guidePath, qaPlacement);
      qaAttempts.push({ candidate: 'seedream_scene_integrated', qa: _qaSummary(qa) });
      if (!qa || qa.pass) {
        return integratedResult(guidePath, usedModel, qa);
      }
      console.warn('[DH/space-ad] scene-conditioned guide rejected by QA:', JSON.stringify(qa));
      throw new Error(`scene-conditioned guide rejected by QA: ${qa.score}`);
    } catch (sceneErr) {
      if (!qaAttempts.some(x => x.candidate === 'seedream_scene_integrated')) {
        qaAttempts.push({ candidate: 'seedream_scene_integrated', error: sceneErr.message });
      }
      console.warn('[DH/space-ad] seedream scene-conditioned guide failed, try full-scene nano-banana:', sceneErr.message);
      try {
        const bgRef = await _resolveImageForExternalApi(req, backgroundUrl);
        const nanoScenePrompt = [
          sceneGuidePrompt,
          'Important: preserve the uploaded room identity and major geometry. Do not replace it with a different showroom.',
          'The final result should look like a still frame from a real showroom guide video, with the guide actually inside the lighting of the room.',
        ].join(' ');
        for (const model of DEYUNAI_SHOWROOM_EDIT_MODELS) {
          try {
            guidePath = await _generateViaDeyunaiSpecificImageModel({
              model,
              prompt: nanoScenePrompt,
              aspectRatio,
              filename: `${filename}_guide_scene_${model.replace(/[^a-z0-9]+/gi, '_')}`,
              destDir,
              referenceImages: [bgRef].filter(Boolean),
              outputSize,
            });
            usedModel = `${model}-scene-integrated-guide`;
            const qa = await _checkShowroomGuideIntegration(req, backgroundUrl, guidePath, qaPlacement);
            qaAttempts.push({ candidate: `${model}_scene_integrated`, qa: _qaSummary(qa) });
            if (!qa || qa.pass) {
              return integratedResult(guidePath, usedModel, qa);
            }
            console.warn(`[DH/space-ad] ${model} scene guide rejected by QA:`, JSON.stringify(qa));
          } catch (editSceneErr) {
            qaAttempts.push({ candidate: `${model}_scene_integrated`, error: editSceneErr.message });
            console.warn(`[DH/space-ad] ${model} scene guide failed, try next candidate:`, editSceneErr.message);
          }
        }
        guidePath = await _generateViaDeyunaiNanoBanana({
          prompt: nanoScenePrompt,
          aspectRatio,
          filename: `${filename}_guide_scene_nb`,
          destDir,
          referenceImages: [bgRef].filter(Boolean),
          outputSize,
        });
        usedModel = 'nano-banana-pro-scene-integrated-guide';
        const qa = await _checkShowroomGuideIntegration(req, backgroundUrl, guidePath, qaPlacement);
        qaAttempts.push({ candidate: 'nano_scene_integrated', qa: _qaSummary(qa) });
        if (!qa || qa.pass) {
          return integratedResult(guidePath, usedModel, qa);
        }
        console.warn('[DH/space-ad] nano-banana scene guide rejected by QA:', JSON.stringify(qa));
        throw new Error(`nano-banana scene guide rejected by QA: ${qa.score}`);
      } catch (nanoSceneErr) {
        if (!qaAttempts.some(x => x.candidate === 'nano_scene_integrated')) {
          qaAttempts.push({ candidate: 'nano_scene_integrated', error: nanoSceneErr.message });
        }
        console.warn('[DH/space-ad] full-scene nano-banana guide failed, try isolated guide:', nanoSceneErr.message);
      }
    }
  }
  if (!forceLockedComposite && !allowIsolatedComposite) {
    throw new DhStrictError('KEYFRAME_CANDIDATES_REJECTED', 'keyframe_generate', 'AI 导览员场景内首帧候选未通过质量检查', {
      scene_candidate_details: qaAttempts,
      note: 'strict showroom preview does not fall back to isolated guide compositing',
    }, 422, true);
  }
  if (!forceLockedComposite && process.env.DH_SHOWROOM_GUIDE_ALLOW_COMPOSITE !== '1') {
    console.warn('[DH/space-ad] scene-integrated guide failed QA; falling back to isolated guide composite preview:', JSON.stringify(qaAttempts));
  }
  if (!guidePath) {
    try {
      guidePath = await avatarService._arkSeedreamGenerate({
        prompt: isolatedGuidePrompt,
        aspectRatio: '3:4',
        filename: `${filename}_guide_seedream`,
        watermark: false,
        cropBottomPx: 0,
        destDir,
      });
      usedModel = forceLockedComposite ? 'seedream-strict-isolated-guide-composite' : 'seedream-isolated-guide-composite';
    } catch (seedErr) {
      console.warn('[DH/space-ad] seedream isolated guide failed, try nano-banana isolated guide:', seedErr.message);
      guidePath = await _generateViaDeyunaiNanoBanana({
        prompt: isolatedGuidePrompt,
        aspectRatio: '3:4',
        filename: `${filename}_guide_nb`,
        destDir,
        referenceImages: [],
        outputSize: 'standard',
      });
      usedModel = forceLockedComposite ? 'nano-banana-strict-isolated-guide-composite' : 'nano-banana-guide-composite';
    }
  }

  let guideUrl = `/public/jimeng-assets/${path.basename(guidePath)}`;
  try {
    const { matteImageBuffer } = require('../services/foregroundMattingService');
    const cutout = await matteImageBuffer(fs.readFileSync(guidePath), {
      inputUrl: `${_publicBaseUrl(req)}${guideUrl}`,
      resolution: '1024x1024',
    });
    const cutoutBuf = cutout.buffer;
    const alphaStats = await sharp(cutoutBuf).ensureAlpha().extractChannel(3).stats();
    const alphaMean = alphaStats.channels?.[0]?.mean || 0;
    if (alphaMean < 2) throw new Error('matting returned empty foreground');
    const cutoutPath = path.join(destDir, `${filename}_guide_cutout.png`);
    fs.writeFileSync(cutoutPath, cutoutBuf);
    guideUrl = `/public/jimeng-assets/${path.basename(cutoutPath)}`;
  } catch (matteErr) {
    console.warn('[DH/space-ad] generated guide professional matting failed, try white-bg cutout:', matteErr.message);
    const cutout = await _prepareProductAsset(guidePath, `${filename}_guide_cutout.png`);
    if (cutout?.url) guideUrl = cutout.url;
  }

  const locked = await _createLockedAdKeyframe({
    req,
    avatarUrl: guideUrl,
    backgroundUrl,
    scene: { ...scene, role: 'showroom_guide', guidePlacement, preserveFullBackground: true },
    aspectRatio,
    outputSize,
    filename,
    destDir,
    index,
  });
  return {
    ...locked,
    referenceMode: 'generated_showroom_guide',
    plan: {
      ...locked.plan,
      kind: 'generated_showroom_guide',
      focus: '展墙讲解预览',
      fusion_model: usedModel,
      guide_gender: normalizedGuideGender,
      guide_asset_url: guideUrl,
      background_lock: forceLockedComposite ? 'original_uploaded_background_plate' : 'guided_reference',
      background_fit: forceLockedComposite ? 'contain_full_image_with_blurred_extension' : 'model_reference',
      background_context: bgDescription,
      guide_placement: guidePlacement,
    },
  };
}

async function _createGeneratedShowroomGuideKeyframe({
  req,
  backgroundUrl,
  scene = {},
  aspectRatio = '16:9',
  outputSize = 'standard',
  filename,
  destDir = JIMENG_ASSETS_DIR,
  index = 0,
  guideGender = 'female',
}) {
  const normalizedGuideGender = guideGender === 'male' ? 'male' : 'female';
  const sharp = _loadSharp();
  if (!sharp) throw new Error('sharp unavailable: cannot create showroom guide keyframe');
  const [W, H] = _outputPixels(aspectRatio, outputSize);
  const bgBuf = await _fetchImageBuffer(_absolutePublicUrl(req, backgroundUrl));
  const bgResized = await _resizeBackgroundForShot(sharp, bgBuf, W, H, {
    bgZoom: 1,
    bgPosition: 'center',
  });
  const guideGenderText = normalizedGuideGender === 'male'
    ? 'one adult male Chinese showroom guide, realistic masculine face, professional dark business outfit'
    : 'one adult female Chinese showroom guide, realistic feminine face, professional dark business outfit';
  const safeBase = `${filename}_bg_plate`;
  const bgPlatePath = path.join(destDir, `${safeBase}.jpg`);
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(bgPlatePath, bgResized);

  const maskLeft = Math.round(W * (aspectRatio === '9:16' ? 0.08 : 0.06));
  const maskTop = Math.round(H * (aspectRatio === '9:16' ? 0.08 : 0.10));
  const maskW = Math.round(W * (aspectRatio === '9:16' ? 0.58 : 0.36));
  const maskH = Math.round(H * (aspectRatio === '9:16' ? 0.90 : 0.88));
  const maskSvg = Buffer.from(`
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="black"/>
      <rect x="${maskLeft}" y="${maskTop}" width="${maskW}" height="${maskH}" rx="${Math.round(W * 0.018)}" fill="white"/>
    </svg>`);
  const maskPath = path.join(destDir, `${filename}_guide_mask.png`);
  await sharp(maskSvg).png().toFile(maskPath);

  const prompt = [
    'Only edit the white mask area. Keep every unmasked pixel from the input image unchanged.',
    `Inside the masked area add ${guideGenderText}.`,
    _showroomGuideIntegrationPrompt({ guideText: guideGenderText, side: 'left' }),
    'Static keyframe composition only: do not describe walking sequence, camera movement, parallax, rack focus, scene extension, timeline, or video action.',
    'The guide must be fully visible inside the mask: clear face, shoulders, torso and at least one presenting hand. Do not place the body outside the mask or crop it at the left edge.',
    'Use a foreground waist-up or thigh-up docent, about 24%-32% of the frame width in 16:9, sharp and in focus.',
    'First frame of a walkthrough guide video: one foot slightly forward or body angled as if just arriving, one presentation hand beginning to lift from waist level toward the display wall, eye line aligned with the display target or returning to camera. Do not create a static portrait pose.',
    'Match the original background lighting, warm color temperature, perspective, camera grain, soft contact shadow and edge softness.',
    'The surrounding metallic wall panels, texture, plant, shelf, chair, text, layout and lighting outside the mask must remain exactly the same as the uploaded background.',
    scene.voiceover || scene.text ? `Narration meaning: ${String(scene.voiceover || scene.text).slice(0, 160)}.` : '',
    'No second person, no duplicate guide, no extra people, no wrong gender, no text overlay, no watermark, no sticker, no pasted photo card, no rectangular frame.',
  ].filter(Boolean).join(' ');

  let inpaintPath = null;
  let usedModel = 'flux-fill-pro-mask';
  try {
    inpaintPath = await _generateViaReplicateFluxFill({
      req,
      imagePath: bgPlatePath,
      maskPath,
      prompt,
      filename: `${filename}_inpaint`,
      destDir,
    });
  } catch (err) {
    console.warn('[DH/space-ad] masked guide inpaint failed, fallback full-scene regional generation:', err.message);
    const bgRef = await _resolveImageForExternalApi(req, `/public/jimeng-assets/${path.basename(bgPlatePath)}`);
    const regionalPrompt = [
      'Use the provided image as the exact advertising showroom background plate.',
      'Create a realistic commercial keyframe by adding exactly one human presenter total in the left foreground third, fully visible and not cropped by the frame edge.',
      `The guide must be ${guideGenderText}.`,
      _showroomGuideIntegrationPrompt({ guideText: guideGenderText, side: 'left' }),
      'Static keyframe composition only: no walking timeline, camera movement, parallax, scene extension, rack focus or video-action storyboard.',
      'Use a sharp foreground medium-shot docent crop, waist-up or thigh-up, clear face and torso, in an active first-frame guide pose: hand beginning to lift/point toward the display wall and gaze aligned with that target or returning to camera.',
      'Match the uploaded background perspective, warm spotlights, camera height, color temperature, grain, edge softness and contact shadow.',
      'Do not create a small inset card, picture-in-picture, poster, collage, frame, sticker, cutout, floating portrait or extra people.',
      'Do not generate a second person anywhere in the frame. Do not turn background display items or reflections into people.',
      'The metallic wall panels, product texture, shelf, chair, plant and showroom layout must stay visually recognizable as the uploaded background.',
      scene.voiceover || scene.text ? `Narration meaning: ${String(scene.voiceover || scene.text).slice(0, 140)}.` : '',
    ].filter(Boolean).join(' ');
    try {
      inpaintPath = await _generateViaDeyunaiSpecificImageModel({
        model: 'gpt-image-1',
        prompt: regionalPrompt,
        aspectRatio,
        filename: `${filename}_regional_gpt`,
        destDir,
        referenceImages: [bgRef].filter(Boolean),
        outputSize,
      });
      usedModel = 'deyunai-gpt-image-mask-composite';
    } catch (gptErr) {
      console.warn('[DH/space-ad] gpt-image regional edit failed, try DeyunAI edit candidates:', gptErr.message);
      try {
        let editErr = null;
        for (const model of DEYUNAI_SHOWROOM_EDIT_MODELS) {
          try {
            inpaintPath = await _generateViaDeyunaiSpecificImageModel({
              model,
              prompt: regionalPrompt,
              aspectRatio,
              filename: `${filename}_regional_${model.replace(/[^a-z0-9]+/gi, '_')}`,
              destDir,
              referenceImages: [bgRef].filter(Boolean),
              outputSize,
            });
            usedModel = `${model}-mask-composite`;
            editErr = null;
            break;
          } catch (candidateErr) {
            editErr = candidateErr;
            console.warn(`[DH/space-ad] ${model} regional edit failed:`, candidateErr.message);
          }
        }
        if (editErr && !inpaintPath) {
          console.warn('[DH/space-ad] all DeyunAI edit candidates failed, fallback nano-banana:', editErr.message);
        }
        if (!inpaintPath) {
          inpaintPath = await _generateViaDeyunaiNanoBanana({
            prompt: regionalPrompt,
            aspectRatio,
            filename: `${filename}_regional_nb`,
            destDir,
            referenceImages: [bgRef].filter(Boolean),
            outputSize,
          });
          usedModel = 'nano-banana-pro-mask-composite';
        }
      } catch (nanoErr) {
        console.warn('[DH/space-ad] DeyunAI regional edit candidates failed:', nanoErr.message);
        throw new Error(`AI guide generation failed: ${err.message}; fallback failed: ${gptErr.message}; ${nanoErr.message}`);
      }
    }
    if (!inpaintPath) {
    throw new Error(`AI 导览员局部生成失败：${err.message}`);
    }
  }

  const softMask = await sharp(maskPath).blur(Math.max(5, Math.round(W * 0.006))).toBuffer();
  const inpaintBuf = await sharp(inpaintPath)
    .rotate()
    .resize(W, H, { fit: 'cover', position: 'center' })
    .toBuffer();
  const maskedInpaint = await sharp(inpaintBuf)
    .removeAlpha()
    .joinChannel(softMask)
    .png()
    .toBuffer();
  const finalBuf = await sharp(bgResized)
    .composite([{ input: maskedInpaint, left: 0, top: 0, blend: 'over' }])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const outPath = path.join(destDir, `${filename}.jpg`);
  fs.writeFileSync(outPath, finalBuf);
  const finalQa = await _checkShowroomGuideIntegration(req, backgroundUrl, outPath, {
    side: 'left',
    expected_gender: normalizedGuideGender,
    mask_region: { left: maskLeft, top: maskTop, width: maskW, height: maskH },
    requirement: 'one fully visible sharp presenter in the left foreground, not cropped by the edge',
  });
  if (finalQa && !finalQa.pass) {
    console.warn('[DH/space-ad] strict masked keyframe rejected by QA, try scene-integrated candidate:', JSON.stringify(finalQa));
    try {
      return await _createGeneratedGuideCompositeFallback({
        req,
        backgroundUrl,
        scene,
        aspectRatio,
        outputSize,
        filename: `${filename}_scene_candidate`,
        destDir,
        index,
        guideGender: normalizedGuideGender,
        forceLockedComposite: false,
        allowIsolatedComposite: !scene.strictNoComposite,
      });
    } catch (sceneCandidateErr) {
      if (sceneCandidateErr instanceof DhStrictError) throw sceneCandidateErr;
      throw new DhStrictError('KEYFRAME_CANDIDATES_REJECTED', 'keyframe_generate', 'AI 导览员首帧候选均未通过质量检查', {
        masked_qa: finalQa,
        scene_candidate_error: sceneCandidateErr.message,
        scene_candidate_details: sceneCandidateErr.details || null,
      }, 422, true);
    }
  }

  return {
    outPath,
    referenceMode: 'generated_showroom_guide',
    plan: {
      ..._spaceAdShotPlan(scene, index, scene.totalShots || scene.shotCount || 1, aspectRatio),
      kind: 'generated_showroom_guide',
      focus: 'AI 导览员局部生成 + 上传背景保留',
      fusion_model: usedModel,
      guide_gender: normalizedGuideGender,
      mask_region: { left: maskLeft, top: maskTop, width: maskW, height: maskH },
      prompt_debug: {
        image_contract: 'showroom_guide_keyframe_v2',
        mask_prompt_chars: prompt.length,
      },
      quality_check: finalQa,
    },
  };
}

/*
async function _createGeneratedShowroomGuideKeyframe_legacyComposite({
  req,
  backgroundUrl,
  scene = {},
  aspectRatio = '16:9',
  outputSize = 'standard',
  filename,
  destDir = JIMENG_ASSETS_DIR,
  index = 0,
  guideGender = 'female',
}) {
  const normalizedGuideGender = guideGender === 'male' ? 'male' : 'female';
  const guideGenderText = normalizedGuideGender === 'male'
    ? 'Generate exactly one adult male Chinese showroom guide. Masculine face, male body proportions, short neat hair or professional male styling, no female guide.'
    : 'Generate exactly one adult female Chinese showroom guide. Feminine face, female body proportions, neat professional styling, no male guide.';
  const guidePrompt = [
    'Create one isolated full-body showroom guide for compositing into an uploaded advertising background.',
    guideGenderText,
    'Full body from head to shoes, standing upright, not cropped, centered in frame.',
    'Active walkthrough docent first-frame pose: one foot slightly forward, torso angled toward the right side display, presentation hand beginning to lift or point, eyes aligned with the target or returning to the camera.',
    'Professional dark business outfit, realistic skin, believable body proportions, natural hands, commercial photography lighting.',
    'Shoot on a pure white seamless studio background only. No room, no showroom, no wall, no plant, no furniture, no props, no text, no watermark.',
    scene.voiceover || scene.text ? `Narration meaning: ${String(scene.voiceover || scene.text).slice(0, 160)}.` : '',
    'No extra people, no wrong gender, no beauty poster look, no cartoon, no CGI.',
  ].filter(Boolean).join(' ');
  let guidePath = null;
  let usedModel = 'nano-banana-guide-composite';
  try {
    guidePath = await _generateViaDeyunaiNanoBanana({
      prompt: guidePrompt,
      aspectRatio: '9:16',
      filename: `${filename}_guide`,
      destDir,
      referenceImages: [],
      outputSize: 'standard',
    });
  } catch (err) {
    console.warn('[DH/space-ad] generated isolated guide via nano-banana failed, fallback Seedream:', err.message);
    const avatarService = require('../services/avatarService');
    guidePath = await avatarService._arkSeedreamGenerate({
      prompt: guidePrompt,
      aspectRatio: '9:16',
      filename: `${filename}_guide_seedream`,
      watermark: false,
      cropBottomPx: 0,
      destDir,
    });
    usedModel = 'seedream-guide-composite';
  }

  let guideUrl = `/public/jimeng-assets/${path.basename(guidePath)}`;
  try {
    const cutout = await _prepareProductAsset(guidePath, `${filename}_guide_cutout.png`);
    if (cutout?.url) guideUrl = cutout.url;
  } catch (cutoutErr) {
    console.warn('[DH/space-ad] generated guide white-bg cutout failed, use matting fallback:', cutoutErr.message);
  }

  const locked = await _createLockedAdKeyframe({
    req,
    avatarUrl: guideUrl,
    backgroundUrl,
    scene: { ...scene, role: 'showroom_guide' },
    aspectRatio,
    outputSize,
    filename,
    destDir,
    index,
  });
  return {
    ...locked,
    referenceMode: 'generated_showroom_guide',
    plan: {
      ...locked.plan,
      kind: 'generated_showroom_guide',
      focus: 'AI 生成导览员 + 上传背景锁定',
      fusion_model: usedModel,
      guide_gender: normalizedGuideGender,
      guide_asset_url: guideUrl,
    },
  };
}

async function _createFusedShowroomAdKeyframe({
  req,
  avatarUrl,
  backgroundUrl,
  scene = {},
  aspectRatio = '16:9',
  outputSize = 'standard',
  filename,
  destDir = JIMENG_ASSETS_DIR,
  index = 0,
}) {
  const plan = _spaceAdShotPlan(scene, index, scene.totalShots || scene.shotCount || 1, aspectRatio);
  const presenterSide = plan.presenterPlacement === 'right' ? 'right third' : 'left third';
  const prompt = [
    'Create a realistic fused keyframe for a showroom-guide advertising digital human video.',
    'Reference image 1 is the uploaded advertising background/display wall. Preserve its main wall panels, product/material texture, color palette, shelf/sofa/display layout, lighting direction and spatial perspective. Do not replace it with a different room.',
    'Reference image 2 is the selected presenter/avatar identity reference. Use it only as identity and styling guidance: same face impression, hairstyle and outfit family, but redraw the person naturally inside the uploaded scene instead of pasting a cutout.',
    `Place one presenter on the ${presenterSide}. The presenter should occupy about 18%-26% of the frame width in 16:9, not a large talking-head host.`,
    'The right two thirds must keep the product wall/display area clearly visible and dominant.',
    'The presenter must share the same warm showroom spotlights as the background, with matching color temperature, soft contact shadow, natural edge lighting and believable scene perspective.',
    'Active brand guide posture with a clear first-frame introduction gesture: hand already lifting or pointing toward the display, realistic body proportions, integrated into the room.',
    scene.visual_prompt ? `Storyboard intent: ${scene.visual_prompt}` : '',
    scene.voiceover ? `Narration meaning: ${String(scene.voiceover).slice(0, 150)}.` : '',
    'No generated subtitles, no new logos, no watermark, no extra people, no selfie, no portrait crop, no sticker/cutout look.',
  ].filter(Boolean).join(' ');
  const refs = [
    await _resolveImageForExternalApi(req, backgroundUrl),
    await _resolveImageForExternalApi(req, avatarUrl),
  ].filter(Boolean);
  const outPath = await _generateViaDeyunaiNanoBanana({
    prompt,
    aspectRatio,
    filename,
    destDir,
    referenceImages: refs,
    outputSize,
  });
  return {
    outPath,
    plan: {
      ...plan,
      kind: 'fused_showroom_guide',
      focus: 'AI 铻嶅悎棣栧抚锛氫笂浼犺儗鏅?+ 褰㈣薄鍙傝€?,
    },
  };
}

function _buildLuxuryCharacterConsistencyLock(avatar = null) {
  if (!avatar?.image_url) return null;
  const identityName = String(avatar.name || avatar.title || avatar.nickname || 'selected presenter').trim().slice(0, 60);
  return {
    enabled: true,
    mode: 'optional_identity_reference',
    identity_name: identityName,
    stable_attributes: ['face identity', 'age impression', 'hairstyle', 'body proportions', 'outfit family', 'skin tone'],
    mutable_attributes: ['pose', 'gesture', 'expression', 'camera angle', 'lighting adaptation', 'scene placement'],
    prompt: [
      'CHARACTER CONSISTENCY LOCK: all shots that include a human must depict the same selected identity, not a new actor.',
      identityName ? `Identity label for internal continuity: ${identityName}.` : '',
      'Keep the same face topology, age impression, hairstyle, skin tone, body proportions and outfit family across every keyframe.',
      'Only pose, gesture, expression, framing, camera angle and scene lighting may change to fit the storyboard.',
      'If a shot should not feature the person, keep it product/scene focused instead of inventing another model.',
    ].filter(Boolean).join(' '),
  };
}

async function _createLuxuryAdReferenceKeyframe({
  req,
  avatar = null,
  avatarUrl = '',
  backgroundUrl,
  referenceImages = [],
  scene = {},
  aspectRatio = '16:9',
  outputSize = 'standard',
  filename,
  destDir = JIMENG_ASSETS_DIR,
  index = 0,
}) {
  const refs = [];
  async function addRef(url) {
    const value = String(url || '').trim();
    if (!value || refs.some(x => x.source === value)) return;
    const resolved = await _resolveImageForExternalApi(req, value);
    if (resolved) refs.push({ source: value, resolved });
  }
  await addRef(backgroundUrl);
  for (const url of (Array.isArray(referenceImages) ? referenceImages : [])) {
    if (refs.length >= (avatarUrl ? 3 : 4)) break;
    await addRef(url);
  }
  if (avatarUrl) await addRef(avatarUrl);
  const hasAvatar = !!String(avatarUrl || '').trim();
  const characterLock = scene.character_lock || (hasAvatar
    ? (typeof _buildLuxuryCharacterConsistencyLock === 'function'
      ? _buildLuxuryCharacterConsistencyLock(avatar)
      : {
        enabled: true,
        mode: 'optional_identity_reference',
        identity_name: String(avatar?.name || avatar?.title || avatar?.nickname || 'selected presenter').trim().slice(0, 60),
        stable_attributes: ['face identity', 'age impression', 'hairstyle', 'body proportions', 'outfit family', 'skin tone'],
        mutable_attributes: ['pose', 'gesture', 'expression', 'camera angle', 'lighting adaptation', 'scene placement'],
        prompt: 'CHARACTER CONSISTENCY LOCK: keep the same selected identity across shots that include a human; do not invent another actor.',
      })
    : null);
  const productSubject = scene.product_subject || _deriveLuxuryProductSubject({
    text: [scene.voiceover, scene.text, scene.visual, scene.visual_prompt, scene.source_text].filter(Boolean).join('\n'),
    productName: scene.title,
  });
  const productLockPrompt = scene.product_lock_prompt || _luxuryProductLockPrompt(productSubject);
  const hasAnyReference = refs.length > 0;
  const prompt = [
    'Create one premium Image2-style keyframe for a high-end commercial storyboard.',
    hasAnyReference
      ? 'Generate a NEW combined advertising keyframe from the uploaded materials. Do not return the raw reference image and do not create a plain placeholder.'
      : 'No uploaded product, scene or person reference is provided. Generate the product/service visual, scene and any needed human subject directly from the advertising brief and storyboard.',
    hasAnyReference
      ? 'Use the uploaded reference images as a material, product and scene board, not as flat pasted layers.'
      : 'Do not ask for more uploads and do not invent unrelated retail props. Keep a consistent commercial subject category across all shots.',
    hasAnyReference
      ? 'Reference image 1 is the main product/scene/brand reference for this shot. Preserve the product shape, material, lighting mood, color palette and spatial intention.'
      : productLockPrompt,
    hasAnyReference
      ? 'If reference image 2 exists, it is the CURRENT SHOT VISUAL REFERENCE. The generated keyframe must visibly follow its space, material, color palette, product surface, lighting direction and composition. Do not replace it with a generic studio product shot.'
      : '',
    hasAnyReference ? productLockPrompt : '',
    hasAnyReference
      ? 'Blend the selected shot material into a coherent commercial background/scene with product readability, realistic lighting and matching perspective.'
      : 'Build a coherent premium commercial frame with product readability, realistic lighting, believable scene design and matching perspective.',
    hasAvatar
      ? 'The last reference image is the selected human identity. Use it only as character identity, styling and face impression guidance. Redraw the person naturally inside the shot with matching lighting, perspective, contact shadows and believable body pose. Do not paste a cutout.'
      : 'No selected human identity is required. Prefer a product/brand/scene hero frame without a presenter unless the storyboard explicitly asks for an anonymous lifestyle model.',
    characterLock?.prompt || '',
    scene.visual_prompt ? `Storyboard visual intent: ${scene.visual_prompt}` : '',
    scene.image2_brief ? `Image2 brief: ${scene.image2_brief}` : '',
    scene.asset_prep ? `Asset preparation: ${scene.asset_prep}` : '',
    scene.voiceover ? `Narration meaning: ${String(scene.voiceover).slice(0, 180)}.` : '',
    scene.referenceImageCount ? `There are ${scene.referenceImageCount} uploaded reference materials in the project; this shot is using uploaded reference material ${Number(scene.referenceImageIndex || 0) + 1}. Keep that material recognizable.` : '',
    'Luxury advertising composition, cinematic but controlled, clean product readability, no generated text, no watermark, no extra random people, no face morphing.',
    'NEGATIVE: cosmetic bottle, perfume bottle, skincare bottle, lotion tube, beverage bottle, phone, watch, jewelry, unrelated packaged product, random retail prop, changing steel/material into consumer goods.',
  ].filter(Boolean).join(' ');
  const imageResult = await _generateLuxuryReferenceKeyframeImageSafe({
    req,
    prompt,
    aspectRatio,
    filename,
    destDir,
    refs,
    outputSize,
  });
  const outPath = imageResult.outPath;
  return {
    outPath,
    plan: {
      kind: hasAvatar ? 'luxury_reference_identity_redraw' : 'luxury_reference_product_scene',
      focus: hasAvatar ? '高定广告人物身份参考重绘融合' : '高定广告产品/场景参考关键帧',
      reference_count: refs.length,
      has_avatar_reference: hasAvatar,
      character_lock: characterLock ? {
        enabled: true,
        mode: characterLock.mode,
        identity_name: characterLock.identity_name,
        stable_attributes: characterLock.stable_attributes,
        mutable_attributes: characterLock.mutable_attributes,
      } : null,
      reference_sources: refs.map(x => x.source),
      referenceImageIndex: scene.referenceImageIndex ?? index,
      fusion_model: imageResult.model,
    },
  };
}

async function _createSeedreamShowroomGuideKeyframe({
  req,
  backgroundUrl,
  scene = {},
  aspectRatio = '16:9',
  outputSize = 'standard',
  filename,
  destDir = JIMENG_ASSETS_DIR,
  index = 0,
  guideGender = 'female',
}) {
  const plan = _spaceAdShotPlan(scene, index, scene.totalShots || scene.shotCount || 1, aspectRatio);
  const bgBuf = await _fetchImageBuffer(_absolutePublicUrl(req, backgroundUrl));
  const referenceBase64 = bgBuf.toString('base64');
  const normalizedGuideGender = guideGender === 'male' ? 'male' : 'female';
  const guideGenderText = normalizedGuideGender === 'male'
    ? 'Generate exactly one adult male Chinese showroom guide. Masculine face, male body proportions, short neat professional hair, no female guide.'
    : 'Generate exactly one adult female Chinese showroom guide. Feminine face, female body proportions, neat professional styling, no male guide.';
  const prompt = [
    'Use the uploaded advertising background photo as the exact scene reference and immutable background plate.',
    'Keep the exact visible wall texture, material pattern, product display, plants, furniture, room layout, perspective and lighting from the uploaded image.',
    'Generate a realistic commercial keyframe with one professional Chinese showroom guide naturally inside that same scene.',
    guideGenderText,
    'Do not paste a cutout person onto the background. Redraw the person and scene together so lighting, perspective, edge softness, grain and shadow are unified.',
    'Do not redesign the room, do not replace the display wall, and do not crop away the main display area.',
    'Place the guide on the left third of the frame. Keep the right two thirds dominated by the product/display wall.',
    'The guide should occupy about 18%-24% of frame width in 16:9, with a medium full-body or knees-visible composition, not a large talking-head crop.',
    'Warm showroom spotlights fall naturally on face, hair and clothing; add believable contact shadow and subtle rim light that matches the room.',
    'Elegant black or dark business outfit, active walkthrough docent posture, hand beginning to lift or point toward the display wall, gaze aligned with the target or returning to camera.',
    scene.visual_prompt ? `Storyboard intent: ${String(scene.visual_prompt).slice(0, 220)}.` : '',
    scene.voiceover ? `Narration meaning: ${String(scene.voiceover).slice(0, 160)}.` : '',
    'Real camera advertisement still, natural skin, realistic body proportions, no beauty poster look.',
    'No generated subtitles, no text overlay, no new logos, no watermark, no extra people, no wrong gender, no selfie, no sticker/cutout look.',
  ].filter(Boolean).join(' ');
  const avatarService = require('../services/avatarService');
  const outPath = await avatarService._arkSeedreamGenerate({
    prompt,
    referenceBase64,
    aspectRatio,
    filename,
    watermark: false,
    cropBottomPx: 0,
    destDir,
  });
  return {
    outPath,
    plan: {
      ...plan,
      kind: 'seedream_showroom_guide',
      guide_gender: normalizedGuideGender,
      focus: 'AI 鍦烘櫙鍐呭瑙堥甯э細鍙傝€冧笂浼犺儗鏅嚜鐒剁敓鎴?,
    },
  };
}
    return {
      outPath,
      referenceMode: 'generated_showroom_guide',
      plan: {
        ...plan,
        kind: 'generated_showroom_guide',
        focus: 'AI 自然生成导览员',
        fusion_model: 'nano-banana',
        guide_gender: normalizedGuideGender,
      },
    };
  } catch (err) {
    console.warn('[DH/space-ad] generated guide via image model failed, fallback Seedream:', err.message);
    const seed = await _createSeedreamShowroomGuideKeyframe({
      req,
      backgroundUrl,
      scene,
      aspectRatio,
      outputSize,
      filename: `${filename}_seedream`,
      destDir,
      index,
      guideGender: normalizedGuideGender,
    });
    return {
      ...seed,
      referenceMode: 'generated_showroom_guide',
      plan: {
        ...seed.plan,
        kind: 'generated_showroom_guide',
        focus: 'AI 自然生成导览员',
        fusion_model: 'seedream',
        guide_gender: normalizedGuideGender,
      },
    };
  }
}

async function _createFusedShowroomAdKeyframe({
  req,
  avatarUrl,
  backgroundUrl,
  scene = {},
  aspectRatio = '16:9',
  outputSize = 'standard',
  filename,
  destDir = JIMENG_ASSETS_DIR,
  index = 0,
}) {
  const plan = _spaceAdShotPlan(scene, index, scene.totalShots || scene.shotCount || 1, aspectRatio);
  const presenterSide = plan.presenterPlacement === 'right' ? 'right third' : 'left third';
  const prompt = [
    'Create a realistic fused keyframe for a showroom-guide advertising digital human video.',
    'Reference image 1 is the uploaded advertising background/display wall. Preserve its main wall panels, product/material texture, color palette, shelf/sofa/display layout, lighting direction and spatial perspective. Do not replace it with a different room.',
    'Reference image 2 is the selected presenter/avatar identity reference. Use it only as identity and styling guidance: same face impression, hairstyle and outfit family, but redraw the person naturally inside the uploaded scene instead of pasting a cutout.',
    `Place one presenter on the ${presenterSide}. The presenter should occupy about 18%-26% of the frame width in 16:9, not a large talking-head host.`,
    'The right two thirds must keep the product wall/display area clearly visible and dominant.',
    'The presenter must share the same warm showroom spotlights as the background, with matching color temperature, soft contact shadow, natural edge lighting and believable scene perspective.',
    'Active brand guide posture with a clear first-frame introduction gesture: hand already lifting or pointing toward the display, realistic body proportions, integrated into the room.',
    scene.visual_prompt ? `Storyboard intent: ${scene.visual_prompt}` : '',
    scene.voiceover ? `Narration meaning: ${String(scene.voiceover).slice(0, 150)}.` : '',
    'No generated subtitles, no new logos, no watermark, no extra people, no selfie, no portrait crop, no sticker/cutout look.',
  ].filter(Boolean).join(' ');
  const refs = [
    await _resolveImageForExternalApi(req, backgroundUrl),
    await _resolveImageForExternalApi(req, avatarUrl),
  ].filter(Boolean);
  const outPath = await _generateViaDeyunaiNanoBanana({
    prompt,
    aspectRatio,
    filename,
    destDir,
    referenceImages: refs,
    outputSize,
  });
  return {
    outPath,
    plan: {
      ...plan,
      kind: 'fused_showroom_guide',
      focus: 'AI 融合首帧：上传背景 + 形象参考',
    },
  };
}

async function _createSeedreamShowroomGuideKeyframe({
  req,
  backgroundUrl,
  scene = {},
  aspectRatio = '16:9',
  outputSize = 'standard',
  filename,
  destDir = JIMENG_ASSETS_DIR,
  index = 0,
  guideGender = 'female',
}) {
  const plan = _spaceAdShotPlan(scene, index, scene.totalShots || scene.shotCount || 1, aspectRatio);
  const bgBuf = await _fetchImageBuffer(_absolutePublicUrl(req, backgroundUrl));
  const referenceBase64 = bgBuf.toString('base64');
  const normalizedGuideGender = guideGender === 'male' ? 'male' : 'female';
  const guideGenderText = normalizedGuideGender === 'male'
    ? 'Generate exactly one adult male Chinese showroom guide. Masculine face, male body proportions, short neat professional hair, no female guide.'
    : 'Generate exactly one adult female Chinese showroom guide. Feminine face, female body proportions, neat professional styling, no male guide.';
  const prompt = [
    'Use the uploaded advertising background photo as the exact scene reference and immutable background plate.',
    'Keep the exact visible wall texture, material pattern, product display, plants, furniture, room layout, perspective and lighting from the uploaded image.',
    'Generate a realistic commercial keyframe with one professional Chinese showroom guide naturally inside that same scene.',
    guideGenderText,
    'Do not paste a cutout person onto the background. Redraw the person and scene together so lighting, perspective, edge softness, grain and shadow are unified.',
    'Do not redesign the room, do not replace the display wall, and do not crop away the main display area.',
    'Place the guide on the left third of the frame. Keep the right two thirds dominated by the product/display wall.',
    'The guide should occupy about 18%-24% of frame width in 16:9, with a medium full-body or knees-visible composition, not a large talking-head crop.',
    'Warm showroom spotlights fall naturally on face, hair and clothing; add believable contact shadow and subtle rim light that matches the room.',
    'Elegant black or dark business outfit, active walkthrough docent posture, hand beginning to lift or point toward the display wall, gaze aligned with the target or returning to camera.',
    scene.visual_prompt ? `Storyboard intent: ${String(scene.visual_prompt).slice(0, 220)}.` : '',
    scene.voiceover ? `Narration meaning: ${String(scene.voiceover).slice(0, 160)}.` : '',
    'Real camera advertisement still, natural skin, realistic body proportions, no beauty poster look.',
    'No generated subtitles, no text overlay, no new logos, no watermark, no extra people, no wrong gender, no selfie, no sticker/cutout look.',
  ].filter(Boolean).join(' ');
  const avatarService = require('../services/avatarService');
  const outPath = await avatarService._arkSeedreamGenerate({
    prompt,
    referenceBase64,
    aspectRatio,
    filename,
    watermark: false,
    cropBottomPx: 0,
    destDir,
  });
  return {
    outPath,
    plan: {
      ...plan,
      kind: 'seedream_showroom_guide',
      guide_gender: normalizedGuideGender,
      focus: 'AI 场景内导览首帧：参考上传背景自然生成',
    },
  };
}

*/
async function _generateLuxuryReferenceKeyframeImageSafe({
  req,
  prompt,
  aspectRatio,
  filename,
  destDir,
  refs = [],
  outputSize = 'standard',
}) {
  const attempts = [];
  const referenceImages = refs.map(x => x.resolved).filter(Boolean);
  const hasShotReferenceLock = referenceImages.length > 1;
  const primary = refs[0]?.source || refs[0]?.resolved;
  const shortError = err => String(err?.message || err || 'unknown error').replace(/\s+/g, ' ').slice(0, 220);
  const addAttempt = (model, ok, err = null) => {
    attempts.push({
      provider_id: model?.provider_id || model?.provider || 'deyunai',
      model_id: model?.model_id || model?.model || 'nano-banana',
      ok: !!ok,
      error: err ? shortError(err) : '',
    });
  };
  const runSeedream = async (model, suffix) => {
    if (!primary) throw new Error('缺少主商品/参考图，无法生成高定广告关键帧');
    const avatarService = require('../services/avatarService');
    const refBuf = await _fetchImageBuffer(_absolutePublicUrl(req, primary));
    return avatarService._arkSeedreamGenerate({
      prompt: [
        prompt,
        'Use the uploaded product/reference image as the main visual anchor. Preserve the product and produce a premium commercial keyframe.',
      ].join(' '),
      referenceBase64: refBuf.toString('base64'),
      aspectRatio,
      filename: `${filename}_${suffix}`,
      watermark: false,
      cropBottomPx: 0,
      destDir,
    });
  };
  const runCandidate = async (model, idx) => {
    const provider = String(model?.provider_id || '').toLowerCase();
    const modelId = String(model?.model_id || '').toLowerCase();
    if (provider === 'deyunai') {
      if (/nano-banana/.test(modelId)) {
        return _generateViaDeyunaiNanoBanana({
          prompt,
          aspectRatio,
          filename: `${filename}_deyunai_${idx}`,
          destDir,
          referenceImages,
          outputSize,
        });
      }
      return _generateViaDeyunaiSpecificImageModel({
        model: model.model_id,
        prompt,
        aspectRatio,
        filename: `${filename}_deyunai_${idx}`,
        destDir,
        referenceImages,
        outputSize,
      });
    }
    if (provider === 'volcengine' || provider === 'api-key-20260404180437' || /seedream|jimeng-t2i|t2i|image/.test(modelId)) {
      return runSeedream(model, `seedream_${idx}`);
    }
    throw new Error(`关键帧阶段不支持 ${provider || 'unknown'}/${modelId || 'unknown'}，该模型可能属于图生视频或口型同步阶段`);
  };

  const nanoModel = { provider_id: 'deyunai', model_id: 'nano-banana' };
  try {
    const outPath = await _generateViaDeyunaiNanoBanana({
      prompt,
      aspectRatio,
      filename: `${filename}_deyunai_nano`,
      destDir,
      referenceImages,
      outputSize,
    });
    addAttempt(nanoModel, true);
    return { outPath, model: 'deyunai-nano-banana', attempts };
  } catch (err) {
    addAttempt(nanoModel, false, err);
    console.warn('[DH/luxury-ad] DeyunAI nano-banana keyframe failed, trying configured image models:', shortError(err));
  }

  const configuredModels = _uniquePipelineModels([
    ..._pickRunnablePipelineModels('luxury_ad.keyframe'),
    ..._pickRunnablePipelineModels('ad_avatar.keyframe'),
    ..._pickRunnablePipelineModels('avatar.image_gen'),
    ...(hasShotReferenceLock ? [] : [{ provider_id: 'seedream-fallback', model_id: 'ark-seedream', enabled: true, priority: 999 }]),
  ]).filter(model => {
    const provider = String(model?.provider_id || '').toLowerCase();
    const modelId = String(model?.model_id || '').toLowerCase();
    if (hasShotReferenceLock && provider !== 'deyunai') return false;
    return !(provider === 'deyunai' && /nano-banana/.test(modelId));
  });

  for (let i = 0; i < configuredModels.length; i++) {
    const model = configuredModels[i];
    try {
      const outPath = await runCandidate(model, i + 1);
      addAttempt(model, true);
      return { outPath, model: `${model.provider_id}/${model.model_id}`, attempts };
    } catch (err) {
      addAttempt(model, false, err);
      console.warn(`[DH/luxury-ad] keyframe provider failed ${_pipelineModelLabel(model)}:`, shortError(err));
    }
  }

  const limitHit = attempts.some(a => /SetLimitExceeded|inference limit|safe experience mode|quota|rate limit|额度|上限/i.test(a.error));
  const summary = attempts
    .filter(a => a.model_id)
    .map(a => `${a.provider_id}/${a.model_id}${a.ok ? ' 成功' : ` 失败：${a.error || '未知错误'}`}`)
    .join('；');
  const err = new Error([
    '高定广告片关键帧图片生成失败。',
    summary ? `已尝试：${summary}。` : '',
    hasShotReferenceLock ? '当前镜头已绑定参考图，本次不会降级到只看主商品的自由生图模型。' : '',
    'Topview、可灵、海螺属于后续图生视频阶段，必须先生成关键帧图片后才会执行。',
  ].filter(Boolean).join(''));
  err.status = limitHit ? 429 : 500;
  err.code = limitHit ? 'PROVIDER_LIMIT_EXCEEDED' : 'LUXURY_KEYFRAME_PROVIDERS_FAILED';
  err.luxuryKeyframeAttempts = attempts;
  throw err;
}

async function _createLuxuryAdReferenceKeyframeFallback({
  req,
  avatar = null,
  avatarUrl = '',
  backgroundUrl,
  referenceImages = [],
  scene = {},
  aspectRatio = '16:9',
  outputSize = 'standard',
  filename,
  destDir = JIMENG_ASSETS_DIR,
  index = 0,
}) {
  const refs = [];
  async function addRef(url) {
    const value = String(url || '').trim();
    if (!value || refs.some(x => x.source === value)) return;
    const resolved = await _resolveImageForExternalApi(req, value);
    if (resolved) refs.push({ source: value, resolved });
  }
  await addRef(backgroundUrl);
  for (const url of (Array.isArray(referenceImages) ? referenceImages : [])) {
    if (refs.length >= (avatarUrl ? 3 : 4)) break;
    await addRef(url);
  }
  if (avatarUrl) await addRef(avatarUrl);
  const hasAvatar = !!String(avatarUrl || '').trim();
  const characterLock = scene.character_lock || (hasAvatar ? {
    enabled: true,
    mode: 'optional_identity_reference',
    identity_name: String(avatar?.name || avatar?.title || avatar?.nickname || 'selected presenter').trim().slice(0, 60),
    stable_attributes: ['face identity', 'age impression', 'hairstyle', 'body proportions', 'outfit family', 'skin tone'],
    mutable_attributes: ['pose', 'gesture', 'expression', 'camera angle', 'lighting adaptation', 'scene placement'],
    prompt: 'CHARACTER CONSISTENCY LOCK: keep the same selected identity across shots that include a human; do not invent another actor.',
  } : null);
  const productSubject = scene.product_subject || _deriveLuxuryProductSubject({
    text: [scene.voiceover, scene.text, scene.visual, scene.visual_prompt, scene.source_text].filter(Boolean).join('\n'),
    productName: scene.title,
  });
  const productLockPrompt = scene.product_lock_prompt || _luxuryProductLockPrompt(productSubject);
  const hasAnyReference = refs.length > 0;
  const prompt = [
    'Create one premium image-to-image keyframe for a high-end product commercial storyboard.',
    hasAnyReference
      ? 'Reference image 1 is the main product or primary visual anchor. Preserve product identity, material, shape, color and recognisable selling point.'
      : 'No uploaded product or scene reference is provided. Generate the product/service visual, scene and any needed human subject directly from the storyboard and advertising brief; do not ask for more uploads.',
    hasAnyReference
      ? 'If reference image 2 exists, it is the CURRENT SHOT VISUAL REFERENCE. Follow its scene/material/lighting/composition closely and keep it recognizable in the generated keyframe.'
      : '',
    hasAnyReference ? productLockPrompt : '',
    hasAnyReference
      ? 'Other reference images are optional scene, brand, texture or detail references. Use them as visual guidance only; do not replace the main product.'
      : 'Keep a consistent commercial subject category across shots based on the brief, with premium composition and no random unrelated products.',
    'Generate a coherent advertising frame with cinematic lighting, realistic perspective, clean product readability and premium commercial composition.',
    hasAvatar
      ? 'The last reference image may be a selected human identity. Use it only as identity guidance and redraw the person naturally inside the scene.'
      : 'No presenter is required. Prefer product, brand and scene storytelling without inventing a random host.',
    characterLock?.prompt || '',
    scene.visual_prompt ? `Storyboard visual intent: ${scene.visual_prompt}` : '',
    scene.image2_brief ? `Image2 brief: ${scene.image2_brief}` : '',
    scene.asset_prep ? `Asset preparation: ${scene.asset_prep}` : '',
    scene.voiceover ? `Narration meaning: ${String(scene.voiceover).slice(0, 180)}.` : '',
    'No generated subtitles, no text overlay, no watermark, no extra random people, no product redesign.',
    'NEGATIVE: cosmetic bottle, perfume bottle, skincare bottle, lotion tube, beverage bottle, phone, watch, jewelry, unrelated packaged product, random retail prop, changing steel/material into consumer goods.',
  ].filter(Boolean).join(' ');
  const imageResult = await _generateLuxuryReferenceKeyframeImageSafe({
    req,
    prompt,
    aspectRatio,
    filename,
    destDir,
    refs,
    outputSize,
  });
  const outPath = imageResult.outPath;
  return {
    outPath,
    plan: {
      kind: hasAvatar ? 'luxury_reference_identity_redraw' : 'luxury_reference_product_scene',
      focus: hasAvatar ? '高定广告人物身份参考重绘融合' : '高定广告产品/场景参考关键帧',
      reference_count: refs.length,
      has_avatar_reference: hasAvatar,
      character_lock: characterLock ? {
        enabled: true,
        mode: characterLock.mode,
        identity_name: characterLock.identity_name,
        stable_attributes: characterLock.stable_attributes,
        mutable_attributes: characterLock.mutable_attributes,
      } : null,
      reference_sources: refs.map(x => x.source),
      referenceImageIndex: scene.referenceImageIndex ?? index,
      fallback_scope_safe: true,
      fusion_model: imageResult.model,
    },
  };
}

async function _runSpaceStoryboardTask(req, taskId, payload) {
  const { avatar, backgroundUrl, text, voiceId, title, scenePrompt, durationSec, segments, speechSegments = [], subtitle, adMode = 'digital_ad', adStyle = 'luxury_soft', shotCount = 4, keyframes: providedKeyframes = [], guideGender = 'female', aspectRatio: rawAspectRatio = '16:9', outputSize: rawOutputSize = 'standard' } = payload;
  const aspectRatio = _normalizeAspectRatio(rawAspectRatio, '16:9');
  const outputSize = _normalizeOutputSize(rawOutputSize);
  const isLuxury = adMode === 'luxury_ad';
  const isShowroomGuide = adMode === 'showroom_guide';
  const bgmAsset = isLuxury ? _luxuryBgmAssetFromPayload(payload) : null;
  const luxuryPayloadRefCount = isLuxury && Array.isArray(payload.reference_images)
    ? payload.reference_images.filter(Boolean).length
    : 0;
  const maxStoryboardShots = isLuxury
    ? (luxuryPayloadRefCount > 0
      ? Math.max(1, Math.min(luxuryPayloadRefCount, Math.round(Number(shotCount) || luxuryPayloadRefCount)))
      : Math.max(1, Math.min(8, Math.round(Number(shotCount) || 6))))
    : (isShowroomGuide ? 1 : 5);
  const taskDir = path.join(JIMENG_ASSETS_DIR, `digital_ad_${taskId}`);
  fs.mkdirSync(taskDir, { recursive: true });
  const base = _publicBaseUrl(req);
  try {
    _taskPatch(taskId, { status: 'running', stage: 'storyboard', progress: 8, message: isLuxury ? '生成高定广告片分镜' : (isShowroomGuide ? '生成展墙讲解单镜头' : '生成广告数字人分镜') });
    const guideSegments = Array.isArray(segments) && segments.length
      ? segments.slice(0, maxStoryboardShots)
      : (isShowroomGuide
        ? [{
          title: '单镜头展墙讲解',
          text: String(text || '').trim(),
          voiceover: String(text || '').trim(),
          start: 0,
          end: Math.max(8, Number(durationSec) || Math.ceil(String(text || '').length / 4) || 10),
          duration: Math.max(8, Number(durationSec) || Math.ceil(String(text || '').length / 4) || 10),
          role: 'showroom_guide',
        }]
        : _fallbackGuideSegments(text, Math.max(12, Number(durationSec) || Math.ceil(String(text).length / 4))));
    const luxuryProductName = payload.product_name || payload.productName || payload.product?.name || payload.product_asset?.name || '';
    const productSubject = isLuxury ? _deriveLuxuryProductSubject({
      text: [text, scenePrompt, payload.asset_summary || payload.assetSummary || '', JSON.stringify(guideSegments || [])].join('\n'),
      productName: luxuryProductName,
      assetSummary: payload.asset_summary || payload.assetSummary || '',
    }) : '';
    const scenes = isLuxury
      ? _normalizeProvidedLuxuryStoryboardSegments(guideSegments, {
        text,
        durationSec,
        shotCount,
        productSubject,
        adStyle,
      })
      : await _buildSpaceAdStoryboard({ title, text, durationSec, segments: guideSegments, scenePrompt, adMode, adStyle, shotCount });
    _taskPatch(taskId, { scenes, progress: 15 });

    let keyframes = Array.isArray(providedKeyframes)
      ? providedKeyframes.filter(k => k && k.image_url).map((k, i) => ({ ...(scenes[i] || {}), ...k }))
      : [];
    if (keyframes.length) {
      _taskPatch(taskId, { stage: 'keyframes', progress: 42, message: '使用已确认的预览图', keyframes, keyframeUrl: keyframes[0]?.image_url, image_url: keyframes[0]?.image_url, thumbnail_url: keyframes[0]?.image_url });
    } else {
      keyframes = [];
      for (let i = 0; i < scenes.length; i++) {
        const sc = scenes[i];
        _taskPatch(taskId, { stage: 'keyframes', progress: 15 + Math.round((i / scenes.length) * 28), message: `${isLuxury ? '生成高定关键帧' : '生成广告预览图'} ${i + 1}/${scenes.length}` });
        const keyframeMaker = isLuxury
          ? (typeof _createLuxuryAdReferenceKeyframe === 'function' ? _createLuxuryAdReferenceKeyframe : _createLuxuryAdReferenceKeyframeFallback)
          : isShowroomGuide
          ? (avatar?.image_url ? _createNaturalShowroomAdKeyframe : _createGeneratedShowroomGuideKeyframe)
          : _createLockedAdKeyframe;
        const { outPath: keyframePath, plan: shotPlan } = await keyframeMaker({
          req,
          avatar,
          avatarUrl: avatar?.image_url || '',
          backgroundUrl,
          scene: { ...sc, totalShots: scenes.length },
          aspectRatio,
          outputSize,
          filename: `digital_ad_${taskId}_kf_${String(i + 1).padStart(2, '0')}`,
          destDir: JIMENG_ASSETS_DIR,
          index: i,
          guideGender,
        });
        const url = `${base}/public/jimeng-assets/${path.basename(keyframePath)}`;
        keyframes.push({
          ...sc,
          image_url: url,
          local_path: keyframePath,
          reference_mode: shotPlan?.kind === 'integrated_avatar_background'
            ? 'integrated_avatar_background'
            : (shotPlan?.kind === 'generated_showroom_guide' ? 'generated_showroom_guide' : 'locked_composite'),
          shot_plan: shotPlan,
          source_avatar_url: avatar?.image_url || '',
          source_background_url: backgroundUrl,
        });
        _taskPatch(taskId, { keyframes, keyframeUrl: keyframes[0]?.image_url, image_url: keyframes[0]?.image_url, thumbnail_url: keyframes[0]?.image_url });
      }
    }

    const pipelineVideoModels = _uniquePipelineModels(isLuxury
      ? _pickRunnablePipelineModels('luxury_ad.video')
      : _pickRunnablePipelineModels('ad_avatar.marketing_video'));
    const pipelineVideoModel = pipelineVideoModels[0] || null;
    const pipelineLipSyncModel = _pickRunnablePipelineModel('ad_avatar.lip_sync') || _pickRunnablePipelineModel('avatar.lip_sync');
    const providerErrors = [];
    const tryLipSyncPipeline = async () => {
      if (!_isLipSyncPipelineModel(pipelineLipSyncModel)) return false;
      try {
        await _runAdLipSyncPipelineVideo(req, taskId, {
          keyframes,
          scenes,
          text,
          voiceId,
          title,
          scenePrompt,
          cameraPrompt: payload.cameraPrompt || '',
          durationSec,
          segments,
          speechSegments,
          subtitle,
          aspectRatio,
          outputSize,
          adMode,
          adStyle,
          pipelineLipSyncModel,
        });
        return true;
      } catch (lipErr) {
        providerErrors.push(`${_pipelineModelLabel(pipelineLipSyncModel)}: ${lipErr.message}`);
        console.error('[DH/space-ad/storyboard] lip-sync pipeline failed:', lipErr);
        _taskPatch(taskId, {
          stage: 'ad_lip_sync_error',
          progress: 56,
          message: `口型同步链路失败：${lipErr.message}`,
        });
        return false;
      }
    };
    // Showroom-guide ads need full-scene motion first. Lip-sync/avatar routes are only a fallback,
    // because they mostly animate mouth/head and then post-process crop/zoom the whole frame.
    let seedancePipelineModel = null;
    for (const candidateVideoModel of pipelineVideoModels) {
      if (_isSeedancePipelineModel(candidateVideoModel)) {
        // Only run Seedance when it is explicitly enabled in model-call management.
        // This keeps luxury ads from using a hidden fallback while still allowing real manual switching.
        seedancePipelineModel = seedancePipelineModel || candidateVideoModel;
        continue;
      }
      if (isLuxury && _isTopviewImageToVideoPipelineModel(candidateVideoModel)) {
        try {
          await _runTopviewLuxuryImageToVideo(req, taskId, {
            text,
            voiceId,
            title,
            scenePrompt,
            keyframes,
            scenes,
            aspectRatio,
            outputSize,
            adMode,
            adStyle,
            subtitle,
            bgmAsset,
            pipelineVideoModel: candidateVideoModel,
          });
          return;
        } catch (topviewI2vErr) {
          providerErrors.push(`${_pipelineModelLabel(candidateVideoModel)}: ${topviewI2vErr.message}`);
          console.error('[DH/space-ad/storyboard] Topview Image2Video pipeline failed:', topviewI2vErr.message);
          _taskPatch(taskId, {
            stage: 'topview_i2v_error',
            progress: 54,
            message: `Topview Image2Video failed, trying next provider: ${topviewI2vErr.message}`,
          });
        }
        continue;
      }
      if (isLuxury && _isTopviewPipelineModel(candidateVideoModel)) {
        providerErrors.push(`${_pipelineModelLabel(candidateVideoModel)}: 高定广告片只支持 Topview Image2Video，不使用 Topview M2V/Avatar 链路`);
        continue;
      }
      if (_isTopviewPipelineModel(candidateVideoModel)) {
        try {
          await _runTopviewAdMarketingVideo(req, taskId, {
            avatar,
            backgroundUrl,
            text,
            voiceId,
            title,
            scenePrompt,
            durationSec,
            keyframes,
            scenes,
            aspectRatio,
            outputSize,
            adMode,
            adStyle,
            pipelineVideoModel: candidateVideoModel,
          });
          return;
        } catch (topviewErr) {
          providerErrors.push(`${_pipelineModelLabel(candidateVideoModel)}: ${topviewErr.message}`);
        console.error('[DH/space-ad/storyboard] Topview pipeline failed:', topviewErr.message);
          _taskPatch(taskId, {
            stage: 'topview_m2v_error',
            progress: 54,
            message: `Topview video failed, trying next provider: ${topviewErr.message}`,
          });
        }
        continue;
      }
      if (_isDeyunaiVideoPipelineModel(candidateVideoModel)) {
        try {
          await _runDeyunaiAdMarketingVideo(req, taskId, {
            text,
            voiceId,
            title,
            scenePrompt,
            durationSec,
            keyframes,
            scenes,
            aspectRatio,
            outputSize,
            adMode,
            adStyle,
            subtitle,
            bgmAsset,
            pipelineVideoModel: candidateVideoModel,
          });
          return;
        } catch (deyunaiErr) {
          providerErrors.push(`${_pipelineModelLabel(candidateVideoModel)}: ${deyunaiErr.message}`);
          console.error('[DH/space-ad/storyboard] DeyunAI video pipeline failed:', deyunaiErr.message);
          _taskPatch(taskId, {
            stage: 'deyunai_i2v_error',
            progress: 54,
            message: `DeyunAI video failed, trying next provider: ${deyunaiErr.message}`,
          });
        }
        continue;
      }
      providerErrors.push(`${_pipelineModelLabel(candidateVideoModel)}: unsupported video pipeline`);
    }
    if (!isShowroomGuide && !isLuxury && await tryLipSyncPipeline()) return;
    const preferredVideoModel = seedancePipelineModel || (!isLuxury && _isSeedancePipelineModel(pipelineVideoModel) ? pipelineVideoModel : null);
    if (isLuxury && !preferredVideoModel) {
      const detail = providerErrors.length ? `已按模型调用管理顺序尝试：${providerErrors.join('；').slice(0, 800)}` : '没有可用的高定广告片图生视频模型';
      throw new Error(`高定广告片图生视频生成失败：${detail}`);
    }
    const { _seedanceAVGenerate } = require('../services/avatarService');
    const { apiKey, model } = _getSeedanceAdConfig(preferredVideoModel);
    const clips = [];
    const videoKbContext = _buildDhKbContext(
      isShowroomGuide ? 'showroom_guide' : 'digital_ad',
      _dhKbQuery(title, text, scenePrompt, keyframes, scenes, adMode, adStyle),
      { limit: 4, maxCharsPerDoc: 520 }
    );
    try {
      for (let i = 0; i < keyframes.length; i++) {
        const kf = keyframes[i];
        _taskPatch(taskId, { stage: 'video', progress: 45 + Math.round((i / keyframes.length) * 35), message: `${isLuxury ? '生成高定广告镜头' : '生成广告镜头'} ${i + 1}/${keyframes.length}` });
        const prompt = [
          kf.video_prompt,
          kf.workflow_type === 'luxury_ad_storyboard' ? `Luxury workflow metadata: ${JSON.stringify(_compactLuxuryShotMeta(kf)).slice(0, 1000)}.` : '',
          videoKbContext ? `Knowledge-base direction:\n${videoKbContext}` : '',
          `Voiceover meaning: ${kf.voiceover || ''}`,
          isLuxury ? `Style: ${_luxuryAdStylePrompt(adStyle)}.` : '',
          isShowroomGuide ? 'Single continuous showroom-guide shot: presenter begins near the left third, may take small guided steps or a forward settling movement, and keeps the right display wall visible. No cuts or scene replacement.' : '',
          isShowroomGuide ? _showroomGuideMotionBible({ text: kf.voiceover || text, scenePrompt }) : '',
          isShowroomGuide ? _adPresenterActionPrompt({ scenePrompt, text: kf.voiceover || text }) : '',
          isShowroomGuide ? 'Scene extension: animate the still frame with a subtle push-in, slight lateral parallax, gentle focus shift across wall/material details, and natural lighting continuity. The background should feel like a real video space, not a frozen flat image.' : '',
          'Keep the presenter identity, face, outfit and the background stable from the keyframe. Smooth natural talking and guide gestures, subtle camera movement, no face morphing, no scene replacement, no generated text.',
        ].join(' ');
        const storyboardDuration = Math.max(1, Math.min(12, Number(kf.duration) || 5));
        const seedanceDuration = (isShowroomGuide || isLuxury)
          ? Math.max(5, Math.min(10, storyboardDuration))
          : (kf.duration || 4);
        const { videoBuffer } = await _seedanceAVGenerate(
          kf.image_url,
          prompt,
          model,
          apiKey,
          info => _taskPatch(taskId, { message: info.message || `Seedance 广告镜头 ${i + 1}` }),
          { ratio: aspectRatio, duration: seedanceDuration, hasAudio: false, allowCameraMove: isShowroomGuide }
        );
        const clipPath = path.join(taskDir, `clip_${String(i + 1).padStart(2, '0')}.mp4`);
        if (isLuxury) {
          const rawClipPath = path.join(taskDir, `clip_${String(i + 1).padStart(2, '0')}_raw.mp4`);
          fs.writeFileSync(rawClipPath, videoBuffer);
          await _trimVideoClipToStoryboardDuration(rawClipPath, clipPath, storyboardDuration, aspectRatio, outputSize);
        } else {
          fs.writeFileSync(clipPath, videoBuffer);
        }
        clips.push(clipPath);
      }
    } catch (seedanceErr) {
      providerErrors.push(`${model}: ${seedanceErr.message}`);
      const detail = providerErrors.length ? `；已尝试：${providerErrors.join('；').slice(0, 500)}` : '';
      throw new Error(`${isLuxury ? '高定广告片' : '广告'}图生视频生成失败：${seedanceErr.message}${detail}`);
    }

    _taskPatch(taskId, { stage: 'post_effects', progress: 84, message: isLuxury ? '平滑拼接高定广告镜头' : '平滑拼接广告镜头' });
    const concatPath = path.join(taskDir, 'digital_ad_concat.mp4');
    await _concatVideosSmooth(clips, concatPath, aspectRatio, outputSize);
    const voiceSegments = isShowroomGuide && Array.isArray(speechSegments) && speechSegments.some(s => s?.text)
      ? speechSegments.filter(s => s?.text).map((s, i, arr) => ({
        text: String(s.text || '').trim(),
        tone: s.tone || _productVoiceTone('', i, arr.length),
        start: s.start,
        end: s.end,
        duration: s.duration,
      }))
      : _voiceSegmentsFromKeyframes(keyframes, text || title || '');
    const voiceover = voiceSegments.map(s => s.text).filter(Boolean).join('，') || text;
    let finalPath = concatPath;
    if (voiceover) {
      try {
        _taskPatch(taskId, { message: '合成广告口播音频' });
        const { generateSpeech } = require('../services/ttsService');
        const audioBase = path.join(taskDir, 'voiceover');
        let audioPath = await _synthesizeSegmentedSpeechFile(req, {
          text: voiceover,
          voiceId: voiceId || null,
          segments: voiceSegments,
          outputBase: audioBase,
        });
        if (!audioPath) audioPath = await generateSpeech(voiceover, audioBase, { voiceId: voiceId || null, speed: 1.0 });
        const muxPath = path.join(taskDir, 'digital_ad_audio.mp4');
        if (isShowroomGuide) await _muxAudioWithLoopedVideo(concatPath, audioPath, muxPath, aspectRatio, outputSize);
        else await _muxAudio(concatPath, audioPath, muxPath);
        finalPath = muxPath;
      } catch (audioErr) {
        console.warn('[DH/space-ad] voiceover failed:', audioErr.message);
      }
    }

    if (subtitle?.show !== false && voiceover) {
      try {
        _taskPatch(taskId, { message: '烧录广告字幕' });
        const { applyEffects } = require('../services/effectsService');
        let cursor = 0;
        const texts = keyframes.filter(k => k.voiceover).map(k => {
          const startTime = cursor;
          cursor += Number(k.duration) || 4;
          return {
            text: k.voiceover,
            preset: 'subtitle',
            position: 'bottom',
            startTime,
            endTime: cursor,
            fontName: subtitle?.fontName || '抖音美好体',
            fontSize: subtitle?.fontSize || 64,
            color: subtitle?.color || '#FFFFFF',
            outlineColor: subtitle?.outlineColor || '#000000',
          };
        });
        const fx = await applyEffects({ videoPath: finalPath, texts });
        if (fx?.outputPath && fs.existsSync(fx.outputPath)) finalPath = fx.outputPath;
      } catch (fxErr) {
        console.warn('[DH/space-ad] subtitle failed:', fxErr.message);
      }
    }

    if (isLuxury) {
      finalPath = await _applyLuxuryBgmIfConfigured(taskId, finalPath, bgmAsset);
    }

    const clipAssets = _publishAdClipAssets(req, taskId, clips, isLuxury ? 'luxury_seedance_clip' : 'ad_seedance_clip');
    const taskData = {
      id: taskId,
      status: 'done',
      stage: 'done',
      title: title || (isLuxury ? '高定广告片' : '广告数字人'),
      text: voiceover || text,
      scenes,
      keyframes: keyframes.map(_publicAdKeyframeMeta),
      clips: clipAssets,
      clip_urls: clipAssets.map(x => x.video_url || x.url).filter(Boolean),
      videoPath: finalPath,
      videoUrl: `/api/avatar/tasks/${taskId}/stream`,
      video_url: `/api/avatar/tasks/${taskId}/stream`,
      image_url: keyframes[0]?.image_url || '',
      thumbnail_url: keyframes[0]?.image_url || '',
      keyframeUrl: keyframes[0]?.image_url || '',
      kind: 'production',
      mode: isLuxury ? 'luxury_ad' : 'digital_ad',
      generation_mode: isLuxury ? 'luxury_storyboard' : (isShowroomGuide ? 'showroom_guide' : 'storyboard'),
      ad_mode: adMode,
      ad_style: adStyle,
      shot_count: scenes.length,
      user_id: productAdTasks.get(taskId)?.user_id,
      ratio: aspectRatio,
      output_size: outputSize,
      resolution: _outputSizeString(aspectRatio, outputSize),
      model,
      provider_id: preferredVideoModel?.provider_id || 'seedance',
      pipeline_video_provider: preferredVideoModel?.provider_id || 'seedance',
      pipeline_video_model: model,
      created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
    };
    productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
    if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
    else db.updateAvatarTask(taskId, taskData);
  } catch (err) {
    console.error('[DH/space-ad/storyboard] failed:', err);
    _taskPatch(taskId, { status: 'error', stage: 'error', error: err.message, message: err.message });
    try {
      if (!db.getAvatarTask(taskId)) {
        const t = productAdTasks.get(taskId);
        db.insertAvatarTask({ ...t, status: 'error', error: err.message, kind: 'production', mode: isLuxury ? 'luxury_ad' : 'digital_ad', generation_mode: isLuxury ? 'luxury_storyboard' : (isShowroomGuide ? 'showroom_guide' : 'storyboard') });
      }
    } catch {}
  }
}

async function _runSpaceGuideTask(req, taskId, payload) {
  const { avatar, backgroundUrl, text, voiceId, title, scene, camera, scenePrompt, cameraPrompt, durationSec, segments, subtitle, generationMode = 'storyboard', adMode = 'digital_ad', aspectRatio: rawAspectRatio = '16:9', outputSize: rawOutputSize = 'standard' } = payload;
  const aspectRatio = _normalizeAspectRatio(rawAspectRatio, '16:9');
  const outputSize = _normalizeOutputSize(rawOutputSize);
  if (generationMode === 'storyboard' || generationMode === 'luxury_storyboard' || generationMode === 'showroom_guide' || adMode === 'luxury_ad' || adMode === 'digital_ad' || adMode === 'showroom_guide') {
    return _runSpaceStoryboardTask(req, taskId, payload);
  }
  try {
    const topview = require('../services/topviewService');
    const base = _publicBaseUrl(req);
    _taskPatch(taskId, { status: 'running', stage: 'topview_m2v', progress: 10, message: 'Topview 生成广告数字人视频' });
    const kbContext = _buildDhKbContext('digital_ad', _dhKbQuery(title, text, scenePrompt, cameraPrompt), { limit: 4, maxCharsPerDoc: 500 });
    const tv = await topview.generateMarketingVideo({
      avatarImageUrl: avatar?.image_url ? _absolutePublicUrl(req, avatar.image_url) : '',
      materialImageUrl: backgroundUrl ? _absolutePublicUrl(req, backgroundUrl) : '',
      title: title || '广告数字人',
      text: [
        kbContext ? `知识库导演提示：\n${kbContext}` : '',
        text,
        scenePrompt ? `场景要求：${scenePrompt}` : '',
        cameraPrompt ? `镜头要求：${cameraPrompt}` : '',
      ].filter(Boolean).join('\n'),
      voiceId: voiceId || '',
      duration: Math.max(10, Math.min(60, Number(durationSec) || 18)),
      aspectRatio,
      actionPrompt: [_adPresenterActionPrompt({ scenePrompt, text }), kbContext].filter(Boolean).join('\n\n'),
      onProgress: info => _taskPatch(taskId, {
        stage: info.stage || 'topview_m2v',
        progress: Math.max(10, Math.min(95, Number(info.progress) || 10)),
        message: `Topview ${info.status || info.stage || 'processing'}`,
      }),
    });
    if (tv?.videoUrl) {
      const taskDir = path.join(JIMENG_ASSETS_DIR, `digital_ad_${taskId}`);
      fs.mkdirSync(taskDir, { recursive: true });
      const dl = await axios.get(tv.videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
      const finalPath = path.join(taskDir, 'topview_digital_ad.mp4');
      fs.writeFileSync(finalPath, Buffer.from(dl.data));
      const publicName = `topview_digital_ad_${taskId}.mp4`;
      fs.copyFileSync(finalPath, path.join(JIMENG_ASSETS_DIR, publicName));
      const taskData = {
        id: taskId,
        status: 'done',
        stage: 'done',
        title: title || '广告数字人',
        text,
        videoPath: finalPath,
        videoUrl: `/api/avatar/tasks/${taskId}/stream`,
        video_url: `${base}/public/jimeng-assets/${publicName}`,
        image_url: backgroundUrl || avatar?.image_url || '',
        thumbnail_url: backgroundUrl || avatar?.image_url || '',
        kind: 'production',
        mode: 'digital_ad',
        generation_mode: 'topview',
        user_id: productAdTasks.get(taskId)?.user_id,
        ratio: aspectRatio,
        output_size: outputSize,
        resolution: _outputSizeString(aspectRatio, outputSize),
        model: tv.model_id || 'topview-m2v',
        provider_id: 'topview',
        topview_task_id: tv.taskId,
        created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
      };
      productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
      if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
      else db.updateAvatarTask(taskId, taskData);
      return;
    }
  } catch (topviewErr) {
    console.error('[DH/space-guide] Topview failed:', topviewErr);
    _taskPatch(taskId, {
      status: 'error',
      stage: 'topview_m2v_error',
      error: `Topview 广告数字人生成失败：${topviewErr.message}`,
      message: topviewErr.message,
    });
    try {
      if (!db.getAvatarTask(taskId)) {
        const t = productAdTasks.get(taskId);
        db.insertAvatarTask({ ...t, status: 'error', error: `Topview 广告数字人生成失败：${topviewErr.message}`, kind: 'production', mode: 'digital_ad', generation_mode: 'topview' });
      }
    } catch {}
    return;
  }
  if (generationMode === 'storyboard') return _runSpaceStoryboardTask(req, taskId, payload);
  try {
    const base = _publicBaseUrl(req);
    _taskPatch(taskId, { status: 'running', stage: 'guide_keyframe', progress: 8, message: '生成空间导览预览图' });
    const keyframePrompt = _buildSpaceGuideKeyframePrompt({
      scene,
      title,
      text,
      scenePrompt,
      camera,
      cameraPrompt,
      kbContext: _buildDhKbContext('showroom_guide', _dhKbQuery(title, text, scenePrompt, cameraPrompt), { limit: 4, maxCharsPerDoc: 500 }),
    });
    const refs = [
      await _resolveImageForExternalApi(req, avatar.image_url),
      await _resolveImageForExternalApi(req, backgroundUrl),
    ].filter(Boolean);

    const keyframePath = await _generateViaDeyunaiNanoBanana({
      prompt: keyframePrompt,
      aspectRatio,
      outputSize,
      filename: `space_guide_${Date.now()}_${uuidv4().slice(0, 8)}`,
      destDir: JIMENG_ASSETS_DIR,
      referenceImages: refs,
    });
    const keyframeUrl = `${base}/public/jimeng-assets/${path.basename(keyframePath)}`;
    _taskPatch(taskId, { keyframeUrl, image_url: keyframeUrl, thumbnail_url: keyframeUrl, progress: 42, message: '导览预览图已完成' });

    const showSubtitles = subtitle?.show !== false;
    const guideSegments = Array.isArray(segments) && segments.length
      ? segments
      : _fallbackGuideSegments(text, Math.max(10, Number(durationSec) || Math.ceil(String(text).length / 4)));
    const subtitleStyle = subtitle?.style || 'popup';
    const textEffects = showSubtitles
      ? _normalizeSubtitleSegments(guideSegments, text).map(s => ({
        text: s.text,
        position: subtitleStyle === 'comic' ? 'top-center' : 'bottom-center',
        style: 'subtitle',
        subtitleStyle,
        smartEmphasis: subtitle?.smartEmphasis !== false,
        startTime: s.start ?? 0,
        endTime: s.end,
        fontName: subtitle?.fontName || '抖音美好体',
        fontSize: subtitle?.fontSize || 72,
        color: subtitle?.color || '#FFFFFF',
        outlineColor: subtitle?.outlineColor || '#000000',
      }))
      : [];

    const cameraMotion = ['auto', 'push_in', 'static', 'handheld', 'pan_right', 'walkthrough', 'orbit', 'wide_to_detail', 'rack_focus', 'custom'].includes(camera) ? camera : 'auto';
    const motionPrompt = [
      'One continuous realistic showroom/space docent video. Presenter looks at the camera and speaks naturally with expressive but controlled delivery.',
      'Keep the presenter on the left side and keep the right wall/display visible for the whole video.',
      'Natural open-palm gesture toward the display area on the right, subtle head movement, realistic lip sync.',
      scenePrompt ? `Scene context to emphasize: ${scenePrompt}.` : '',
      text ? `Narration meaning: ${String(text).slice(0, 420)}.` : '',
      `Camera motion: ${_spaceCameraPrompt(cameraMotion, cameraPrompt)}.`,
      'No subtitles generated by the model itself, no stickers, no extra people, no layout changes.',
    ].filter(Boolean).join(' ');

    _taskPatch(taskId, { stage: 'guide_video', progress: 55, message: '提交数字人讲解视频' });
    const resp = await axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
      image_url: keyframeUrl,
      text,
      audio_url: null,
      voiceId: voiceId || null,
      title: title || '广告数字人',
      prompt: motionPrompt,
      speed: 1.0,
      textEffects,
      stickers: [],
      cameraMotion,
      cameraSegments: [],
      coverWatermark: true,
      aspectRatio,
      ratio: aspectRatio,
      output_size: outputSize,
      resolution: _outputSizeString(aspectRatio, outputSize),
      kind: 'production',
    }, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 30000,
    });

    if (!resp.data?.success) throw new Error(resp.data?.error || '提交空间讲解任务失败');
    const linkedTaskId = resp.data.taskId;
    _taskPatch(taskId, { linkedTaskId, stage: 'submitted', progress: 68, message: '数字人渲染中' });

    const started = Date.now();
    while (Date.now() - started < 10 * 60 * 1000) {
      await _sleep(6000);
      let statusResp = null;
      try {
        statusResp = await axios.get(`${base}/api/avatar/jimeng-omni/tasks/${linkedTaskId}`, {
          headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
          timeout: 15000,
        });
      } catch (pollErr) {
        _taskPatch(taskId, { message: pollErr.response?.data?.error || pollErr.message });
        continue;
      }
      const t = statusResp.data?.task || {};
      _taskPatch(taskId, {
        status: t.status || 'running',
        stage: t.stage || 'running',
        progress: Math.max(68, Math.min(98, Number(t.progress) || 72)),
        message: t.message || '数字人渲染中',
        video_url: t.video_url || t.videoUrl || '',
        videoUrl: t.videoUrl || t.video_url || '',
        subtitle_burned: !!t.subtitle_burned,
        subtitle_warning: t.subtitle_warning || '',
        error: t.error || '',
      });
      const doneVideoUrl = t.video_url || t.videoUrl;
      if (t.status === 'done' && doneVideoUrl) {
        const taskData = {
          id: taskId,
          status: 'done',
          stage: 'done',
          title: title || '广告数字人',
          text,
          videoUrl: doneVideoUrl,
          video_url: doneVideoUrl,
          image_url: keyframeUrl,
          thumbnail_url: keyframeUrl,
          keyframeUrl,
          linkedTaskId,
          kind: 'production',
          mode: 'digital_ad',
          user_id: productAdTasks.get(taskId)?.user_id,
          ratio: aspectRatio,
          output_size: outputSize,
          resolution: _outputSizeString(aspectRatio, outputSize),
          created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
          subtitle_burned: !!t.subtitle_burned,
          subtitle_warning: t.subtitle_warning || '',
        };
        productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
        if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
        else db.updateAvatarTask(taskId, taskData);
        return;
      }
      if (t.status === 'error') throw new Error(t.error || '广告数字人渲染失败');
    }
    throw new Error('广告数字人轮询超时');
  } catch (err) {
    console.error('[DH/space-guide] failed:', err);
    _taskPatch(taskId, { status: 'error', stage: 'error', error: err.message, message: err.message });
    try {
      if (!db.getAvatarTask(taskId)) {
        const t = productAdTasks.get(taskId);
        db.insertAvatarTask({ ...t, status: 'error', error: err.message, kind: 'production', mode: 'digital_ad' });
      }
    } catch {}
  }
}

function _isStrictShowroomMode(body = {}) {
  return body.strict_mode === true || body.generation_mode === 'showroom_guide_strict';
}

function _buildStrictGuideDirectives({ text, durationSec = 30, scenePrompt = '', segments = [] } = {}) {
  const duration = Math.max(8, Math.min(120, Number(durationSec) || Math.ceil(String(text || '').length / 4) || 30));
  const thirds = [0, Math.round(duration * 0.2), Math.round(duration * 0.62), duration]
    .map((v, i, arr) => i > 0 && v <= arr[i - 1] ? arr[i - 1] + 1 : v);
  const sourceSegments = Array.isArray(segments) && segments.some(s => s?.text)
    ? segments.filter(s => s?.text).slice(0, 8)
    : _fallbackGuideSegments(text, duration).slice(0, 8);
  const voiceSegments = sourceSegments.map((s, i, arr) => ({
    text: String(s.text || s.voiceover || '').trim(),
    start: Number.isFinite(Number(s.start)) ? Number(s.start) : Math.round((duration / arr.length) * i),
    end: Number.isFinite(Number(s.end)) ? Number(s.end) : Math.round((duration / arr.length) * (i + 1)),
    duration: Number(s.duration) || undefined,
    tone: i === 0 ? 'warm' : (i >= arr.length - 1 ? 'encouraging' : 'confident'),
    delivery: i === 0 ? '欢迎、建立信任' : (i >= arr.length - 1 ? '推荐、收束' : '讲解、强调质感'),
  })).filter(s => s.text);
  const gesturePlan = [
    { start: thirds[0], end: thirds[1], action: '从左侧前景缓慢进入或向前走一小步，镜头同步徐徐展开空间，建立导览感' },
    { start: thirds[1], end: thirds[2], action: '到达左三分之一位置后，手从腰部自然弹起并指向展示墙/产品细节，眼神先看目标再回看镜头' },
    { start: thirds[2], end: thirds[3], action: '做开放式扫手介绍并小幅换重心，最后回看镜头收束推荐，场景继续轻微延展' },
  ];
  const cameraPlan = {
    type: 'single_continuous_shot',
    movement: 'slow_walkthrough_forward_glide_with_lateral_parallax',
    strength: 'moderate',
    cuts_allowed: false,
    background_lock: true,
    composition: 'guide_left_display_right',
    scene_context: String(scenePrompt || '').slice(0, 500),
  };
  const voiceDirection = {
    tone: '专业、亲和、有导览感',
    pace: '中速，卖点后有 0.3-0.5 秒停顿',
    emotion_curve: [
      { start: thirds[0], end: thirds[1], style: '欢迎、建立信任' },
      { start: thirds[1], end: thirds[2], style: '讲解、强调质感' },
      { start: thirds[2], end: thirds[3], style: '推荐、收束' },
    ],
  };
  const motionTimeline = [
    {
      start: thirds[0],
      end: thirds[1],
      action: 'Start as a walkthrough reveal. The guide enters or advances from the left foreground with one or two visible small steps, body angled toward the display wall while the camera glides forward.',
      body: 'visible walking/settling step, shoulder sway, breathing, natural blink',
      hands: 'hands relaxed at first; the presentation hand begins to lift from waist level near the end of this segment',
      gaze: 'brief camera contact, then quick glance toward the display path',
    },
    {
      start: thirds[1],
      end: Math.round((thirds[1] + thirds[2]) / 2),
      action: 'Arrive at the left-third mark, plant the front foot, turn upper body about 20 degrees toward the display wall, then pop/lift the hand into a clear presenting gesture.',
      body: 'torso rotation, shoulders follow the gesture, natural step-to-stop movement, no frozen feet',
      hands: 'hand rises into frame from waist to chest height, open palm clearly points toward the wall/product/detail area',
      gaze: 'eyes follow the hand to the target first, then return to camera at phrase end',
    },
    {
      start: Math.round((thirds[1] + thirds[2]) / 2),
      end: thirds[2],
      action: 'Continue explaining with a visible sweep from the presenter toward the exact wall/product/detail. The camera slowly reveals more of the background and follows the hand direction.',
      body: 'small half-step or weight transfer, natural head nods matched to speech emphasis',
      hands: 'alternate between open palm, directional pointing, gentle framing gesture, and relaxed return',
      gaze: 'look at the target while pointing, then reconnect with the camera',
    },
    {
      start: thirds[2],
      end: thirds[3],
      action: 'Return fully to the camera, lower the hand naturally, take a tiny settling step if needed, then finish with a confident recommendation gesture and slight nod.',
      body: 'upright posture, soft shoulder movement, no robotic stillness, no locked-foot ending',
      hands: 'hands return to a relaxed position, final open-hand recommendation',
      gaze: 'camera',
    },
  ];
  return {
    duration,
    voiceSegments,
    gesturePlan: motionTimeline,
    cameraPlan: {
      ...cameraPlan,
      movement: 'walkthrough_reveal_forward_glide_lateral_parallax',
      body_motion_required: true,
      walking_steps_required: true,
      hand_lift_and_point_required: true,
      gaze_target_sync_required: true,
      scene_extension_required: true,
      freeze_forbidden: true,
      action_style: 'real showroom docent, slow walk-in, hand-led introduction, gaze follows target then returns to lens',
    },
    voiceDirection: {
      ...voiceDirection,
      tone_en: 'warm professional showroom guide, calm confidence, slight emphasis on selling points',
      rhythm_en: 'natural Chinese speaking rhythm, micro-pauses after key material or product details',
    },
  };
}

async function _runStrictKeyframeQa(req, { backgroundUrl, keyframePath, guideGender, guidePlacement }) {
  const failed = [];
  if (!keyframePath || !fs.existsSync(keyframePath) || fs.statSync(keyframePath).size < 1024) {
    failed.push('keyframe_file_invalid');
  }
  try {
    const sharp = _loadSharp();
    if (!sharp) failed.push('sharp_unavailable');
    else {
      const meta = await sharp(keyframePath).metadata();
      if (!meta.width || !meta.height) failed.push('keyframe_dimension_invalid');
      const stats = await sharp(keyframePath).removeAlpha().stats();
      const means = (stats.channels || []).slice(0, 3).map(c => c.mean || 0);
      const avg = means.reduce((a, b) => a + b, 0) / Math.max(1, means.length);
      if (avg < 5 || avg > 250) failed.push('keyframe_near_blank');
    }
  } catch (err) {
    failed.push(`keyframe_probe_failed:${err.message}`);
  }
  let qa = null;
  if (!failed.length) qa = await _checkShowroomGuideIntegration(req, backgroundUrl, keyframePath, {
    ...(guidePlacement || {}),
    expected_gender: guideGender === 'male' ? 'male' : 'female',
  });
  if (!qa) failed.push('visual_qa_unavailable');
  else {
    if (!qa.pass) failed.push('visual_qa_rejected');
    if (_isHardShowroomGuideReject(qa)) failed.push('hard_reject_sticker_or_background_or_person');
  }
  if (failed.length) {
    throw new DhStrictError('QA_KEYFRAME_FAILED', 'keyframe_qa', '首帧未通过质量检查', {
      failed_checks: failed,
      qa,
      guide_gender: guideGender,
    }, 422, true);
  }
  return qa;
}

async function _runStrictVideoQa({ videoPath, audioPath, keyframeUrl }) {
  const failed = [];
  if (!videoPath || !fs.existsSync(videoPath) || fs.statSync(videoPath).size < 4096) failed.push('video_file_invalid');
  if (audioPath && (!fs.existsSync(audioPath) || fs.statSync(audioPath).size < 1024)) failed.push('audio_file_invalid');
  if (!keyframeUrl) failed.push('keyframe_missing');
  if (failed.length) {
    throw new DhStrictError('QA_VIDEO_FAILED', 'video_qa', '成片未通过质量检查', { failed_checks: failed }, 422, true);
  }
  return { pass: true, checks: ['video_file_valid', audioPath ? 'audio_file_valid' : 'audio_generated_by_lipsync'] };
}

async function _runStrictSpaceKeyframes(req, body) {
  const {
    avatar_id = '',
    background_url,
    text,
    title = '广告数字人',
    scene_prompt = '',
    duration_sec = 30,
    segments = [],
    guide_gender = 'female',
    aspect_ratio,
    aspectRatio: aspectRatioBody,
    output_size,
    outputSize,
  } = body || {};
  if (avatar_id) throw new DhStrictError('INPUT_AVATAR_NOT_ALLOWED', 'input', '强制 AI 导览员模式不允许同时选择人物形象，请清空形象后重试', {}, 400, false);
  if (!background_url) throw new DhStrictError('INPUT_MISSING_BACKGROUND', 'input', '请先上传广告背景图', {}, 400, false);
  if (!String(text || '').trim()) throw new DhStrictError('INPUT_MISSING_TEXT', 'input', '请先填写广告文案', {}, 400, false);
  if (!['female', 'male'].includes(String(guide_gender || ''))) throw new DhStrictError('INPUT_GUIDE_GENDER_INVALID', 'input', 'AI 导览员性别必须是 female 或 male', { guide_gender }, 400, false);
  const aspectRatio = _normalizeAspectRatio(aspect_ratio || aspectRatioBody, '16:9');
  const normalizedOutputSize = _normalizeOutputSize(output_size || outputSize);
  const directives = _buildStrictGuideDirectives({ text, durationSec: duration_sec, scenePrompt: scene_prompt, segments });
  const scene = {
    title: '强制单镜头导览',
    text: String(text || '').trim(),
    voiceover: String(text || '').trim(),
    start: 0,
    end: directives.duration,
    duration: directives.duration,
    role: 'showroom_guide',
    scenePrompt: scene_prompt,
    strictNoComposite: true,
    gesture_plan: directives.gesturePlan,
    camera_plan: directives.cameraPlan,
    voice_direction: directives.voiceDirection,
  };
  const taskId = uuidv4();
  let keyframeResult;
  try {
    keyframeResult = await _createGeneratedShowroomGuideKeyframe({
      req,
      backgroundUrl: background_url,
      scene,
      aspectRatio,
      outputSize: normalizedOutputSize,
      filename: `strict_space_guide_${taskId}`,
      destDir: JIMENG_ASSETS_DIR,
      index: 0,
      guideGender: guide_gender,
    });
  } catch (err) {
    if (err instanceof DhStrictError) throw err;
    throw new DhStrictError('KEYFRAME_GENERATION_FAILED', 'keyframe_generate', `AI 导览员首帧生成失败：${err.message}`, {
      note: 'strict showroom preview does not fall back to template cutout compositing',
    }, 502, true);
  }
  const { outPath: keyframePath, plan: shotPlan } = keyframeResult;
  const referenceMode = _strictShowroomReferenceMode(shotPlan);
  if (referenceMode === 'showroom_guide_template_composite') {
    throw new DhStrictError('KEYFRAME_TEMPLATE_COMPOSITE_REJECTED', 'keyframe_qa', '预览未通过质量检查：当前结果属于模板贴片合成，不能作为广告数字人合格预览', {
      failed_checks: ['template_composite_not_allowed', 'sticker_like_presenter'],
      shot_plan: shotPlan,
    }, 422, true);
  }
  const qa = await _runStrictKeyframeQa(req, {
    backgroundUrl: background_url,
    keyframePath,
    guideGender: guide_gender,
    guidePlacement: shotPlan?.guide_placement,
  });
  const base = _publicBaseUrl(req);
  const keyframeUrl = `${base}/public/jimeng-assets/${path.basename(keyframePath)}`;
  const keyframeId = `skf_${taskId}`;
  const record = {
    id: keyframeId,
    user_id: req.user?.id || null,
    created_at: new Date().toISOString(),
    background_url,
    image_url: keyframeUrl,
    local_path: keyframePath,
    title,
    text: String(text || '').trim(),
    guide_gender,
    aspectRatio,
    outputSize: normalizedOutputSize,
    scene,
    directives,
    shot_plan: { ...shotPlan, quality_check: qa, strict: true },
    qa,
  };
  strictSpaceKeyframes.set(keyframeId, record);
  return {
    success: true,
    strict: true,
    keyframe_id: keyframeId,
    scenes: [scene],
    keyframes: [{
      ...scene,
      keyframe_id: keyframeId,
      image_url: keyframeUrl,
      reference_mode: referenceMode,
      shot_plan: record.shot_plan,
      source_background_url: background_url,
      qa,
    }],
    shot_count: 1,
    ratio: aspectRatio,
    output_size: normalizedOutputSize,
    resolution: _outputSizeString(aspectRatio, normalizedOutputSize),
  };
}

async function _strictSynthesizeGuideAudio(req, { taskDir, text, voiceId, voiceSegments }) {
  const publicSegmentUrl = await _synthesizeSegmentedSpeech(req, { text, voiceId, segments: voiceSegments });
  if (publicSegmentUrl) {
    const local = path.join(JIMENG_ASSETS_DIR, path.basename(new URL(publicSegmentUrl, _publicBaseUrl(req)).pathname));
    if (fs.existsSync(local)) return { audioUrl: publicSegmentUrl, audioPath: local };
  }
  const { generateSpeech } = require('../services/ttsService');
  const audioBase = path.join(taskDir, 'strict_voiceover');
  const audioPath = await generateSpeech(text, audioBase, { voiceId: voiceId || null, speed: 1.0 });
  if (!audioPath || !fs.existsSync(audioPath)) throw new DhStrictError('TTS_FAILED', 'tts_running', '配音音频生成失败', {}, 502, true);
  const publicName = path.basename(audioPath);
  const publicPath = path.join(JIMENG_ASSETS_DIR, publicName);
  if (publicPath !== audioPath) fs.copyFileSync(audioPath, publicPath);
  return { audioUrl: `${_publicBaseUrl(req)}/public/jimeng-assets/${publicName}`, audioPath: publicPath };
}

async function _runStrictSpaceGuideTask(req, taskId, payload) {
  const { keyframeRecord, text, voiceId, title, subtitle, durationSec, aspectRatio, outputSize, lipSyncModel } = payload;
  const taskDir = path.join(JIMENG_ASSETS_DIR, `strict_ad_${taskId}`);
  fs.mkdirSync(taskDir, { recursive: true });
  try {
    _taskPatch(taskId, { status: 'running', stage: 'full_scene_video', progress: 18, message: '强制链路：使用已确认首帧生成完整导览视频' });
    const confirmedKeyframe = {
      ...(keyframeRecord.scene || {}),
      image_url: keyframeRecord.image_url,
      keyframe_id: keyframeRecord.id,
      voiceover: text,
      text,
      duration: Number(durationSec) || keyframeRecord.scene?.duration || keyframeRecord.directives?.duration || 30,
      local_path: keyframeRecord.local_path,
      reference_mode: 'showroom_guide_strict',
      qa: keyframeRecord.qa,
      shot_plan: keyframeRecord.shot_plan,
    };
    await _runSpaceStoryboardTask(req, taskId, {
      avatar: null,
      backgroundUrl: keyframeRecord.background_url,
      text,
      voiceId,
      title,
      scenePrompt: keyframeRecord.scene?.scenePrompt || '',
      durationSec,
      segments: [keyframeRecord.scene || confirmedKeyframe],
      speechSegments: keyframeRecord.directives?.voiceSegments || [],
      subtitle,
      adMode: 'showroom_guide',
      adStyle: 'showroom_walkthrough',
      shotCount: 1,
      keyframes: [confirmedKeyframe],
      guideGender: keyframeRecord.guide_gender || 'female',
      aspectRatio,
      outputSize,
    });
    const t = productAdTasks.get(taskId);
    if (t?.status === 'done') {
      const strictTaskData = {
        strict: true,
        generation_mode: 'showroom_guide_strict',
        keyframe_id: keyframeRecord.id,
        qa: { ...(t.qa || {}), keyframe: keyframeRecord.qa },
      };
      productAdTasks.set(taskId, { ...t, ...strictTaskData, updated_at: new Date().toISOString() });
      if (db.getAvatarTask(taskId)) db.updateAvatarTask(taskId, strictTaskData);
    }
  } catch (err) {
    const body = _strictErrorBody(err);
    console.error('[DH/space-guide/strict/full-scene] failed:', body);
    _taskPatch(taskId, { status: 'error', stage: body.stage, code: body.code, error: body.message, message: body.message, details: body.details });
    try {
      const t = productAdTasks.get(taskId);
      if (!db.getAvatarTask(taskId)) db.insertAvatarTask({ ...t, status: 'error', error: body.message, code: body.code, details: body.details, kind: 'production', mode: 'digital_ad', generation_mode: 'showroom_guide_strict' });
      else db.updateAvatarTask(taskId, { status: 'error', error: body.message, code: body.code, details: body.details });
    } catch {}
  }
  return;
  try {
    _taskPatch(taskId, { status: 'running', stage: 'tts_running', progress: 18, message: '强制链路：生成口播音频' });
    const { audioUrl, audioPath } = await _strictSynthesizeGuideAudio(req, {
      taskDir,
      text,
      voiceId,
      voiceSegments: keyframeRecord.directives?.voiceSegments || [],
    });
    _taskPatch(taskId, { stage: 'lipsync_running', progress: 42, message: `强制链路：${_pipelineModelLabel(lipSyncModel)} 口型同步生成中`, audio_url: audioUrl });
    const subtitleOn = subtitle?.show !== false;
    const textEffects = subtitleOn
      ? _normalizeSubtitleSegments(keyframeRecord.directives?.voiceSegments || [], text).map(s => ({
        text: s.text,
        position: 'bottom-center',
        style: 'subtitle',
        subtitleStyle: subtitle?.style || 'popup',
        smartEmphasis: subtitle?.smartEmphasis !== false,
        startTime: s.start ?? 0,
        endTime: s.end,
        fontName: subtitle?.fontName || '抖音美好体',
        fontSize: subtitle?.fontSize || 64,
        color: subtitle?.color || '#FFFFFF',
        outlineColor: subtitle?.outlineColor || '#000000',
      }))
      : [];
    const kbContext = _buildDhKbContext(
      'showroom_guide',
      _dhKbQuery(title, text, keyframeRecord.scene?.scenePrompt, keyframeRecord.directives?.gesturePlan, keyframeRecord.directives?.cameraPlan),
      { limit: 4, maxCharsPerDoc: 520 }
    );
    const prompt = [
      'STRICT SHOWROOM WALKTHROUGH VIDEO. Preserve the confirmed guide identity, gender, outfit, uploaded background, material texture, lighting direction and display area. Treat the keyframe as the first-frame reference only; do not freeze the pose, feet, or composition.',
      kbContext ? `Knowledge-base direction:\n${kbContext}` : '',
      `Gesture timeline: ${JSON.stringify(keyframeRecord.directives?.gesturePlan || [])}.`,
      `Camera plan: ${JSON.stringify(keyframeRecord.directives?.cameraPlan || {})}.`,
      `Voice direction: ${JSON.stringify(keyframeRecord.directives?.voiceDirection || {})}.`,
      _adPresenterActionPrompt({ scenePrompt: keyframeRecord.scene?.scenePrompt || '', text }),
      'Motion is mandatory and must read clearly: slow walk-in or small forward steps, hand pops/lifts up into frame, open-palm pointing or sweeping toward the exact display/product/wall details, natural weight transfer, torso rotation, and head nods matched to speech emphasis.',
      'The guide should feel like a real showroom docent: relaxed shoulders, soft elbows, hands returning naturally after each gesture. Eye line must be purposeful: look at the target while pointing, then return to the camera; never keep a random diagonal stare.',
      'Camera motion should extend the uploaded space: slow forward walkthrough glide, slight lateral parallax, gentle pull-back/reveal, and subtle rack-focus feeling from guide to background details. Keep the background recognizable while making it feel like continuous footage.',
      'Maintain accurate lip sync while allowing natural arm and body motion. Hands must not melt, duplicate, or become rigid. Do not crop the presenter out.',
        _showroomGuideMotionBible({ text, scenePrompt: keyframeRecord.scene?.scenePrompt || '' }),
        'No cuts, no scene replacement, no extra people, no generated captions inside the model, no face drift, no mannequin-like stillness, no locked feet, no static talking-head behavior.',
    ].join('\n');
    const base = _publicBaseUrl(req);
    const resp = await axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
      image_url: keyframeRecord.image_url,
      audio_url: audioUrl,
      text,
      voiceId: voiceId || null,
      title: title || '广告数字人',
      prompt,
      textEffects,
      stickers: [],
      cameraMotion: 'handheld',
      cameraSegments: [
        { start: 0, end: 0.22, camera: 'pull_back', intent: 'begin with a spatial showroom reveal while the guide walks or advances into the mark' },
        { start: 0.22, end: 0.72, camera: 'pan_product', intent: 'follow the lifted hand, eye line, and pointing/sweeping gestures toward wall or product details' },
        { start: 0.72, end: 1, camera: 'push_in', intent: 'finish on presenter after returning eye contact to the lens' },
      ],
      coverWatermark: true,
      aspectRatio,
      ratio: aspectRatio,
      output_size: outputSize,
      resolution: _outputSizeString(aspectRatio, outputSize),
      kind: 'production',
      agentId: 'ad_avatar.lip_sync',
      strictModel: lipSyncModel,
      strict_mode: true,
    }, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 30000,
    });
    if (!resp.data?.success) throw new DhStrictError('LIPSYNC_SUBMIT_FAILED', 'lipsync_running', resp.data?.error || '口型同步任务提交失败', resp.data || {}, 502, true);
    const linkedTaskId = resp.data.taskId;
    _taskPatch(taskId, { linkedTaskId, stage: 'lipsync_running', progress: 55, message: '强制链路：口型同步渲染中' });
    const started = Date.now();
    while (Date.now() - started < 50 * 60 * 1000) {
      await _sleep(6000);
      let statusResp;
      try {
        statusResp = await axios.get(`${base}/api/avatar/jimeng-omni/tasks/${linkedTaskId}`, {
          headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
          timeout: 20000,
        });
      } catch (pollErr) {
        _taskPatch(taskId, { message: pollErr.response?.data?.error || pollErr.message });
        continue;
      }
      const t = statusResp.data?.task || {};
      _taskPatch(taskId, {
        stage: t.stage || 'lipsync_running',
        progress: Math.min(92, Math.max(56, Number(t.progress) || 60)),
        message: t.message || t.fallback_message || '强制链路：口型同步渲染中',
        actual_model: t.actual_model,
        actual_provider: t.actual_provider,
      });
      if (t.status === 'error') throw new DhStrictError('LIPSYNC_FAILED', 'lipsync_running', t.error || '口型同步生成失败', { linkedTaskId }, 502, true);
      const doneVideoUrl = t.video_url || t.videoUrl;
      if (t.status === 'done' && doneVideoUrl) {
        _taskPatch(taskId, { stage: 'video_qa', progress: 94, message: '强制链路：成片质量检查' });
        await _runStrictVideoQa({ videoPath: t.local_path, audioPath, keyframeUrl: keyframeRecord.image_url });
        const publishedVideo = t.local_path && fs.existsSync(t.local_path)
          ? _publishAdVideoAsset(req, taskId, t.local_path, 'strict_ad_guide')
          : { localPath: t.local_path, publicUrl: doneVideoUrl, compressed: false, originalSize: 0, finalSize: 0 };
        const taskData = {
          id: taskId,
          status: 'done',
          stage: 'done',
          title: title || '广告数字人',
          text,
          scenes: [keyframeRecord.scene],
          keyframes: [{ image_url: keyframeRecord.image_url, keyframe_id: keyframeRecord.id, voiceover: text }],
          videoPath: publishedVideo.localPath,
          videoUrl: `/api/avatar/tasks/${taskId}/stream`,
          video_url: publishedVideo.publicUrl || doneVideoUrl,
          image_url: keyframeRecord.image_url,
          thumbnail_url: keyframeRecord.image_url,
          keyframeUrl: keyframeRecord.image_url,
          keyframe_id: keyframeRecord.id,
          linkedTaskId,
          kind: 'production',
          mode: 'digital_ad',
          generation_mode: 'showroom_guide_strict',
          ad_mode: 'showroom_guide',
          user_id: productAdTasks.get(taskId)?.user_id,
          ratio: aspectRatio,
          output_size: outputSize,
          resolution: _outputSizeString(aspectRatio, outputSize),
          model: t.actual_model || lipSyncModel.model_id,
          provider_id: t.actual_provider || lipSyncModel.provider_id,
          compressed: publishedVideo.compressed,
          original_video_size: publishedVideo.originalSize,
          final_video_size: publishedVideo.finalSize,
          strict: true,
          qa: { keyframe: keyframeRecord.qa, video: { pass: true } },
          created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
        };
        productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
        if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
        else db.updateAvatarTask(taskId, taskData);
        return;
      }
    }
    throw new DhStrictError('LIPSYNC_POLL_TIMEOUT', 'lipsync_running', '口型同步轮询超时：已等待 50 分钟，远端任务仍未完成', { linkedTaskId }, 504, true);
  } catch (err) {
    const body = _strictErrorBody(err);
    console.error('[DH/space-guide/strict] failed:', body);
    _taskPatch(taskId, { status: 'error', stage: body.stage, code: body.code, error: body.message, message: body.message, details: body.details });
    try {
      const t = productAdTasks.get(taskId);
      if (!db.getAvatarTask(taskId)) db.insertAvatarTask({ ...t, status: 'error', error: body.message, code: body.code, details: body.details, kind: 'production', mode: 'digital_ad', generation_mode: 'showroom_guide_strict' });
      else db.updateAvatarTask(taskId, { status: 'error', error: body.message, code: body.code, details: body.details });
    } catch {}
  }
}

router.post('/spaces/keyframes', async (req, res) => {
  try {
    if (_isStrictShowroomMode(req.body || {})) {
      try {
        const result = await _runStrictSpaceKeyframes(req, req.body || {});
        return res.json(result);
      } catch (err) {
        return _sendStrictPreviewResult(res, err);
      }
    }
    if (req.body?.ad_mode === 'showroom_guide' && req.body?.generation_mode === 'showroom_guide_tracks') {
      return res.status(400).json({
        success: false,
        error: '预览接口不能使用 showroom_guide_tracks；普通广告数字人预览必须显式使用 showroom_guide_strict',
        code: 'SHOWROOM_PREVIEW_MODE_INVALID',
        recoverable: false,
      });
    }
    const {
      avatar_id,
      background_url,
      reference_images = [],
      text,
      title = '广告数字人',
      scene_prompt = '',
      duration_sec = null,
      segments = [],
      ad_mode = 'digital_ad',
      ad_style = 'luxury_soft',
      shot_count = null,
      product_name = '',
      product_asset = null,
      asset_summary = '',
      guide_gender = 'female',
      aspect_ratio,
      aspectRatio: aspectRatioBody,
      output_size,
      outputSize,
      resolution = '',
    } = req.body || {};
    const isLuxuryRequest = ad_mode === 'luxury_ad';
    if (!background_url && !isLuxuryRequest) return res.status(400).json({ success: false, error: 'background_url 必填' });
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'text 必填' });

    const avatar = avatar_id ? db.getPortrait(avatar_id) : null;
    if (avatar_id && (!avatar || avatar.kind !== 'digital_human' || !ownedBy(req, avatar))) {
      return res.status(404).json({ success: false, error: '形象不存在' });
    }
    if (avatar_id && !avatar.image_url) return res.status(400).json({ success: false, error: '形象缺少图片' });

    const taskId = uuidv4();
    const aspectRatio = _normalizeAspectRatio(aspect_ratio || aspectRatioBody, '16:9');
    const normalizedOutputSize = _normalizeOutputSize(output_size || outputSize);
    const isLuxury = isLuxuryRequest;
    const isShowroomGuide = ad_mode === 'showroom_guide';
    const luxuryReferences = isLuxury
      ? [background_url, ...(Array.isArray(reference_images) ? reference_images : [])]
        .map(x => String(x || '').trim())
        .filter(Boolean)
        .filter((x, i, arr) => arr.indexOf(x) === i)
        .slice(0, 8)
      : [background_url];
    const luxuryShotReferenceCount = isLuxury ? Math.max(0, luxuryReferences.length - 1) : 0;
    const limit = isLuxury
      ? (luxuryShotReferenceCount > 0
        ? Math.max(1, Math.min(luxuryShotReferenceCount, Math.round(Number(shot_count) || luxuryShotReferenceCount)))
        : Math.max(1, Math.min(8, Math.round(Number(shot_count) || 6))))
      : (isShowroomGuide ? 1 : 5);
    const guideSegments = Array.isArray(segments) && segments.length
      ? segments.slice(0, limit)
      : (isShowroomGuide
        ? [{
          title: '单镜头展墙讲解',
          text: String(text || '').trim(),
          voiceover: String(text || '').trim(),
          start: 0,
          end: Math.max(8, Number(duration_sec) || Math.ceil(String(text || '').length / 4) || 10),
          duration: Math.max(8, Number(duration_sec) || Math.ceil(String(text || '').length / 4) || 10),
          role: 'showroom_guide',
        }]
        : _fallbackGuideSegments(text, Math.max(12, Number(duration_sec) || Math.ceil(String(text).length / 4))));
    const luxuryProductName = product_name || req.body?.productName || product_asset?.name || '';
    const productSubject = isLuxury ? _deriveLuxuryProductSubject({
      text: [text, scene_prompt, asset_summary || '', JSON.stringify(guideSegments || [])].join('\n'),
      productName: luxuryProductName,
      assetSummary: asset_summary || '',
    }) : '';
    const scenes = isLuxury
      ? _normalizeProvidedLuxuryStoryboardSegments(guideSegments, {
        text,
        durationSec: duration_sec,
        shotCount: limit,
        productSubject,
        adStyle: ad_style,
        assetSummary: `主产品图 + ${Math.max(0, luxuryReferences.length - 1)} 张顺序画面参考`,
      })
      : await _buildSpaceAdStoryboard({ title, text, durationSec: duration_sec, segments: guideSegments, scenePrompt: scene_prompt, adMode: ad_mode, adStyle: ad_style, shotCount: limit });
    const base = _publicBaseUrl(req);
    const keyframes = [];
    const luxuryCharacterLock = isLuxury && avatar?.image_url
      ? (typeof _buildLuxuryCharacterConsistencyLock === 'function'
        ? _buildLuxuryCharacterConsistencyLock(avatar)
        : {
          enabled: true,
          mode: 'optional_identity_reference',
          identity_name: String(avatar.name || avatar.title || avatar.nickname || 'selected presenter').trim().slice(0, 60),
          stable_attributes: ['face identity', 'age impression', 'hairstyle', 'body proportions', 'outfit family', 'skin tone'],
          mutable_attributes: ['pose', 'gesture', 'expression', 'camera angle', 'lighting adaptation', 'scene placement'],
          prompt: 'CHARACTER CONSISTENCY LOCK: keep the same selected identity across shots that include a human; do not invent another actor.',
        })
      : null;
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const keyframeMaker = isLuxury
        ? (typeof _createLuxuryAdReferenceKeyframe === 'function' ? _createLuxuryAdReferenceKeyframe : _createLuxuryAdReferenceKeyframeFallback)
        : isShowroomGuide
        ? (avatar?.image_url ? _createNaturalShowroomAdKeyframe : _createGeneratedShowroomGuideKeyframe)
        : _createLockedAdKeyframe;
      const luxuryShotRefs = (() => {
        if (!isLuxury) return reference_images;
        const extraRefs = luxuryReferences.filter(x => x && x !== background_url);
        const explicitIndex = Math.max(0, Math.round(Number(sc.reference_index ?? sc.referenceImageIndex ?? sc.ref_index) || 0));
        const shotRef = explicitIndex > 0
          ? (extraRefs[explicitIndex - 1] || '')
          : (extraRefs.length && sc.reference_label && String(sc.reference_label).includes('@参考')
            ? extraRefs[0]
            : (extraRefs.length ? extraRefs[i % extraRefs.length] : ''));
        return [shotRef].filter(Boolean);
      })();
      const lockedLuxuryReference = isLuxury ? (luxuryShotRefs[0] || '') : '';
      if (isLuxury && lockedLuxuryReference) {
        const lockedUrl = /^https?:\/\//i.test(lockedLuxuryReference)
          ? lockedLuxuryReference
          : `${base}${String(lockedLuxuryReference).startsWith('/') ? '' : '/'}${lockedLuxuryReference}`;
        const lockedIndex = Math.max(0, luxuryReferences.indexOf(lockedLuxuryReference));
        keyframes.push({
          ...sc,
          image_url: lockedUrl,
          local_path: '',
          reference_mode: 'reference_locked_keyframe',
          shot_plan: {
            kind: 'reference_locked_keyframe',
            focus: luxuryShotRefs[0]
              ? 'Use the user uploaded shot reference as the locked keyframe. Do not redraw or reinterpret it in the preview step.'
              : 'Use the uploaded main product image as the locked keyframe. Do not redraw or reinterpret it in the preview step.',
            reference_count: luxuryReferences.length,
            referenceImageIndex: lockedIndex,
            locked_reference_image: lockedLuxuryReference,
            active_reference_image: lockedLuxuryReference,
            fusion_model: 'none_reference_locked',
            note: 'Luxury ad preview is reference-locked. Image-to-video may animate this keyframe later.',
          },
          source_avatar_url: avatar?.image_url || '',
          source_background_url: background_url,
          active_reference_image: lockedLuxuryReference,
          source_reference_images: luxuryReferences,
          character_lock: luxuryCharacterLock || undefined,
        });
        continue;
      }
      const shotBackgroundUrl = isLuxury ? background_url : background_url;
      const { outPath: keyframePath, plan: shotPlan } = await keyframeMaker({
        req,
        avatar,
        avatarUrl: avatar?.image_url || '',
        backgroundUrl: shotBackgroundUrl,
        referenceImages: isLuxury ? luxuryShotRefs : luxuryReferences,
        scene: {
          ...sc,
          totalShots: scenes.length,
          reference_images: isLuxury ? [background_url, ...luxuryShotRefs] : luxuryReferences,
          referenceImageCount: luxuryReferences.length,
          referenceImageIndex: isLuxury ? (luxuryShotRefs[0] ? Math.max(0, luxuryReferences.indexOf(luxuryShotRefs[0])) : 0) : 0,
          active_reference_image: luxuryShotRefs[0] || background_url,
          character_lock: luxuryCharacterLock || undefined,
        },
        aspectRatio,
        outputSize: normalizedOutputSize,
        filename: `digital_ad_preview_${taskId}_kf_${String(i + 1).padStart(2, '0')}`,
        destDir: JIMENG_ASSETS_DIR,
        index: i,
        guideGender: guide_gender,
      });
      const url = `${base}/public/jimeng-assets/${path.basename(keyframePath)}`;
      keyframes.push({
        ...sc,
        image_url: url,
        reference_mode: shotPlan?.kind === 'integrated_avatar_background'
          ? 'integrated_avatar_background'
          : (shotPlan?.kind === 'generated_showroom_guide' ? 'generated_showroom_guide' : 'locked_composite'),
        shot_plan: shotPlan,
        source_avatar_url: avatar?.image_url || '',
        source_background_url: shotBackgroundUrl,
        active_reference_image: isLuxury ? (luxuryShotRefs[0] || background_url) : undefined,
        source_reference_images: isLuxury ? luxuryReferences : undefined,
        character_lock: isLuxury ? luxuryCharacterLock || undefined : undefined,
      });
    }
    res.json({ success: true, scenes, keyframes, shot_count: scenes.length, ratio: aspectRatio, output_size: normalizedOutputSize, resolution: _outputSizeString(aspectRatio, normalizedOutputSize), reference_mode: keyframes[0]?.reference_mode || 'locked_composite' });
  } catch (err) {
    const e = err.response?.data?.error || err.message;
    console.error('[DH/spaces/keyframes] failed:', e);
    _sendApiError(res, err, '高定广告片关键帧生成失败');
  }
});

router.post('/spaces/generate', async (req, res) => {
  try {
    if (_isStrictShowroomMode(req.body || {})) {
      try {
        const body = req.body || {};
        const {
          background_url,
          text,
          voice_id = null,
          title = '广告数字人',
          duration_sec = null,
          subtitle = null,
          keyframes = [],
          keyframe_id = '',
          guide_gender = 'female',
          aspect_ratio,
          aspectRatio: aspectRatioBody,
          output_size,
          outputSize,
          replaces_task_id = '',
        } = body;
        if (!background_url) throw new DhStrictError('INPUT_BACKGROUND_REQUIRED', 'preflight', 'background_url 必填', {}, 400, false);
        if (!String(text || '').trim()) throw new DhStrictError('INPUT_TEXT_REQUIRED', 'preflight', 'text 必填', {}, 400, false);
        if (!String(voice_id || '').trim()) throw new DhStrictError('INPUT_VOICE_REQUIRED', 'preflight', 'voice_id 必填，请先选择配音音色', {}, 400, false);

        const resolvedKeyframeId = String(keyframe_id || keyframes?.[0]?.keyframe_id || '').trim();
        if (!resolvedKeyframeId) {
          throw new DhStrictError('KEYFRAME_ID_REQUIRED', 'preflight', '必须先生成并确认服务端首帧，不能直接拿前端图片绕过首帧 QA', {}, 400, false);
        }
        const keyframeRecord = strictSpaceKeyframes.get(resolvedKeyframeId);
        if (!keyframeRecord) {
          throw new DhStrictError('KEYFRAME_EXPIRED', 'preflight', '首帧记录不存在或服务重启后已失效，请重新生成展墙讲解预览', { keyframe_id: resolvedKeyframeId }, 409, true);
        }
        if (keyframeRecord.user_id && req.user?.id && keyframeRecord.user_id !== req.user.id) {
          throw new DhStrictError('KEYFRAME_NOT_FOUND', 'preflight', '首帧记录不存在', { keyframe_id: resolvedKeyframeId }, 404, false);
        }
        if (String(keyframeRecord.background_url || '') !== String(background_url || '')) {
          throw new DhStrictError('KEYFRAME_BACKGROUND_MISMATCH', 'preflight', '首帧背景与当前背景不一致，请重新生成预览', { keyframe_id: resolvedKeyframeId }, 409, false);
        }
        if (String(keyframeRecord.text || '').trim() !== String(text || '').trim()) {
          throw new DhStrictError('KEYFRAME_TEXT_MISMATCH', 'preflight', '首帧文案与当前文案不一致，请重新生成预览', { keyframe_id: resolvedKeyframeId }, 409, false);
        }
        if (!keyframeRecord.qa?.pass) {
          throw new DhStrictError('KEYFRAME_QA_NOT_PASSED', 'preflight', '首帧未通过质量检查，请重新生成预览', {
            keyframe_id: resolvedKeyframeId,
            qa: keyframeRecord.qa,
          }, 422, true);
        }
        if (_isTemplateShowroomComposite(keyframeRecord.shot_plan)) {
          throw new DhStrictError('KEYFRAME_TEMPLATE_COMPOSITE_REJECTED', 'preflight', '当前首帧属于模板贴片合成，不能继续合成广告数字人成片，请重新生成自然融合预览', {
            keyframe_id: resolvedKeyframeId,
            failed_checks: ['template_composite_not_allowed', 'sticker_like_presenter'],
            shot_plan: keyframeRecord.shot_plan,
          }, 422, true);
        }

        const lipSyncModel = _pickRunnableStrictStageModel('ad_avatar.lip_sync', m => {
          const provider = String(m.provider_id || '').toLowerCase();
          const model = String(m.model_id || '').toLowerCase();
          return provider === 'hifly' || provider === 'topview' || provider === 'jimeng'
            || model === 'hifly' || model === 'hifly-free' || model.startsWith('topview-avatar') || model.includes('omni');
        });
        _pickRunnableStrictStageModel('ad_avatar.tts', m => {
          const provider = String(m.provider_id || '').toLowerCase();
          const model = String(m.model_id || '').toLowerCase();
          return provider.includes('tts') || model.includes('tts') || model.includes('cosyvoice');
        });

        const taskId = uuidv4();
        const aspectRatio = _normalizeAspectRatio(aspect_ratio || aspectRatioBody || keyframeRecord.aspectRatio, '16:9');
        const normalizedOutputSize = _normalizeOutputSize(output_size || outputSize || keyframeRecord.outputSize);
        _markTaskSuperseded(replaces_task_id, taskId, req.user?.id || null);
        const task = {
          id: taskId,
          taskId,
          status: 'submitted',
          stage: 'submitted',
          progress: 5,
          message: '已提交强制链路广告数字人任务',
          background_url,
          voice_id,
          title,
          text,
          duration_sec,
          subtitle,
          keyframes: [{ image_url: keyframeRecord.image_url, keyframe_id: keyframeRecord.id, qa: keyframeRecord.qa }],
          keyframe_id: keyframeRecord.id,
          user_id: req.user?.id,
          created_at: new Date().toISOString(),
          started_at: Date.now(),
          kind: 'production',
          mode: 'digital_ad',
          generation_mode: 'showroom_guide_strict',
          ad_mode: 'showroom_guide',
          guide_gender,
          ratio: aspectRatio,
          output_size: normalizedOutputSize,
          resolution: _outputSizeString(aspectRatio, normalizedOutputSize),
          strict: true,
        };
        productAdTasks.set(taskId, task);
        res.json({ success: true, strict: true, taskId, keyframe_id: keyframeRecord.id, message: '已提交强制链路广告数字人任务' });
        _runStrictSpaceGuideTask(req, taskId, {
          keyframeRecord,
          text,
          voiceId: voice_id,
          title,
          subtitle,
          durationSec: duration_sec,
          aspectRatio,
          outputSize: normalizedOutputSize,
          lipSyncModel,
        });
        return;
      } catch (err) {
        return _sendStrictError(res, err);
      }
    }
    if (req.body?.ad_mode === 'showroom_guide' && req.body?.generation_mode === 'showroom_guide_tracks') {
      const body = req.body || {};
      const {
        avatar_id = '',
        background_url,
        text,
        voice_id = null,
        replaces_task_id = '',
      } = body;
      if (!background_url) return res.status(400).json({ success: false, error: 'background_url 必填' });
      if (!String(text || '').trim()) return res.status(400).json({ success: false, error: 'text 必填' });
      if (!String(voice_id || '').trim()) return res.status(400).json({ success: false, error: 'voice_id 必填，请先选择配音音色' });
      const resolvedKeyframeId = String(body.keyframe_id || body.keyframes?.[0]?.keyframe_id || '').trim();
      if (!resolvedKeyframeId) {
        return res.status(422).json({
          success: false,
          error: '普通广告数字人必须先生成并确认带人物的导览员预览，不能直接用纯背景合成',
          code: 'SHOWROOM_TRACKS_KEYFRAME_REQUIRED',
          recoverable: true,
        });
      }
      const keyframeRecord = strictSpaceKeyframes.get(resolvedKeyframeId);
      if (!keyframeRecord) {
        return res.status(409).json({
          success: false,
          error: '预览首帧记录不存在或服务重启后已失效，请重新生成带人物的导览员预览',
          code: 'SHOWROOM_TRACKS_KEYFRAME_EXPIRED',
          keyframe_id: resolvedKeyframeId,
          recoverable: true,
        });
      }
      if (keyframeRecord.user_id && req.user?.id && keyframeRecord.user_id !== req.user.id) {
        return res.status(404).json({ success: false, error: '预览首帧不存在', code: 'SHOWROOM_TRACKS_KEYFRAME_NOT_FOUND' });
      }
      if (String(keyframeRecord.background_url || '') !== String(background_url || '')) {
        return res.status(409).json({
          success: false,
          error: '预览首帧背景与当前背景不一致，请重新生成预览',
          code: 'SHOWROOM_TRACKS_BACKGROUND_MISMATCH',
          recoverable: true,
        });
      }
      if (String(keyframeRecord.text || '').trim() !== String(text || '').trim()) {
        return res.status(409).json({
          success: false,
          error: '预览首帧文案与当前文案不一致，请重新生成预览',
          code: 'SHOWROOM_TRACKS_TEXT_MISMATCH',
          recoverable: true,
        });
      }
      if (!keyframeRecord.qa?.pass) {
        return res.status(422).json({
          success: false,
          error: '预览首帧未通过质量检查，不能合成视频，请重新生成',
          code: 'SHOWROOM_TRACKS_KEYFRAME_QA_FAILED',
          details: { qa: keyframeRecord.qa },
          recoverable: true,
        });
      }
      body.keyframe_id = keyframeRecord.id;
      body.keyframes = [{
        ...(body.keyframes?.[0] || {}),
        image_url: keyframeRecord.image_url,
        keyframe_id: keyframeRecord.id,
        reference_mode: 'showroom_guide_strict',
        qa: keyframeRecord.qa,
      }];

      const avatar = avatar_id ? db.getPortrait(avatar_id) : null;
      if (avatar_id && (!avatar || avatar.kind !== 'digital_human' || !ownedBy(req, avatar))) {
        return res.status(404).json({ success: false, error: '形象不存在' });
      }
      if (avatar_id && !avatar.image_url) return res.status(400).json({ success: false, error: '形象缺少图片' });

      const taskId = uuidv4();
      _markTaskSuperseded(replaces_task_id, taskId, req.user?.id || null);
      const task = adDigitalHumanTrackService.buildInitialTask({
        taskId,
        input: body,
        avatar,
        userId: req.user?.id || null,
      });
      productAdTasks.set(taskId, task);
      res.json({ success: true, taskId, generation_mode: 'showroom_guide_tracks', ad_mode: 'showroom_guide', message: '已提交普通广告数字人三轨任务' });
      adDigitalHumanTrackService.runShowroomGuideTracksTask({
        req,
        taskId,
        input: body,
        avatar,
        tasks: productAdTasks,
        patchTask: _taskPatch,
        outputDir: JIMENG_ASSETS_DIR,
      });
      return;
    }
    const {
      avatar_id,
      background_url,
      reference_images = [],
      text,
      voice_id = null,
      title = '广告数字人',
      scene = 'auto',
      camera = 'auto',
      scene_prompt = '',
      camera_prompt = '',
      duration_sec = null,
      segments = [],
      speech_segments = [],
      subtitle = null,
      generation_mode = 'topview',
      ad_mode = 'digital_ad',
      ad_style = 'luxury_soft',
      shot_count = null,
      keyframes = [],
      guide_gender = 'female',
      aspect_ratio,
      aspectRatio: aspectRatioBody,
      output_size,
      outputSize,
      bgm_asset = null,
      background_music = null,
      bgm_url = '',
      background_music_url = '',
      replaces_task_id = '',
    } = req.body || {};

    if (!background_url) return res.status(400).json({ success: false, error: 'background_url 必填' });
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'text 必填' });
    if (!String(voice_id || '').trim()) return res.status(400).json({ success: false, error: 'voice_id 必填，请先选择配音音色' });
    const requestBgmAsset = _luxuryBgmAssetFromPayload({ bgm_asset, background_music, bgm_url, background_music_url });

    const avatar = avatar_id ? db.getPortrait(avatar_id) : null;
    if (avatar_id && (!avatar || avatar.kind !== 'digital_human' || !ownedBy(req, avatar))) {
      return res.status(404).json({ success: false, error: '形象不存在' });
    }
    if (avatar_id && !avatar.image_url) return res.status(400).json({ success: false, error: '形象缺少图片' });

    const taskId = uuidv4();
    const aspectRatio = _normalizeAspectRatio(aspect_ratio || aspectRatioBody, '16:9');
    const normalizedOutputSize = _normalizeOutputSize(output_size || outputSize);
    _markTaskSuperseded(replaces_task_id, taskId, req.user?.id || null);
    const task = {
      id: taskId,
      taskId,
      status: 'submitted',
      stage: 'submitted',
      progress: 3,
      message: '已提交广告数字人任务',
      avatar_id,
      background_url,
      voice_id,
      scene,
      camera,
      scene_prompt,
      camera_prompt,
      title,
      text,
      duration_sec,
      segments,
      speech_segments,
      subtitle,
      keyframes,
      user_id: req.user?.id,
      created_at: new Date().toISOString(),
      started_at: Date.now(),
      kind: 'production',
      mode: ad_mode === 'luxury_ad' ? 'luxury_ad' : 'digital_ad',
      generation_mode,
      ad_mode,
      ad_style,
      shot_count,
      guide_gender,
      ratio: aspectRatio,
      output_size: normalizedOutputSize,
      resolution: _outputSizeString(aspectRatio, normalizedOutputSize),
      bgm_asset: ad_mode === 'luxury_ad' ? requestBgmAsset : null,
    };
    productAdTasks.set(taskId, task);
    res.json({ success: true, taskId, message: '已提交广告数字人任务' });
    _runSpaceGuideTask(req, taskId, {
      avatar,
      backgroundUrl: background_url,
      text,
      voiceId: voice_id,
      title,
      scene,
      camera,
      scenePrompt: scene_prompt,
      cameraPrompt: camera_prompt,
      durationSec: duration_sec,
      segments,
      speechSegments: speech_segments,
      subtitle,
      generationMode: generation_mode,
      adMode: ad_mode,
      adStyle: ad_style,
      shotCount: shot_count,
      keyframes,
      guideGender: guide_gender,
      referenceImages: reference_images,
      aspectRatio,
      outputSize: normalizedOutputSize,
      bgmAsset: requestBgmAsset,
    });
    return;

    const base = _publicBaseUrl(req);
    const keyframePrompt = _buildSpaceGuideKeyframePrompt({
      scene,
      title,
      text,
      scenePrompt: scene_prompt,
      kbContext: _buildDhKbContext('showroom_guide', _dhKbQuery(title, text, scene_prompt), { limit: 4, maxCharsPerDoc: 500 }),
    });
    const refs = [
      await _resolveImageForExternalApi(req, avatar.image_url),
      await _resolveImageForExternalApi(req, background_url),
    ].filter(Boolean);

    const keyframePath = await _generateViaDeyunaiNanoBanana({
      prompt: keyframePrompt,
      aspectRatio,
      outputSize: normalizedOutputSize,
      filename: `space_guide_${Date.now()}_${uuidv4().slice(0, 8)}`,
      destDir: JIMENG_ASSETS_DIR,
      referenceImages: refs,
    });
    const keyframeUrl = `${base}/public/jimeng-assets/${path.basename(keyframePath)}`;

    const showSubtitles = !!subtitle?.show;
    const guideSegments = _fallbackGuideSegments(text, Math.max(10, Math.ceil(String(text).length / 4)));
    const subtitleStyle = subtitle?.style || 'classic';
    const textEffects = showSubtitles
      ? _normalizeSubtitleSegments(guideSegments, text).map(s => ({
        text: s.text,
        position: 'bottom-center',
        style: 'subtitle',
        subtitleStyle,
        smartEmphasis: subtitle?.smartEmphasis === true,
        startTime: s.start ?? 0,
        endTime: s.end,
        fontSize: subtitle?.fontSize || 42,
        color: subtitle?.color || '#FFFFFF',
        outlineColor: subtitle?.outlineColor || '#000000',
      }))
      : [];

    const cameraMotion = ['push_in', 'static', 'handheld'].includes(camera) ? camera : 'push_in';
    const motionPrompt = [
      'One continuous showroom docent video. Presenter looks at the camera and speaks naturally.',
      'Keep the presenter on the left side and keep the right wall/display visible for the whole video.',
      'Natural open-palm gesture toward the display wall on the right, subtle head movement, realistic lip sync.',
      cameraMotion === 'push_in' ? 'Very slow smooth camera push-in, no cuts.' : '',
      cameraMotion === 'handheld' ? 'Very subtle handheld camera movement, no cuts.' : '',
      cameraMotion === 'static' ? 'Stable locked-off camera, no cuts.' : '',
      'No subtitles generated by the model itself, no stickers, no extra people, no layout changes.',
    ].filter(Boolean).join(' ');

    const resp = await axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
      image_url: keyframeUrl,
      text,
      audio_url: null,
      voiceId: voice_id || null,
      title: title || '广告数字人',
      prompt: motionPrompt,
      speed: 1.0,
      textEffects,
      stickers: [],
      cameraMotion,
      cameraSegments: [],
      coverWatermark: true,
      kind: 'production',
    }, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 30000,
    });

    if (!resp.data?.success) {
        return res.status(500).json({ success: false, error: resp.data?.error || '提交广告数字人任务失败', keyframeUrl });
    }

    res.json({
      success: true,
      taskId: resp.data.taskId,
      keyframeUrl,
      avatar_id,
      scene,
      camera: cameraMotion,
      message: '广告数字人视频已提交',
    });
  } catch (err) {
    const e = err.response?.data?.error || err.message;
    console.error('[DH/spaces/generate] 失败:', e);
    res.status(500).json({ success: false, error: e });
  }
});

router.get('/spaces/:taskId', (req, res) => {
  const task = productAdTasks.get(req.params.taskId) || db.getAvatarTask(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
  if (task.user_id && req.user?.id && task.user_id !== req.user.id) {
    return res.status(404).json({ success: false, error: '任务不存在' });
  }
  res.json({ success: true, task });
});

// ═══════════════════════════════════════════════
// Step 3 · POST /api/dh/videos/generate
//   body: { avatar_id, text, voice_id?, title? }
//   内部转发给 /api/avatar/jimeng-omni/generate
// —— 借助 Jimeng Omni 已实现的 TTS+驱动+持久化链路
// ═══════════════════════════════════════════════
router.post('/videos/generate', async (req, res) => {
  try {
    const {
      avatar_id,
      text,
      voice_id,
      title,
      segments = [],
      subtitle = null,
      product = null,
      aspect_ratio,
      aspectRatio: aspectRatioBody,
      output_size,
      outputSize,
    } = req.body || {};
    const aspectRatio = _normalizeAspectRatio(aspect_ratio || aspectRatioBody, '9:16');
    const normalizedOutputSize = _normalizeOutputSize(output_size || outputSize);
    if (!avatar_id) return res.status(400).json({ success: false, error: 'avatar_id 必填' });
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'text 必填' });

    const avatar = db.getPortrait(avatar_id);
    if (!avatar || avatar.kind !== 'digital_human' || !ownedBy(req, avatar)) {
      return res.status(404).json({ success: false, error: '形象不存在' });
    }
    if (!avatar.image_url) return res.status(400).json({ success: false, error: '形象缺少图片' });

    const effectiveProduct = product?.image_url
      ? product
      : ((avatar.avatar_type === 'product' || avatar.type === 'product') ? (avatar.product || null) : null);
    // ⚡ 优化：商品数字人在 Step 1 已经融合过一次，avatar.image_url 就是融合成品。
    // Step 3 再融合一次 → 模型把已融合图当 reference + 再叠加商品图 → 商品被引入两次/位置错乱/浪费 30-60 秒。
    // 仅当：① 请求体里显式传了新的 product（用户在 Step 3 临时换商品），或 ② avatar 本身没融合过（旧版本数据 / 异常）才再融合。
    const avatarAlreadyFused = !!(avatar.avatar_type === 'product' || avatar.type === 'product');
    const userOverridesProduct = !!(product?.image_url);
    const shouldFuse = effectiveProduct?.image_url && (userOverridesProduct || !avatarAlreadyFused);
    const fusedImageUrl = shouldFuse ? await _generateProductIntegratedAvatarImage(req, avatar, effectiveProduct) : null;
    const sourceImageUrl = fusedImageUrl || avatar.image_url;
    if (effectiveProduct?.image_url && !shouldFuse) {
      console.log('[DH/videos/generate] avatar 已是商品融合形象，跳过 Step 3 二次融合，直接驱动');
    }
    const subtitleCfg = subtitle || { show: true, fontName: '抖音美好体', fontSize: 60, color: '#FFFFFF', outlineColor: '#000000', style: 'popup', smartEmphasis: true };
    const showSubtitles = subtitleCfg.show !== false;
    const subtitleStyle = subtitleCfg.style || 'popup';
    const smartEmphasis = subtitleCfg.smartEmphasis !== false;
    // comic 风格默认顶部，其它默认底部
    const subtitlePosition = subtitleStyle === 'comic' ? 'top-center' : 'bottom-center';

    // 字幕：转换 segments + subtitle 配置 → Jimeng Omni 支持的 textEffects
    // 如果 subtitle.show=true 但没有 segments（AI 拆分失败 / 用户没点手动拆分），
    // 做一次本地字数 fallback 拆分：每段 ~16 字、按 4 字/秒估算 startTime/endTime。
    // 这样字幕至少能烧到视频上，而不是因为 segments 为空就整个丢弃。
    let effectiveSegments = Array.isArray(segments) ? segments : [];
    if (showSubtitles && !effectiveSegments.length && text && text.trim()) {
      const CHAR_PER_SEG = 16;
      const SEC_PER_CHAR = 0.25;
      const chunks = [];
      const src = text.trim();
      let idx = 0;
      while (idx < src.length) {
        // 按标点优先切分（。！？，、；），凑到 ≈ CHAR_PER_SEG 个字就收一段
        let end = Math.min(idx + CHAR_PER_SEG, src.length);
        // 试着往后退到最近的标点，但不要小于 CHAR_PER_SEG/2
        const windowEnd = Math.min(idx + CHAR_PER_SEG + 8, src.length);
        const slice = src.slice(idx, windowEnd);
        const m = slice.match(/^.*?[。！？，、；,\.!?;][^。！？，、；,\.!?;]*$/);
        if (m && m[0].length >= CHAR_PER_SEG / 2) {
          end = idx + m[0].length;
        }
        const segText = src.slice(idx, end).trim();
        if (segText) chunks.push(segText);
        idx = end;
      }
      let cursor = 0;
      effectiveSegments = chunks.map(t => {
        const dur = Math.max(0.6, t.length * SEC_PER_CHAR);
        const start = cursor;
        const endT = cursor + dur;
        cursor = endT;
        return { text: t, start, end: endT };
      });
      console.log(`[DH/videos/generate] subtitle.show=true 但前端未提供 segments，已 fallback 拆分为 ${effectiveSegments.length} 段`);
    }

    let textEffects = [];
    const subtitleSegments = showSubtitles ? _normalizeSubtitleSegments(effectiveSegments, text) : [];
    if (showSubtitles && effectiveSegments.length) {
      textEffects = subtitleSegments.map(s => ({
        text: s.text,
        position: subtitlePosition,
        style: 'subtitle',
        // 字幕动效预设：classic/popup/bouncy/karaoke/neon/comic/news/emphasis
        subtitleStyle,
        smartEmphasis,
        startTime: s.start ?? 0,
        endTime: s.end,
        // subtitle 配置用于字体/颜色/描边覆盖；不写就走 preset 默认
        fontName: subtitleCfg.fontName || '抖音美好体',
        fontSize: subtitleCfg.fontSize || 60,
        color: subtitleCfg.color || '',
        outlineColor: subtitleCfg.outlineColor || '',
      }));
    }

    const productPrompt = effectiveProduct?.image_url
      ? `\n商品数字人素材：已在生成前融合到人物形象图中（${effectiveProduct.image_name || effectiveProduct.name || '商品'}）。动作需要像真实口播一样自然手持、指向或展示商品，商品必须像被人物拿在手里或放在身前真实空间里，不要漂浮贴片。商品名称=${effectiveProduct.name || '未填写'}，卖点=${effectiveProduct.selling_points || '未填写'}。`
      : '';
    const segmentPrompt = effectiveSegments.length
      ? effectiveSegments.map(s => {
        const tone = s.tone || s.delivery || s.voice_tone || 'natural';
        const motion = s.motion || 'natural speaking';
        const expression = s.expression || 'natural';
        const camera = s.camera || 'static';
        return `${s.start ?? 0}-${s.end ?? ''}s | expression=${expression} | tone=${tone} | camera=${camera} | motion=${motion} | line=${s.text}`;
      }).join('\n') + productPrompt
      : productPrompt.trim();
    const productStickers = [];
    // ⚠️ 数字人单段视频不再分段运镜！原来把视频按字幕 segments trim+concat 会产生 hard cut（"切割感"）。
    // 改成整段统一一个柔和运镜，全程一镜到底。
    const cameraMotion = effectiveSegments.map(s => s.camera).find(c => c && c !== 'static')
      || (effectiveProduct?.image_url ? 'push_in' : 'static');
    const cameraSegments = []; // 强制不分段，避免切割感
    const audioUrl = null;
    console.log('[DH/videos/generate] 使用整段稳定 TTS + 整段一致运镜，避免分段切割感');

    const base = _publicBaseUrl(req);
    const resp = await axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
      image_url: sourceImageUrl,
      text: audioUrl ? null : text,
      audio_url: audioUrl,
      voiceId: voice_id || null,
      title: title || avatar.name,
      prompt: segmentPrompt,
      speed: 1.0,
      textEffects,
      stickers: productStickers,
      cameraMotion,
      cameraSegments,
      aspectRatio,
      ratio: aspectRatio,
      output_size: normalizedOutputSize,
      resolution: _outputSizeString(aspectRatio, normalizedOutputSize),
      // 默认开启左上角水印遮盖（delogo 像素修复，效果远好于黑块）
      // 即梦 Omni / Hifly 等 lip-sync 模型即使关了 aigc_flag，部分线上链路仍会带 AI 标识，统一覆盖
      coverWatermark: true,
      kind: 'production',
    }, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 30000,
    });

    if (!resp.data?.success) {
      return res.status(500).json({ success: false, error: resp.data?.error || '提交失败' });
    }

    res.json({
      success: true,
      taskId: resp.data.taskId,
      avatar_id,
      message: '已按管理端模型链提交，渲染 1-3 分钟',
    });
  } catch (err) {
    const e = err.response?.data?.error || err.message;
    console.error('[DH] videos/generate 失败:', e);
    res.status(500).json({ success: false, error: e });
  }
});

// GET /api/dh/videos/tasks — 用户所有数字人视频作品（从 avatar_db）
router.get('/videos/tasks', (req, res) => {
  try {
    const uid = scopeUserId(req);
    const tasks = db.listAvatarTasks(uid).filter(t => !t.hidden && !t.superseded_by && t.status !== 'superseded');
    const base = _publicBaseUrl(req);
    // 兼容：旧数据 kind 字段空 → 按 title 猜（含"预览样片"当 sample，其他按 production）
    const data = tasks.map(t => {
      let kind = t.kind;
      if (!kind) {
        kind = (t.title && /预览样片|sample/i.test(t.title)) ? 'sample' : 'production';
      }
      // 统一 thumbnail_url：优先已有 image_url（生成数字人时的形象图），
      // 否则走 on-demand 首帧端点（懒生成，第一次访问时 ffmpeg 抽帧+缓存）
      const hasVideo = !!(t.videoUrl || t.video_url || t.local_path || t.videoPath);
      const onDemandThumbnail = hasVideo ? `${base}/api/dh/videos/tasks/${t.id}/thumbnail` : null;
      const imageUrl = _localJimengAssetUrl(t.image_url || t.imageUrl, req);
      const thumbnailCandidate = _localJimengAssetUrl(t.thumbnail_url, req);
      const thumbnail_url = (!_isStaleJimengAssetUrl(thumbnailCandidate) && thumbnailCandidate)
        || (!_isStaleJimengAssetUrl(imageUrl) && imageUrl)
        || onDemandThumbnail;
      const video_url = _localJimengAssetUrl(t.video_url || t.videoUrl, req);
      const videoUrl = _localJimengAssetUrl(t.videoUrl || t.video_url, req);
      return { ...t, kind, image_url: imageUrl || t.image_url, thumbnail_url, video_url, videoUrl };
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dh/videos/tasks/:id
router.get('/videos/tasks/:id', (req, res) => {
  const t = db.getAvatarTask(req.params.id);
  if (!t || !ownedBy(req, t)) return res.status(404).json({ success: false, error: 'task not found' });
  res.json({ success: true, data: t });
});

// GET /api/dh/videos/tasks/:id/download — authenticated MP4 download for works cards.
router.get('/videos/tasks/:id/download', (req, res) => {
  try {
    const t = db.getAvatarTask(req.params.id);
    if (!t || !ownedBy(req, t)) return res.status(404).json({ success: false, error: 'task not found' });
    const localPath = t.videoPath || t.local_path;
    if (!localPath || !fs.existsSync(localPath)) return res.status(404).json({ success: false, error: 'video file not found' });
    const safeTitle = String(t.title || 'digital_human')
      .replace(/[\\/:*?"<>|\r\n]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 40) || 'digital_human';
    res.download(localPath, `${safeTitle}_${String(t.id || req.params.id).slice(0, 8)}.mp4`);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dh/videos/tasks/:id/thumbnail — 视频首帧 jpg（懒生成 + 缓存）
//   生成位置：与视频同目录的 <basename>.thumb.jpg
//   命中策略：缓存存在直接 stream；不存在 → ffmpeg.extractFirstFrame → 写盘 → stream
router.get('/videos/tasks/:id/thumbnail', async (req, res) => {
  try {
    const t = db.getAvatarTask(req.params.id);
    if (!t) return res.status(404).end();
    // 鉴权：作品库的 poster URL 走 <video> 标签直接发，<video poster> 不会带 Authorization
    // 因此这里不强制鉴权；但用 task id 不可枚举（uuid）来保证安全。

    const localPath = t.videoPath || t.local_path;
    if (!localPath || !fs.existsSync(localPath)) {
      // 没有本地视频文件（远端 URL）→ 返回 1x1 透明 png 占位
      return res.status(204).end();
    }

    const thumbPath = localPath.replace(/\.(mp4|mov|webm|mkv|avi)$/i, '') + '.thumb.jpg';
    if (!fs.existsSync(thumbPath)) {
      const ffmpegService = require('../services/ffmpegService');
      try {
        await ffmpegService.extractFirstFrame(localPath, thumbPath, { atSec: 0.5, width: 480 });
      } catch (e) {
        console.warn('[DH/thumbnail] 抽帧失败 ' + req.params.id + ':', e.message);
        return res.status(204).end();
      }
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(thumbPath).pipe(res);
  } catch (err) {
    console.warn('[DH/thumbnail] err:', err.message);
    res.status(500).end();
  }
});

// DELETE /api/dh/videos/tasks/:id — 删除作品 + 本地 mp4
router.delete('/videos/tasks/:id', (req, res) => {
  try {
    const t = db.getAvatarTask(req.params.id);
    if (!t || !ownedBy(req, t)) return res.status(404).json({ success: false, error: 'task not found' });
    // 删本地文件
    const files = [t.videoPath, t.local_path].filter(Boolean);
    for (const f of files) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} }
    db.deleteAvatarTask(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// 双人对话数字人（MVP）
//   - A/B 各一段 Jimeng Omni 任务并行跑
//   - 跑完用 FFmpeg hstack / vstack 合成 / 或依次 concat
// ═══════════════════════════════════════════════

const dualTasks = new Map(); // in-memory; 完成后写入 avatar_db 持久化

function _parseDualScript(script) {
  const aLines = [], bLines = [];
  let current = null;
  (script || '').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([AaBb])\s*[:：]\s*(.*)$/);
    if (m) {
      current = m[1].toUpperCase();
      const text = (m[2] || '').trim();
      if (text) (current === 'A' ? aLines : bLines).push(text);
    } else if (current && line.trim()) {
      (current === 'A' ? aLines : bLines).push(line.trim());
    }
  });
  return { aText: aLines.join('。'), bText: bLines.join('。') };
}

// POST /api/dh/dual/generate
//   body: { avatarA_id, avatarB_id, script, voice_a?, voice_b?, layout? }
router.post('/dual/generate', async (req, res) => {
  try {
    const { avatarA_id, avatarB_id, script, voice_a, voice_b, layout = 'hstack' } = req.body || {};
    if (!avatarA_id || !avatarB_id) return res.status(400).json({ success: false, error: '需要选 A 和 B 两个形象' });
    if (!script?.trim()) return res.status(400).json({ success: false, error: 'script 必填' });

    const avA = db.getPortrait(avatarA_id);
    const avB = db.getPortrait(avatarB_id);
    if (!avA || avA.kind !== 'digital_human' || !ownedBy(req, avA)) return res.status(404).json({ success: false, error: 'A 形象不存在' });
    if (!avB || avB.kind !== 'digital_human' || !ownedBy(req, avB)) return res.status(404).json({ success: false, error: 'B 形象不存在' });

    const { aText, bText } = _parseDualScript(script);
    if (!aText || !bText) return res.status(400).json({ success: false, error: '脚本需同时含 A: / B: 两种台词' });

    const taskId = uuidv4();
    const base = _publicBaseUrl(req);
    const task = {
      id: taskId,
      status: 'running',
      stage: 'submitting_both',
      created_at: Date.now(),
      user_id: req.user?.id || null,
      avatarA_id, avatarB_id,
      layout,
      aTaskId: null, bTaskId: null,
      aVideoPath: null, bVideoPath: null,
      video_url: null,
      error: null,
    };
    dualTasks.set(taskId, task);
    res.json({ success: true, taskId });

    // 异步流水线
    (async () => {
      try {
        const headers = req.headers.authorization ? { Authorization: req.headers.authorization } : {};
        // 1. 并行提交 A / B
        const [subA, subB] = await Promise.all([
          axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
            image_url: avA.image_url, text: aText, voiceId: voice_a || null, title: `[双人 A] ${avA.name}`, speed: 1.0,
          }, { headers, timeout: 30000 }).then(r => r.data),
          axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
            image_url: avB.image_url, text: bText, voiceId: voice_b || null, title: `[双人 B] ${avB.name}`, speed: 1.0,
          }, { headers, timeout: 30000 }).then(r => r.data),
        ]).catch(e => { throw new Error('提交失败: ' + (e.response?.data?.error || e.message)); });

        task.aTaskId = subA.taskId;
        task.bTaskId = subB.taskId;
        if (!task.aTaskId || !task.bTaskId) throw new Error('未拿到 A/B 任务 id');
        task.stage = 'rendering_both';

        // 2. 并行轮询直到两边都 done
        const pollOne = async (subTaskId) => {
          const start = Date.now();
          const MAX = 12 * 60 * 1000;
          while (Date.now() - start < MAX) {
            const r = await axios.get(`${base}/api/avatar/jimeng-omni/tasks/${subTaskId}`, { headers, timeout: 10000 }).catch(() => null);
            const t = r?.data?.task;
            if (!t) { await new Promise(r => setTimeout(r, 5000)); continue; }
            if (t.status === 'done' && t.local_path) return t;
            if (t.status === 'error') throw new Error('子任务失败: ' + (t.error || ''));
            await new Promise(r => setTimeout(r, 5000));
          }
          throw new Error('子任务超时 ' + subTaskId);
        };

        const [rA, rB] = await Promise.all([pollOne(task.aTaskId), pollOne(task.bTaskId)]);
        task.aVideoPath = rA.local_path;
        task.bVideoPath = rB.local_path;

        // 3. FFmpeg 合成
        task.stage = 'composing';
        const outDir = path.join(__dirname, '../../outputs/jimeng-assets');
        const outName = `dual_${taskId}.mp4`;
        const outPath = path.join(outDir, outName);

        const ffmpeg = require('fluent-ffmpeg');
        const ffmpegStatic = require('ffmpeg-static');
        ffmpeg.setFfmpegPath(ffmpegStatic);

        await new Promise((resolve, reject) => {
          const cmd = ffmpeg();
          cmd.input(rA.local_path).input(rB.local_path);
          // 按 layout 拼
          let filterComplex;
          if (layout === 'vstack') {
            filterComplex = [
              '[0:v]scale=720:1280,setsar=1[va]',
              '[1:v]scale=720:1280,setsar=1[vb]',
              '[va][vb]vstack=inputs=2[v]',
              // 音轨：A+B 混合
              '[0:a][1:a]amix=inputs=2:duration=longest[a]',
            ];
          } else if (layout === 'alternate') {
            filterComplex = [
              '[0:v]scale=1080:1920,setsar=1[va]',
              '[1:v]scale=1080:1920,setsar=1[vb]',
              '[va][0:a][vb][1:a]concat=n=2:v=1:a=1[v][a]',
            ];
          } else {
            // hstack（默认）
            filterComplex = [
              '[0:v]scale=540:1920,setsar=1[va]',
              '[1:v]scale=540:1920,setsar=1[vb]',
              '[va][vb]hstack=inputs=2[v]',
              '[0:a][1:a]amix=inputs=2:duration=longest[a]',
            ];
          }
          cmd.complexFilter(filterComplex)
            .outputOptions(['-map [v]', '-map [a]', '-c:v libx264', '-preset medium', '-crf 22', '-c:a aac', '-b:a 192k', '-shortest'])
            .save(outPath)
            .on('end', () => resolve())
            .on('error', err => reject(err));
        });

        task.video_url = `${base}/public/jimeng-assets/${outName}`;
        task.local_path = outPath;
        task.status = 'done';
        task.stage = 'done';
        task.finished_at = Date.now();

        // 持久化到 avatar_db
        try {
          const row = {
            id: taskId,
            user_id: task.user_id,
            status: 'done',
            title: `[双人] ${avA.name} & ${avB.name}`,
            videoUrl: task.video_url.replace(base, ''),
            videoPath: outPath,
            model: 'dual-omni',
            ratio: layout === 'vstack' ? '9:16' : (layout === 'alternate' ? '9:16' : '9:16'),
            source: 'dual',
            layout,
            avatarA_id, avatarB_id,
            created_at: new Date(task.created_at).toISOString(),
            finished_at: new Date().toISOString(),
          };
          if (!db.getAvatarTask(taskId)) db.insertAvatarTask(row);
        } catch (dbErr) { console.warn('[dual] DB 持久化失败:', dbErr.message); }

        console.log(`[DH/dual] 完成 ${taskId} → ${outPath}`);
      } catch (err) {
        task.status = 'error';
        task.error = err.message;
        console.error('[DH/dual] 失败:', err.message);
      }
    })();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dh/dual/tasks/:id
router.get('/dual/tasks/:id', (req, res) => {
  const t = dualTasks.get(req.params.id);
  if (!t) {
    // 可能已经只在 avatar_db 里了（服务重启后）
    const row = db.getAvatarTask(req.params.id);
    if (row && ownedBy(req, row)) return res.json({ success: true, task: row });
    return res.status(404).json({ success: false, error: 'task not found' });
  }
  res.json({ success: true, task: t });
});

// ═══════════════════════════════════════════════
// 阿里 Token 管理（快速更新入口）· 24h NLS token 易过期
// ═══════════════════════════════════════════════
function _findAliyunProvider(settings) {
  return (settings.providers || []).find(p => p.id === 'aliyun-tts')
      || (settings.providers || []).find(p => /aliyun|dashscope|百炼/i.test(p.id + '|' + (p.name || '')))
      || null;
}
function _tokenType(k) {
  if (!k) return 'unknown';
  if (/^sk-/.test(k)) return 'dashscope';   // 智能语音交互 2.0 sk-* · 永久
  if (/^[0-9a-f]{32}$/i.test(k)) return 'nls'; // 旧版 NLS AccessToken · 24h
  return 'dashscope'; // 默认按 dashscope（永久）处理
}

// GET /api/dh/aliyun-token/view — 只返回遮罩版 token + 更新时间
router.get('/aliyun-token/view', (req, res) => {
  try {
    const { loadSettings } = require('../services/settingsService');
    const settings = loadSettings();
    const p = _findAliyunProvider(settings);
    if (!p?.api_key) return res.json({ success: true, token_preview: '(未配置)', updated_at: null });
    const k = p.api_key;
    const preview = k.length <= 12 ? (k.slice(0, 3) + '***') : (k.slice(0, 6) + '…' + k.slice(-4));
    res.json({
      success: true,
      provider_id: p.id,
      token_preview: preview,
      token_type: _tokenType(k),
      updated_at: p.token_updated_at || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/dh/aliyun-token/update — { token }
router.post('/aliyun-token/update', (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token?.trim()) return res.status(400).json({ success: false, error: 'token 必填' });
    const trimmed = token.trim();

    const { loadSettings, saveSettings } = require('../services/settingsService');
    const settings = loadSettings();
    let p = _findAliyunProvider(settings);
    const type = _tokenType(trimmed);
    if (!p) {
      p = {
        id: 'aliyun-tts',
        preset: 'aliyun-tts',
        name: type === 'nls' ? '阿里云语音（旧版 NLS AccessToken · 24h）' : '阿里云智能语音交互 2.0（DashScope · 永久）',
        api_url: '',
        api_key: trimmed,
        enabled: true,
        models: [],
      };
      settings.providers.push(p);
    } else {
      p.api_key = trimmed;
      p.enabled = true;
    }
    p.token_updated_at = Date.now();
    saveSettings(settings);
    res.json({ success: true, type, provider_id: p.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// 健康诊断（哪个引擎可用）
// ═══════════════════════════════════════════════
router.get('/status', (req, res) => {
  const { loadSettings } = require('../services/settingsService');
  const settings = loadSettings();
  const hasProvider = (needle) => (settings.providers || []).some(p => {
    const hay = ((p.id || '') + '|' + (p.preset || '') + '|' + (p.name || '')).toLowerCase();
    return hay.includes(needle) && p.api_key;
  });

  res.json({
    success: true,
    engines: {
      seedream:    { available: hasProvider('volces') || hasProvider('ark') || hasProvider('火山') || hasProvider('seedream'), desc: 'Step1 文生图' },
      jimeng_omni: { available: hasProvider('jimeng') || hasProvider('volc') || hasProvider('火山') || !!process.env.JIMENG_ACCESS_KEY, desc: 'Step3 照片驱动数字人（推荐）' },
      wan_animate: { available: hasProvider('dashscope') || hasProvider('百炼') || hasProvider('wan') || !!process.env.DASHSCOPE_API_KEY, desc: 'Step3 阿里 Wan-Animate（备用）' },
      hifly_free:  { available: hasProvider('coze') || !!process.env.COZE_PAT, desc: 'Step3 飞影免费（公共 avatar，兜底）' },
      hifly_paid:  { available: hasProvider('hifly') || hasProvider('lingverse') || !!process.env.HIFLY_TOKEN, desc: '需 REST API Token' },
    },
  });
});

module.exports = router;
