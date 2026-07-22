#!/usr/bin/env node
const assert = require('assert');
const lineage = require('../src/services/newStoryAd/videoLineageService');
const boundaries = require('../src/services/newStoryAd/videoBoundaryPolicyService');
const workflow = require('../src/services/newStoryAd/videoArtifactWorkflowService');
const preflight = require('../src/services/newStoryAd/videoPreflightService');
const frameQa = require('../src/services/newStoryAd/videoFrameQaService');

const shots = Array.from({ length: 6 }, (_, index) => ({ id: `shot-${index + 1}`, title: `第 ${index + 1} 镜`, visual: `画面 ${index + 1}`, action: `动作 ${index + 1}`, duration: 5 }));
const keyframes = shots.map((_, index) => ({ image_url: `/frame-${index + 1}.jpg`, current_generation_id: `kf-${index + 1}`, current_generation_status: 'accepted', qa: { pass: true, person: { person_presence: 'none' } } }));
const contracts = shots.map((_, index) => ({ contract_revision: 1, scene_lock: { scene_id: `scene-${index + 1}`, scene_revision: 1 } }));
const ctx = { revisions: { source: 1, scene: 1, person: 1, product: 1 }, output_ratio: '9:16', video_resolution: '720p' };
const block = index => ({ policy_version: 'test-single-v1', id: `block-${index + 1}`, fingerprint: `block-fp-${index + 1}`, member_indexes: [index] });
const expected = shots.map((shot, index) => lineage.buildShotLineage({
  shot, index, contract: contracts[index], keyframe: keyframes[index], ctx,
  modelRoute: 'deyunai/doubao-seedance-2-0-260128', motionPrompt: `motion-${index + 1}`,
  sceneBlock: block(index), inputStrategy: 'approved_keyframe_first_frame_only',
  qaPolicyVersion: frameQa.VIDEO_FRAME_QA_POLICY_VERSION,
}));
const oldFrame5Lineage = lineage.buildShotLineage({
  shot: shots[4], index: 4, contract: contracts[4], keyframe: keyframes[4], ctx,
  modelRoute: 'deyunai/doubao-seedance-2-0-260128', motionPrompt: 'motion-5',
  sceneBlock: { policy_version: 'legacy-continuous-v1', id: 'legacy-4-5', fingerprint: 'legacy-4-5', member_indexes: [3, 4] },
  inputStrategy: 'previous_unit_tail_first_frame', qaPolicyVersion: '',
});
const clips = expected.map((item, index) => lineage.attachLineage({
  shot_index: index, file_path: __filename, provider_used: 'deyunai/doubao-seedance-2-0-260128',
  seedance_input_mode: 'approved_keyframe_first_frame_only', qa: { pass: true, qa_policy_version: frameQa.VIDEO_FRAME_QA_POLICY_VERSION },
}, item));
clips[4] = lineage.attachLineage({
  shot_index: 4, file_path: __filename, provider_used: 'deyunai/doubao-seedance-2-0-260128',
  seedance_input_mode: 'previous_unit_tail_first_frame', boundary_repair_fingerprint: 'legacy-tail-repair', qa: null, cross_shot_qa: null,
  scene_block_members: [4, 5],
}, oldFrame5Lineage);
for (let index = 1; index < clips.length; index += 1) {
  if (index === 4) continue;
  clips[index].cross_shot_qa = boundaries.bindBoundaryQa({ pass: true }, clips[index - 1], clips[index]);
}

const report = workflow.buildCompatibilityReport({ clips, expectedLineages: expected, onlyIndexes: [4] });
assert.strictEqual(report.decisions[0].status, 'regenerate_required');
assert(report.decisions[0].reason_codes.includes('INPUT_STRATEGY_RETIRED'));
const plan = preflight.buildVideoPreflight({
  taskId: 'frame5-current-flow', shots, keyframes, contracts, clips, statuses: [], ctx,
  mode: 'economy', providerRoute: 'deyunai/doubao-seedance-2-0-260128', providerId: 'deyunai', modelId: 'doubao-seedance-2-0-260128',
  onlyIndexes: [4], compatibilityReport: report,
});
assert.strictEqual(plan.status, 'ready');
assert.strictEqual(plan.paid_unit_count, 1);
assert.strictEqual(plan.paid_video_seconds, 5);
assert.deepStrictEqual(plan.scope.requested_indexes, [4]);
assert.deepStrictEqual(plan.scope.expanded_indexes, [4]);
assert.strictEqual(plan.units[0].input_strategy, 'approved_keyframe_first_frame_only');
assert.strictEqual(plan.units[0].transition_override, 'fade');
assert.strictEqual(plan.units[0].boundary_resolution, 'keyframe_regenerate_with_transition');
assert.deepStrictEqual(plan.keyframe_first_frame_only_indexes, [4]);
assert.deepStrictEqual(plan.keyframe_reference_only_indexes, []);
assert.strictEqual(plan.provider_capability_assessment.ready, true);
assert.deepStrictEqual(plan.provider_capability_assessment.assessments[0].required_capabilities, []);
assert(!plan.blockers.some(item => /PRIVATE_ASSET|ASSET_GROUP/.test(item.code)));
assert(clips.slice(0, 4).every((clip, index) => clip.lineage_fingerprint === expected[index].fingerprint), '第 1-4 镜必须保持原产物');

const prospective = clips.slice();
prospective[4] = lineage.attachLineage({ ...clips[4], qa: { pass: true, qa_policy_version: frameQa.VIDEO_FRAME_QA_POLICY_VERSION }, seedance_input_mode: 'approved_keyframe_first_frame_only' }, expected[4]);
assert.strictEqual(boundaries.boundaryStatus(prospective, 5).status, 'stale', '第 5 镜重生后，旧 5→6 边界证据必须失效并重新审核');
console.log('new story ad frame 5 current-flow regression: ok');
