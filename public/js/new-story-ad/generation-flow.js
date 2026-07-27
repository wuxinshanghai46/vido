(() => {
  const STAGE_LABELS = {
    scene: '生成场景配置中...',
    blueprint: '生成剧本中...',
    script_package: '生成剧本与分镜中...',
    storyboard: '生成分镜表中...',
    keyframes: '生成真实画面中...',
    tts: '生成配音中...',
    video: '生成连续场景视频中...',
    compose: '合成成片中...',
    media: '后台生成视频并合成成片中...',
  };

  function mediaStageBody(ctx = {}) {
    if (typeof ctx.mediaStagePayload === 'function') return ctx.mediaStagePayload();
    const state = ctx.state || {};
    const selectedIndexes = Array.isArray(state.videoSelectedIndexes)
      ? [...new Set(state.videoSelectedIndexes.map(Number).filter(index => Number.isInteger(index) && index >= 0))]
      : [];
    return {
      voice_id: state.voiceId || '',
      voice_name: state.voiceName || '',
      include_voiceover: !!state.voiceId,
      auto_tts: !!state.voiceId,
      voice_volume: state.voiceVolume,
      bgm_volume: state.bgmVolume,
      bgm_profile: state.bgmProfile || 'auto',
      bgm_asset: state.bgmAsset || null,
      subtitle: state.subtitleEnabled !== false,
      subtitle_style: state.subtitleStyle || 'popup',
      subtitle_config: {
        show: state.subtitleEnabled !== false,
        style: state.subtitleStyle || 'popup',
        ...(state.subtitleOptions || {}),
      },
      video_generation_mode: state.videoGenerationMode || 'quality',
      video_preflight_fingerprint: state.videoPreflightFingerprint || '',
      cost_plan_fingerprint: state.videoCostPlanFingerprint || '',
      confirmed_cost_limit_rmb: Number(state.videoConfirmedCostLimitRmb || 0),
      complexity_review_confirmed: state.videoComplexityReviewConfirmed === true,
      zero_cost_only: state.videoZeroCostOnly === true,
      only_indexes: selectedIndexes,
      force_regenerate_indexes: selectedIndexes,
      force_regenerate_all: false,
      missing_only: false,
      auto_repair: false,
      max_auto_repairs: 0,
    };
  }

  function keyframeStatusFromResponse(response = {}, state = {}) {
    const fromResponse = response.keyframe_status || response.keyframeStatus || response.bundle?.keyframe_status || response.bundle?.keyframeStatus;
    if (fromResponse && Number(fromResponse.total)) return fromResponse;
    if (window.NewStoryAdKeyframes?.status) return window.NewStoryAdKeyframes.status(state.keyframes || [], state.shots || []);
    const total = Math.max((state.shots || []).length, (state.keyframes || []).length);
    const completed = (state.keyframes || []).filter(frame => frame && (frame.image_url || frame.imageUrl || frame.url)).length;
    return { total, completed, missing: Math.max(0, total - completed), missing_indexes: [] };
  }

  const STAGE_TIMEOUT_MS = 30 * 60 * 1000;
  const STAGE_TIMEOUTS = {
    scene_config: 10 * 60 * 1000,
    scene_asset: 12 * 60 * 1000,
    storyboard: 10 * 60 * 1000,
    keyframes: 60 * 60 * 1000,
    tts: 12 * 60 * 1000,
    video: 20 * 60 * 1000,
    compose: 12 * 60 * 1000,
    media: 60 * 60 * 1000,
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function formatBriefText(value = '', max = 3000) {
    if (window.NewStoryAdStateSync?.formatBriefText) {
      return window.NewStoryAdStateSync.formatBriefText(value, max);
    }
    return String(value || '')
      .replace(/\\r\\n|\\n|\\r/g, '\n')
      .replace(/\\t/g, ' ')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, max);
  }

  function isNetworkError(error) {
    const message = String(error?.message || error || '');
    return error instanceof TypeError
      || /failed to fetch|network(?: error| changed)|connection (?:reset|aborted)|load failed|err_network_changed|err_connection_reset/i.test(message);
  }

  function stageWasAccepted(task = {}, expectedStage = '') {
    const current = String(task.stage || '');
    const active = String(task.active_stage || task.generation_stage || '');
    if (current === expectedStage || current.startsWith(`${expectedStage}_`) || active === expectedStage) return true;
    const downstream = {
      script_package: ['blueprint', 'blueprint_done', 'storyboard', 'storyboard_done', 'keyframe_contract_ready'],
      scene_config: ['scene_config_done', 'blueprint', 'blueprint_done', 'storyboard', 'keyframe_contract_ready'],
      blueprint: ['blueprint_done', 'storyboard', 'keyframe_contract_ready'],
      storyboard: ['keyframe_contract_ready', 'keyframes', 'keyframes_ready', 'tts', 'video', 'compose', 'completed'],
      keyframes: ['keyframes_ready', 'tts', 'video', 'compose', 'completed'],
      tts: ['tts_ready', 'video', 'compose', 'completed'],
      video: ['video_ready', 'compose', 'completed'],
      compose: ['completed', 'compose_done'],
      media: ['tts', 'tts_ready', 'video', 'video_ready', 'compose', 'completed', 'compose_done'],
    };
    return (downstream[expectedStage] || []).some(stage => current === stage || current.startsWith(`${stage}_`));
  }

  function stageTimeoutMs(stage = '', ctx = {}) {
    if (stage !== 'keyframes') return STAGE_TIMEOUTS[stage] || STAGE_TIMEOUT_MS;
    const state = ctx.state || {};
    const targetCount = Math.max(1, Number(state.generationProgress?.target_total)
      || state.shots?.length
      || state.contracts?.length
      || 1);
    return Math.min(STAGE_TIMEOUTS.keyframes, Math.max(12 * 60 * 1000, (6 + targetCount * 4) * 60 * 1000));
  }

  function storyboardIsReady(bundle = {}, state = {}) {
    const status = bundle.storyboard_status || bundle.bundle?.storyboard_status || state.storyboardStatus;
    if (status && typeof status.ready === 'boolean') return status.ready;
    const outputs = bundle.outputs || bundle.bundle?.outputs || {};
    const shots = outputs.storyboard_table || state.shots || [];
    return Array.isArray(shots) && shots.length > 0;
  }

  function blueprintIsReady(bundle = {}, state = {}) {
    const outputs = bundle.outputs || bundle.bundle?.outputs || {};
    const blueprint = outputs.blueprint || bundle.blueprint || bundle.bundle?.blueprint || state.blueprint || null;
    return !!blueprint && Array.isArray(blueprint.beats) && blueprint.beats.length > 0;
  }

  function adoptActiveGeneration(state = {}, job = {}, expectedStage = '', body = {}) {
    if (!state || !job?.id) return;
    state.activeGenerationId = job.id || '';
    state.activeStage = job.stage || expectedStage;
    state.generationStartedAt = job.started_at || job.queued_at || new Date().toISOString();
    state.generationProgress = state.activeStage === 'keyframes'
      ? {
          stage: 'keyframes', status: 'queued', target_total: body?.only_index !== undefined ? 1 : Math.max(1, state.shots?.length || 1),
          processed: 0, succeeded: 0, failed: 0,
          current_index: body?.only_index !== undefined ? Number(body.only_index) + 1 : 1,
          generation_id: job.id || '',
          started_at: state.generationStartedAt,
        }
      : null;
    if (state.stageProgress?.active) {
      state.stageProgress.generationId = state.activeGenerationId;
      state.stageProgress.submissionPending = false;
      const startedAt = Date.parse(state.generationStartedAt);
      if (Number.isFinite(startedAt)) state.stageProgress.startedAt = startedAt;
    }
    state.cancelRequested = false;
  }

  function submissionEvidence(ctx = {}) {
    const state = ctx.state || {};
    const stageProgress = state.stageProgress || {};
    return {
      previousGenerationId: String(stageProgress.previousGenerationId
        || state.generationProgress?.generation_id
        || state.activeGenerationId
        || ''),
      submittedAt: Number(stageProgress.startedAt) || Date.now(),
    };
  }

  function taskConfirmsSubmission(task = {}, expectedStage = '', evidence = {}) {
    if (!stageWasAccepted(task, expectedStage)) return false;
    const progress = task.generation_progress || {};
    const activeGenerationId = String(task.active_generation_id || '');
    const progressGenerationId = String(progress.generation_id || '');
    const generationId = activeGenerationId || progressGenerationId;
    if (!generationId) return false;

    const activeStage = String(task.active_stage || '');
    const progressStage = String(progress.stage || '');
    if (activeGenerationId && activeStage && activeStage !== expectedStage) return false;
    if (!activeGenerationId && progressStage && progressStage !== expectedStage) return false;

    const previousGenerationId = String(evidence.previousGenerationId || '');
    if (previousGenerationId) return generationId !== previousGenerationId;

    const submittedAt = Number(evidence.submittedAt) || Date.now();
    const generationTimestamps = [
      task.generation_queued_at,
      task.generation_started_at,
      progress.started_at,
    ]
      .map(value => Date.parse(value || ''))
      .filter(Number.isFinite);
    if (!generationTimestamps.length) return false;
    return Math.max(...generationTimestamps) >= submittedAt - 30000;
  }

  async function recoverUncertainStageSubmission(taskId, expectedStage, ctx = {}, originalError, evidence = {}) {
    if (!isNetworkError(originalError)) throw originalError;
    let lastError = originalError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt) await sleep(700 * attempt);
      try {
        const bundle = await ctx.api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}`);
        ctx.normalizeBundle?.(bundle);
        const task = bundle.task || {};
        if (!taskConfirmsSubmission(task, expectedStage, evidence)) continue;
        ctx.toast?.('网络刚刚发生波动，服务器已接收任务，正在自动恢复进度', 'info');
        if (String(task.status || '').toLowerCase() === 'failed') {
          const error = new Error(task.error || `${STAGE_LABELS[expectedStage] || expectedStage}执行失败`);
          error.code = task.error_code || 'STAGE_FAILED';
          error.retryable = task.retryable === true;
          error.data = bundle;
          throw error;
        }
        if (task.active_generation_id || ['queued', 'running'].includes(String(task.status || '').toLowerCase())) {
          if (task.active_generation_id) {
            adoptActiveGeneration(ctx.state, {
              id: task.active_generation_id,
              stage: task.active_stage || expectedStage,
              started_at: task.generation_started_at,
              queued_at: task.generation_queued_at,
            }, expectedStage);
            ctx.renderAll?.();
          }
          return waitForStage(taskId, expectedStage, ctx);
        }
        return bundle;
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  async function waitForStage(taskId, stage, ctx = {}) {
    const { api, normalizeBundle } = ctx;
    const started = Date.now();
    const timeoutMs = stageTimeoutMs(stage, ctx);
    let progressRevision = '';
    while (Date.now() - started < timeoutMs) {
      // 处理中只读取轻量进度，不再每 2.5 秒下载并重绘分镜、图片和视频。
      const progressBundle = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/progress${progressRevision ? `?since=${encodeURIComponent(progressRevision)}` : ''}`);
      progressRevision = String(progressBundle.revision || progressRevision);
      normalizeBundle?.(progressBundle);
      ctx.renderProgress?.();
      const task = progressBundle.task || {};
      const active = String(task.active_generation_id || '');
      const status = String(task.status || '').toLowerCase();
      const currentStage = String(task.stage || '');
      if (status === 'cancelled' || currentStage.endsWith('_cancelled')) {
        const error = new Error('已取消当前生成');
        error.code = 'USER_CANCELLED';
        error.retryable = true;
        error.data = progressBundle;
        throw error;
      }
      if (!active && status === 'failed') {
        const error = new Error(task.error || `${stage} 阶段执行失败`);
        error.code = task.error_code || 'STAGE_FAILED';
        error.retryable = task.retryable === true;
        error.data = progressBundle;
        throw error;
      }
      if (!active && (!['queued', 'running'].includes(status)
        || (currentStage && currentStage !== stage && !currentStage.endsWith('_queued')))) {
        // 阶段结束后只获取一次完整快照，用于展示产物和执行最终就绪判断。
        const bundle = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}?compact=1`);
        normalizeBundle?.(bundle);
        ctx.renderAll?.();
        return bundle;
      }
      await sleep(2500);
    }
    const error = new Error(`${STAGE_LABELS[stage] || stage}超过 ${Math.round(timeoutMs / 60000)} 分钟，已停止页面等待；请在任务中心查看状态或取消后重试`);
    error.code = 'CLIENT_POLL_TIMEOUT';
    error.retryable = true;
    throw error;
  }

  async function startStage(taskId, stage, body, ctx = {}) {
    const expectedStage = stage === 'scene' ? 'scene_config' : String(stage || '').replace(/-/g, '_');
    const evidence = submissionEvidence(ctx);
    const state = ctx.state || {};
    const generationBody = {
      ...(body || {}),
      snapshot_id: state.generationSnapshotId || '',
      expected_content_revision: Math.max(1, Number(state.contentRevision || 1) || 1),
      input_fingerprint: state.generationInputFingerprint || '',
      idempotency_key: `${taskId}:${expectedStage}:r${Math.max(1, Number(state.contentRevision || 1) || 1)}`,
    };
    let response;
    try {
      response = await ctx.api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/${stage === 'scene' ? 'scene-config' : stage}`, {
        method: 'POST',
        body: generationBody,
      });
    } catch (error) {
      return recoverUncertainStageSubmission(taskId, expectedStage, ctx, error, evidence);
    }
    if (ctx.state && response.job) {
      adoptActiveGeneration(ctx.state, response.job, expectedStage, generationBody);
      ctx.renderAll?.();
    }
    if (!response.job) return response;
    return waitForStage(taskId, expectedStage, ctx);
  }

  async function startKeyframesWithBillingGuard(taskId, body, ctx = {}) {
    try {
      return await startStage(taskId, 'keyframes', body, ctx);
    } catch (error) {
      const payload = error?.data || {};
      const details = payload.details || {};
      if (payload.code !== 'KEYFRAME_SUBMISSION_BILLING_UNKNOWN'
        || details.requires_billing_acknowledgement !== true) throw error;
      const shots = (details.blockers || []).map(item => item.shot_number).filter(Boolean).join('、');
      if (typeof window.DhDialog?.confirm !== 'function') {
        const unavailable = new Error('统一确认弹窗尚未加载，请刷新页面后重试。');
        unavailable.code = 'DIALOG_NOT_READY';
        throw unavailable;
      }
      const accepted = await window.DhDialog.confirm({
        title: '检测到上次请求计费状态未知',
        message: `第 ${shots || '相关'} 镜上一次请求已发给图片供应商，但无法确认是否已经计费或仍会返回结果。`,
        detail: '继续会放弃等待旧结果并重新提交一次，可能产生重复计费。系统不会自动替你继续。',
        confirmText: '仍要重新提交',
        cancelText: '暂不提交',
        type: 'danger',
      });
      if (!accepted) {
        const cancelled = new Error('已取消重新提交，没有产生新的图片模型调用。');
        cancelled.code = 'USER_CANCELLED';
        throw cancelled;
      }
      return startStage(taskId, 'keyframes', { ...body, acknowledge_billing_unknown: true }, ctx);
    }
  }

  /** 提交单个后台阶段，并在视频阶段携带不可复用的费用授权。 */
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
      saveStoryboardEdits,
      flushForGeneration,
      startStageProgress,
      setBusy,
      setButtonBusy,
    } = ctx;
    if (!state || typeof api !== 'function' || typeof ensureTask !== 'function') throw new Error('阶段生成上下文未初始化');
    const busyLabel = STAGE_LABELS[stage] || '处理中...';
    setButtonBusy?.(button, true, '正在确认最新内容...');
    try {
      const prepared = typeof flushForGeneration === 'function'
        ? await flushForGeneration(stage === 'blueprint' ? 'script_package' : stage)
        : { taskId: await ensureTask() };
      const id = prepared?.taskId || prepared?.task_id || state.taskId || await ensureTask();
      startStageProgress?.(stage, busyLabel);
      setBusy?.(true, busyLabel);
      setButtonBusy?.(button, true, busyLabel);
      let r = null;
      if (stage === 'scene') {
        r = await startStage(id, 'scene', {}, ctx);
        normalizeBundle?.(r);
        showStep?.(2);
      } else if (stage === 'blueprint') {
        if (!state.sceneConfig) normalizeBundle?.(await startStage(id, 'scene', {}, ctx));
        r = await startStage(id, 'script-package', {}, ctx);
        normalizeBundle?.(r);
        if (!blueprintIsReady(r, state)) throw new Error('剧本任务已结束，但服务器没有保存可用剧本；已停留在当前步骤，请重新生成剧本');
        if (!storyboardIsReady(r, state)) throw new Error('剧本已经生成，但配套分镜未通过检查；系统已停止下游生成，请查看错误详情');
        showStep?.(3);
      } else if (stage === 'storyboard') {
        if (!state.blueprint) normalizeBundle?.(await startStage(id, 'blueprint', {}, ctx));
        if (!blueprintIsReady({}, state)) throw new Error('服务器没有可用剧本，不能继续生成分镜；请先重新生成剧本');
        if (state.blueprint && typeof saveBlueprintEdits === 'function') await saveBlueprintEdits(id);
        if (!storyboardIsReady({}, state)) {
          r = await startStage(id, 'storyboard', {}, ctx);
          normalizeBundle?.(r);
        } else {
          r = { storyboard_status: state.storyboardStatus, outputs: { storyboard_table: state.shots } };
        }
        if (!storyboardIsReady(r, state)) throw new Error('分镜任务已结束，但服务器尚未确认当前剧本对应的分镜结果，请重试');
        showStep?.(4);
      } else if (stage === 'keyframes') {
        if (!state.shots.length) normalizeBundle?.(await startStage(id, 'storyboard', {}, ctx));
        if (state.storyboardDirty === true && state.shots.length && typeof saveStoryboardEdits === 'function') await saveStoryboardEdits(id);
        const missingOnly = button?.id === 'dhNsaAdFillMissingFramesTop';
        r = await startKeyframesWithBillingGuard(id, missingOnly ? { missing_images_only: true } : {}, ctx);
        normalizeBundle?.(r);
        showStep?.(4);
      } else if (stage === 'tts') {
        r = await startStage(id, 'tts', mediaStageBody(ctx), ctx);
        normalizeBundle?.(r);
        showStep?.(5);
      } else if (stage === 'video') {
        const regenerateAll = button?.id === 'dhNsaAdRegenerateAllShotVideos';
        const singleIndex = button?.dataset?.nsaVideoRegenerate === undefined ? null : Number(button.dataset.nsaVideoRegenerate);
        r = await startStage(id, 'video', {
          ...mediaStageBody(ctx),
          include_voiceover: false,
          auto_tts: false,
          visual_only: true,
          missing_only: !regenerateAll,
          force_regenerate_all: regenerateAll,
          video_generation_mode: state.videoGenerationMode || (regenerateAll ? 'quality' : 'economy'),
          video_preflight_fingerprint: state.videoPreflightFingerprint || '',
          cost_plan_fingerprint: state.videoCostPlanFingerprint || '',
          confirmed_cost_limit_rmb: Number(state.videoConfirmedCostLimitRmb || 0),
          complexity_review_confirmed: state.videoComplexityReviewConfirmed === true,
          zero_cost_only: state.videoZeroCostOnly === true,
          ...(Number.isInteger(singleIndex) ? { only_indexes: [singleIndex], force_regenerate_indexes: [singleIndex] } : {}),
          auto_repair: false,
          max_auto_repairs: 0,
        }, ctx);
        normalizeBundle?.(r);
        showStep?.(4);
      } else if (stage === 'compose') {
        r = await startStage(id, 'compose', mediaStageBody(ctx), ctx);
        normalizeBundle?.(r);
        showStep?.(5);
      } else if (stage === 'media') {
        if (!Array.isArray(state.videoSelectedIndexes) || !state.videoSelectedIndexes.length) {
          throw new Error('尚未选择并二次确认生成单元，本次没有提交。');
        }
        // 用户已确认整条视频方案后立即进入“广告合成”，让真实生成、质检和封装进度都归属第 5 步。
        showStep?.(5);
        renderAll?.();
        r = await startStage(id, 'media', mediaStageBody(ctx), ctx);
        normalizeBundle?.(r);
        showStep?.(5);
      }
      renderAll?.();
      if (stage === 'keyframes') {
        const status = keyframeStatusFromResponse(r, state);
        if (status.missing > 0) toast?.(`真实画面已生成 ${status.completed}/${status.total}，还差 ${status.missing} 张，请点击补齐未生成镜头`, 'error');
        else if (r?.skipped) toast?.(`真实画面已完整：${status.completed}/${status.total}，无需补齐`, 'success');
        else toast?.(`真实画面已生成完成：${status.completed}/${status.total}`, 'success');
      } else {
        toast?.('剧情广告阶段已完成', 'success');
      }
      return true;
    } catch (err) {
      if (err.data) normalizeBundle?.(err.data);
      renderAll?.();
      toast?.(err.message || '阶段执行失败', err.code === 'USER_CANCELLED' ? 'info' : 'error');
      return false;
    } finally {
      if (state) {
        state.cancelRequested = false;
        if (!state.activeGenerationId) state.activeStage = '';
      }
      try {
        setBusy?.(false);
      } finally {
        setButtonBusy?.(button, false);
        renderAll?.();
      }
    }
  }

  async function cancelStage(ctx = {}) {
    const { state, api, renderAll, toast, setBusy } = ctx;
    if (!state || typeof api !== 'function' || state.cancelRequested) return false;
    const auxiliary = state.activeStage === 'person_sheet';
    if ((!state.taskId && !auxiliary) || (auxiliary && !state.activeGenerationId)) return false;
    state.cancelRequested = true;
    renderAll?.();
    try {
      const body = state.activeGenerationId ? { generation_id: state.activeGenerationId } : {};
      const url = auxiliary
        ? `/api/new-story-ad/generations/${encodeURIComponent(state.activeGenerationId)}/cancel`
        : `/api/new-story-ad/tasks/${encodeURIComponent(state.taskId)}/cancel`;
      const response = await api(url, { method: 'POST', body });
      if (response?.conflict) throw new Error('当前生成已变更，请刷新后重试');
      state.activeGenerationId = '';
      state.activeStage = '';
      state.cancelRequested = false;
      setBusy?.(false);
      renderAll?.();
      toast?.(response?.already_cancelled ? '当前生成已取消' : '已取消生成，已停止后续模型调用', 'info');
      return true;
    } catch (error) {
      state.cancelRequested = false;
      renderAll?.();
      toast?.(error.message || '取消生成失败', 'error');
      return false;
    }
  }

  async function runMediaChain(ctx = {}) {
    if (ctx.state?.voiceId && !await runStage('tts', ctx)) return false;
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
      if (r.brief && input) input.value = formatBriefText(r.brief);
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
    startStage,
    startKeyframesWithBillingGuard,
    waitForStage,
    cancelStage,
    isNetworkError,
    stageWasAccepted,
    taskConfirmsSubmission,
    storyboardIsReady,
    blueprintIsReady,
    formatBriefText,
    STAGE_LABELS,
  };
})();

