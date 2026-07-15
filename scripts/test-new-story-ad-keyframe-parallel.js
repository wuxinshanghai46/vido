#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-parallel-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const scheduler = require('../src/services/newStoryAd/keyframeParallelScheduler');
const service = require('../src/services/newStoryAd/storyAdService');
const storage = require('../src/services/newStoryAd/storageService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const personKeyframeQa = require('../src/services/newStoryAd/personConsistencyQaService');
const productKeyframeQa = require('../src/services/newStoryAd/productConsistencyQaService');
const continuity = require('../src/services/newStoryAd/continuityService');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testDependencyAwareParallelism() {
  const dependencies = { 0: null, 1: 0, 2: null, 3: 2 };
  const events = [];
  let active = 0;
  let peak = 0;
  const schedule = await scheduler.runSchedule({
    indexes: [0, 1, 2, 3],
    concurrency: 2,
    dependencyOf: index => dependencies[index],
    worker: async index => {
      events.push(`start:${index}`);
      active += 1;
      peak = Math.max(peak, active);
      await delay(index % 2 ? 8 : 15);
      active -= 1;
      events.push(`end:${index}`);
      return { index, usable: true };
    },
  });
  assert.strictEqual(peak, 2, '两个独立连续性分支应并行执行');
  assert(events.indexOf('start:1') > events.indexOf('end:0'), '子镜头必须等父镜头验收后启动');
  assert(events.indexOf('start:3') > events.indexOf('end:2'), '另一分支也必须遵守依赖');
  assert.deepStrictEqual(schedule.waves[0].indexes, [0, 2]);
  assert(schedule.waves.slice(1).every(wave => wave.indexes.length === 1), '依赖完成后应按空闲槽位滚动补位');
}

async function testRollingPoolRefillsFreedSlot() {
  const events = [];
  let active = 0;
  let peak = 0;
  const schedule = await scheduler.runSchedule({
    indexes: [0, 1, 2, 3],
    concurrency: 2,
    worker: async index => {
      events.push(`start:${index}`);
      active += 1;
      peak = Math.max(peak, active);
      await delay(index === 1 ? 55 : 8);
      active -= 1;
      events.push(`end:${index}`);
      return { index, usable: true };
    },
  });
  assert.strictEqual(peak, 2);
  assert(events.indexOf('start:2') > events.indexOf('end:0'), '空闲槽位应由下一镜补入');
  assert(events.indexOf('start:2') < events.indexOf('end:1'), '不得等待同批慢任务完成后再补位');
  assert(events.indexOf('start:3') < events.indexOf('end:1'), '连续空闲槽位应持续滚动补位');
  assert(schedule.waves.some(wave => wave.kind === 'rolling'), '调度记录应标记滚动补位');
}

async function testFailureIsolationAndBlocking() {
  const called = [];
  const schedule = await scheduler.runSchedule({
    indexes: [0, 1, 2],
    concurrency: 2,
    dependencyOf: index => ({ 0: null, 1: 0, 2: null })[index],
    worker: async index => {
      called.push(index);
      return { index, failed: index === 0, usable: index !== 0 };
    },
  });
  assert.deepStrictEqual(called.sort(), [0, 2], '父镜头失败后不得调用子镜头供应商，独立分支仍继续');
  const blocked = schedule.results.find(result => result.index === 1);
  assert.strictEqual(blocked?.blocked, true);
  assert.strictEqual(blocked?.reason, 'dependency_failed');

  const external = await scheduler.runSchedule({
    indexes: [2],
    concurrency: 2,
    dependencyOf: () => 1,
    externalDependencyUsable: () => false,
    worker: async () => { throw new Error('blocked dependency must not run'); },
  });
  assert.strictEqual(external.results[0].reason, 'dependency_unavailable');
}

async function testThrottleDowngradeAndSingleRetry() {
  const calls = [];
  const schedule = await scheduler.runSchedule({
    indexes: [0],
    concurrency: 3,
    worker: async (index, meta) => {
      calls.push({ index, retry: meta.throttle_retry, concurrency: meta.concurrency });
      if (!meta.throttle_retry) {
        return { index, failed: true, usable: false, throttled: true, retry_required: true };
      }
      return { index, usable: true };
    },
  });
  assert.deepStrictEqual(calls.map(call => call.retry), [false, true]);
  assert.strictEqual(calls[1].concurrency, 1, '429 后必须降为单路重试');
  assert.strictEqual(schedule.effective_concurrency, 1);
  assert.strictEqual(schedule.throttle_retries['0'], 1, '每个镜头最多一次限流重试');
  assert.strictEqual(schedule.results.length, 1, '临时限流结果不应重复计入最终完成数');
}

async function testCancellationStopsNewWaves() {
  const called = [];
  await assert.rejects(() => scheduler.runSchedule({
    indexes: [0, 1, 2],
    concurrency: 2,
    worker: async index => {
      called.push(index);
      if (index === 0) {
        const error = new Error('cancelled');
        error.code = 'USER_CANCELLED';
        throw error;
      }
      await delay(5);
      return { index, usable: true };
    },
  }), error => error?.code === 'USER_CANCELLED');
  assert.deepStrictEqual(called.sort(), [0, 1], '取消后不得启动下一波任务');
}

async function testStageIntegrationWithoutPaidProvider() {
  const owner = { id: 'parallel-test-owner', role: 'user' };
  const created = service.createTask({
    brief: '验证互不依赖镜头的并行关键帧调度',
    product_subject: '抽象服务能力',
    cast_mode: 'no_human',
  }, owner);
  const taskId = created.task.id;
  const shots = Array.from({ length: 4 }, (_, index) => ({
    index: index + 1,
    title: `独立镜头 ${index + 1}`,
    visual: `场景 ${index + 1} 中展示第 ${index + 1} 个独立信息点`,
    action: '静态展示',
    scene_id: `independent-scene-${index + 1}`,
    characters: [],
  }));
  const contracts = shots.map(shot => ({
    visual_contract: {},
    scene_lock: { scene_id: shot.scene_id },
    continuity_lock: { transition_type: 'hard_cut' },
  }));
  storage.saveOutput(taskId, 'context', {
    brief: '验证互不依赖镜头的并行关键帧调度',
    product_subject: '抽象服务能力',
    cast_mode: 'no_human',
    scene_assets: [],
    assets: [],
  });
  storage.saveOutput(taskId, 'storyboard_table', shots);
  storage.saveOutput(taskId, 'keyframe_contracts', contracts);

  const originalGenerateImage = mediaAdapter.generateImage;
  const originalPersonReview = personKeyframeQa.reviewPersonKeyframe;
  const originalProductReview = productKeyframeQa.reviewProductKeyframe;
  let active = 0;
  let peak = 0;
  mediaAdapter.generateImage = async ({ filename }) => {
    active += 1;
    peak = Math.max(peak, active);
    await delay(20);
    active -= 1;
    return {
      image_url: `https://example.test/${filename}.png`,
      source_url: `https://example.test/${filename}.png`,
      provider_used: 'mock/no-charge',
    };
  };
  personKeyframeQa.reviewPersonKeyframe = async () => ({
    pass: true, status: 'verified', forbidden_person_check: true, visible_human: false, conflicts: [], checked_at: new Date().toISOString(),
  });
  productKeyframeQa.reviewProductKeyframe = async () => ({
    pass: true, status: 'not_applicable', conflicts: [], checked_at: new Date().toISOString(),
  });

  try {
    const result = await service.generateKeyframesStage(taskId, { parallel_keyframes: true, keyframe_concurrency: 2 });
    assert.strictEqual(result.keyframes.length, 4);
    assert(result.keyframes.every(frame => frame.qa?.pass === true));
    assert.strictEqual(peak, 2, '关键帧阶段应实际同时调用两个独立生成任务');
    const progress = storage.getTask(taskId).generation_progress;
    assert.strictEqual(progress.processed, 4);
    assert.strictEqual(progress.succeeded, 4);
    assert.strictEqual(progress.configured_concurrency, 2);
    assert(progress.waves.some(wave => wave.kind === 'parallel'));
  } finally {
    mediaAdapter.generateImage = originalGenerateImage;
    personKeyframeQa.reviewPersonKeyframe = originalPersonReview;
    productKeyframeQa.reviewProductKeyframe = originalProductReview;
  }
}

function testConfigurationAndContracts() {
  assert.strictEqual(scheduler.resolveConcurrency({}, 8, {}), 2);
  assert.strictEqual(scheduler.resolveConcurrency({ keyframe_concurrency: 99 }, 8, {}), 3);
  assert.strictEqual(scheduler.resolveConcurrency({ parallel_keyframes: false }, 8, {}), 1);
  assert.strictEqual(scheduler.resolveConcurrency({}, 8, { NEW_STORY_AD_KEYFRAME_PARALLEL: 'off' }), 1);
  assert.strictEqual(scheduler.isThrottleError(Object.assign(new Error('HTTP 429 too many requests'), { code: 'RATE_LIMIT' })), true);

  const shots = [
    { scene_id: 'scene-a', characters: [{ name: '甲' }] },
    { scene_id: 'scene-a' },
    { scene_id: 'scene-b', characters: [{ name: '乙' }] },
    { scene_id: 'scene-c', characters: [{ name: '乙' }] },
    { scene_id: 'scene-d', entry_frame_state: '承接上一镜动作', transition_type: 'cut_on_action' },
  ];
  const contracts = shots.map((shot, index) => ({
    scene_lock: { scene_id: shot.scene_id },
    continuity_lock: index === 4 ? { entry_frame_state: '承接上一镜动作', transition_type: 'cut_on_action' } : {},
  }));
  const plan = service.buildKeyframeDependencyPlan(shots, contracts, {
    cast_mode: 'single',
    person_contract: { status: 'verified', cross_view_qa: { pass: true } },
    scene_assets: shots.map(shot => ({ scene_id: shot.scene_id, scene_contract: { status: 'verified', cross_view_qa: { pass: true } } })),
  });
  assert.deepStrictEqual(plan.dependencies, { 0: null, 1: null, 2: null, 3: null, 4: 3 });
  assert.strictEqual(plan.reasons[1], 'independent_with_shared_anchors', '共享已验证场景是锚点，不应变成镜头依赖');
  assert.strictEqual(plan.reasons[4], 'temporal_continuity');

  const unanchoredPlan = service.buildKeyframeDependencyPlan(shots.slice(0, 2), contracts.slice(0, 2), { cast_mode: 'no_human', scene_assets: [] });
  assert.deepStrictEqual(unanchoredPlan.dependencies, { 0: null, 1: 0 }, '场景锚点缺失时应保守串行');

  const unknownShots = Array.from({ length: 6 }, (_, index) => ({ index: index + 1, action: `独立动作 ${index + 1}`, characters: [] }));
  const unknownNormalized = continuity.withContinuityContracts(unknownShots);
  assert(unknownNormalized.slice(1).every(shot => shot.transition_type === 'hard_cut'), '普通动作不得自动升级为 cut_on_action');
  const unknownPlan = service.buildKeyframeDependencyPlan(unknownNormalized, unknownNormalized.map(shot => ({ continuity_lock: shot.continuity })), { cast_mode: 'no_human' });
  assert.deepStrictEqual(unknownPlan.dependencies, { 0: null, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 }, '完全缺少连续性元数据时必须保守串行');

  const sameSceneShots = continuity.withContinuityContracts(Array.from({ length: 6 }, (_, index) => ({
    index: index + 1, scene_id: 'verified-scene', action: `普通独立动作 ${index + 1}`, characters: [],
  })));
  const sameScenePlan = service.buildKeyframeDependencyPlan(sameSceneShots, sameSceneShots.map(shot => ({ scene_lock: { scene_id: 'verified-scene' }, continuity_lock: shot.continuity })), {
    cast_mode: 'no_human',
    scene_assets: [{ scene_id: 'verified-scene', scene_contract: { status: 'verified', cross_view_qa: { pass: true } } }],
  });
  assert.deepStrictEqual(sameScenePlan.dependencies, { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null }, '同场景普通动作必须依靠场景锚点并行');

  const dissolvePlan = service.buildKeyframeDependencyPlan([
    { scene_id: 'scene-a', transition_type: 'none' },
    { scene_id: 'scene-b', transition_type: 'dissolve' },
  ], [
    { scene_lock: { scene_id: 'scene-a' }, continuity_lock: { transition_type: 'none' } },
    { scene_lock: { scene_id: 'scene-b' }, continuity_lock: { transition_type: 'dissolve' } },
  ], {
    cast_mode: 'no_human',
    scene_assets: ['scene-a', 'scene-b'].map(scene_id => ({ scene_id, scene_contract: { status: 'verified', cross_view_qa: { pass: true } } })),
  });
  assert.deepStrictEqual(dissolvePlan.dependencies, { 0: null, 1: null }, '普通 dissolve 不需要上一关键帧参与生成');

  const explicitStatePlan = service.buildKeyframeDependencyPlan([
    { scene_id: 'scene-a' },
    { scene_id: 'scene-a', transition_type: 'hard_cut', requires_previous_frame: true, object_states: '产品保持开启' },
  ], [
    { scene_lock: { scene_id: 'scene-a' }, continuity_lock: { transition_type: 'none' } },
    { scene_lock: { scene_id: 'scene-a' }, continuity_lock: { transition_type: 'hard_cut', requires_previous_frame: true, object_states: '产品保持开启' } },
  ], {
    cast_mode: 'no_human',
    scene_assets: [{ scene_id: 'scene-a', scene_contract: { status: 'verified', cross_view_qa: { pass: true } } }],
  });
  assert.deepStrictEqual(explicitStatePlan.dependencies, { 0: null, 1: 0 }, '显式要求承接上一帧时，即使 hard_cut 也必须建立依赖');

  const multiPersonPlan = service.buildKeyframeDependencyPlan([
    { scene_id: 'verified-scene', characters: [{ name: '已验证主角' }] },
    { scene_id: 'verified-scene', characters: [{ name: '未验证配角' }] },
    { scene_id: 'verified-scene', characters: [{ name: '未验证配角' }] },
  ], [
    { scene_lock: { scene_id: 'verified-scene' } },
    { scene_lock: { scene_id: 'verified-scene' } },
    { scene_lock: { scene_id: 'verified-scene' } },
  ], {
    cast_mode: 'multi',
    person_contract: { status: 'verified', cross_view_qa: { pass: true } },
    person_asset: { name: '已验证主角', image_url: 'https://example.test/main.png' },
    scene_assets: [{ scene_id: 'verified-scene', scene_contract: { status: 'verified', cross_view_qa: { pass: true } } }],
  });
  assert.deepStrictEqual(multiPersonPlan.dependencies, { 0: null, 1: null, 2: 1 }, '未验证的同一配角必须保守承接，不能被主角全局验证状态放行');

  for (const sceneContract of [
    { status: 'verified', cross_view_qa: { pass: false } },
    { status: 'pending', cross_view_qa: { pass: true } },
  ]) {
    const inconsistentScenePlan = service.buildKeyframeDependencyPlan(
      [{ scene_id: 'scene-x' }, { scene_id: 'scene-x' }],
      [{ scene_lock: { scene_id: 'scene-x' } }, { scene_lock: { scene_id: 'scene-x' } }],
      { cast_mode: 'no_human', scene_assets: [{ scene_id: 'scene-x', scene_contract: sceneContract }] },
    );
    assert.deepStrictEqual(inconsistentScenePlan.dependencies, { 0: null, 1: 0 }, '场景 status 与 QA 必须同时通过才可作为并发锚点');
  }

  const refs = service.keyframeReferenceImages({
    person_asset: {
      image_url: 'https://example.test/person-main.png',
      view_images: [{ url: 'https://example.test/person-side.png' }],
    },
    assets: [{ type: 'product', url: 'https://example.test/product.png' }],
    product_subject: '测试产品',
  }, 'https://example.test/scene.png', { image_url: 'https://example.test/previous.png' }, {
    characters: [{ name: '测试人物' }], visual: '测试人物拿起测试产品进行展示',
  });
  assert.deepStrictEqual(refs, [
    'https://example.test/scene.png',
    'https://example.test/person-main.png',
    'https://example.test/product.png',
    'https://example.test/previous.png',
  ], '连续性参考必须占据稳定槽位，不能被多余人物视图挤掉');

  const prompt = service.buildKeyframePrompt({ brief: '测试广告', product_subject: '测试产品' }, {
    title: '第二镜', visual: '人物拿起产品', action: '延续上一镜动作',
  }, {
    continuity_lock: {
      continuity_from: 'shot_1', entry_frame_state: '产品位于桌面左侧', exit_frame_state: '产品被拿起',
      screen_direction: 'left_to_right', object_states: '包装保持开启', transition_type: 'cut_on_action',
    },
  }, 1);
  assert.match(prompt, /Entry frame state: 产品位于桌面左侧/);
  assert.match(prompt, /Object state lock: 包装保持开启/);

  const targetIndexes = service.keyframeTargetIndexes([{}, {}, {}], [
    { image_url: 'https://example.test/accepted.png', qa_policy_version: 2, current_generation_status: 'accepted', qa: { pass: true } },
    null,
    { image_url: 'https://example.test/failed.png', error: 'failed' },
  ], { missing_only: true });
  assert.deepStrictEqual(targetIndexes, [1, 2], '续作只能选择缺失或失败镜头');
}

async function main() {
  testConfigurationAndContracts();
  await testDependencyAwareParallelism();
  await testRollingPoolRefillsFreedSlot();
  await testFailureIsolationAndBlocking();
  await testThrottleDowngradeAndSingleRetry();
  await testCancellationStopsNewWaves();
  await testStageIntegrationWithoutPaidProvider();
  console.log('new-story-ad keyframe parallel tests passed');
}

main()
  .finally(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  })
  .catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
