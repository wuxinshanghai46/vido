#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const failure = require('../src/services/newStoryAd/publicFailureProjectionService');
const progress = require('../src/services/newStoryAd/taskProgressProjectionService');

const internal = '支持编号：support-secret。new_story_ad.asset_plan 模型调用失败：实际尝试 1/3 个本阶段候选（全部可用候选 4 个）：apismile/gpt-5.5:TIMEOUT_OR_NETWORK';
const task = {
  id: 'task-safe-diagnostics', status: 'failed', stage: 'person_plan', error: internal,
  error_code: 'TIMEOUT_OR_NETWORK', support_id: 'support-secret', diagnostics: { provider: 'apismile' },
  generation_progress: { status: 'failed', stage: 'new_story_ad.asset_plan', message: internal, support_id: 'support-secret' },
};

const ordinary = failure.publicTask(task);
assert.doesNotMatch(JSON.stringify(ordinary), /support-secret|new_story_ad|apismile|gpt-5\.5|TIMEOUT_OR_NETWORK|本阶段候选/);
assert.match(ordinary.error, /稍后从当前步骤重新生成/);
assert.equal(ordinary.support_id, undefined);
assert.equal(ordinary.diagnostics, undefined);

const admin = failure.project(task, { isAdmin: true });
assert.match(JSON.stringify(admin.technical_diagnostics), /support-secret|apismile|gpt-5\.5|TIMEOUT_OR_NETWORK/);
assert.doesNotMatch(admin.public_error, /support-secret|apismile|gpt-5\.5/);

const polled = progress.projectTaskProgress(task);
assert.doesNotMatch(JSON.stringify(polled), /support-secret|new_story_ad|apismile|gpt-5\.5|TIMEOUT_OR_NETWORK|本阶段候选/);

function browserModule(file, exposed) {
  const source = read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
  const sandbox = { globalThis: {}, escapeHtml: value => String(value).replace(/[<>&"']/g, '_') };
  vm.runInNewContext(`${source}\nglobalThis.__tested={${exposed.join(',')}};`, sandbox, { filename: file });
  return sandbox.globalThis.__tested;
}
const ui = browserModule('public/story-ad/views/assetCenterPlanReleaseStatus.js', ['personPlanBlockedView']);
const eligibility = { issues: ['task_current_planning_stage_failed'] };
const ordinaryHtml = ui.personPlanBlockedView(eligibility, false, { isAdmin: false, diagnostics: admin.technical_diagnostics });
assert.doesNotMatch(ordinaryHtml, /技术详情|support-secret|apismile|gpt-5\.5|TIMEOUT_OR_NETWORK/);
assert.match(ordinaryHtml, /人物方案暂未完成/);
const adminHtml = ui.personPlanBlockedView(eligibility, false, { isAdmin: true, diagnostics: admin.technical_diagnostics });
assert.match(adminHtml, /<details class="asset-plan-admin-diagnostics">/);
assert.doesNotMatch(adminHtml, /<details[^>]+open/);
assert.match(adminHtml, /技术详情（仅超管）|support-secret|gpt-5\.5/);

const route = read('src/routes/newStoryAd.js');
assert.match(route, /仅超管可查看技术详情/);
assert.match(route, /publicFailure\.publicTask/);
const bundleProjection = read('src/services/storyAdWorkspace/projectBundleService.js');
assert.match(bundleProjection, /technical_diagnostics/);
assert.match(bundleProjection, /is_admin:\s*isAdmin/);

console.log(JSON.stringify({ passed: true, assertions: 18, ordinary_server_redaction: true, admin_collapsed_diagnostics: true, progress_redaction: true }));
