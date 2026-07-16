const assert = require('assert');
const lineageService = require('../src/services/newStoryAd/videoLineageService');
const repairPolicy = require('../src/services/newStoryAd/videoRepairPolicy');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');

function fixture(overrides = {}) {
  const shot = { id: 's-1', title: '任务自定义镜头', visual: '任务给定主体位于任务给定环境', action: '主体完成任务指定动作', duration: 5, characters: ['角色甲'] };
  const contract = {
    contract_fingerprint: 'contract-v1',
    scene_lock: { scene_id: 'scene-a', anchors: ['anchor-a'] },
    cast_lock: { person_contract: { person_fingerprint: 'person-v1', person_revision: 1 } },
    product_lock: { product_fingerprint: 'product-v1', product_revision: 1 },
  };
  const keyframe = { image_url: '/api/new-story-ad/assets/frame-a.png', current_generation_id: 'g-1', contract_fingerprint: 'contract-v1', current_generation_status: 'accepted' };
  const ctx = { revisions: { source: 1, scene: 1, person: 1, product: 1 }, output_ratio: '9:16', video_resolution: '720p' };
  const motionPrompt = videoAdapter.clipPrompt(shot, ctx, contract, null, keyframe);
  return lineageService.buildShotLineage({ shot, index: 0, contract, keyframe, ctx, blueprint: { revision: 1, fingerprint: 'bp-1' }, storyboardMeta: { revision: 1 }, modelRoute: 'provider/model', speechMode: 'silent', motionPrompt, audio: {}, ...overrides });
}

function run() {
  const expected = fixture();
  const approved = lineageService.attachLineage({ file_path: __filename, provider_used: 'provider/model', qa: { pass: true }, motion_prompt: 'irrelevant-after-lineage' }, expected);
  assert.deepStrictEqual(lineageService.reuseDecision(approved, expected), { reusable: true, reason: 'lineage_match' });

  const changedScene = fixture({ contract: { contract_fingerprint: 'contract-v2', scene_lock: { scene_id: 'scene-b' } } });
  assert.strictEqual(lineageService.reuseDecision(approved, changedScene).reusable, false, 'scene/contract change must invalidate only the affected clip');

  const baseShot = { id: 's-1', title: '任务自定义镜头', visual: '任务给定主体位于任务给定环境', action: '主体完成任务指定动作', duration: 5, characters: ['角色甲'] };
  const baseContract = { contract_fingerprint: 'contract-v1', scene_lock: { scene_id: 'scene-a', anchors: ['anchor-a'] }, cast_lock: { person_contract: { person_fingerprint: 'person-v1', person_revision: 1 } }, product_lock: { product_fingerprint: 'product-v1', product_revision: 1 } };
  const baseKeyframe = { image_url: '/api/new-story-ad/assets/frame-a.png', current_generation_id: 'g-1', contract_fingerprint: 'contract-v1', current_generation_status: 'accepted' };
  const baseCtx = { revisions: { source: 1, scene: 1, person: 1, product: 1 }, output_ratio: '9:16', video_resolution: '720p' };
  const legacyPrompt = videoAdapter.clipPrompt(baseShot, baseCtx, baseContract, null, baseKeyframe);
  const legacy = { file_path: __filename, provider_used: 'provider/model', qa: { pass: true, contract_fingerprint: 'contract-v1' }, motion_prompt: legacyPrompt };
  assert.strictEqual(lineageService.reuseDecision(legacy, expected).adopted, true, 'matching legacy output should be safely adopted');
  assert.strictEqual(lineageService.reuseDecision({ ...legacy, motion_prompt: `${legacyPrompt}\nchanged` }, expected).reusable, false, 'unverifiable legacy prompt must not be reused');

  const oldBlockLineage = fixture({ sceneBlock: { policy_version: 'spatial-scene-block-v1', id: 'old-1-3', fingerprint: 'old-block', member_indexes: [0, 1, 2] } });
  const independentLineage = fixture({ sceneBlock: { policy_version: 'spatial-scene-block-v2', id: 'new-1', fingerprint: 'new-block', member_indexes: [0] } });
  const topologyApproved = lineageService.attachLineage({ file_path: __filename, provider_used: 'provider/model', qa: { pass: true } }, oldBlockLineage);
  const topologyDecision = lineageService.reuseDecision(topologyApproved, independentLineage);
  assert.strictEqual(topologyDecision.adopted, true, 'QA-approved split clips should survive a safer scene-block topology change');
  const pendingQaClip = lineageService.attachLineage({ file_path: __filename, provider_used: 'provider/model' }, oldBlockLineage);
  assert.strictEqual(lineageService.reviewableDecision(pendingQaClip, independentLineage).reviewable, true, 'completed paid output should be reviewed before any regeneration');

  const failures = [
    { index: 2, kind: 'frame_qa', dimensions: ['person_identity'], labels_zh: ['人物身份与造型'], problems: ['identity drift'], retry_instruction: 'restore current contract identity' },
    { index: 2, kind: 'cross_shot_qa', dimensions: ['screen_direction'], labels_zh: ['运动与视线方向连续性'], problems: ['direction changed'] },
  ];
  const plan = repairPolicy.buildRepairPlan(failures, { attempt: 0, maxAttempts: 2 });
  assert.strictEqual(plan.can_retry, true);
  assert.deepStrictEqual(plan.indexes, [2]);
  assert.ok(plan.instructions[2].includes('person_identity'));
  assert.ok(plan.instructions[2].includes('screen_direction'));
  assert.strictEqual(repairPolicy.buildRepairPlan(failures, { attempt: 2, maxAttempts: 2 }).can_retry, false);
  assert.strictEqual(repairPolicy.buildRepairPlan([{ index: 0, kind: 'provider_error', repairable: false }], { attempt: 0, maxAttempts: 2 }).can_retry, false, 'provider/compliance errors must not be bypassed by QA retry');
  assert.strictEqual(repairPolicy.resolveRepairBudget({}), 1, 'default automatic repair budget must be one targeted pass');
  assert.strictEqual(repairPolicy.buildRepairPlan([{ index: 0, kind: 'frame_qa', dimensions: ['people_count'] }], { attempt: 0, maxAttempts: 1 }).can_retry, false, 'deterministic people-count failures must stop instead of spending another video call');

  const customTerms = JSON.stringify({ expected, plan });
  ['不锈钢', '家居', '佛山', '广告行业模板'].forEach(term => assert.ok(!customTerms.includes(term), `pipeline must not hardcode ${term}`));
  console.log('new story ad video lineage + repair tests passed');
}

run();
