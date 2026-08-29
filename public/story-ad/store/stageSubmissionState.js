export function beginStageSubmissionState({ state, set }, stage = 'full', total = 1, message = '正在提交任务，请稍候。', details = {}) {
  if (!state.bundle?.project) return;
  const now = new Date().toISOString();
  const count = Math.max(1, Math.floor(Number(total) || 1));
  const optimisticGenerationId = `client-submitting:${Date.now()}`;
  const progress = {
    stage,
    status: 'queued',
    phase: '正在提交',
    target_total: count,
    processed: 0,
    message,
    started_at: now,
    ...(details && typeof details === 'object' ? details : {}),
  };
  const optimisticTargets = Object.fromEntries(Object.entries(details?.target_progress || {}).map(([key, value]) => {
    const [targetStage, ...scopeParts] = String(key).split(':');
    const scopeId = scopeParts.join(':');
    return [key, {
      ...(value || {}),
      stage: value?.stage || targetStage || stage,
      scene_id: value?.scene_id || (targetStage === 'scene_asset' ? scopeId : ''),
      scope_id: value?.scope_id || scopeId,
      generation_id: value?.generation_id || optimisticGenerationId,
      updated_at: value?.updated_at || now,
    }];
  }));
  const targetProgress = {
    ...(state.bundle.project.target_generation_progress || {}),
    ...optimisticTargets,
  };
  set({
    bundle: {
      ...state.bundle,
      project: {
        ...state.bundle.project,
        status: 'queued',
        active_stage: stage,
        active_generation_id: optimisticGenerationId,
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
