const fs = require('fs');
const revisionService = require('./revisionService');

const PRODUCER_LINEAGE_FIELDS = Object.freeze([
  'input_strategy',
  'boundary_repair_fingerprint',
  'transition_policy_version',
  'qa_policy_version',
  'knowledge_qa_fingerprint',
  'qa_fingerprint',
]);

const QA_STATE = Object.freeze({
  APPROVED: 'approved',
  REJECTED: 'rejected',
  MISSING: 'missing',
});

const COMPATIBILITY_STATUS = Object.freeze({
  CURRENT: 'current',
  METADATA_MIGRATION_READY: 'metadata_migration_ready',
  REVERIFY_REQUIRED: 'reverify_required',
  DETERMINISTIC_REPAIR_READY: 'deterministic_repair_ready',
  REGENERATE_REQUIRED: 'regenerate_required',
  BLOCKED: 'blocked',
});

function text(value = '') {
  return String(value || '').trim();
}

function qaState(qa = null) {
  if (qa?.pass === true) return QA_STATE.APPROVED;
  if (qa?.pass === false) return QA_STATE.REJECTED;
  return QA_STATE.MISSING;
}

function lineageFingerprint(artifact = {}) {
  return text(artifact?.lineage_fingerprint || artifact?.lineage?.fingerprint);
}

function lineagePayload(artifact = {}) {
  if (artifact?.lineage && typeof artifact.lineage === 'object') return artifact.lineage;
  return artifact && typeof artifact === 'object' ? artifact : {};
}

function semanticLineageFingerprint(artifact = {}) {
  const direct = text(artifact?.semantic_lineage_fingerprint || artifact?.lineage?.semantic_lineage_fingerprint);
  if (direct) return direct;
  const payload = { ...lineagePayload(artifact) };
  delete payload.fingerprint;
  delete payload.semantic_lineage_fingerprint;
  PRODUCER_LINEAGE_FIELDS.forEach(key => delete payload[key]);
  return Object.keys(payload).length ? revisionService.signature(payload) : '';
}

function boundaryQaState(qa = null, {
  required = true,
  previousLineageFingerprint = '',
  currentLineageFingerprint = '',
  allowUnboundLegacy = false,
} = {}) {
  if (!required) return { state: QA_STATE.APPROVED, status: 'not_required', stale: false, reason_codes: [] };
  const state = qaState(qa);
  if (state === QA_STATE.MISSING) return { state, status: 'missing', stale: false, reason_codes: ['BOUNDARY_QA_MISSING'] };

  const expectedPrevious = text(previousLineageFingerprint);
  const expectedCurrent = text(currentLineageFingerprint);
  const boundPrevious = text(qa?.previous_lineage_fingerprint || qa?.previousLineageFingerprint);
  const boundCurrent = text(qa?.current_lineage_fingerprint || qa?.currentLineageFingerprint);
  const reasons = [];
  if (!boundPrevious || !boundCurrent) {
    if (!allowUnboundLegacy) reasons.push('BOUNDARY_LINEAGE_BINDING_MISSING');
  } else {
    if (!expectedPrevious || boundPrevious !== expectedPrevious) reasons.push('BOUNDARY_PREVIOUS_LINEAGE_STALE');
    if (!expectedCurrent || boundCurrent !== expectedCurrent) reasons.push('BOUNDARY_CURRENT_LINEAGE_STALE');
  }
  if (reasons.length) return { state, status: 'stale', stale: true, reason_codes: reasons };
  return {
    state,
    status: state === QA_STATE.APPROVED ? 'passed' : 'failed',
    stale: false,
    reason_codes: state === QA_STATE.REJECTED ? ['BOUNDARY_QA_REJECTED'] : [],
  };
}

