const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const FormData = require('form-data');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const modelGateway = require('./modelGateway');
const mediaAdapter = require('./mediaAdapter');
const referenceVideoLinks = require('./referenceVideoLinkService');
const { getApiKey } = require('../settingsService');
const generationConcurrency = require('./generationConcurrencyService');

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs', 'new-story-ad', 'reference-video-analyses');
const MAX_DURATION_SECONDS = 180;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const REFERENCE_VISION_MAX_CANDIDATES = 3;
const REFERENCE_VISION_STAGE_BUDGET_MS = 240000;
const NON_RETRYABLE_TRANSCRIPT_CODES = new Set([
  'AUTH_CONFIG',
  'MODEL_CONFIG',
  'PROVIDER_BILLING',
  'INVALID_PROVIDER_INPUT',
  'INPUT_SENSITIVE_CONTENT',
]);
const activeRuns = new Map();
const activeImports = new Map();

function now() {
  return new Date().toISOString();
}

function ownerId(user = {}) {
  return String(user.id || user.userId || user.username || 'anonymous').trim() || 'anonymous';
}

function safeSegment(value = '') {
  return String(value || '').replace(/[^a-z0-9_-]/ig, '_').slice(0, 80) || 'anonymous';
}

function analysisDir(userId, analysisId) {
  return path.join(ROOT_DIR, safeSegment(userId), safeSegment(analysisId));
}

function recordPath(userId, analysisId) {
  return path.join(analysisDir(userId, analysisId), 'record.json');
}

function uploadSessionDir(userId, sessionId) {
  return path.join(ROOT_DIR, '_chunk_uploads', safeSegment(userId), safeSegment(sessionId));
}

