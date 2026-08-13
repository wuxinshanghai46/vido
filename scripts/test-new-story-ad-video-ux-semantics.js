#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { projectVideoGenerationUnits } = require('../src/services/newStoryAd/videoGenerationUnitProjection');
const { terminalGenerationProgress } = require('../src/services/newStoryAd/jobService');
const videoReview = require('../public/js/new-story-ad/video-review');
const videoPreflightUi = require('../public/js/new-story-ad/video-preflight-ui');

function shot(index, block, members, lifecycle, extra = {}) {
  return {
    index, title: `镜头 ${index}`, scene_block_id: block, scene_block_members: members,
    lifecycle, file_exists: ['generated', 'video_qa', 'qa_passed', 'qa_failed'].includes(lifecycle),
    provider_task_id: extra.local ? '' : extra.providerTaskId,
    provider_used: extra.local ? 'local-ffmpeg/cost-aware-camera-motion' : 'provider/model',
    qa_status: lifecycle === 'qa_passed' ? 'passed' : (lifecycle === 'qa_failed' ? 'failed' : ''),
    ...extra,
  };
}

function testGenerationUnitProjection() {
  const rows = [
    shot(1, 'block-1-3', [1, 2, 3], 'qa_passed', { providerTaskId: 'provider-a' }),
    shot(2, 'block-1-3', [1, 2, 3], 'qa_failed', { providerTaskId: 'provider-a', error: '连续性未通过' }),
    shot(3, 'block-1-3', [1, 2, 3], 'qa_passed', { providerTaskId: 'provider-a' }),
    shot(4, 'block-4-5', [4, 5], 'qa_passed', { providerTaskId: 'provider-b' }),
    shot(5, 'block-4-5', [4, 5], 'qa_passed', { providerTaskId: 'provider-b' }),
    shot(6, 'block-6', [6], 'qa_passed', { local: true }),
  ];
  const units = projectVideoGenerationUnits(rows, [
    { id: 'block-1-3', member_indexes: [0, 1, 2], continuous: true, duration_sec: 15 },
    { id: 'block-4-5', member_indexes: [3, 4], continuous: true, duration_sec: 10 },
    { id: 'block-6', member_indexes: [5], continuous: false, duration_sec: 5 },
  ]);
  assert.strictEqual(units.length, 3, '六个 QA 片段必须还原为三个真实生成单元');
  assert.deepStrictEqual(units[0].member_indexes, [1, 2, 3]);
  assert.strictEqual(units[0].provider_task_id, 'provider-a');
  assert.strictEqual(units[0].generation_status, 'succeeded', '逐镜 QA 失败不能抹掉母片已生成事实');
  assert.strictEqual(units[0].qa_status, 'failed');
  assert.strictEqual(units[0].qa_failed, 1);
  assert.strictEqual(units[1].qa_status, 'passed');
  assert.strictEqual(units[2].mode, 'local_motion');

  const regenerated = projectVideoGenerationUnits([
    shot(1, 'old-block-1-3', [1, 2, 3], 'qa_passed', { providerTaskId: 'provider-old' }),
    shot(2, 'new-block-2-3', [2, 3], 'qa_failed', { providerTaskId: 'provider-new' }),
    shot(3, 'new-block-2-3', [2, 3], 'qa_passed', { providerTaskId: 'provider-new' }),
    shot(4, 'old-block-4-5', [4, 5], 'qa_failed', { providerTaskId: 'provider-b' }),
    shot(5, 'old-block-4-5', [4, 5], 'qa_passed', { providerTaskId: 'provider-b' }),
    shot(6, 'old-block-6', [6], 'qa_passed', { local: true }),
  ], [
    { id: 'current-block-1', member_indexes: [0], continuous: false, duration_sec: 5 },
    { id: 'new-block-2-3', member_indexes: [1, 2], continuous: true, duration_sec: 10 },
    { id: 'current-block-4-5', member_indexes: [3, 4], continuous: true, duration_sec: 10 },
    { id: 'current-block-6', member_indexes: [5], continuous: false, duration_sec: 5 },
  ]);
  assert.deepStrictEqual(regenerated.map(unit => unit.member_indexes), [[1], [2, 3], [4, 5], [6]], 'current topology must own every shot exactly once after a scoped regeneration');
  assert.deepStrictEqual(regenerated.flatMap(unit => unit.member_indexes), [1, 2, 3, 4, 5, 6]);

  const historical = projectVideoGenerationUnits([
    shot(1, '', [1], 'qa_passed', { providerTaskId: 'legacy-provider' }),
    shot(2, '', [2], 'qa_passed', { providerTaskId: 'legacy-provider' }),
  ], []);
  assert.strictEqual(historical.length, 1, '历史重复 provider_task_id 必须聚合而不是重复展示');

  const providerFailure = projectVideoGenerationUnits([
    shot(1, 'failed-block', [1], 'failed', { providerTaskId: 'provider-failed', file_exists: false }),
  ], []);
  assert.strictEqual(providerFailure[0].generation_status, 'failed');
  assert.strictEqual(providerFailure[0].qa_status, 'pending');
}

