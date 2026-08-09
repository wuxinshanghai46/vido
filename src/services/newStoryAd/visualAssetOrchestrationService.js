const storage = require('./storageService');
const visualAssetProgress = require('./visualAssetProgressService');

function updateSubjectProgress(taskId, generationId, update = {}) {
  if (!taskId) return null;
  const task = storage.getTask(taskId);
  if (!task) return null;
  if (task.generation_progress?.stage === 'visual_assets') {
    return visualAssetProgress.updateLane(taskId, 'subjects', {
      status: update.status || 'running',
      phase: update.phase || 'generation',
      message: update.message || '正在生成人物与动物档案',
      total: Math.max(1, Number(update.total || 1)),
      completed: Math.max(0, Number(update.processed ?? update.completed ?? 0)),
      percent: Number(update.percent),
    });
  }
  const previous = task.generation_progress?.stage === 'subject_assets' ? task.generation_progress : {};
  const total = Math.max(1, Number(update.total || previous.total || 1) || 1);
  const processed = Math.max(0, Math.min(total, Number(update.processed ?? update.completed ?? previous.processed ?? 0) || 0));
  const percent = Number.isFinite(Number(update.percent))
    ? Math.max(0, Math.min(100, Number(update.percent)))
    : Math.max(1, Math.min(90, Math.round((processed / total) * 90)));
  const now = new Date().toISOString();
  const progress = {
    schema_version: 1,
    stage: 'subject_assets',
    generation_id: generationId || task.active_generation_id || previous.generation_id || '',
    status: update.status || (percent >= 100 ? 'completed' : 'running'),
    phase: update.phase || previous.phase || 'preparing',
    message: update.message || previous.message || '正在建立人物与动物档案',
    total,
    processed,
    completed: processed,
    percent,
    started_at: previous.started_at || task.generation_started_at || task.generation_queued_at || now,
    updated_at: now,
    ...(percent >= 100 ? { finished_at: now } : {}),
  };
  storage.updateTask(taskId, { generation_progress: progress });
  return progress;
}

function normalizedSceneTargets(body = {}) {
  return (Array.isArray(body.scene_targets) ? body.scene_targets : [])
    .map((target, index) => ({
      scene_id: String(target?.scene_id || target?.space_id || target?.id || '').trim(),
      space_id: String(target?.space_id || target?.scene_id || target?.id || '').trim(),
      name: String(target?.name || `场景 ${index + 1}`).trim(),
      scene_spec: target?.scene_spec && typeof target.scene_spec === 'object' ? target.scene_spec : undefined,
      repair_existing: target?.repair_existing === true || target?.repairExisting === true,
    }))
    .filter(target => target.scene_id)
    .filter((target, index, rows) => rows.findIndex(row => row.scene_id === target.scene_id) === index)
    .slice(0, 50);
}

function laneFailure(reason, fallbackCode, fallbackMessage) {
  return {
    status: 'failed',
    phase: 'partial_failed',
    error_code: reason?.code || fallbackCode,
    billing_state: reason?.billingState || reason?.billing_state || '',
    message: String(reason?.message || fallbackMessage).slice(0, 500),
  };
}

function markRejectedLanes(taskId, subjects, scenes) {
  if (subjects.status === 'rejected') {
    visualAssetProgress.updateLane(taskId, 'subjects', laneFailure(
      subjects.reason, 'SUBJECT_ASSET_GENERATION_FAILED', '人物与动物资产生成未完成',
    ));
  }
  if (scenes.status === 'rejected') {
    visualAssetProgress.updateLane(taskId, 'scenes', laneFailure(
      scenes.reason, 'SCENE_ASSET_GENERATION_FAILED', '场景资产生成未完成',
    ));
  }
}

function rejectedResults(...results) {
  return results.filter(result => result.status === 'rejected');
}

function primaryFailure(rejected = []) {
  return rejected.find(result => result.reason?.billingState === 'unknown'
    || result.reason?.billing_state === 'unknown'
    || result.reason?.code === 'GENERATION_BILLING_STATE_UNKNOWN') || rejected[0];
}

function attachFailureMetadata(error, rejected, { subjectCommit, sceneCommit, subjects, scenes } = {}) {
  error.retryable = error.retryable !== false;
  error.partial_results_saved = Boolean(
    subjectCommit
    || sceneCommit?.scene_assets?.length
    || subjects?.reason?.partial_subject_checkpoint
    || scenes?.reason?.partial_scene_assets?.length,
  );
  error.visual_asset_lane_failures = rejected.map(result => ({
    error_code: result.reason?.code || 'VISUAL_ASSET_LANE_FAILED',
    billing_state: result.reason?.billingState || result.reason?.billing_state || '',
    message: String(result.reason?.message || result.reason || '').slice(0, 500),
  }));
  return error;
}

module.exports = {
  updateSubjectProgress,
  normalizedSceneTargets,
  markRejectedLanes,
  rejectedResults,
  primaryFailure,
  attachFailureMetadata,
};
