export function beginStageSubmissionState({ state, set }, stage = 'full', total = 1, message = '正在提交任务，请稍候。') {
  if (!state.bundle?.project) return;
  const now = new Date().toISOString();
  const count = Math.max(1, Math.floor(Number(total) || 1));
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
  };
  set({
    bundle: {
      ...state.bundle,
      project: {
        ...state.bundle.project,
        status: 'queued',
        active_stage: stage,
        active_generation_id: state.bundle.project.active_generation_id || 'client-submitting',
        generation_queued_at: now,
        generation_progress: progress,
        error: '',
        error_code: '',
      },
      generation: { ...(state.bundle.generation || {}), progress },
    },
  });
}
