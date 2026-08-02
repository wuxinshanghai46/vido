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
const jsonRepair = require('./jsonRepairService');
const mediaAdapter = require('./mediaAdapter');
const referenceVideoLinks = require('./referenceVideoLinkService');
const { getApiKey } = require('../settingsService');
const generationConcurrency = require('./generationConcurrencyService');
const evidenceText = require('./referenceEvidenceTextService');

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs', 'new-story-ad', 'reference-video-analyses');
const MAX_DURATION_SECONDS = 180;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const REFERENCE_VISION_MAX_CANDIDATES = 3;
const REFERENCE_VISION_STAGE_BUDGET_MS = 240000;
const EVIDENCE_CONTRACT_VERSION = 'shot-aware-v2';
const SHOT_DETECTION_THRESHOLD = 0.4;
const SHOT_MIN_GAP_SECONDS = 0.75;
const MAX_EVIDENCE_SEGMENT_SECONDS = 6;
const MAX_EVIDENCE_FRAMES = 40;
const VISION_BATCH_SIZE = 4;
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

function requestedTaskId(body = {}) {
  return String(body.task_id || body.taskId || '').trim().slice(0, 100);
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
  copy.visual_evidence_reusable = hasReusableVisualEvidence(record);
  copy.semantic_result_reusable = canReuseSynthesisRaw(record);
  copy.evidence_batch_progress = evidenceBatchProgress(record);
  delete copy._visual_evidence_cache;
  delete copy._synthesis_raw;
  delete copy._reuse_synthesis_raw;
  if (['failed', 'cancelled'].includes(copy.status)) copy.progress = 0;
  if (copy.source) {
    delete copy.source.local_path;
    delete copy.source.private_directory;
    delete copy.source.input_url;
  }
  return copy;
}

/** 只公开批次数量，不公开模型原文、提示词或私有诊断。 */
function evidenceBatchProgress(record = {}) {
  const cache = record._visual_evidence_cache && typeof record._visual_evidence_cache === 'object'
    ? record._visual_evidence_cache
    : {};
  const slots = Array.isArray(cache.batches) ? cache.batches : [];
  const total = slots.length;
  if (!total) return { total: 0, completed: 0, remaining: 0, failed: 0 };
  const completed = slots.filter(item => item && typeof item === 'object').length;
  const failed = Object.keys(cache.failed_attempts && typeof cache.failed_attempts === 'object'
    ? cache.failed_attempts
    : {}).filter(key => Array.isArray(cache.failed_attempts[key]) && cache.failed_attempts[key].length).length;
  return {
    total,
    completed,
    remaining: Math.max(0, total - completed),
    failed,
  };
}

/** 将权威分析记录压缩成任务上下文可持久化的结构。 */
function taskRecord(analysis = {}) {
  const result = analysis.result && typeof analysis.result === 'object' ? analysis.result : {};
  return {
    analysis_id: analysis.id || analysis.analysis_id || '',
    status: analysis.status || '',
    progress: Math.max(0, Math.min(100, Number(analysis.progress || 0) || 0)),
    phase: String(analysis.phase || '').trim(),
    created_at: analysis.created_at || '',
    started_at: analysis.started_at || '',
    updated_at: analysis.updated_at || '',
    completed_at: analysis.completed_at || '',
    failed_at: analysis.failed_at || '',
    cancelled_at: analysis.cancelled_at || '',
    checkpoints: Array.isArray(analysis.checkpoints) ? analysis.checkpoints.slice(-12) : [],
    source: analysis.source || null,
    error: analysis.error || null,
    visual_evidence_reusable: analysis.visual_evidence_reusable === true,
    semantic_result_reusable: analysis.semantic_result_reusable === true,
    evidence_batch_progress: analysis.evidence_batch_progress && typeof analysis.evidence_batch_progress === 'object'
      ? analysis.evidence_batch_progress
      : { total: 0, completed: 0, remaining: 0, failed: 0 },
    schema_version: Number(result.schema_version || analysis.schema_version || 3) || 3,
    analysis_scope: result.analysis_scope || analysis.analysis_scope || 'reference_content_and_creative_structure',
    generated_brief: result.generated_brief || analysis.generated_brief || '',
    summary: result.summary || analysis.summary || '',
    source_facts: result.source_facts || analysis.source_facts || {},
    analysis_quality: result.analysis_quality || analysis.analysis_quality || {},
    story_outline: result.story_outline || analysis.story_outline || {},
    plot_beats: result.plot_beats || analysis.plot_beats || [],
    character_prompts: result.character_prompts || analysis.character_prompts || [],
    animal_prompts: result.animal_prompts || analysis.animal_prompts || [],
    scene_prompts: result.scene_prompts || analysis.scene_prompts || [],
    shot_breakdown: result.shot_breakdown || analysis.shot_breakdown || [],
    camera_intents: result.camera_intents || analysis.camera_intents || [],
    character_actions: result.character_actions || analysis.character_actions || [],
    animal_actions: result.animal_actions || analysis.animal_actions || [],
    prompt_suggestions: result.prompt_suggestions || analysis.prompt_suggestions || {},
    scene_view_mapping: analysis.scene_view_mapping || null,
    identity_extraction_allowed: false,
  };
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
  const failureLabels = {
    PROVIDER_RESPONSE_INVALID: '返回格式不合法',
    REFERENCE_VIDEO_EVIDENCE_COVERAGE_INVALID: '逐帧内容不完整',
    PROVIDER_EMPTY_RESPONSE: '没有返回内容',
    RATE_LIMIT: '当前访问量过大',
    TIMEOUT_OR_NETWORK: '连接超时或网络异常',
    PROVIDER_5XX: '供应商服务异常',
  };
  const summary = failedModels.length
    ? failedModels.map(item => `${item.provider_id}/${item.model_id}：${failureLabels[item.code] || item.code}`).join('；')
    : '';
  let message = String(error.message || error).slice(0, 500);
  if (code === 'VISION_CIRCUIT_OPEN') {
    message = '视觉模型当前不可用，系统已停止重复调用以避免浪费。请等待限流恢复或联系管理员修复模型配置。';
  } else if (code === 'VISION_QA_UNAVAILABLE') {
    message = `参考视频的镜头证据没有全部读取成功${summary ? `（${summary}）` : ''}。已保留通过校验的批次；未生成或覆盖后续人物、场景和剧情数据。`;
  }
  return {
    code,
    message,
    retryable: error.retryable === true,
    retry_after_ms: Math.max(0, Number(error.retry_after_ms || 0)),
    failed_models: failedModels,
    failures: (Array.isArray(error.failures) ? error.failures : [])
      .map(item => String(item || '').slice(0, 100))
      .filter(Boolean)
      .slice(0, 20),
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
    task_id: requestedTaskId(body),
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
    task_id: requestedTaskId(body),
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
  // 新工作区把参考链接作为任务输入：读取完成后必须由服务端自动启动，
  // 不能依赖浏览器页面继续停留和轮询。未绑定任务的旧入口仍保留手动开始语义。
  if (record.task_id) {
    void promise.then(() => {
      const imported = readRecord(userId, id);
      if (!imported || imported.status !== 'uploaded' || imported.cancelled) return;
      try {
        start(id, { id: userId });
      } catch (error) {
        const latest = readRecord(userId, id) || imported;
        save(latest, {
          status: 'failed',
          progress: 0,
          phase: '分析启动失败',
          error: publicVisionFailure(error),
          failed_at: now(),
        });
      }
    }).catch(() => {});
  }
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

function normalizeShotCuts(duration, cuts = []) {
  const safeDuration = Math.max(0.1, Number(duration) || 0.1);
  const normalized = [...new Set((Array.isArray(cuts) ? cuts : [])
    .map(Number)
    .filter(Number.isFinite)
    .filter(value => value >= 0.5 && value <= safeDuration - 0.5)
    .map(value => Number(value.toFixed(3))))]
    .sort((left, right) => left - right);
  return normalized.filter((value, index, all) => index === 0 || value - all[index - 1] >= SHOT_MIN_GAP_SECONDS);
}

function shotSegments(duration, cuts = []) {
  const safeDuration = Math.max(0.1, Number(duration) || 0.1);
  const boundaries = [0, ...normalizeShotCuts(safeDuration, cuts), safeDuration];
  const segments = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const length = Math.max(0, end - start);
    const parts = Math.max(1, Math.ceil(length / MAX_EVIDENCE_SEGMENT_SECONDS));
    for (let part = 0; part < parts; part += 1) {
      const partStart = start + (length * part / parts);
      const partEnd = start + (length * (part + 1) / parts);
      segments.push({
        shot_index: segments.length + 1,
        range: [Number(partStart.toFixed(3)), Number(partEnd.toFixed(3))],
        source: parts > 1 ? 'long_shot_window' : 'scene_cut',
      });
    }
  }
  return segments;
}

function buildShotAwareEvidencePlan(duration, cuts = []) {
  const segments = shotSegments(duration, cuts);
  if (segments.length > MAX_EVIDENCE_FRAMES) {
    const error = new Error(`参考视频检测到 ${segments.length} 个取证片段，超过单次最多 ${MAX_EVIDENCE_FRAMES} 个；请缩短视频或拆分后分析。`);
    error.code = 'REFERENCE_VIDEO_TOO_MANY_SHOTS';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  const samplesPerSegment = segments.length * 2 <= MAX_EVIDENCE_FRAMES ? 2 : 1;
  const plan = [];
  for (const segment of segments) {
    const [start, end] = segment.range;
    const length = Math.max(0.1, end - start);
    const samples = samplesPerSegment === 2 && length >= 0.5
      ? [
        { role: 'opening', time: start + Math.min(0.3, length * 0.2) },
        { role: 'closing', time: end - Math.min(0.3, length * 0.2) },
      ]
      : [{ role: 'representative', time: start + (length / 2) }];
    for (const sample of samples) {
      const timestamp = Math.max(0.05, Math.min(Number(duration) - 0.05, sample.time));
      if (plan.some(item => Math.abs(item.timestamp_seconds - timestamp) < 0.04)) continue;
      plan.push({
        frame_id: `F${String(plan.length + 1).padStart(3, '0')}`,
        timestamp_seconds: Number(timestamp.toFixed(3)),
        shot_index: segment.shot_index,
        shot_range: segment.range,
        sample_role: sample.role,
        detection_source: segment.source,
      });
    }
  }
  return plan;
}

async function detectShotBoundaries(record) {
  if (!ffmpegPath) {
    const error = new Error('服务器缺少 ffmpeg，无法检测参考视频镜头边界');
    error.code = 'FFMPEG_UNAVAILABLE';
    throw error;
  }
  try {
    const { stderr } = await execFileAsync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'info',
      '-i', record.source.local_path,
      '-vf', `select=gt(scene\\,${SHOT_DETECTION_THRESHOLD}),showinfo`,
      '-an', '-f', 'null', '-',
    ], { maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 180000 });
    const rawCuts = [...String(stderr || '').matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)]
      .map(match => Number(match[1]))
      .filter(Number.isFinite);
    const cuts = normalizeShotCuts(record.source.metadata.duration_seconds, rawCuts);
    return {
      contract_version: EVIDENCE_CONTRACT_VERSION,
      threshold: SHOT_DETECTION_THRESHOLD,
      minimum_gap_seconds: SHOT_MIN_GAP_SECONDS,
      maximum_segment_seconds: MAX_EVIDENCE_SEGMENT_SECONDS,
      raw_cut_count: rawCuts.length,
      cuts,
    };
  } catch (error) {
    if (error.cancelled) throw error;
    const failure = new Error(`参考视频镜头边界检测失败：${String(error.message || error).slice(0, 300)}`);
    failure.code = 'REFERENCE_VIDEO_SHOT_DETECTION_FAILED';
    failure.retryable = true;
    throw failure;
  }
}

