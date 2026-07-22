(() => {
  function fallbackKeyframeStatus(state = {}) {
    const shots = Array.isArray(state.shots) ? state.shots : [];
    const frames = Array.isArray(state.keyframes) ? state.keyframes : [];
    const total = Math.max(shots.length, frames.length);
    const freshPass = Array.from({ length: total }).filter((_, index) => {
      const frame = frames[index] || {};
      const hasImage = !!(frame.image_url || frame.imageUrl || frame.url);
      return hasImage
        && !frame.regeneration_error
        && !['pending', 'generating', 'retrying_serial', 'outdated'].includes(String(frame.current_generation_status || ''))
        && frame.contract_outdated !== true
        && Number(frame.qa_policy_version || 0) >= 2
        && frame.qa?.pass === true;
    }).length;
    return { total, fresh_pass: freshPass, needs_regeneration: Math.max(0, total - freshPass) };
  }

  function keyframeReadiness(ctx = {}) {
    const state = ctx.state || {};
    const shots = Array.isArray(state.shots) ? state.shots : [];
    const status = window.NewStoryAdKeyframes?.status
      ? window.NewStoryAdKeyframes.status(state.keyframes || [], shots)
      : fallbackKeyframeStatus(state);
    const storyboardReady = state.storyboardStatus && typeof state.storyboardStatus.ready === 'boolean'
      ? state.storyboardStatus.ready
      : shots.length > 0;
    const total = Number(status.total || 0);
    const passed = Number(status.fresh_pass || 0);
    const needsRegeneration = Number(status.needs_regeneration ?? Math.max(0, total - passed)) || 0;
    const ready = storyboardReady
      && shots.length > 0
      && total === shots.length
      && passed === total
      && needsRegeneration === 0;
    let message = '';
    if (!shots.length) message = '请先生成分镜和真实关键帧';
    else if (!storyboardReady) message = '剧本或分镜已修改，请重新确认并生成当前版本分镜';
    else if (!ready) message = `当前版本只有 ${passed}/${Math.max(total, shots.length)} 镜画面审核通过，请先修复未通过镜头`;
    return { ready, message, total: Math.max(total, shots.length), passed, needs_regeneration: needsRegeneration };
  }

  function clipForShot(clips = [], index = 0) {
    return clips.find((clip, clipIndex) => {
      if (!clip) return false;
      if (Number.isInteger(Number(clip.shot_index))) return Number(clip.shot_index) === index;
      if (Number.isInteger(Number(clip.index))) return Number(clip.index) === index + 1;
      return clipIndex === index;
    }) || null;
  }

  function composeReadiness(ctx = {}) {
    const state = ctx.state || {};
    const shots = Array.isArray(state.shots) ? state.shots : [];
    const clips = Array.isArray(state.videoClips) ? state.videoClips : [];
    const frames = keyframeReadiness({ state });
    const orderedClips = shots.map((_, index) => clipForShot(clips, index));
    const passed = orderedClips.filter(clip => {
      return !!(clip?.video_url || clip?.videoUrl || clip?.file_path)
        && !clip?.error
        && !clip?.error_code
        && clip?.qa?.pass === true;
    }).length;
    const total = shots.length;
    const boundaries = window.NewStoryAdVideoBoundaries?.audit
      ? window.NewStoryAdVideoBoundaries.audit(orderedClips, total)
      : { ready: total <= 1 || orderedClips.slice(1).every(clip => clip?.cross_shot_qa?.pass === true), total: Math.max(0, total - 1), passed: orderedClips.slice(1).filter(clip => clip?.cross_shot_qa?.pass === true).length, unready_indexes: [] };
    const ready = frames.ready && total > 0 && passed === total && boundaries.ready;
    let message = '';
    if (!frames.ready) message = frames.message;
    else if (!clips.length) message = '尚未开始整条广告视频生成';
    else if (passed < total) message = `当前有 ${passed}/${total} 镜单镜质检通过，请在广告合成页查看未通过原因`;
    else if (!boundaries.ready) message = `当前仍有 ${boundaries.unready_indexes.length} 个跨生成单元衔接未审核，必须补查后才能封装`;
    return { ready, message, total, passed, needs_regeneration: Math.max(0, total - passed), keyframes: frames, boundaries };
  }

  function composePresentation(ctx = {}) {
    const state = ctx.state || {};
    const compose = ctx.compose || composeReadiness({ state });
    const finalUrl = state.finalVideo?.video_url || state.finalVideo?.videoUrl || '';
    const progress = ['video', 'compose'].includes(String(state.generationProgress?.stage || '')) ? state.generationProgress : null;
    const active = !!state.activeGenerationId || state.stageProgress?.active === true
      || (state.taskStatus === 'running' && ['video', 'video_repair', 'compose', 'media'].includes(String(state.taskStage || state.activeStage || '')));
    const reviewRequired = !active && !finalUrl && compose.total > 0 && compose.passed === compose.total && compose.boundaries?.ready === false;
    const retryReady = !active && !finalUrl && compose.ready && progress?.stage === 'compose' && progress?.status === 'failed';
    const failed = !active && !retryReady && !reviewRequired && (state.taskStatus === 'failed'
      || progress?.status === 'failed' || !!state.taskErrorCode || !!state.taskError);
    return { active, failed, retry_ready: retryReady, review_required: reviewRequired, action_ready: !active && !finalUrl && compose.ready, final_url: finalUrl, progress };
  }

  function stepReady(step, ctx = {}) {
    const state = ctx.state || {};
    const within = typeof ctx.within === 'function' ? ctx.within : sel => document.querySelector(sel);
    if (step === 1) return !!state.taskId || !!(within('#dhNsaAdText')?.value || '').trim();
    if (step === 2) return !!state.sceneConfig;
    if (step === 3) return !!state.blueprint;
    if (step === 4) return keyframeReadiness({ state }).ready;
    if (step === 5) return !!(state.finalVideo?.video_url || state.finalVideo?.videoUrl);
    return false;
  }

  function canOpenStep(step, ctx = {}) {
    const state = ctx.state || {};
    if (step <= 1) return true;
    if (step === 2) return !!state.sceneConfig || !!state.taskId;
    if (step === 3) return !!state.blueprint;
    if (step === 4) return (Array.isArray(state.shots) && state.shots.length > 0) || !!state.blueprint;
    if (step === 5) return keyframeReadiness({ state }).ready;
    return true;
  }

  function showStep(step, opts = {}, ctx = {}) {
    const state = ctx.state || {};
    const root = typeof ctx.root === 'function' ? ctx.root : () => document;
    const queryAll = typeof ctx.queryAll === 'function'
      ? ctx.queryAll
      : (selector, scope = document) => Array.from((scope || document).querySelectorAll(selector));
    const rememberRouteStep = typeof ctx.rememberRouteStep === 'function' ? ctx.rememberRouteStep : null;
    const within = typeof ctx.within === 'function' ? ctx.within : sel => document.querySelector(sel);

    state.currentStep = Math.max(1, Math.min(5, Number(step) || 1));
    queryAll('.dh-luxgen-stage', root()).forEach(panel => {
      panel.classList.toggle('active', Number(panel.dataset.panel || 0) === state.currentStep);
    });
    queryAll('[data-nsa-step]', root()).forEach(item => {
      const n = Number(item.dataset.nsaStep || 0);
      const locked = n > 1 && !canOpenStep(n, { state });
      item.classList.toggle('active', n === state.currentStep);
      item.classList.toggle('done', stepReady(n, { state, within }));
      item.classList.toggle('locked', locked);
      if ('disabled' in item) item.disabled = locked;
      item.tabIndex = locked ? -1 : 0;
      if (locked) item.setAttribute('aria-disabled', 'true');
      else item.removeAttribute('aria-disabled');
    });
    if (opts.remember !== false && rememberRouteStep) rememberRouteStep(state.currentStep);
    return state.currentStep;
  }

  window.NewStoryAdStepNavigation = {
    keyframeReadiness,
    composeReadiness,
    composePresentation,
    showStep,
    stepReady,
    canOpenStep,
  };
})();
