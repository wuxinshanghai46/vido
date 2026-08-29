#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
process.env.DB_ENABLED = '0';
process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-v275-redline-'));

async function main() {
  const storage = require('../src/services/newStoryAd/storageService');
  const jobs = require('../src/services/newStoryAd/jobService');
  const projection = require('../src/services/newStoryAd/taskProgressProjectionService');
  const taskId = 'new-contract-redline-v275';
  storage.createTask({ id: taskId, title: 'redline fixture' });
  const before = JSON.stringify(storage.getTask(taskId));
  let executionCalls = 0;
  assert.throws(() => jobs.queueStage({
    taskId, stage: 'scene_qa', scopeId: 'scene-a',
    execute: async () => { executionCalls += 1; },
  }), error => error?.code === 'LEGACY_SCENE_QA_STAGE_DISABLED' && error?.status === 410 && error?.retryable === false);
  assert.equal(executionCalls, 0, '旧 stage 必须在 execute 之前停止');
  assert.equal(JSON.stringify(storage.getTask(taskId)), before, '旧 stage 必须在任何任务状态写入之前停止');

  const publicProgress = projection.projectTaskProgress({
    id: taskId, status: 'running', active_generation_id: 'new-generation',
    active_target_generations: {
      'scene_qa:scene-a': { stage: 'scene_qa', generation_id: 'old-generation', target_id: 'scene-a', status: 'running' },
      'scene_asset:scene-a': { stage: 'scene_asset', generation_id: 'new-generation', target_id: 'scene-a', status: 'running' },
    },
    target_generation_progress: {
      'scene_qa:scene-a': { stage: 'scene_qa', generation_id: 'old-generation', started_at: '2026-08-28T00:00:00Z' },
      'scene_asset:scene-a': { stage: 'scene_asset', generation_id: 'new-generation', started_at: '2026-08-29T00:00:00Z' },
    },
  }).task;
  assert.deepEqual(Object.keys(publicProgress.active_target_generations), ['scene_asset:scene-a']);
  assert.deepEqual(Object.keys(publicProgress.target_generation_progress), ['scene_asset:scene-a']);

  const routes = read('src/routes/newStoryAd.js');
  const fixRoute = routes.slice(routes.indexOf("router.post('/tasks/:id/scene-assets/:sceneId/fix'"), routes.indexOf("router.get('/tasks/:id/progress'"));
  assert.match(fixRoute, /LEGACY_SCENE_FIX_DISABLED/);
  assert.doesNotMatch(fixRoute, /queueTaskStage|reverifySceneAsset|fixSceneAsset|generateSceneAsset/);

  const executionSources = [
    read('public/story-ad/views/sceneWorldPage.js'),
    read('public/story-ad/views/sceneBatchActionPlan.js'),
    read('public/story-ad/views/sceneCardInteractions.js'),
    read('src/services/newStoryAd/sceneBatchOrchestrationService.js'),
  ].join('\n');
  assert.doesNotMatch(executionSources, /scene_qa/, '新场景页面、动作规划和编排不得读取或提交旧 stage');
  assert.doesNotMatch(read('public/story-ad/views/scenePromptPreview.js'), /data-fix-scene=/, '旧单场景按钮不得渲染');
  assert.doesNotMatch(read('public/story-ad/views/sceneQaActions.js'), /runStage\(|fetch\(|scene-assets\//, '旧客户端模块只能拒绝，不能调用接口');

  console.log(JSON.stringify({
    passed: true, legacy_stage_http_status: 410, legacy_stage_writes: 0,
    legacy_stage_execution_calls: executionCalls, projected_legacy_targets: 0,
    legacy_fix_route_calls: 0, current_stage: 'scene_asset',
  }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
