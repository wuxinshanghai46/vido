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
const liveFactory = require('../src/services/newStoryAd/sceneBatchLiveProgressService');

const taskId = 'scene-batch-image-progress-v258';
const generationId = 'scene-batch-image-generation';
const keys = ['master', 'layout', 'reverse', 'interaction', 'detail'];
const label = key => ({ master: '主视角', layout: '俯视布局', reverse: '反向/侧向', interaction: '互动位', detail: '材质细节' }[key] || key);

storage.createTask({ id: taskId, title: 'Image progress fixture', content_revision: 1 });
const task = storage.getTask(taskId);
task.active_generation_id = generationId;
task.active_target_generations = {
  'scene_asset:scene-batch': { generation_id: generationId, stage: 'scene_asset', target_id: 'scene-batch', status: 'running' },
};
const initial = targetProgress.upsert(task, {
  stage: 'scene_asset', scopeId: 'scene-batch', generationId, status: 'running',
  progress: {
    mode: 'scene_batch', status: 'running', phase: 'generation', target_total: 2, processed: 0,
    batch_scene_ids: ['scene-a', 'scene-b'], current_scene_id: 'scene-a', current_scene_name: '场景 A',
    image_target_total: 5, image_processed: 0, image_succeeded: 0, image_failed: 0,
    image_base_processed: 0, image_base_succeeded: 0, image_base_failed: 0,
  },
});
storage.updateTask(taskId, { active_generation_id: generationId, active_target_generations: task.active_target_generations, ...initial });

const live = liveFactory.create({ storage, targetProgress, normalizeViewKeys: value => [...new Set(value || [])], viewLabel: label });
live.update(taskId, storage.getTask(taskId), generationId, {
  sceneId: 'scene-a', phase: 'preparing', viewKeys: keys,
  initialViewStates: keys.map(key => ({ key, label: label(key), status: 'queued' })),
});
for (const key of keys.slice(0, 4)) {
  live.update(taskId, storage.getTask(taskId), generationId, { sceneId: 'scene-a', phase: 'generation', viewKeys: keys, viewKey: key, viewStatus: 'running' });
  live.update(taskId, storage.getTask(taskId), generationId, { sceneId: 'scene-a', phase: 'generation', viewKeys: keys, viewKey: key, viewStatus: 'succeeded' });
}
let current = storage.getTask(taskId);
assert.equal(current.generation_progress.processed, 0, '场景计数不能伪装成 Image 计数');
assert.equal(current.generation_progress.image_processed, 4);
assert.equal(current.generation_progress.image_target_total, 5);
assert.equal(current.generation_progress.image_percent, 80);
live.update(taskId, current, generationId, { sceneId: 'scene-a', phase: 'verification', viewKeys: keys, current_view_key: 'layout' });
current = storage.getTask(taskId);
assert.equal(current.generation_progress.phase, 'verification');
assert.match(current.generation_progress.message, /^Image 4\/5，正在审核/);

const projected = projection.projectTaskProgress(current).task.generation_progress;
assert.equal(projected.image_processed, 4);
assert.equal(projected.image_target_total, 5);
assert.equal(projected.image_percent, 80);

const viewSource = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneBatchProgressView.js'), 'utf8')
  .replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
const sandbox = {
  escapeHtml: value => String(value ?? ''),
  elapsedTimeTag: ({ active }) => active ? '<em>已耗时 1秒</em>' : '<em>本次耗时 1秒</em>',
};
vm.runInNewContext(`${viewSource}\nglobalThis.__render=sceneBatchProgressMarkup;`, sandbox);
const html = sandbox.__render(projected);
assert.match(html, />Image</);
assert.match(html, /4\/5 · 80% · 审核中/);
const stoppedHtml = sandbox.__render({ ...projected, status: 'failed', phase: 'stopped' });
assert.match(stoppedHtml, /4\/5 · 80% · 已停止/);

const page = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneWorldPage.js'), 'utf8');
const card = fs.readFileSync(path.join(root, 'public/story-ad/views/scenePromptPreview.js'), 'utf8');
assert.match(page, /batchActive \? sceneBatchProgressMarkup\(generationProgress\)/, '批次必须只在场景区顶部显示统一 Image 进度');
assert.match(page, /<span>Image \$\{imageSummary\[0\]\}\/\$\{imageSummary\[1\]\}<\/span>/, '顶部完成度必须按 Image 汇总，不能继续显示误导性的场景数');
assert.match(page, /unifiedActionManaged = batchActive \|\| sceneActionPlan\.count > 0/, '有统一操作时必须隐藏每张卡片的独立操作区');
assert.match(page, /batchManaged: unifiedActionManaged/, '批次与待处理空闲态都必须由统一按钮托管');
assert.match(card, /options\.batchManaged \? '' : `<footer>/, '统一批次运行时不得为每个场景重复显示进度和按钮');

console.log(JSON.stringify({ passed: true, image_progress: '4/5', percent: 80, duplicated_card_progress: 0, model_calls: 0 }));
