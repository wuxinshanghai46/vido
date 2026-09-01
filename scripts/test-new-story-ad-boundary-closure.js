#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-boundary-closure-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const boundaries = require('../src/services/newStoryAd/videoBoundaryPolicyService');
const preflight = require('../src/services/newStoryAd/videoPreflightService');
const boundaryRepair = require('../src/services/newStoryAd/videoBoundaryRepairService');
const boundaryGeneration = require('../src/services/newStoryAd/videoBoundaryGenerationService');
const videoFailureRecovery = require('../src/services/newStoryAd/videoFailureRecoveryService');
const videoFrameQa = require('../src/services/newStoryAd/videoFrameQaService');
const videoLineage = require('../src/services/newStoryAd/videoLineageService');
const audioProduction = require('../src/services/newStoryAd/audioProductionService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');

const clip = (index, block, cross = undefined) => ({
  shot_index: index,
  video_url: `/shot-${index + 1}.mp4`,
  lineage_fingerprint: `lineage-${index + 1}`,
  scene_block_id: block,
  qa: { pass: true, frames: [{ image_url: `/shot-${index + 1}-head.jpg`, second: 0 }, { image_url: `/shot-${index + 1}-tail.jpg`, second: 4.95 }] },
  ...(cross === undefined ? {} : { cross_shot_qa: { pass: cross } }),
});

