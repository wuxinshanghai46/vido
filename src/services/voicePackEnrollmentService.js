const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STAGE = 'voice.enrollment';
const inFlight = new Map();

function requiredUserId(value = '') {
  const userId = String(value || '').trim();
  if (!userId) {
    const error = new Error('必须登录后才能使用授权音色');
    error.code = 'VOICE_ACCOUNT_REQUIRED';
    error.status = 401;
    throw error;
  }
  return userId;
}

function deterministicVoiceId(userId, voicePackId) {
  const digest = crypto.createHash('sha256').update(`${userId}\n${voicePackId}`).digest('hex').slice(0, 18);
  return `custom_vp_${digest}`;
}

function publicBaseUrl(value = '') {
  const base = String(value || process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(base)) {
    const error = new Error('服务器没有配置可供声音供应商读取的 PUBLIC_BASE_URL');
    error.code = 'VOICE_PUBLIC_BASE_URL_REQUIRED';
    error.status = 503;
    throw error;
  }
  return base;
}

function uncertainProviderOutcome(error) {
  return /timeout|timed out|超时|socket|econnreset|econnaborted|hang up|network|连接中断/i.test(String(error?.message || error || ''));
}

function dependencies(overrides = {}) {
  return {
    db: overrides.db || require('../models/database'),
    voicePacks: overrides.voicePacks || require('./voicePackService'),
    aliyun: overrides.aliyun || require('./aliyunVoiceService'),
    pipelineModels: overrides.pipelineModels || require('./pipelineModelService'),
    tracker: overrides.tracker || require('./tokenTracker'),
    voicesDir: path.resolve(overrides.voicesDir || path.join(__dirname, '../../outputs/voices')),
    publicAssetsDir: path.resolve(overrides.publicAssetsDir || path.join(__dirname, '../../outputs/jimeng-assets')),
  };
}

function findAccountVoice(db, userId, voicePackId) {
  return (db.listVoices(userId) || []).find(row => (
    String(row.user_id || '') === userId
    && String(row.source_voice_pack_id || '') === voicePackId
  )) || null;
}

function assertExistingState(existing) {
  if (!existing) return null;
  if (existing.aliyun_voice_id && existing.status === 'ready') {
    return { voice_id: existing.id, provider_voice_id: existing.aliyun_voice_id, status: 'ready', reused: true };
  }
  if (existing.status === 'enrollment_uncertain') {
    const error = new Error('该音色上次注册时供应商结果不确定，系统已停止重复提交以避免重复计费；请等待后台自动核对');
    error.code = 'VOICE_ENROLLMENT_UNCERTAIN';
    error.status = 409;
    error.retryable = false;
    throw error;
  }
  if (existing.status === 'submitting') {
    const error = new Error('该音色正在由系统注册，已阻止再次提交以避免重复计费');
    error.code = 'VOICE_ENROLLMENT_IN_PROGRESS';
    error.status = 409;
    error.retryable = true;
    throw error;
  }
  return null;
}

