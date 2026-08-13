'use strict';

const crypto = require('crypto');
const defaultStorage = require('./storageService');

const CIRCUIT_CONTRACT_VERSION = 1;

function clean(value, max = 160) {
  return String(value ?? '').trim().slice(0, max).toLowerCase();
}

function keyFor(providerId, failureClass) {
  const provider = clean(providerId, 100);
  const failure = clean(failureClass, 100);
  if (!provider || !failure) {
    const error = new Error('熔断器需要 provider_id 和 failure_class');
    error.code = 'PROVIDER_CIRCUIT_SCOPE_REQUIRED';
    error.status = 422;
    throw error;
  }
  return `pc_${crypto.createHash('sha256').update(`${provider}|${failure}`).digest('hex').slice(0, 28)}`;
}

function recordFailure(input = {}, options = {}) {
  const storage = options.storage || defaultStorage;
  const providerId = clean(input.providerId ?? input.provider_id, 100);
  const failureClass = clean(input.failureClass ?? input.failure_class, 100);
  const id = keyFor(providerId, failureClass);
  const current = storage.getProviderCircuit(id) || {};
  const threshold = Math.max(1, Number(options.threshold || input.threshold) || 3);
  const cooldownMs = Math.max(1000, Number(options.cooldown_ms || input.cooldown_ms) || 60_000);
  const nowMs = Number(options.now_ms ?? Date.now());
  const previous = Number(current.last_failure_at_ms || 0);
  const windowMs = Math.max(cooldownMs, Number(options.window_ms || input.window_ms) || 300_000);
  const failureCount = previous && nowMs - previous <= windowMs ? Number(current.failure_count || 0) + 1 : 1;
  const opened = failureCount >= threshold;
  return storage.saveProviderCircuit(id, {
    id,
    contract_version: CIRCUIT_CONTRACT_VERSION,
    provider_id: providerId,
    failure_class: failureClass,
    state: opened ? 'open' : 'closed',
    failure_count: failureCount,
    threshold,
    cooldown_ms: cooldownMs,
    last_failure_at_ms: nowMs,
    opened_at_ms: opened ? (Number(current.opened_at_ms || 0) || nowMs) : 0,
    retry_after_ms: opened ? nowMs + cooldownMs : 0,
    last_error_code: clean(input.errorCode ?? input.error_code, 120),
  });
}

function inspect(providerId, failureClass, options = {}) {
  const storage = options.storage || defaultStorage;
  const id = keyFor(providerId, failureClass);
  const current = storage.getProviderCircuit(id);
  if (!current) return { id, state: 'closed', available: true, probe: false, failure_count: 0 };
  const nowMs = Number(options.now_ms ?? Date.now());
  if (current.state === 'open' && nowMs >= Number(current.retry_after_ms || 0)) {
    return { ...current, state: 'half_open', available: true, probe: true };
  }
  return { ...current, available: current.state !== 'open', probe: false };
}

function assertAvailable(providerId, failureClass, options = {}) {
  const snapshot = inspect(providerId, failureClass, options);
  if (snapshot.available) return snapshot;
  const error = new Error(`供应商 ${clean(providerId, 100)} 的 ${clean(failureClass, 100)} 故障熔断中`);
  error.code = 'PROVIDER_CIRCUIT_OPEN';
  error.status = 503;
  error.retryable = true;
  error.retry_after_ms = Number(snapshot.retry_after_ms || 0);
  throw error;
}

function recordSuccess(providerId, failureClass, options = {}) {
  const storage = options.storage || defaultStorage;
  const id = keyFor(providerId, failureClass);
  const current = storage.getProviderCircuit(id) || {};
  return storage.saveProviderCircuit(id, {
    ...current,
    id,
    contract_version: CIRCUIT_CONTRACT_VERSION,
    provider_id: clean(providerId, 100),
    failure_class: clean(failureClass, 100),
    state: 'closed',
    failure_count: 0,
    opened_at_ms: 0,
    retry_after_ms: 0,
    last_success_at_ms: Number(options.now_ms ?? Date.now()),
  });
}

module.exports = {
  CIRCUIT_CONTRACT_VERSION,
  keyFor,
  recordFailure,
  inspect,
  assertAvailable,
  recordSuccess,
};
