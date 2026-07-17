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
    const passed = shots.filter((_, index) => {
      const clip = clipForShot(clips, index);
      return !!(clip?.video_url || clip?.videoUrl || clip?.file_path)
        && !clip?.error
        && !clip?.error_code
        && clip?.qa?.pass === true
        && clip?.cross_shot_qa?.pass !== false;
    }).length;
    const total = shots.length;
    const ready = frames.ready && total > 0 && passed === total;
    let message = '';
    if (!frames.ready) message = frames.message;
    else if (!clips.length) message = '请先在第 4 步生成分镜视频';
    else if (!ready) message = `当前只有 ${passed}/${total} 镜视频审核通过，请先在第 4 步补齐或修复分镜视频`;
    return { ready, message, total, passed, needs_regeneration: Math.max(0, total - passed), keyframes: frames };
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
    keyframeReadiness,
    composeReadiness,
    showStep,
    stepReady,
    canOpenStep,
  };
})();
