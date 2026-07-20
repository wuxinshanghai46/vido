(() => {
  const TASK_STORAGE_KEY = 'vido_new_story_ad_current_task_id';

  function clean(value = '', max = 100) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function routeStep() {
    try {
      const step = Number(new URLSearchParams(location.search || '').get('nsa_step') || 0);
      if (Number.isFinite(step) && step >= 1 && step <= 5) return Math.round(step);
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
      url.searchParams.set('nsa_step', String(Math.max(1, Math.min(5, Number(step) || 1))));
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
    const currentVideosReady = shotCount > 0 && clips.length >= shotCount && Array.from({ length: shotCount }).every((_, index) => {
      const clip = clips.find((item, clipIndex) => {
        if (!item) return false;
        if (Number.isInteger(Number(item.shot_index))) return Number(item.shot_index) === index;
        if (Number.isInteger(Number(item.index))) return Number(item.index) === index + 1;
        return clipIndex === index;
      });
      return !!(clip?.video_url || clip?.videoUrl || clip?.file_path)
        && !clip?.error && !clip?.error_code
        && clip?.qa?.pass === true
        && clip?.cross_shot_qa?.pass !== false;
    });
    if (finalVideo.video_url || finalVideo.videoUrl) return 5;
    if (/(?:compose|final|tts)/.test(stage)) return 5;
    if (/video|media/.test(stage) || currentVideosReady || clips.length) return 4;
    if (!keyframeCount && /storyboard_(?:failed|cancelled)/.test(stage)) return 3;
    const storyboardReady = storyboardStatus && typeof storyboardStatus.ready === 'boolean'
      ? storyboardStatus.ready
      : shotCount > 0;
    if (keyframeCount || storyboardReady || outputs.keyframe_contracts || /keyframe/.test(stage)) return 4;
    if (/storyboard/.test(stage) && !/(?:failed|cancelled)/.test(stage)) return 3;
    if (outputs.blueprint) return 3;
    if (/blueprint_(?:failed|cancelled)/.test(stage)) return 2;
    if (/blueprint/.test(stage) && !/blueprint_(?:failed|cancelled)/.test(stage)) return 3;
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
    return `<div class="dh-nsa-stage-failure"><b>本次剧本没有生成成功</b><span>${escapeHtml(blueprintFailureMessage(state))}</span>${state.taskErrorCode ? `<em>错误代码：${escapeHtml(state.taskErrorCode)}</em>` : ''}<small>人物、场景和已通过的空间验证均已保留；请在当前第 2 步重新生成剧本。</small></div>`;
  }

  function syncBlueprintFailureHost(state = {}, host, escapeHtml = String) {
    if (state.busy || !host) return;
    const failure = blueprintFailureHtml(state, escapeHtml);
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
    syncBlueprintFailureHost,
  };
})();
