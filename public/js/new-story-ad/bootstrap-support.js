(() => {
  /** 判断当前路由或可见标签是否已经进入剧情广告。 */
  function storyAdIsActive() {
    const initial = document.documentElement.dataset.dhInitialTab === 'new-story-ad';
    let routeActive = false;
    try {
      routeActive = new URLSearchParams(location.search || '').get('tab') === 'new-story-ad';
    } catch {}
    const paneActive = document.querySelector('.dh-tab-pane[data-pane="new-story-ad"]')?.classList.contains('active');
    return initial || routeActive || paneActive;
  }

  /** 更新剧情广告区域的按需加载状态。 */
  function setLoadingState(status = 'loading', message = '') {
    if (status === 'loading') {
      document.documentElement.dataset.nsaStoryLoading = '1';
      delete document.documentElement.dataset.nsaStoryReady;
    } else {
      delete document.documentElement.dataset.nsaStoryLoading;
      document.documentElement.dataset.nsaStoryReady = '1';
    }
    const pane = document.querySelector('.dh-tab-pane[data-pane="new-story-ad"]');
    if (!pane) return;
    pane.setAttribute('aria-busy', status === 'loading' ? 'true' : 'false');
    let indicator = pane.querySelector('[data-nsa-lazy-loader]');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.dataset.nsaLazyLoader = 'true';
      indicator.style.cssText = 'margin:12px 20px;padding:10px 14px;border-radius:10px;background:rgba(59,130,246,.10);color:#bfdbfe;font-size:13px;';
      pane.prepend(indicator);
    }
    indicator.textContent = message || (status === 'loading' ? '正在加载剧情广告工作台…' : '');
    indicator.style.display = status === 'ready' ? 'none' : 'block';
    if (status === 'error') {
      indicator.style.background = 'rgba(239,68,68,.12)';
      indicator.style.color = '#fecaca';
    }
  }

  /** 预取首屏渲染需要的脚本，实际执行仍保持有序，避免破坏旧模块依赖。 */
  function preloadScripts(paths = [], version = '') {
    paths.forEach(path => {
      if (document.querySelector(`link[data-nsa-script-preload="${path}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'script';
      link.href = `${path}?v=${encodeURIComponent(version)}`;
      link.dataset.nsaScriptPreload = path;
      document.head.appendChild(link);
    });
  }

  /** 并行读取路由任务的轻量摘要，减少工作台恢复阶段的串行等待。 */
  function prefetchRouteTask() {
    if (window.__newStoryAdEarlyTask || !window.NewStoryAdApi?.request) return;
    let taskId = '';
    try {
      taskId = new URLSearchParams(location.search || '').get('nsa_task_id') || '';
    } catch {}
    if (!taskId) return;
    window.__newStoryAdEarlyTask = {
      id: taskId,
      promise: window.NewStoryAdApi.request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}?compact=1`)
        .then(data => ({ data, error: null }))
        .catch(error => ({ data: null, error })),
    };
  }

  window.NewStoryAdBootstrapSupport = {
    isActive: storyAdIsActive,
    setLoadingState,
    preloadScripts,
    prefetchRouteTask,
  };
})();
