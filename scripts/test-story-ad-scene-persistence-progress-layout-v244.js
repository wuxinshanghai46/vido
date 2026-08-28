#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'story-ad-scene-persistence-progress-layout-v244');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const checkpoint = require('../src/services/newStoryAd/sceneGenerationCheckpointService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const targetProgress = require('../src/services/newStoryAd/targetGenerationProgressService');
const progressProjection = require('../src/services/newStoryAd/taskProgressProjectionService');
const jobs = require('../src/services/newStoryAd/jobService');
const { sceneAssets: projectScenes } = require('../src/services/storyAdWorkspace/projectBundleService');

function saveImage(name, value = 'image') {
  fs.mkdirSync(mediaAdapter.ASSET_DIR, { recursive: true });
  const file = mediaAdapter.assetPathFromName(name);
  fs.writeFileSync(file, value);
  return { file, url: `/api/new-story-ad/assets/${encodeURIComponent(name)}` };
}

function testPublishedCheckpointMediaCannotBeDeleted() {
  const taskId = 'persistence-task';
  storage.createTask({ id: taskId, title: 'asset persistence' });
  const published = saveImage('scene_asset_formal_candidate_master_image.png');
  storage.saveOutput(taskId, 'scene_assets', [{
    scene_id: 'scene-a', generation_contract_version: sceneAssets.SCENE_GENERATION_CONTRACT_VERSION,
    image_url: published.url, view_images: [{ key: 'master', image_url: published.url }],
  }]);
  storage.saveOutput(taskId, checkpoint.outputKind('scene-a'), {
    schema_version: checkpoint.CHECKPOINT_SCHEMA_VERSION, task_id: taskId, scene_id: 'scene-a',
    input_fingerprint: 'old', candidate_revision: 1, status: 'partial', view_keys: ['master'],
    views: { master: { key: 'master', status: 'succeeded', image_url: published.url } },
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  checkpoint.open({ taskId, sceneId: 'scene-a', fingerprint: 'new', candidateRevision: 2, viewKeys: ['master'] });
  assert(fs.existsSync(published.file), '正式 scene_assets 引用的 candidate 命名图片不得被失效检查点删除');

  const orphan = saveImage('scene_asset_orphan_candidate_master_image.png', 'orphan');
  storage.saveOutput(taskId, checkpoint.outputKind('scene-orphan'), {
    schema_version: checkpoint.CHECKPOINT_SCHEMA_VERSION, task_id: taskId, scene_id: 'scene-orphan',
    input_fingerprint: 'old', candidate_revision: 1, status: 'partial', view_keys: ['master'],
    views: { master: { key: 'master', status: 'succeeded', image_url: orphan.url } },
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  checkpoint.open({ taskId, sceneId: 'scene-orphan', fingerprint: 'new', candidateRevision: 2, viewKeys: ['master'] });
  assert(!fs.existsSync(orphan.file), '没有任何正式输出引用的临时候选文件仍应被清理');
}

function testMissingFilesBecomeExplicitRepairTargets() {
  const missingUrl = '/api/new-story-ad/assets/missing-scene-master.png';
  const asset = {
    scene_id: 'scene-missing', name: '缺失资产场景',
    generation_contract_version: sceneAssets.SCENE_GENERATION_CONTRACT_VERSION,
    image_url: missingUrl,
    view_images: [
      { key: 'master', image_url: missingUrl },
      ...['reverse', 'interaction', 'detail', 'layout'].map(key => ({ key, image_url: `https://example.invalid/${key}.png` })),
    ],
  };
  const normalized = sceneAssets.normalizeSceneAssets([asset])[0];
  assert(!normalized.view_images.some(view => view.key === 'master'), '磁盘已丢失的本地图片不得继续作为可用视图');
  assert.deepEqual(normalized.missing_file_view_keys, ['master']);
  assert(normalized.repair_plan.view_keys.includes('master'), '缺失文件必须进入真正的定向修复计划');

  const projected = projectScenes({ scene_assets: [asset] }, {})[0];
  assert(!projected.view_images.some(view => view.key === 'master'), '工作区不得继续投影会返回 404 的旧视图');
  assert(projected.failed_view_keys.includes('master'));
  assert(projected.repair_plan.view_keys.includes('master'));
}

function testConcurrentProgressIsAggregatedPerScene() {
  let task = { active_stage: 'scene_asset', active_target_generations: {
    'scene_asset:scene-a': { generation_id: 'gen-a', stage: 'scene_asset', target_id: 'scene-a' },
    'scene_asset:scene-b': { generation_id: 'gen-b', stage: 'scene_asset', target_id: 'scene-b' },
  } };
  let patch = targetProgress.upsert(task, {
    stage: 'scene_asset', scopeId: 'scene-a', generationId: 'gen-a', status: 'running',
    progress: { target_total: 1, processed: 0, succeeded: 0, failed: 0 },
  });
  task = { ...task, ...patch };
  patch = targetProgress.upsert(task, {
    stage: 'scene_asset', scopeId: 'scene-b', generationId: 'gen-b', status: 'running',
    progress: { target_total: 1, processed: 0, succeeded: 0, failed: 0 },
  });
  task = { ...task, ...patch };

  task.active_target_generations = { 'scene_asset:scene-b': task.active_target_generations['scene_asset:scene-b'] };
  patch = targetProgress.upsert(task, {
    stage: 'scene_asset', scopeId: 'scene-a', generationId: 'gen-a', status: 'done',
    progress: { target_total: 1, processed: 1, succeeded: 1, failed: 0 },
  });
  task = { ...task, ...patch };
  assert.equal(task.generation_progress.status, 'running', '一个场景完成时，另一场景仍运行则全局进度不得显示 complete');
  assert.equal(task.generation_progress.target_total, 2);
  assert.equal(task.generation_progress.processed, 1);
  assert.deepEqual(task.generation_progress.active_scene_ids, ['scene-b']);

  task.active_target_generations = {};
  patch = targetProgress.upsert(task, {
    stage: 'scene_asset', scopeId: 'scene-b', generationId: 'gen-b', status: 'failed',
    progress: { target_total: 1, processed: 1, succeeded: 0, failed: 1 },
  });
  task = { ...task, ...patch };
  assert.equal(task.generation_progress.status, 'failed');
  assert.equal(task.generation_progress.percent, 100);
  const projected = progressProjection.projectTaskProgress(task).task;
  assert.equal(Object.keys(projected.target_generation_progress).length, 2, '轮询接口必须保留每个场景的隔离进度');
}

function testResponsiveFooterContract() {
  const css = fs.readFileSync(path.join(root, 'public/story-ad/workspace-ux.css'), 'utf8');
  assert(css.includes('.scene-production-card>footer{display:grid;grid-template-columns:minmax(0,1fr)'), '场景卡脚部应在卡片宽度内纵向分区');
  assert(css.includes('.scene-card-controls{display:flex') && css.includes('flex-wrap:wrap') && css.includes('width:100%'), '控制区必须可换行且不能挤压说明文字');
  assert(css.includes('overflow-wrap:anywhere'), '长说明不得退化为单字竖排或溢出卡片');
}

async function waitFor(predicate, message, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  assert.fail(message);
}

async function testScopedJobIntegration() {
  const taskId = 'scoped-job-progress-task';
  storage.createTask({ id: taskId, title: 'scoped progress', content_revision: 1 });
  let releaseA;
  let releaseB;
  const gateA = new Promise(resolve => { releaseA = resolve; });
  const gateB = new Promise(resolve => { releaseB = resolve; });
  const queuedA = jobs.queueStage({
    taskId, stage: 'scene_asset', scopeId: 'scene-a',
    execute: async () => gateA,
  });
  const queuedB = jobs.queueStage({
    taskId, stage: 'scene_asset', scopeId: 'scene-b',
    execute: async () => { await gateB; const error = new Error('fixture failure'); error.code = 'FIXTURE_FAILURE'; throw error; },
  });
  assert(queuedA.accepted && queuedB.accepted);
  await waitFor(() => Object.keys(storage.getTask(taskId)?.active_target_generations || {}).length === 2,
    '两个按场景隔离的任务必须同时进入 active_target_generations');
  releaseA();
  await waitFor(() => storage.getTask(taskId)?.target_generation_results?.['scene_asset:scene-a']?.status === 'succeeded',
    '第一个场景必须独立完成');
  const afterA = storage.getTask(taskId);
  assert.equal(Object.keys(afterA.active_target_generations || {}).length, 1);
  assert.equal(afterA.generation_progress.status, 'running', '另一个场景仍执行时，共享进度不得提前 complete');
  assert.deepEqual(afterA.generation_progress.active_scene_ids, ['scene-b']);
  releaseB();
  await waitFor(() => Object.keys(storage.getTask(taskId)?.active_target_generations || {}).length === 0,
    '失败场景收尾后不得残留活动进度身份');
  const finished = storage.getTask(taskId);
  assert.equal(finished.generation_progress.status, 'failed');
  assert.equal(Object.keys(finished.target_generation_progress || {}).length, 2);
}

async function main() {
  testPublishedCheckpointMediaCannotBeDeleted();
  testMissingFilesBecomeExplicitRepairTargets();
  testConcurrentProgressIsAggregatedPerScene();
  testResponsiveFooterContract();
  await testScopedJobIntegration();
  console.log(JSON.stringify({
    passed: true,
    checks: 5,
    protected_published_assets: 1,
    missing_files_promoted_to_repair: 1,
    concurrent_scene_lanes: 2,
    scoped_job_integration: true,
    model_calls: 0,
  }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
