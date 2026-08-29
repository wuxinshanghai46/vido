#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-scene-authority-v260-'));
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const sceneBatchFactory = require('../src/services/newStoryAd/sceneBatchOrchestrationService');
const targetProgress = require('../src/services/newStoryAd/targetGenerationProgressService');
const cancellation = require('../src/services/newStoryAd/cancellationContext');
const qaProjection = require('../src/services/storyAdWorkspace/sceneQaProjectionService');
const publicFailure = require('../src/services/newStoryAd/publicFailureProjectionService');

const taskId = 'scene-current-authority-v260';
const sceneId = 'scene-showroom';
const view = key => ({ key, image_url: `https://assets.example/${key}.png`, url: `https://assets.example/${key}.png` });

storage.createTask({ id: taskId, title: 'scene authority fixture', content_revision: 1 });
storage.saveOutput(taskId, 'scene_config', { spaces: [{ id: sceneId, name: '现代高端家居展示厅' }] });
storage.saveOutput(taskId, 'scene_assets', [{
  id: sceneId, scene_id: sceneId, space_id: sceneId, name: '现代高端家居展示厅',
  generation_contract_version: 7, view_images: ['master', 'reverse', 'interaction', 'detail', 'layout'].map(view),
  scene_contract: {
    schema_version: 6, full_space_lock: false, qa_unavailable: true,
    verification: { state: 'unavailable' }, camera_design_qa: { pass: null },
  },
  repair_plan: { version: 6, action: 'reverify', view_keys: [], count: 0 },
}]);
storage.saveOutput(taskId, `scene_asset_checkpoint:${sceneId}`, {
  scene_id: sceneId, status: 'partial', metadata: { mode: 'repair', space_id: sceneId, generation_contract_version: 7 },
  views: {
    master: { status: 'succeeded', ...view('master') },
    reverse: { status: 'succeeded', ...view('reverse') },
    interaction: { status: 'succeeded', ...view('interaction') },
    detail: { status: 'succeeded', ...view('detail') },
    layout: { status: 'failed', error_code: 'PROVIDER_RESPONSE_INVALID', billing_state: 'not_submitted', provider_submission_state: 'not_submitted' },
  },
});

const current = sceneAssets.currentSceneAssets(taskId);
assert.equal(current.length, 1);
assert.equal(current[0].view_images.length, 4, '后台权威场景必须与 checkpoint 的 4 张成功图片一致');
assert.equal(current[0].repair_plan.action, 'regenerate_failed_views');
assert.deepEqual(current[0].repair_plan.view_keys, ['layout']);

const orchestrator = sceneBatchFactory.create({
  storage, sceneAssets, targetProgress, cancellation,
  promptAuthority: { assertCurrentPrompt: (_id, _sceneId, input = {}) => ({ prompt_version_id: input.prompt_version_id || 'prompt-v260' }) },
});
const plan = orchestrator.plan(taskId, { image_model: 'smscrw/gpt-image-2', actions: [{ scene_id: sceneId, prompt_version_id: 'prompt-v260' }] });
assert.equal(plan.actions[0].action, 'regenerate_failed_views');
assert.equal(plan.actions[0].image_total, 1, '缺 1 张时必须计划 1 次图片生成，不能误走零图片审核');

