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

  function resumeStep(task = {}, rawOutputs = {}) {
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
    if (finalVideo.video_url || finalVideo.videoUrl || outputs.video_clips || outputs.tts_audio || /(?:final|compose|video|tts)/.test(stage)) return 5;
    if (keyframeCount || shotCount || outputs.keyframe_contracts || /(?:keyframe|storyboard)/.test(stage)) return 4;
    if (outputs.blueprint || /blueprint/.test(stage)) return 3;
    if (outputs.scene_config || outputs.scene_assets || /scene/.test(stage)) return 2;
    return 1;
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
  };
})();
