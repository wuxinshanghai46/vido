#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'story-ad-scene-batch-image-progress-v258');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const targetProgress = require('../src/services/newStoryAd/targetGenerationProgressService');
const projection = require('../src/services/newStoryAd/taskProgressProjectionService');

const taskId = 'scene-batch-image-progress-v258';
const generationId = 'scene-batch-image-generation';
storage.createTask({ id: taskId, title: 'Image progress fixture', content_revision: 1 });
let task = storage.getTask(taskId);
let patch = targetProgress.upsert(task, {
  stage: 'scene_asset', scopeId: 'scene-a', sceneId: 'scene-a', generationId, status: 'running',
  progress: {
    mode: 'scene_action', status: 'running', phase: 'generation', scene_id: 'scene-a',
    target_total: 5, processed: 4, succeeded: 4, failed: 0,
    image_target_total: 5, image_processed: 4, image_succeeded: 4, image_failed: 0,
    current_view_key: 'interaction', current_view_label: '互动位',
    started_at: '2026-08-29T05:00:00.000Z', updated_at: '2026-08-29T05:00:01.000Z',
  },
});
storage.updateTask(taskId, patch);
task = storage.getTask(taskId);
patch = targetProgress.upsert(task, {
  stage: 'scene_asset', scopeId: 'scene-b', sceneId: 'scene-b', generationId, status: 'running',
  progress: {
    mode: 'scene_action', status: 'running', phase: 'generation', scene_id: 'scene-b',
    target_total: 5, processed: 1, succeeded: 1, failed: 0,
    image_target_total: 5, image_processed: 1, image_succeeded: 1, image_failed: 0,
    current_view_key: 'master', current_view_label: '主视角',
    started_at: '2026-08-29T05:00:00.000Z', updated_at: '2026-08-29T05:00:01.000Z',
  },
});
storage.updateTask(taskId, patch);

const projectedTask = projection.projectTaskProgress(storage.getTask(taskId)).task;
const sceneAProgress = projectedTask.target_generation_progress['scene_asset:scene-a'];
const sceneBProgress = projectedTask.target_generation_progress['scene_asset:scene-b'];
assert.equal(sceneAProgress.image_processed, 4);
assert.equal(sceneAProgress.current_view_label, '互动位');
assert.equal(sceneBProgress.image_processed, 1);

const cardSource = fs.readFileSync(path.join(root, 'public/story-ad/views/scenePromptPreview.js'), 'utf8')
  .replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
const sandbox = {
  escapeHtml: value => String(value ?? ''), toast: () => {},
  normalizeSceneDossier: () => ({ completed: 1 }), renderSceneCoverCard: () => '',
  sceneNeedsGeneration: () => true, sceneGenerationSettingsMarkup: () => '',
  elapsedTimeTag: ({ active }) => active ? '<em>已耗时 1秒</em>' : '<em>本次耗时 1秒</em>',
};
vm.runInNewContext(`${cardSource}\nglobalThis.__render=renderSceneProductionCard;`, sandbox);
const html = sandbox.__render({ id: 'scene-a', name: '场景 A', prompt_state: {} }, 0, {
  generationActive: true, batchManaged: true, progress: sceneAProgress,
});
assert.match(html, /scene-card-live-progress/);
assert.match(html, /4\/5 · 80%/);
assert.match(html, /互动位 · <em>已耗时 1秒<\/em>/);
assert.doesNotMatch(html, /scene-card-controls/, '统一按钮运行时不得重复显示单卡提交按钮');

const page = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneWorldPage.js'), 'utf8');
assert(!page.includes('sceneBatchProgressMarkup'), '并行场景不得继续显示共用进度条');
assert.match(page, /targetProgress\[`scene_asset:\$\{sceneId\}`\]/, '场景卡必须绑定自己的持久化进度通道');
assert.match(page, /<span>Image \$\{imageSummary\[0\]\}\/\$\{imageSummary\[1\]\}<\/span>/, '顶部只显示完成资产汇总，不得伪装成共用实时进度');
assert.match(page, /unifiedActionManaged = batchActive \|\| sceneActionPlan\.count > 0/, '统一按钮仍必须托管重复提交入口');
assert.match(cardSource, /const progressMarkup = options\.generationActive \?/, '批量运行时每张卡必须显示自己的进度');

console.log(JSON.stringify({
  passed: true, independent_scene_lanes: 2,
  scene_a_image_progress: '4/5', scene_b_image_progress: '1/5',
  elapsed_visible: true, shared_live_progress: 0, model_calls: 0,
}));
