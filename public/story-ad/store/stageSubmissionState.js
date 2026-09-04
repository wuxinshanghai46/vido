export function beginStageSubmissionState({ state, set }, stage = 'full', total = 1, message = '正在提交任务，请稍候。', details = {}) {
  if (!state.bundle?.project) return;
  const now = new Date().toISOString();
  const count = Math.max(1, Math.floor(Number(total) || 1));
  const optimisticGenerationId = `client-submitting:${Date.now()}`;
  const progress = {
    stage,
    status: 'queued',
    phase: '正在提交',
    percent: 2,
    indeterminate: true,
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

export function beginAutomaticStageSubmission({ state, set }, path = 'full', body = {}) {
  const stageByPath = {
    blueprint: 'blueprint', 'person-plan': 'person_plan', 'person-provider-sync': 'person_plan',
    'visual-assets': 'visual_assets', 'production-assets': 'visual_assets', 'product-assets': 'visual_assets',
    'scene-plan': 'scene_config', 'scene-config': 'scene_config', 'scene-assets': 'scene_asset', 'scene-actions': 'scene_asset',
    storyboard: 'storyboard', keyframes: 'keyframes', tts: 'tts', video: 'video', compose: 'compose', full: 'full',
  };
  const stage = stageByPath[path] || String(path || 'full').replaceAll('-', '_');
  const shots = state.bundle?.storyboard?.shots || [];
  const people = state.bundle?.assets?.people || [];
  const scenes = state.bundle?.assets?.scenes || [];
  const totalByStage = {
    person_plan: Math.max(1, people.length), visual_assets: Math.max(1, people.length),
    scene_config: Math.max(1, scenes.length), scene_asset: Math.max(1, Number(body?.count || body?.target_total || 0) || scenes.length),
    storyboard: Math.max(1, shots.length), keyframes: Math.max(1, shots.length), tts: Math.max(1, shots.length),
    video: Math.max(1, shots.length), compose: Math.max(1, shots.length),
  };
  const currentGenerationId = String(state.bundle?.project?.active_generation_id || '');
  const currentStage = String(state.bundle?.project?.active_stage || '');
  if (!(currentGenerationId.startsWith('client-submitting:') && currentStage === stage)) {
    beginStageSubmissionState({ state, set }, stage, totalByStage[stage] || 1, '任务已开始，进度会自动更新。');
  }
  return stage;
}
