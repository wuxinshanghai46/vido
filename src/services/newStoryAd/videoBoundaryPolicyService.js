const artifactCompatibility = require('./videoArtifactCompatibilityService');

function text(value = '') {
  return String(value || '').trim();
}

const BOUNDARY_LINEAGE_POLICY_VERSION = 'cross-shot-lineage-boundary-v1';

function lineageFingerprint(clip = {}) {
  return artifactCompatibility.lineageFingerprint(clip);
}

function bindBoundaryQa(qa = {}, previous = {}, current = {}, { policyVersion = BOUNDARY_LINEAGE_POLICY_VERSION } = {}) {
  return {
    ...(qa || {}),
    boundary_lineage_policy_version: text(policyVersion) || BOUNDARY_LINEAGE_POLICY_VERSION,
    previous_lineage_fingerprint: lineageFingerprint(previous),
    current_lineage_fingerprint: lineageFingerprint(current),
  };
}

function sceneBlockId(clip = {}) {
  return text(clip.scene_block_id || clip.lineage?.scene_block_id);
}

function sameContinuousUnit(previous = {}, current = {}) {
  const previousBlock = sceneBlockId(previous);
  const currentBlock = sceneBlockId(current);
  if (previousBlock && currentBlock) return previousBlock === currentBlock;
  const previousSource = text(previous.scene_block_source_path || previous.source_video_path);
  const currentSource = text(current.scene_block_source_path || current.source_video_path);
  return !!(previousSource && currentSource && previousSource === currentSource);
}

function boundaryRequired(clips = [], index = 0) {
  return index > 0 && index < clips.length && !sameContinuousUnit(clips[index - 1] || {}, clips[index] || {});
}

function boundaryStatus(clips = [], index = 0, { allowUnboundLegacy = false } = {}) {
  if (!boundaryRequired(clips, index)) return { index, required: false, pass: true, status: 'same_generation_unit' };
  const previous = clips[index - 1] || {};
  const current = clips[index] || {};
  const qa = clips[index]?.cross_shot_qa;
  const assessment = artifactCompatibility.boundaryQaState(qa, {
    required: true,
    previousLineageFingerprint: lineageFingerprint(previous),
    currentLineageFingerprint: lineageFingerprint(current),
    allowUnboundLegacy,
  });
  return {
    index,
    required: true,
    pass: assessment.status === 'passed',
    status: assessment.status,
    qa: qa || null,
    stale: assessment.stale,
    reason_codes: assessment.reason_codes,
  };
}

function audit(clips = [], shotCount = clips.length, options = {}) {
  const scoped = Array.from({ length: Math.max(0, Number(shotCount) || 0) }, (_, index) => clips[index] || {});
  const boundaries = scoped.map((_, index) => boundaryStatus(scoped, index, options)).filter(item => item.required);
  const missing = boundaries.filter(item => item.status === 'missing');
  const failed = boundaries.filter(item => item.status === 'failed');
  const stale = boundaries.filter(item => item.status === 'stale');
  return {
    ready: boundaries.every(item => item.pass),
    total: boundaries.length,
    passed: boundaries.filter(item => item.pass).length,
    missing_indexes: missing.map(item => item.index),
    failed_indexes: failed.map(item => item.index),
    stale_indexes: stale.map(item => item.index),
    unready_indexes: boundaries.filter(item => !item.pass).map(item => item.index),
    boundaries,
  };
}

function requiredBoundaryIndexes(clips = [], reviewedIndexes = []) {
  const candidates = [...new Set((reviewedIndexes || []).flatMap(index => [Number(index), Number(index) + 1]))];
  return candidates.filter(index => Number.isInteger(index) && boundaryRequired(clips, index));
}

function deterministicTransitionQa(previous = {}, current = {}, transition = 'dissolve') {
  const normalized = text(transition).toLowerCase();
  const supported = ['dissolve', 'fade'].includes(normalized);
  const inputsApproved = previous?.qa?.pass === true && current?.qa?.pass === true;
  const pass = supported && inputsApproved;
  return bindBoundaryQa({
    pass,
    decision_source: 'deterministic_transition',
    boundary_mode: 'intentional_discontinuity',
    continuity_waived_by_transition: pass,
    transition_type: supported ? normalized : '',
    policy_version: 'deterministic-boundary-transition-v1',
    person_position_score: pass ? null : 0,
    wardrobe_score: pass ? null : 0,
    prop_state_score: pass ? null : 0,
    scene_score: pass ? null : 0,
    screen_direction_score: pass ? null : 0,
    action_continuity_score: pass ? null : 0,
    failure_dimensions: pass ? [] : ['deterministic_transition_input'],
    failure_labels_zh: pass ? [] : ['转场输入素材未通过单镜质检'],
    problems: pass ? [] : ['Deterministic transition requires two individually approved clips and a supported transition.'],
    reviewed_at: new Date().toISOString(),
  }, previous, current, { policyVersion: 'deterministic-boundary-transition-v1' });
}

function usesDeterministicTransition(plan = {}) {
  return plan.action === 'transition_bridge'
    || (plan.action === 'provider_generate' && plan.review_scope === 'post_generation_deterministic_transition');
}

function taskFailurePatch(clips = [], shotCount = clips.length) {
  const result = audit(clips, shotCount);
  if (!result.failed_indexes.length) return null;
  const details = result.boundaries.filter(item => item.status === 'failed').map(item => {
    const labels = Array.isArray(item.qa?.failure_labels_zh) ? item.qa.failure_labels_zh.filter(Boolean) : [];
    return `第 ${item.index}→${item.index + 1} 镜衔接未通过${labels.length ? `（${labels.join('、')}）` : ''}`;
  });
  return { status: 'failed', stage: 'video_failed', error: details.join('；'), error_code: 'VIDEO_QA_FAILED', retryable: true };
}

module.exports = {
  BOUNDARY_LINEAGE_POLICY_VERSION,
  lineageFingerprint,
  bindBoundaryQa,
  sceneBlockId,
  sameContinuousUnit,
  boundaryRequired,
  boundaryStatus,
  audit,
  requiredBoundaryIndexes,
  deterministicTransitionQa,
  usesDeterministicTransition,
  taskFailurePatch,
};
