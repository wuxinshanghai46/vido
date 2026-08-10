const storage = require('./storageService');

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function current(taskId) {
  const task = storage.getTask(taskId);
  const progress = task?.generation_progress;
  return progress?.stage === 'visual_assets' ? { task, progress } : null;
}

function aggregate(progress = {}) {
  const lanes = progress.lanes || {};
  const active = Object.values(lanes).filter(lane => lane?.required !== false);
  const total = active.reduce((sum, lane) => sum + Math.max(1, Number(lane.total || 1)), 0) || 1;
  const completed = active.reduce((sum, lane) => sum + clamp(lane.completed, 0, Math.max(1, Number(lane.total || 1))), 0);
  return {
    ...progress,
    total,
    completed,
    processed: completed,
    percent: clamp(Math.round((completed / total) * 100)),
    updated_at: new Date().toISOString(),
  };
}

function initialize(taskId, generationId, plan = {}) {
  const now = new Date().toISOString();
  const lanes = {
    subjects: {
      required: plan.subjectsRequired === true,
      status: plan.subjectsRequired === true ? 'queued' : 'not_required',
      total: Math.max(0, Number(plan.subjectTotal || 0)), completed: 0, percent: 0,
      work_total: 0, work_completed: 0,
      message: plan.subjectsRequired === true ? '人物与动物等待生成' : '当前项目不需要生成人物或动物',
    },
    scenes: {
      required: plan.scenesRequired === true,
      status: plan.scenesRequired === true ? 'queued' : 'not_required',
      total: Math.max(0, Number(plan.sceneTotal || 0)), completed: 0, percent: 0,
      message: plan.scenesRequired === true ? '场景等待生成' : '当前没有待生成场景',
      completed_scenes: 0,
    },
  };
  const progress = aggregate({
    schema_version: 2, stage: 'visual_assets', generation_id: generationId,
    status: 'running', phase: 'parallel_generation', lanes, started_at: now,
    message: '人物与场景正在同步生成；两条分支分别保存进度。',
  });
  storage.updateTask(taskId, { generation_progress: progress });
  return progress;
}

function updateLane(taskId, laneName, patch = {}) {
  const state = current(taskId);
  if (!state) return null;
  const previous = state.progress.lanes?.[laneName] || {};
  const total = Math.max(0, Number(patch.total ?? previous.total ?? 0));
  const completed = clamp(patch.completed ?? patch.processed ?? previous.completed, 0, Math.max(1, total));
  const lane = {
    ...previous, ...patch, total, completed,
    percent: Number.isFinite(Number(patch.percent)) ? clamp(patch.percent) : (total ? clamp(Math.round((completed / total) * 100)) : 100),
    updated_at: new Date().toISOString(),
  };
  const progress = aggregate({ ...state.progress, lanes: { ...(state.progress.lanes || {}), [laneName]: lane } });
  storage.updateTask(taskId, { generation_progress: progress });
  return progress;
}

function updateSceneUnit(taskId, sceneProgress = {}) {
  const state = current(taskId);
  if (!state) return null;
  const lane = state.progress.lanes?.scenes || {};
  const totalScenes = Math.max(1, Number(lane.total || 1));
  const completedScenes = Math.max(0, Number(lane.completed_scenes || 0));
  const viewTotal = Math.max(1, Number(sceneProgress.target_total || 1));
  const viewCompleted = clamp(sceneProgress.processed || 0, 0, viewTotal);
  return updateLane(taskId, 'scenes', {
    status: sceneProgress.status === 'failed' ? 'failed' : 'running',
    completed: Math.min(totalScenes, completedScenes + (viewCompleted / viewTotal)),
    current_scene_id: sceneProgress.scene_id || lane.current_scene_id || '',
    current_view_progress: { completed: viewCompleted, total: viewTotal },
    message: sceneProgress.message || `正在生成场景 ${completedScenes + 1}/${totalScenes}`,
  });
}

function finish(taskId, status = 'completed', message = '') {
  const state = current(taskId);
  if (!state) return null;
  const now = new Date().toISOString();
  const terminalLanes = Object.fromEntries(Object.entries(state.progress.lanes || {}).map(([name, lane]) => {
    if (status === 'completed' || lane?.required === false || !['queued', 'running'].includes(String(lane?.status || ''))) {
      return [name, lane];
    }
    return [name, {
      ...lane,
      status: 'failed',
      message: lane?.message || '该分支未完成，已停止',
      finished_at: now,
      updated_at: now,
    }];
  }));
  const progress = aggregate({
    ...state.progress, lanes: terminalLanes, status, phase: status === 'completed' ? 'complete' : 'partial_failed',
    message: message || (status === 'completed' ? '人物与场景视觉资产已生成。' : '部分资产已保留；再次提交只会继续缺失项。'),
    finished_at: now,
  });
  storage.updateTask(taskId, { generation_progress: progress });
  return progress;
}

module.exports = { initialize, updateLane, updateSceneUnit, finish };
