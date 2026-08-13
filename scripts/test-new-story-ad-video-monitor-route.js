#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  buildVideoMonitorPayload,
  createAdminOnly,
  monitorHealth,
  registerVideoMonitorRoute,
} = require('../src/routes/newStoryAd/videoMonitorRoute');

const NOW = Date.parse('2026-08-14T02:30:00.000Z');

assert.strictEqual(monitorHealth({ lifecycle: 'qa_passed' }, NOW), 'passed');
assert.strictEqual(monitorHealth({ lifecycle: 'qa_failed' }, NOW), 'failed');
assert.strictEqual(monitorHealth({
  lifecycle: 'provider_running',
  provider_task_id: 'provider-1',
  last_heartbeat_at: '2026-08-14T02:29:30.000Z',
}, NOW), 'provider_running');
assert.strictEqual(monitorHealth({
  lifecycle: 'provider_running',
  provider_task_id: 'provider-1',
  last_heartbeat_at: '2026-08-14T02:20:00.000Z',
}, NOW), 'suspected_stuck');

let denied;
createAdminOnly(req => req.user)(
  { user: { role: 'viewer' } },
  { status(code) { denied = { code }; return this; }, json(body) { denied.body = body; return body; } },
  () => assert.fail('非管理员不应进入视频监控路由'),
);
assert.strictEqual(denied.code, 403);
assert.strictEqual(denied.body.code, 'ADMIN_REQUIRED');

let adminPassed = false;
createAdminOnly(req => req.user)(
  { user: { role: 'ADMIN' } },
  {},
  () => { adminPassed = true; },
);
assert.strictEqual(adminPassed, true);

const outputs = {
  storyboard_table: [{ title: '开场' }, { title: '转场' }],
  keyframe_contracts: [],
  video_clips: [
    { file_path: '/tmp/shot-1.mp4', provider_used: 'deyunai/seedance', qa: { pass: true } },
    { error_code: 'VIDEO_QA_FAILED', qa: { pass: false } },
  ],
  video_repair_history: [{ shot_index: 1, attempt: 1 }],
  video_pipeline_policy: { version: 'policy-v1' },
  video_scene_blocks: [{ scene_id: 'scene-1' }],
  context: { person_asset: { name: '林舟', id: 'actor-1' }, person_contract: { status: 'verified' } },
};
const task = { id: 'monitor-task', generation_progress: { percent: 50 } };
const deps = {
  storage: { getOutput: (taskId, kind) => (taskId === task.id ? outputs[kind] : null) },
  videoAdapter: { listVideoShotStatuses: () => [] },
  videoGenerationUnits: { projectVideoGenerationUnits: shots => shots.map(shot => ({ index: shot.index, health: shot.health })) },
  service: {
    publicTaskBundle: () => ({ stages: [{ key: 'video' }], model_calls: [{ id: 'call-1' }] }),
    taskSummary: value => ({ ...value, title: '监控任务' }),
  },
};
const payload = buildVideoMonitorPayload(task, deps, {
  now: NOW,
  fileSystem: { existsSync: file => file === '/tmp/shot-1.mp4' },
});
assert.strictEqual(payload.task_id, task.id);
assert.strictEqual(payload.actor.asset_id, 'actor-1');
assert.strictEqual(payload.actor.verified, true);
assert.strictEqual(payload.shots.length, 2);
assert.strictEqual(payload.shots[0].health, 'passed');
assert.strictEqual(payload.shots[0].file_exists, true);
assert.strictEqual(payload.shots[1].health, 'failed');
assert.strictEqual(payload.generation_units.length, 2);
assert.strictEqual(payload.model_calls.length, 1);

let registered;
registerVideoMonitorRoute({
  get(path, ...handlers) { registered = { path, handlers }; },
}, {
  ...deps,
  asyncRoute: handler => handler,
  userFromReq: req => req.user || {},
  storage: { ...deps.storage, getTask: () => task },
});
assert.strictEqual(registered.path, '/admin/tasks/:id/video-monitor');
assert.strictEqual(registered.handlers.length, 2);

console.log(JSON.stringify({
  passed: true,
  route: registered.path,
  projected_shots: payload.shots.length,
  admin_guard_verified: true,
  stale_health_verified: true,
}));
