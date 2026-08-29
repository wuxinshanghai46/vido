#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const executable = file => read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');

async function verifyOptimisticSceneLanes() {
  const state = { bundle: { project: {
    id: 'task-v273', active_generation_id: '',
    target_generation_progress: { 'scene_asset:old': { generation_id: 'old' } },
    active_target_generations: {},
  } } };
  let next = null;
  const sandbox = { Date, Set };
  vm.runInNewContext(`${executable('public/story-ad/store/stageSubmissionState.js')}\nglobalThis.__begin=beginStageSubmissionState;`, sandbox);
  sandbox.__begin({ state, set: patch => { next = patch; } }, 'scene_asset', 2, '提交中', {
    mode: 'scene_batch', batch_scene_ids: ['scene-a', 'scene-b'],
    batch_actions: [
      { scene_id: 'scene-a', action: 'reverify', image_total: 0 },
      { scene_id: 'scene-b', action: 'generate', image_total: 5 },
    ],
  });
  const project = next.bundle.project;
  assert.match(project.active_generation_id, /^client-submitting:/);
  assert.equal(project.target_generation_progress['scene_asset:scene-a'].phase, 'verification');
  assert.equal(project.target_generation_progress['scene_asset:scene-a'].image_target_total, 0);
  assert.equal(project.target_generation_progress['scene_asset:scene-b'].image_target_total, 5);
  assert.equal(project.active_target_generations['scene_asset:scene-b'].status, 'queued');
}

async function verifyFreshGenerationClock() {
  const outputDir = path.join(root, '.tmp', 'story-ad-scene-submit-feedback-v273');
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  process.env.OUTPUT_DIR = outputDir;
  process.env.DB_ENABLED = '0';
  const storage = require('../src/services/newStoryAd/storageService');
  const targetProgress = require('../src/services/newStoryAd/targetGenerationProgressService');
  const factory = require('../src/services/newStoryAd/sceneBatchOrchestrationService');
  const taskId = 'clock-v273';
  storage.createTask({ id: taskId, title: 'clock fixture' });
  storage.updateTask(taskId, { target_generation_progress: {
    'scene_asset:scene-a': {
      generation_id: 'old-generation', status: 'failed',
      started_at: '2026-08-01T00:00:00.000Z', finished_at: '2026-08-01T00:01:00.000Z',
    },
  } });
  const orchestrator = factory.create({ storage, targetProgress, sceneAssets: {}, promptAuthority: {}, cancellation: {} });
  const first = orchestrator.writeSceneProgress(taskId, 'new-generation', {
    scene_id: 'scene-a', name: 'A', action: 'reverify', image_total: 0,
  }, { status: 'queued', started_at: '2026-08-29T07:00:00.000Z' });
  assert.equal(first.started_at, '2026-08-29T07:00:00.000Z', '新 generation 不得复用历史开始时间');
  assert.equal(first.finished_at, undefined, '新 generation 不得继承历史完成时间');
  const second = orchestrator.writeSceneProgress(taskId, 'new-generation', {
    scene_id: 'scene-a', name: 'A', action: 'reverify', image_total: 0,
  }, { status: 'verifying' });
  assert.equal(second.started_at, first.started_at, '同一 generation 的后续更新必须保留本轮开始时间');
}

async function verifyBoundedParallelVision() {
  const gateway = require('../src/services/newStoryAd/modelGateway');
  const model = { provider_id: 'parallel-fixture', model_id: 'vision' };
  const releaseOne = await gateway.acquireFailureDomainSubmission(model);
  const releaseTwo = await gateway.acquireFailureDomainSubmission(model);
  let thirdAcquired = false;
  const third = gateway.acquireFailureDomainSubmission(model).then(release => {
    thirdAcquired = true;
    return release;
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(thirdAcquired, false, '同一视觉通道最多并行两个请求，第三个必须排队');
  releaseOne();
  const releaseThree = await third;
  assert.equal(thirdAcquired, true, '释放一个槽位后排队请求必须继续');
  releaseTwo();
  releaseThree();
}

async function main() {
  await verifyOptimisticSceneLanes();
  await verifyFreshGenerationClock();
  await verifyBoundedParallelVision();
  const interactions = read('public/story-ad/views/sceneCardInteractions.js');
  const batchHandler = interactions.slice(interactions.indexOf("host.querySelector('[data-run-scene-actions]')"));
  assert(batchHandler.includes('await context.refreshCurrentView()'));
  assert(!batchHandler.includes('await context.refreshShell()'), '统一提交不得整页刷新造成黑屏');
  assert(batchHandler.indexOf('beginStageSubmission') < batchHandler.indexOf("runStage('scene-actions'"));

  const card = read('public/story-ad/views/scenePromptPreview.js');
  assert(card.indexOf('${progressMarkup}') < card.indexOf('<nav class="scene-production-tabs">'), '进度条必须位于场景图片上方');
  const page = read('public/story-ad/views/sceneWorldPage.js');
  assert(!page.includes("${preview.displayedCount} 个场景</span>"), '已有场景页头不得显示孤立数量');

  const qa = read('src/services/newStoryAd/sceneSpaceContractService.js');
  assert(qa.includes("structuredOutput: { mode: 'json_object', name: 'scene_visual_qa' }")
    && qa.includes("structuredOutput: { mode: 'json_object', name: 'scene_camera_qa' }"));
  assert(qa.includes('Keep JSON under 5200 characters.') && qa.includes('stageBudgetMs: 150000'));

  const qaPublic = {};
  vm.runInNewContext(`${executable('public/story-ad/views/sceneQaPublicState.js')}\nglobalThis.__state=sceneQaPublicState;`, qaPublic);
  const unavailable = qaPublic.__state({ scene_contract: {}, qa: { full_space_lock: false, qa_unavailable: true,
    reasons: ['PROVIDER_RESPONSE_INVALID 缺少 cameras structured_evidence'] } });
  assert.equal(unavailable.kind, 'service_unavailable');
  assert.match(unavailable.title, /审核结果不完整/);
  assert.doesNotMatch(unavailable.title, /未通过/);

  console.log(JSON.stringify({
    passed: true, optimistic_scene_lanes: 2, full_shell_refreshes: 0,
    fresh_generation_clock: true, visible_progress_position: 'above_scene_tabs',
    vision_parallelism: 2, structured_qa_contracts: 2, model_calls: 0,
  }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
