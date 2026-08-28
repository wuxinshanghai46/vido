'use strict';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function text(value = '', max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function create({ storage, targetProgress, normalizeViewKeys, viewLabel }) {
  function update(taskId, task, generationId, change = {}) {
    const lane = task.target_generation_progress?.['scene_asset:scene-batch'] || {};
    const batch = String(lane.generation_id || '') === String(generationId || '')
      ? { ...(task.generation_progress || {}), ...lane }
      : (task.generation_progress && String(task.generation_progress.mode || '') === 'scene_batch'
        ? task.generation_progress : {});
    const sceneId = text(change.sceneId || change.scene_id || batch.current_scene_id, 120);
    const previous = batch.current_scene_progress?.scene_id === sceneId
      ? batch.current_scene_progress : {};
    const keys = normalizeViewKeys(change.viewKeys?.length ? change.viewKeys : previous.view_keys);
    const initial = Array.isArray(change.initialViewStates) ? change.initialViewStates : [];
    const priorStates = new Map([
      ...(previous.view_states || []).map(item => [item.key, item]),
      ...initial.map(item => [item.key, item]),
    ]);
    const now = new Date().toISOString();
    const viewStates = keys.map(key => {
      const current = priorStates.get(key) || { key, label: viewLabel(key), status: 'queued' };
      return key === change.viewKey ? {
        ...current,
        status: change.viewStatus || current.status,
        retrying: change.retrying === true,
        updated_at: now,
      } : current;
    });
    const localProcessed = viewStates.filter(item => ['succeeded', 'failed'].includes(item.status)).length;
    const localSucceeded = viewStates.filter(item => item.status === 'succeeded').length;
    const localFailed = viewStates.filter(item => item.status === 'failed').length;
    const baseProcessed = number(batch.image_base_processed);
    const baseSucceeded = number(batch.image_base_succeeded);
    const baseFailed = number(batch.image_base_failed);
    const imageTotal = Math.max(number(batch.image_target_total), baseProcessed + keys.length);
    const phase = text(change.phase || batch.phase || 'generation', 40);
    const currentViewKey = text(change.viewKey || previous.current_view_key, 40);
    const currentViewLabel = currentViewKey ? text(viewLabel(currentViewKey), 80) : '';
    const imageProcessed = Math.min(imageTotal, baseProcessed + localProcessed);
    const imageSucceeded = Math.min(imageTotal, baseSucceeded + localSucceeded);
    const imageFailed = Math.min(imageTotal, baseFailed + localFailed);
    const sceneProgress = {
      scene_id: sceneId,
      view_keys: keys,
      view_states: viewStates,
      current_view_key: currentViewKey,
      current_view_label: currentViewLabel,
      image_target_total: keys.length,
      image_processed: localProcessed,
      image_succeeded: localSucceeded,
      image_failed: localFailed,
      phase,
      updated_at: now,
    };
    const progress = {
      ...batch,
      status: 'running',
      phase,
      current_scene_id: sceneId || batch.current_scene_id || '',
      current_view_key: currentViewKey,
      current_view_label: currentViewLabel,
      image_target_total: imageTotal,
      image_processed: imageProcessed,
      image_succeeded: imageSucceeded,
      image_failed: imageFailed,
      image_percent: imageTotal ? Math.round((imageProcessed / imageTotal) * 100) : 100,
      current_scene_progress: sceneProgress,
      message: phase === 'verification'
        ? `Image ${imageSucceeded}/${imageTotal}，正在审核${currentViewLabel ? `“${currentViewLabel}”` : ''}`
        : `Image ${imageProcessed}/${imageTotal}${currentViewLabel ? ` · ${currentViewLabel}` : ''}`,
      updated_at: now,
    };
    const patch = targetProgress.upsert(task, {
      stage: 'scene_asset', scopeId: 'scene-batch', generationId,
      status: progress.status, progress,
    });
    storage.updateTask(taskId, patch);
    return patch.generation_progress;
  }

  return { update };
}

module.exports = { create };