function uploadSessionPath(userId, sessionId) {
  return path.join(uploadSessionDir(userId, sessionId), 'session.json');
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function readRecord(userId, analysisId) {
  const filePath = recordPath(userId, analysisId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function publicRecord(record = {}) {
  const copy = JSON.parse(JSON.stringify(record || {}));
  delete copy._visual_evidence_cache;
  if (['failed', 'cancelled'].includes(copy.status)) copy.progress = 0;
  if (copy.source) {
    delete copy.source.local_path;
    delete copy.source.private_directory;
    delete copy.source.input_url;
  }
  return copy;
}

function publicVisionFailure(error = {}) {
  const failedModels = (Array.isArray(error.failed_models) ? error.failed_models : [])
    .map(item => ({
      provider_id: String(item?.provider_id || ''),
      model_id: String(item?.model_id || ''),
      code: String(item?.code || 'UNKNOWN'),
      retry_after_ms: Math.max(0, Number(item?.retry_after_ms || 0)),
    }))
    .filter(item => item.provider_id && item.model_id);
  const code = String(error.code || 'REFERENCE_VIDEO_ANALYSIS_FAILED');
  const summary = failedModels.length
    ? failedModels.map(item => `${item.provider_id}/${item.model_id}:${item.code}`).join('；')
    : '';
  let message = String(error.message || error).slice(0, 500);
  if (code === 'VISION_CIRCUIT_OPEN') {
    message = '视觉模型当前不可用，系统已停止重复调用以避免浪费。请等待限流恢复或联系管理员修复模型配置。';
  } else if (code === 'VISION_QA_UNAVAILABLE') {
    message = `视觉分析模型均未成功${summary ? `（${summary}）` : ''}，未生成或覆盖后续人物、场景和剧情数据。`;
  }
  return {
    code,
    message,
    retryable: error.retryable === true,
    retry_after_ms: Math.max(0, Number(error.retry_after_ms || 0)),
    failed_models: failedModels,
  };
}

function assertOwned(analysisId, user = {}) {
  const userId = ownerId(user);
  const record = readRecord(userId, analysisId);
  if (!record) {
    const error = new Error('参考视频分析任务不存在或无权访问');
    error.code = 'REFERENCE_VIDEO_ANALYSIS_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  return record;
}

async function probeVideo(filePath) {
  if (!ffprobePath) {
    const error = new Error('服务器缺少 ffprobe，无法读取参考视频');
    error.code = 'FFPROBE_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate',
    '-of', 'json',
    filePath,
  ], { maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  const parsed = JSON.parse(stdout || '{}');
  const video = (parsed.streams || []).find(item => item.codec_type === 'video') || {};
  const audio = (parsed.streams || []).find(item => item.codec_type === 'audio') || {};
  return {
    duration_seconds: Number(Number(parsed.format?.duration || 0).toFixed(3)),
    size_bytes: Number(parsed.format?.size || 0),
    format: String(parsed.format?.format_name || ''),
    video_codec: String(video.codec_name || ''),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    fps: String(video.r_frame_rate || ''),
    has_audio: !!audio.codec_name,
    audio_codec: String(audio.codec_name || ''),
  };
}

function validateUpload(file = {}, metadata = {}) {
  const ext = path.extname(file.originalname || file.filename || '').toLowerCase();
  if (!['.mp4', '.mov', '.webm'].includes(ext)) {
    const error = new Error('参考视频仅支持 MP4、MOV 或 WebM');
    error.code = 'REFERENCE_VIDEO_FORMAT_UNSUPPORTED';
    error.status = 422;
    throw error;
  }
  if (Number(file.size || metadata.size_bytes || 0) > MAX_FILE_BYTES) {
    const error = new Error('参考视频不能超过 200MB');
    error.code = 'REFERENCE_VIDEO_TOO_LARGE';
    error.status = 413;
    throw error;
  }
  if (!metadata.width || !metadata.height || metadata.duration_seconds <= 0) {
    const error = new Error('文件中没有可读取的视频轨道');
    error.code = 'REFERENCE_VIDEO_INVALID';
    error.status = 422;
    throw error;
  }
  if (metadata.duration_seconds > MAX_DURATION_SECONDS) {
    const error = new Error('参考视频不能超过 180 秒');
    error.code = 'REFERENCE_VIDEO_TOO_LONG';
    error.status = 422;
    throw error;
  }
}

async function create({ file, body = {}, user = {} } = {}) {
  if (!file?.path) {
    const error = new Error('请选择参考视频');
    error.code = 'REFERENCE_VIDEO_REQUIRED';
    error.status = 400;
    throw error;
  }
  if (String(body.rights_confirmed || body.rightsConfirmed || '') !== 'true') {
    const error = new Error('请先确认拥有该视频的分析和使用权');
    error.code = 'REFERENCE_VIDEO_RIGHTS_REQUIRED';
    error.status = 422;
    throw error;
  }
  const userId = ownerId(user);
  const id = `ref_video_${uuidv4()}`;
  let metadata;
  try {
    metadata = await probeVideo(file.path);
    validateUpload(file, metadata);
  } catch (error) {
    try { fs.unlinkSync(file.path); } catch {}
    throw error;
  }
  const dir = analysisDir(userId, id);
  fs.mkdirSync(dir, { recursive: true });
  const sourceExt = path.extname(file.originalname || file.filename || '').toLowerCase();
  const sourcePath = path.join(dir, `source${sourceExt}`);
  fs.renameSync(file.path, sourcePath);
  const record = {
    id,
    user_id: userId,
    status: 'uploaded',
    progress: 0,
    phase: '等待分析',
    cancelled: false,
    rights_confirmed: true,
    identity_extraction_allowed: false,
    downstream_generation_triggered: false,
    task_id: '',
    source: {
      original_name: String(file.originalname || ''),
      mimetype: String(file.mimetype || ''),
      size_bytes: Number(file.size || metadata.size_bytes || 0),
      local_path: sourcePath,
      private_directory: dir,
      metadata,
    },
    checkpoints: [],
    result: null,
    error: null,
    created_at: now(),
    updated_at: now(),
  };
  writeJsonAtomic(recordPath(userId, id), record);
  return publicRecord(record);
}

async function runLinkImport(initialRecord, linkService, inspected) {
  let record = initialRecord;
  try {
    record = checkpoint(record, '正在安全读取公开视频链接', 8, { status: 'importing', error: null });
    const active = activeImports.get(record.id);
    let lastImportProgress = 8;
    const downloaded = await linkService.downloadVideo(
      record.source.input_url,
      analysisDir(record.user_id, record.id),
      {
        inspected,
        signal: active?.controller.signal,
        onProgress(received, total) {
          const latest = readRecord(record.user_id, record.id) || record;
          if (latest.cancelled) return;
          const ratio = total > 0 ? Math.min(1, received / total) : 0;
          const progress = total > 0 ? 10 + Math.round(ratio * 55) : 15;
          if (progress <= lastImportProgress) return;
          lastImportProgress = progress;
          record = checkpoint(latest, '正在读取链接视频', progress);
        },
      },
    );
    throwIfCancelled(record);
    record = checkpoint(record, '正在校验视频时长、大小与画面轨道', 72);
    const metadata = await probeVideo(downloaded.file_path);
    validateUpload({
      originalname: downloaded.original_name,
      filename: path.basename(downloaded.file_path),
      size: downloaded.size_bytes,
    }, metadata);
    const sourcePath = path.resolve(downloaded.file_path);
    const dir = path.resolve(analysisDir(record.user_id, record.id));
    if (!sourcePath.startsWith(`${dir}${path.sep}`)) {
      const error = new Error('链接视频保存路径不安全');
      error.code = 'UNSAFE_REFERENCE_VIDEO_LINK_PATH';
      error.status = 500;
      throw error;
    }
    save(record, {
      status: 'uploaded',
      phase: '链接视频已读取，等待开始分析',
      progress: 0,
      cancelled: false,
      source: {
        ...record.source,
        original_name: downloaded.original_name,
        mimetype: downloaded.mimetype,
        size_bytes: Number(downloaded.size_bytes || metadata.size_bytes || 0),
        local_path: sourcePath,
        private_directory: dir,
        metadata,
        read_method: downloaded.method,
      },
      imported_at: now(),
    });
  } catch (error) {
    const latest = readRecord(record.user_id, record.id) || record;
    if (error.cancelled || latest.cancelled || error.code === 'REFERENCE_VIDEO_IMPORT_CANCELLED') {
      save(latest, {
        status: 'cancelled',
        phase: '链接读取已取消',
        progress: 0,
        error: null,
        cancelled_at: now(),
      });
    } else {
      save(latest, {
        status: 'failed',
        phase: '链接视频读取失败',
        progress: 0,
        error: {
          code: error.code || 'REFERENCE_VIDEO_LINK_IMPORT_FAILED',
          message: String(error.message || error).slice(0, 500),
        },
        failed_at: now(),
      });
    }
  } finally {
    activeImports.delete(initialRecord.id);
  }
}

async function createFromUrl({ body = {}, user = {}, linkService = referenceVideoLinks } = {}) {
  if (String(body.rights_confirmed || body.rightsConfirmed || '') !== 'true') {
    const error = new Error('请先确认拥有该视频的分析和使用权');
    error.code = 'REFERENCE_VIDEO_RIGHTS_REQUIRED';
    error.status = 422;
    throw error;
  }
  const rawUrl = body.video_url || body.videoUrl || body.url || '';
  const inspected = await linkService.inspectUrl(rawUrl);
  const userId = ownerId(user);
  const id = `ref_video_${uuidv4()}`;
  const dir = analysisDir(userId, id);
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    id,
    user_id: userId,
    status: 'importing',
    progress: 3,
    phase: '正在检查视频链接',
    cancelled: false,
    rights_confirmed: true,
    identity_extraction_allowed: false,
    downstream_generation_triggered: false,
    task_id: '',
    source: {
      input_type: 'url',
      input_url: inspected.url,
      display_url: inspected.display_url,
      platform: inspected.platform,
      original_name: inspected.hostname,
      mimetype: '',
      size_bytes: 0,
      local_path: '',
      private_directory: dir,
      metadata: {},
    },
    checkpoints: [],
    result: null,
    error: null,
    created_at: now(),
    updated_at: now(),
  };
  writeJsonAtomic(recordPath(userId, id), record);
  const controller = new AbortController();
  activeImports.set(id, { controller, promise: null });
  const promise = runLinkImport(record, linkService, inspected);
  activeImports.get(id).promise = promise;
  return publicRecord(record);
}

function createUploadSession({ body = {}, user = {} } = {}) {
  if (String(body.rights_confirmed || body.rightsConfirmed || '') !== 'true') {
    const error = new Error('请先确认拥有该视频的分析和使用权');
    error.code = 'REFERENCE_VIDEO_RIGHTS_REQUIRED';
    error.status = 422;
    throw error;
  }
  const fileName = path.basename(String(body.file_name || body.fileName || ''));
  const ext = path.extname(fileName).toLowerCase();
  const sizeBytes = Number(body.size_bytes || body.sizeBytes || 0);
  const chunkSize = Math.max(1024 * 1024, Math.min(5 * 1024 * 1024, Number(body.chunk_size || body.chunkSize || 5 * 1024 * 1024)));
  const totalChunks = Math.ceil(sizeBytes / chunkSize);
  if (!['.mp4', '.mov', '.webm'].includes(ext)) {
    const error = new Error('参考视频仅支持 MP4、MOV 或 WebM');
    error.code = 'REFERENCE_VIDEO_FORMAT_UNSUPPORTED';
    error.status = 422;
    throw error;
  }
  if (!sizeBytes || sizeBytes > MAX_FILE_BYTES || totalChunks < 1 || totalChunks > 200) {
    const error = new Error('参考视频大小无效或超过 200MB');
    error.code = 'REFERENCE_VIDEO_TOO_LARGE';
    error.status = 413;
    throw error;
  }
  const userId = ownerId(user);
  const fingerprint = crypto.createHash('sha256')
    .update([userId, fileName, sizeBytes, body.last_modified || body.lastModified || ''].join(':'))
    .digest('hex')
    .slice(0, 32);
  const id = `ref_upload_${fingerprint}`;
  const existing = readJsonSafe(uploadSessionPath(userId, id));
  if (existing) return publicUploadSession(existing);
  const session = {
    id,
    user_id: userId,
    status: 'uploading',
    file_name: fileName,
    mimetype: String(body.mimetype || 'application/octet-stream'),
    size_bytes: sizeBytes,
    chunk_size: chunkSize,
    total_chunks: totalChunks,
    received_chunks: [],
    rights_confirmed: true,
    analysis_id: '',
    created_at: now(),
    updated_at: now(),
  };
  writeJsonAtomic(uploadSessionPath(userId, id), session);
  return publicUploadSession(session);
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function assertUploadSession(sessionId, user = {}) {
  const userId = ownerId(user);
  const session = readJsonSafe(uploadSessionPath(userId, sessionId));
  if (!session) {
    const error = new Error('参考视频分片上传会话不存在或无权访问');
    error.code = 'REFERENCE_VIDEO_UPLOAD_SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  return session;
}

function publicUploadSession(session = {}) {
  return {
    ...session,
    received_chunks: [...(session.received_chunks || [])].sort((a, b) => a - b),
  };
}

function saveUploadChunk(sessionId, index, file = {}, user = {}) {
  let session = assertUploadSession(sessionId, user);
  if (session.status === 'completed') return publicUploadSession(session);
  const chunkIndex = Number(index);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.total_chunks) {
    const error = new Error('参考视频分片序号无效');
    error.code = 'REFERENCE_VIDEO_CHUNK_INDEX_INVALID';
    error.status = 422;
    throw error;
  }
  if (!file.path || Number(file.size || 0) > session.chunk_size + 1024) {
    const error = new Error('参考视频分片为空或超过 5MB');
    error.code = 'REFERENCE_VIDEO_CHUNK_INVALID';
    error.status = 422;
    throw error;
  }
  const dir = uploadSessionDir(session.user_id, session.id);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `chunk-${String(chunkIndex).padStart(4, '0')}.part`);
  if (fs.existsSync(target) && fs.statSync(target).size === Number(file.size || 0)) {
    try { fs.unlinkSync(file.path); } catch {}
  } else {
    fs.renameSync(file.path, target);
  }
  session = {
    ...session,
    status: 'uploading',
    received_chunks: [...new Set([...(session.received_chunks || []), chunkIndex])],
    updated_at: now(),
  };
  writeJsonAtomic(uploadSessionPath(session.user_id, session.id), session);
  return publicUploadSession(session);
}

async function appendFileToStream(sourcePath, output) {
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(sourcePath);
    const cleanup = () => output.removeListener('error', onError);
    const onError = (error) => { cleanup(); reject(error); };
    input.on('error', onError);
    output.once('error', onError);
    input.on('end', () => { cleanup(); resolve(); });
    input.pipe(output, { end: false });
  });
}

async function completeUploadSession(sessionId, user = {}) {
  let session = assertUploadSession(sessionId, user);
  if (session.status === 'completed' && session.analysis_id) {
    return { session: publicUploadSession(session), analysis: get(session.analysis_id, user) };
  }
  const missing = Array.from({ length: session.total_chunks }, (_, index) => index)
    .filter(index => !(session.received_chunks || []).includes(index));
  if (missing.length) {
    const error = new Error(`参考视频仍缺少 ${missing.length} 个分片`);
    error.code = 'REFERENCE_VIDEO_CHUNKS_INCOMPLETE';
    error.status = 409;
    error.details = { missing_chunks: missing };
    throw error;
  }
  const dir = uploadSessionDir(session.user_id, session.id);
  const mergedPath = path.join(dir, `merged${path.extname(session.file_name).toLowerCase()}`);
  const output = fs.createWriteStream(mergedPath);
  for (let index = 0; index < session.total_chunks; index += 1) {
    await appendFileToStream(path.join(dir, `chunk-${String(index).padStart(4, '0')}.part`), output);
  }
  await new Promise((resolve, reject) => {
    output.on('error', reject);
    output.end(resolve);
  });
  const stat = fs.statSync(mergedPath);
  if (stat.size !== session.size_bytes) {
    const error = new Error('参考视频分片合并后的大小不一致');
    error.code = 'REFERENCE_VIDEO_CHUNK_SIZE_MISMATCH';
    error.status = 422;
    throw error;
  }
  const analysis = await create({
    file: {
      path: mergedPath,
      originalname: session.file_name,
      mimetype: session.mimetype,
      size: stat.size,
    },
    body: { rights_confirmed: 'true' },
    user,
  });
  for (let index = 0; index < session.total_chunks; index += 1) {
    try { fs.unlinkSync(path.join(dir, `chunk-${String(index).padStart(4, '0')}.part`)); } catch {}
  }
  session = {
    ...session,
    status: 'completed',
    received_chunks: Array.from({ length: session.total_chunks }, (_, index) => index),
    analysis_id: analysis.id,
    completed_at: now(),
    updated_at: now(),
  };
  writeJsonAtomic(uploadSessionPath(session.user_id, session.id), session);
  return { session: publicUploadSession(session), analysis };
}

function cancelUploadSession(sessionId, user = {}) {
  const session = assertUploadSession(sessionId, user);
  const dir = uploadSessionDir(session.user_id, session.id);
  const root = path.resolve(ROOT_DIR, '_chunk_uploads');
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error('参考视频分片目录不安全，已停止删除');
    error.code = 'UNSAFE_REFERENCE_VIDEO_UPLOAD_PATH';
    error.status = 500;
    throw error;
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  return { id: sessionId, cancelled: true };
}

function save(record, patch = {}) {
  const next = { ...record, ...patch, updated_at: now() };
  writeJsonAtomic(recordPath(record.user_id, record.id), next);
  return next;
}

function checkpoint(record, phase, progress, extra = {}) {
  const row = {
    ...record,
    ...extra,
    phase,
    progress: Math.max(0, Math.min(100, Number(progress || 0))),
    checkpoints: [...(record.checkpoints || []), { phase, progress, at: now() }].slice(-30),
  };
  return save(row);
}

function throwIfCancelled(record) {
  const latest = readRecord(record.user_id, record.id) || record;
  if (latest.cancelled) {
    const error = new Error('参考视频分析已取消');
    error.code = 'REFERENCE_VIDEO_ANALYSIS_CANCELLED';
    error.cancelled = true;
    throw error;
  }
}

function evidenceTimes(duration) {
  const safeDuration = Math.max(0.1, Number(duration) || 0.1);
  const count = Math.max(6, Math.min(10, Math.ceil(safeDuration / 10) + 5));
  const start = Math.min(0.3, Math.max(0.05, safeDuration * 0.02));
  const end = Math.max(start, safeDuration - 0.05);
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return start;
    if (index === count - 1) return end;
    const ratio = index / (count - 1);
    return Math.max(0, Math.min(end, start + ((end - start) * ratio)));
  });
}

