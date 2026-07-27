#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/task-persistence.js'), 'utf8');
const sandbox = { window: {}, console, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

async function main() {
  const persistence = sandbox.window.NewStoryAdTaskPersistence;
  const state = {
    taskId: 'autosave-task',
    context: { brief: '自动保存并发测试内容' },
    pendingChangeScope: 'source',
    pendingChangeDomains: ['source'],
    pendingMediaChange: 'none',
    clientEditSeq: 1,
    acknowledgedClientEditSeq: 0,
    contentRevision: 1,
    shots: [],
    contracts: [],
    keyframes: [],
    sceneAssets: [],
    videoClips: [],
  };
  let resolveFirst;
  const firstResponse = new Promise(resolve => { resolveFirst = resolve; });
  let markFirstStarted;
  const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });
  let calls = 0;
  const api = async (url, options) => {
    calls += 1;
    if (calls === 1) {
      assert.equal(options.body.client_edit_seq, 1);
      assert.deepEqual(options.body.changed_domains, ['source']);
      markFirstStarted();
      return firstResponse;
    }
    assert.equal(options.body.client_edit_seq, 2);
    assert(options.body.changed_domains.includes('creative'));
    return {
      content_revision: 3,
      acknowledged_client_edit_seq: 2,
      task: { content_revision: 3, latest_client_edit_seq: 2 },
    };
  };
  const ctx = {
    state,
    api,
    payload: () => ({
      brief: state.context.brief,
      change_scope: state.pendingChangeScope,
      changed_domains: state.pendingChangeDomains,
      base_content_revision: state.contentRevision,
      client_edit_seq: state.clientEditSeq,
    }),
  };

  const saving = persistence.saveCurrentTaskProgress({ silent: true, render: false }, ctx);
  await firstStarted;
  state.clientEditSeq = 2;
  state.pendingChangeDomains.push('creative');
  resolveFirst({
    content_revision: 2,
    acknowledged_client_edit_seq: 1,
    task: { content_revision: 2, latest_client_edit_seq: 1 },
  });
  await saving;
  assert.equal(state.pendingChangeScope, 'source', '旧保存响应不能清空保存期间产生的新修改');
  assert(state.pendingChangeDomains.includes('creative'));
  assert.equal(state.acknowledgedClientEditSeq, 1);

  await persistence.saveCurrentTaskProgress({ silent: true, render: false }, ctx);
  assert.equal(state.pendingChangeScope, 'none');
  assert.deepEqual(state.pendingChangeDomains, []);
  assert.equal(state.acknowledgedClientEditSeq, 2);
  assert.equal(state.contentRevision, 3);
  console.log('new story ad autosave revision: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
