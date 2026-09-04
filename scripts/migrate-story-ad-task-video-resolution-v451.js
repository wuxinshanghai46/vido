#!/usr/bin/env node
'use strict';

const storage = require('../src/services/newStoryAd/storageService');

const taskId = String(process.argv.find(value => value.startsWith('--task=')) || '').slice('--task='.length).trim();
const apply = process.argv.includes('--apply');
const targetResolution = String(process.argv.find(value => value.startsWith('--resolution=')) || '--resolution=480p').slice('--resolution='.length).trim().toLowerCase();

if (!taskId) throw new Error('TASK_ID_REQUIRED');
if (!['480p', '720p', '1080p', '4k'].includes(targetResolution)) throw new Error('VIDEO_RESOLUTION_INVALID');

const task = storage.getTask(taskId);
if (!task) throw new Error('TASK_NOT_FOUND');
if (task.active_generation_id) throw new Error('TASK_GENERATION_ACTIVE');
const clips = Array.isArray(storage.getOutput(taskId, 'video_clips')) ? storage.getOutput(taskId, 'video_clips') : [];
const generatedIndexes = clips.map((clip, index) => clip && (clip.video_url || clip.videoUrl || clip.file_path) ? index + 1 : null).filter(Boolean);
const runtime = storage.getOutput(taskId, 'media_runtime_context') || {};
const before = String(runtime.video_resolution || task.request?.video_resolution || '');
const report = {
  task_id: taskId,
  apply,
  active_generation: false,
  before_resolution: before,
  after_resolution: targetResolution,
  generated_indexes_preserved: generatedIndexes,
  existing_video_count: generatedIndexes.length,
  paid_video_calls: 0,
};

if (apply) {
  storage.saveOutput(taskId, 'media_runtime_context', { ...runtime, video_resolution: targetResolution });
  storage.saveOutput(taskId, 'video_resolution_override', {
    schema_version: 1,
    resolution: targetResolution,
    scope: 'future_missing_video_shots',
    generated_indexes_preserved: generatedIndexes,
    applied_at: new Date().toISOString(),
    reason: 'user_requested_lower_resolution_for_remaining_storyboard_videos',
  });
}

console.log(JSON.stringify(report));
