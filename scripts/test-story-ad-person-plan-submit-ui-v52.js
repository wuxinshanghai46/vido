'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
assert(source.includes('personPlanRequestGuard.run(async (requestKey)'), 'person plan click must enter the shared guard before loading the action');
assert(source.includes("import('./assetCenterPlanMigrationAction.js"), 'person plan submission action must stay click-lazy');

const guardSource = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterRequestGuard.js'), 'utf8').replace(/\bexport\s+/g, '');
const statusSource = ['assetCenterInlineProgress.js', 'assetCenterTechnicalDetails.js', 'assetCenterPlanReleaseStatus.js']
  .map(file => fs.readFileSync(path.join(root, `public/story-ad/views/${file}`), 'utf8')).join('\n')
  .replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '') + '\n;globalThis.__view = personPlanBlockedView;';
const guardSandbox = {};
vm.runInNewContext(`${guardSource}\nglobalThis.__person = createPersonPlanRequestGuard; globalThis.__keyed = createKeyedRequestGuard;`, guardSandbox);
const sandbox = { escapeHtml: value => String(value) };
vm.runInNewContext(statusSource, sandbox, { filename: 'asset-center-plan-status-v52.js' });
sandbox.__guard = guardSandbox.__person;
const compatible = sandbox.__view({
  issues: ['active_plan_bundle_mismatch'],
  release_migration: { compatible: true, migration_required: true },
});
assert.match(compatible, /生成人物方案/);
assert.doesNotMatch(compatible, /复用兼容方案并生成缺失的人物图片|技术详情/);
assert.doesNotMatch(compatible, /status-tag|方案可安全升级/);
assert.match(compatible, /data-release-migration-only="true"/);
const incompatible = sandbox.__view({
  issues: ['active_plan_input_fingerprint_mismatch'],
  release_migration: { compatible: false, migration_required: false },
});
assert.match(incompatible, /生成人物方案/);
assert.doesNotMatch(incompatible, /补全详细人物方案，并继续生成缺失的人物图片|技术详情/);
assert.doesNotMatch(incompatible, /人物方案需要更新|文字方案确认后，再单独生成图片/);
assert.doesNotMatch(incompatible, /<button[^>]+disabled[^>]*>文字方案确认后/);
assert.doesNotMatch(incompatible, /方案可安全升级/);
const actionSource = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPlanMigrationAction.js'), 'utf8');
assert(actionSource.includes("store.runStage('person-plan', { request_key: requestKey })"), 'person plan and subject image submission must send the guard request key');
assert.doesNotMatch(actionSource, /人物方案和缺失图片已进入同一个生成任务/, '成功提交后页面进度已经提供反馈，不应再显示重复说明弹窗');
assert.doesNotMatch(actionSource, /support_id|支持编号/, '普通用户提交成功提示不得暴露底层支持编号');

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
  console.log(JSON.stringify({ passed: true, simultaneous_click_requests: 1, cancellation_requests: 0, failure_restored: true, support_id_visible: false }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
