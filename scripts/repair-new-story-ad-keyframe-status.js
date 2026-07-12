#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const storage = require('../src/services/newStoryAd/storageService');
const service = require('../src/services/newStoryAd/storyAdService');

const taskId = String(process.argv[2] || '').trim();
if (!taskId) throw new Error('Usage: node scripts/repair-new-story-ad-keyframe-status.js <task-id>');
const task = storage.getTask(taskId);
if (!task) throw new Error(`Task not found: ${taskId}`);
const bundle = service.publicTaskBundle(taskId, { diagnostics: true });
const status = bundle.keyframe_status || {};
if (!status.failed || bundle.task?.stage !== 'keyframes_failed') {
  console.log(JSON.stringify({ updated: false, task_id: taskId, status, stage: bundle.task?.stage || task.stage }, null, 2));
  process.exit(0);
}

const backupDir = process.env.REPAIR_BACKUP_DIR || path.join(process.cwd(), 'outputs', 'repair-backups');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `${taskId}-${Date.now()}.json`);
fs.writeFileSync(backupPath, JSON.stringify({ task, bundle }, null, 2), 'utf8');
storage.saveStage(taskId, 'keyframes', {
  status: 'failed',
  error: bundle.task.error,
  output_summary: `${Number(status.completed) || 0}/${Number(status.total) || 0} current-generation keyframes`,
  diagnostics: {
    repaired_status: true,
    error_code: bundle.task.error_code,
    keyframe_status: status,
  },
});
storage.updateTask(taskId, {
  status: 'failed',
  stage: 'keyframes_failed',
  active_stage: '',
  active_generation_id: '',
  generation_finished_at: new Date().toISOString(),
  error: bundle.task.error,
  error_code: bundle.task.error_code,
  retryable: true,
  generation_progress: {
    ...(task.generation_progress || {}),
    stage: 'keyframes',
    status: 'failed',
    target_total: Number(status.total) || 0,
    processed: Number(status.total) || 0,
    succeeded: Number(status.completed) || 0,
    failed: Number(status.failed) || 0,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
});
console.log(JSON.stringify({ updated: true, task_id: taskId, backup_path: backupPath, status }, null, 2));
