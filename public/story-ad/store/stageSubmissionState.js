export function beginStageSubmissionState({ state, set }, stage = 'full', total = 1, message = '正在提交任务，请稍候。', details = {}) {
  if (!state.bundle?.project) return;
  const now = new Date().toISOString();
  const count = Math.max(1, Math.floor(Number(total) || 1));
  const optimisticGenerationId = `client-submitting:${Date.now()}`;
  const batchActions = Array.isArray(details?.batch_actions) ? details.batch_actions : [];
  const batchSceneIds = [...new Set((Array.isArray(details?.batch_scene_ids) ? details.batch_scene_ids : [])
    .map(value => String(value || '').trim()).filter(Boolean))];
  const progress = {
    stage,
    status: 'queued',
    phase: '正在提交',
    target_total: count,
    processed: 0,
    succeeded: 0,
    failed: 0,
    percent: 0,
    message,
    started_at: now,
    client_optimistic: true,
    ...(details && typeof details === 'object' ? details : {}),
  };
  const targetProgress = { ...(state.bundle.project.target_generation_progress || {}) };
  const activeTargets = { ...(state.bundle.project.active_target_generations || {}) };
  batchSceneIds.forEach(sceneId => {
    const action = batchActions.find(item => String(item?.scene_id || '') === sceneId) || {};
    const laneKey = `scene_asset:${sceneId}`;
    const imageTotal = Math.max(0, Number(action.image_total || 0) || 0);
    targetProgress[laneKey] = {
      schema_version: 2,
      stage: 'scene_asset', mode: 'scene_action', scene_id: sceneId,
      current_action: String(action.action || 'preparing'),
      generation_id: optimisticGenerationId,
      status: 'queued', phase: action.action === 'reverify' ? 'verification' : 'generation',
      target_total: Math.max(1, imageTotal || 1), processed: 0, succeeded: 0, failed: 0,
      image_target_total: imageTotal, image_processed: 0,
      message: '任务正在提交，服务器接受后会自动更新进度。',
      started_at: now, updated_at: now, client_optimistic: true,
    };
    activeTargets[laneKey] = {
      generation_id: optimisticGenerationId,
      stage: 'scene_asset', target_id: sceneId, scope_id: sceneId,
      status: 'queued', started_at: now, updated_at: now, client_optimistic: true,
    };
  });
  set({
    bundle: {
      ...state.bundle,
      project: {
        ...state.bundle.project,
        status: 'queued',
        active_stage: stage,
        active_generation_id: optimisticGenerationId,
        active_target_generations: activeTargets,
        target_generation_progress: targetProgress,
        generation_queued_at: now,
        generation_progress: progress,
        error: '',
        error_code: '',
      },
      generation: { ...(state.bundle.generation || {}), progress },
    },
  });
}
