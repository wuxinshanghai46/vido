const policyCompiler = require('./knowledgePolicyCompilerService');

const SNAPSHOT_SCHEMA_VERSION = 1;
const OUTPUT_KIND = 'knowledge_policy_snapshot';
const DEFAULT_STAGE_SELECTORS = Object.freeze([
  { stage: 'person_dossier', assetType: 'person' },
  { stage: 'scene_asset', assetType: 'scene' },
  { stage: 'keyframe', assetType: 'shot' },
  { stage: 'video', assetType: 'shot' },
]);

function clean(value, max = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value, max = 32) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => clean(item, 160).toLowerCase()).filter(Boolean))]
    .sort().slice(0, max);
}

function normalizeSelector(value = {}) {
  const selector = {
    stage: clean(value.stage, 120).toLowerCase(),
    assetType: clean(value.assetType || value.asset_type, 120).toLowerCase(),
    providerId: clean(value.providerId || value.provider_id, 160).toLowerCase(),
    modelId: clean(value.modelId || value.model_id, 160).toLowerCase(),
    capabilities: list(value.capabilities),
    mode: clean(value.mode, 40).toLowerCase() === 'shadow' ? 'shadow' : 'active',
  };
  if (!selector.stage || !selector.assetType) {
    const error = new Error('知识策略快照 selector 必须包含 stage 和 assetType');
    error.code = 'KNOWLEDGE_POLICY_SELECTOR_INVALID';
    error.status = 422;
    throw error;
  }
  return selector;
}

function selectorKey(value = {}) {
  const selector = normalizeSelector(value);
  return policyCompiler.hash(selector).slice(0, 24);
}

function compactPolicy(policy = {}) {
  return {
    schema_version: Number(policy.schema_version || 1),
    selector: normalizeSelector(policy.selector || {}),
    fingerprint: clean(policy.fingerprint, 80),
    generation_fingerprint: clean(policy.generation_fingerprint, 80),
    qa_fingerprint: clean(policy.qa_fingerprint, 80),
    rule_ids: list(policy.rule_ids, 24),
    generation_rule_ids: list(policy.generation_rule_ids, 24),
    shadow_rule_ids: list(policy.shadow_rule_ids, 24),
    source_doc_ids: list(policy.source_doc_ids, 24),
    prompt_block: clean(policy.prompt_block, 5600),
    negative_constraints: (Array.isArray(policy.negative_constraints) ? policy.negative_constraints : [])
      .map(item => clean(item, 900)).filter(Boolean).slice(0, 24),
    qa_checks: (Array.isArray(policy.qa_checks) ? policy.qa_checks : [])
      .map(item => clean(item, 500)).filter(Boolean).slice(0, 32),
  };
}

function normalizeSelectors(selectors = DEFAULT_STAGE_SELECTORS) {
  const values = Array.isArray(selectors) && selectors.length ? selectors : DEFAULT_STAGE_SELECTORS;
  if (values.length > 16) throw new Error('知识策略快照最多包含 16 个阶段 selector');
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const selector = normalizeSelector(value);
    const key = selectorKey(selector);
    if (!seen.has(key)) { seen.add(key); result.push(selector); }
  }
  return result;
}

function buildSnapshot({ taskId = '', selectors = DEFAULT_STAGE_SELECTORS, docs, createdAt } = {}) {
  const normalizedTaskId = clean(taskId, 200);
  if (!normalizedTaskId) throw new Error('知识策略快照必须绑定 taskId');
  const policies = {};
  let sourceFingerprint = '';
  for (const selector of normalizeSelectors(selectors)) {
    const compiled = policyCompiler.compile({ ...selector, taskId: normalizedTaskId }, docs ? { docs } : {});
    if (sourceFingerprint && sourceFingerprint !== compiled.source_fingerprint) {
      const error = new Error('知识规则源在快照编译期间发生变化，请重新固定任务策略');
      error.code = 'KNOWLEDGE_POLICY_SOURCE_CHANGED';
      throw error;
    }
    sourceFingerprint = compiled.source_fingerprint;
    policies[selectorKey(selector)] = compactPolicy(compiled);
  }
  const fingerprint = policyCompiler.hash({
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    task_id: normalizedTaskId,
    source_fingerprint: sourceFingerprint,
    policies: Object.fromEntries(Object.entries(policies).map(([key, policy]) => [key, {
      generation_fingerprint: policy.generation_fingerprint,
      qa_fingerprint: policy.qa_fingerprint,
    }])),
  });
  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    id: `knowledge_policy_${fingerprint.slice(0, 24)}`,
    task_id: normalizedTaskId,
    status: 'pinned',
    source_fingerprint: sourceFingerprint,
    fingerprint,
    policies,
    created_at: createdAt || new Date().toISOString(),
  };
}

function reusableSnapshot(value, taskId = '') {
  return !!value
    && Number(value.schema_version) === SNAPSHOT_SCHEMA_VERSION
    && value.status === 'pinned'
    && value.task_id === clean(taskId, 200)
    && typeof value.fingerprint === 'string'
    && value.fingerprint.length === 64
    && value.policies && typeof value.policies === 'object';
}

function pinTaskPolicy({ storage, taskId = '', selectors = DEFAULT_STAGE_SELECTORS, docs, force = false } = {}) {
  if (!storage || typeof storage.getOutput !== 'function' || typeof storage.saveOutput !== 'function') {
    throw new Error('pinTaskPolicy requires storage.getOutput and storage.saveOutput');
  }
  const existing = storage.getOutput(taskId, OUTPUT_KIND);
  if (!force && reusableSnapshot(existing, taskId)) return { snapshot: existing, reused: true };
  const snapshot = buildSnapshot({ taskId, selectors, docs });
  storage.saveOutput(taskId, OUTPUT_KIND, snapshot);
  return { snapshot, reused: false };
}

function policyFor(snapshot = {}, selector = {}) {
  if (!reusableSnapshot(snapshot, snapshot.task_id)) return null;
  const normalized = normalizeSelector(selector);
  const exact = snapshot.policies[selectorKey(normalized)];
  if (exact) return exact;
  return Object.values(snapshot.policies).find(policy => (
    policy.selector?.stage === normalized.stage
    && policy.selector?.assetType === normalized.assetType
    && (!policy.selector?.providerId || policy.selector.providerId === normalized.providerId)
    && (!policy.selector?.modelId || policy.selector.modelId === normalized.modelId)
  )) || null;
}

function promptContract(snapshot = {}, selector = {}) {
  const policy = policyFor(snapshot, selector);
  if (!policy) return null;
  return {
    snapshot_id: snapshot.id,
    snapshot_fingerprint: snapshot.fingerprint,
    generation_fingerprint: policy.generation_fingerprint,
    prompt_block: policy.prompt_block,
    negative_constraints: [...policy.negative_constraints],
    rule_ids: [...policy.generation_rule_ids],
  };
}

function qaContract(snapshot = {}, selector = {}) {
  const policy = policyFor(snapshot, selector);
  if (!policy) return null;
  return {
    snapshot_id: snapshot.id,
    snapshot_fingerprint: snapshot.fingerprint,
    qa_fingerprint: policy.qa_fingerprint,
    qa_checks: [...policy.qa_checks],
    rule_ids: [...policy.rule_ids],
  };
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  OUTPUT_KIND,
  DEFAULT_STAGE_SELECTORS,
  normalizeSelector,
  selectorKey,
  compactPolicy,
  buildSnapshot,
  reusableSnapshot,
  pinTaskPolicy,
  policyFor,
  promptContract,
  qaContract,
};
