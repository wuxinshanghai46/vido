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

  function rememberRouteStep(step = 1, taskId = '') {
    try {
      const url = new URL(location.href);
      url.searchParams.set('tab', 'new-story-ad');
      url.searchParams.set('nsa_step', String(Math.max(1, Math.min(5, Number(step) || 1))));
      const id = clean(taskId || routeTaskId() || '', 100);
      if (id) url.searchParams.set('nsa_task_id', id);
      else url.searchParams.delete('nsa_task_id');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {}
  }

  window.NewStoryAdTaskStore = {
    TASK_STORAGE_KEY,
    routeStep,
    routeTaskId,
    storedTaskId,
    rememberTaskId,
    rememberRouteStep,
  };
})();
