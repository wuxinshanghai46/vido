const CAPABILITY_SUPPORTED = 'supported';
const CAPABILITY_UNSUPPORTED = 'unsupported';
const CAPABILITY_UNKNOWN = 'unknown';
const CAPABILITY_STATES = new Set([
  CAPABILITY_SUPPORTED,
  CAPABILITY_UNSUPPORTED,
  CAPABILITY_UNKNOWN,
]);

// Capability discovery must be read-only. Creating a group to discover whether
// the account is entitled would mutate provider state and may create cost.
const CREATE_ASSET_GROUP_PROBE_ALLOWED = false;

function clean(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function routeKey(providerId, modelId) {
  return `${clean(providerId, 80).toLowerCase()}/${clean(modelId, 160).toLowerCase()}`;
}

function normalizeState(value) {
  const raw = typeof value === 'string' ? value : value?.state;
  const state = clean(raw, 40).toLowerCase();
  return CAPABILITY_STATES.has(state) ? state : CAPABILITY_UNKNOWN;
}

function registryEntry(registry = {}, providerId = '', modelId = '') {
  const route = routeKey(providerId, modelId);
  const provider = clean(providerId, 80).toLowerCase();
  return registry?.[route] || registry?.[provider] || registry?.default || {};
}

function capabilityEvidence({ registry = {}, providerId = '', modelId = '', capability = '', now = Date.now(), maxAgeMs = 0 } = {}) {
  const name = clean(capability, 100);
  const entry = registryEntry(registry, providerId, modelId);
  const raw = entry?.capabilities?.[name] ?? entry?.[name];
  const evidence = typeof raw === 'string' ? { state: raw } : (raw && typeof raw === 'object' ? { ...raw } : {});
  let state = normalizeState(evidence);
  const nowMs = Number(now instanceof Date ? now.getTime() : now) || Date.now();
  const expiresAt = Date.parse(evidence.expires_at || evidence.expiresAt || '') || 0;
  const checkedAt = Date.parse(evidence.checked_at || evidence.checkedAt || '') || 0;
  const expired = (expiresAt > 0 && expiresAt <= nowMs)
    || (Number(maxAgeMs) > 0 && checkedAt > 0 && nowMs - checkedAt > Number(maxAgeMs));
  if (expired) state = CAPABILITY_UNKNOWN;
  return {
    capability: name,
    state,
    source: clean(evidence.source, 120) || (raw ? 'configured_evidence' : 'no_evidence'),
    checked_at: clean(evidence.checked_at || evidence.checkedAt, 40),
    expires_at: clean(evidence.expires_at || evidence.expiresAt, 40),
    reason: expired ? 'capability_evidence_expired' : clean(evidence.reason, 300),
    probe_performed: false,
  };
}

function blockerFor(evidence, { providerId = '', modelId = '' } = {}) {
  if (evidence.state === CAPABILITY_SUPPORTED) return null;
  const privateAsset = evidence.capability === 'private_asset';
  const prefix = privateAsset ? 'VIDEO_PROVIDER_PRIVATE_ASSET' : 'VIDEO_PROVIDER_CAPABILITY';
  const suffix = evidence.state === CAPABILITY_UNSUPPORTED ? 'UNSUPPORTED' : 'UNKNOWN';
  const label = privateAsset ? '私有参考素材能力' : `${evidence.capability} 能力`;
  const message = evidence.state === CAPABILITY_UNSUPPORTED
    ? `当前供应商账号不支持${label}，已在供应商提交前停止。`
    : `当前供应商账号的${label}尚未取得只读授权证据，已在供应商提交前停止。`;
  return {
    code: `${prefix}_${suffix}`,
    message,
    provider_id: clean(providerId, 80),
    model_id: clean(modelId, 160),
    capability: evidence.capability,
    state: evidence.state,
    source: evidence.source,
    reason: evidence.reason,
    retryable: false,
    provider_submitted: false,
    billing_state: 'not_submitted',
  };
}

function assessProviderCapabilities({
  registry = {},
  providerId = '',
  modelId = '',
  requiredCapabilities = [],
  requiresPrivateAsset = false,
  now = Date.now(),
  maxAgeMs = 0,
} = {}) {
  const required = [...new Set([
    ...(Array.isArray(requiredCapabilities) ? requiredCapabilities : []),
    ...(requiresPrivateAsset ? ['private_asset'] : []),
  ].map(value => clean(value, 100)).filter(Boolean))];
  const evidence = required.map(capability => capabilityEvidence({
    registry, providerId, modelId, capability, now, maxAgeMs,
  }));
  const blockers = evidence.map(item => blockerFor(item, { providerId, modelId })).filter(Boolean);
  return {
    ready: blockers.length === 0,
    status: blockers.length ? 'blocked' : 'ready',
    provider_id: clean(providerId, 80),
    model_id: clean(modelId, 160),
    required_capabilities: required,
    capabilities: evidence,
    blockers,
    provider_submitted: false,
    billing_state: 'not_submitted',
    probe_performed: false,
    create_asset_group_probe_allowed: CREATE_ASSET_GROUP_PROBE_ALLOWED,
  };
}

function assertProviderCapabilities(options = {}) {
  const assessment = assessProviderCapabilities(options);
  if (assessment.ready) return assessment;
  const blocker = assessment.blockers[0];
  const error = new Error(blocker.message);
  error.code = blocker.code;
  error.status = blocker.state === CAPABILITY_UNSUPPORTED ? 422 : 409;
  error.retryable = false;
  error.providerSubmitted = false;
  error.billingState = 'not_submitted';
  error.capabilityAssessment = assessment;
  throw error;
}

module.exports = {
  CAPABILITY_SUPPORTED,
  CAPABILITY_UNSUPPORTED,
  CAPABILITY_UNKNOWN,
  CREATE_ASSET_GROUP_PROBE_ALLOWED,
  assessProviderCapabilities,
  assertProviderCapabilities,
  capabilityEvidence,
  normalizeState,
  routeKey,
};
