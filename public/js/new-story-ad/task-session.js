(() => {
  function consumeCreateIntent(state = {}, rememberTaskId) {
    const url = new URL(location.href);
    const create = url.searchParams.get('nsa_intent') === 'create';
    if (!create) return false;
    state.taskSessionEpoch = Number(state.taskSessionEpoch || 0) + 1;
    rememberTaskId?.('');
    ['nsa_intent', 'nsa_task_id', 'nsa_step'].forEach(key => url.searchParams.delete(key));
    history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
  }

  function reset(state = {}, { stopStageProgress, clearVideoAuthorization } = {}) {
    state.taskSessionEpoch = Number(state.taskSessionEpoch || 0) + 1;
    state.inlineGenerationController?.abort?.(new DOMException('任务会话已切换', 'AbortError'));
    stopStageProgress?.();
    ['subjectCheckpointTimer', 'adminVideoMonitorTimer'].forEach(key => {
      if (state[key]) clearInterval(state[key]);
      state[key] = null;
    });
    Object.assign(state, {
      pendingRestoreTaskId: '', restoringTask: false, restoreError: '',
      petProfiles: [], subjectGalleryOpenKeys: new Set(),
      subjectGenerationCheckpoint: null, restoredTextAuthority: null,
      videoSelectedIndexes: [], videoSelectedUnitIds: [],
      activeGenerationScope: '', inlineGenerationController: null,
    });
    clearVideoAuthorization?.();
  }

  function resumeActiveGeneration(options = {}) {
    const {
      state, flow, context, startStageProgress, setBusy, normalizeBundle,
      renderAll, showStep, toast,
    } = options;
    if (!state?.activeGenerationId || !state.taskId || !flow?.waitForStage) return false;
    const persistedStage = state.activeStage || 'generation';
    const uiStage = persistedStage === 'scene_config' ? 'scene' : persistedStage;
    const label = flow.STAGE_LABELS?.[uiStage] || '正在生成中...';
    const expectedTaskId = state.taskId;
    const expectedSessionEpoch = state.taskSessionEpoch;
    startStageProgress(uiStage, label, { resume: true });
    setBusy(true, label);
    flow.waitForStage(expectedTaskId, persistedStage, {
      ...context(), expectedTaskId, expectedSessionEpoch,
    }).then(bundle => {
      if (state.taskSessionEpoch !== expectedSessionEpoch || state.taskId !== expectedTaskId) return;
      normalizeBundle(bundle, { expectedTaskId, expectedSessionEpoch });
      if (persistedStage === 'storyboard' && flow.storyboardIsReady(bundle, state)) showStep(5);
      renderAll();
    }).catch(error => {
      if (error.code === 'TASK_SESSION_REPLACED') return;
      if (error.data) normalizeBundle(error.data, { expectedTaskId, expectedSessionEpoch });
      renderAll();
      toast(error.message || '生成任务已结束', error.code === 'USER_CANCELLED' ? 'info' : 'error');
    }).finally(() => {
      if (state.taskSessionEpoch === expectedSessionEpoch && state.taskId === expectedTaskId) setBusy(false);
    });
    return true;
  }

  function startProgressTimer(options = {}) {
    const { state, stage, intervalMs, tracked, api, normalizeBundle, setBusy, label } = options;
    const expectedTaskId = state.taskId;
    const expectedSessionEpoch = state.taskSessionEpoch;
    let progressRevision = '';
    const timer = setInterval(async () => {
      if (state.taskSessionEpoch !== expectedSessionEpoch || state.taskId !== expectedTaskId) {
        clearInterval(timer);
        if (state.stageProgressTimer === timer) state.stageProgressTimer = null;
        return;
      }
      const activeProgress = state.stageProgress;
      if (!activeProgress?.active) return;
      if (tracked && expectedTaskId) {
        try {
          const suffix = progressRevision ? `?since=${encodeURIComponent(progressRevision)}` : '';
          const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(expectedTaskId)}/progress${suffix}`);
          if (state.taskSessionEpoch !== expectedSessionEpoch || state.taskId !== expectedTaskId) return;
          progressRevision = String(response.revision || progressRevision);
          if (!state.stageProgress?.active || state.stageProgress !== activeProgress) return;
          normalizeBundle(response, { expectedTaskId, expectedSessionEpoch });
          activeProgress.connectionError = '';
        } catch (error) {
          if (state.stageProgress?.active && state.stageProgress === activeProgress) {
            activeProgress.connectionError = error?.message || '进度连接暂时中断，正在重试';
          }
        }
      }
      if (state.stageProgress?.active && state.stageProgress === activeProgress) setBusy(true, label);
    }, intervalMs);
    return timer;
  }

  window.NewStoryAdTaskSession = {
    consumeCreateIntent,
    reset,
    resumeActiveGeneration,
    startProgressTimer,
  };
})();
