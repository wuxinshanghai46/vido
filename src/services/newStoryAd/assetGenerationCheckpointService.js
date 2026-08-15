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
    retry_authorization: value.retry_authorization && typeof value.retry_authorization === 'object'
      ? { ...value.retry_authorization }
      : null,
    billing_review: value.billing_review && typeof value.billing_review === 'object'
      ? {
          id: String(value.billing_review.id || ''),
          state: String(value.billing_review.state || 'pending'),
          revision: Math.max(1, Number(value.billing_review.revision || 1) || 1),
          reviewer: String(value.billing_review.reviewer || '').slice(0, 120),
          evidence: String(value.billing_review.evidence || '').slice(0, 1000),
          resolved_at: String(value.billing_review.resolved_at || '').slice(0, 40),
        }
      : null,
    attempt_history: Array.isArray(value.attempt_history) ? value.attempt_history.slice(-20) : [],
    started_at: value.started_at || '',
    submitted_at: value.submitted_at || '',
    completed_at: value.completed_at || '',
    updated_at: value.updated_at || now(),
  };
}

function reusable(checkpoint = {}) {
  return checkpoint.status === 'completed' && checkpoint.result;
}

function hasAmbiguousSubmission(checkpoint = {}) {
  return SUBMISSION_STATES.has(String(checkpoint.provider_submission_state || ''))
    || String(checkpoint.billing_state || '') === 'unknown';
}

function hasRetryAuthorization(checkpoint = {}) {
  const authorization = checkpoint.retry_authorization || {};
  return authorization.accept_duplicate_charge_risk === true
    && Number(authorization.remaining_uses || 0) > 0
    && String(authorization.checkpoint_key || '') === String(checkpoint.key || '');
}

function assertRetrySafe(checkpoint = {}) {
  if (hasAmbiguousSubmission(checkpoint) && !hasRetryAuthorization(checkpoint)) {
    const error = new Error('供应商提交或计费状态尚未确认，已停止自动重试，避免重复付费。');
    error.code = 'GENERATION_BILLING_STATE_UNKNOWN';
    error.status = 409;
    error.retryable = false;
    error.checkpoint = checkpoint;
    throw error;
  }
}

function authorizeAmbiguousRetry(value = {}, authorization = {}) {
  const checkpoint = normalizeCheckpoint(value);
  if (!hasAmbiguousSubmission(checkpoint)) {
    const error = new Error('当前生成单元不存在计费未知状态，不需要重复计费风险授权。');
    error.code = 'GENERATION_RETRY_AUTHORIZATION_NOT_REQUIRED';
    error.status = 409;
    error.retryable = false;
    throw error;
  }
  if (authorization.acceptDuplicateChargeRisk !== true && authorization.accept_duplicate_charge_risk !== true) {
    const error = new Error('必须明确接受该生成单元可能重复计费，才能创建一次性重试授权。');
    error.code = 'GENERATION_DUPLICATE_CHARGE_ACCEPTANCE_REQUIRED';
    error.status = 400;
    error.retryable = false;
    throw error;
  }
  return {
    ...checkpoint,
    retry_authorization: {
      id: String(authorization.id || crypto.randomUUID()),
      checkpoint_key: checkpoint.key,
      accept_duplicate_charge_risk: true,
      accepted_by: String(authorization.acceptedBy || authorization.accepted_by || '').slice(0, 120),
      support_id: String(authorization.supportId || authorization.support_id || '').slice(0, 120),
      reason: String(authorization.reason || 'user_explicit_acceptance').slice(0, 240),
      remaining_uses: 1,
      accepted_at: now(),
      consumed_at: '',
    },
    updated_at: now(),
  };
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
  if (hasAmbiguousSubmission(checkpoint) && hasRetryAuthorization(checkpoint)) {
    const priorAttempt = {
      status: checkpoint.status,
      provider_submission_state: checkpoint.provider_submission_state,
      billing_state: checkpoint.billing_state,
      provider_request_id: checkpoint.provider_request_id,
      provider_task_id: checkpoint.provider_task_id,
      error: checkpoint.error,
      archived_at: now(),
    };
    checkpoint = {
      ...checkpoint,
      status: 'pending',
      provider_submission_state: 'not_submitted',
      billing_state: 'not_submitted',
      provider_request_id: '',
      provider_task_id: '',
      provider_result: null,
      result: null,
      error: null,
      attempt_history: [...checkpoint.attempt_history, priorAttempt].slice(-20),
      retry_authorization: {
        ...checkpoint.retry_authorization,
        remaining_uses: 0,
        consumed_at: now(),
      },
      updated_at: now(),
    };
    await save(key, checkpoint);
    if (onEvent) onEvent({ type: 'checkpoint_retry_authorized', key, checkpoint });
  }
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
      const rejected = ['rejected', 'submission_rejected', 'not_billed'].includes(String(payload?.status || payload?.provider_submission_state || '').toLowerCase())
        || String(payload?.billing_state || payload?.billingState || '').toLowerCase() === 'not_billed';
      checkpoint = {
        ...checkpoint,
        status: rejected ? 'failed' : checkpoint.status,
        provider_submission_state: rejected ? 'not_submitted' : 'submitted',
        billing_state: rejected ? 'not_billed' : 'unknown',
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
    const explicitlyNotBilled = checkpoint.billing_state === 'not_billed'
      || String(error?.billingState || error?.billing_state || '').toLowerCase() === 'not_billed'
      || ['rejected', 'submission_rejected', 'not_submitted'].includes(String(error?.providerSubmissionState || error?.provider_submission_state || '').toLowerCase());
    const billingUnknown = !providerCompleted && !explicitlyNotBilled && (error?.billingState === 'unknown'
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
  hasAmbiguousSubmission,
  hasRetryAuthorization,
  assertRetrySafe,
  authorizeAmbiguousRetry,
  runCheckpointedUnit,
};
