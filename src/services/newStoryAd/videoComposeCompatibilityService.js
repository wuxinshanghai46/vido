const revisionService = require('./revisionService');
const artifactCompatibility = require('./videoArtifactCompatibilityService');
const artifactWorkflow = require('./videoArtifactWorkflowService');
const clipStatusRecovery = require('./videoClipStatusRecoveryService');

const PRODUCER_SEMANTIC_FIELDS = Object.freeze([
  'motion_prompt_signature',
  'scene_block_policy_version',
  'scene_block_id',
  'scene_block_fingerprint',
  'scene_block_members',
]);

function text(value = '') {
  return String(value || '').trim();
}

function withoutComputedFields(lineage = {}) {
  const next = { ...(lineage || {}) };
  [
    'fingerprint',
    'semantic_lineage_fingerprint',
    'input_strategy',
    'boundary_repair_fingerprint',
    'transition_policy_version',
    'qa_policy_version',
    'knowledge_qa_fingerprint',
    'qa_fingerprint',
  ].forEach(key => delete next[key]);
  return next;
}

/** Content identity used by an explicit legacy compose receipt.
 * Producer prompt/topology fields are intentionally excluded: they describe how
 * the approved media was made, not whether the current script/keyframe changed.
 */
function composeSourceFingerprint(expectedLineage = {}) {
  const source = withoutComputedFields(expectedLineage);
  PRODUCER_SEMANTIC_FIELDS.forEach(key => delete source[key]);
  return revisionService.signature(source);
}

/** Rebuild the current expectation with immutable producer evidence from the
 * actual clip. This prevents a later scoped generation plan from rewriting the
 * historical topology or motion prompt of an already-approved artifact.
 */
function rebaseExpectedLineage(expectedLineage = {}, clip = {}) {
  const actual = clip?.lineage;
  if (!actual || typeof actual !== 'object') return expectedLineage;
  const semantic = withoutComputedFields(expectedLineage);
  PRODUCER_SEMANTIC_FIELDS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(actual, key)) semantic[key] = actual[key];
  });
  const payload = {
    ...semantic,
    semantic_lineage_fingerprint: revisionService.signature(semantic),
    input_strategy: artifactCompatibility.inputStrategy(clip) || text(expectedLineage.input_strategy),
    boundary_repair_fingerprint: text(
      clip.boundary_repair_fingerprint
      || actual.boundary_repair_fingerprint
      || expectedLineage.boundary_repair_fingerprint,
    ),
    transition_policy_version: text(
      clip.transition_policy_version
      || actual.transition_policy_version
      || expectedLineage.transition_policy_version,
    ),
  };
  return {
    ...payload,
    qa_policy_version: expectedLineage.qa_policy_version,
    knowledge_qa_fingerprint: expectedLineage.knowledge_qa_fingerprint || '',
    qa_fingerprint: expectedLineage.qa_fingerprint || '',
    fingerprint: revisionService.signature(payload),
  };
}

function receiptCurrent(clip = {}, status = {}, expectedLineage = {}, previousClip = {}, index = 0) {
  const receipt = clip.compose_compatibility_receipt || status.compose_compatibility_receipt;
  if (!receipt || typeof receipt !== 'object') return false;
  const lineageFingerprint = artifactCompatibility.lineageFingerprint(clip);
  if (!lineageFingerprint || text(status.lineage_fingerprint) !== lineageFingerprint) return false;
  if (text(receipt.lineage_fingerprint) !== lineageFingerprint) return false;
  if (text(receipt.source_fingerprint) !== composeSourceFingerprint(expectedLineage)) return false;
  if (!clipStatusRecovery.statusHasVerifiedMedia(status) || clip.qa?.pass !== true) return false;
  if (index <= 0) return true;
  const previousFingerprint = artifactCompatibility.lineageFingerprint(previousClip);
  return clip.cross_shot_qa?.pass === true
    && text(clip.cross_shot_qa.previous_lineage_fingerprint) === previousFingerprint
    && text(clip.cross_shot_qa.current_lineage_fingerprint) === lineageFingerprint
    && text(status.cross_shot_qa_status).toLowerCase() === 'passed';
}

function buildReport({ clips = [], statuses = [], expectedLineages = [] } = {}) {
  const rebasedExpectedLineages = expectedLineages.map((expected, index) => (
    rebaseExpectedLineage(expected, clips[index] || {})
  ));
  const base = artifactWorkflow.buildCompatibilityReport({
    clips,
    expectedLineages: rebasedExpectedLineages,
  });
  const decisions = base.decisions.map((item, index) => {
    if (item.status === artifactCompatibility.COMPATIBILITY_STATUS.CURRENT) return item;
    if (!receiptCurrent(
      clips[index] || {},
      statuses[index] || {},
      expectedLineages[index] || {},
      clips[index - 1] || {},
      index,
    )) return item;
    return {
      ...item,
      status: artifactCompatibility.COMPATIBILITY_STATUS.CURRENT,
      compatible: true,
      reason_codes: [],
      compose_receipt_verified: true,
    };
  });
  const summary = Object.fromEntries(Object.values(artifactCompatibility.COMPATIBILITY_STATUS)
    .map(status => [status, decisions.filter(item => item.status === status).length]));
  return {
    ...base,
    ready_for_compose: decisions.every(item => item.status === artifactCompatibility.COMPATIBILITY_STATUS.CURRENT),
    decisions,
    summary,
    expected_lineages: rebasedExpectedLineages,
  };
}

function createReceipt(expectedLineage = {}, lineageFingerprint = '', extra = {}) {
  return {
    policy_version: 'compose-compatibility-receipt-v1',
    source_fingerprint: composeSourceFingerprint(expectedLineage),
    lineage_fingerprint: text(lineageFingerprint),
    approved_at: new Date().toISOString(),
    ...extra,
  };
}

module.exports = {
  PRODUCER_SEMANTIC_FIELDS,
  composeSourceFingerprint,
  rebaseExpectedLineage,
  receiptCurrent,
  buildReport,
  createReceipt,
};
