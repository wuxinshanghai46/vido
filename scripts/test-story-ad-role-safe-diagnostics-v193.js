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
const errorPermission = require('../src/services/newStoryAd/storyAdErrorPermissionService');
const { updatePersonPlanProgress } = require('../src/routes/newStoryAd/personPlanGenerationRoute');

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
const projectedLive = failure.publicProgress({ stage: 'person_plan', status: 'running', phase: 'planning', percent: 37, processed: 37, total: 100 });
assert.equal(projectedLive.percent, 37);
assert.equal(projectedLive.phase, 'planning');

let persistedTask = { active_generation_id: 'gen-progress', generation_started_at: '2026-08-23T10:00:00.000Z' };
const fakeStorage = { getTask: () => persistedTask, updateTask: (_id, patch) => { persistedTask = { ...persistedTask, ...patch }; } };
updatePersonPlanProgress(fakeStorage, 'task-progress', 'gen-progress', { percent: 20, phase: 'asset_preflight', message: '正在核对缺失图片' });
assert.equal(persistedTask.generation_progress.percent, 20);
assert.equal(persistedTask.generation_progress.phase, 'asset_preflight');
assert.equal(updatePersonPlanProgress(fakeStorage, 'task-progress', 'other-generation', { percent: 80 }), null);

const permissionStore = {
  getUserById: id => id === 'designated' ? { id, role: 'support-reviewer' } : null,
  getRoleById: id => id === 'support-reviewer' ? { id, permissions: ['enterprise:luxury_ad_pipeline_debug:view_errors'] } : { id, permissions: [] },
};
assert.equal(errorPermission.canViewErrors({ id: 'admin-1', role: 'admin' }, permissionStore), true);
assert.equal(errorPermission.canViewErrors({ id: 'designated', role: 'support-reviewer' }, permissionStore), true);
assert.equal(errorPermission.canViewErrors({ id: 'ordinary', role: 'user' }, permissionStore), false);

function browserModule(file, exposed) {
  const source = read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
  const sandbox = { globalThis: {}, escapeHtml: value => String(value).replace(/[<>&"']/g, '_'), personPlanProgressMarkup: (active, label) => active ? `<div data-person-plan-inline-progress role="progressbar">正在准备${label}</div>` : '' };
  if (source.includes('personPlanTechnicalDetails')) vm.runInNewContext(read('public/story-ad/views/assetCenterTechnicalDetails.js').replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, ''), sandbox);
  vm.runInNewContext(`${source}\nglobalThis.__tested={${exposed.join(',')}};`, sandbox, { filename: file });
  return sandbox.globalThis.__tested;
}
const ui = browserModule('public/story-ad/views/assetCenterPlanReleaseStatus.js', ['personPlanBlockedView']);
const eligibility = { issues: ['task_current_planning_stage_failed'] };
const ordinaryHtml = ui.personPlanBlockedView(eligibility, false, { isAdmin: false, diagnostics: admin.technical_diagnostics });
assert.doesNotMatch(ordinaryHtml, /技术详情|support-secret|apismile|gpt-5\.5|TIMEOUT_OR_NETWORK/);
assert.doesNotMatch(ordinaryHtml, /系统会根据|人物方案暂未完成|已保存的人物身份|不是系统找不到同一个人物/);
const adminHtml = ui.personPlanBlockedView(eligibility, false, { isAdmin: true, diagnostics: admin.technical_diagnostics });
assert.match(adminHtml, /<section class="asset-plan-admin-diagnostics is-visible"[^>]*data-admin-failure-details/);
assert.match(adminHtml, /具体失败原因（授权账号可见）|系统会根据|support-secret|gpt-5\.5/);
const activeHtml = ui.personPlanBlockedView(eligibility, true, { isAdmin: false });
assert.match(activeHtml, /disabled>正在生成人物方案/);
assert.doesNotMatch(activeHtml, /data-person-plan-inline-progress|role="progressbar"/);
assert.doesNotMatch(activeHtml, /系统会根据|技术详情/);
assert.match(read('public/story-ad/components/ui.js'), /project-generation-progress[\s\S]*project-progress-track/);

const route = read('src/routes/newStoryAd.js');
assert.match(route, /storyAdErrorPermission\.canViewErrors/);
assert.match(route, /publicFailure\.publicTask/);
const bundleProjection = read('src/services/storyAdWorkspace/projectBundleService.js');
assert.match(bundleProjection, /technical_diagnostics/);
assert.match(bundleProjection, /is_admin:\s*isAdmin/);
assert.match(bundleProjection, /can_view_errors:\s*canViewErrors/);
assert.match(read('public/story-ad/components/ui.js'), /data-authorized-error-details/);

console.log(JSON.stringify({ passed: true, assertions: 31, ordinary_server_redaction: true, authorized_diagnostics: true, designated_role_permission: true, progress_redaction: true, person_plan_progress_persisted: true, top_progress_visible: true, inline_progress_removed: true }));
