(() => {
  const STAGE_LABELS = {
    scene: '生成场景配置中...',
    blueprint: '生成剧本中...',
    storyboard: '生成分镜表中...',
    keyframes: '生成真实画面中...',
    tts: '生成配音中...',
    video: '生成逐镜视频中...',
    compose: '合成成片中...',
  };

  function mediaStageBody(ctx = {}) {
    if (typeof ctx.mediaStagePayload === 'function') return ctx.mediaStagePayload();
    const state = ctx.state || {};
    return {
      voice_id: state.voiceId || '',
      voice_name: state.voiceName || '',
      voice_volume: state.voiceVolume,
      bgm_volume: state.bgmVolume,
      bgm_profile: state.bgmProfile || 'auto',
      bgm_asset: state.bgmAsset || null,
      subtitle: state.subtitleEnabled !== false,
      subtitle_style: state.subtitleStyle || 'popup',
    };
  }

  async function runStage(stage, ctx = {}) {
    const {
      button,
      state,
      api,
      ensureTask,
      normalizeBundle,
      renderAll,
      toast,
      showStep,
      saveBlueprintEdits,
      startStageProgress,
      setBusy,
      setButtonBusy,
    } = ctx;
    if (!state || typeof api !== 'function' || typeof ensureTask !== 'function') throw new Error('阶段生成上下文未初始化');
    const busyLabel = STAGE_LABELS[stage] || '处理中...';
    startStageProgress?.(stage, busyLabel);
    setBusy?.(true, busyLabel);
    setButtonBusy?.(button, true, busyLabel);
    try {
      const id = await ensureTask();
      let r = null;
      if (stage === 'scene') {
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/scene-config`, { method: 'POST', body: {} });
        normalizeBundle?.(r);
        showStep?.(2);
      } else if (stage === 'blueprint') {
        if (!state.sceneConfig) normalizeBundle?.(await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/scene-config`, { method: 'POST', body: {} }));
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/blueprint`, { method: 'POST', body: {} });
        normalizeBundle?.(r);
        showStep?.(3);
      } else if (stage === 'storyboard') {
        if (!state.blueprint) normalizeBundle?.(await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/blueprint`, { method: 'POST', body: {} }));
        if (state.blueprint && typeof saveBlueprintEdits === 'function') await saveBlueprintEdits(id);
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/storyboard`, { method: 'POST', body: {} });
        normalizeBundle?.(r);
        showStep?.(4);
      } else if (stage === 'keyframes') {
        if (!state.shots.length) normalizeBundle?.(await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/storyboard`, { method: 'POST', body: {} }));
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/keyframes`, { method: 'POST', body: {} });
        normalizeBundle?.(r);
        showStep?.(4);
      } else if (stage === 'tts') {
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/tts`, { method: 'POST', body: mediaStageBody(ctx) });
        normalizeBundle?.(r);
        showStep?.(5);
      } else if (stage === 'video') {
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/video`, { method: 'POST', body: mediaStageBody(ctx) });
        normalizeBundle?.(r);
        showStep?.(5);
      } else if (stage === 'compose') {
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/compose`, { method: 'POST', body: mediaStageBody(ctx) });
        normalizeBundle?.(r);
        showStep?.(5);
      }
      renderAll?.();
      toast?.('新剧情广告阶段已完成', 'success');
      return true;
    } catch (err) {
      if (err.data) normalizeBundle?.(err.data);
      renderAll?.();
      toast?.(err.message || '阶段执行失败', 'error');
      return false;
    } finally {
      setButtonBusy?.(button, false);
      setBusy?.(false);
    }
  }

  async function runMediaChain(ctx = {}) {
    if (!await runStage('tts', ctx)) return false;
    if (!await runStage('video', ctx)) return false;
    return runStage('compose', ctx);
  }

  async function assist(mode, ctx = {}) {
    const { button, payload, api, toast, setBusy, setButtonBusy, getBriefInput } = ctx;
    const body = typeof payload === 'function' ? payload() : {};
    if (String(body.brief || '').length < 3) return toast?.('请先写一点广告方向', 'error');
    const label = mode === 'clean' ? '整理需求中...' : 'AI 写作中...';
    setBusy?.(true, label);
    setButtonBusy?.(button, true, label);
    try {
      const r = await api('/api/new-story-ad/assist', { method: 'POST', body: { ...body, mode } });
      const input = typeof getBriefInput === 'function' ? getBriefInput() : null;
      if (r.brief && input) input.value = r.brief;
      toast?.('需求已整理', 'success');
      return r;
    } catch (err) {
      toast?.(err.message || '需求整理失败', 'error');
      return null;
    } finally {
      setButtonBusy?.(button, false);
      setBusy?.(false);
    }
  }

  window.NewStoryAdGenerationFlow = {
    runStage,
    runMediaChain,
    assist,
    mediaStageBody,
    STAGE_LABELS,
  };
})();
