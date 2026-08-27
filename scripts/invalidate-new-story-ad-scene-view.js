#!/usr/bin/env node

const storage = require('../src/services/newStoryAd/storageService');
const checkpoints = require('../src/services/newStoryAd/sceneGenerationCheckpointService');

const [taskId = '', sceneId = '', viewKey = ''] = process.argv.slice(2).filter(value => value !== '--apply');
const apply = process.argv.includes('--apply');
if (!taskId || !sceneId || !viewKey) {
  throw new Error('Usage: node scripts/invalidate-new-story-ad-scene-view.js <task-id> <scene-id> <view-key> [--apply]');
}

const task = storage.getTask(taskId);
if (!task) throw new Error(`Task not found: ${taskId}`);
const active = Object.values(task.active_target_generations || {}).some(item => (
  item?.stage === 'scene_asset'
  && String(item.target_id || '') === sceneId
  && ['queued', 'running'].includes(String(item.status || ''))
));
if (active) throw new Error(`Scene generation is active: ${sceneId}`);

const checkpoint = storage.getOutput(taskId, checkpoints.outputKind(sceneId));
const view = checkpoint?.views?.[viewKey];
if (!checkpoint || !view) throw new Error(`Scene view not found: ${sceneId}#${viewKey}`);
if (!checkpoints.reusableView(view)) throw new Error(`Scene view is not reusable success: ${sceneId}#${viewKey}`);

const before = {
  status: view.status,
  image_url: view.image_url || view.url || '',
  billing_state: view.billing_state || '',
};
if (apply) checkpoints.invalidateSucceededView(checkpoint, viewKey, { source: 'production_manual_visual_audit' });
const after = apply ? storage.getOutput(taskId, checkpoints.outputKind(sceneId)).views[viewKey] : null;
console.log(JSON.stringify({
  task_id: taskId,
  scene_id: sceneId,
  view_key: viewKey,
  mode: apply ? 'applied' : 'dry-run',
  before,
  after: after ? {
    status: after.status,
    image_url: after.image_url || '',
    rejected_image_url: after.rejected_image_url || '',
    error_code: after.error_code || '',
    billing_state: after.billing_state || '',
    reusable: checkpoints.reusableView(after),
  } : null,
}, null, 2));
