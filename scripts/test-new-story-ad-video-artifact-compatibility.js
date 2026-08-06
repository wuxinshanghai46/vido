const assert = require('assert');
const revisionService = require('../src/services/newStoryAd/revisionService');
const compatibility = require('../src/services/newStoryAd/videoArtifactCompatibilityService');
const lineage = require('../src/services/newStoryAd/videoLineageService');
const boundaryPolicy = require('../src/services/newStoryAd/videoBoundaryPolicyService');
const composeCompatibility = require('../src/services/newStoryAd/videoComposeCompatibilityService');

function expectedLineage(overrides = {}) {
  return lineage.buildShotLineage({
    shot: { id: 'shot-1', title: 'Current shot', visual: 'Current visual', action: 'Current action', duration_sec: 5 },
    index: 0,
    contract: { contract_fingerprint: 'contract-current' },
    keyframe: { current_generation_id: 'keyframe-current', image_url: '/current.png', current_generation_status: 'accepted' },
    ctx: { revisions: { source: 1, scene: 1, person: 1, product: 1 }, output_ratio: '9:16', video_resolution: '720p' },
    modelRoute: 'deyunai/doubao-seedance-2-0-260128',
    motionPrompt: 'current motion',
    inputStrategy: 'approved_keyframe_first_frame_only',
    boundaryRepairFingerprint: 'boundary-current',
    transitionPolicyVersion: 'deterministic-boundary-transition-v1',
    qaPolicyVersion: 2,
    ...overrides,
  });
}

function clipFor(expected, overrides = {}) {
  return {
    file_path: __filename,
    video_url: '/clip.mp4',
    provider_used: 'deyunai/doubao-seedance-2-0-260128',
    motion_prompt: 'current motion',
    seedance_input_mode: expected.input_strategy,
    qa: { pass: true },
    lineage: expected,
    lineage_fingerprint: expected.fingerprint,
    ...overrides,
  };
}

assert.strictEqual(compatibility.qaState({ pass: true }), compatibility.QA_STATE.APPROVED);
assert.strictEqual(compatibility.qaState({ pass: false }), compatibility.QA_STATE.REJECTED);
assert.strictEqual(compatibility.qaState(null), compatibility.QA_STATE.MISSING);
assert.strictEqual(compatibility.qaState({ status: 'reviewing' }), compatibility.QA_STATE.MISSING);

const current = expectedLineage();
assert.strictEqual(current.input_strategy, 'approved_keyframe_first_frame_only');
assert.strictEqual(current.boundary_repair_fingerprint, 'boundary-current');
assert.strictEqual(current.transition_policy_version, 'deterministic-boundary-transition-v1');
assert.strictEqual(current.qa_policy_version, 2);
const changedInput = expectedLineage({ inputStrategy: 'approved_keyframe_private_reference_only' });
const changedBoundary = expectedLineage({ boundaryRepairFingerprint: 'boundary-other' });
const changedTransition = expectedLineage({ transitionPolicyVersion: 'transition-v2' });
const changedQaPolicy = expectedLineage({ qaPolicyVersion: 3 });
assert.notStrictEqual(current.fingerprint, changedInput.fingerprint);
assert.notStrictEqual(current.fingerprint, changedBoundary.fingerprint);
assert.notStrictEqual(current.fingerprint, changedTransition.fingerprint);
assert.strictEqual(current.fingerprint, changedQaPolicy.fingerprint, 'QA-only policy changes must not invalidate paid generation lineage');
assert.notStrictEqual(current.qa_fingerprint, changedQaPolicy.qa_fingerprint);
assert.strictEqual(current.semantic_lineage_fingerprint, changedInput.semantic_lineage_fingerprint);
assert.strictEqual(current.semantic_lineage_fingerprint, changedBoundary.semantic_lineage_fingerprint);
assert.strictEqual(current.semantic_lineage_fingerprint, changedTransition.semantic_lineage_fingerprint);
assert.strictEqual(current.semantic_lineage_fingerprint, changedQaPolicy.semantic_lineage_fingerprint);

