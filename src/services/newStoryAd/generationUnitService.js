'use strict';

const crypto = require('crypto');
const defaultStorage = require('./storageService');

const GENERATION_UNIT_CONTRACT_VERSION = 1;
const STATES = Object.freeze([
  'draft', 'ready', 'queued', 'submitted', 'running', 'succeeded',
  'failed_retryable', 'failed_terminal', 'cancelled', 'superseded', 'billing_unknown',
]);
const TERMINAL_STATES = new Set(['succeeded', 'failed_terminal', 'cancelled', 'superseded', 'billing_unknown']);
const ACTIVE_STATES = new Set(['ready', 'queued', 'submitted', 'running']);
const TRANSITIONS = Object.freeze({
  draft: ['ready', 'cancelled'],
  ready: ['queued', 'cancelled', 'superseded'],
  queued: ['submitted', 'running', 'failed_retryable', 'failed_terminal', 'cancelled', 'superseded'],
  submitted: ['running', 'succeeded', 'failed_retryable', 'failed_terminal', 'billing_unknown', 'cancelled', 'superseded'],
  running: ['succeeded', 'failed_retryable', 'failed_terminal', 'billing_unknown', 'cancelled', 'superseded'],
  failed_retryable: ['ready', 'queued', 'failed_terminal', 'cancelled', 'superseded'],
  failed_terminal: ['superseded'],
  cancelled: ['ready', 'superseded'],
  succeeded: ['superseded'],
  billing_unknown: ['succeeded', 'failed_terminal', 'superseded'],
  superseded: [],
});