function artifactQaState(clip = {}, { boundaryRequired = false, boundaryAssessment = null } = {}) {
  const single = qaState(clip?.qa);
  const boundary = boundaryAssessment || boundaryQaState(clip?.cross_shot_qa, { required: boundaryRequired });
  let overall = QA_STATE.APPROVED;
  if (single === QA_STATE.REJECTED || boundary.state === QA_STATE.REJECTED && !boundary.stale) overall = QA_STATE.REJECTED;
  else if (single === QA_STATE.MISSING || boundary.status === 'missing' || boundary.stale) overall = QA_STATE.MISSING;
  return { single, boundary: boundary.state, boundary_status: boundary.status, overall };
}

function hasMedia(clip = {}) {
  if (!clip || typeof clip !== 'object') return false;
  if (clip.file_path) return fs.existsSync(clip.file_path);
  return !!text(clip.video_url || clip.videoUrl);
}

function inputStrategy(clip = {}) {
  return text(
    clip.seedance_input_mode
      || clip.input_mode
      || clip.input_strategy
      || clip.lineage?.input_strategy,
  ).toLowerCase();
}

function topologyMembers(value = {}) {
  const members = Array.isArray(value.scene_block_members)
    ? value.scene_block_members
    : value.lineage?.scene_block_members;
  return Array.isArray(members) ? members.map(Number).filter(Number.isFinite) : [];
}

