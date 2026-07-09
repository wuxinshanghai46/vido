(() => {
  function stepReady(step, ctx = {}) {
    const state = ctx.state || {};
    const within = typeof ctx.within === 'function' ? ctx.within : sel => document.querySelector(sel);
    if (step === 1) return !!state.taskId || !!(within('#dhNsaAdText')?.value || '').trim();
    if (step === 2) return !!state.sceneConfig;
    if (step === 3) return !!state.blueprint;
    if (step === 4) return Array.isArray(state.shots) && state.shots.length > 0;
    if (step === 5) return !!(state.finalVideo?.video_url || state.finalVideo?.videoUrl);
    return false;
  }

  function canOpenStep(step, ctx = {}) {
    const state = ctx.state || {};
    if (step <= 1) return true;
    if (step === 2) return !!state.sceneConfig || !!state.taskId;
    if (step === 3) return !!state.blueprint || !!state.sceneConfig;
    if (step === 4) return (Array.isArray(state.shots) && state.shots.length > 0) || !!state.blueprint;
    if (step === 5) return Array.isArray(state.shots) && state.shots.length > 0;
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
      item.classList.toggle('active', n === state.currentStep);
      item.classList.toggle('done', stepReady(n, { state, within }));
      item.classList.toggle('locked', n > 1 && !canOpenStep(n, { state }));
    });
    if (opts.remember !== false && rememberRouteStep) rememberRouteStep(state.currentStep);
    return state.currentStep;
  }

  window.NewStoryAdStepNavigation = {
    showStep,
    stepReady,
    canOpenStep,
  };
})();
