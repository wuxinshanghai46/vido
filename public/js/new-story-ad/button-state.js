(() => {
  function setButtonLock(selector, locked, title = '', options = {}, ctx = {}) {
    const within = typeof ctx.within === 'function' ? ctx.within : sel => document.querySelector(sel);
    const state = ctx.state || {};
    const btn = within(selector);
    if (!btn) return;
    const busyLocked = !!state.busy && !options.allowBusy;
    btn.disabled = busyLocked || !!locked;
    if (btn.disabled) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
    btn.classList.toggle('is-disabled', btn.disabled);
    if (title && locked) btn.title = title;
    else btn.removeAttribute('title');
  }

  function setButtonBusy(button, busy, label = '', ctx = {}) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.nsaOriginalText) button.dataset.nsaOriginalText = button.textContent.trim();
      if (label) button.textContent = label;
      button.disabled = true;
      button.classList.add('is-generating', 'is-busy');
      button.setAttribute('aria-busy', 'true');
      return;
    }
    if (button.dataset.nsaOriginalText) {
      button.textContent = button.dataset.nsaOriginalText;
      delete button.dataset.nsaOriginalText;
    }
    button.disabled = false;
    button.classList.remove('is-generating', 'is-busy');
    button.removeAttribute('aria-busy');
    if (typeof ctx.updateLocks === 'function') ctx.updateLocks();
  }

  function updateLocks(ctx = {}) {
    const within = typeof ctx.within === 'function' ? ctx.within : sel => document.querySelector(sel);
    const state = ctx.state || {};
    const getPersonSpec = typeof ctx.getPersonSpec === 'function' ? ctx.getPersonSpec : () => '';
    const lock = (selector, locked, title = '', options = {}) => setButtonLock(selector, locked, title, options, { state, within });

    const brief = (within('#dhNsaAdText')?.value || '').trim();
    const hasBrief = brief.length >= 8;
    const hasBlueprint = !!state.blueprint;
    const hasShots = Array.isArray(state.shots) && state.shots.length > 0;
    const compose = window.NewStoryAdStepNavigation?.composeReadiness
      ? window.NewStoryAdStepNavigation.composeReadiness({ state })
      : { ready: hasShots, message: '请先生成并审核全部分镜' };
    const hasActorInput = !!getPersonSpec('appearanceText');
    const noHuman = getPersonSpec('castMode') === 'no_human';

    lock('#dhNsaAdGenerate', !hasBrief, '请先填写至少 8 个字的广告需求');
    const generateBtn = within('#dhNsaAdGenerate');
    if (generateBtn) generateBtn.classList.toggle('is-next', hasBrief && !state.busy);
    lock('#dhNsaAdStoryboard', !hasBrief && !state.taskId, '请先填写至少 8 个字的广告需求');
    lock('#dhNsaAdPreviewFrames', !hasBlueprint, '请先生成剧本');
    lock('#dhNsaAdGenerateFinalFrames', !hasShots, '请先生成分镜');
    lock('#dhNsaAdGoCompose', !compose.ready, compose.message || '请先生成并审核全部分镜');
    lock('#dhNsaAdConfirmGenerate', !compose.ready, compose.message || '请先生成并审核全部分镜');
    lock('#dhNsaAdGeneratePersonSheet', noHuman || (!hasBrief && !hasActorInput), noHuman ? '无人物模式不需要生成演员' : '请先填写广告需求或人物设定', { allowBusy: true });
    lock('#dhNsaAdGenerateSceneSheet', !hasBrief, '请先填写至少 8 个字的广告需求', { allowBusy: true });
    lock('#dhNsaAdAddSceneSheet', !hasBrief, '请先填写至少 8 个字的广告需求', { allowBusy: true });
    lock('#dhNsaAdAiSceneSpec', !hasBrief, '请先填写至少 8 个字的广告需求', { allowBusy: true });

    [
      '#dhNsaAdWrite',
      '#dhNsaAdClean',
      '#dhNsaAdSample',
      '#dhNsaAdVoiceOpen',
      '#dhNsaAdBgmUpload',
      '#dhNsaAdSubtitleStyleBtn',
      '#dhNsaAdProductDrop',
      '#dhNsaAdUploadPersonRef',
      '#dhNsaAdPickActorAsset',
      '#dhNsaAdAiPersonSpec',
    ].forEach(selector => {
      const personAction = ['#dhNsaAdUploadPersonRef', '#dhNsaAdPickActorAsset', '#dhNsaAdAiPersonSpec'].includes(selector);
      lock(selector, personAction && noHuman, personAction && noHuman ? '无人物模式不会使用人物素材或人物设定' : '');
    });
  }

  window.NewStoryAdButtonState = {
    setButtonLock,
    setButtonBusy,
    updateLocks,
  };
})();
