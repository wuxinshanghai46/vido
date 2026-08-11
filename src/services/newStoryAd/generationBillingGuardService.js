const crypto = require('crypto');

const generationConcurrency = require('./generationConcurrencyService');

const guards = new Map();
const GUARD_TTL_MS = 60 * 60 * 1000;

function clean(value = '', max = 160) {
  return String(value || '').trim().slice(0, max);
}

function scopeKey({ taskId = '', generationId = '', unitKey = '' } = {}) {
  const task = clean(taskId, 120) || 'detached';
  const generation = clean(generationId, 120) || task;
  const unit = clean(unitKey, 240) || generation;
  return `${task}:${generation}:${crypto.createHash('sha256').update(unit).digest('hex').slice(0, 20)}`;
}

function poolName(scope = '') {
  return `new_story_ad.image_task.${crypto.createHash('sha256').update(scope).digest('hex').slice(0, 16)}`;
}

function isAmbiguousProviderFailure(error = null) {
  const status = Number(error?.response?.status
    || error?.providerPayload?.status
    || error?.providerPayload?.code
    || error?.response?.data?.status
    || error?.response?.data?.code
    || 0);
  return error?.billingState === 'unknown'
    || error?.billing_state === 'unknown'
    || error?.code === 'PROVIDER_5XX_AMBIGUOUS'
    || (status >= 500 && status < 600);
}

function prune() {
  const cutoff = Date.now() - GUARD_TTL_MS;
  for (const [key, value] of guards.entries()) {
    if (Number(value.updated_at || 0) < cutoff) guards.delete(key);
  }
}

function stoppedError(state = {}) {
  const error = new Error('同一任务已有图片请求出现供应商计费状态未知；本单元尚未提交，已停止后续调用，避免扩大重复计费风险。');
  error.code = 'GENERATION_STOPPED_AFTER_BILLING_UNKNOWN';
  error.status = 409;
  error.retryable = false;
  error.terminal = true;
  error.providerSubmissionState = 'not_submitted';
  error.billingState = 'not_submitted';
  error.stopped_before_submission = true;
  error.blocking_error_code = clean(state.error_code, 120);
  return error;
}

async function run({ taskId = '', generationId = '', unitKey = '' } = {}, invoke) {
  if (typeof invoke !== 'function') throw new Error('generation billing guard requires an invoke function');
  prune();
  const scope = scopeKey({ taskId, generationId, unitKey });
  return generationConcurrency.schedule(poolName(scope), 1, async () => {
    const current = guards.get(scope);
    if (current?.tripped) throw stoppedError(current);
    try {
      return await invoke();
    } catch (error) {
      if (isAmbiguousProviderFailure(error)) {
        guards.set(scope, {
          tripped: true,
          error_code: clean(error?.code || 'PROVIDER_5XX_AMBIGUOUS', 120),
          updated_at: Date.now(),
        });
      }
      throw error;
    }
  });
}

function snapshot() {
  prune();
  return [...guards.entries()].map(([scope, value]) => ({ scope, ...value }));
}

function resetForTests() {
  guards.clear();
}

module.exports = { isAmbiguousProviderFailure, run, scopeKey, snapshot, resetForTests };
