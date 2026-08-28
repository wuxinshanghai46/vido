#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'story-ad-scene-batch-orchestration-v255');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const targetProgress = require('../src/services/newStoryAd/targetGenerationProgressService');
const progressProjection = require('../src/services/newStoryAd/taskProgressProjectionService');
const cancellation = require('../src/services/newStoryAd/cancellationContext');
const jobs = require('../src/services/newStoryAd/jobService');
const sceneBatchFactory = require('../src/services/newStoryAd/sceneBatchOrchestrationService');

const taskId = 'scene-batch-v255-task';
let activeCalls = 0;
let peakCalls = 0;
const callOrder = [];

const sceneAssets = {
  normalizeSceneAssets(value) { return Array.isArray(value) ? value : []; },
  buildSceneRepairPlan(value = {}) { return value.repair_plan || { action: 'none' }; },
  async generateSceneAsset(id, body) {
    assert.equal(id, taskId);
    activeCalls += 1;
    peakCalls = Math.max(peakCalls, activeCalls);
    callOrder.push(`generate:${body.scene_id}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    activeCalls -= 1;
    return { provider_image_call_count: 0 };
  },
  async fixSceneAsset() { throw new Error('fixture must not use repair for an absent scene'); },
  async reverifySceneAsset(id, sceneId) {
    assert.equal(id, taskId);
    activeCalls += 1;
    peakCalls = Math.max(peakCalls, activeCalls);
    callOrder.push(`reverify:${sceneId}`);
    await new Promise(resolve => setTimeout(resolve, 10));
    activeCalls -= 1;
    return {
      scene_asset: {
        scene_id: sceneId,
        repair_plan: { action: 'reverify' },
        scene_contract: { qa_error: 'fixture qa unavailable' },
      },
    };
  },
};

const promptAuthority = {
  assertCurrentPrompt(id, sceneId, input = {}) {
    assert.equal(id, taskId);
    return { prompt_version_id: input.prompt_version_id || `prompt-${sceneId}` };
  },
};

const orchestrator = sceneBatchFactory.create({
  storage, sceneAssets, promptAuthority, targetProgress, cancellation,
});

async function waitFor(predicate, message, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  assert.fail(message);
}

async function main() {
  storage.createTask({ id: taskId, title: 'scene batch fixture', content_revision: 1 });
  storage.saveOutput(taskId, 'scene_assets', [{
    scene_id: 'scene-review', name: '保留图片场景',
    repair_plan: { action: 'reverify', version: 2 }, scene_revision: 3,
  }]);
  const plan = orchestrator.plan(taskId, { actions: [
    { scene_id: 'scene-generate', name: '缺图场景', prompt_version_id: 'prompt-generate' },
    { scene_id: 'scene-review', name: '保留图片场景', prompt_version_id: 'prompt-review' },
    { scene_id: 'scene-review', name: '重复项必须去重', prompt_version_id: 'prompt-review' },
  ] });
  assert.deepEqual(plan.actions.map(item => item.action), ['generate', 'reverify']);
  assert.equal(plan.actions.length, 2, '同一场景必须只进入一次批处理');
  storage.updateTask(taskId, { active_target_generations: {
    'scene_qa:other': { generation_id: 'other', stage: 'scene_qa', target_id: 'other', status: 'running' },
  } });
  assert.throws(() => orchestrator.plan(taskId, { actions: [{ scene_id: 'scene-generate' }] }), error => (
    error?.code === 'SCENE_BATCH_BUSY'
  ), '已有场景任务运行时必须拒绝重叠批处理');
  storage.updateTask(taskId, { active_target_generations: {} });

  const queued = jobs.queueStage({
    taskId,
    stage: 'scene_asset',
    scopeId: sceneBatchFactory.DEFAULT_SCOPE_ID,
    idempotencyKey: 'scene-batch-v255-fixture',
    execute: job => orchestrator.execute(taskId, plan, job),
  });
  assert.equal(queued.accepted, true);
  await waitFor(() => !storage.getTask(taskId)?.active_generation_id, '场景批处理必须可靠进入终态');

  const task = storage.getTask(taskId);
  assert.equal(task.status, 'done');
  assert.equal(task.generation_progress.mode, 'scene_batch');
  assert.equal(task.generation_progress.target_total, 2);
  assert.equal(task.generation_progress.processed, 2);
  assert.equal(task.generation_progress.succeeded, 1);
  assert.equal(task.generation_progress.failed, 1);
  assert.equal(task.generation_progress.percent, 100);
  assert.equal(peakCalls, 1, '批处理内部不得并发争抢任务状态');
  assert.deepEqual(callOrder, ['generate:scene-generate', 'reverify:scene-review']);

  const resultRow = storage.listOutputs(taskId).find(row => row.kind.startsWith('scene_batch_result:'));
  assert(resultRow, '批处理必须持久化逐场景结果');
  assert.equal(resultRow.payload.results[1].error_code, 'SCENE_QA_EVIDENCE_UNAVAILABLE');
  assert.equal(resultRow.payload.provider_image_call_count, 0);

  const projected = progressProjection.projectTaskProgress(task).task.generation_progress;
  assert.equal(projected.mode, 'scene_batch');
  assert.deepEqual(projected.batch_scene_ids, ['scene-generate', 'scene-review']);

  const client = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneCardInteractions.js'), 'utf8');
  const batchHandler = client.slice(client.indexOf("host.querySelector('[data-run-scene-actions]')"));
  assert.equal((batchHandler.match(/runStage\('scene-actions'/g) || []).length, 1, '一个按钮只能提交一个服务器任务');
  assert(!batchHandler.includes('Promise.allSettled'), '统一按钮不得再次拆成并发场景请求');
  const actionPlan = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneBatchActionPlan.js'), 'utf8');
  assert(actionPlan.includes("=== 'scene-batch'") && actionPlan.includes('if (batchActive)'), '批任务排队后必须立即隐藏重复提交入口');
  const route = fs.readFileSync(path.join(root, 'src/routes/newStoryAd/sceneBatchRoutes.js'), 'utf8');
  assert(route.includes("router.post('/tasks/:id/scene-actions'") && route.includes('scopeId: orchestration.DEFAULT_SCOPE_ID'));
  const routeRoot = fs.readFileSync(path.join(root, 'src/routes/newStoryAd.js'), 'utf8');
  assert(routeRoot.includes('registerSceneBatchRoutes(router'), '主路由必须注册拆分后的场景批处理模块');

  console.log(JSON.stringify({
    passed: true,
    one_button_requests: 1,
    scenes_processed: 2,
    succeeded: 1,
    failed: 1,
    peak_concurrency: peakCalls,
    provider_image_calls: 0,
  }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
