const revisionService = require('./revisionService');
const compatibility = require('./videoArtifactCompatibilityService');
const boundaryPolicy = require('./videoBoundaryPolicyService');
const providerCapability = require('./videoProviderCapabilityService');
const videoLineage = require('./videoLineageService');
const sceneBlockService = require('./sceneBlockService');

const ARTIFACT_WORKFLOW_POLICY_VERSION = 'story-ad-video-artifact-workflow-v1';
const ACTIVE_INPUT_STRATEGIES = Object.freeze([
  'approved_keyframe_private_asset_only',
  'approved_keyframe_first_frame_only',
  'approved_keyframe_local_motion',
  'approved_keyframe_and_previous_tail_private_assets',
]);

function indexesFor(count = 0, onlyIndexes = null) {
  const all = Array.from({ length: Math.max(0, Number(count) || 0) }, (_, index) => index);
  if (!Array.isArray(onlyIndexes) || !onlyIndexes.length) return all;
  const requested = new Set(onlyIndexes.map(Number).filter(Number.isInteger));
  return all.filter(index => requested.has(index));
}

function buildCompatibilityReport({ clips = [], expectedLineages = [], onlyIndexes = null } = {}) {
  const decisions = indexesFor(Math.max(clips.length, expectedLineages.length), onlyIndexes).map((index) => {
    const previousExpected = expectedLineages[index - 1] || {};
    const expected = expectedLineages[index] || {};
    const boundaryRequired = boundaryPolicy.boundaryRequired(clips, index);
    const boundaryAssessment = compatibility.boundaryQaState(clips[index]?.cross_shot_qa, {
      required: boundaryRequired,
      previousLineageFingerprint: previousExpected.fingerprint || compatibility.lineageFingerprint(clips[index - 1]),
      currentLineageFingerprint: expected.fingerprint || compatibility.lineageFingerprint(clips[index]),
    });
    return {
      index,
      shot_index: index + 1,
      ...compatibility.classifyVideoArtifact({
        clip: clips[index] || {},
        expectedLineage: expected,
        allowedInputStrategies: ACTIVE_INPUT_STRATEGIES,
        boundaryRequired,
        boundaryAssessment,
      }),
    };
  });
  const summary = Object.fromEntries(Object.values(compatibility.COMPATIBILITY_STATUS)
    .map(status => [status, decisions.filter(item => item.status === status).length]));
  const source = {
    policy_version: ARTIFACT_WORKFLOW_POLICY_VERSION,
    expected_lineages: decisions.map(item => expectedLineages[item.index]?.fingerprint || ''),
    artifacts: decisions.map(item => ({
      index: item.index,
      clip_lineage: compatibility.lineageFingerprint(clips[item.index]),
      status: item.status,
      reason_codes: item.reason_codes,
    })),
  };
  return {
    policy_version: ARTIFACT_WORKFLOW_POLICY_VERSION,
    fingerprint: revisionService.signature(source),
    ready_for_compose: decisions.every(item => item.status === compatibility.COMPATIBILITY_STATUS.CURRENT),
    decisions,
    summary,
  };
}

function buildExpectedLineages({
  shots = [], contracts = [], keyframes = [], ctx = {}, blueprint = {}, storyboardMeta = {},
  modelRoute = '', modelRouteFor = null, contextFor = null, audioTracks = [], sceneBlocks = [], shotPlans = [], speechModeFor = () => '',
  motionPromptFor = () => '', qaPolicyVersion = '',
} = {}) {
  const plans = new Map((shotPlans || []).map(item => [item.index, item]));
  return shots.map((shot, index) => {
    const plan = plans.get(index) || {};
    return videoLineage.buildShotLineage({
      shot, index, contract: contracts[index] || {}, keyframe: keyframes[index] || {}, ctx: typeof contextFor === 'function' ? contextFor(shot, index, ctx) : ctx,
      blueprint, storyboardMeta, modelRoute: typeof modelRouteFor === 'function'
        ? modelRouteFor(shot, contracts[index] || {}, index)
        : modelRoute,
      speechMode: speechModeFor(shot, contracts[index] || {}, index),
      motionPrompt: motionPromptFor(shot, contracts[index] || {}, index),
      audio: audioTracks[index] || {},
      sceneBlock: sceneBlockService.blockForIndex(sceneBlocks, index),
      inputStrategy: plan.input_strategy || '',
      boundaryRepairFingerprint: plan.boundary_repair?.fingerprint || '',
      transitionPolicyVersion: plan.transition_override ? `deterministic-${plan.transition_override}-v1` : '',
      qaPolicyVersion,
    });
  });
}

function compatibilityMotionPrompt(clip = {}, buildPrompt = () => '') {
  const candidate = clip || {};
  const storedPrompt = typeof candidate.motion_prompt === 'string' ? candidate.motion_prompt : '';
  if (videoLineage.clipHasMediaFile(candidate) && storedPrompt) return storedPrompt;
  return typeof buildPrompt === 'function' ? buildPrompt() : '';
}

function capabilityRegistry({ route = '', model = {}, configured = {} } = {}) {
  if (configured && Object.keys(configured).length) return configured;
  const evidence = model.capabilities || model.capability_evidence || {};
  const privateAsset = model.private_asset_capability || model.privateAssetCapability;
  return route && (Object.keys(evidence).length || privateAsset)
    ? { [route]: { capabilities: evidence, ...(privateAsset ? { private_asset: privateAsset } : {}) } }
    : {};
}

