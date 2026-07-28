const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/generation-flow.js'), 'utf8');
const sandbox = {
  window: {},
  console,
  Date,
  TypeError,
  setTimeout: callback => { callback(); return 1; },
  clearTimeout: () => {},
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

(async () => {
  const flow = sandbox.window.NewStoryAdGenerationFlow;
  assert(flow.isNetworkError(new TypeError('Failed to fetch')));
  assert(flow.stageWasAccepted({ stage: 'storyboard_failed' }, 'storyboard'));
  assert(flow.stageWasAccepted({ stage: 'keyframe_contract_ready' }, 'storyboard'));

  let gets = 0;
  const normalized = [];
  const recoveryState = { stageProgress: { active: true, stage: 'storyboard', submissionPending: true, startedAt: Date.now() }, shots: [] };
  const response = await flow.startStage('task-1', 'storyboard', {}, {
    api: async (url, options = {}) => {
      if (options.method === 'POST') throw new TypeError('Failed to fetch');
      gets += 1;
      if (gets === 1) return { task: { status: 'running', stage: 'storyboard', active_stage: 'storyboard', active_generation_id: 'g-1', generation_queued_at: new Date().toISOString() } };
      return { task: { status: 'done', stage: 'keyframe_contract_ready', active_generation_id: '' }, outputs: { storyboard_table: [] } };
    },
    normalizeBundle: bundle => normalized.push(bundle.task.stage),
    toast: () => {},
    state: recoveryState,
    renderAll: () => {},
  });
  assert.strictEqual(response.task.stage, 'keyframe_contract_ready');
  // 1 recovery probe + 1 lightweight progress poll + 1 final compact snapshot.
  assert.strictEqual(gets, 3);
  assert(normalized.includes('storyboard'));
  assert.strictEqual(recoveryState.activeGenerationId, 'g-1');
  assert.strictEqual(recoveryState.stageProgress.submissionPending, false, '网络恢复发现已接收任务时必须结束提交准备态');

  const keyframeState = {
    stageProgress: { active: true, stage: 'keyframes', generationId: '', submissionPending: true },
    shots: Array.from({ length: 6 }, (_, index) => ({ index: index + 1 })),
  };
  let keyframeGets = 0;
  await flow.startStage('task-2', 'keyframes', {}, {
    api: async (_url, options = {}) => {
      if (options.method === 'POST') return { job: { id: 'generation-new', stage: 'keyframes', queued_at: new Date().toISOString() } };
      keyframeGets += 1;
      return { task: { status: 'done', stage: 'keyframes_ready', active_generation_id: '' } };
    },
    normalizeBundle: () => {},
    state: keyframeState,
    renderAll: () => {},
  });
  assert.strictEqual(keyframeGets, 2);
  assert.strictEqual(keyframeState.stageProgress.submissionPending, false);
  assert.strictEqual(keyframeState.stageProgress.generationId, 'generation-new');
  assert.strictEqual(keyframeState.generationProgress.processed, 0);
  assert.strictEqual(keyframeState.generationProgress.generation_id, 'generation-new');

  const oldGenerationStartedAt = '2026-07-14T01:00:00.000Z';
  const staleState = {
    stageProgress: {
      active: true,
      stage: 'keyframes',
      generationId: '',
      previousGenerationId: 'generation-old',
      submissionPending: true,
      startedAt: Date.now(),
    },
    generationProgress: {
      stage: 'keyframes',
      generation_id: '',
      status: 'submitting',
      processed: 0,
      succeeded: 0,
      failed: 0,
    },
    shots: Array.from({ length: 6 }, (_, index) => ({ index: index + 1 })),
  };
  let staleGets = 0;
  await assert.rejects(
    () => flow.startStage('task-stale', 'keyframes', {}, {
      api: async (_url, options = {}) => {
        if (options.method === 'POST') throw new TypeError('Failed to fetch');
        staleGets += 1;
        return {
          task: {
            status: 'done',
            stage: 'keyframes_ready',
            active_generation_id: '',
            generation_started_at: oldGenerationStartedAt,
            generation_progress: {
              stage: 'keyframes',
              generation_id: 'generation-old',
              status: 'finished',
              processed: 6,
              succeeded: 2,
              failed: 4,
              started_at: oldGenerationStartedAt,
            },
          },
        };
      },
      normalizeBundle: () => {},
      toast: () => {},
      state: staleState,
    }),
    error => error instanceof TypeError && error.message === 'Failed to fetch',
    '上一轮完成状态不能作为本轮 POST 已被接收的证据',
  );
  assert.strictEqual(staleGets, 4);
  console.log('new story ad network recovery: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