const currentDecision = compatibility.classifyVideoArtifact({
  clip: clipFor(current), expectedLineage: current,
  allowedInputStrategies: ['approved_keyframe_first_frame_only'],
});
assert.strictEqual(currentDecision.status, compatibility.COMPATIBILITY_STATUS.CURRENT);

// A later scoped plan may use a different generation topology. Compose must
// retain the approved clip's producer topology/prompt while still comparing the
// current script, contract, keyframe, revisions, audio and output settings.
{
  const laterPlan = expectedLineage({
    motionPrompt: 'later scoped generation prompt',
    sceneBlock: {
      policy_version: 'continuous-scene-workflow-v6',
      id: 'later-single-shot-block',
      fingerprint: 'later-block-fingerprint',
      member_indexes: [0],
    },
  });
  const produced = expectedLineage({
    motionPrompt: 'original producer prompt',
    sceneBlock: {
      policy_version: 'continuous-scene-workflow-v6',
      id: 'original-block',
      fingerprint: 'original-block-fingerprint',
      member_indexes: [0, 1],
    },
  });
  const clip = clipFor(produced, {
    motion_prompt: 'provider block prompt stored separately',
    scene_block_id: produced.scene_block_id,
    scene_block_fingerprint: produced.scene_block_fingerprint,
    scene_block_members: produced.scene_block_members,
  });
  const rebased = composeCompatibility.rebaseExpectedLineage(laterPlan, clip);
  assert.strictEqual(rebased.fingerprint, produced.fingerprint);

  const changedScript = expectedLineage({
    shot: { id: 'shot-1', title: 'Changed shot', visual: 'Changed visual', action: 'Changed action', duration_sec: 5 },
  });
  const changedRebased = composeCompatibility.rebaseExpectedLineage(changedScript, clip);
  assert.notStrictEqual(changedRebased.fingerprint, produced.fingerprint);
}

// Snapshot-only legacy media can pass compose only through an explicit receipt
// bound to both the current source fingerprint and exact media lineage.
{
  const expected = expectedLineage({ boundaryRepairFingerprint: '', transitionPolicyVersion: '' });
  const receipt = composeCompatibility.createReceipt(expected, expected.fingerprint, { approved_by: 'test' });
  const snapshot = {
    file_path: __filename,
    video_url: '/snapshot.mp4',
    seedance_input_mode: expected.input_strategy,
    lineage_fingerprint: expected.fingerprint,
    qa: { pass: true },
    compose_compatibility_receipt: receipt,
  };
  const status = {
    file_path: __filename,
    file_exists: true,
    video_url: '/snapshot.mp4',
    lifecycle: 'qa_passed',
    qa_status: 'passed',
    lineage_fingerprint: expected.fingerprint,
    error_code: '',
    compose_compatibility_receipt: receipt,
  };
  const accepted = composeCompatibility.buildReport({
    clips: [snapshot],
    statuses: [status],
    expectedLineages: [{ ...expected, fingerprint: 'planner-only-different-fingerprint' }],
  });
  assert.strictEqual(accepted.ready_for_compose, true);
  assert.strictEqual(accepted.decisions[0].compose_receipt_verified, true);

  const changed = expectedLineage({
    shot: { id: 'shot-1', title: 'Changed', visual: 'Changed', action: 'Changed', duration_sec: 5 },
  });
  const rejected = composeCompatibility.buildReport({
    clips: [snapshot],
    statuses: [status],
    expectedLineages: [changed],
  });
  assert.strictEqual(rejected.ready_for_compose, false);
}

const exactStatusSnapshotDecision = compatibility.classifyVideoArtifact({
  clip: {
    file_path: __filename,
    video_url: '/status-snapshot.mp4',
    seedance_input_mode: current.input_strategy,
    lineage_fingerprint: current.fingerprint,
    boundary_repair_fingerprint: current.boundary_repair_fingerprint,
    transition_policy_version: current.transition_policy_version,
    qa_policy_version: current.qa_policy_version,
    qa: { pass: true },
  },
  expectedLineage: current,
  allowedInputStrategies: ['approved_keyframe_first_frame_only'],
});
assert.strictEqual(exactStatusSnapshotDecision.status, compatibility.COMPATIBILITY_STATUS.CURRENT, 'exact full fingerprint is sufficient to recover a verified status snapshot without inventing lineage payload fields');