function assessUnitCapabilities({ units = [], providerId = '', modelId = '', registry = {} } = {}) {
  const assessments = (units || []).filter(unit => unit.paid).map((unit) => {
    const strategy = String(unit.input_strategy || '').toLowerCase();
    const requiresPrivateAsset = strategy.includes('private_asset');
    return {
      unit_id: unit.id,
      shots: unit.shots || [],
      input_strategy: strategy,
      ...providerCapability.assessProviderCapabilities({
        registry,
        providerId,
        modelId,
        requiresPrivateAsset,
      }),
    };
  });
  return {
    ready: assessments.every(item => item.ready),
    assessments,
    blockers: assessments.flatMap(item => item.blockers.map(blocker => ({ ...blocker, unit_id: item.unit_id, shots: item.shots }))),
  };
}

function assertComposeCompatible(report = {}) {
  if (report.ready_for_compose) return report;
  const unready = (report.decisions || []).filter(item => item.status !== compatibility.COMPATIBILITY_STATUS.CURRENT);
  const error = new Error(`当前版本仍有 ${unready.map(item => `第 ${item.shot_index} 镜（${item.status}）`).join('、')} 未完成兼容性闭环。`);
  error.code = 'COMPOSE_VIDEO_ARTIFACT_INCOMPATIBLE';
  error.status = 409;
  error.retryable = true;
  error.compatibility_report = report;
  throw error;
}

function claimUnitAttempts({ ledger, taskId = '', indexes = [], generationId = '', lineages = [], providerId = '', modelId = '', costFingerprint = '' } = {}) {
  const inputs = indexes.map(index => ({ taskId, shotIndex: index, generationId, lineageFingerprint: lineages[index]?.fingerprint || '', providerId, modelId, costFingerprint }));
  const projections = inputs.map(input => ledger.projectClaim(input));
  const blocked = projections.find(item => !item.ready);
  if (blocked) {
    const error = new Error(blocked.duplicate ? '同一生成请求已存在，已阻止重复提交供应商。' : '该镜头仍有进行中或计费未知的生成尝试，已阻止重复提交。');
    error.code = blocked.duplicate ? 'VIDEO_ATTEMPT_DUPLICATE' : 'VIDEO_ATTEMPT_CONFLICT';
    error.status = 409;
    error.retryable = false;
    error.attempt = blocked.attempt || blocked.blocking_attempt || null;
    throw error;
  }
  const claims = inputs.map(input => ledger.claim(input));
  claims.forEach(({ attempt }) => ledger.appendEvent({ taskId, attemptId: attempt.attempt_id, type: 'submitting', eventKey: 'provider-submit-started' }));
  return claims;
}

function finishUnitAttempts({ ledger, taskId = '', claims = [], clips = [], statusFor = () => ({}) } = {}) {
  claims.forEach(({ attempt }) => {
    const index = attempt.shot_index, clip = clips[index] || {}, status = statusFor(index) || {};
    ledger.appendEvent({
      taskId, attemptId: attempt.attempt_id, type: 'succeeded', eventKey: 'clip-persisted-and-reviewed',
      providerTaskId: clip.provider_task_id || status.provider_task_id || '',
      providerStatus: status.provider_status || 'succeeded',
      billingState: status.billing_state || (clip.provider_task_id || status.provider_task_id ? 'confirmed' : 'not_submitted'),
      requestedVideoSeconds: status.requested_video_seconds || 0,
    });
  });
}

function failUnitAttempts({ ledger, taskId = '', claims = [], error = {}, statusFor = () => ({}) } = {}) {
  claims.forEach(({ attempt }) => {
    const status = statusFor(attempt.shot_index) || {};
    const providerTaskId = error.providerTaskId || error.provider_task_id || status.provider_task_id || '';
    const submitted = error.providerSubmitted === true || !!providerTaskId || ['submitted', 'request_started'].includes(String(status.provider_submission_state || '').toLowerCase());
    const billingUnknown = String(error.billingState || error.billing_state || status.billing_state || '').toLowerCase() === 'unknown';
    ledger.appendEvent({
      taskId, attemptId: attempt.attempt_id,
      type: billingUnknown ? 'billing_unknown' : (submitted ? 'failed' : 'pre_provider_failed'),
      eventKey: `terminal-${error.code || 'VIDEO_PROVIDER_FAILED'}`,
      providerTaskId,
      providerStatus: error.providerStatus || error.provider_status || status.provider_status || '',
      billingState: billingUnknown ? 'unknown' : (submitted ? (error.billingState || error.billing_state || 'unknown') : 'not_submitted'),
      requestedVideoSeconds: status.requested_video_seconds || 0,
      errorCode: error.code || 'VIDEO_PROVIDER_FAILED',
      errorMessage: error.message || String(error),
    });
  });
}

module.exports = {
  ARTIFACT_WORKFLOW_POLICY_VERSION,
  ACTIVE_INPUT_STRATEGIES,
  buildCompatibilityReport,
  buildExpectedLineages,
  compatibilityMotionPrompt,
  capabilityRegistry,
  assessUnitCapabilities,
  assertComposeCompatible,
  claimUnitAttempts,
  finishUnitAttempts,
  failUnitAttempts,
};
