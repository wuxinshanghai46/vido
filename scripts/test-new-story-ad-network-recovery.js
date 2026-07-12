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
  const response = await flow.startStage('task-1', 'storyboard', {}, {
    api: async (url, options = {}) => {
      if (options.method === 'POST') throw new TypeError('Failed to fetch');
      gets += 1;
      if (gets === 1) return { task: { status: 'running', stage: 'storyboard', active_generation_id: 'g-1' } };
      return { task: { status: 'done', stage: 'keyframe_contract_ready', active_generation_id: '' }, outputs: { storyboard_table: [] } };
    },
    normalizeBundle: bundle => normalized.push(bundle.task.stage),
    toast: () => {},
  });
  assert.strictEqual(response.task.stage, 'keyframe_contract_ready');
  assert.strictEqual(gets, 2);
  assert(normalized.includes('storyboard'));
  console.log('new story ad network recovery: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