const root = path.resolve(__dirname, '..');
const pickerPath = path.join(root, 'public/story-ad/views/generationModelPicker.js');
let pickerSource = fs.readFileSync(pickerPath, 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/export\s+(async\s+)?function\s+/g, (_match, asyncKeyword = '') => `${asyncKeyword}function `);
pickerSource += '\nmodule.exports = { generationModelDisplayName, generationModelOptionLabel };';
const pickerSandbox = { module: { exports: {} }, exports: {} };
vm.runInNewContext(pickerSource, pickerSandbox, { filename: pickerPath });
const labels = pickerSandbox.module.exports;
assert.equal(labels.generationModelDisplayName({ public_name: 'Nano Banana' }), 'Nano Banana');
assert.equal(labels.generationModelDisplayName({ public_name: 'Image' }), 'Image');
assert.equal(labels.generationModelOptionLabel({ public_name: 'Image', provider_code: 'SZ' }), 'Image · SZ');
assert.equal(labels.generationModelOptionLabel({ public_name: 'Nano Banana', provider_code: 'WB' }), 'Nano Banana · WB');
const optionTemplate = pickerSource.slice(pickerSource.indexOf('<option value='), pickerSource.indexOf("</select>"));
assert(!optionTemplate.includes('provider_name'), '模型下拉不得再显示供应商全称');
assert(optionTemplate.includes('generationModelOptionLabel'), '图片和视频下拉必须显示产品名与供应商缩写');

const progressPath = path.join(root, 'public/story-ad/views/sceneBatchProgressView.js');
let progressSource = fs.readFileSync(progressPath, 'utf8')
  .replace(/^import .*$/gm, '')
  .replace('export function sceneBatchProgressMarkup', 'function sceneBatchProgressMarkup');
progressSource += '\nmodule.exports = { sceneBatchProgressMarkup };';
const progressSandbox = {
  module: { exports: {} }, exports: {},
  escapeHtml: value => String(value),
  elapsedTimeTag: ({ active }) => active ? '<em>已耗时 1分31秒</em>' : '<em>本次耗时 1分31秒</em>',
};
vm.runInNewContext(progressSource, progressSandbox, { filename: progressPath });
assert.match(progressSandbox.module.exports.sceneBatchProgressMarkup({
  mode: 'scene_batch', status: 'running', image_target_total: 1, image_processed: 0,
  started_at: '2026-08-29T00:00:00.000Z', current_scene_name: '现代高端家居展示厅', current_view_label: '俯视布局',
}), /现代高端家居展示厅 · 俯视布局.*已耗时 1分31秒/);

const publicBatchProgress = publicFailure.publicProgress({
  mode: 'scene_batch', status: 'running', stage: 'scene_asset', phase: 'generation',
  image_target_total: 4, image_processed: 1, image_succeeded: 1, image_failed: 0, image_percent: 25,
  current_scene_id: sceneId, current_scene_name: '现代高端家居展示厅',
  current_view_key: 'reverse', current_view_label: '反向/侧向', batch_scene_ids: [sceneId],
});
assert.equal(publicBatchProgress.mode, 'scene_batch', '公开项目投影不得截断批生成模式');
assert.equal(publicBatchProgress.image_target_total, 4, '公开项目投影必须保留真实 Image 总数');
assert.equal(publicBatchProgress.image_processed, 1, '公开项目投影必须保留已处理 Image 数');
assert.equal(publicBatchProgress.current_view_label, '反向/侧向');
assert.deepEqual(publicBatchProgress.batch_scene_ids, [sceneId]);

const publicQa = qaProjection.project({
  qa_unavailable: true, qa_error_code: 'VISION_QA_UNAVAILABLE',
  qa_failed_models: [
    { code: 'TIMEOUT_OR_NETWORK', message: 'request timeout' },
    { code: 'PROVIDER_RESPONSE_INVALID', message: 'structured response missing' },
    { code: 'RATE_LIMIT', message: '429' },
  ],
  verification: { state: 'unavailable' },
});
assert.deepEqual(publicQa.failure_categories, ['timeout', 'invalid_response', 'rate_limited']);

console.log(JSON.stringify({
  passed: true,
  checkpoint_images: current[0].view_images.length,
  planned_image_calls: plan.actions[0].image_total,
  repair_view_keys: plan.actions[0].repair_plan_version ? current[0].repair_plan.view_keys : [],
  compact_model_labels: true,
  elapsed_visible: true,
  public_batch_progress_preserved: true,
  qa_failure_categories: publicQa.failure_categories,
  provider_image_calls: 0,
}));