async function main() {
  const clips = [clip(0, 'block-a'), clip(1, 'block-b', true), clip(2, 'block-b'), clip(3, 'block-c')];
  clips[1].cross_shot_qa = boundaries.bindBoundaryQa(clips[1].cross_shot_qa, clips[0], clips[1]);
  const audit = boundaries.audit(clips, 4);
  assert.deepStrictEqual(audit.missing_indexes, [3], 'the first clip of a new generation unit must have an explicit boundary verdict');
  assert.deepStrictEqual(boundaries.requiredBoundaryIndexes(clips, [3]), [3], 'a successful shot re-review must schedule its previous cross-unit boundary');
  assert.deepStrictEqual(boundaries.requiredBoundaryIndexes(clips, [2]), [3], 're-reviewing the previous shot must also schedule the following cross-unit boundary');
  assert.deepStrictEqual(videoFrameQa.boundaryEvidenceIndexes({ clips: Array(6).fill({}), targetIndexes: [4] }), [3, 5], 'scoped paid generation must prefill both reused neighbors before provider submission');
  assert.deepStrictEqual(videoFrameQa.boundaryEvidenceIndexes({ clips: Array(6).fill({}), targetIndexes: [5], includeTargetIndexes: [5] }), [4, 5], 'review-only recovery must prefill the reused target itself and its previous neighbor');

  const shots = Array.from({ length: 4 }, (_, index) => ({ index: index + 1, title: `镜头 ${index + 1}`, duration: 5, scene_id: 'scene-a', visual: `画面 ${index + 1}`, action: '轻微动作' }));
  const keyframes = shots.map((_, index) => ({ image_url: `/frame-${index + 1}.jpg`, qa: { pass: true, person: { person_presence: 'none' } } }));
  const plan = preflight.buildVideoPreflight({ taskId: 'boundary-preflight', shots, keyframes, contracts: [{}, {}, {}, {}], clips, statuses: [], mode: 'economy' });
  const boundaryReview = plan.shots.find(item => item.index === 3);
  assert.strictEqual(boundaryReview.action, 'review_only');
  assert.strictEqual(boundaryReview.review_scope, 'cross_shot');
  assert.strictEqual(boundaryReview.paid, false);
  assert.strictEqual(plan.paid_unit_count, 0, 'closing a missing QA boundary must not regenerate video');

  const staleClips = clips.map((item, index) => index === 3 ? { ...item, error_code: 'VIDEO_LINEAGE_MISMATCH' } : item);
  const stalePlan = preflight.buildVideoPreflight({ taskId: 'boundary-stale-media', shots, keyframes, contracts: [{}, {}, {}, {}], clips: staleClips, statuses: [], mode: 'economy' });
  assert.strictEqual(stalePlan.shots.find(item => item.index === 3).action, 'provider_generate', 'missing boundary review must not override an independent regeneration reason');

  storyAd.createTask({ task_id: 'boundary-compose-block', brief: '跨生成单元封装门禁回归', shot_design_confirmed: true }, { id: 'owner-1' });
  storage.saveOutput('boundary-compose-block', 'context', { brief: '跨生成单元封装门禁回归', shot_design_confirmed: true });
  storage.saveOutput('boundary-compose-block', 'storyboard_table', shots);
  storage.saveOutput('boundary-compose-block', 'storyboard_images', shots.map((_, index) => {
    const filename = `boundary-compose-storyboard-${index + 1}.png`;
    const filePath = mediaAdapter.assetPathFromName(filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `confirmed-storyboard-${index + 1}`);
    return { shot_index: index + 1, image_url: `/api/new-story-ad/assets/${filename}`, subject_qa_policy_version: 2, subject_count_qa: { pass: true } };
  }));
  storage.saveOutput('boundary-compose-block', 'video_clips', clips);
  audioProduction.savePlan('boundary-compose-block', { include_voiceover: false, subtitle: true });
  audioProduction.confirm('boundary-compose-block', { id: 'owner-1' });
  await assert.rejects(
    () => storyAd.composeStage('boundary-compose-block', {}),
    error => error.code === 'COMPOSE_VIDEO_ARTIFACT_INCOMPATIBLE',
  );
  assert.strictEqual(storage.getOutput('boundary-compose-block', 'final_video'), null, 'blocked composition must not create or overwrite final output');

  const rejectedClips = clips.map((item, index) => index === 3 ? { ...item, cross_shot_qa: {
    pass: false,
    failure_labels_zh: ['运动与视线方向连续性', '动作承接连续性'],
    failure_dimensions: ['screen_direction', 'action_continuity'],
    problems: ['hand position changed', 'action restarted'],
    retry_instruction: 'Preserve the hand contact and continue the same movement.',
  }, error_code: 'CROSS_SHOT_CONTINUITY_FAILED' } : item);
  const repairPlan = preflight.buildVideoPreflight({
    taskId: 'boundary-repair', shots, keyframes, contracts: [{}, {}, {}, {}], clips: rejectedClips, statuses: [],
    mode: 'economy', providerRoute: 'deyunai/doubao-seedance-2-0-260128', onlyIndexes: [3],
  });
  assert.strictEqual(repairPlan.status, 'ready');
  assert.strictEqual(repairPlan.paid_unit_count, 0, 'individually approved clips with only a boundary failure must not be regenerated');
  assert.strictEqual(repairPlan.units[0].action, 'transition_bridge');
  assert.strictEqual(repairPlan.units[0].transition_override, 'dissolve');
  assert.strictEqual(repairPlan.zero_cost_action_count, 1);
  assert.deepStrictEqual(repairPlan.boundary_repair_contracts, {}, 'an empty paid scope must not expand back to all failed boundaries');
  const adoptedPrevious = clip(0, 'lineage-order-a');
  const adoptedCurrent = videoLineage.adoptExpectedLineage(clip(1, 'lineage-order-b'), { fingerprint: 'current-lineage-after-adoption' });
  adoptedCurrent.cross_shot_qa = boundaries.deterministicTransitionQa(adoptedPrevious, adoptedCurrent, 'fade');
  assert.strictEqual(boundaries.audit([adoptedPrevious, adoptedCurrent], 2).ready, true, 'deterministic QA must bind the final adopted lineage instead of becoming stale immediately');

  const providerRepairClips = rejectedClips.map((item, index) => index === 3 ? {
    ...item,
    qa: { pass: false, failure_dimensions: ['person_identity', 'action_fulfillment'] },
    error_code: 'VIDEO_FRAME_QA_FAILED',
  } : item);
  const rawDirectContract = boundaryRepair.buildContract({
    clips: providerRepairClips, shots, keyframes,
    contracts: shots.map(() => ({ scene_lock: { scene_id: 'scene-a', scene_revision: 1 } })), index: 3,
  });
  rawDirectContract.input_strategy = boundaryRepair.DIRECT_TAIL_FIRST_FRAME;
  const unsafeDirectRepairPlan = preflight.buildVideoPreflight({
    taskId: 'boundary-repair-provider', shots, keyframes, contracts: shots.map(() => ({ scene_lock: { scene_id: 'scene-a', scene_revision: 1 } })),
    clips: providerRepairClips, statuses: [], mode: 'economy', providerRoute: 'deyunai/doubao-seedance-2-0-260128', onlyIndexes: [3],
  });
  assert.strictEqual(unsafeDirectRepairPlan.status, 'ready', 'an unsafe tail-only repair must fall back to the current approved keyframe plus an intentional transition');
  assert.strictEqual(unsafeDirectRepairPlan.paid_unit_count, 1);
  assert.strictEqual(unsafeDirectRepairPlan.units[0].input_strategy, 'approved_keyframe_first_frame_only');
  assert.strictEqual(unsafeDirectRepairPlan.units[0].review_scope, 'post_generation_deterministic_transition');
  assert.strictEqual(unsafeDirectRepairPlan.units[0].transition_override, 'fade');
  assert.strictEqual(unsafeDirectRepairPlan.units[0].boundary_resolution, 'keyframe_regenerate_with_transition');
  assert.strictEqual(unsafeDirectRepairPlan.paid_transition_fallback_count, 1);
  assert.deepStrictEqual(unsafeDirectRepairPlan.boundary_repair_contracts, {});
  assert.deepStrictEqual(unsafeDirectRepairPlan.blockers, []);
  const qualityExpandedPlan = preflight.buildVideoPreflight({
    taskId: 'boundary-repair-quality-expanded', shots, keyframes, contracts: shots.map(() => ({ scene_lock: { scene_id: 'scene-a', scene_revision: 1 } })),
    clips: providerRepairClips, statuses: [], mode: 'quality', providerRoute: 'deyunai/doubao-seedance-2-0-260128', onlyIndexes: [3],
  });
  assert.strictEqual(qualityExpandedPlan.status, 'ready', 'quality mode must isolate the failed shot instead of expanding it into an unanchored multi-shot unit');
  assert.strictEqual(qualityExpandedPlan.paid_unit_count, 1);
  assert.deepStrictEqual(qualityExpandedPlan.units[0].shots, [4]);
  assert.strictEqual(qualityExpandedPlan.paid_transition_fallback_count, 1);
  assert.deepStrictEqual(qualityExpandedPlan.blockers, []);
  await assert.rejects(
    () => boundaryGeneration.prepareInputs({
      taskId: 'unsafe-no-person-tail-hard-gate', index: 3, keyframe: keyframes[3],
      contract: {
        ...rawDirectContract,
        direct_tail_capability: { safe: true, reasons: [] },
      },
      pinnedModelRoute: 'deyunai/doubao-seedance-2-0-260128', options: {},
    }),
    error => error?.code === 'VIDEO_BOUNDARY_REPAIR_TAIL_INSUFFICIENT',
    'a stale or forged safe flag must not bypass the provider hard gate',
  );
  const managedRepairPlan = preflight.buildVideoPreflight({
    taskId: 'boundary-repair-managed', shots, keyframes, contracts: shots.map(() => ({ scene_lock: { scene_id: 'scene-a', scene_revision: 1 } })), clips: providerRepairClips, statuses: [],
    mode: 'economy', providerRoute: 'deyunai/doubao-seedance-2-0-260128', providerId: 'deyunai', modelId: 'doubao-seedance-2-0-260128', providerCapabilityRegistry: { 'deyunai/doubao-seedance-2-0-260128': { private_asset: 'supported' } }, onlyIndexes: [3], executionOptions: { boundary_repair_input_mode: 'managed_dual_reference' },
  });
  assert.strictEqual(managedRepairPlan.units[0].input_strategy, 'approved_keyframe_and_previous_tail_private_assets');
  assert.strictEqual(managedRepairPlan.status, 'ready', 'the verified dual-reference path must remain available');
  assert.match(managedRepairPlan.repair_instructions[3], /Reference image 2 is the actual tail frame/);
  assert.deepStrictEqual(videoFailureRecovery.rollbackIndexes({ generationError: new Error('pre-submit failure'), unitIndexes: [3, 4], remainingUnits: [{ member_indexes: [5] }] }), [3, 4, 5]);
  assert.deepStrictEqual(videoFailureRecovery.rollbackIndexes({ unitIndexes: [3, 4], remainingUnits: [{ member_indexes: [5] }] }), [3, 4, 5], 'QA failure must restore the current unit and protect later untouched clips');
  const overwritten = ['new-1', 'new-2', null, null], previous = ['old-1', 'old-2', 'old-3', 'old-4'];
  videoFailureRecovery.restorePreviousClips({ clips: overwritten, previousClips: previous, indexes: [0, 1, 2, 3] });
  assert.deepStrictEqual(overwritten, previous, 'a pre-submission failure must restore every paid clip reference from the preflight snapshot');
  const recoveredClips = ['new-paid'], recoveryWrites = [];
  videoFailureRecovery.restoreUnitFailure({
    storage: {
      getOutput: () => ({ provider_task_id: 'paid-provider-task', provider_submission_state: 'completed', billing_state: 'confirmed' }),
      saveOutput: (_taskId, _kind, value) => { assert.strictEqual(value, recoveredClips); },
    },
    videoAdapter: { updateVideoShotStatus: (_taskId, index, patch) => recoveryWrites.push({ index, patch }) },
    taskId: 'recovery-accounting', clips: recoveredClips, previousClips: ['old-approved'], unitIndexes: [0], totalShots: 1,
  });
  assert.deepStrictEqual(recoveredClips, ['old-approved']);
  assert.strictEqual(recoveryWrites[0].patch.last_attempt_billing_state, 'confirmed', 'QA rollback must not rewrite an already billed success as not_submitted');
  const mixedRecoveryClips = ['new-failed', 'untouched-old'], mixedWrites = [];
  videoFailureRecovery.restoreUnitFailure({
    storage: {
      getOutput: (_taskId, kind) => kind.endsWith('_1')
        ? { lifecycle: 'failed', error_code: 'INPUT_PERSON_PRIVACY', provider_submission_state: 'not_submitted', billing_state: 'not_submitted' }
        : { lifecycle: 'qa_passed', qa_status: 'passed', provider_task_id: 'old-shot-2' },
      saveOutput: () => {},
    },
    videoAdapter: { updateVideoShotStatus: (_taskId, index, patch) => mixedWrites.push({ index, patch }) },
    taskId: 'recovery-fail-fast-attribution', clips: mixedRecoveryClips, previousClips: ['old-failed-shot', 'untouched-old'],
    unitIndexes: [0], remainingUnits: [{ member_indexes: [1] }], totalShots: 2,
  });
  assert.strictEqual(mixedWrites[0].patch.last_attempt_error_code, undefined);
  assert.strictEqual(mixedWrites[0].patch.last_attempt_provider_submission_state, 'not_submitted');
  assert.strictEqual(mixedWrites[1].patch.last_attempt_provider_submission_state, undefined, 'untouched later unit must not be recorded as a failed attempt');
  assert.strictEqual(mixedWrites[1].patch.previous_clip_restored, undefined);
  assert.strictEqual(videoFailureRecovery.shouldRestoreUnitFailure({ generationError: new Error('provider failed'), unitIndexes: [4], qaFailures: [] }), true);
  assert.strictEqual(videoFailureRecovery.shouldRestoreUnitFailure({ unitIndexes: [4], qaFailures: [{ index: 4, kind: 'frame_qa' }] }), true, 'single-shot QA failure must still restore the previous approved clip');
  assert.strictEqual(videoFailureRecovery.shouldRestoreUnitFailure({ unitIndexes: [4], qaFailures: [{ index: 4, kind: 'cross_shot_qa' }] }), false, 'an upstream boundary failure must preserve the newly paid single-shot success');
  assert.strictEqual(videoFailureRecovery.shouldRestoreUnitFailure({ unitIndexes: [4], qaFailures: [{ index: 5, kind: 'cross_shot_qa' }] }), false, 'a downstream boundary failure must not overwrite the newly paid single-shot success');

  const partialToFullKeyframes = keyframes.map((item, index) => index === 2
    ? { ...item, qa: { pass: true, person: { person_presence: 'partial' } } }
    : (index === 3 ? { ...item, qa: { pass: true, person: { person_presence: 'person' } } } : item));
  const personContracts = shots.map(() => ({
    scene_lock: { scene_id: 'scene-a', scene_revision: 1 },
    cast_lock: { person_contract: { person_id: 'actor-1', person_revision: 1, wardrobe_fingerprint: 'dark-red-dress' } },
  }));
  const unsafeTailPlan = preflight.buildVideoPreflight({
    taskId: 'boundary-repair-unsafe-tail', shots, keyframes: partialToFullKeyframes, contracts: personContracts,
    clips: providerRepairClips, statuses: [], mode: 'economy', providerRoute: 'deyunai/doubao-seedance-2-0-260128', onlyIndexes: [3],
  });
  assert.strictEqual(unsafeTailPlan.status, 'ready');
  assert.strictEqual(unsafeTailPlan.units[0].input_strategy, 'approved_keyframe_first_frame_only');
  assert.strictEqual(unsafeTailPlan.units[0].transition_override, 'fade');
  const rawPersonContract = boundaryRepair.buildContract({ clips: providerRepairClips, shots, keyframes: partialToFullKeyframes, contracts: personContracts, index: 3 });
  rawPersonContract.input_strategy = boundaryRepair.DIRECT_TAIL_FIRST_FRAME;
  assert(rawPersonContract.direct_tail_capability.reasons.includes('partial_tail_cannot_lock_full_person'));
  await assert.rejects(
    () => boundaryGeneration.prepareInputs({
      taskId: 'unsafe-tail-hard-gate', index: 3, keyframe: partialToFullKeyframes[3],
      contract: rawPersonContract, pinnedModelRoute: 'deyunai/doubao-seedance-2-0-260128', options: {},
    }),
    error => error?.code === 'VIDEO_BOUNDARY_REPAIR_TAIL_INSUFFICIENT',
    'provider adapter must reject an unsafe tail even if preflight is bypassed',
  );

  const partialPersonKeyframes = keyframes.map((item, index) => [2, 3].includes(index)
    ? { ...item, qa: { pass: true, person: { person_presence: 'partial' } } }
    : item);
  const partialTailPlan = preflight.buildVideoPreflight({
    taskId: 'boundary-repair-partial-person', shots, keyframes: partialPersonKeyframes, contracts: personContracts,
    clips: providerRepairClips, statuses: [], mode: 'economy', providerRoute: 'deyunai/doubao-seedance-2-0-260128', onlyIndexes: [3],
  });
  assert.strictEqual(partialTailPlan.status, 'ready', 'partial-person shots must also use the approved current keyframe fallback');
  assert.strictEqual(partialTailPlan.units[0].input_strategy, 'approved_keyframe_first_frame_only');

  const legacyPollutedClips = providerRepairClips.map((item, index) => index === 3 ? {
    ...item,
    cross_shot_qa: undefined,
    seedance_input_mode: 'previous_unit_tail_first_frame',
    boundary_repair_fingerprint: 'legacy-boundary-attempt',
  } : item);
  const legacyPollutedPlan = preflight.buildVideoPreflight({
    taskId: 'legacy-polluted-boundary-retry', shots, keyframes: partialPersonKeyframes, contracts: personContracts,
    clips: legacyPollutedClips, statuses: [], mode: 'economy', providerRoute: 'deyunai/doubao-seedance-2-0-260128', onlyIndexes: [3],
  });
  assert.strictEqual(legacyPollutedPlan.status, 'ready', 'a persisted failed direct-tail candidate must use the keyframe-plus-transition recovery path');
  assert.strictEqual(legacyPollutedPlan.paid_unit_count, 1, 'the single paid current-shot generation remains visible for cost disclosure');
  assert.strictEqual(legacyPollutedPlan.units[0].input_strategy, 'approved_keyframe_first_frame_only');
  assert.strictEqual(legacyPollutedPlan.units[0].transition_override, 'fade');
  assert.strictEqual(legacyPollutedPlan.automatic_retry_count, 0);
  assert.deepStrictEqual(legacyPollutedPlan.blockers, []);

  const missingEvidence = providerRepairClips.map((item, index) => index === 2 ? { ...item, qa: { ...item.qa, frames: [] } } : item);
  const missingEvidencePlan = preflight.buildVideoPreflight({
    taskId: 'boundary-repair-missing', shots, keyframes, contracts: shots.map(() => ({ scene_lock: { scene_id: 'scene-a', scene_revision: 1 } })), clips: missingEvidence, statuses: [],
    mode: 'economy', providerRoute: 'deyunai/doubao-seedance-2-0-260128', onlyIndexes: [3],
  });
  assert.strictEqual(missingEvidencePlan.status, 'ready', 'the independent current-keyframe fallback must not require a previous-tail asset');
  assert.strictEqual(missingEvidencePlan.units[0].input_strategy, 'approved_keyframe_first_frame_only');

  const unsupportedPlan = preflight.buildVideoPreflight({
    taskId: 'boundary-repair-unsupported', shots, keyframes, contracts: shots.map(() => ({ scene_lock: { scene_id: 'scene-a', scene_revision: 1 } })), clips: providerRepairClips, statuses: [],
    mode: 'economy', providerRoute: 'other/image-to-video', onlyIndexes: [3], executionOptions: { boundary_repair_input_mode: 'managed_dual_reference' },
  });
  assert.strictEqual(unsupportedPlan.status, 'blocked');
  assert(unsupportedPlan.blockers.some(item => item.code === 'VIDEO_BOUNDARY_REPAIR_MODEL_UNSUPPORTED'));

  const longClips = Array.from({ length: 18 }, (_, index) => clip(index, `block-${index}`));
  const longShots = Array.from({ length: 18 }, (_, index) => ({ title: `Shot ${index + 1}`, action: `Action ${index + 1}` }));
  [1, 9, 17].forEach(index => {
    longClips[index].cross_shot_qa = { pass: false, failure_dimensions: ['action_continuity'], problems: [`boundary-${index}`] };
  });
  const longContracts = boundaryRepair.buildContracts({ clips: longClips, shots: longShots, indexes: [1, 9, 17] });
  assert.strictEqual(Object.keys(longContracts).length, 3, 'maximum storyboard indexes must keep independent boundary repair contracts');
  assert.strictEqual(new Set(Object.values(longContracts).map(item => item.fingerprint)).size, 3, 'concurrent boundary repairs must not reuse another boundary fingerprint');
  const oversized = boundaryRepair.buildContract({
    clips: [clip(0, 'long-a'), { ...clip(1, 'long-b'), cross_shot_qa: { pass: false, failure_dimensions: Array(20).fill('x'.repeat(200)), problems: Array(20).fill('problem'.repeat(200)), retry_instruction: 'retry'.repeat(1000) } }],
    shots: [{ exit_frame_state: 'exit'.repeat(500) }, { entry_frame_state: 'entry'.repeat(500) }], index: 1,
  });
  assert(oversized.qa_retry_instruction.length <= 500 && oversized.problems.length <= 8 && oversized.problems.every(item => item.length <= 240));
  assert(boundaryRepair.repairInstruction(oversized).length < 4000, 'extreme QA evidence must not crowd the provider prompt beyond its safe budget');
  storage.saveOutput('boundary-compose-block', 'video_clips', rejectedClips);
  storage.updateTask('boundary-compose-block', { status: 'failed', stage: 'media_failed', error: '当前版本仍有未审片或来源不匹配的镜头：第 4 镜', error_code: 'COMPOSE_CLIP_LINEAGE_INVALID' });
  const restored = storyAd.publicTaskBundle('boundary-compose-block');
  assert.strictEqual(restored.task.error_code, 'COMPOSE_CLIP_LINEAGE_INVALID', 'stale unbound boundary evidence must not override the stricter lineage failure');

  const source = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/storyAdService.js'), 'utf8');
  assert(source.includes('videoBoundaryPolicy.requiredBoundaryIndexes(clips, reviewedIndexes)'), 'shot re-review must automatically close adjacent required boundaries');
  assert(source.includes('let qaFailures = pendingReviewFailures.slice()'), 'a failed zero-cost boundary review must become a video QA failure instead of a partial success');
  assert(source.includes('if (pendingReviewFailures.length) { initialIndexes.forEach'), 'a failed review must stop later paid generation units and preserve their existing clips');
  assert(source.includes('videoFailureRecovery.restoreUnitFailure({'), 'the orchestrator must apply atomic current-unit rollback after provider or QA failure');
  assert(source.includes('videoBoundaryPolicy.usesDeterministicTransition(planned)'), 'zero-cost and post-generation transitions must share the deterministic boundary verdict');
  assert(source.indexOf('adopted_before_boundary_review: true') < source.indexOf('const pendingFailures = await reviewVideoIndexes'), 'review-only lineage adoption must happen before boundary QA binding');
  const composeSource = source.slice(source.indexOf('async function composeStage('), source.indexOf('function mediaDependencyReady('));
  assert(composeSource.indexOf('videoBoundaryPolicy.audit') < composeSource.indexOf('const unapproved ='), 'composition must report a failed boundary before the generic lineage gate');
  console.log('new story ad boundary closure: ok');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
