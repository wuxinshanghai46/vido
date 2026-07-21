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

function verifiedSceneAsset(sceneId = 'verified-scene') {
  return {
    scene_id: sceneId,
    view_images: [
      { key: 'master', url: `https://example.test/${sceneId}-master.png` },
      { key: 'reverse', url: `https://example.test/${sceneId}-reverse.png` },
      { key: 'interaction', url: `https://example.test/${sceneId}-interaction.png` },
      { key: 'detail', url: `https://example.test/${sceneId}-detail.png` },
      { key: 'layout', url: `https://example.test/${sceneId}-layout.png` },
    ],
    scene_contract: {
      schema_version: 3,
      status: 'verified',
      requirement_qa: { pass: true },
      cross_view_qa: { pass: true },
      spatial_coverage_qa: { pass: true },
      layout_contract: { status: 'available' },
    },
  };
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

async function testFailedBatchKeepsStructuredState() {
  const owner = { id: 'parallel-failure-owner', role: 'user' };
  const taskId = service.createTask({
    brief: '验证失败分镜的结构化收尾',
    product_subject: '测试主体',
    cast_mode: 'no_human',
  }, owner).task.id;
  storage.saveOutput(taskId, 'context', {
    brief: '验证失败分镜的结构化收尾',
    product_subject: '测试主体',
    cast_mode: 'no_human',
    scene_assets: [],
    assets: [],
  });
  storage.saveOutput(taskId, 'storyboard_table', Array.from({ length: 3 }, (_, index) => ({
    index: index + 1,
    title: index === 1 ? '失败镜头' : `成功镜头 ${index + 1}`,
    visual: `任务主体静态展示 ${index + 1}`,
    action: '保持静止',
    scene_id: `independent-scene-${index + 1}`,
    subject_type: 'product_only',
    characters: [],
  })));
  storage.saveOutput(taskId, 'keyframe_contracts', Array.from({ length: 3 }, (_, index) => ({
    contract_fingerprint: `failure-contract-v${index + 1}`,
    visual_contract: {},
    continuity_lock: { transition_type: 'hard_cut' },
  })));

  const originalGenerateImage = mediaAdapter.generateImage;
  const originalPersonReview = personKeyframeQa.reviewPersonKeyframe;
  const originalProductReview = productKeyframeQa.reviewProductKeyframe;
  let active = 0;
  let peak = 0;
  mediaAdapter.generateImage = async ({ filename = '' } = {}) => {
    active += 1;
    peak = Math.max(peak, active);
    await delay(20);
    active -= 1;
    if (!/_02_/.test(filename)) return { image_url: `https://example.test/${filename}.png`, provider_used: 'mock/image' };
    const error = new Error('图片生成失败，已尝试 1 个模型并停止继续调用：deyunai/gpt-image-2：供应商返回未分类 5xx，内部错误码没有公开定义；目前无法确认是审核拦截还是服务故障，已停止自动付费重试。（供应商：500/UNKXXXO004IFR）');
    error.code = 'PROVIDER_5XX_AMBIGUOUS';
    error.retryable = false;
    throw error;
  };
  personKeyframeQa.reviewPersonKeyframe = async () => ({ pass: true, status: 'verified', conflicts: [] });
  productKeyframeQa.reviewProductKeyframe = async () => ({ pass: true, status: 'verified', conflicts: [] });
  try {
    await assert.rejects(
      () => service.generateKeyframesStage(taskId, { parallel_keyframes: true, keyframe_concurrency: 3 }),
      error => error?.code === 'KEYFRAME_BATCH_PARTIAL_FAILURE'
        && error?.retryable === true
        && error?.details?.length === 1
        && error?.details?.[0]?.shot_number === 2,
    );
    const frames = storage.getOutput(taskId, 'keyframes');
    const frame = frames[1];
    assert.equal(frames[0].current_generation_status, 'accepted');
    assert.equal(frames[2].current_generation_status, 'accepted');
    assert.equal(frame.current_generation_status, 'failed');
    assert.equal(frame.latest_attempt.status, 'failed');
    assert.equal(frame.latest_attempt.error_code, 'PROVIDER_5XX_AMBIGUOUS');
    assert.equal(frame.candidates.length, 0, '供应商失败前没有候选图，不能伪装成 QA-only 异常');
    assert.equal(peak, 3, '供应商错误分类必须覆盖允许的最大并发场景');
    const task = storage.getTask(taskId);
    assert.equal(task.error_code, 'KEYFRAME_BATCH_PARTIAL_FAILURE');
    assert.deepEqual(task.generation_progress.failed_shots, [2]);
    const stage = storage.readDb().stages.find(item => item.task_id === taskId && item.stage === 'keyframes');
    assert.equal(stage.diagnostics.failures[0].shot_number, 2);
  } finally {
    mediaAdapter.generateImage = originalGenerateImage;
    personKeyframeQa.reviewPersonKeyframe = originalPersonReview;
    productKeyframeQa.reviewProductKeyframe = originalProductReview;
  }
}

async function testStrictMissingFillPreservesExistingFrames() {
  const owner = { id: 'strict-missing-owner', role: 'user' };
  const taskId = service.createTask({
    brief: '六个镜头只补齐两张真正缺失的图片',
    product_subject: '通用测试主体',
    cast_mode: 'no_human',
  }, owner).task.id;
  const shots = Array.from({ length: 6 }, (_, index) => ({
    index: index + 1,
    title: `镜头 ${index + 1}`,
    visual: `展示当前任务第 ${index + 1} 个信息点`,
    action: '保持当前构图',
    characters: [],
  }));
  const contracts = shots.map((_, index) => ({
    contract_fingerprint: `strict-missing-contract-${index + 1}`,
    visual_contract: {},
    continuity_lock: { transition_type: index ? 'hard_cut' : 'none' },
  }));
  const retainedIndexes = new Set([0, 1, 2, 5]);
  const existing = shots.map((_, index) => retainedIndexes.has(index) ? {
    image_url: `https://example.test/retained-${index + 1}.png`,
    qa_policy_version: 1,
    contract_fingerprint: `older-contract-${index + 1}`,
    contract_outdated: true,
    current_generation_status: 'outdated',
    qa: { pass: true, status: 'verified' },
  } : {
    error: 'previous image generation failed',
    error_code: 'PROVIDER_5XX_AMBIGUOUS',
    current_generation_status: 'failed',
    qa: { pass: false, status: 'not_run' },
  });
  storage.saveOutput(taskId, 'context', {
    brief: '六个镜头只补齐两张真正缺失的图片',
    product_subject: '通用测试主体',
    cast_mode: 'no_human',
    scene_assets: [],
    assets: [],
  });
  storage.saveOutput(taskId, 'storyboard_table', shots);
  storage.saveOutput(taskId, 'keyframe_contracts', contracts);
  storage.saveOutput(taskId, 'keyframes', existing);

  const originalGenerateImage = mediaAdapter.generateImage;
  const originalPersonReview = personKeyframeQa.reviewPersonKeyframe;
  const originalProductReview = productKeyframeQa.reviewProductKeyframe;
  const generated = [];
  mediaAdapter.generateImage = async ({ filename = '' } = {}) => {
    generated.push(filename);
    return { image_url: `https://example.test/${filename}.png`, provider_used: 'mock/no-charge' };
  };
  personKeyframeQa.reviewPersonKeyframe = async () => ({ pass: true, status: 'verified', conflicts: [] });
  productKeyframeQa.reviewProductKeyframe = async () => ({ pass: true, status: 'verified', conflicts: [] });
  try {
    const result = await service.generateKeyframesStage(taskId, {
      missing_only: true,
      parallel_keyframes: true,
      keyframe_concurrency: 3,
    });
    assert.equal(generated.length, 2, '兼容旧客户端的 missing_only 也只能产生两次图片调用');
    assert.deepEqual(storage.getTask(taskId).generation_progress.target_indexes, [4, 5]);
    [0, 1, 2, 5].forEach(index => {
      assert.equal(result.keyframes[index].image_url, existing[index].image_url, `第 ${index + 1} 镜已有图片必须原样保留`);
      assert.equal(result.keyframes[index].current_generation_status, 'outdated', '严格补图不能顺带改写已有图片状态');
    });
    assert(result.keyframes[3].image_url && result.keyframes[4].image_url, '第 4、5 镜必须得到新图片');
  } finally {
    mediaAdapter.generateImage = originalGenerateImage;
    personKeyframeQa.reviewPersonKeyframe = originalPersonReview;
    productKeyframeQa.reviewProductKeyframe = originalProductReview;
  }
}

async function testStrictMissingFillNeverAutoRegeneratesAfterQaRejection() {
  const owner = { id: 'strict-missing-qa-owner', role: 'user' };
  const taskId = service.createTask({
    brief: '补齐模式 QA 拒绝后不得自动产生第二次付费图片调用',
    product_subject: '通用测试主体',
    cast_mode: 'no_human',
  }, owner).task.id;
  storage.saveOutput(taskId, 'context', {
    brief: '补齐模式 QA 拒绝后不得自动产生第二次付费图片调用',
    product_subject: '通用测试主体',
    cast_mode: 'no_human',
    scene_assets: [],
    assets: [],
  });
  storage.saveOutput(taskId, 'storyboard_table', [{
    index: 1,
    title: '唯一缺失镜头',
    visual: '产品静态展示，不得出现人物',
    action: '保持稳定',
    subject_type: 'product_only',
    characters: [],
  }]);

  const originalGenerateImage = mediaAdapter.generateImage;
  const originalPersonReview = personKeyframeQa.reviewPersonKeyframe;
  const originalProductReview = productKeyframeQa.reviewProductKeyframe;
  let imageCalls = 0;
  let strictSingleAttempt = null;
  mediaAdapter.generateImage = async ({ filename = '', singleAttempt } = {}) => {
    imageCalls += 1;
    strictSingleAttempt = singleAttempt;
    return { image_url: `https://example.test/${filename}.png`, provider_used: 'mock/no-charge' };
  };
  personKeyframeQa.reviewPersonKeyframe = async () => ({
    pass: false,
    status: 'rejected',
    visible_human: true,
    conflicts: ['画面出现了合同禁止的人物'],
    retry_instruction: '移除人物',
  });
  productKeyframeQa.reviewProductKeyframe = async () => ({ pass: true, status: 'not_applicable', conflicts: [] });
  try {
    await assert.rejects(
      () => service.generateKeyframesStage(taskId, { missing_images_only: true }),
      error => error?.code === 'KEYFRAME_BATCH_PARTIAL_FAILURE',
    );
    assert.equal(imageCalls, 1, '严格补齐模式即使 QA 拒绝也只能调用一次图片供应商');
    assert.equal(strictSingleAttempt, true, '严格补齐必须把单次提交门禁传入图片供应商适配层');
    const frame = storage.getOutput(taskId, 'keyframes')[0];
    assert.equal(frame.candidates.length, 1, '首张结果应保留供人工检查，不得自动付费重生');
    assert.equal(frame.candidates[0].status, 'rejected');
    assert.equal(frame.current_generation_status, 'failed');
  } finally {
    mediaAdapter.generateImage = originalGenerateImage;
    personKeyframeQa.reviewPersonKeyframe = originalPersonReview;
    productKeyframeQa.reviewProductKeyframe = originalProductReview;
  }
}

async function testTimeoutCannotAutoResubmitWithoutBillingAcknowledgement() {
  const owner = { id: 'timeout-billing-owner', role: 'user' };
  const taskId = service.createTask({
    brief: '验证图片供应商超时后不得自动重复付费提交',
    product_subject: '通用测试主体',
    cast_mode: 'no_human',
  }, owner).task.id;
  storage.saveOutput(taskId, 'context', {
    brief: '验证图片供应商超时后不得自动重复付费提交',
    product_subject: '通用测试主体',
    cast_mode: 'no_human',
    scene_assets: [],
    assets: [],
  });
  storage.saveOutput(taskId, 'storyboard_table', [{
    index: 1,
    title: '唯一缺失镜头',
    visual: '展示当前任务主体',
    action: '保持稳定',
    subject_type: 'product_only',
    characters: [],
  }]);

  const originalGenerateImage = mediaAdapter.generateImage;
  const originalPersonReview = personKeyframeQa.reviewPersonKeyframe;
  const originalProductReview = productKeyframeQa.reviewProductKeyframe;
  let imageCalls = 0;
  let shouldTimeout = true;
  mediaAdapter.generateImage = async ({ filename = '', onSubmitting, onSubmitted } = {}) => {
    imageCalls += 1;
    await onSubmitting?.({ status: 'submitting' });
    await onSubmitted?.({ status: 'submitted', providerRequestId: 'provider-request-1' });
    if (shouldTimeout) {
      const error = new Error('timeout of 300000ms exceeded');
      error.code = 'DEYUNAI_GPT_IMAGE2_STREAM_TIMEOUT';
      error.billingState = 'unknown';
      error.providerSubmissionState = 'submitted_unknown';
      throw error;
    }
    return { image_url: `https://example.test/${filename}.png`, provider_used: 'mock/no-charge' };
  };
  personKeyframeQa.reviewPersonKeyframe = async () => ({ pass: true, status: 'verified', conflicts: [] });
  productKeyframeQa.reviewProductKeyframe = async () => ({ pass: true, status: 'not_applicable', conflicts: [] });
  try {
    await assert.rejects(
      () => service.generateKeyframesStage(taskId, { missing_images_only: true }),
      error => error?.code === 'KEYFRAME_BATCH_PARTIAL_FAILURE',
    );
    assert.equal(imageCalls, 1);
    await assert.rejects(
      () => service.generateKeyframesStage(taskId, { missing_images_only: true }),
      error => error?.code === 'KEYFRAME_SUBMISSION_BILLING_UNKNOWN'
        && error?.details?.requires_billing_acknowledgement === true,
    );
    assert.equal(imageCalls, 1, '未明确确认计费风险时不得产生第二次图片调用');
    shouldTimeout = false;
    const result = await service.generateKeyframesStage(taskId, {
      missing_images_only: true,
      acknowledge_billing_unknown: true,
    });
    assert.equal(imageCalls, 2, '明确确认后只允许新增一次图片调用');
    assert.equal(result.keyframes[0].current_generation_status, 'accepted');
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
    person_asset: { image_url: 'https://example.test/verified-person.png' },
    person_contract: { status: 'verified', cross_view_qa: { pass: true } },
    scene_assets: shots.map(shot => verifiedSceneAsset(shot.scene_id)),
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
    scene_assets: [verifiedSceneAsset('verified-scene')],
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
    scene_assets: ['scene-a', 'scene-b'].map(verifiedSceneAsset),
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
    scene_assets: [verifiedSceneAsset('scene-a')],
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
    scene_assets: [verifiedSceneAsset('verified-scene')],
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

  const layoutGroundedRefs = service.keyframeReferenceImages({
    cast_mode: 'no_human',
    product_subject: '',
  }, 'https://example.test/scene-master.png', null, {
    subject_type: 'scene_only',
    visual: '空场景空间建立镜头',
  }, {}, verifiedSceneAsset('layout-grounded'));
  assert.deepStrictEqual(layoutGroundedRefs, [
    'https://example.test/scene-master.png',
    'https://example.test/layout-grounded-layout.png',
  ], '引用槽位充足时，关键帧必须同时继承商业机位与空间蓝图');

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
  assert.deepStrictEqual(targetIndexes, [1], '补齐动作只能选择真正没有图片的镜头');
  const repairIndexes = service.keyframeTargetIndexes([{}, {}, {}], [
    { image_url: 'https://example.test/accepted.png', qa_policy_version: 2, current_generation_status: 'accepted', qa: { pass: true } },
    null,
    { image_url: 'https://example.test/failed.png', error: 'failed' },
  ], { needs_regeneration_only: true });
  assert.deepStrictEqual(repairIndexes, [1, 2], '修复模式可以包含已有图片但状态异常的镜头');
}

async function main() {
  testConfigurationAndContracts();
  await testDependencyAwareParallelism();
  await testRollingPoolRefillsFreedSlot();
  await testFailureIsolationAndBlocking();
  await testThrottleDowngradeAndSingleRetry();
  await testCancellationStopsNewWaves();
  await testStageIntegrationWithoutPaidProvider();
  await testFailedBatchKeepsStructuredState();
  await testStrictMissingFillPreservesExistingFrames();
  await testStrictMissingFillNeverAutoRegeneratesAfterQaRejection();
  await testTimeoutCannotAutoResubmitWithoutBillingAcknowledgement();
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
