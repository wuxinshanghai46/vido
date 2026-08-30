#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');

const taskId = String(process.argv.find(value => !value.startsWith('--') && value !== process.argv[0] && value !== process.argv[1]) || '').trim();
const apply = process.argv.includes('--apply');

if (!taskId) {
  console.error('用法：node scripts/recover-story-ad-storyboard-checkpoint-v289.js <task-id> [--apply]');
  process.exit(2);
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

const task = storage.getTask(taskId);
if (!task) {
  console.error(JSON.stringify({ ok: false, code: 'TASK_NOT_FOUND', task_id: taskId }));
  process.exit(1);
}

const checkpoint = storage.getOutput(taskId, 'storyboard_checkpoint') || null;
const before = {
  task_status: task.status,
  task_stage: task.stage,
  active_generation_id: task.active_generation_id || '',
  checkpoint_phase: checkpoint?.phase || '',
  checkpoint_shots: Array.isArray(checkpoint?.shots) ? checkpoint.shots.length : 0,
  checkpoint_expected_total: Number(checkpoint?.expected_total || 0),
  checkpoint_sha256: digest(checkpoint),
  storyboard_shots: (storage.getOutput(taskId, 'storyboard_table') || []).length,
  storyboard_images: (storage.getOutput(taskId, 'storyboard_images') || []).length,
  model_calls: storage.listModelCalls(taskId).length,
  generation_units: storage.listGenerationRuns({ task_id: taskId }).length,
};

if (!apply) {
  console.log(JSON.stringify({ ok: true, mode: 'dry-run', task_id: taskId, before }, null, 2));
  process.exit(0);
}

const result = storyAd.recoverStoryboardCheckpoint(taskId, { reason: 'production_v289_accepted_scene_policy_recovery' });
const afterTask = storage.getTask(taskId);
const after = {
  task_status: afterTask.status,
  task_stage: afterTask.stage,
  active_generation_id: afterTask.active_generation_id || '',
  checkpoint_present: Boolean(storage.getOutput(taskId, 'storyboard_checkpoint')),
  storyboard_shots: (storage.getOutput(taskId, 'storyboard_table') || []).length,
  keyframe_contracts: (storage.getOutput(taskId, 'keyframe_contracts') || []).length,
  storyboard_images: (storage.getOutput(taskId, 'storyboard_images') || []).length,
  model_calls: storage.listModelCalls(taskId).length,
  generation_units: storage.listGenerationRuns({ task_id: taskId }).length,
};

if (after.model_calls !== before.model_calls || after.generation_units !== before.generation_units) {
  throw Object.assign(new Error('恢复过程产生了新的模型调用或生成单元，已违反零付费恢复合同'), {
    code: 'RECOVERY_PROVIDER_CALL_DETECTED', before, after,
  });
}

console.log(JSON.stringify({
  ok: true, mode: 'apply', task_id: taskId,
  provider_calls_added: 0, generation_units_added: 0,
  recovered_shots: result.shots.length,
  before, after,
}, null, 2));