const metadataExpected = expectedLineage({ boundaryRepairFingerprint: '', transitionPolicyVersion: '', qaPolicyVersion: 0 });
const legacyLineage = { ...metadataExpected };
delete legacyLineage.fingerprint;
delete legacyLineage.semantic_lineage_fingerprint;
compatibility.PRODUCER_LINEAGE_FIELDS.forEach(key => delete legacyLineage[key]);
const legacyLineageFingerprint = revisionService.signature(legacyLineage);
const metadataDecision = compatibility.classifyVideoArtifact({
  clip: clipFor(metadataExpected, {
    lineage: { ...legacyLineage, fingerprint: legacyLineageFingerprint },
    lineage_fingerprint: legacyLineageFingerprint,
    seedance_input_mode: metadataExpected.input_strategy,
  }),
  expectedLineage: metadataExpected,
  allowedInputStrategies: ['approved_keyframe_first_frame_only'],
});
assert.strictEqual(metadataDecision.status, compatibility.COMPATIBILITY_STATUS.METADATA_MIGRATION_READY);
assert(metadataDecision.reason_codes.includes('METADATA_UPGRADE_REQUIRED'));

const pendingQaDecision = compatibility.classifyVideoArtifact({
  clip: clipFor(current, { qa: null }), expectedLineage: current,
  allowedInputStrategies: ['approved_keyframe_first_frame_only'],
});
assert.strictEqual(pendingQaDecision.status, compatibility.COMPATIBILITY_STATUS.REVERIFY_REQUIRED);
assert(pendingQaDecision.reason_codes.includes('QA_MISSING'));

const oldQaPolicyDecision = compatibility.classifyVideoArtifact({
  clip: clipFor(current), expectedLineage: changedQaPolicy,
  allowedInputStrategies: ['approved_keyframe_first_frame_only'],
});
assert.strictEqual(oldQaPolicyDecision.status, compatibility.COMPATIBILITY_STATUS.REVERIFY_REQUIRED);
assert(oldQaPolicyDecision.reason_codes.includes('QA_POLICY_OLD'));

const oldTransitionDecision = compatibility.classifyVideoArtifact({
  clip: clipFor(current), expectedLineage: changedTransition,
  allowedInputStrategies: ['approved_keyframe_first_frame_only'],
});
assert.strictEqual(oldTransitionDecision.status, compatibility.COMPATIBILITY_STATUS.DETERMINISTIC_REPAIR_READY);
assert(oldTransitionDecision.reason_codes.includes('TRANSITION_POLICY_STALE'));

const changedBoundaryDecision = compatibility.classifyVideoArtifact({
  clip: clipFor(current), expectedLineage: changedBoundary,
  allowedInputStrategies: ['approved_keyframe_first_frame_only'],
});
assert.strictEqual(changedBoundaryDecision.status, compatibility.COMPATIBILITY_STATUS.REGENERATE_REQUIRED);
assert(changedBoundaryDecision.reason_codes.includes('BOUNDARY_REPAIR_LINEAGE_MISMATCH'));

const retiredInputDecision = compatibility.classifyVideoArtifact({
  clip: clipFor(current, { seedance_input_mode: 'previous_unit_tail_first_frame', qa: null }),
  expectedLineage: current,
  allowedInputStrategies: ['approved_keyframe_first_frame_only'],
});
assert.strictEqual(retiredInputDecision.status, compatibility.COMPATIBILITY_STATUS.REGENERATE_REQUIRED);
assert(retiredInputDecision.reason_codes.includes('INPUT_STRATEGY_RETIRED'));

const unresolvedBillingDecision = compatibility.classifyVideoArtifact({
  clip: clipFor(current, { billing_state: 'unknown', provider_submission_state: 'submitted' }),
  expectedLineage: current,
});
assert.strictEqual(unresolvedBillingDecision.status, compatibility.COMPATIBILITY_STATUS.BLOCKED);
assert(unresolvedBillingDecision.reason_codes.includes('BILLING_UNRESOLVED'));

