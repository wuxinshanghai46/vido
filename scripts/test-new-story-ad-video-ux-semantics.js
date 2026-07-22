#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { projectVideoGenerationUnits } = require('../src/services/newStoryAd/videoGenerationUnitProjection');
const { terminalGenerationProgress } = require('../src/services/newStoryAd/jobService');
const videoReview = require('../public/js/new-story-ad/video-review');

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

async function testMediaImmediatelyOwnsStepFive() {
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
  assert(events.indexOf('step-5') >= 0, 'POST 尚未返回时必须已经进入第 5 步');
  assert(events.indexOf('step-5') < events.indexOf('post'));
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
  assert(failureEvents.includes('step-5'), '提交失败也必须留在第 5 步显示真实错误');
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
  const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js'), 'utf8');
  assert(source.includes('generationModeForEntry?.(state.videoClips)'), 'the main user entry must route recovery tasks through exact economy preflight');
  assert(source.includes('rememberVideoAuthorization(confirmed, mode)'), 'the confirmed recovery mode must be bound to the submitted authorization');
}

(async () => {
  testGenerationUnitProjection();
  await testMediaImmediatelyOwnsStepFive();
  testCrossStageTerminalizationIsGenerationSafe();
  testRecoveryEntryUsesScopedEconomyMode();
  console.log('new story ad video UX semantics: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