async function extractEvidenceFrames(record) {
  if (!ffmpegPath) {
    const error = new Error('服务器缺少 ffmpeg，无法提取参考视频证据帧');
    error.code = 'FFMPEG_UNAVAILABLE';
    throw error;
  }
  const duration = record.source.metadata.duration_seconds;
  const frames = [];
  const times = evidenceTimes(duration);
  fs.mkdirSync(mediaAdapter.ASSET_DIR, { recursive: true });
  for (let index = 0; index < times.length; index += 1) {
    throwIfCancelled(record);
    const filename = `refev_${record.id.slice(-12)}_${String(index + 1).padStart(2, '0')}.jpg`;
    const out = mediaAdapter.assetPathFromName(filename);
    if (!fs.existsSync(out) || fs.statSync(out).size < 1024) {
      await execFileAsync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', String(times[index]),
        '-i', record.source.local_path,
        '-frames:v', '1',
        '-vf', 'scale=960:-2',
        '-q:v', '3',
        out,
      ], { maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    }
    frames.push({
      index,
      timestamp_seconds: Number(times[index].toFixed(2)),
      filename,
      image_url: mediaAdapter.publicAssetUrl(filename),
    });
  }
  return frames;
}

function isReusableTranscriptFailure(transcript = {}) {
  if (transcript.status !== 'failed_non_blocking') return false;
  const stored = transcript.error || {};
  if (stored.retryable === false && NON_RETRYABLE_TRANSCRIPT_CODES.has(String(stored.code || ''))) {
    return true;
  }
  const classified = modelGateway.classifyError({
    code: stored.code,
    message: stored.message,
  });
  return NON_RETRYABLE_TRANSCRIPT_CODES.has(classified.code);
}