async function testMediaImmediatelyOwnsStepSix() {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/generation-flow.js'), 'utf8');
  const sandbox = { window: {}, Date, Math, Number, String, setTimeout, clearTimeout };
  vm.runInNewContext(source, sandbox, { filename: 'generation-flow.js' });
  const flow = sandbox.window.NewStoryAdGenerationFlow;
  const events = [];
  let resolvePost;
  const pendingPost = new Promise(resolve => { resolvePost = resolve; });
  const state = { shots: [], videoClips: [], voiceId: '', stageProgress: null, videoSelectedIndexes: [0] };
  const run = flow.runStage('media', {
    state,
    button: {},
    ensureTask: async () => 'task-1',
    api: async (_url, options = {}) => {
      events.push(options.method === 'POST' ? 'post' : 'get');
      return pendingPost;
    },
    showStep: step => events.push(`step-${step}`),
    renderAll: () => events.push('render'),
    normalizeBundle: () => {},
    startStageProgress: () => events.push('progress'),
    setBusy: () => {},
    setButtonBusy: () => {},
    toast: () => {},
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert(events.indexOf('step-6') >= 0, 'POST 尚未返回时必须已经进入第 6 步');
  assert(events.indexOf('step-6') < events.indexOf('post'));
  resolvePost({ success: true, task: {} });
  assert.strictEqual(await run, true);

  const failureEvents = [];
  const failed = await flow.runStage('media', {
    state: { shots: [], videoClips: [], voiceId: '', stageProgress: null, videoSelectedIndexes: [0] },
    button: {}, ensureTask: async () => 'task-2',
    api: async () => { failureEvents.push('post'); throw new Error('服务器拒绝任务'); },
    showStep: step => failureEvents.push(`step-${step}`), renderAll: () => failureEvents.push('render'),
    normalizeBundle: () => {}, startStageProgress: () => {}, setBusy: () => {}, setButtonBusy: () => {}, toast: message => failureEvents.push(message),
  });
  assert.strictEqual(failed, false);
  assert.strictEqual(failureEvents.filter(item => item === 'post').length, 1, '失败不得自动二次提交');
  assert(failureEvents.includes('step-6'), '提交失败也必须留在第 6 步显示真实错误');
}

function testCrossStageTerminalizationIsGenerationSafe() {
  const current = { generation_progress: { stage: 'video', status: 'running', generation_id: 'gen-a' } };
  const terminal = terminalGenerationProgress(current, 'media', 'gen-a', { status: 'failed' });
  assert.strictEqual(terminal.status, 'failed', 'media 外层任务必须能归档同 generation 的 video 子进度');
  const stale = terminalGenerationProgress({ generation_progress: { stage: 'media', status: 'running', generation_id: 'gen-b' } }, 'media', 'gen-a', { status: 'failed' });
  assert.strictEqual(stale, null, '旧 generation 收尾不得覆盖新 generation');
}

function testRecoveryEntryUsesScopedEconomyMode() {
  assert.strictEqual(videoReview.generationModeForEntry([]), 'quality', 'a first generation must preserve continuous quality planning');
  assert.strictEqual(videoReview.generationModeForEntry([{ video_url: '/existing.mp4', qa: { pass: false } }]), 'economy', 'an existing-video recovery must expose exact per-shot selection');
  assert.strictEqual(videoReview.generationModeForEntry([{ file_path: '/existing.mp4', error_code: 'VIDEO_QA_FAILED' }]), 'economy', 'a failed persisted clip must not be expanded back into an old quality block');
  const source = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/finalView.js'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../public/story-ad/store/projectStore.js'), 'utf8');
  assert(source.includes("store.videoPreflight('economy')"), 'the current user entry must route recovery tasks through exact economy preflight');
  assert(store.includes('video_preflight_fingerprint: preflight?.fingerprint'), 'the confirmed preflight fingerprint must be bound to the submitted authorization');
}

function testCostAcknowledgementsDefaultCheckedWithoutSelectingPaidUnits() {
  const preflight = {
    units: [{ id: 'shot-5', shots: [5], title: '镜头 5', paid: true, duration_sec: 5 }],
    cost_plan: { estimated_cost_rmb: 5, maximum_cost_rmb: 5.75, units: [{ generation_unit_id: 'shot-5', billable_seconds: 5, estimated_cost_rmb: 5 }] },
  };
  const selection = videoReview.selectionHtml(preflight);
  const confirmation = videoReview.costConfirmationHtml(preflight);
  assert.match(selection, /data-nsa-rework-ack checked/, '范围确认框必须默认勾选');
  assert.match(confirmation, /data-nsa-scoped-cost-ack checked/, '精确费用确认框必须默认勾选');
  assert.doesNotMatch(selection, /data-nsa-video-unit[^>]*checked/, '默认确认不得顺带选择任何付费生成单元');
}