function sameTopology(actual = {}, expected = {}) {
  const left = topologyMembers(actual);
  const right = topologyMembers(expected);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function decision(status, reasonCodes = [], details = {}) {
  return {
    status,
    compatible: status === COMPATIBILITY_STATUS.CURRENT,
    reason_codes: [...new Set(reasonCodes.filter(Boolean))],
    ...details,
  };
}

function classifyVideoArtifact({
  clip = {},
  expectedLineage = {},
  allowedInputStrategies = null,
  boundaryRequired = false,
  boundaryAssessment = null,
} = {}) {
  const billingState = text(clip.billing_state || clip.last_attempt_billing_state).toLowerCase();
  const submissionState = text(clip.provider_submission_state || clip.last_attempt_provider_submission_state).toLowerCase();
  if (billingState === 'unknown' || ['submitting', 'pending', 'running'].includes(submissionState)) {
    return decision(COMPATIBILITY_STATUS.BLOCKED, ['BILLING_UNRESOLVED']);
  }
  if (!hasMedia(clip)) return decision(COMPATIBILITY_STATUS.REGENERATE_REQUIRED, ['MEDIA_MISSING']);

  const actualStrategy = inputStrategy(clip);
  const allowed = Array.isArray(allowedInputStrategies)
    ? new Set(allowedInputStrategies.map(value => text(value).toLowerCase()).filter(Boolean))
    : null;
  if (allowed && actualStrategy && !allowed.has(actualStrategy)) {
    return decision(COMPATIBILITY_STATUS.REGENERATE_REQUIRED, ['INPUT_STRATEGY_RETIRED'], { input_strategy: actualStrategy });
  }
  if (expectedLineage.input_strategy && !actualStrategy) {
    return decision(COMPATIBILITY_STATUS.BLOCKED, ['INPUT_STRATEGY_UNKNOWN']);
  }
  if (expectedLineage.input_strategy && actualStrategy && actualStrategy !== text(expectedLineage.input_strategy).toLowerCase()) {
    return decision(COMPATIBILITY_STATUS.REGENERATE_REQUIRED, ['INPUT_STRATEGY_MISMATCH'], { input_strategy: actualStrategy });
  }
  if (!sameTopology(clip, expectedLineage)) {
    return decision(COMPATIBILITY_STATUS.REGENERATE_REQUIRED, ['TOPOLOGY_MISMATCH']);
  }

  const actualFingerprint = lineageFingerprint(clip);
  const expectedFingerprint = text(expectedLineage.fingerprint);
  const actualSemanticFingerprint = semanticLineageFingerprint(clip);
  const expectedSemanticFingerprint = semanticLineageFingerprint(expectedLineage);
  const exactFingerprint = !!actualFingerprint && !!expectedFingerprint && actualFingerprint === expectedFingerprint;
  if (!exactFingerprint && (!actualFingerprint || !expectedFingerprint || !actualSemanticFingerprint || !expectedSemanticFingerprint)) {
    return decision(COMPATIBILITY_STATUS.BLOCKED, ['PROVENANCE_UNKNOWN']);
  }
  if (!exactFingerprint && actualSemanticFingerprint !== expectedSemanticFingerprint) {
    return decision(COMPATIBILITY_STATUS.REGENERATE_REQUIRED, ['SEMANTIC_LINEAGE_MISMATCH']);
  }

  const actualLineage = lineagePayload(clip);
  const expectedBoundary = text(expectedLineage.boundary_repair_fingerprint);
  const actualBoundary = text(clip.boundary_repair_fingerprint || actualLineage.boundary_repair_fingerprint);
  if ((expectedBoundary || actualBoundary) && expectedBoundary !== actualBoundary) {
    return decision(COMPATIBILITY_STATUS.REGENERATE_REQUIRED, ['BOUNDARY_REPAIR_LINEAGE_MISMATCH']);
  }
  const expectedTransition = text(expectedLineage.transition_policy_version);
  const actualTransition = text(clip.transition_policy_version || actualLineage.transition_policy_version);
  if ((expectedTransition || actualTransition) && expectedTransition !== actualTransition) {
    return decision(COMPATIBILITY_STATUS.DETERMINISTIC_REPAIR_READY, ['TRANSITION_POLICY_STALE']);
  }
  const expectedQaPolicy = text(expectedLineage.qa_policy_version);
  const actualQaPolicy = text(clip.qa_policy_version || clip.qa?.qa_policy_version || actualLineage.qa_policy_version);
  if (expectedQaPolicy && expectedQaPolicy !== actualQaPolicy) {
    return decision(COMPATIBILITY_STATUS.REVERIFY_REQUIRED, ['QA_POLICY_OLD']);
  }
  const expectedQaFingerprint = text(expectedLineage.qa_fingerprint);
  const actualQaFingerprint = text(actualLineage.qa_fingerprint);
  if ((actualQaFingerprint && expectedQaFingerprint !== actualQaFingerprint)
    || (!actualQaFingerprint && text(expectedLineage.knowledge_qa_fingerprint))) {
    return decision(COMPATIBILITY_STATUS.REVERIFY_REQUIRED, ['QA_POLICY_OLD']);
  }

  const qa = artifactQaState(clip, { boundaryRequired, boundaryAssessment });
  if (qa.boundary_status === 'stale') {
    return decision(COMPATIBILITY_STATUS.DETERMINISTIC_REPAIR_READY, ['BOUNDARY_EVIDENCE_STALE'], { qa_state: qa });
  }
  if (qa.overall === QA_STATE.REJECTED) {
    return decision(COMPATIBILITY_STATUS.REGENERATE_REQUIRED, ['QA_REJECTED'], { qa_state: qa });
  }
  if (qa.overall === QA_STATE.MISSING) {
    return decision(COMPATIBILITY_STATUS.REVERIFY_REQUIRED, ['QA_MISSING'], { qa_state: qa });
  }
  if (actualFingerprint !== expectedFingerprint) {
    return decision(COMPATIBILITY_STATUS.METADATA_MIGRATION_READY, ['METADATA_UPGRADE_REQUIRED'], { qa_state: qa });
  }
  return decision(COMPATIBILITY_STATUS.CURRENT, [], { qa_state: qa });
}

module.exports = {
  QA_STATE,
  COMPATIBILITY_STATUS,
  PRODUCER_LINEAGE_FIELDS,
  qaState,
  lineageFingerprint,
  semanticLineageFingerprint,
  boundaryQaState,
  artifactQaState,
  hasMedia,
  inputStrategy,
  topologyMembers,
  sameTopology,
  classifyVideoArtifact,
};