function clean(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function fail(message, code, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.retryable = false;
  Object.assign(error, details);
  return error;
}

function normalizedIdentity(input = {}) {
  const identity = {
    work_id: clean(input.workId ?? input.work_id, 160),
    domain: clean(input.domain, 60).toLowerCase(),
    target_permanent_id: clean(input.targetPermanentId ?? input.target_permanent_id, 200),
    operation: clean(input.operation, 80).toLowerCase(),
    input_fingerprint: clean(input.inputFingerprint ?? input.input_fingerprint, 160),
    spec_revision: Math.max(1, Number(input.specRevision ?? input.spec_revision) || 1),
    provider_id: clean(input.providerId ?? input.provider_id, 100).toLowerCase(),
    model_id: clean(input.modelId ?? input.model_id, 180).toLowerCase(),
    authority_id: clean(input.authorityId ?? input.authority_id, 160),
    execution_identity: clean(input.executionIdentity ?? input.execution_identity, 160),
  };
  const missing = Object.entries(identity)
    .filter(([key, value]) => !['model_id', 'authority_id', 'execution_identity'].includes(key) && !value)
    .map(([key]) => key);
  if (missing.length) {
    throw fail(`生成单元幂等身份不完整：${missing.join(', ')}`, 'GENERATION_UNIT_IDENTITY_REQUIRED', 422, { missing });
  }
  return identity;
}

function buildIdempotencyKey(input = {}) {
  const identity = normalizedIdentity(input);
  return sha256(JSON.stringify(stable(identity)));
}

function unitId(idempotencyKey) {
  return `gu_${clean(idempotencyKey, 64).slice(0, 32)}`;
}

function findByIdempotency(storage, key) {
  return storage.listGenerationRuns().find(unit => unit.idempotency_key === key) || null;
}

function targetUnits(storage, identity) {
  return storage.listGenerationRuns({ work_id: identity.work_id, target_permanent_id: identity.target_permanent_id })
    .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')));
}

function createExplicitRetry(storage, identity, baseKey, blocker, at) {
  const siblings = targetUnits(storage, identity)
    .filter(unit => String(unit.explicit_user_retry_of || '') === String(blocker.id));
  const retryOrdinal = siblings.length + 1;
  const key = sha256(`${baseKey}:explicit_user_retry:${blocker.id}:${retryOrdinal}`);
  const id = unitId(key);
  const created = storage.createGenerationRun({
    id,
    ...identity,
    task_id: identity.work_id,
    idempotency_key: key,
    contract_version: GENERATION_UNIT_CONTRACT_VERSION,
    state: 'ready',
    unit_version: 1,
    provider_submission_state: 'not_submitted',
    billing_state: 'not_submitted',
    retry_blocked: false,
    automatic_retry_allowed: false,
    provider_task_id: '',
    error_code: '',
    error_message: '',
    explicit_user_retry: true,
    explicit_user_retry_of: blocker.id,
    explicit_user_retry_ordinal: retryOrdinal,
    prior_billing_state: blocker.billing_state || '',
    state_history: [{ from: '', to: 'ready', reason: 'explicit_user_retry_after_terminal_unknown', at }],
  });
  return { claimed: true, duplicate: false, restarted: false, reusable: false, blocked: false, unit: created };
}

function claim(input = {}, {
  storage = defaultStorage,
  at = new Date().toISOString(),
  explicit_user_retry = false,
} = {}) {
  const identity = normalizedIdentity(input);
  const key = buildIdempotencyKey(identity);
  const existing = findByIdempotency(storage, key);
  const unitsForTarget = targetUnits(storage, identity);
  const activeBlocker = unitsForTarget.find(unit => ACTIVE_STATES.has(unit.state) && unit.idempotency_key !== key) || null;
  if (activeBlocker) {
    throw fail('同一生成目标已有活动生成单元，禁止并发覆盖', 'GENERATION_TARGET_ACTIVE', 409, {
      blocking_unit_id: activeBlocker.id,
      billing_state: activeBlocker.billing_state || '',
    });
  }
  if (existing) {
    if (existing.execution_disabled === true || existing.cache_readonly === true) {
      throw fail('历史生成单元只允许查看，禁止重试或继续执行', 'GENERATION_UNIT_EXECUTION_DISABLED');
    }
    const safelyRestartable = explicit_user_retry === true
      && ['cancelled', 'failed_retryable'].includes(existing.state)
      && ['not_submitted', 'not_billed'].includes(existing.billing_state)
      && !existing.provider_task_id;
    if (safelyRestartable) {
      const restarted = transition(existing.id, 'ready', {
        billing_state: existing.billing_state,
        provider_submission_state: 'not_submitted',
        retry_blocked: false,
        error_code: '',
        error_message: '',
      }, {
        storage,
        expected_version: existing.unit_version,
        at,
        reason: 'explicit_user_retry_before_provider_submission',
      });
      return { claimed: true, duplicate: false, restarted: true, reusable: false, blocked: false, unit: restarted };
    }
    if (existing.state === 'billing_unknown' && explicit_user_retry === true) {
      return createExplicitRetry(storage, identity, key, existing, at);
    }
    return {
      claimed: false,
      duplicate: true,
      reusable: existing.state === 'succeeded',
      blocked: existing.state === 'billing_unknown',
      unit: existing,
    };
  }
  const blocker = unitsForTarget.find(unit => unit.state === 'billing_unknown') || null;
  if (blocker) {
    if (explicit_user_retry === true) return createExplicitRetry(storage, identity, key, blocker, at);
    throw fail('该生成记录需要后台核对', 'GENERATION_BILLING_REVIEW_REQUIRED', 409, {
      blocking_unit_id: blocker.id,
      billing_state: blocker.billing_state || '',
    });
  }
  const id = unitId(key);
  const created = storage.createGenerationRun({
    id,
    ...identity,
    task_id: identity.work_id,
    idempotency_key: key,
    contract_version: GENERATION_UNIT_CONTRACT_VERSION,
    state: 'ready',
    unit_version: 1,
    provider_submission_state: 'not_submitted',
    billing_state: 'not_submitted',
    retry_blocked: false,
    automatic_retry_allowed: false,
    provider_task_id: '',
    error_code: '',
    error_message: '',
    state_history: [{ from: '', to: 'ready', reason: 'claim', at }],
  });
  return { claimed: true, duplicate: false, reusable: false, blocked: false, unit: created };
}

function assertBillingInvariant(current, nextState, patch = {}, options = {}) {
  const billing = clean(patch.billing_state ?? current.billing_state, 40).toLowerCase() || 'not_submitted';
  const submission = clean(patch.provider_submission_state ?? current.provider_submission_state, 60).toLowerCase() || 'not_submitted';
  if (billing === 'unknown' && nextState !== 'billing_unknown') {
    throw fail('计费未知必须进入 billing_unknown 锁定态', 'GENERATION_BILLING_UNKNOWN_STATE_REQUIRED');
  }
  if (nextState === 'billing_unknown' && billing !== 'unknown') {
    throw fail('billing_unknown 状态必须明确记录 billing_state=unknown', 'GENERATION_BILLING_UNKNOWN_REQUIRED');
  }
  if (['submitted', 'running'].includes(nextState) && submission === 'not_submitted') {
    throw fail('供应商已执行状态不能标记为未提交', 'GENERATION_SUBMISSION_STATE_INVALID');
  }
  if (current.state === 'billing_unknown' && !options.manual_reconciliation) {
    throw fail('计费未知只能通过人工核账转换状态', 'GENERATION_BILLING_RECONCILIATION_REQUIRED');
  }
  if (nextState === 'succeeded' && !['confirmed', 'not_submitted'].includes(billing)) {
    throw fail('成功生成单元的计费状态必须已确认', 'GENERATION_SUCCESS_BILLING_UNCONFIRMED');
  }
  return { billing, submission };
}

function transition(id, nextState, patch = {}, options = {}) {
  const storage = options.storage || defaultStorage;
  const current = storage.getGenerationRun(id);
  if (!current) throw fail(`Generation unit ${id} 不存在`, 'GENERATION_UNIT_NOT_FOUND', 404);
  if ((current.execution_disabled === true || current.cache_readonly === true) && nextState !== 'superseded') {
    throw fail('历史生成单元只允许查看，禁止改变执行状态', 'GENERATION_UNIT_EXECUTION_DISABLED');
  }
  const wanted = clean(nextState, 40).toLowerCase();
  if (!STATES.includes(wanted)) throw fail(`未知生成状态 ${wanted}`, 'GENERATION_STATE_INVALID', 422);
  if (wanted === current.state) return current;
  if (!(TRANSITIONS[current.state] || []).includes(wanted)) {
    throw fail(`生成状态不能从 ${current.state} 转换到 ${wanted}`, 'GENERATION_STATE_TRANSITION_INVALID');
  }
  const normalized = assertBillingInvariant(current, wanted, patch, options);
  const at = clean(options.at || new Date().toISOString(), 40);
  const reason = clean(options.reason || patch.reason || '', 200);
  const nextVersion = Number(current.unit_version || 0) + 1;
  const next = {
    ...patch,
    state: wanted,
    unit_version: nextVersion,
    billing_state: normalized.billing,
    provider_submission_state: normalized.submission,
    retry_blocked: wanted === 'billing_unknown' || patch.retry_blocked === true,
    automatic_retry_allowed: false,
    state_history: [...(Array.isArray(current.state_history) ? current.state_history : []), {
      from: current.state, to: wanted, reason, at,
    }],
  };
  return storage.updateGenerationRun(id, next, {
    expected_version: options.expected_version ?? current.unit_version,
  });
}

function reconcileBilling(id, resolution = {}, options = {}) {
  const storage = options.storage || defaultStorage;
  const current = storage.getGenerationRun(id);
  if (!current || current.state !== 'billing_unknown') {
    throw fail('只有 billing_unknown 生成单元允许人工核账', 'GENERATION_BILLING_RECONCILIATION_NOT_APPLICABLE');
  }
  const outcome = clean(resolution.outcome, 40).toLowerCase();
  if (!['succeeded', 'failed_terminal'].includes(outcome)) {
    throw fail('人工核账结论必须是 succeeded 或 failed_terminal', 'GENERATION_BILLING_RECONCILIATION_OUTCOME_REQUIRED', 422);
  }
  const billingState = clean(resolution.billing_state, 40).toLowerCase();
  if (!['confirmed', 'not_billed'].includes(billingState)) {
    throw fail('人工核账必须明确 confirmed 或 not_billed', 'GENERATION_BILLING_RECONCILIATION_STATE_REQUIRED', 422);
  }
  return transition(id, outcome, {
    billing_state: billingState,
    reconciliation: {
      reviewer: clean(resolution.reviewer, 120),
      evidence: clean(resolution.evidence, 500),
      reconciled_at: clean(options.at || new Date().toISOString(), 40),
    },
  }, { ...options, storage, manual_reconciliation: true, reason: 'manual_billing_reconciliation' });
}

function assertAutomaticRetryAllowed(unit = {}) {
  if (unit.billing_state === 'unknown' || unit.state === 'billing_unknown') {
    throw fail('计费未知禁止自动重试', 'GENERATION_BILLING_REVIEW_REQUIRED');
  }
  if (unit.automatic_retry_allowed !== true) {
    throw fail('当前生产策略禁止自动付费重试', 'GENERATION_AUTOMATIC_RETRY_DISABLED');
  }
  return true;
}

module.exports = {
  GENERATION_UNIT_CONTRACT_VERSION,
  STATES,
  TERMINAL_STATES,
  ACTIVE_STATES,
  TRANSITIONS,
  buildIdempotencyKey,
  claim,
  transition,
  reconcileBilling,
  assertAutomaticRetryAllowed,
};
