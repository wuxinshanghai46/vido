(() => {
  const TASK_STORAGE_KEY = 'vido_new_story_ad_current_task_id';

  function clean(value = '', max = 100) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function routeStep() {
    try {
      const step = Number(new URLSearchParams(location.search || '').get('nsa_step') || 0);
      if (Number.isFinite(step) && step >= 1 && step <= 6) return Math.round(step);
    } catch {}
    return 1;
  }

  function routeTaskId() {
    try {
      return clean(new URLSearchParams(location.search || '').get('nsa_task_id') || '', 100);
    } catch {
      return '';
    }
  }

  function storedTaskId() {
    try {
      return clean(localStorage.getItem(TASK_STORAGE_KEY) || '', 100);
    } catch {
      return '';
    }
  }

  function rememberTaskId(taskId = '', step = 1) {
    const id = clean(taskId || '', 100);
    try {
      if (id) localStorage.setItem(TASK_STORAGE_KEY, id);
      else localStorage.removeItem(TASK_STORAGE_KEY);
    } catch {}
    rememberRouteStep(step, id);
  }

  function rememberRouteStep(step = 1, taskId) {
    try {
      const url = new URL(location.href);
      url.searchParams.set('tab', 'new-story-ad');
      url.searchParams.set('nsa_step', String(Math.max(1, Math.min(6, Number(step) || 1))));
      const id = clean(taskId === undefined ? routeTaskId() : taskId, 100);
      if (id) url.searchParams.set('nsa_task_id', id);
      else url.searchParams.delete('nsa_task_id');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {}
  }

  function normalizeOutputs(raw = {}) {
    if (!Array.isArray(raw)) return raw && typeof raw === 'object' ? raw : {};
    return Object.fromEntries(raw
      .filter(item => item && item.kind)
      .map(item => [item.kind, item.payload]));
  }

  function resumeStep(task = {}, rawOutputs = {}, storyboardStatus = null) {
    const outputs = normalizeOutputs(rawOutputs);
    const stage = clean(task.active_stage || task.stage || '', 120).toLowerCase();
    const shotCount = Math.max(
      Number(task.shot_count || 0) || 0,
      Array.isArray(outputs.storyboard_table) ? outputs.storyboard_table.length : 0,
    );
    const keyframeCount = Math.max(
      Number(task.keyframe_count || 0) || 0,
      Array.isArray(outputs.keyframes) ? outputs.keyframes.filter(frame => frame && (frame.image_url || frame.imageUrl || frame.url)).length : 0,
    );
    const finalVideo = outputs.final_video || {};
    const frames = Array.isArray(outputs.keyframes) ? outputs.keyframes : [];
    const currentFramesReady = shotCount > 0 && frames.length >= shotCount && frames.slice(0, shotCount).every(frame => (
      !!(frame?.image_url || frame?.imageUrl || frame?.url)
      && !frame?.regeneration_error
      && !['pending', 'generating', 'retrying_serial', 'outdated'].includes(String(frame?.current_generation_status || ''))
      && frame?.contract_outdated !== true
      && Number(frame?.qa_policy_version || 0) >= 2
      && frame?.qa?.pass === true
    ));
    const clips = Array.isArray(outputs.video_clips) ? outputs.video_clips : [];
    const orderedClips = Array.from({ length: shotCount }).map((_, index) => clips.find((item, clipIndex) => {
        if (!item) return false;
        if (Number.isInteger(Number(item.shot_index))) return Number(item.shot_index) === index;
        if (Number.isInteger(Number(item.index))) return Number(item.index) === index + 1;
        return clipIndex === index;
      }) || null);
    const boundaryReady = window.NewStoryAdVideoBoundaries?.audit?.(orderedClips, shotCount)?.ready
      ?? (shotCount <= 1 || orderedClips.slice(1).every(clip => clip?.cross_shot_qa?.pass === true));
    const currentVideosReady = shotCount > 0 && clips.length >= shotCount && boundaryReady && orderedClips.every(clip => {
      return !!(clip?.video_url || clip?.videoUrl || clip?.file_path)
        && !clip?.error && !clip?.error_code
        && clip?.qa?.pass === true;
    });
    if (finalVideo.video_url || finalVideo.videoUrl) return 6;
    if (/(?:compose|final|tts)/.test(stage)) return 6;
    if (/video|media/.test(stage) || currentVideosReady || clips.length) return 6;
    if (!keyframeCount && /storyboard_(?:failed|cancelled)/.test(stage)) return 4;
    const storyboardReady = storyboardStatus && typeof storyboardStatus.ready === 'boolean'
      ? storyboardStatus.ready
      : shotCount > 0;
    if (keyframeCount || storyboardReady || outputs.keyframe_contracts || /keyframe/.test(stage)) return 5;
    if (/storyboard/.test(stage) && !/(?:failed|cancelled)/.test(stage)) return 4;
    if (outputs.blueprint) return 4;
    if (/blueprint_(?:failed|cancelled)/.test(stage)) return 3;
    if (/blueprint/.test(stage) && !/blueprint_(?:failed|cancelled)/.test(stage)) return 4;
    if (task.story_setup_confirmed === true || outputs.request?.story_setup_confirmed === true) return 3;
    if (outputs.scene_config || outputs.scene_assets || /scene/.test(stage)) return 2;
    return 1;
  }

  function canContinue(task = {}) {
    const status = clean(task.status || '', 40).toLowerCase();
    const finalVideoUrl = clean(task.videoUrl || task.video_url || task.final_video_url || '', 1000);
    return !finalVideoUrl || !['done', 'completed', 'succeeded'].includes(status);
  }

  function blueprintFailureMessage(state = {}) {
    if (state.taskErrorCode === 'STAGE_DEADLINE_EXCEEDED') {
      return '剧本生成超过安全执行时限，本次没有产生可用剧本；请重新生成剧本。';
    }
    return state.taskError || '服务器没有保存可用剧本，请重新生成剧本。';
  }

  function blueprintFailureHtml(state = {}, escapeHtml = String) {
    if (state.blueprint || state.taskStatus !== 'failed' || state.taskStage !== 'blueprint_failed') return '';
    return `<div class="dh-nsa-stage-failure"><b>本次剧本没有生成成功</b><span>${escapeHtml(blueprintFailureMessage(state))}</span>${state.taskErrorCode ? `<em>错误代码：${escapeHtml(state.taskErrorCode)}</em>` : ''}<small>人物、场景和已通过的空间验证均已保留；请在第 3 步重新生成剧本。</small></div>`;
  }

  function keyframeFailureHtml(state = {}, escapeHtml = String) {
    if (state.taskStatus !== 'failed' || state.taskStage !== 'keyframes_failed') return '';
    const progress = state.generationProgress && typeof state.generationProgress === 'object'
      ? state.generationProgress
      : {};
    const total = Math.max(0, Number(progress.target_total || progress.total) || 0);
    const processed = Math.max(0, Number(progress.processed) || 0);
    const succeeded = Math.max(0, Number(progress.succeeded) || 0);
    const failed = Math.max(0, Number(progress.failed) || 0);
    const frames = Array.isArray(state.keyframes) ? state.keyframes : [];
    const dependencyBlocked = frames.filter(frame => String(frame?.error_code || '') === 'KEYFRAME_DEPENDENCY_BLOCKED'
      || String(frame?.current_generation_status || '') === 'blocked').length;
    const directFailures = Math.max(0, failed - dependencyBlocked);
    const rawCounters = total
      ? `本批次已处理 ${processed}/${total} 张，可用 ${succeeded} 张${failed ? `，失败 ${failed} 张` : ''}。`
      : '';
    const counters = failed && dependencyBlocked
      ? `${directFailures} 个根镜头直接失败，${dependencyBlocked} 个依赖镜头未调用图片供应商。请先处理直接失败的根镜头。`
      : rawCounters;
    const message = state.taskError || '真实分镜生成未完成，服务器已停止本批次。';
    return `<div class="dh-nsa-stage-failure"><b>真实分镜生成未完成</b><span>${escapeHtml(message)}</span>${state.taskErrorCode ? `<em>错误代码：${escapeHtml(state.taskErrorCode)}</em>` : ''}<small>${escapeHtml(counters)} 已成功的图片会保留；再次操作时只补齐未完成镜头，不会自动重复提交。</small></div>`;
  }

  function genericFailureHtml(state = {}, escapeHtml = String) {
    if (state.taskStatus !== 'failed') return '';
    const guidance = window.NewStoryAdErrorGuidance?.format?.({
      data: {
        code: state.taskErrorCode,
        task: {
          stage: state.taskStage,
          error: state.taskError,
          error_code: state.taskErrorCode,
          support_id: state.taskSupportId,
          generation_progress: state.generationProgress || null,
        },
      },
      message: state.taskError || '当前阶段执行失败',
      stage: state.taskStage,
    });
    const where = guidance?.where || '当前阶段';
    const reason = guidance?.reason || state.taskError || '当前阶段执行失败';
    const action = guidance?.action || '请按错误提示修改后，从当前步骤重试。';
    return `<div class="dh-nsa-stage-failure"><b>${escapeHtml(where)}未完成</b><span>${escapeHtml(reason)}</span>${state.taskErrorCode ? `<em>错误代码：${escapeHtml(state.taskErrorCode)}${state.taskSupportId ? ` · 支持编号：${escapeHtml(state.taskSupportId)}` : ''}</em>` : ''}<small>处理方法：${escapeHtml(action)}</small></div>`;
  }

  function stageFailureHtml(state = {}, escapeHtml = String) {
    return blueprintFailureHtml(state, escapeHtml) || keyframeFailureHtml(state, escapeHtml) || genericFailureHtml(state, escapeHtml);
  }

  function syncBlueprintFailureHost(state = {}, host, escapeHtml = String) {
    if (state.busy || !host) return;
    const failure = stageFailureHtml(state, escapeHtml);
    host.hidden = !failure;
    host.innerHTML = failure;
  }

  window.NewStoryAdTaskStore = {
    TASK_STORAGE_KEY,
    routeStep,
    routeTaskId,
    storedTaskId,
    rememberTaskId,
    rememberRouteStep,
    normalizeOutputs,
    resumeStep,
    canContinue,
    blueprintFailureMessage,
    blueprintFailureHtml,
    keyframeFailureHtml,
    genericFailureHtml,
    stageFailureHtml,
    syncBlueprintFailureHost,
  };
})();
