const crypto = require('crypto');
const compiler = require('./knowledgePolicyCompilerService');
const snapshots = require('./knowledgePolicySnapshotService');

const TASK_SELECTORS = Object.freeze([
  { stage: 'person_dossier', assetType: 'person' },
  { stage: 'scene_asset', assetType: 'scene' },
  { stage: 'keyframe', assetType: 'shot' },
  { stage: 'keyframe', assetType: 'person' },
  { stage: 'keyframe', assetType: 'scene' },
  { stage: 'video', assetType: 'shot' },
]);

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function fromSnapshot(snapshot = {}, selector = {}) {
  return snapshots.policyFor(snapshot, selector);
}

function pinTaskPolicy(storage, taskId = '') {
  return snapshots.pinTaskPolicy({ storage, taskId, selectors: TASK_SELECTORS }).snapshot;
}

function resolveTaskMany({ storage, taskId = '', selectors = [], context = {} } = {}) {
  const snapshot = pinTaskPolicy(storage, taskId);
  return {
    ...resolveMany(selectors, { ...context, knowledge_policy_snapshot: snapshot }),
    snapshot_id: snapshot.id,
    snapshot_fingerprint: snapshot.fingerprint,
  };
}

function resolve(selector = {}, context = {}) {
  const normalized = {
    stage: String(selector.stage || '').trim().toLowerCase(),
    assetType: String(selector.assetType || selector.asset_type || '').trim().toLowerCase(),
    providerId: String(selector.providerId || selector.provider_id || '').trim().toLowerCase(),
    modelId: String(selector.modelId || selector.model_id || '').trim().toLowerCase(),
    capabilities: Array.isArray(selector.capabilities) ? selector.capabilities : [],
  };
  const snapshot = context.knowledge_policy_snapshot || context.knowledgePolicySnapshot || {};
  const snapshotted = fromSnapshot(snapshot, normalized);
  if (snapshotted) return snapshotted;
  // A pinned task must never start reading newer live rules half-way through a run.
  // Older snapshots can legitimately lack a selector introduced by a later release;
  // treat that selector as empty and keep the original task policy stable.
  if (snapshots.reusableSnapshot(snapshot, snapshot.task_id)) return {
    selector: normalized,
    prompt_block: '',
    negative_constraints: [],
    qa_checks: [],
    rule_ids: [],
    generation_fingerprint: hash([]),
    qa_fingerprint: hash([]),
  };
  return compiler.compile(normalized);
}

function resolveMany(selectors = [], context = {}) {
  const policies = selectors.map(selector => resolve(selector, context));
  const promptBlocks = unique(policies.map(policy => policy.prompt_block));
  const negativeConstraints = unique(policies.flatMap(policy => policy.negative_constraints || []));
  const qaChecks = unique(policies.flatMap(policy => policy.qa_checks || []));
  const ruleIds = unique(policies.flatMap(policy => policy.rule_ids || [])).sort();
  const generationParts = policies.map(policy => policy.generation_fingerprint).filter(Boolean).sort();
  const qaParts = policies.map(policy => policy.qa_fingerprint).filter(Boolean).sort();
  const snapshot = context.knowledge_policy_snapshot || context.knowledgePolicySnapshot || {};
  return {
    prompt_block: promptBlocks.join('\n'),
    negative_constraints: negativeConstraints,
    qa_checks: qaChecks,
    rule_ids: ruleIds,
    generation_fingerprint: hash(generationParts),
    qa_fingerprint: hash(qaParts),
    snapshot_id: String(snapshot.id || ''),
    snapshot_fingerprint: String(snapshot.fingerprint || ''),
  };
}

function promptBlock(policy = {}) {
  return [
    String(policy.prompt_block || '').trim(),
    (policy.negative_constraints || []).length
      ? `Knowledge policy exclusions: ${(policy.negative_constraints || []).join('; ')}`
      : '',
  ].filter(Boolean).join('\n');
}

function qaBlock(policy = {}) {
  const checks = Array.isArray(policy.qa_checks) ? policy.qa_checks.filter(Boolean) : [];
  return checks.length
    ? `Knowledge policy QA checks (judge only visible applicable evidence): ${checks.join('; ')}`
    : '';
}

function composeBoundedPrompt(required = '', body = '', maxChars = 3950, requiredMax = 1200) {
  const requiredText = String(required || '').trim().slice(0, Math.max(0, Number(requiredMax) || 0));
  const bodyText = String(body || '').trim();
  const separator = requiredText && bodyText ? '\n' : '';
  const remaining = Math.max(0, (Number(maxChars) || 3950) - requiredText.length - separator.length);
  if (bodyText.length <= remaining) return `${requiredText}${separator}${bodyText}`;
  const marker = '\n...[bounded task contract]...\n';
  const available = Math.max(0, remaining - marker.length);
  const headSize = Math.ceil(available * 0.55);
  const tailSize = Math.max(0, available - headSize);
  return `${requiredText}${separator}${bodyText.slice(0, headSize)}${marker}${bodyText.slice(-tailSize)}`;
}

function trace(policy = {}) {
  const result = {
    snapshot_id: String(policy.snapshot_id || ''),
    snapshot_fingerprint: String(policy.snapshot_fingerprint || ''),
    rule_ids: (policy.rule_ids || []).slice(0, 24),
    generation_fingerprint: String(policy.generation_fingerprint || ''),
    qa_fingerprint: String(policy.qa_fingerprint || ''),
  };
  return result.snapshot_id || result.snapshot_fingerprint || result.rule_ids.length
    || result.generation_fingerprint || result.qa_fingerprint ? result : null;
}

module.exports = { TASK_SELECTORS, resolve, resolveMany, resolveTaskMany, pinTaskPolicy, promptBlock, qaBlock, composeBoundedPrompt, trace };
