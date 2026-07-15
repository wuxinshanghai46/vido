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

  function composeReadiness(ctx = {}) {
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
    else if (!ready) message = `当前版本仅通过 ${passed}/${Math.max(total, shots.length)} 镜，请先修复未通过审核的镜头`;
    return { ready, message, total: Math.max(total, shots.length), passed, needs_regeneration: needsRegeneration };
  }

  function stepReady(step, ctx = {}) {
    const state = ctx.state || {};
    const within = typeof ctx.within === 'function' ? ctx.within : sel => document.querySelector(sel);
    if (step === 1) return !!state.taskId || !!(within('#dhNsaAdText')?.value || '').trim();
    if (step === 2) return !!state.sceneConfig;
    if (step === 3) return !!state.blueprint;
    if (step === 4) return composeReadiness({ state }).ready;
    if (step === 5) return !!(state.finalVideo?.video_url || state.finalVideo?.videoUrl);
    return false;
  }

  function canOpenStep(step, ctx = {}) {
    const state = ctx.state || {};
    if (step <= 1) return true;
    if (step === 2) return !!state.sceneConfig || !!state.taskId;
    if (step === 3) return !!state.blueprint || !!state.sceneConfig;
    if (step === 4) return (Array.isArray(state.shots) && state.shots.length > 0) || !!state.blueprint;
    if (step === 5) return composeReadiness({ state }).ready;
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
    composeReadiness,
    showStep,
    stepReady,
    canOpenStep,
  };
})();