async function performEnrollment(input, deps) {
  const { userId, voicePackId, requestBaseUrl } = input;
  const resolved = deps.voicePacks.resolveVoicePackAudio(voicePackId);
  if (!resolved) {
    const error = new Error('授权音色不存在');
    error.code = 'VOICE_PACK_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  if (resolved.voice.rights_status !== 'user_confirmed_licensed') {
    const error = new Error('该声音没有有效授权标记');
    error.code = 'VOICE_PACK_RIGHTS_REQUIRED';
    error.status = 403;
    throw error;
  }
  if (!resolved.voice.clonable) {
    const error = new Error('该样本不满足供应商声音注册条件，只能直接试听或作为原音使用');
    error.code = 'VOICE_PACK_NOT_CLONABLE';
    error.status = 422;
    throw error;
  }

  let existing = findAccountVoice(deps.db, userId, voicePackId);
  const ready = assertExistingState(existing);
  if (ready) return { ...ready, name: resolved.voice.name };

  const route = deps.pipelineModels.pickModelWithDefault(STAGE);
  if (!route || route.provider_id !== 'aliyun-tts') {
    const error = new Error('模型调用管理中没有启用可用的授权音色注册模型');
    error.code = 'VOICE_ENROLLMENT_MODEL_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
  if (!deps.aliyun.hasKey()) {
    const error = new Error('模型调用管理所选阿里 CosyVoice 注册服务尚未配置可用密钥');
    error.code = 'VOICE_ENROLLMENT_PROVIDER_NOT_READY';
    error.status = 503;
    throw error;
  }

  const voiceId = existing?.id || deterministicVoiceId(userId, voicePackId);
  fs.mkdirSync(deps.voicesDir, { recursive: true });
  fs.mkdirSync(deps.publicAssetsDir, { recursive: true });
  const filename = `voice_${voiceId}.mp3`;
  const localPath = path.join(deps.voicesDir, filename);
  const publicName = `vc_${voiceId}.mp3`;
  fs.copyFileSync(resolved.file, localPath);
  fs.copyFileSync(resolved.file, path.join(deps.publicAssetsDir, publicName));

  const submitting = {
    name: resolved.voice.name,
    gender: resolved.voice.gender === 'neutral' ? 'female' : (resolved.voice.gender || 'female'),
    filename,
    file_path: localPath,
    user_id: userId,
    source_voice_pack_id: voicePackId,
    source_rights_status: resolved.voice.rights_status,
    clone_provider: route.provider_id,
    enrollment_stage: STAGE,
    enrollment_model_id: route.model_id,
    status: 'submitting',
    enrollment_started_at: new Date().toISOString(),
    last_error: null,
  };
  if (existing) deps.db.updateVoice(existing.id, submitting);
  else deps.db.insertVoice({ id: voiceId, ...submitting });

  const startedAt = Date.now();
  try {
    const audioUrl = `${publicBaseUrl(requestBaseUrl)}/public/jimeng-assets/${encodeURIComponent(publicName)}`;
    const enroll = await deps.aliyun.enrollVoice(audioUrl, {
      voicePrefix: `vido${crypto.createHash('sha1').update(userId).digest('hex').slice(0, 8)}`,
      languageHint: 'zh',
      targetModel: route.model_id,
    });
    deps.db.updateVoice(voiceId, {
      aliyun_voice_id: enroll.voice_id,
      aliyun_task_id: enroll.task_id || enroll.voice_id,
      aliyun_target_model: enroll.target_model || route.model_id,
      status: 'ready',
      enrollment_completed_at: new Date().toISOString(),
      last_error: null,
    });
    deps.tracker.record({
      provider: route.provider_id, model: route.model_id, category: 'tts', operation: 'voice_enrollment',
      status: 'success', billingState: 'confirmed', durationMs: Date.now() - startedAt,
      userId, agentId: STAGE, requestId: enroll.request_id || enroll.voice_id,
    });
    return { voice_id: voiceId, provider_voice_id: enroll.voice_id, status: 'ready', reused: false, name: resolved.voice.name };
  } catch (error) {
    const uncertain = uncertainProviderOutcome(error);
    deps.db.updateVoice(voiceId, {
      status: uncertain ? 'enrollment_uncertain' : 'aliyun_failed',
      last_error: String(error.message || error).slice(0, 500),
      enrollment_failed_at: new Date().toISOString(),
    });
    deps.tracker.record({
      provider: route.provider_id, model: route.model_id, category: 'tts', operation: 'voice_enrollment',
      status: 'fail', billingState: uncertain ? 'unknown' : 'not_submitted', durationMs: Date.now() - startedAt,
      userId, agentId: STAGE, errorMsg: String(error.message || error).slice(0, 500),
    });
    throw error;
  }
}

async function ensureRegisteredVoicePack(input = {}, overrides = {}) {
  const userId = requiredUserId(input.userId);
  const voicePackId = String(input.voicePackId || input.voice_id || '').trim();
  if (!/^vp_[a-f0-9]{16,64}$/i.test(voicePackId)) {
    const error = new Error('授权音色 ID 无效');
    error.code = 'VOICE_PACK_ID_INVALID';
    error.status = 400;
    throw error;
  }
  const deps = dependencies(overrides);
  const key = `${userId}:${voicePackId}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const existing = findAccountVoice(deps.db, userId, voicePackId);
  const ready = assertExistingState(existing);
  if (ready) return ready;
  const promise = performEnrollment({ ...input, userId, voicePackId }, deps)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function resolveVoiceForAccount(voiceId = '', options = {}, overrides = {}) {
  const id = String(voiceId || '').trim();
  if (/^vp_[a-f0-9]{16,64}$/i.test(id)) {
    const registered = await ensureRegisteredVoicePack({
      userId: options.userId,
      voicePackId: id,
      requestBaseUrl: options.requestBaseUrl,
    }, overrides);
    return registered.voice_id;
  }
  if (/^custom[_:]/i.test(id) && options.userId) {
    const deps = dependencies(overrides);
    const row = deps.db.getVoice(id);
    if (!row || String(row.user_id || '') !== requiredUserId(options.userId)) {
      const error = new Error('所选声音不属于当前账号');
      error.code = 'VOICE_ACCOUNT_MISMATCH';
      error.status = 403;
      throw error;
    }
  }
  return id;
}

module.exports = {
  STAGE,
  deterministicVoiceId,
  ensureRegisteredVoicePack,
  resolveVoiceForAccount,
  uncertainProviderOutcome,
};
