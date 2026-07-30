const crypto = require('crypto');

const TERMINAL_STATES = new Set(['completed', 'cancelled']);
const SUBMISSION_STATES = new Set(['submitting', 'submitted', 'submitted_unknown']);

function now() {
  return new Date().toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function fingerprint(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function checkpointKey({ taskId = '', assetType = '', assetId = '', unit = '', revision = 1, input = {} } = {}) {
  const digest = fingerprint({ taskId, assetType, assetId, unit, revision, input }).slice(0, 24);
  return [taskId, assetType, assetId, unit, `r${revision}`, digest]
    .map(value => String(value || 'none').replace(/[^a-z0-9._-]/ig, '_').slice(0, 100))
    .join(':');
}

function normalizeCheckpoint(value = {}, identity = {}) {
  value = value && typeof value === 'object' ? value : {};
  return {
    key: String(value.key || identity.key || ''),
    task_id: String(value.task_id || identity.taskId || ''),
    asset_type: String(value.asset_type || identity.assetType || ''),
    asset_id: String(value.asset_id || identity.assetId || ''),
    unit: String(value.unit || identity.unit || ''),
    revision: Math.max(1, Number(value.revision || identity.revision || 1)),
    status: String(value.status || 'pending'),
    provider_submission_state: String(value.provider_submission_state || 'not_submitted'),
    billing_state: String(value.billing_state || 'not_submitted'),
    provider_request_id: String(value.provider_request_id || ''),
    provider_task_id: String(value.provider_task_id || ''),
    attempts: Math.max(0, Number(value.attempts || 0)),
    cache_hits: Math.max(0, Number(value.cache_hits || 0)),
    provider_result: value.provider_result || null,
    result: value.result || null,
    error: value.error || null,
    started_at: value.started_at || '',
    submitted_at: value.submitted_at || '',
    completed_at: value.completed_at || '',
    updated_at: value.updated_at || now(),
  };
}

function reusable(checkpoint = {}) {
  return checkpoint.status === 'completed' && checkpoint.result;
}

function assertRetrySafe(checkpoint = {}) {
  const state = String(checkpoint.provider_submission_state || '');
  const billing = String(checkpoint.billing_state || '');
  if (SUBMISSION_STATES.has(state) || billing === 'unknown') {
    const error = new Error('供应商提交或计费状态尚未确认，已停止自动重试，避免重复付费。');
    error.code = 'GENERATION_BILLING_STATE_UNKNOWN';
    error.status = 409;
    error.retryable = false;
    error.checkpoint = checkpoint;
    throw error;
  }
}

async function runCheckpointedUnit({
  identity = {},
  load,
  save,
  execute,
  onEvent = null,
} = {}) {
  if (typeof load !== 'function' || typeof save !== 'function' || typeof execute !== 'function') {
    throw new Error('runCheckpointedUnit requires load, save and execute functions');
  }
  const key = identity.key || checkpointKey(identity);
  let checkpoint = normalizeCheckpoint(await load(key), { ...identity, key });
  if (reusable(checkpoint)) {
    checkpoint.cache_hits += 1;
    checkpoint.updated_at = now();
    await save(key, checkpoint);
    if (onEvent) onEvent({ type: 'checkpoint_hit', key, checkpoint });
    return { result: checkpoint.result, checkpoint, reused: true };
  }
  assertRetrySafe(checkpoint);
  checkpoint = {
    ...checkpoint,
    status: 'running',
    attempts: checkpoint.attempts + 1,
    error: null,
    started_at: checkpoint.started_at || now(),
    updated_at: now(),
  };
  await save(key, checkpoint);
  if (onEvent) onEvent({ type: 'checkpoint_miss', key, checkpoint });
  const controls = {
    key,
    providerResult: checkpoint.provider_result || null,
    onSubmitting: async () => {
      checkpoint = {
        ...checkpoint,
        provider_submission_state: 'submitting',
        billing_state: 'unknown',
        updated_at: now(),
      };
      await save(key, checkpoint);
    },
    onSubmitted: async payload => {
      checkpoint = {
        ...checkpoint,
        provider_submission_state: 'submitted',
        billing_state: 'unknown',
        provider_request_id: String(payload?.providerRequestId || payload?.provider_request_id || ''),
        provider_task_id: String(payload?.taskId || payload?.provider_task_id || ''),
        submitted_at: now(),
        updated_at: now(),
      };
      await save(key, checkpoint);
    },
    onProviderResult: async result => {
      checkpoint = {
        ...checkpoint,
        status: 'provider_completed',
        provider_submission_state: 'completed',
        billing_state: 'confirmed',
        provider_result: result || null,
        completed_at: now(),
        updated_at: now(),
      };
      controls.providerResult = checkpoint.provider_result;
      await save(key, checkpoint);
    },
  };
  try {
    const result = await execute(controls);
    checkpoint = {
      ...checkpoint,
      status: 'completed',
      provider_submission_state: 'completed',
      billing_state: 'confirmed',
      result,
      error: null,
      completed_at: now(),
      updated_at: now(),
    };
    await save(key, checkpoint);
    if (onEvent) onEvent({ type: 'checkpoint_completed', key, checkpoint });
    return { result, checkpoint, reused: false };
  } catch (error) {
    const providerCompleted = Boolean(checkpoint.provider_result)
      && checkpoint.provider_submission_state === 'completed'
      && checkpoint.billing_state === 'confirmed';
    const billingUnknown = !providerCompleted && (error?.billingState === 'unknown'
      || error?.billing_state === 'unknown'
      || SUBMISSION_STATES.has(checkpoint.provider_submission_state));
    checkpoint = {
      ...checkpoint,
      status: billingUnknown ? 'submitted_unknown' : 'failed',
      provider_submission_state: providerCompleted
        ? 'completed'
        : billingUnknown
          ? 'submitted_unknown'
          : String(error?.providerSubmissionState || error?.provider_submission_state || 'not_submitted'),
      billing_state: providerCompleted
        ? 'confirmed'
        : billingUnknown
          ? 'unknown'
          : String(error?.billingState || error?.billing_state || 'not_billed'),
      provider_request_id: String(error?.providerRequestId || error?.provider_request_id || checkpoint.provider_request_id || ''),
      provider_task_id: String(error?.providerTaskId || error?.provider_task_id || checkpoint.provider_task_id || ''),
      error: {
        code: String(error?.code || 'GENERATION_UNIT_FAILED'),
        message: String(error?.message || error).slice(0, 500),
      },
      updated_at: now(),
    };
    await save(key, checkpoint);
    error.checkpoint = checkpoint;
    throw error;
  }
}

module.exports = {
  TERMINAL_STATES,
  SUBMISSION_STATES,
  fingerprint,
  checkpointKey,
  normalizeCheckpoint,
  reusable,
  assertRetrySafe,
  runCheckpointedUnit,
};
