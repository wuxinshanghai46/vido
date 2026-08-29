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
  const targetProgress = {
    ...(state.bundle.project.target_generation_progress || {}),
    ...(details?.target_progress || {}),
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
