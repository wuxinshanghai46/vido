'use strict';

const storage = require('../newStoryAd/storageService');

const SKETCH_BATCH_OUTPUT = 'storyboard_image_batch';

function batchProgress(taskId) {
  const value = storage.getOutput(taskId, SKETCH_BATCH_OUTPUT);
  return value && typeof value === 'object' ? value : null;
}

function saveBatchProgress(taskId, patch = {}) {
  const task = storage.getTask(taskId) || {};
  const previous = batchProgress(taskId) || {};
  const requested = Math.max(0, Number(patch.requested ?? previous.requested ?? 0) || 0);
  const completed = Math.max(0, Math.min(requested, Number(patch.completed ?? previous.completed ?? 0) || 0));
  const next = {
    ...previous,
    ...patch,
    requested,
    completed,
    remaining: Math.max(0, requested - completed),
    percent: requested ? Math.round((completed / requested) * 100) : 100,
    updated_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, SKETCH_BATCH_OUTPUT, next, {
    content_revision: Number(task.content_revision || 1) || 1,
    snapshot_id: task.current_snapshot_id || `manual:${taskId}`,
  });
  if ((task.active_stage === 'storyboard' && task.active_generation_id) || !task.active_generation_id) {
    const previousProgress = task.generation_progress && typeof task.generation_progress === 'object'
      ? task.generation_progress
      : {};
    storage.updateTask(taskId, {
      generation_progress: {
        ...previousProgress,
        stage: 'storyboard',
        phase: 'storyboard_images',
        status: ['succeeded', 'failed'].includes(String(next.status || '')) ? next.status : 'running',
        completed: next.completed,
        processed: Math.max(0, Number(next.processed ?? next.completed) || 0),
        total: next.requested,
        percent: next.percent,
        currentIndex: Number(next.current_index || 0) || 0,
        startedAt: next.started_at || previousProgress.startedAt || task.generation_started_at || '',
        finishedAt: next.finished_at || '',
        generationId: task.active_generation_id || next.id || previousProgress.generationId || '',
        message: next.message || '正在生成分镜画面',
      },
    });
  }
  return next;
}

function getSketchBatch(taskId, activeSketchBatches) {
  const task = storage.getTask(taskId);
  if (!task) {
    const error = new Error('项目不存在');
    error.status = 404;
    error.code = 'TASK_NOT_FOUND';
    throw error;
  }
  let progress = batchProgress(taskId);
  const active = Boolean(progress && ['queued', 'running'].includes(String(progress.status || '')) && activeSketchBatches.has(taskId));
  if (progress && ['queued', 'running'].includes(String(progress.status || '')) && !active) {
    progress = saveBatchProgress(taskId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: '分镜图批次进程已中断。已完成图片已经保留，重新提交只会补生成缺失镜头。',
      error_code: 'SKETCH_BATCH_INTERRUPTED',
      message: `分镜图批次已中断；已处理 ${Number(progress.processed ?? progress.completed ?? 0)}/${Number(progress.requested || 0)}、成功 ${Number(progress.succeeded ?? progress.completed ?? 0)}，可以重新提交补齐。`,
    });
  }
  return {
    progress,
    active,
    sketches: storage.getOutput(taskId, 'storyboard_images') || [],
  };
}

module.exports = { SKETCH_BATCH_OUTPUT, batchProgress, saveBatchProgress, getSketchBatch };
