#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const stateSyncSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/state-sync.js'), 'utf8');
const persistenceSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/task-persistence.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/storyAdService.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/newStoryAd.js'), 'utf8');
const sandbox = {
  window: {},
  document: { querySelector: () => null },
  console,
  setTimeout,
  clearTimeout,
  URL,
  Date,
  Math,
  Number,
  String,
  JSON,
};
vm.runInNewContext(stateSyncSource, sandbox, { filename: 'state-sync.js' });
const sync = sandbox.window.NewStoryAdStateSync;

const current = {
  taskSessionEpoch: 4,
  taskId: 'new-task',
  context: { brief: 'NEW' },
  sceneConfig: { name: 'NEW SCENE' },
  shots: [],
  contracts: [],
  keyframes: [],
  videoClips: [],
  contentRevision: 1,
};
let remembered = '';
const lateOldAccepted = sync.normalizeBundle({
  task: { id: 'old-task', content_revision: 9 },
  outputs: { context: { brief: 'OLD' }, scene_config: { name: 'OLD SCENE' } },
}, {
  state: current,
  rememberTaskId: id => { remembered = id; },
  expectedTaskId: 'old-task',
  expectedSessionEpoch: 3,
});
assert.equal(lateOldAccepted, false);
assert.equal(current.taskId, 'new-task');
assert.equal(current.context.brief, 'NEW');
assert.equal(current.sceneConfig.name, 'NEW SCENE');
assert.equal(remembered, '');

const wrongTaskSameEpoch = sync.normalizeBundle({
  task: { id: 'old-task', content_revision: 9 },
  outputs: { context: { brief: 'OLD' } },
}, {
  state: current,
  expectedTaskId: 'new-task',
  expectedSessionEpoch: 4,
});
assert.equal(wrongTaskSameEpoch, false);
assert.equal(current.context.brief, 'NEW');

const accepted = sync.normalizeBundle({
  task: { id: 'new-task', content_revision: 2 },
  outputs: { context: { brief: 'NEWER' } },
}, {
  state: current,
  expectedTaskId: 'new-task',
  expectedSessionEpoch: 4,
});
assert.equal(accepted, true);
assert.equal(current.context.brief, 'NEWER');

vm.runInNewContext(persistenceSource, sandbox, { filename: 'task-persistence.js' });
const persistence = sandbox.window.NewStoryAdTaskPersistence;
const creatingState = {
  taskSessionEpoch: 7,
  taskId: '',
  clientEditSeq: 0,
  pendingChangeDomains: [],
};
const createPromise = persistence.ensureTask({
  state: creatingState,
  payload: () => ({ brief: '足够长的新任务广告需求' }),
  api: async () => {
    creatingState.taskSessionEpoch = 8;
    return { task: { id: 'orphan-response' }, content_revision: 1 };
  },
});
createPromise.then(
  () => assert.fail('late create response must be rejected'),
  error => {
    assert.equal(error.code, 'TASK_SESSION_REPLACED');
    assert.equal(creatingState.taskId, '');
  },
).then(() => {
  assert.match(serviceSource, /const id = cleanText\(body\.task_id \|\| body\.taskId/);
  const createRoute = routeSource.slice(routeSource.indexOf("router.post('/tasks'"), routeSource.indexOf("router.delete('/tasks"));
  assert.match(createRoute, /delete body\.task_id/);
  assert.match(createRoute, /delete body\.taskId/);
  console.log('new-story-ad task isolation tests passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