const unknownLegacyDecision = compatibility.classifyVideoArtifact({
  clip: clipFor(current, { lineage: undefined, lineage_fingerprint: '' }),
  expectedLineage: current,
});
assert.strictEqual(unknownLegacyDecision.status, compatibility.COMPATIBILITY_STATUS.BLOCKED);
assert(unknownLegacyDecision.reason_codes.includes('PROVENANCE_UNKNOWN'));

const unknownInputDecision = compatibility.classifyVideoArtifact({
  clip: clipFor(metadataExpected, {
    lineage: { ...legacyLineage, fingerprint: legacyLineageFingerprint },
    lineage_fingerprint: legacyLineageFingerprint,
    seedance_input_mode: '',
  }),
  expectedLineage: metadataExpected,
});
assert.strictEqual(unknownInputDecision.status, compatibility.COMPATIBILITY_STATUS.BLOCKED);
assert(unknownInputDecision.reason_codes.includes('INPUT_STRATEGY_UNKNOWN'));

const legacyClip = {
  file_path: __filename,
  video_url: '/legacy.mp4',
  provider_used: current.model_route,
  motion_prompt: 'current motion',
  qa: { pass: true },
};
assert.strictEqual(lineage.reuseDecision(legacyClip, current).reusable, false, 'legacy adoption must be disabled by default');
assert.strictEqual(lineage.reuseDecision(legacyClip, current, { allowLegacyAdoption: true }).reusable, true, 'migration code may explicitly request legacy adoption');

const previousLineage = expectedLineage({ index: 0, boundaryRepairFingerprint: '', transitionPolicyVersion: '' });
const nextLineage = expectedLineage({ index: 1, boundaryRepairFingerprint: '', transitionPolicyVersion: '' });
const previous = clipFor(previousLineage);
const next = clipFor(nextLineage);
const boundQa = boundaryPolicy.bindBoundaryQa({ pass: true, status: 'verified' }, previous, next);
assert.strictEqual(boundQa.previous_lineage_fingerprint, previousLineage.fingerprint);
assert.strictEqual(boundQa.current_lineage_fingerprint, nextLineage.fingerprint);

next.cross_shot_qa = boundQa;
assert.strictEqual(boundaryPolicy.boundaryStatus([previous, next], 1).status, 'passed');
const regeneratedNext = clipFor(expectedLineage({ index: 1, qaPolicyVersion: 3 }), { cross_shot_qa: boundQa });
const stale = boundaryPolicy.boundaryStatus([previous, regeneratedNext], 1);
assert.strictEqual(stale.status, 'stale');
assert.strictEqual(stale.pass, false);
assert(stale.reason_codes.includes('BOUNDARY_CURRENT_LINEAGE_STALE'));

const unboundNext = clipFor(nextLineage, { cross_shot_qa: { pass: true } });
assert.strictEqual(boundaryPolicy.boundaryStatus([previous, unboundNext], 1).status, 'stale');
assert.strictEqual(boundaryPolicy.boundaryStatus([previous, unboundNext], 1, { allowUnboundLegacy: true }).status, 'passed');
const audit = boundaryPolicy.audit([previous, regeneratedNext], 2);
assert.deepStrictEqual(audit.stale_indexes, [1]);
assert.deepStrictEqual(audit.unready_indexes, [1]);

const transitionQa = boundaryPolicy.deterministicTransitionQa(previous, next, 'fade');
assert.strictEqual(transitionQa.pass, true);
assert.strictEqual(transitionQa.previous_lineage_fingerprint, previousLineage.fingerprint);
assert.strictEqual(transitionQa.current_lineage_fingerprint, nextLineage.fingerprint);

assert.strictEqual(
  revisionService.signature(current),
  revisionService.signature({ ...current }),
  'lineage payload must remain deterministic',
);

console.log('new story ad video artifact compatibility: ok');
