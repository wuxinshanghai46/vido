'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
assert(source.includes('personPlanRequestGuard.run(async (requestKey)'), 'person plan click must enter the shared guard before loading the action');
assert(source.includes("import('./assetCenterPlanMigrationAction.js"), 'person plan submission action must stay click-lazy');

const statusSource = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPlanReleaseStatus.js'), 'utf8')
  .replace(/export\s+(?=(?:async\s+)?function\s+)/g, '') + '\n;globalThis.__view = personPlanBlockedView; globalThis.__guard = createPersonPlanRequestGuard;';
const sandbox = {};
vm.runInNewContext(statusSource, sandbox, { filename: 'asset-center-plan-status-v52.js' });
const compatible = sandbox.__view({
  issues: ['active_plan_bundle_mismatch'],
  release_migration: { compatible: true, migration_required: true },
});
assert.match(compatible, /方案可安全升级/);
assert.match(compatible, /模型调用为 0/);
assert.match(compatible, /data-release-migration-only="true"/);
const incompatible = sandbox.__view({
  issues: ['active_plan_input_fingerprint_mismatch'],
  release_migration: { compatible: false, migration_required: false },
});
assert.match(incompatible, /人物方案需要更新/);
assert.doesNotMatch(incompatible, /方案可安全升级/);
const actionSource = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPlanMigrationAction.js'), 'utf8');
assert(actionSource.includes("store.runStage('person-plan', { request_key: requestKey })"), 'person plan submission must send the guard request key');
assert(actionSource.includes('result?.job?.support_id || result?.job?.id'), 'accepted job must expose a support id to the user');

// Exercise the exact guard used by the event handler with a real store-shaped
// runStage stub: two simultaneous events share one request and one key.
let requests = 0;
const requestKey = 'person-plan:task:r8:stable';
const guard = sandbox.__guard(requestKey);
const store = { async runStage(stage, body) { requests += 1; await Promise.resolve(); return { stage, body, job: { support_id: 'support-1' } }; } };
const click = (confirmResult = true, fail = false) => guard.run(async key => {
  if (!confirmResult) return false;
  if (fail) throw new Error('simulated-request-failure');
  return store.runStage('person-plan', { request_key: key });
});
async function main() {
  const [first, second] = await Promise.all([click(true), click(true)]);
  assert(first && second.skipped === true);
  assert.equal(requests, 1, 'double click must submit only one request');
  assert.equal((await click(false)), false);
  assert.equal(requests, 1, 'cancelled confirmation must not submit');
  await assert.rejects(click(true, true), /simulated-request-failure/);
  assert.equal(guard.active, false, 'failed request must restore the button lock');
  const retry = await click(true);
  assert.equal(retry.body.request_key, requestKey);
  assert.equal(retry.job.support_id, 'support-1');
  assert.equal(requests, 2);
  console.log(JSON.stringify({ passed: true, simultaneous_click_requests: 1, cancellation_requests: 0, failure_restored: true, support_id_visible: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