async function extractEvidenceFrames(record, evidencePlan = []) {
  if (!ffmpegPath) {
    const error = new Error('服务器缺少 ffmpeg，无法提取参考视频证据帧');
    error.code = 'FFMPEG_UNAVAILABLE';
    throw error;
  }
  const frames = [];
  const plan = Array.isArray(evidencePlan) ? evidencePlan : [];
  if (!plan.length) {
    const error = new Error('参考视频没有形成可用的镜头取证计划');
    error.code = 'REFERENCE_VIDEO_EVIDENCE_PLAN_EMPTY';
    throw error;
  }
  fs.mkdirSync(mediaAdapter.ASSET_DIR, { recursive: true });
  for (let index = 0; index < plan.length; index += 1) {
    throwIfCancelled(record);
    const sample = plan[index];
    const millis = Math.round(Number(sample.timestamp_seconds || 0) * 1000);
    const filename = `refev_${record.id.slice(-12)}_${sample.frame_id}_${millis}.jpg`;
    const out = mediaAdapter.assetPathFromName(filename);
    if (!fs.existsSync(out) || fs.statSync(out).size < 1024) {
      await execFileAsync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', String(sample.timestamp_seconds),
        '-i', record.source.local_path,
        '-frames:v', '1',
        '-vf', 'scale=960:-2',
        '-q:v', '3',
        out,
      ], { maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    }
    frames.push({
      index,
      frame_id: sample.frame_id,
      timestamp_seconds: Number(Number(sample.timestamp_seconds || 0).toFixed(3)),
      shot_index: Number(sample.shot_index || index + 1),
      shot_range: Array.isArray(sample.shot_range) ? sample.shot_range.map(Number) : [],
      sample_role: String(sample.sample_role || 'representative'),
      detection_source: String(sample.detection_source || 'scene_cut'),
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
    schema_version: 5,
    analysis_scope: 'reference_content_and_creative_structure',
    prohibited_reuse: ['person_identity', 'face', 'source_wardrobe_copy', 'private_attributes'],
    evidence_coverage: {
      contract_version: EVIDENCE_CONTRACT_VERSION,
      complete: frames.length > 0,
      expected_frame_count: frames.length,
      covered_frame_count: frames.length,
      expected_frame_ids: frames.map(item => item.frame_id),
      covered_frame_ids: frames.map(item => item.frame_id),
      shot_segment_count: new Set(frames.map(item => item.shot_index)).size,
    },
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
      animal_presence: false,
      animal_actions: [],
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
    animal_actions: [],
    animal_prompts: [],
    shot_breakdown: [{
      order: 1,
      range: [0, midpoint],
      visual: '建立广告主体、人物与主要空间的可见关系',
      action: '人物进入或接近广告主体',
      scene_id: 'scene_prompt_1',
      subject_ids: ['character_prompt_1'],
      shot_size: 'wide',
      angle: 'eye_level',
      movement: 'slow_push_in',
      duration_seconds: midpoint,
    }, {
      order: 2,
      range: [midpoint, duration],
      visual: '展示人物与广告主体的互动及结果',
      action: '人物完成产品交互并保持结果展示姿态',
      scene_id: 'scene_prompt_1',
      subject_ids: ['character_prompt_1'],
      shot_size: 'close_up',
      angle: 'slight_high',
      movement: 'locked_then_micro_pull_out',
      duration_seconds: Number((duration - midpoint).toFixed(3)),
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
  const requiredKeys = ['story_outline', 'plot_beats', 'source_facts'];
  const foundKeys = requiredKeys.filter(key => raw.includes(key));
  const refused = refusalLike(raw);
  if (!raw || refused || foundKeys.length < requiredKeys.length) {
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
  const animalActions = Array.isArray(source.animal_actions) ? source.animal_actions : [];
  const animalPrompts = Array.isArray(source.animal_prompts) ? source.animal_prompts : [];
  const narrativeAnimalPresence = typeof facts.narrative_animal_presence === 'boolean'
    ? facts.narrative_animal_presence
    : facts.animal_presence === true;
  const shotBreakdown = Array.isArray(source.shot_breakdown) ? source.shot_breakdown : [];
  const evidenceCoverage = source.evidence_coverage && typeof source.evidence_coverage === 'object'
    ? source.evidence_coverage
    : null;
  const factMaterials = Array.isArray(facts.materials) ? facts.materials.filter(Boolean) : [];
  const outlineParts = ['logline', 'opening', 'development', 'turning_point', 'resolution']
    .filter(key => hasChineseDetail(outline[key], 4));
  const failures = [];
  if (evidenceCoverage && evidenceCoverage.complete !== true) failures.push('visual_frame_coverage_incomplete');
  if (refusalLike(serialized)) failures.push('provider_refusal');
  if (!hasChineseDetail(facts.product_or_service, 2)) failures.push('source_product_missing');
  if (evidenceText.environmentProductConflated(facts.product_or_service)) failures.push('source_product_environment_conflated');
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
  if (facts.human_presence === true && Number(facts.human_count || 0) > 0
    && (!Array.isArray(source.character_prompts) || source.character_prompts.length !== Number(facts.human_count))) {
    failures.push('character_count_mismatch');
  }
  if (facts.human_presence === true && actions.length && actions.every(item => (
    /(?:保留证据|按证据|可见的展示动作|功能性互动|围绕产品|不指定)/u.test(String(item?.key_action || ''))
  ))) failures.push('character_actions_not_observed');
  const factAnimalActions = Array.isArray(facts.animal_actions) ? facts.animal_actions.filter(Boolean) : [];
  if (narrativeAnimalPresence && (
    !animalActions.length
    || !factAnimalActions.length
    || animalActions.some(item => !hasChineseDetail(item?.action, 2))
  )) failures.push('animal_actions_missing');
  if (narrativeAnimalPresence && (
    !animalPrompts.length
    || animalPrompts.some(item => !hasChineseDetail(item?.species, 1) && !hasChineseDetail(item?.appearance_direction, 2))
  )) failures.push('animal_prompts_missing');
  if (!narrativeAnimalPresence && (animalActions.length || animalPrompts.length)) {
    failures.push('animal_evidence_conflict');
  }
  if (Number(source.schema_version || 0) >= 4) {
    const sceneIds = new Set(scenes.map((item, index) => String(item?.id || `scene_prompt_${index + 1}`).trim()));
    if (!shotBreakdown.length) {
      failures.push('shot_breakdown_missing');
    } else if (!shotBreakdown.every((item, index) => {
      const range = Array.isArray(item?.range) ? item.range.map(Number) : [];
      const duration = Number(item?.duration_seconds);
      return Number(item?.order) === index + 1
        && range.length === 2
        && Number.isFinite(range[0])
        && Number.isFinite(range[1])
        && range[1] >= range[0]
        && hasChineseDetail(item?.visual, 2)
        && hasChineseDetail(item?.action, 2)
        && String(item?.scene_id || '').trim()
        && sceneIds.has(String(item.scene_id).trim())
        && Array.isArray(item?.subject_ids)
        && item.subject_ids.length > 0
        && String(item?.shot_size || '').trim()
        && String(item?.angle || '').trim()
        && String(item?.movement || '').trim()
        && Number.isFinite(duration)
        && duration >= 0
        && Math.abs(duration - (range[1] - range[0])) <= 0.05;
    })) {
      failures.push('shot_breakdown_incomplete');
    }
  }
  const normalizedOutline = ['opening', 'development', 'turning_point', 'resolution']
    .map(key => String(outline[key] || '').replace(/[\s，,。；;：:]/gu, ''));
  if (normalizedOutline.filter(Boolean).some((value, index, all) => all.indexOf(value) !== index)) {
    failures.push('story_outline_duplicated');
  }
  const sceneLocations = scenes.map(item => String(item?.location_type || '').replace(/[\s，,。；;：:]/gu, ''));
  if (sceneLocations.length > 1 && new Set(sceneLocations.filter(Boolean)).size === 1) {
    failures.push('scene_locations_duplicated');
  }
  if (/(?:\s-\s布(?:局)?$|(?:材质|颜色|布局|光线)\s*[:：]\s*$)/u.test(serialized)) {
    failures.push('truncated_evidence_text');
  }
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
  const animals = Array.isArray(result.animal_prompts) ? result.animal_prompts.slice(0, 12) : [];
  const animalActions = Array.isArray(result.animal_actions) ? result.animal_actions.slice(0, 12) : [];
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
    ].filter(Boolean).join('；')).join('\n')
    : '按剧情需要设置原创人物；人物详细外貌、服装和妆造写入人物档案，不堆入广告需求。';
  const sceneText = scenes.length
    ? scenes.map((item, index) => `${index + 1}. ${hasReadableChinese(item.location_type) ? String(item.location_type).trim() : `原创场景 ${index + 1}`}`).join('；')
    : String(facts.environment || '参考视频中的实际空间').trim();
  const animalText = facts.animal_presence === true
    ? animals.map((item, index) => [
      `${index + 1}. ${String(item.species || `动物 ${index + 1}`).trim()}`,
      hasReadableChinese(item.appearance_direction) ? `可见外观：${String(item.appearance_direction).trim()}` : '',
      hasReadableChinese(animalActions[index]?.action) ? `真实动作：${String(animalActions[index].action).trim()}` : '',
    ].filter(Boolean).join('；')).join('\n')
    : '参考证据未确认真实动物，不得自行添加动物。';
  return [
    `【参考内容事实】${sourceFactsText}`,
    `【广告目标】${summary}`,
    `【完整剧情】${outlineText}\n剧情节拍：${beatText}`,
    `【人物提示词】${characterText}`,
    `【动物提示词】${animalText}`,
    `【场景提示词】${sceneText}`,
    `【核心卖点】${Array.isArray(facts.visible_text) && facts.visible_text.length ? facts.visible_text.join('；') : '依据参考证据提炼产品价值，不把环境误当产品。'}`,
  ].join('\n').slice(0, 1800);
}

function selectEvidenceFrames(frames = [], limit = MAX_EVIDENCE_FRAMES) {
  const source = Array.isArray(frames) ? frames.filter(Boolean) : [];
  const count = Math.max(1, Math.min(source.length, Number(limit) || 8));
  if (source.length <= count) return source.slice();
  const indexes = Array.from({ length: count }, (_, index) => Math.round(index * (source.length - 1) / (count - 1)));
  return [...new Set(indexes)].map(index => source[index]).filter(Boolean);
}

function frameVisionUrl(frame = {}) {
  const localPath = mediaAdapter.assetPathFromName(frame.filename || '');
  if (!localPath || !fs.existsSync(localPath)) return String(frame.image_url || '');
  const bytes = fs.readFileSync(localPath);
  if (!bytes.length) return String(frame.image_url || '');
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

function parseVisionEvidencePayload(text = '', expectedFrames = []) {
  const raw = String(text || '').trim();
  if (!raw || refusalLike(raw)) {
    const error = new Error('视觉模型没有返回可用的逐帧证据 JSON');
    error.code = 'PROVIDER_RESPONSE_INVALID';
    error.retryable = true;
    throw error;
  }
  let parsed;
  try {
    parsed = jsonRepair.parseJson(raw, 'object');
  } catch (parseError) {
    const error = new Error('视觉模型逐帧证据不是有效 JSON，已拒绝不完整批次');
    error.code = 'PROVIDER_RESPONSE_INVALID';
    error.retryable = true;
    error.response_diagnostics = {
      response_length: raw.length,
      response_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
      parse_error: String(parseError?.message || parseError).slice(0, 240),
    };
    throw error;
  }
  const rows = Array.isArray(parsed?.frames) ? parsed.frames : [];
  const expectedIds = expectedFrames.map(frame => String(frame.frame_id || ''));
  const actualIds = rows.map(row => String(row?.frame_id || ''));
  const missing = expectedIds.filter(id => !actualIds.includes(id));
  const unexpected = actualIds.filter(id => !expectedIds.includes(id));
  const duplicated = actualIds.filter((id, index, all) => id && all.indexOf(id) !== index);
  const frameSummary = row => {
    const direct = cleanEvidenceText(row?.summary || row?.observation_summary || '', 700);
    if (hasChineseDetail(direct, 4)) return direct;
    const list = value => (Array.isArray(value) ? value : [value])
      .map(item => cleanEvidenceText(item, 300))
      .filter(item => item && !/^(?:不确定|未知|无|未出现|无法判断|none|null)$/i.test(item));
    const evidence = [
      ...list(row?.product_or_service),
      ...list(row?.visible_text),
      ...list(row?.environment),
      ...list(row?.materials),
      ...list(row?.colors),
      ...list(row?.layout),
      ...list(row?.lighting),
      ...list(row?.human_actions),
      ...list(row?.animal_description),
      ...list(row?.animal_actions),
    ].slice(0, 6);
    const derived = evidence.join('；').slice(0, 700);
    return hasChineseDetail(derived, 4) ? derived : '';
  };
  const incomplete = rows.filter(row => {
    const expected = expectedFrames.find(frame => String(frame.frame_id || '') === String(row?.frame_id || ''));
    const timestamp = Number(row?.timestamp_seconds);
    return !expected
      || !Number.isFinite(timestamp)
      || Math.abs(timestamp - Number(expected.timestamp_seconds || 0)) > 0.08
      || !frameSummary(row);
  }).map(row => String(row?.frame_id || 'unknown'));
  if (rows.length !== expectedFrames.length || missing.length || unexpected.length || duplicated.length || incomplete.length) {
    const error = new Error(`逐帧证据覆盖不完整：缺失=${missing.join('|') || '无'}；多余=${unexpected.join('|') || '无'}；重复=${duplicated.join('|') || '无'}；内容不足=${incomplete.join('|') || '无'}`);
    error.code = 'REFERENCE_VIDEO_EVIDENCE_COVERAGE_INVALID';
    error.retryable = true;
    error.failures = ['visual_frame_coverage_incomplete'];
    throw error;
  }
  const list = value => (Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]))
    .map(item => cleanEvidenceText(item, 500)).filter(Boolean).slice(0, 20);
  const people = value => (Array.isArray(value) ? value : []).slice(0, 20).map((item, index) => ({
    id: cleanEvidenceText(item?.id || item?.person_id || `visible_person_${index + 1}`, 80),
    role_hint: cleanEvidenceText(item?.role_hint || item?.role || '', 160),
    position: cleanEvidenceText(item?.position || item?.screen_position || '', 160),
    appearance: cleanEvidenceText(item?.appearance || item?.visible_appearance || '', 300),
    action: cleanEvidenceText(item?.action || item?.visible_action || '', 300),
  }));
  const frames = rows.map(row => {
    const expected = expectedFrames.find(frame => String(frame.frame_id || '') === String(row.frame_id || ''));
    const visiblePeople = people(row.people || row.visible_people);
    const explicitHumanCount = Number(row.human_count || row.visible_human_count || 0);
    return {
      frame_id: String(row.frame_id),
      timestamp_seconds: Number(Number(row.timestamp_seconds).toFixed(3)),
      shot_index: Number(expected.shot_index || 0),
      shot_range: Array.isArray(expected.shot_range) ? expected.shot_range.map(Number) : [],
      sample_role: String(expected.sample_role || 'representative'),
      product_or_service: cleanEvidenceText(row.product_or_service || '', 500),
      visible_text: list(row.visible_text),
      environment: cleanEvidenceText(row.environment || '', 500),
      materials: list(row.materials),
      colors: list(row.colors),
      layout: cleanEvidenceText(row.layout || '', 700),
      lighting: cleanEvidenceText(row.lighting || '', 500),
      human_presence: row.human_presence === true,
      human_count: row.human_presence === true
        ? Math.max(1, Math.min(20, Number.isFinite(explicitHumanCount) ? Math.round(explicitHumanCount) : visiblePeople.length || 1))
        : 0,
      people: visiblePeople,
      human_actions: list(row.human_actions),
      animal_presence: row.animal_presence === true,
      animal_count: row.animal_presence === true
        ? Math.max(1, Math.min(100, Math.round(Number(row.animal_count || 1) || 1)))
        : 0,
      animal_role: cleanEvidenceText(row.animal_role || row.animal_context || '', 80).toLowerCase(),
      animal_description: cleanEvidenceText(row.animal_description || '', 500),
      animal_actions: list(row.animal_actions),
      shot_size: cleanEvidenceText(row.shot_size || '', 80),
      angle: cleanEvidenceText(row.angle || '', 80),
      movement: cleanEvidenceText(row.movement || '', 120),
      summary: frameSummary(row),
    };
  });
  return {
    contract_version: EVIDENCE_CONTRACT_VERSION,
    frames,
    batch_summary: cleanEvidenceText(parsed.batch_summary || '', 1000),
  };
}

function renderVisionEvidencePayload(payload = {}) {
  return (Array.isArray(payload.frames) ? payload.frames : []).map(frame => [
    `时间点：${frame.timestamp_seconds} 秒；帧编号：${frame.frame_id}；镜头编号：${frame.shot_index}`,
    `产品或服务：${frame.product_or_service || '不确定'}`,
    `可见文字：${frame.visible_text?.join('、') || '无'}`,
    `真实环境：${frame.environment || '不确定'}`,
    `材质：${frame.materials?.join('、') || '不确定'}`,
    `颜色：${frame.colors?.join('、') || '不确定'}`,
    `布局：${frame.layout || '不确定'}`,
    `光线：${frame.lighting || '不确定'}`,
    `人物动作：${frame.human_presence ? (frame.human_actions?.join('、') || '人物出现但动作不确定') : '未出现人物'}`,
    `可见人数：${frame.human_presence ? frame.human_count : 0}`,
    `逐人证据：${frame.people?.length ? frame.people.map(item => [item.role_hint, item.position, item.appearance, item.action].filter(Boolean).join('；')).join('｜') : '无'}`,
    `动物是否出现：${frame.animal_presence ? (frame.animal_description || '明确出现动物') : '未出现动物'}`,
    `动物叙事角色：${frame.animal_presence ? (frame.animal_role || '不确定') : '无'}`,
    `动物动作：${frame.animal_actions?.join('、') || '无'}`,
    `景别：${frame.shot_size || '不确定'}；机位：${frame.angle || '不确定'}；运镜：${frame.movement || '不确定'}`,
    `画面总结：${frame.summary}`,
  ].join('\n')).join('\n\n');
}

function visualEvidenceCacheKey(record = {}, frames = []) {
  let sourceStat = {};
  try {
    sourceStat = fs.statSync(record.source?.local_path || '');
  } catch {}
  return crypto.createHash('sha256').update(JSON.stringify({
    contract_version: EVIDENCE_CONTRACT_VERSION,
    source_size: Number(sourceStat.size || record.source?.size_bytes || 0),
    source_mtime_ms: Number(sourceStat.mtimeMs || 0),
    duration_seconds: Number(record.source?.metadata?.duration_seconds || 0),
    frames: frames.map(frame => ({
      frame_id: frame.frame_id || '',
      filename: frame.filename || '',
      timestamp_seconds: Number(frame.timestamp_seconds || 0),
      shot_index: Number(frame.shot_index || 0),
      shot_range: Array.isArray(frame.shot_range) ? frame.shot_range.map(Number) : [],
    })),
  })).digest('hex');
}

/** 失败重试只在证据帧和全部视觉批次齐全时复用，禁止拿不完整缓存伪装成功。 */
function hasReusableVisualEvidence(record = {}) {
  const frames = Array.isArray(record.evidence_frames) ? record.evidence_frames : [];
  const cache = record._visual_evidence_cache && typeof record._visual_evidence_cache === 'object'
    ? record._visual_evidence_cache
    : {};
  const selected = selectEvidenceFrames(frames, MAX_EVIDENCE_FRAMES);
  const expectedBatches = Math.ceil(selected.length / VISION_BATCH_SIZE);
  return selected.length > 0
    && cache.contract_version === EVIDENCE_CONTRACT_VERSION
    && cache.key === visualEvidenceCacheKey(record, selected)
    && Array.isArray(cache.batches)
    && cache.batches.length === expectedBatches
    && cache.batches.every((item, batchIndex) => {
      if (!item || typeof item !== 'object' || item.contract_version !== EVIDENCE_CONTRACT_VERSION) return false;
      const expected = selected.slice(batchIndex * VISION_BATCH_SIZE, (batchIndex + 1) * VISION_BATCH_SIZE);
      try {
        const payload = item.payload && typeof item.payload === 'object'
          ? parseVisionEvidencePayload(JSON.stringify(item.payload), expected)
          : parseVisionEvidencePayload(item.raw_text || item.text || '', expected);
        return payload.frames.length === expected.length
          && expected.every(frame => payload.frames.some(row => row.frame_id === frame.frame_id));
      } catch {
        return false;
      }
    });
}

/** 仅复用“镜头/场景映射校验失败”时已成功生成的语义结果，避免为同一内容重复付费。 */
function canReuseSynthesisRaw(record = {}) {
  const failures = Array.isArray(record.error?.failures) ? record.error.failures : [];
  return hasReusableVisualEvidence(record)
    && failures.length > 0
    && failures.every(item => item === 'shot_breakdown_incomplete')
    && hasChineseDetail(record._synthesis_raw?.text, 20);
}

function cleanEvidenceText(value = '', max = 1200) {
  return String(value || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/[{}\[\]"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const VISUAL_EVIDENCE_LABELS = [
  '产品或服务', '产品', '可见文字', '真实环境', '环境', '空间', '场景',
  '材质', '颜色', '色调', '布局', '构图', '光线', '照明', '灯光',
  '人物动作', '人物', '动作',
];

function visualEvidenceField(value = '', labels = [], fallback = '') {
  const source = String(value || '')
    .replace(/```(?:json)?/gi, ' ')
    .replace(/\*\*/g, '')
    .replace(/\r/g, '\n');
  for (const label of labels) {
    const match = new RegExp(`(?:^|[\\n\\s-])${label}\\s*[:：]\\s*`, 'u').exec(source);
    if (!match) continue;
    const tail = source.slice(match.index + match[0].length);
    const next = new RegExp(`(?:\\s+-\\s+|\\n+)\\s*(?:${VISUAL_EVIDENCE_LABELS.join('|')})\\s*[:：]`, 'u').exec(tail);
    const candidate = cleanEvidenceText(next ? tail.slice(0, next.index) : tail, 500)
      .replace(/^(?:以下是)?逐帧分析(?:及总结)?[:：]?/u, '')
      .trim();
    if (candidate) return candidate;
  }
  return cleanEvidenceText(fallback, 500);
}

function visualEvidenceFacts(value = '') {
  return evidenceText.facts(value);
}

function evidenceExcerpt(text = '', keywords = [], fallback = '') {
  const source = cleanEvidenceText(text, 12000);
  const segments = source.split(/[。；;]\s*/).map(item => item.trim()).filter(Boolean);
  const matched = segments.find(segment => keywords.some(keyword => segment.includes(keyword)));
  return cleanEvidenceText(matched || segments[0] || fallback, 500) || fallback;
}

const COUNT_NUMERALS = new Map([
  ['一', 1], ['二', 2], ['两', 2], ['三', 3], ['四', 4], ['五', 5], ['六', 6],
  ['七', 7], ['八', 8], ['九', 9], ['十', 10],
]);

function visibleHumanCount(frame = {}) {
  if (frame.human_presence !== true) return 0;
  const explicit = Number(frame.human_count || frame.visible_human_count || 0);
  const listed = Array.isArray(frame.people) ? frame.people.length : 0;
  const sources = [frame.summary, frame.layout, ...(Array.isArray(frame.human_actions) ? frame.human_actions : [])]
    .map(value => String(value || '').trim()).filter(Boolean);
  const described = sources.reduce((maximum, source) => {
    let current = 0;
    const family = /一家([一二两三四五六七八九十\d]+)口/u.exec(source);
    if (family) current = Number(family[1]) || COUNT_NUMERALS.get(family[1]) || 0;
    const matches = [...source.matchAll(/([一二两三四五六七八九十\d]+)(?:个)?人(?!物)/gu)]
      .map(match => Number(match[1]) || COUNT_NUMERALS.get(match[1]) || 0)
      .filter(Boolean);
    if (matches.length) current = Math.max(current, matches.length > 1 ? matches.reduce((sum, value) => sum + value, 0) : matches[0]);
    if (/一对(?:男女|夫妻|情侣|夫妇|人物)/u.test(source)) current = Math.max(current, 2);
    return Math.max(maximum, current);
  }, 0);
  return Math.max(1, Math.min(20, Math.round(Math.max(explicit, listed, described, 1))));
}

function narrativeAnimalEvidence(frames = [], advertisedSubject = '') {
  const animalFrames = frames.filter(frame => frame.animal_presence === true);
  if (!animalFrames.length) return { present: false, ambient: [], reason: 'not_observed' };
  const narrativeRoles = new Set(['narrative_character', 'companion', 'pet', 'product_subject', 'hero']);
  const ambientRoles = new Set(['ambient', 'ambient_wildlife', 'background', 'scenery']);
  if (animalFrames.some(frame => narrativeRoles.has(String(frame.animal_role || '').toLowerCase()))) {
    return { present: true, ambient: [], reason: 'explicit_narrative_role' };
  }
  const descriptions = [...new Set(animalFrames.map(frame => cleanEvidenceText(frame.animal_description || '', 500)).filter(Boolean))];
  const interactionText = animalFrames.map(frame => [
    frame.summary, frame.layout, ...(frame.human_actions || []), ...(frame.animal_actions || []),
  ].filter(Boolean).join('；')).join('；');
  const explicitInteraction = /(?:宠物|主人|陪伴|牵引|牵着|拥抱|抱着|抚摸|喂食|投喂|与人互动|跟随人物|产品使用者)/u.test(interactionText);
  const subjectIsAnimal = /(?:宠物|犬|狗|猫|鸟|动物|牲畜|水族|马术)/u.test(String(advertisedSubject || ''));
  const allExplicitAmbient = animalFrames.every(frame => ambientRoles.has(String(frame.animal_role || '').toLowerCase()));
  const recurringFocus = animalFrames.length / Math.max(1, frames.length) >= 0.25;
  const present = !allExplicitAmbient && (explicitInteraction || subjectIsAnimal || recurringFocus);
  return {
    present,
    ambient: present ? [] : descriptions,
    reason: present ? (explicitInteraction ? 'human_interaction' : (subjectIsAnimal ? 'advertised_subject' : 'recurring_focus')) : 'ambient_visual_element',
  };
}

function characterEvidenceProfiles(frames = [], count = 0) {
  const maxFrame = frames.reduce((best, frame) => (
    visibleHumanCount(frame) > visibleHumanCount(best) ? frame : best
  ), {});
  const explicitPeople = Array.isArray(maxFrame.people) ? maxFrame.people : [];
  const actionPeople = explicitPeople.length ? [] : (Array.isArray(maxFrame.human_actions) ? maxFrame.human_actions : [])
    .slice(0, count).map((action, index) => ({ id: `visible_person_${index + 1}`, action }));
  const visible = [...explicitPeople, ...actionPeople, ...frames.flatMap(frame => Array.isArray(frame.people) ? frame.people : [])];
  const residentialGroup = count >= 3 && frames.some(frame => (
    visibleHumanCount(frame) >= 3
    && /(?:住宅|公寓|客厅|厨房|餐厅|居家|室内)/u.test(`${frame.environment || ''} ${frame.summary || ''} ${frame.layout || ''}`)
  ));
  const familyContext = residentialGroup
    || frames.some(frame => /(?:一家|家庭|家人|亲子|夫妇|夫妻)/u.test(`${frame.summary || ''} ${frame.layout || ''}`));
  return Array.from({ length: count }, (_, index) => {
    const row = visible[index] || {};
    const number = index + 1;
    return {
      id: `character_prompt_${number}`,
      role: cleanEvidenceText(row.role_hint || `${familyContext ? '家庭成员' : '出镜人物'} ${number}`, 120),
      narrative_function: cleanEvidenceText(row.action || row.position || '通过真实可见动作呈现广告主体的使用情境与生活价值', 300),
      age_range: '仅按画面可确认的表观年龄范围，无法确认时由资产环节决定',
      appearance_direction: cleanEvidenceText(row.appearance || '创建原创可信外观，不复制参考视频真人身份；未确认的五官、年龄和身份不得臆测', 500),
      wardrobe_direction: '根据当前品牌与场景重新设计原创服装，不复刻参考视频具体穿着',
      performance_style: cleanEvidenceText(row.action || '继承可见动作节奏与角色功能，不复制真人身份', 400),
      continuity_rules: '跨镜保持该人物的原创外观、服装、站位职责、动作方向和视线一致',
      negative_prompt: '禁止人脸身份复刻、私密属性推断、把多人合并为一人或把一人复制成多人',
    };
  });
}

function compileAnalysisFromStructuredEvidence(record = {}, visualEvidence = [], transcript = {}) {
  const frames = visualEvidence.flatMap(item => Array.isArray(item?.payload?.frames) ? item.payload.frames : []);
  if (!frames.length) return null;
  const duration = Number(record.source?.metadata?.duration_seconds || 0);
  const uniqueText = (values, max = 24) => [...new Set(values.flatMap(value => (
    Array.isArray(value) ? value : [value]
  )).map(value => cleanEvidenceText(value, 500)).filter(value => value && !/^(?:无|不确定|未确认)$/u.test(value)))].slice(0, max);
  const visibleText = uniqueText(frames.map(frame => frame.visible_text));
  const product = evidenceText.chooseProductCandidate(
    frames.map((frame, index) => ({ value: frame.product_or_service, position: index })),
    visibleText,
  );
  const environments = uniqueText(frames.map(frame => frame.environment), 12);
  const materials = uniqueText(frames.map(frame => frame.materials), 20);
  const colors = uniqueText(frames.map(frame => frame.colors), 20);
  const layouts = uniqueText(frames.map(frame => frame.layout), 20);
  const lighting = uniqueText(frames.map(frame => frame.lighting), 20);
  const shotGroups = [...new Set(frames.map(frame => Number(frame.shot_index || 0)).filter(Boolean))]
    .sort((left, right) => left - right)
    .map(shotIndex => frames.filter(frame => Number(frame.shot_index || 0) === shotIndex));
  const humanPresence = frames.some(frame => frame.human_presence === true);
  const humanCount = humanPresence ? Math.max(...frames.map(visibleHumanCount)) : 0;
  const animalPresence = frames.some(frame => frame.animal_presence === true);
  const animalEvidence = narrativeAnimalEvidence(frames, product);
  const narrativeAnimalPresence = animalEvidence.present;
  const sceneRows = [];
  const sceneIdFor = frame => {
    const location = cleanEvidenceText(frame.environment || environments[0] || '', 500);
    const key = location.replace(/[\s，,。；;：:]/gu, '');
    let row = sceneRows.find(item => item.key === key);
    if (!row) {
      row = { key: key || `scene_${sceneRows.length + 1}`, id: `scene_prompt_${sceneRows.length + 1}`, location, frame };
      sceneRows.push(row);
    }
    return row.id;
  };
  frames.forEach(sceneIdFor);
  const summaryFor = group => uniqueText(group.map(frame => frame.summary), 8).join('；');
  const storyEvents = shotGroups.map((group, index) => {
    const range = Array.isArray(group[0]?.shot_range) && group[0].shot_range.length === 2
      ? group[0].shot_range.map(Number)
      : [Number(group[0]?.timestamp_seconds || 0), Number(group[group.length - 1]?.timestamp_seconds || 0)];
    return {
      order: index + 1,
      range,
      summary: summaryFor(group) || `镜头 ${index + 1} 展示可见广告内容`,
      group,
    };
  });
  const advertisedSubject = product || '';
  const scenePrompts = sceneRows.map(row => ({
    id: row.id,
    location_type: row.location || `参考视频物理空间 ${sceneRows.indexOf(row) + 1}`,
    beat_refs: storyEvents.filter(event => event.group.some(frame => sceneIdFor(frame) === row.id)).map(event => event.order),
    layout_prompt: `环境：${row.location || '参考视频物理空间'}；布局：${row.frame.layout || layouts[0] || '按逐帧证据保持主体与空间相对位置'}；广告主体：${advertisedSubject || '待根据可见产品文字确认'}`,
    material_light_prompt: `材质：${uniqueText(row.frame.materials).join('、') || materials[0] || '按画面证据'}；色彩：${uniqueText(row.frame.colors).join('、') || colors[0] || '按画面证据'}；光线：${row.frame.lighting || lighting[0] || '按画面证据'}`,
    interaction_prompt: humanPresence ? '只使用逐帧证据中明确可见的人物动作和站位' : '保持广告主体与真实空间关系，不添加证据外人物或道具',
    camera_purpose: '按镜头时间线展示广告主体、空间关系和可见结果',
    negative_prompt: '禁止替换产品类别、另造空间、复制真人身份、原片服装、品牌标识或水印',
  }));
  const shotBreakdown = storyEvents.map(event => {
    const first = event.group[0] || {};
    const humanActions = uniqueText(event.group.map(frame => frame.human_actions), 12);
    const animalActions = uniqueText(event.group.map(frame => frame.animal_actions), 12);
    const sceneId = sceneIdFor(first);
    const range = event.range;
    return {
      order: event.order,
      range,
      visual: event.summary,
      action: [...humanActions, ...animalActions].join('；') || '展示广告主体、空间与可见状态变化',
      scene_id: sceneId,
      subject_ids: [
        'advertised_subject',
        ...Array.from({ length: Math.max(0, ...event.group.map(visibleHumanCount)) }, (_, index) => `character_prompt_${index + 1}`),
        narrativeAnimalPresence && event.group.some(frame => frame.animal_presence) ? 'animal_1' : '',
      ].filter(Boolean),
      shot_size: cleanEvidenceText(first.shot_size || '未确认景别', 80),
      angle: cleanEvidenceText(first.angle || '未确认机位', 80),
      movement: cleanEvidenceText(first.movement || '未确认运镜', 120),
      duration_seconds: Number(Math.max(0, Number(range[1]) - Number(range[0])).toFixed(3)),
    };
  });
  const characterActions = humanPresence ? storyEvents.filter(event => event.group.some(frame => frame.human_presence)).map(event => ({
    role: '产品体验与展示角色',
    start_pose: '承接该镜头开头证据中的真实姿态',
    key_action: uniqueText(event.group.map(frame => frame.human_actions), 12).join('；') || '人物出现，具体动作需按画面证据确认',
    end_pose: '保持该镜头结尾证据中的真实姿态和朝向',
    dominant_hand: '仅在逐帧证据明确时指定',
    prop_contact: advertisedSubject,
    screen_direction: '按同一镜头开头与结尾证据保持方向',
    eyeline: '按画面证据中的视线目标',
    expression_change: '只保留可见表情变化',
    previous_frame_dependency: event.order === 1 ? '无' : '承接上一镜头可见状态',
  })) : [];
  const animalDescriptions = uniqueText(frames.filter(frame => frame.animal_presence).map(frame => frame.animal_description), 12);
  const animalPrompts = narrativeAnimalPresence ? animalDescriptions.map((description, index) => ({
    id: `animal_${index + 1}`,
    species: description,
    appearance_direction: description,
    continuity_rules: '只保留逐帧证据中可见的物种、毛色、体型和佩戴物，未知特征不得补写',
  })) : [];
  const animalActions = narrativeAnimalPresence ? storyEvents.filter(event => event.group.some(frame => frame.animal_presence)).map(event => ({
    animal_id: animalPrompts[0]?.id || 'animal_1',
    action: uniqueText(event.group.map(frame => frame.animal_actions), 12).join('；') || '动物出现但动作未确认',
    range: event.range,
    scene_id: sceneIdFor(event.group[0] || {}),
  })) : [];
  const opening = storyEvents[0]?.summary || '建立广告主体与真实环境';
  const resolution = storyEvents[storyEvents.length - 1]?.summary || '以可见产品信息完成广告收束';
  return {
    source_facts: {
      product_or_service: advertisedSubject,
      visible_text: visibleText,
      environment: environments.join('；'),
      materials,
      colors,
      layout: layouts.join('；'),
      lighting: lighting.join('；'),
      human_presence: humanPresence,
      human_count: humanCount,
      human_actions: uniqueText(frames.map(frame => frame.human_actions), 32),
      animal_presence: animalPresence,
      narrative_animal_presence: narrativeAnimalPresence,
      animal_narrative_reason: animalEvidence.reason,
      ambient_animals: animalEvidence.ambient,
      animal_actions: narrativeAnimalPresence ? uniqueText(frames.map(frame => frame.animal_actions), 32) : [],
      ambient_animal_actions: narrativeAnimalPresence ? [] : uniqueText(frames.map(frame => frame.animal_actions), 32),
      chronological_story: storyEvents.map(event => `${event.range[0]}—${event.range[1]} 秒：${event.summary}`),
      evidence_timestamps: frames.map(frame => Number(frame.timestamp_seconds)).filter(Number.isFinite),
    },
    summary: `参考视频按 ${storyEvents.length} 个镜头取证片段展示${advertisedSubject || '可见广告主体'}在${environments.join('、') || '真实环境'}中的广告叙事。`,
    story_outline: {
      logline: `通过真实镜头时间线展示${advertisedSubject || '广告主体'}的核心价值与可见结果。`,
      opening,
      development: `发展阶段：${storyEvents.slice(1, -2).map(event => event.summary).join('；') || '推进广告主体细节与空间关系。'}`,
      turning_point: storyEvents[Math.max(0, storyEvents.length - 2)]?.summary || '从整体展示推进到产品细节和结果证明。',
      resolution,
    },
    plot_beats: storyEvents.map(event => ({ range: event.range, purpose: event.summary, evidence_summary: event.summary })),
    character_prompts: characterEvidenceProfiles(frames, humanCount),
    scene_prompts: scenePrompts,
    camera_intents: storyEvents.map(event => ({
      range: event.range,
      movement: event.group[0]?.movement || '未确认运镜',
      start_shot_size: event.group[0]?.shot_size || '未确认景别',
      end_shot_size: event.group[event.group.length - 1]?.shot_size || event.group[0]?.shot_size || '未确认景别',
      angle: event.group[0]?.angle || '未确认机位',
      evidence_timestamps: event.group.map(frame => frame.timestamp_seconds),
    })),
    character_actions: characterActions,
    animal_actions: animalActions,
    animal_prompts: animalPrompts,
    shot_breakdown: shotBreakdown,
    subtitle_cta: transcript.text ? '结合已转写语音提炼产品价值与行动号召' : '仅依据画面可见产品信息提炼行动号召',
    prompt_suggestions: ['严格保持逐帧证据中的产品、空间、材质和时间顺序', '人物与动物只继承可见角色功能和动作，不复制身份', '未确认的景别、机位和运镜必须在对应环节由用户确认'],
  };
}

function compileAnalysisFromEvidence(record = {}, visualEvidence = [], transcript = {}) {
  const structured = compileAnalysisFromStructuredEvidence(record, visualEvidence, transcript);
  if (structured) return structured;
  const combined = visualEvidence.map(item => cleanEvidenceText(item.text, 8000)).join('。');
  const batchFacts = visualEvidence.map(item => visualEvidenceFacts(item.text));
  const firstFact = (key, fallback) => batchFacts.map(item => item[key]).find(Boolean) || fallback;
  const visibleText = evidenceText.visibleTextCandidates(batchFacts.map(item => item.visibleText));
  const product = evidenceText.chooseProductCandidate(
    batchFacts.map((item, index) => ({ value: item.product, position: index })),
    visibleText,
  ) || evidenceExcerpt(combined, ['产品', '汽车', '轿车', '车辆', '品牌', '服务'], '参考视频中展示的主要产品');
  const environment = firstFact('environment', evidenceExcerpt(combined, ['场景', '环境', '空间', '道路', '室内', '室外'], '参考视频中实际出现的物理场景'));
  const material = firstFact('materials', evidenceExcerpt(combined, ['材质', '金属', '玻璃', '皮革', '木', '织物', '漆面'], '画面中可见的产品与环境材质'));
  const colors = firstFact('colors', evidenceExcerpt(combined, ['颜色', '色调', '黑色', '白色', '蓝色', '红色', '金色', '银色'], '参考画面的主要色调'));
  const layout = firstFact('layout', evidenceExcerpt(combined, ['布局', '构图', '前景', '中景', '背景', '中央', '左侧', '右侧'], environment));
  const lighting = firstFact('lighting', evidenceExcerpt(combined, ['光线', '灯光', '照明', '高光', '阴影', '逆光', '自然光'], '参考画面的实际光线与明暗关系'));
  const humanPresence = /人物|人影|展示者|驾驶员|乘员|女性|男性|手部|双手|触摸|行走/.test(combined)
    && !/没有人物|无人出现|未出现人物|人物\s*[:：]\s*无/.test(combined);
  const animalPresence = batchFacts.some(item => item.animalPresence === true);
  const observedAnimalDescriptions = [...new Set(batchFacts
    .map(item => item.animalDescription)
    .filter(Boolean))];
  const observedAnimalActions = [...new Set(batchFacts
    .map(item => item.animalAction)
    .filter(Boolean))];
  const chronology = visualEvidence.map((item, index) => {
    const range = item.timestamps?.length
      ? `${Math.min(...item.timestamps)}—${Math.max(...item.timestamps)} 秒`
      : `第 ${index + 1} 组`;
    return `${range}：${evidenceText.summary(batchFacts[index], index ? '推进产品细节与使用情境' : '建立产品与空间关系')}`;
  });
  const duration = Number(record.source?.metadata?.duration_seconds || 0);
  const firstBeat = chronology[0] || `0 秒：建立${product}`;
  const lastBeat = chronology[chronology.length - 1] || `${duration} 秒：完成产品信息收束`;
  const summary = `参考视频围绕${product}展开，通过${environment}中的连续画面展示产品、材质、光线和使用情境，并按时间顺序形成完整广告叙事。`;
  const scenePrompts = visualEvidence.map((item, index) => {
    const facts = batchFacts[index] || {};
    const batchEnvironment = facts.environment || environment;
    const batchLayout = facts.layout || layout;
    const batchProduct = facts.product || product;
    const batchMaterials = facts.materials || material;
    const batchColors = facts.colors || colors;
    const batchLighting = facts.lighting || lighting;
    return {
    id: `scene_prompt_${index + 1}`,
    location_type: batchEnvironment || (index === 0 ? environment : `${environment}的后续画面区域`),
    beat_refs: [index + 1],
    layout_prompt: [
      batchEnvironment ? `环境：${batchEnvironment}` : '',
      batchLayout ? `布局：${batchLayout}` : '',
      batchProduct ? `广告主体：${batchProduct}` : '',
    ]
      .filter(Boolean).join('；').slice(0, 520),
    material_light_prompt: [
      batchMaterials ? `材质：${batchMaterials}` : '',
      batchColors ? `色彩：${batchColors}` : '',
      batchLighting ? `光线：${batchLighting}` : '',
    ].filter(Boolean).join('；').slice(0, 420),
    interaction_prompt: humanPresence
      ? (facts.action || '保留证据中人物与产品的功能性互动，但使用原创人物外观与服装。')
      : '保持产品与真实空间关系，不添加证据外人物或道具。',
    camera_purpose: index === 0 ? '建立产品与真实环境关系' : '补充产品细节、动作与广告收束信息',
    negative_prompt: '禁止替换产品类别、另造空间、复制真人身份或原片服装。',
  };
  });
  const distinctScenePrompts = scenePrompts.filter((item, index, all) => {
    const key = String(item.location_type || '').replace(/[\s，,。；;：:]/gu, '');
    return key && all.findIndex(candidate => (
      String(candidate.location_type || '').replace(/[\s，,。；;：:]/gu, '') === key
    )) === index;
  });
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
    key_action: batchFacts[index]?.action || '围绕产品完成证据中可见的展示动作',
    end_pose: '动作完成后保持视线或身体朝向产品',
    dominant_hand: '按证据画面保持一致，无法确认时不指定',
    prop_contact: product.slice(0, 160),
    screen_direction: 'preserve_evidence_direction',
    eyeline: '面向产品或动作目标',
    expression_change: '从观察转为确认产品效果的自然反应',
    previous_frame_dependency: index === 0 ? '无' : '承接上一组动作、视线和屏幕方向',
  })) : [];
  const animalPrompts = animalPresence ? observedAnimalDescriptions.map((description, index) => ({
    id: `animal_${index + 1}`,
    species: description,
    appearance_direction: description,
    continuity_rules: '只保留证据中可见的物种、毛色、体型和佩戴物；无法确认的特征不得补写',
  })) : [];
  const animalActions = animalPresence ? observedAnimalActions.map((action, index) => ({
    animal_id: animalPrompts[Math.min(index, animalPrompts.length - 1)]?.id || 'animal_1',
    action,
    range: [
      Number(visualEvidence[index]?.timestamps?.[0] || 0),
      Number(visualEvidence[index]?.timestamps?.[visualEvidence[index]?.timestamps?.length - 1] || duration),
    ],
    scene_id: distinctScenePrompts[Math.min(index, distinctScenePrompts.length - 1)]?.id || 'scene_prompt_1',
  })) : [];
  const shotBreakdown = visualEvidence.map((item, index) => {
    const range = [
      Number(item.timestamps?.[0] || 0),
      Number(item.timestamps?.[item.timestamps.length - 1] || duration),
    ];
    const facts = batchFacts[index] || {};
    const sceneLocationKey = String(scenePrompts[index]?.location_type || '').replace(/[\s，,。；;：:]/gu, '');
    const sceneId = distinctScenePrompts.find(candidate => (
      String(candidate.location_type || '').replace(/[\s，,。；;：:]/gu, '') === sceneLocationKey
    ))?.id || distinctScenePrompts[0]?.id || 'scene_prompt_1';
    const subjects = [
      humanPresence ? 'character_prompt_1' : '',
      animalPresence && facts.animalPresence === true ? 'animal_1' : '',
      'advertised_subject',
    ].filter(Boolean);
    const observedAction = String(facts.animalAction || facts.action || '').trim();
    return {
      order: index + 1,
      range,
      visual: evidenceText.summary(facts, `展示${product}与${environment}的可见关系`),
      action: hasChineseDetail(observedAction, 2)
        ? observedAction
        : (index === 0 ? '建立广告主体与空间关系' : '推进广告主体细节与结果展示'),
      scene_id: sceneId,
      subject_ids: subjects,
      shot_size: index === 0 ? 'wide' : 'medium',
      angle: 'eye_level',
      movement: index === 0 ? 'establishing' : 'progressive',
      duration_seconds: Number(Math.max(0, range[1] - range[0]).toFixed(3)),
    };
  });
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
      animal_presence: animalPresence,
      animal_actions: animalActions.map(item => item.action),
      chronological_story: chronology,
      evidence_timestamps: visualEvidence.flatMap(item => item.timestamps || []),
    },
    summary,
    story_outline: {
      logline: `通过${environment}中的连续展示，让观众理解${product}的核心价值与使用结果。`,
      opening: firstBeat,
      development: `发展阶段：${(chronology.length > 2 ? chronology.slice(1, -1) : chronology.slice(1)).join('；')
        || '在后续证据中推进产品细节、人物动作与使用结果。'}`,
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
      evidence_summary: evidenceText.summary(batchFacts[index], '保留本组画面中的产品、空间、材质与动作证据'),
    })),
    character_prompts: characterPrompts,
    scene_prompts: distinctScenePrompts,
    camera_intents: cameraIntents,
    character_actions: characterActions,
    animal_actions: animalActions,
    animal_prompts: animalPrompts,
    shot_breakdown: shotBreakdown,
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

function mergeAnalysisWithEvidence(deterministic = {}, modelResult = {}) {
  const evidence = deterministic && typeof deterministic === 'object' ? deterministic : {};
  const model = modelResult && typeof modelResult === 'object' ? modelResult : {};
  const evidenceFacts = evidence.source_facts && typeof evidence.source_facts === 'object'
    ? evidence.source_facts
    : {};
  const modelFacts = model.source_facts && typeof model.source_facts === 'object'
    ? model.source_facts
    : {};
  const preferModelArray = (key) => Array.isArray(model[key]) && model[key].length
    ? model[key]
    : (Array.isArray(evidence[key]) ? evidence[key] : []);
  const evidenceCharacters = Array.isArray(evidence.character_prompts) ? evidence.character_prompts : [];
  const modelCharacters = Array.isArray(model.character_prompts) ? model.character_prompts : [];
  const exactHumanCount = Math.max(0, Number(evidenceFacts.human_count || evidenceCharacters.length || 0) || 0);
  const characterPrompts = exactHumanCount > 0
    ? Array.from({ length: exactHumanCount }, (_, index) => ({
        ...(modelCharacters.length === exactHumanCount ? (modelCharacters[index] || {}) : {}),
        ...(evidenceCharacters[index] || {}),
        id: `character_prompt_${index + 1}`,
      }))
    : [];
  const narrativeAnimalPresence = typeof evidenceFacts.narrative_animal_presence === 'boolean'
    ? evidenceFacts.narrative_animal_presence
    : evidenceFacts.animal_presence === true;
  const merged = {
    ...evidence,
    ...model,
    schema_version: Math.max(5, Number(evidence.schema_version || 0), Number(model.schema_version || 0)),
    source_facts: {
      ...evidenceFacts,
      ...modelFacts,
      product_or_service: hasChineseDetail(evidenceFacts.product_or_service, 2)
        && !evidenceText.environmentProductConflated(evidenceFacts.product_or_service)
        ? evidenceFacts.product_or_service
        : modelFacts.product_or_service,
      visible_text: evidenceText.visibleTextCandidates([
        ...(Array.isArray(evidenceFacts.visible_text) ? evidenceFacts.visible_text : []),
        ...(Array.isArray(modelFacts.visible_text) ? modelFacts.visible_text : []),
      ]),
      chronological_story: Array.isArray(modelFacts.chronological_story) && modelFacts.chronological_story.length
        ? modelFacts.chronological_story
        : (evidenceFacts.chronological_story || []),
      evidence_timestamps: [...new Set([
        ...(Array.isArray(evidenceFacts.evidence_timestamps) ? evidenceFacts.evidence_timestamps : []),
        ...(Array.isArray(modelFacts.evidence_timestamps) ? modelFacts.evidence_timestamps : []),
      ].map(Number).filter(Number.isFinite))].sort((left, right) => left - right),
      animal_presence: evidenceFacts.animal_presence === true,
      narrative_animal_presence: narrativeAnimalPresence,
      ambient_animals: Array.isArray(evidenceFacts.ambient_animals) ? evidenceFacts.ambient_animals : [],
      animal_actions: narrativeAnimalPresence
        ? (Array.isArray(modelFacts.animal_actions) && modelFacts.animal_actions.length
          ? modelFacts.animal_actions
          : (evidenceFacts.animal_actions || []))
        : [],
    },
    story_outline: {
      ...(evidence.story_outline || {}),
      ...(model.story_outline || {}),
    },
    plot_beats: preferModelArray('plot_beats'),
    character_prompts: characterPrompts,
    // 场景目录、逐镜与机位共同组成同一套引用关系，必须全部来自逐帧证据。
    // 文本汇总模型只整理全局语义，不得用少量概括场景破坏 scene_id 映射。
    scene_prompts: Array.isArray(evidence.scene_prompts) ? evidence.scene_prompts : [],
    camera_intents: Array.isArray(evidence.camera_intents) ? evidence.camera_intents : [],
    character_actions: Array.isArray(evidence.character_actions) ? evidence.character_actions : [],
    animal_actions: narrativeAnimalPresence ? preferModelArray('animal_actions') : [],
    animal_prompts: narrativeAnimalPresence ? preferModelArray('animal_prompts') : [],
    shot_breakdown: Array.isArray(evidence.shot_breakdown) ? evidence.shot_breakdown : [],
    prompt_suggestions: preferModelArray('prompt_suggestions'),
  };
  const sanitized = evidenceText.sanitizeAnalysis(merged);
  try {
    validateAnalysisResult(sanitized);
    return sanitized;
  } catch (error) {
    const fallback = evidenceText.sanitizeAnalysis({
      ...evidence,
      schema_version: Math.max(5, Number(evidence.schema_version || 0)),
    });
    validateAnalysisResult(fallback);
    return {
      ...fallback,
      analysis_recovery: {
        strategy: 'evidence_fallback',
        failures: (Array.isArray(error.failures) ? error.failures : []).slice(0, 20),
      },
    };
  }
}

async function synthesizeAnalysisFromEvidence(record = {}, visualEvidence = [], transcript = {}) {
  const deterministic = compileAnalysisFromEvidence(record, visualEvidence, transcript);
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') return deterministic;
  const stage = 'new_story_ad.reference_video_synthesis';
  let response;
  if (record._reuse_synthesis_raw === true && hasChineseDetail(record._synthesis_raw?.text, 20)) {
    response = {
      text: String(record._synthesis_raw.text),
      used_model: String(record._synthesis_raw.used_model || 'stored-semantic-result'),
      reused: true,
    };
  } else response = await modelGateway.generateText({
    taskId: record.id,
    stage,
    systemPrompt: [
      '你是广告参考视频的证据总编。只根据视觉批次证据和转写整理最终结构，不编造画面外事实。',
      '必须严格区分“广告产品/品牌/型号”和“承载产品的建筑、房间、窗帘、家具等环境元素”。',
      '片尾产品名、型号、品牌落版和清晰可见文字的产品证据，优先级高于开场环境画面。',
      '场景按独立物理空间合并：同一客厅的不同镜头只能算一个空间；室外建筑与室内客厅必须分开。',
      '人物动作只能写证据中真实看见的动作；人物外貌和服装只能给原创再设计方向，禁止复制真人身份或原片穿着。',
        '人物必须按逐帧证据保留精确最大同屏人数 human_count，并在 character_prompts 中为每个叙事人物输出一个独立条目；不得把多人合并成一个“夫妇/家庭”条目，也不得复制同一人物凑数。',
        '动物必须区分“真实出现”和“叙事资产”：source_facts.animal_presence 记录是否可见，source_facts.narrative_animal_presence 只在动物是持续主角、宠物、产品主体或与人物/产品发生明确互动时为 true。风景蒙太奇、远景鸟群和环境野生动物写入 ambient_animals，不得生成 animal_prompts。',
      '场景目录、逐镜结构和机位已由通过校验的逐帧证据单独编译，本阶段不要输出 scene_prompts、shot_breakdown 或 camera_intents，只整理全局故事、人物和动物语义。',
      '输出单个 JSON 对象，所有用户可见文本使用简体中文。',
    ].join('\n'),
    userPrompt: [
      `视频时长：${Number(record.source?.metadata?.duration_seconds || 0)} 秒。`,
      `视觉证据批次：${JSON.stringify(visualEvidence.map(item => ({
        timestamps: item.timestamps,
        evidence: item.payload || cleanEvidenceText(item.text, 12000),
      })))}`,
      `语音转写：${cleanEvidenceText(transcript.text || '', 5000) || '无可用转写，仅依据画面'}`,
      '返回字段合同：',
      JSON.stringify({
        source_facts: {
          product_or_service: '明确的产品/服务，不得写环境',
          visible_text: ['品牌、型号、产品文案'],
          environment: '所有真实出现的物理环境概述',
          materials: ['产品与空间关键材质'],
          colors: ['主色调'],
          layout: '产品、人物、前中后景关系',
          lighting: '真实光线',
          human_presence: true,
          human_count: 1,
          human_actions: ['逐条可见动作'],
          animal_presence: false,
          narrative_animal_presence: false,
          ambient_animals: [],
          animal_actions: ['仅填写画面中明确可见的动物动作；无动物时为空'],
          chronological_story: ['按时间顺序的事件'],
          evidence_timestamps: [0],
        },
        summary: '广告结构摘要',
        story_outline: {
          logline: '一句话故事',
          opening: '开场',
          development: '发展',
          turning_point: '转折',
          resolution: '结尾',
        },
        plot_beats: [{ range: [0, 1], purpose: '节拍目的', evidence_summary: '证据' }],
        character_prompts: [{
          id: 'character_prompt_1',
          role: '角色',
          narrative_function: '剧情职责',
          age_range: '仅表观年龄范围',
          appearance_direction: '详细原创外貌气质方向',
          wardrobe_direction: '详细原创服装鞋履配饰方向，不复制原片',
          hair_makeup_direction: '详细原创发型妆造方向',
          performance_style: '表演方式',
          continuity_rules: '连续性规则',
          negative_prompt: '禁止项',
        }],
        character_actions: [{
          role: '角色',
          start_pose: '起始姿态',
          key_action: '证据中真实可见动作',
          end_pose: '结束姿态',
          eyeline: '视线',
          previous_frame_dependency: '连续性',
        }],
        animal_actions: [{
          animal_id: 'animal_1',
          action: '证据中真实可见的动物动作',
          range: [0, 1],
          scene_id: 'scene_prompt_1',
        }],
        animal_prompts: [{
          id: 'animal_1',
          species: '仅按画面确认的动物种类',
          appearance_direction: '仅记录可见毛色、体型和佩戴物',
          continuity_rules: '跨镜保持可见特征一致，不补写未知品种或属性',
        }],
        subtitle_cta: '字幕与行动号召',
        prompt_suggestions: ['后续生成建议'],
      }),
    ].join('\n'),
    maxTokens: 6000,
    temperature: 0.1,
    timeoutMs: 120000,
    validateText: assertCandidateAnalysisText,
  });
  const latest = readRecord(record.user_id, record.id) || record;
  if (response.reused === true) {
    save(latest, { _synthesis_reused_at: now() });
  } else {
    save(latest, {
      _synthesis_raw: {
        contract_version: EVIDENCE_CONTRACT_VERSION,
        text: String(response.text || '').slice(0, 50000),
        used_model: String(response.used_model || ''),
        response_length: String(response.text || '').length,
        saved_at: now(),
      },
    });
  }
  const parsed = await jsonRepair.parseOrRepair({
    raw: response.text,
    expected: 'object',
    modelGateway,
    taskId: record.id,
    stage: 'new_story_ad.json_repair',
  });
  const merged = mergeAnalysisWithEvidence(deterministic, parsed);
  validateAnalysisResult(merged);
  return merged;
}

async function analyzeWithModels(record, frames, transcript = {}) {
  const stage = 'new_story_ad.reference_video_vision';
  const selectedFrames = selectEvidenceFrames(frames, MAX_EVIDENCE_FRAMES);
  if (selectedFrames.length !== frames.length) {
    const error = new Error(`镜头证据帧数量 ${frames.length} 超过允许上限 ${MAX_EVIDENCE_FRAMES}，系统拒绝静默丢帧。`);
    error.code = 'REFERENCE_VIDEO_EVIDENCE_FRAME_LIMIT_EXCEEDED';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  const batches = [];
  for (let index = 0; index < selectedFrames.length; index += VISION_BATCH_SIZE) {
    batches.push(selectedFrames.slice(index, index + VISION_BATCH_SIZE));
  }
  const cacheKey = visualEvidenceCacheKey(record, selectedFrames);
  const cacheMatches = record._visual_evidence_cache?.contract_version === EVIDENCE_CONTRACT_VERSION
    && record._visual_evidence_cache?.key === cacheKey;
  const candidateSlots = cacheMatches
    && Array.isArray(record._visual_evidence_cache?.batches)
    && record._visual_evidence_cache.batches.length === batches.length
    ? record._visual_evidence_cache.batches.map(item => item && typeof item === 'object' ? { ...item } : null)
    : Array.from({ length: batches.length }, () => null);
  const cachedSlots = candidateSlots.map((item, index) => {
    if (!item) return null;
    try {
      const payload = item.payload && typeof item.payload === 'object'
        ? parseVisionEvidencePayload(JSON.stringify(item.payload), batches[index])
        : parseVisionEvidencePayload(item.raw_text || item.text || '', batches[index]);
      return { ...item, payload, contract_version: EVIDENCE_CONTRACT_VERSION };
    } catch {
      return null;
    }
  });
  const missingIndexes = cachedSlots.map((item, index) => item ? -1 : index).filter(index => index >= 0);
  const persistBatch = (index, value) => {
    const latest = readRecord(record.user_id, record.id) || record;
    const previous = latest._visual_evidence_cache?.key === cacheKey
      && Array.isArray(latest._visual_evidence_cache?.batches)
      ? latest._visual_evidence_cache.batches
      : Array.from({ length: batches.length }, () => null);
    const slots = Array.from({ length: batches.length }, (_, slot) => previous[slot] || null);
    slots[index] = value;
    const failedAttempts = { ...(latest._visual_evidence_cache?.failed_attempts || {}) };
    delete failedAttempts[index];
    save(latest, {
      phase: `正在识别镜头证据 ${slots.filter(Boolean).length}/${batches.length} 批`,
      progress: Math.min(82, 55 + Math.round(slots.filter(Boolean).length / Math.max(1, batches.length) * 27)),
      _visual_evidence_cache: {
        contract_version: EVIDENCE_CONTRACT_VERSION,
        key: cacheKey,
        batches: slots,
        completed_batch_indexes: slots.map((item, slot) => item ? slot : -1).filter(slot => slot >= 0),
        failed_attempts: failedAttempts,
        updated_at: now(),
      },
    });
  };
  const persistBatchFailure = (index, error = {}) => {
    const latest = readRecord(record.user_id, record.id) || record;
    const previousCache = latest._visual_evidence_cache?.key === cacheKey
      ? latest._visual_evidence_cache
      : {};
    const slots = Array.from({ length: batches.length }, (_, slot) => previousCache.batches?.[slot] || null);
    const attempts = (Array.isArray(error.failed_models) && error.failed_models.length ? error.failed_models : [{
      provider_id: '',
      model_id: '',
      code: error.code || 'UNKNOWN',
      message: error.message || '',
      response_diagnostics: error.response_diagnostics || null,
    }]).map(item => ({
      provider_id: String(item?.provider_id || ''),
      model_id: String(item?.model_id || ''),
      code: String(item?.code || 'UNKNOWN'),
      message: String(item?.message || '').slice(0, 500),
      response_diagnostics: item?.response_diagnostics || null,
      failed_at: now(),
    }));
    save(latest, {
      _visual_evidence_cache: {
        contract_version: EVIDENCE_CONTRACT_VERSION,
        key: cacheKey,
        batches: slots,
        completed_batch_indexes: slots.map((item, slot) => item ? slot : -1).filter(slot => slot >= 0),
        failed_attempts: {
          ...(previousCache.failed_attempts || {}),
          [index]: attempts,
        },
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
    const frameManifest = batch.map(item => ({
      frame_id: item.frame_id,
      timestamp_seconds: Number(item.timestamp_seconds || 0),
      shot_index: Number(item.shot_index || 0),
      shot_range: item.shot_range,
      sample_role: item.sample_role,
    }));
    let validatedPayload = null;
    let vision;
    try {
      vision = await modelGateway.generateVision({
      taskId: record.id,
      stage,
      systemPrompt: '你是广告视频逐帧证据分析员。每张输入图都必须按给定 frame_id 独立返回一条 JSON 证据，不能跳帧、合并或只写批次总结。只描述真实可见内容，不识别人脸身份，不编造画面外事实。必须区分广告产品与建筑、房间、窗帘、家具等环境；动物只有明确可见时才记录。所有描述使用简体中文。',
      userPrompt: [
        `这是第 ${index + 1}/${batches.length} 组镜头证据，图片顺序与清单完全一致：${JSON.stringify(frameManifest)}。`,
        '对每张图分别填写：产品/品牌/型号、可见文字、真实环境、材质、颜色、布局、光线、人物是否出现及真实动作、动物是否明确出现及真实动作、景别、机位角度、可见的运镜线索和画面总结。单项不确定可以写“不确定”，但 summary 必须用至少 12 个简体中文字符概括该帧真实可见内容，不得只写“不确定”，不得用前一张图代替后一张图。',
        '人物逐帧合同：human_count 必须填写画面可见总人数；people 必须逐人列出屏幕位置、可见外观和动作。无法确认身份关系时 role_hint 留空，不得把多人概括成一个条目。',
        '动物逐帧合同：animal_role 只能是 narrative_character、companion、product_subject、ambient_wildlife、background 或 uncertain；自然风光中的鸟群/野生动物通常是 ambient_wildlife，不能当宠物。',
        '只返回单个合法 JSON，不要 Markdown：{"frames":[{"frame_id":"F001","timestamp_seconds":0.3,"product_or_service":"","visible_text":[],"environment":"","materials":[],"colors":[],"layout":"","lighting":"","human_presence":false,"human_count":0,"people":[],"human_actions":[],"animal_presence":false,"animal_count":0,"animal_role":"","animal_description":"","animal_actions":[],"shot_size":"","angle":"","movement":"","summary":"该帧真实可见内容的简体中文总结"}],"batch_summary":"本批在广告时间线中的作用"}',
        `frames 必须恰好包含 ${batch.length} 条，frame_id 必须且只能是：${batch.map(item => item.frame_id).join('、')}。`,
      ].join('\n'),
      imageUrls: batch.map(item => item.image_url),
      imageDataUrls: batch.map(frameVisionUrl),
      maxTokens: 3600,
      maxCandidates: REFERENCE_VISION_MAX_CANDIDATES,
      timeoutMs: 120000,
      stageBudgetMs: REFERENCE_VISION_STAGE_BUDGET_MS,
        validateText: (text) => {
          validatedPayload = parseVisionEvidencePayload(text, batch);
          return true;
        },
      });
    } catch (error) {
      persistBatchFailure(index, error);
      throw error;
    }
      const payload = validatedPayload || parseVisionEvidencePayload(vision.text, batch);
      const row = {
        contract_version: EVIDENCE_CONTRACT_VERSION,
        batch_index: index + 1,
        timestamps,
        frame_ids: batch.map(item => item.frame_id),
        text: renderVisionEvidencePayload(payload).slice(0, 24000),
        raw_text: String(vision.text || '').slice(0, 50000),
        payload,
        coverage: { expected: batch.length, received: payload.frames.length, complete: true },
        used_model: vision.used_model,
      };
      persistBatch(index, row);
      return row;
    },
  )));
  const rejected = settled
    .map((item, index) => item.status === 'rejected' ? { index: missingIndexes[index], reason: item.reason } : null)
    .filter(Boolean);
  if (rejected.length) {
    const failedModels = [];
    const seen = new Set();
    for (const failure of rejected) {
      const models = Array.isArray(failure.reason?.failed_models) && failure.reason.failed_models.length
        ? failure.reason.failed_models
        : [{
            provider_id: '',
            model_id: '',
            code: failure.reason?.code || 'UNKNOWN',
            message: failure.reason?.message || '',
          }];
      for (const item of models) {
        const key = `${item.provider_id || ''}/${item.model_id || ''}:${item.code || 'UNKNOWN'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        failedModels.push({ ...item, batch_index: failure.index + 1 });
      }
    }
    const error = new Error(`参考视频有 ${rejected.length} 个镜头证据批次未完成，已保留 ${batches.length - rejected.length} 个成功批次`);
    error.code = 'VISION_QA_UNAVAILABLE';
    error.retryable = rejected.some(item => item.reason?.retryable !== false);
    error.failed_models = failedModels;
    error.retry_after_ms = Math.max(0, ...rejected.map(item => Number(item.reason?.retry_after_ms || 0)));
    error.batch_failures = rejected.map(item => ({
      batch_index: item.index + 1,
      code: String(item.reason?.code || 'UNKNOWN'),
      message: String(item.reason?.message || '').slice(0, 500),
    }));
    throw error;
  }
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

  const result = await synthesizeAnalysisFromEvidence(record, visualEvidence, transcript);
  result.generated_brief = buildChineseBrief(result);
  const coveredFrameIds = visualEvidence.flatMap(item => item.payload?.frames || []).map(item => item.frame_id);
  const expectedFrameIds = selectedFrames.map(item => item.frame_id);
  return {
    schema_version: 5,
    analysis_scope: 'reference_content_and_creative_structure',
    prohibited_reuse: ['person_identity', 'face', 'source_wardrobe_copy', 'private_attributes'],
    ...result,
    evidence_coverage: {
      contract_version: EVIDENCE_CONTRACT_VERSION,
      complete: expectedFrameIds.length > 0
        && expectedFrameIds.every(id => coveredFrameIds.includes(id))
        && coveredFrameIds.length === expectedFrameIds.length,
      expected_frame_count: expectedFrameIds.length,
      covered_frame_count: coveredFrameIds.length,
      expected_frame_ids: expectedFrameIds,
      covered_frame_ids: coveredFrameIds,
      shot_segment_count: new Set(selectedFrames.map(item => item.shot_index)).size,
    },
    visual_evidence_batches: visualEvidence.map(item => ({
      batch_index: item.batch_index,
      timestamps: item.timestamps,
      frame_ids: item.frame_ids,
      coverage: item.coverage,
      used_model: item.used_model,
    })),
    evidence_frames: frames,
    transcript,
  };
}

function normalizeResult(result = {}) {
  const safe = evidenceText.sanitizeAnalysis(result);
  safe.camera_intents = Array.isArray(safe.camera_intents) ? safe.camera_intents.slice(0, 24) : [];
  safe.character_actions = Array.isArray(safe.character_actions) ? safe.character_actions.slice(0, 24) : [];
  safe.plot_beats = Array.isArray(safe.plot_beats) ? safe.plot_beats.slice(0, 24) : [];
  safe.character_prompts = Array.isArray(safe.character_prompts) ? safe.character_prompts.slice(0, 12) : [];
  safe.scene_prompts = Array.isArray(safe.scene_prompts) ? safe.scene_prompts.slice(0, 120) : [];
  safe.animal_actions = Array.isArray(safe.animal_actions) ? safe.animal_actions.slice(0, 48) : [];
  safe.animal_prompts = Array.isArray(safe.animal_prompts) ? safe.animal_prompts.slice(0, 24) : [];
  safe.shot_breakdown = Array.isArray(safe.shot_breakdown) ? safe.shot_breakdown.slice(0, 120) : [];
  safe.story_outline = safe.story_outline && typeof safe.story_outline === 'object' ? safe.story_outline : {};
  safe.source_facts = safe.source_facts && typeof safe.source_facts === 'object' ? safe.source_facts : {};
  const assessment = validateAnalysisResult(safe);
  const generated = String(safe.generated_brief || '').trim();
  const requiredSections = ['【参考内容事实】', '【完整剧情】', '【人物提示词】', '【场景提示词】'];
  safe.generated_brief = hasReadableChinese(generated) && requiredSections.every(section => generated.includes(section))
    ? generated.slice(0, 3800)
    : buildChineseBrief(safe);
  safe.output_language = 'zh-CN';
  const sourceSchemaVersion = Number(safe.schema_version || 0);
  safe.schema_version = sourceSchemaVersion >= 3 ? sourceSchemaVersion : 4;
  safe.analysis_scope = 'reference_content_and_creative_structure';
  safe.prohibited_reuse = ['person_identity', 'face', 'source_wardrobe_copy', 'private_attributes'];
  const transcriptStatus = String(safe.transcript?.status || '').trim();
  safe.warnings = [];
  if (safe.analysis_recovery?.strategy === 'evidence_fallback') {
    safe.warnings.push('模型整理结果未通过语义校验，已改用通过校验的画面证据结构');
  }
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
    animal_action_count: safe.animal_actions.length,
    animal_prompt_count: safe.animal_prompts.length,
    shot_breakdown_count: safe.shot_breakdown.length,
    transcript_status: transcriptStatus || 'unknown',
    visual_evidence_complete: safe.evidence_coverage?.complete === true,
    expected_evidence_frames: Number(safe.evidence_coverage?.expected_frame_count || 0),
    covered_evidence_frames: Number(safe.evidence_coverage?.covered_frame_count || 0),
    shot_segment_count: Number(safe.evidence_coverage?.shot_segment_count || 0),
    audio_evidence_complete: ['completed', 'mocked', 'no_audio'].includes(transcriptStatus),
    recovery_strategy: String(safe.analysis_recovery?.strategy || ''),
    recovered_failures: Array.isArray(safe.analysis_recovery?.failures)
      ? safe.analysis_recovery.failures.slice(0, 20)
      : [],
  };
  return safe;
}

/**
 * Recompile a completed analysis from its persisted frame evidence without
 * calling either the vision or synthesis model again. This is intentionally
 * separate from retry(): a schema migration must never charge the user for
 * evidence that was already collected successfully.
 */
async function rebuildStoredAnalysis(analysisId, user = {}) {
  const record = assertOwned(analysisId, user);
  if (activeRuns.has(analysisId) || activeImports.has(analysisId)
    || ['queued', 'running', 'importing', 'cancelling'].includes(record.status)) {
    const error = new Error('参考视频任务仍在运行，不能同时重编译已存证据。');
    error.code = 'REFERENCE_VIDEO_ANALYSIS_ACTIVE';
    error.status = 409;
    throw error;
  }
  const frames = selectEvidenceFrames(record.evidence_frames, MAX_EVIDENCE_FRAMES);
  const storedCache = record._visual_evidence_cache && typeof record._visual_evidence_cache === 'object'
    ? record._visual_evidence_cache
    : {};
  const expectedBatchCount = Math.ceil(frames.length / VISION_BATCH_SIZE);
  if (!frames.length || !Array.isArray(storedCache.batches) || storedCache.batches.length !== expectedBatchCount) {
    const error = new Error('已存逐帧证据不完整，不能进行零模型重编译。');
    error.code = 'REFERENCE_VIDEO_STORED_EVIDENCE_INCOMPLETE';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  if (!hasChineseDetail(record._synthesis_raw?.text, 20)) {
    const error = new Error('已存语义整理结果不存在，不能保证零模型重编译。');
    error.code = 'REFERENCE_VIDEO_STORED_SYNTHESIS_MISSING';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  const visualEvidence = storedCache.batches.map((item, batchIndex) => {
    const expected = frames.slice(batchIndex * VISION_BATCH_SIZE, (batchIndex + 1) * VISION_BATCH_SIZE);
    const payload = item?.payload && typeof item.payload === 'object'
      ? parseVisionEvidencePayload(JSON.stringify(item.payload), expected)
      : parseVisionEvidencePayload(item?.raw_text || item?.text || '', expected);
    return {
      ...item,
      contract_version: EVIDENCE_CONTRACT_VERSION,
      batch_index: batchIndex + 1,
      timestamps: expected.map(frame => Number(frame.timestamp_seconds || 0)),
      frame_ids: expected.map(frame => frame.frame_id),
      text: renderVisionEvidencePayload(payload).slice(0, 24000),
      payload,
      coverage: { expected: expected.length, received: payload.frames.length, complete: true },
      migrated_from_contract: item?.contract_version || storedCache.contract_version || 'legacy',
    };
  });
  const transcript = record.transcript || { status: 'provider_not_configured', text: '', segments: [] };
  const synthesized = await synthesizeAnalysisFromEvidence({ ...record, _reuse_synthesis_raw: true }, visualEvidence, transcript);
  synthesized.generated_brief = buildChineseBrief(synthesized);
  const expectedFrameIds = frames.map(frame => frame.frame_id);
  const coveredFrameIds = visualEvidence.flatMap(item => item.payload.frames.map(frame => frame.frame_id));
  const result = normalizeResult({
    schema_version: 5,
    analysis_scope: 'reference_content_and_creative_structure',
    prohibited_reuse: ['person_identity', 'face', 'source_wardrobe_copy', 'private_attributes'],
    ...synthesized,
    evidence_coverage: {
      contract_version: EVIDENCE_CONTRACT_VERSION,
      complete: expectedFrameIds.length > 0
        && expectedFrameIds.every(id => coveredFrameIds.includes(id))
        && coveredFrameIds.length === expectedFrameIds.length,
      expected_frame_count: expectedFrameIds.length,
      covered_frame_count: coveredFrameIds.length,
      expected_frame_ids: expectedFrameIds,
      covered_frame_ids: coveredFrameIds,
      shot_segment_count: new Set(frames.map(item => item.shot_index)).size,
    },
    visual_evidence_batches: visualEvidence.map(item => ({
      batch_index: item.batch_index,
      timestamps: item.timestamps,
      frame_ids: item.frame_ids,
      coverage: item.coverage,
      used_model: item.used_model,
    })),
    evidence_frames: record.evidence_frames,
    transcript,
  });
  const migratedCache = {
    ...storedCache,
    contract_version: EVIDENCE_CONTRACT_VERSION,
    key: visualEvidenceCacheKey(record, frames),
    batches: visualEvidence,
    completed_batch_indexes: visualEvidence.map((_, index) => index),
    failed_attempts: {},
    migrated_at: now(),
    migrated_from_contract: storedCache.contract_version || 'legacy',
    updated_at: now(),
  };
  const next = save(readRecord(record.user_id, record.id) || record, {
    status: 'completed',
    phase: '已复用既有镜头证据并按最新识别规则重编译',
    progress: 100,
    error: null,
    result,
    evidence_frames: record.evidence_frames,
    transcript,
    _visual_evidence_cache: migratedCache,
    _reuse_synthesis_raw: false,
    semantic_contract_migration: {
      from: storedCache.contract_version || 'legacy',
      to: EVIDENCE_CONTRACT_VERSION,
      model_calls: 0,
      migrated_at: now(),
    },
  });
  return publicRecord(next);
}

async function runAnalysis(initialRecord) {
  let record = initialRecord;
  try {
    record = checkpoint(record, '读取视频元数据', 8, { status: 'running', error: null });
    throwIfCancelled(record);
    const reuseEvidence = hasReusableVisualEvidence(record);
    let frames;
    let transcript;
    if (reuseEvidence) {
      frames = record.evidence_frames;
      transcript = record.transcript || { status: 'provider_not_configured', text: '', segments: [] };
      record = checkpoint(record, record._reuse_synthesis_raw === true
        ? '已复用画面证据与语义结果，重新校验结构'
        : '已复用画面证据，重新整理分析结构', 55, { evidence_frames: frames, transcript });
    } else {
      record = checkpoint(record, '正在检测真实镜头边界', 14);
      const transcriptPromise = transcribeAudio(record);
      const shotDetection = await detectShotBoundaries(record);
      const evidencePlan = buildShotAwareEvidencePlan(record.source.metadata.duration_seconds, shotDetection.cuts);
      record = checkpoint(record, `已规划 ${new Set(evidencePlan.map(item => item.shot_index)).size} 个镜头片段、${evidencePlan.length} 张证据帧`, 24, {
        shot_detection: shotDetection,
        evidence_plan: evidencePlan,
      });
      frames = await extractEvidenceFrames(record, evidencePlan);
      transcript = await transcriptPromise;
      record = checkpoint(record, `已提取 ${frames.length} 张镜头证据帧与语音`, 42, { evidence_frames: frames, transcript });
    }
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
  const reuseEvidence = hasReusableVisualEvidence(record);
  const reuseSynthesisRaw = canReuseSynthesisRaw(record);
  if (process.env.NEW_STORY_AD_MOCK_LLM !== '1' && !reuseEvidence) {
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
    phase: reuseSynthesisRaw
      ? '已复用画面证据与语义结果，等待重新校验'
      : (reuseEvidence ? '已复用画面证据，等待重新整理' : '已进入分析队列'),
    progress: Math.max(1, Number(record.progress || 0)),
    cancelled: false,
    error: null,
    started_at: now(),
    completed_at: '',
    failed_at: '',
    cancelled_at: '',
    _reuse_synthesis_raw: reuseSynthesisRaw,
  });
  // 先登记再进入执行微任务，避免缓存恢复路径同步完成后 finally 先 delete、随后又被 set 回活动表。
  const promise = Promise.resolve().then(() => runAnalysis(record));
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
  taskRecord,
  createUploadSession,
  saveUploadChunk,
  completeUploadSession,
  cancelUploadSession,
  start,
  get,
  cancel,
  remove,
  mapSceneViews,
  rebuildStoredAnalysis,
  _private: {
    activeRuns,
    activeImports,
    analysisDir,
    readRecord,
    mockAnalysis,
    evidenceTimes,
    normalizeShotCuts,
    shotSegments,
    buildShotAwareEvidencePlan,
    detectShotBoundaries,
    extractEvidenceFrames,
    validateUpload,
    normalizeResult,
    validateAnalysisResult,
    assertCandidateAnalysisText,
    buildChineseBrief,
    selectEvidenceFrames,
    hasReadableChinese,
    hasChineseDetail,
    refusalLike,
    frameVisionUrl,
    parseVisionEvidencePayload,
    renderVisionEvidencePayload,
    analyzeWithModels,
    transcribeAudio,
    isReusableTranscriptFailure,
    publicVisionFailure,
    hasReusableVisualEvidence,
    visualEvidenceCacheKey,
    visualEvidenceField,
    visualEvidenceFacts,
    compileAnalysisFromEvidence,
    mergeAnalysisWithEvidence,
    synthesizeAnalysisFromEvidence,
    visibleHumanCount,
    narrativeAnimalEvidence,
    characterEvidenceProfiles,
    evidenceBatchProgress,
  },
};