function testUnitScopedBlockerDoesNotDisableSafePaidUnits() {
  const preflight = {
    units: [
      { id: 'shot-2', shots: [2], title: '镜头 2', paid: true, duration_sec: 5 },
      { id: 'shot-4', shots: [4], title: '镜头 4', paid: true, duration_sec: 5 },
      { id: 'shot-6-local', shots: [6], title: '镜头 6', paid: false, duration_sec: 5 },
    ],
    blockers: [{
      code: 'VIDEO_PRIVACY_INPUT_REQUIRES_CHANGE', scope: 'unit', unit_id: 'shot-2', shots: [2],
      message: '第 2 镜原关键帧不可原样重试。',
    }],
    zero_cost_action_count: 1,
    cost_plan: { units: [] },
  };
  const availability = videoReview.selectionAvailability(preflight);
  assert.strictEqual(availability.selectablePaidUnits, 1, '单镜 blocker 不能禁用其他安全付费单元');
  assert.strictEqual(availability.selectableZeroCostUnits, 1, '零费用单元必须保持独立可选');
  assert.strictEqual(availability.blockedPaidUnits, 1);
  assert.strictEqual(availability.units.find(row => row.id === 'shot-2').disabled, true);
  assert.strictEqual(availability.units.find(row => row.id === 'shot-4').disabled, false);
  const html = videoReview.selectionHtml(preflight);
  assert.strictEqual((html.match(/data-nsa-unit-blocked="1"/g) || []).length, 1, '只能渲染一个被阻断单元');
  assert.match(html, /当前不可选择：第 2 镜原关键帧不可原样重试。/, '被禁用单元必须直接显示原因');

  const globalAvailability = videoReview.selectionAvailability({
    ...preflight,
    blockers: [{ code: 'VIDEO_PROVIDER_BILLING_BLOCKED', message: '供应商计费通道暂停。' }],
  });
  assert.strictEqual(globalAvailability.selectablePaidUnits, 0, '全局 blocker 必须继续禁用全部付费单元');
  assert.strictEqual(globalAvailability.selectableZeroCostUnits, 1, '全局付费 blocker 不得阻断安全零费用动作');
}

async function testScopedBlockerStillAllowsSafeSelectionFlow() {
  const broad = {
    paid_unit_count: 2, zero_cost_action_count: 1,
    units: [
      { id: 'shot-2', shots: [2], paid: true, duration_sec: 5 },
      { id: 'shot-4', shots: [4], paid: true, duration_sec: 5 },
      { id: 'shot-6-local', shots: [6], paid: false, duration_sec: 5 },
    ],
    blockers: [{ scope: 'unit', unit_id: 'shot-2', shots: [2], message: '第 2 镜不可原样重试。' }],
    cost_plan: { units: [] },
  };
  const scoped = {
    paid_unit_count: 1, zero_cost_action_count: 0, units: [{ id: 'shot-4', shots: [4], paid: true, duration_sec: 5 }], blockers: [],
    cost_plan: { fingerprint: 'cost-shot-4', estimated_cost_rmb: 5, maximum_cost_rmb: 5.75, units: [{ generation_unit_id: 'shot-4', billable_seconds: 5, estimated_cost_rmb: 5 }] },
  };
  let apiCalls = 0;
  const dialogs = [];
  const result = await videoPreflightUi.runScopedPreflight({
    mode: 'economy', ensureTask: async () => 'task', api: async () => ({ preflight: apiCalls++ === 0 ? broad : scoped }),
    toast: message => assert.fail(message), videoReview, escapeHtml: value => String(value || ''),
    confirmAction: async options => {
      dialogs.push(options);
      return dialogs.length === 1
        ? { indexes: [3], unitIds: ['shot-4'] }
        : { videoSelection: { indexes: [3], unitIds: ['shot-4'] } };
    },
  });
  assert.strictEqual(dialogs.length, 2, '存在单镜 blocker 时仍必须进入安全单元选择和精确费用确认');
  assert.match(dialogs[0].summary, /1 个付费单元可选，1 个付费单元被单独阻止/);
  assert.deepStrictEqual(result.selectedIndexes, [3]);
  assert.strictEqual(result.costPlanFingerprint, 'cost-shot-4');
}

(async () => {
  testGenerationUnitProjection();
  await testMediaImmediatelyOwnsStepSix();
  testCrossStageTerminalizationIsGenerationSafe();
  testRecoveryEntryUsesScopedEconomyMode();
  testCostAcknowledgementsDefaultCheckedWithoutSelectingPaidUnits();
  testUnitScopedBlockerDoesNotDisableSafePaidUnits();
  await testScopedBlockerStillAllowsSafeSelectionFlow();
  console.log('new story ad video UX semantics: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