async function transcribeAudio(record) {
  if (record.transcript?.status === 'completed' || record.transcript?.status === 'mocked') return record.transcript;
  if (isReusableTranscriptFailure(record.transcript)) return record.transcript;
  if (!record.source.metadata.has_audio) return { status: 'no_audio', text: '', segments: [] };
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    return {
      status: 'mocked',
      text: '示例旁白：提出问题，展示解决过程，并给出行动号召。',
      segments: [{
        start: 0,
        end: record.source.metadata.duration_seconds,
        text: '示例旁白：提出问题，展示解决过程，并给出行动号召。',
      }],
    };
  }
  const apiKey = getApiKey('openai') || process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: 'provider_not_configured', text: '', segments: [] };
  const audioPath = path.join(analysisDir(record.user_id, record.id), 'transcript-audio.mp3');
  try {
    await execFileAsync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', record.source.local_path,
      '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1', '-b:a', '64k',
      audioPath,
    ], { maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: 90000 });
    throwIfCancelled(record);
    const form = new FormData();
    form.append('file', fs.createReadStream(audioPath));
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${apiKey}` },
      timeout: 120000,
      maxContentLength: 60 * 1024 * 1024,
      maxBodyLength: 60 * 1024 * 1024,
    });
    const segments = (response.data?.segments || []).map(item => ({
      start: Number(item.start || 0),
      end: Number(item.end || 0),
      text: String(item.text || '').trim(),
    })).filter(item => item.text);
    return {
      status: 'completed',
      text: String(response.data?.text || segments.map(item => item.text).join(' ')).trim(),
      segments,
    };
  } catch (error) {
    if (error.cancelled) throw error;
    const classified = modelGateway.classifyError(error);
    return {
      status: 'failed_non_blocking',
      text: '',
      segments: [],
      error: {
        code: classified.code || error.code || 'ASR_FAILED',
        message: String(error.message || error).slice(0, 240),
        retryable: classified.retryable === true,
      },
    };
  } finally {
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch {}
  }
}

function mockAnalysis(record, frames) {
  const duration = record.source.metadata.duration_seconds;
  const midpoint = Number((duration / 2).toFixed(2));
  return {
    schema_version: 3,
    analysis_scope: 'reference_content_and_creative_structure',
    prohibited_reuse: ['person_identity', 'face', 'source_wardrobe_copy', 'private_attributes'],
    source_facts: {
      product_or_service: '当前参考视频中的可见广告主体',
      visible_text: [],
      environment: '参考视频中实际可见的主要空间',
      materials: ['按证据帧识别的真实材质'],
      colors: ['按证据帧识别的主色'],
      layout: '按证据帧记录主体、人物与背景的空间关系',
      lighting: '按证据帧记录主光方向与明暗关系',
      human_presence: true,
      human_actions: ['人物接近广告主体并完成明确互动'],
      chronological_story: ['建立广告主体', '人物互动展示', '结果与行动号召'],
      evidence_timestamps: frames.map(item => item.timestamp_seconds),
    },
    summary: '参考片采用问题—转折—解决—行动号召结构，镜头由环境建立逐步推进到主体细节。',
    generated_brief: [
      '【广告目标】围绕产品核心痛点建立问题，并用清晰的使用结果完成说服。',
      '【完整剧情】开场建立环境与问题，主角发现阻碍；中段通过明确行动使用产品解决问题；转折处突出产品带来的变化；结尾展示结果并以行动号召收束。',
      '【人物提示词】原创成年主角，身份与当前产品目标用户相符；外貌自然可信，服装根据当前品牌和场景重新设计；保持年龄、发型、服装、配饰和表演气质跨镜一致。',
      '【场景提示词】根据当前产品重新建立真实空间，写清布局、材质、光线、互动区域、商品位置和禁止项，不复制原片品牌与私有场景。',
      '【人物动作】动作按起始姿态、关键动作、结束姿态编排，并写清手部接触、视线和表情变化。',
      '【场景与机位】先建立空间主机位，再使用互动机位和细节机位；实际机位将在场景资产生成后映射。',
      '【运镜与节奏】前段稳定建立，中段轻推或横移跟随，结尾减速停稳。',
      '【字幕与 CTA】字幕短句化，结尾保留明确行动号召。',
    ].join('\n'),
    story_outline: {
      logline: '主角遇到与当前产品有关的问题，通过清晰行动完成解决，并以可见结果建立购买理由。',
      opening: '建立人物、空间和问题。',
      development: '人物尝试解决并自然引出产品。',
      turning_point: '产品发挥作用，人物态度和场景状态发生变化。',
      resolution: '结果特写、价值总结和行动号召。',
    },
    plot_beats: [
      { order: 1, purpose: '建立问题', range: [0, midpoint], rhythm: '中速' },
      { order: 2, purpose: '展示解决与结果', range: [midpoint, duration], rhythm: '先快后稳' },
    ],
    camera_intents: [
      {
        id: 'camera_intent_1',
        range: [0, midpoint],
        movement: 'slow_push_in',
        movement_subject: 'camera',
        start_shot_size: 'wide',
        end_shot_size: 'medium',
        angle: 'eye_level',
        lens_estimate_mm: 35,
        direction: 'forward',
        speed: 'slow',
        stabilization: 'gimbal',
        axis_rule: 'keep_180_degree_axis',
        screen_direction: 'left_to_right',
        entry_exit: 'subject enters left, holds center',
        evidence_timestamps: frames.slice(0, 3).map(item => item.timestamp_seconds),
      },
      {
        id: 'camera_intent_2',
        range: [midpoint, duration],
        movement: 'locked_then_micro_pull_out',
        movement_subject: 'camera',
        start_shot_size: 'close_up',
        end_shot_size: 'medium_close_up',
        angle: 'slight_high',
        lens_estimate_mm: 50,
        direction: 'backward',
        speed: 'very_slow',
        stabilization: 'tripod',
        axis_rule: 'same_axis',
        screen_direction: 'center_hold',
        entry_exit: 'no entry or exit',
        evidence_timestamps: frames.slice(-3).map(item => item.timestamp_seconds),
      },
    ],
    character_actions: [
      {
        id: 'generic_action_1',
        role: '通用主角',
        start_pose: '自然站立，视线看向互动目标',
        key_action: '右手完成产品交互，身体轻微前倾',
        end_pose: '回到稳定展示姿态并看向结果',
        dominant_hand: 'right',
        prop_contact: '手与产品发生明确接触',
        screen_direction: 'left_to_right',
        eyeline: '互动目标→产品→镜头外结果',
        expression_change: '疑惑→专注→认可',
        previous_frame_dependency: '延续上一镜头手部位置和产品朝向',
      },
    ],
    character_prompts: [{
      id: 'character_prompt_1',
      role: '原创成年主角',
      narrative_function: '发现问题、执行产品交互并展示结果',
      age_range: '按当前目标用户判断，默认成年',
      appearance_direction: '自然可信的真实商业人物，避免网红脸和过度磨皮',
      wardrobe_direction: '根据当前品牌、职业身份和场景重新设计上衣、下装或裙装、鞋、配饰、颜色与材质，不复制原片服装',
      performance_style: '表演克制自然，情绪由疑惑转为专注再到认可',
      continuity_rules: '年龄感、脸型方向、发型、服装、鞋和配饰跨镜保持一致',
      negative_prompt: '不要复刻原片真人身份、脸部或服装；不要夸张表情、塑料皮肤、肢体畸形和无关电子产品',
    }],
    scene_prompts: [{
      id: 'scene_prompt_1',
      beat_refs: [1, 2],
      location_type: '与当前产品使用情境相符的真实空间',
      layout_prompt: '建立入口、主行动区、产品交互区和结果展示区，空间关系连续可拍',
      material_light_prompt: '材质、色彩、纹理与光线符合当前品牌定位，使用可信的自然光和商业重点光',
      interaction_prompt: '预留人物行动路线、产品接触位置和主机位、互动机位、细节机位',
      camera_purpose: '主机位建立空间，互动机位跟随动作，细节机位突出产品结果',
      negative_prompt: '不要复制原片品牌、文字、水印或私有场景；不要结构漂移、材质失真和无关人物',
    }],
    transcript: record.transcript || { status: record.source.metadata.has_audio ? 'provider_not_configured' : 'no_audio', text: '', segments: [] },
    subtitle_cta: { subtitle_style: '短句、结果导向', cta: '立即了解 / 立即体验' },
    prompt_suggestions: {
      plot: '以问题、行动、结果、CTA 四段结构生成原创广告内容。',
      character: '根据当前目标用户重新设计原创人物，写清身份、年龄感、外貌气质、原创服装、表演和跨镜一致性。',
      scene: '按当前产品重新设计场景，写清布局、材质、光线、互动区、机位用途和禁止项。',
      camera: '保持空间轴线，建立镜头后轻推，中段跟随动作，结尾停稳。',
      action: '每个动作写清起始、关键、结束、手部接触、视线和表情变化。',
    },
    evidence_frames: frames,
  };
}

function hasReadableChinese(value = '') {
  const text = String(value || '').trim();
  const chineseCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const longEnglishWords = (text.match(/[A-Za-z]{4,}/g) || []).length;
  return chineseCount >= 12 && longEnglishWords <= Math.max(3, Math.floor(chineseCount / 4));
}

function hasChineseDetail(value = '', minimum = 4) {
  return (String(value || '').match(/[\u3400-\u9fff]/g) || []).length >= minimum;
}

function refusalLike(value = '') {
  const text = String(value || '').trim();
  return /(?:i(?:'| a)?m sorry|i can(?:not|'t)|unable to (?:assist|comply|help)|cannot assist|抱歉|无法(?:协助|完成|提供)|不能(?:协助|完成|提供))/i.test(text);
}

function assertCandidateAnalysisText(text = '') {
  const raw = String(text || '').trim();
  const requiredKeys = ['story_outline', 'plot_beats', 'scene_prompts', 'camera_intents', 'source_facts'];
  const foundKeys = requiredKeys.filter(key => raw.includes(key));
  const refused = refusalLike(raw);
  if (!raw || refused || foundKeys.length < 4) {
    const error = new Error(
      `视觉模型未返回可用的参考视频内容识别合同`
      + `（长度=${raw.length}，字段=${foundKeys.join('|') || 'none'}，拒绝=${refused ? 'yes' : 'no'}），已切换下一候选模型`,
    );
    error.code = 'PROVIDER_RESPONSE_INVALID';
    error.retryable = true;
    error.response_diagnostics = {
      response_length: raw.length,
      required_keys_found: foundKeys,
      refusal_detected: refused,
    };
    throw error;
  }
  return true;
}

function validateAnalysisResult(result = {}) {
  const source = result && typeof result === 'object' ? result : {};
  const serialized = JSON.stringify(source);
  const facts = source.source_facts && typeof source.source_facts === 'object' ? source.source_facts : {};
  const outline = source.story_outline && typeof source.story_outline === 'object' ? source.story_outline : {};
  const beats = Array.isArray(source.plot_beats) ? source.plot_beats : [];
  const scenes = Array.isArray(source.scene_prompts) ? source.scene_prompts : [];
  const cameras = Array.isArray(source.camera_intents) ? source.camera_intents : [];
  const actions = Array.isArray(source.character_actions) ? source.character_actions : [];
  const factMaterials = Array.isArray(facts.materials) ? facts.materials.filter(Boolean) : [];
  const outlineParts = ['logline', 'opening', 'development', 'turning_point', 'resolution']
    .filter(key => hasChineseDetail(outline[key], 4));
  const failures = [];
  if (refusalLike(serialized)) failures.push('provider_refusal');
  if (!hasChineseDetail(facts.product_or_service, 2)) failures.push('source_product_missing');
  if (!hasChineseDetail(facts.environment, 2)) failures.push('source_environment_missing');
  if (!factMaterials.some(item => hasChineseDetail(item, 2))) failures.push('source_material_missing');
  if (outlineParts.length < 4) failures.push('story_outline_incomplete');
  if (beats.length < 2 || !beats.every(item => hasChineseDetail(item?.purpose, 2))) failures.push('plot_beats_incomplete');
  if (!scenes.length || !scenes.every(item => (
    hasChineseDetail(item?.location_type, 2)
    && hasChineseDetail(item?.layout_prompt, 4)
    && hasChineseDetail(item?.material_light_prompt, 4)
  ))) failures.push('scene_prompts_incomplete');
  if (!cameras.length) failures.push('camera_intents_missing');
  if (facts.human_presence === true && !actions.length) failures.push('character_actions_missing');
  if (failures.length) {
    const error = new Error(`参考视频识别结果不完整：${failures.join(', ')}`);
    error.code = 'REFERENCE_VIDEO_ANALYSIS_SEMANTIC_INVALID';
    error.status = 422;
    error.retryable = true;
    error.failures = failures;
    throw error;
  }
  return {
    valid: true,
    failures: [],
    source_fact_count: [
      facts.product_or_service,
      facts.environment,
      facts.layout,
      facts.lighting,
      ...factMaterials,
    ].filter(Boolean).length,
  };
}

function rangeLabel(range = []) {
  const start = Number(range?.[0] || 0);
  const end = Number(range?.[1] || 0);
  return end > start ? `${start.toFixed(1)}—${end.toFixed(1)} 秒` : '对应画面时段';
}

function enumLabel(value, labels, fallback) {
  const key = String(value || '').trim().toLowerCase();
  return labels[key] || fallback;
}

function buildChineseBrief(result = {}) {
  const beats = Array.isArray(result.plot_beats) ? result.plot_beats.slice(0, 6) : [];
  const cameras = Array.isArray(result.camera_intents) ? result.camera_intents.slice(0, 6) : [];
  const actions = Array.isArray(result.character_actions) ? result.character_actions.slice(0, 6) : [];
  const characters = Array.isArray(result.character_prompts) ? result.character_prompts.slice(0, 6) : [];
  const scenes = Array.isArray(result.scene_prompts) ? result.scene_prompts.slice(0, 8) : [];
  const outline = result.story_outline && typeof result.story_outline === 'object' ? result.story_outline : {};
  const facts = result.source_facts && typeof result.source_facts === 'object' ? result.source_facts : {};
  const shotLabels = {
    wide: '全景',
    long_shot: '远景',
    medium: '中景',
    medium_shot: '中景',
    medium_close_up: '中近景',
    close_up: '近景',
    extreme_close_up: '特写',
  };
  const movementLabels = {
    static: '固定机位',
    locked: '固定机位',
    slow_push_in: '缓慢推近',
    push_in: '推近',
    zoom_in: '变焦推近',
    pull_out: '拉远',
    slow_pull_out: '缓慢拉远',
    locked_then_micro_pull_out: '先固定、再轻微拉远',
    pan_left: '向左摇摄',
    pan_right: '向右摇摄',
    tracking: '跟随移动',
    steady_tracking: '稳定跟随',
    handheld: '轻微手持',
  };
  const angleLabels = {
    eye_level: '平视',
    slight_high: '轻微俯拍',
    high_angle: '俯拍',
    low_angle: '仰拍',
    over_the_shoulder: '越肩视角',
  };
  const summary = hasReadableChinese(result.summary)
    ? String(result.summary).trim()
    : `参考视频展示${String(facts.product_or_service || '可见广告主体').trim()}，发生在${String(facts.environment || '画面中的实际空间').trim()}，共识别到 ${Math.max(1, beats.length)} 个剧情阶段、${cameras.length} 组机位运镜和 ${actions.length} 组人物动作。`;
  const sourceFactsText = [
    hasChineseDetail(facts.product_or_service, 2) ? `广告主体：${String(facts.product_or_service).trim()}` : '',
    hasChineseDetail(facts.environment, 2) ? `实际空间：${String(facts.environment).trim()}` : '',
    Array.isArray(facts.materials) && facts.materials.length ? `材质：${facts.materials.join('、')}` : '',
    Array.isArray(facts.colors) && facts.colors.length ? `颜色：${facts.colors.join('、')}` : '',
    hasChineseDetail(facts.layout, 4) ? `布局：${String(facts.layout).trim()}` : '',
    hasChineseDetail(facts.lighting, 4) ? `光线：${String(facts.lighting).trim()}` : '',
    Array.isArray(facts.visible_text) && facts.visible_text.length ? `可见文字：${facts.visible_text.join('；')}` : '',
  ].filter(Boolean).join('；');
  const beatText = beats.length
    ? beats.map((item, index) => {
      const purpose = hasReadableChinese(item.purpose)
        ? String(item.purpose).trim()
        : ['建立情境与问题', '展示行动与解决过程', '呈现结果与价值', '行动号召收束'][Math.min(index, 3)];
      const rhythm = hasReadableChinese(item.rhythm) ? `，节奏为${String(item.rhythm).trim()}` : '';
      return `${index + 1}. ${rangeLabel(item.range)}：${purpose}${rhythm}`;
    }).join('；')
    : '1. 开场建立情境与问题；2. 中段展示行动和解决过程；3. 结尾呈现结果并以行动号召收束';
  const cameraText = cameras.length
    ? cameras.map((item, index) => {
      const startShot = enumLabel(item.start_shot_size, shotLabels, '起始镜头');
      const endShot = enumLabel(item.end_shot_size, shotLabels, '结束镜头');
      const movement = enumLabel(item.movement, movementLabels, '保持稳定运镜');
      const angle = enumLabel(item.angle, angleLabels, '平视');
      const lens = Number(item.lens_estimate_mm || 0);
      return `${index + 1}. ${rangeLabel(item.range)}：${startShot}到${endShot}，${movement}，${angle}${lens ? `，约 ${lens}mm 镜头` : ''}`;
    }).join('；')
    : '先用主机位建立空间，中段使用互动机位跟随动作，结尾用细节机位突出结果并停稳';
  const actionText = actions.length
    ? actions.map((item, index) => {
      const start = hasReadableChinese(item.start_pose) ? item.start_pose : '从自然、稳定的起始姿态开始';
      const action = hasReadableChinese(item.key_action) ? item.key_action : '完成与产品或场景目标有关的关键动作';
      const end = hasReadableChinese(item.end_pose) ? item.end_pose : '回到清晰的结果展示姿态';
      return `${index + 1}. ${start}，随后${action}，最后${end}`;
    }).join('；')
    : '人物动作按“起始姿态—关键动作—结束姿态”编排，并保持手部接触、视线和表情连续';
  const outlineText = [
    hasReadableChinese(outline.logline) ? `故事梗概：${String(outline.logline).trim()}` : '',
    hasReadableChinese(outline.opening) ? `开端：${String(outline.opening).trim()}` : '',
    hasReadableChinese(outline.development) ? `发展：${String(outline.development).trim()}` : '',
    hasReadableChinese(outline.turning_point) ? `转折：${String(outline.turning_point).trim()}` : '',
    hasReadableChinese(outline.resolution) ? `结局：${String(outline.resolution).trim()}` : '',
  ].filter(Boolean).join('；') || beatText;
  const characterText = characters.length
    ? characters.map((item, index) => [
      `${index + 1}. ${hasReadableChinese(item.role) ? String(item.role).trim() : `原创角色 ${index + 1}`}`,
      hasReadableChinese(item.narrative_function) ? `剧情职责：${String(item.narrative_function).trim()}` : '',
      hasReadableChinese(item.age_range) ? `年龄：${String(item.age_range).trim()}` : '',
      hasReadableChinese(item.appearance_direction) ? `外貌气质：${String(item.appearance_direction).trim()}` : '',
      hasReadableChinese(item.wardrobe_direction) ? `原创服装：${String(item.wardrobe_direction).trim()}` : '',
      hasReadableChinese(item.performance_style) ? `表演：${String(item.performance_style).trim()}` : '',
      hasReadableChinese(item.continuity_rules) ? `一致性：${String(item.continuity_rules).trim()}` : '',
      hasReadableChinese(item.negative_prompt) ? `禁止项：${String(item.negative_prompt).trim()}` : '',
    ].filter(Boolean).join('；')).join('\n')
    : `1. 原创成年主角；剧情职责：执行产品交互并展示结果；外貌气质：自然可信的真实商业人物；原创服装：根据当前品牌、身份和场景重新设计；表演与动作：${actionText}；一致性：年龄感、发型、服装、鞋和配饰跨镜保持一致；禁止复制原片真人身份、肖像或服装`;
  const sceneText = scenes.length
    ? scenes.map((item, index) => [
      `${index + 1}. ${hasReadableChinese(item.location_type) ? String(item.location_type).trim() : `原创场景 ${index + 1}`}`,
      hasReadableChinese(item.layout_prompt) ? `布局：${String(item.layout_prompt).trim()}` : '',
      hasReadableChinese(item.material_light_prompt) ? `材质与光线：${String(item.material_light_prompt).trim()}` : '',
      hasReadableChinese(item.interaction_prompt) ? `互动与站位：${String(item.interaction_prompt).trim()}` : '',
      hasReadableChinese(item.camera_purpose) ? `机位用途：${String(item.camera_purpose).trim()}` : '',
      hasReadableChinese(item.negative_prompt) ? `禁止项：${String(item.negative_prompt).trim()}` : '',
    ].filter(Boolean).join('；')).join('\n')
    : `1. ${String(facts.environment || '参考视频中的实际空间').trim()}；布局：${String(facts.layout || '按证据帧保留主体、人物与背景的空间关系').trim()}；材质与光线：${[...(facts.materials || []), facts.lighting].filter(Boolean).join('、')}；禁止凭空替换行业、空间或核心材质`;
  return [
    `【参考内容事实】${sourceFactsText}`,
    `【广告目标】${summary}`,
    `【完整剧情】${outlineText}\n剧情节拍：${beatText}`,
    `【人物提示词】${characterText}`,
    `【场景提示词】${sceneText}`,
    `【人物动作】${actionText}`,
    '【场景与机位】先建立空间主机位，再按互动和细节需要选择场景机位；所有画面根据当前产品和品牌重新设计。',
    `【运镜与节奏】${cameraText}`,
    '【字幕与行动号召】字幕使用简短中文句式，突出产品结果，结尾保留明确的中文行动号召。',
  ].join('\n').slice(0, 3800);
}

function frameVisionUrl(frame = {}) {
  const localPath = mediaAdapter.assetPathFromName(frame.filename || '');
  if (!localPath || !fs.existsSync(localPath)) return String(frame.image_url || '');
  const bytes = fs.readFileSync(localPath);
  if (!bytes.length) return String(frame.image_url || '');
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

function visualEvidenceCacheKey(record = {}, frames = []) {
  let sourceStat = {};
  try {
    sourceStat = fs.statSync(record.source?.local_path || '');
  } catch {}
  return crypto.createHash('sha256').update(JSON.stringify({
    source_size: Number(sourceStat.size || record.source?.size_bytes || 0),
    source_mtime_ms: Number(sourceStat.mtimeMs || 0),
    duration_seconds: Number(record.source?.metadata?.duration_seconds || 0),
    frames: frames.slice(0, 8).map(frame => ({
      filename: frame.filename || '',
      timestamp_seconds: Number(frame.timestamp_seconds || 0),
    })),
  })).digest('hex');
}

function cleanEvidenceText(value = '', max = 1200) {
  return String(value || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/[{}\[\]"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function evidenceExcerpt(text = '', keywords = [], fallback = '') {
  const source = cleanEvidenceText(text, 12000);
  const segments = source.split(/[。；;]\s*/).map(item => item.trim()).filter(Boolean);
  const matched = segments.find(segment => keywords.some(keyword => segment.includes(keyword)));
  return cleanEvidenceText(matched || segments[0] || fallback, 500) || fallback;
}

function compileAnalysisFromEvidence(record = {}, visualEvidence = [], transcript = {}) {
  const combined = visualEvidence.map(item => cleanEvidenceText(item.text, 8000)).join('。');
  const product = evidenceExcerpt(combined, ['产品', '汽车', '轿车', '车辆', '品牌', '服务'], '参考视频中展示的主要产品');
  const environment = evidenceExcerpt(combined, ['场景', '环境', '空间', '道路', '室内', '室外'], '参考视频中实际出现的物理场景');
  const material = evidenceExcerpt(combined, ['材质', '金属', '玻璃', '皮革', '木', '织物', '漆面'], '画面中可见的产品与环境材质');
  const colors = evidenceExcerpt(combined, ['颜色', '色调', '黑色', '白色', '蓝色', '红色', '金色', '银色'], '参考画面的主要色调');
  const layout = evidenceExcerpt(combined, ['布局', '构图', '前景', '中景', '背景', '中央', '左侧', '右侧'], environment);
  const lighting = evidenceExcerpt(combined, ['光线', '灯光', '照明', '高光', '阴影', '逆光', '自然光'], '参考画面的实际光线与明暗关系');
  const humanPresence = /人物|人影|展示者|驾驶员|乘员|女性|男性|手部|双手|触摸|行走/.test(combined)
    && !/没有人物|无人出现|未出现人物/.test(combined);
  const chronology = visualEvidence.map((item, index) => {
    const range = item.timestamps?.length
      ? `${Math.min(...item.timestamps)}—${Math.max(...item.timestamps)} 秒`
      : `第 ${index + 1} 组`;
    return `${range}：${cleanEvidenceText(item.text, 320)}`;
  });
  const duration = Number(record.source?.metadata?.duration_seconds || 0);
  const firstBeat = chronology[0] || `0 秒：建立${product}`;
  const lastBeat = chronology[chronology.length - 1] || `${duration} 秒：完成产品信息收束`;
  const visibleText = combined.match(/(?:文字|字幕|标识|品牌)[^。；]{0,80}/g) || [];
  const summary = `参考视频围绕${product}展开，通过${environment}中的连续画面展示产品、材质、光线和使用情境，并按时间顺序形成完整广告叙事。`;
  const scenePrompts = visualEvidence.map((item, index) => ({
    location_type: index === 0 ? environment : `${environment}的后续画面区域`,
    beat_refs: [index + 1],
    layout_prompt: cleanEvidenceText(item.text, 520),
    material_light_prompt: `${material}；${lighting}`,
    interaction_prompt: humanPresence
      ? '保留证据中人物与产品的功能性互动，但使用原创人物外观与服装。'
      : '保持产品与真实空间关系，不添加证据外人物或道具。',
    camera_purpose: index === 0 ? '建立产品与真实环境关系' : '补充产品细节、动作与广告收束信息',
    negative_prompt: '禁止替换产品类别、另造空间、复制真人身份或原片服装。',
  }));
  const cameraIntents = visualEvidence.map((item, index) => ({
    range: [
      Number(item.timestamps?.[0] || 0),
      Number(item.timestamps?.[item.timestamps.length - 1] || duration),
    ],
    movement: index === 0 ? 'establishing' : 'progressive',
    movement_subject: product.slice(0, 160),
    start_shot_size: index === 0 ? 'wide' : 'medium',
    end_shot_size: index === 0 ? 'medium' : 'close_up',
    angle: 'eye_level',
    lens_estimate_mm: index === 0 ? 35 : 50,
    direction: 'evidence_order',
    speed: 'moderate',
    stabilization: 'stable',
    axis_rule: 'preserve_screen_axis',
    screen_direction: 'preserve_evidence_direction',
    entry_exit: 'follow_evidence_timeline',
    evidence_timestamps: item.timestamps || [],
  }));
  const characterPrompts = humanPresence ? [{
    role: '产品体验与展示角色',
    narrative_function: '通过动作和视线把观众注意力引向产品卖点',
    age_range: '与参考视频角色功能相符的成年人物',
    appearance_direction: '原创、可信、符合当前产品定位的自然外观，不复制原片真人',
    wardrobe_direction: '根据当前品牌与真实场景重新设计的原创服装，不复刻原片',
    performance_style: '克制自然，以产品互动和真实反应推进叙事',
    continuity_rules: '跨镜头保持原创人物外观、服装、手部动作和视线方向一致',
    negative_prompt: '禁止人脸身份复刻、原片服装复制和私密属性推断',
  }] : [];
  const characterActions = humanPresence ? visualEvidence.map((item, index) => ({
    role: '产品体验与展示角色',
    start_pose: index === 0 ? '进入或面向产品的准备姿态' : '承接上一组画面的结束姿态',
    key_action: evidenceExcerpt(item.text, ['动作', '触摸', '驾驶', '行走', '转身', '注视'], '围绕产品完成证据中可见的展示动作'),
    end_pose: '动作完成后保持视线或身体朝向产品',
    dominant_hand: '按证据画面保持一致，无法确认时不指定',
    prop_contact: product.slice(0, 160),
    screen_direction: 'preserve_evidence_direction',
    eyeline: '面向产品或动作目标',
    expression_change: '从观察转为确认产品效果的自然反应',
    previous_frame_dependency: index === 0 ? '无' : '承接上一组动作、视线和屏幕方向',
  })) : [];
  return {
    source_facts: {
      product_or_service: product,
      visible_text: visibleText.slice(0, 12),
      environment,
      materials: [material],
      colors: [colors],
      layout,
      lighting,
      human_presence: humanPresence,
      human_actions: characterActions.map(item => item.key_action),
      chronological_story: chronology,
      evidence_timestamps: visualEvidence.flatMap(item => item.timestamps || []),
    },
    summary,
    story_outline: {
      logline: `通过${environment}中的连续展示，让观众理解${product}的核心价值与使用结果。`,
      opening: firstBeat,
      development: chronology.slice(0, Math.max(1, chronology.length - 1)).join('；'),
      turning_point: humanPresence
        ? `人物与${product}发生关键互动，产品价值从外观展示转为可感知体验。`
        : `镜头从整体关系推进到产品细节和结果证明。`,
      resolution: lastBeat,
    },
    plot_beats: visualEvidence.map((item, index) => ({
      range: [
        Number(item.timestamps?.[0] || 0),
        Number(item.timestamps?.[item.timestamps.length - 1] || duration),
      ],
      purpose: index === 0 ? `建立${product}与${environment}的真实关系` : '推进产品细节、使用情境与结尾信息',
      evidence_summary: cleanEvidenceText(item.text, 420),
    })),
    character_prompts: characterPrompts,
    scene_prompts: scenePrompts,
    camera_intents: cameraIntents,
    character_actions: characterActions,
    subtitle_cta: transcript.text
      ? `结合语音内容突出${product}的核心价值，并在结尾给出明确了解或咨询行动。`
      : `突出${product}的核心价值，并在结尾引导观众进一步了解或咨询。`,
    prompt_suggestions: [
      `严格保留${product}、${environment}与真实材质关系。`,
      '根据证据时间线组织开场、展示、互动或细节证明和结尾收束。',
      '人物必须使用原创外观与服装，只继承角色功能和表演规律。',
    ],
  };
}

async function analyzeWithModels(record, frames, transcript = {}) {
  const stage = 'new_story_ad.reference_video_vision';
  const selectedFrames = frames.slice(0, 8);
  const batches = [];
  for (let index = 0; index < selectedFrames.length; index += 4) {
    batches.push(selectedFrames.slice(index, index + 4));
  }
  const cacheKey = visualEvidenceCacheKey(record, selectedFrames);
  const cachedSlots = record._visual_evidence_cache?.key === cacheKey
    && Array.isArray(record._visual_evidence_cache?.batches)
    && record._visual_evidence_cache.batches.length === batches.length
    ? record._visual_evidence_cache.batches.map(item => item && typeof item === 'object' ? { ...item } : null)
    : Array.from({ length: batches.length }, () => null);
  const missingIndexes = cachedSlots.map((item, index) => item ? -1 : index).filter(index => index >= 0);
  const persistBatch = (index, value) => {
    const latest = readRecord(record.user_id, record.id) || record;
    const previous = latest._visual_evidence_cache?.key === cacheKey
      && Array.isArray(latest._visual_evidence_cache?.batches)
      ? latest._visual_evidence_cache.batches
      : Array.from({ length: batches.length }, () => null);
    const slots = Array.from({ length: batches.length }, (_, slot) => previous[slot] || null);
    slots[index] = value;
    save(latest, {
      _visual_evidence_cache: {
        key: cacheKey,
        batches: slots,
        completed_batch_indexes: slots.map((item, slot) => item ? slot : -1).filter(slot => slot >= 0),
        updated_at: now(),
      },
    });
  };
  const settled = await Promise.allSettled(missingIndexes.map(index => generationConcurrency.schedule(
    'new_story_ad.reference_video_vision',
    2,
    async () => {
    const batch = batches[index];
    const timestamps = batch.map(item => Number(item.timestamp_seconds || 0));
    const vision = await modelGateway.generateVision({
      taskId: record.id,
      stage,
      systemPrompt: '你是广告视频证据分析员。只描述画面中真实可见的产品、空间、材质、文字、人物动作和镜头变化，不识别人脸身份，不编造画面外信息。使用简体中文。',
      userPrompt: [
        `这是第 ${index + 1}/${batches.length} 组按时间顺序截取的广告视频证据帧，时间点为 ${timestamps.join(', ')} 秒。`,
        '逐帧说明：产品或服务、可见文字、真实环境、材质、颜色、布局、光线、人物是否出现及动作、景别、机位和运镜变化。',
        '最后总结本组画面在整条广告剧情中的作用。不得改写成其它行业或其它空间；不确定的内容明确写“不确定”。',
        '输出简体中文，可使用紧凑 JSON 或分点文本，但必须保留每个时间点。',
      ].join('\n'),
      imageUrls: batch.map(item => item.image_url),
      imageDataUrls: batch.map(frameVisionUrl),
      maxTokens: 1800,
      maxCandidates: REFERENCE_VISION_MAX_CANDIDATES,
      timeoutMs: 120000,
      stageBudgetMs: REFERENCE_VISION_STAGE_BUDGET_MS,
      validateText: (text) => {
        const raw = String(text || '').trim();
        if (raw.length < 80 || refusalLike(raw)) {
          const error = new Error(`第 ${index + 1} 组视觉证据未返回足够的可读内容（长度=${raw.length}）`);
          error.code = 'PROVIDER_RESPONSE_INVALID';
          error.retryable = true;
          throw error;
        }
        return true;
      },
    });
      const row = {
      batch_index: index + 1,
      timestamps,
      text: String(vision.text || '').slice(0, 10000),
      used_model: vision.used_model,
      };
      persistBatch(index, row);
      return row;
    },
  )));
  const failed = settled.find(item => item.status === 'rejected');
  if (failed) throw failed.reason;
  const latest = readRecord(record.user_id, record.id) || record;
  const visualEvidence = latest._visual_evidence_cache?.key === cacheKey
    ? latest._visual_evidence_cache.batches
    : cachedSlots;
  if (!Array.isArray(visualEvidence) || visualEvidence.length !== batches.length || visualEvidence.some(item => !item)) {
    const error = new Error('参考视频视觉证据批次不完整，已保留成功批次并停止整理');
    error.code = 'REFERENCE_VIDEO_BATCH_INCOMPLETE';
    error.retryable = true;
    throw error;
  }

  const result = compileAnalysisFromEvidence(record, visualEvidence, transcript);
  result.generated_brief = buildChineseBrief(result);
  return {
    schema_version: 3,
    analysis_scope: 'reference_content_and_creative_structure',
    prohibited_reuse: ['person_identity', 'face', 'source_wardrobe_copy', 'private_attributes'],
    ...result,
    visual_evidence_batches: visualEvidence.map(item => ({
      batch_index: item.batch_index,
      timestamps: item.timestamps,
      used_model: item.used_model,
    })),
    evidence_frames: frames,
    transcript,
  };
}

function normalizeResult(result = {}) {
  const safe = { ...result };
  safe.camera_intents = Array.isArray(safe.camera_intents) ? safe.camera_intents.slice(0, 24) : [];
  safe.character_actions = Array.isArray(safe.character_actions) ? safe.character_actions.slice(0, 24) : [];
  safe.plot_beats = Array.isArray(safe.plot_beats) ? safe.plot_beats.slice(0, 24) : [];
  safe.character_prompts = Array.isArray(safe.character_prompts) ? safe.character_prompts.slice(0, 12) : [];
  safe.scene_prompts = Array.isArray(safe.scene_prompts) ? safe.scene_prompts.slice(0, 12) : [];
  safe.story_outline = safe.story_outline && typeof safe.story_outline === 'object' ? safe.story_outline : {};
  safe.source_facts = safe.source_facts && typeof safe.source_facts === 'object' ? safe.source_facts : {};
  const assessment = validateAnalysisResult(safe);
  const generated = String(safe.generated_brief || '').trim();
  const requiredSections = ['【参考内容事实】', '【完整剧情】', '【人物提示词】', '【场景提示词】'];
  safe.generated_brief = hasReadableChinese(generated) && requiredSections.every(section => generated.includes(section))
    ? generated.slice(0, 3800)
    : buildChineseBrief(safe);
  safe.output_language = 'zh-CN';
  safe.schema_version = 3;
  safe.analysis_scope = 'reference_content_and_creative_structure';
  safe.prohibited_reuse = ['person_identity', 'face', 'source_wardrobe_copy', 'private_attributes'];
  const transcriptStatus = String(safe.transcript?.status || '').trim();
  safe.warnings = [];
  if (['failed_non_blocking', 'provider_not_configured'].includes(transcriptStatus)) {
    safe.warnings.push('语音转写不可用，本次剧情、字幕和行动号召仅依据画面证据识别');
  }
  safe.analysis_quality = {
    valid: true,
    source_fact_count: assessment.source_fact_count,
    story_outline_parts: 5,
    plot_beat_count: safe.plot_beats.length,
    scene_prompt_count: safe.scene_prompts.length,
    camera_intent_count: safe.camera_intents.length,
    character_action_count: safe.character_actions.length,
    transcript_status: transcriptStatus || 'unknown',
    visual_evidence_complete: true,
    audio_evidence_complete: ['completed', 'mocked', 'no_audio'].includes(transcriptStatus),
  };
  return safe;
}

async function runAnalysis(initialRecord) {
  let record = initialRecord;
  try {
    record = checkpoint(record, '读取视频元数据', 8, { status: 'running', error: null });
    throwIfCancelled(record);
    record = checkpoint(record, '并行提取低分辨率证据帧与语音', 18);
    const [frames, transcript] = await Promise.all([
      extractEvidenceFrames(record),
      transcribeAudio(record),
    ]);
    record = checkpoint(record, '证据帧与语音已提取', 42, { evidence_frames: frames, transcript });
    throwIfCancelled(record);
    record = checkpoint(record, '并行分析剧情、动作、机位与运镜', 55);
    const raw = process.env.NEW_STORY_AD_MOCK_LLM === '1'
      ? mockAnalysis({ ...record, transcript }, frames)
      : await analyzeWithModels(record, frames, transcript);
    throwIfCancelled(record);
    const result = normalizeResult(raw);
    record = checkpoint(record, '整理中文广告需求草稿', 90, { result });
    save(record, {
      status: 'completed',
      phase: result.warnings?.length
        ? `分析完成；${result.warnings[0]}`
        : '分析完成，中文内容已填入广告需求',
      progress: 100,
      completed_at: now(),
      downstream_generation_triggered: false,
    });
  } catch (error) {
    const latest = readRecord(record.user_id, record.id) || record;
    if (error.cancelled || latest.cancelled) {
      save(latest, {
        status: 'cancelled',
        phase: '已取消',
        error: null,
        cancelled_at: now(),
      });
    } else {
      save(latest, {
        status: 'failed',
        phase: '分析失败',
        error: publicVisionFailure(error),
        failed_at: now(),
      });
    }
  } finally {
    activeRuns.delete(initialRecord.id);
  }
}

function start(analysisId, user = {}) {
  let record = assertOwned(analysisId, user);
  if (record.status === 'completed') return { record: publicRecord(record), accepted: false, duplicate: true };
  if (activeImports.has(analysisId) || record.status === 'importing') {
    const error = new Error('视频链接仍在读取，请读取完成后再开始分析');
    error.code = 'REFERENCE_VIDEO_IMPORT_ACTIVE';
    error.status = 409;
    throw error;
  }
  if (!record.source?.local_path || !fs.existsSync(record.source.local_path)) {
    const error = new Error('参考视频尚未读取成功，请重新上传或粘贴链接');
    error.code = 'REFERENCE_VIDEO_SOURCE_MISSING';
    error.status = 409;
    throw error;
  }
  if (activeRuns.has(analysisId) || record.status === 'running') {
    return { record: publicRecord(record), accepted: false, duplicate: true };
  }
  if (process.env.NEW_STORY_AD_MOCK_LLM !== '1') {
    const availability = modelGateway.visionAvailability('new_story_ad.reference_video_vision');
    if (!availability.available_count) {
      const error = new Error('视觉模型当前不可用，未启动新的分析，也没有覆盖上一次失败记录。');
      error.code = 'VISION_CIRCUIT_OPEN';
      error.status = 503;
      error.retryable = true;
      error.failed_models = availability.models
        .filter(item => !item.available)
        .map(item => ({
          provider_id: item.provider_id,
          model_id: item.model_id,
          code: String(item.reason || 'unavailable').toUpperCase(),
          retry_after_ms: item.retry_after_ms,
        }));
      error.retry_after_ms = Math.max(0, ...error.failed_models.map(item => Number(item.retry_after_ms || 0)));
      throw error;
    }
  }
  record = save(record, {
    status: 'queued',
    phase: '已进入分析队列',
    progress: Math.max(1, Number(record.progress || 0)),
    cancelled: false,
    error: null,
    started_at: record.started_at || now(),
  });
  const promise = runAnalysis(record);
  activeRuns.set(analysisId, promise);
  return { record: publicRecord(record), accepted: true, duplicate: false };
}

function get(analysisId, user = {}) {
  return publicRecord(assertOwned(analysisId, user));
}

function cancel(analysisId, user = {}) {
  const record = assertOwned(analysisId, user);
  if (['completed', 'failed', 'cancelled'].includes(record.status)) return publicRecord(record);
  const activeImport = activeImports.get(analysisId);
  if (activeImport) activeImport.controller.abort();
  return publicRecord(save(record, {
    cancelled: true,
    status: 'cancelling',
    phase: '正在取消',
  }));
}

function remove(analysisId, user = {}) {
  const record = assertOwned(analysisId, user);
  if (activeImports.has(analysisId) || activeRuns.has(analysisId)
    || ['importing', 'running', 'queued', 'cancelling'].includes(record.status)) {
    const error = new Error('请先取消正在运行的参考视频分析');
    error.code = 'REFERENCE_VIDEO_ANALYSIS_ACTIVE';
    error.status = 409;
    throw error;
  }
  const dir = analysisDir(record.user_id, record.id);
  const resolved = path.resolve(dir);
  const root = path.resolve(ROOT_DIR);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error('参考视频目录不安全，已停止删除');
    error.code = 'UNSAFE_REFERENCE_VIDEO_PATH';
    error.status = 500;
    throw error;
  }
  for (const frame of record.evidence_frames || record.result?.evidence_frames || []) {
    const framePath = mediaAdapter.assetPathFromName(frame.filename);
    try { if (framePath && fs.existsSync(framePath)) fs.unlinkSync(framePath); } catch {}
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  return { id: analysisId, deleted: true };
}

function mapSceneViews(analysisId, user = {}, sceneAssets = []) {
  const record = assertOwned(analysisId, user);
  if (record.status !== 'completed' || !record.result) {
    const error = new Error('参考视频尚未分析完成');
    error.code = 'REFERENCE_VIDEO_ANALYSIS_INCOMPLETE';
    error.status = 409;
    throw error;
  }
  const views = (Array.isArray(sceneAssets) ? sceneAssets : [])
    .map(item => ({
      key: String(item.view_key || item.viewKey || item.kind || item.type || ''),
      image_url: item.image_url || item.url || '',
      camera: item.camera || item.camera_contract || null,
    }))
    .filter(item => item.key);
  const knownKeys = new Set(views.map(item => item.key));
  const mappings = (record.result.camera_intents || []).map((intent, index) => {
    const movement = String(intent.movement || '').toLowerCase();
    const endSize = String(intent.end_shot_size || '').toLowerCase();
    const desired = /detail|close/.test(endSize)
      ? 'detail'
      : /reverse|backward|pull/.test(movement)
        ? 'reverse'
        : /interaction|follow|pan|track/.test(movement)
          ? 'interaction'
          : 'master';
    const selected = knownKeys.has(desired)
      ? desired
      : ['master', 'interaction', 'detail', 'reverse', 'layout'].find(key => knownKeys.has(key)) || '';
    return {
      camera_intent_id: intent.id || `camera_intent_${index + 1}`,
      requested_view: desired,
      mapped_view: selected,
      feasible: !!selected,
      execution: selected
        ? `以 ${selected} 场景机位为起点执行 ${intent.movement || 'locked'}，保持 ${intent.axis_rule || '既定轴线'}`
        : '当前场景资产没有可映射机位，请先生成场景主视图',
      alternative_views: views.map(item => item.key).filter(key => key !== selected).slice(0, 3),
    };
  });
  const next = save(record, {
    scene_view_mapping: {
      status: mappings.every(item => item.feasible) ? 'mapped' : 'partial',
      mappings,
      available_views: views,
      mapped_at: now(),
    },
  });
  return publicRecord(next).scene_view_mapping;
}

module.exports = {
  ROOT_DIR,
  MAX_DURATION_SECONDS,
  MAX_FILE_BYTES,
  probeVideo,
  create,
  createFromUrl,
  createUploadSession,
  saveUploadChunk,
  completeUploadSession,
  cancelUploadSession,
  start,
  get,
  cancel,
  remove,
  mapSceneViews,
  _private: {
    activeRuns,
    activeImports,
    analysisDir,
    readRecord,
    mockAnalysis,
    evidenceTimes,
    validateUpload,
    normalizeResult,
    validateAnalysisResult,
    assertCandidateAnalysisText,
    buildChineseBrief,
    hasReadableChinese,
    hasChineseDetail,
    refusalLike,
    frameVisionUrl,
    analyzeWithModels,
    transcribeAudio,
    isReusableTranscriptFailure,
    publicVisionFailure,
  },
};
