(() => {
  // V3.0 发布资源使用独立版本号，避免浏览器复用旧的五步流程脚本。
  const SCRIPT_VERSION = '20260728-story-step-v42';
  const CORE_SCRIPT_PATHS = [
    '/js/new-story-ad/api.js', '/js/new-story-ad/video-boundaries.js',
    '/js/new-story-ad/bootstrap-media-loader.js',
    '/js/new-story-ad/task-store.js',
    '/js/new-story-ad/progress.js',
    '/js/new-story-ad/scene-assets.js',
    '/js/new-story-ad/state-sync.js',
    '/js/new-story-ad/button-state.js',
    '/js/new-story-ad/step-navigation.js',
    '/js/new-story-ad/task-persistence.js',
    '/js/new-story-ad/storyboard.js',
    '/js/new-story-ad/person-pet-spec.js',
    '/js/new-story-ad/actors.js',
    '/js/new-story-ad/subject-assets-ui.js',
    '/js/new-story-ad/subject-profile-assist.js',
    '/js/new-story-ad/subject-checkpoint-polling.js',
    '/js/new-story-ad/verification-language.js',
    '/js/new-story-ad/keyframes.js',
    '/js/new-story-ad/uploads.js',
    '/js/new-story-ad/story-setup.js',
    '/js/new-story-ad/brand-overlay.js',
    '/js/new-story-ad/actor-library.js',
    '/js/new-story-ad/generation-flow.js',
    '/js/new-story-ad-legacy-ui.js',
  ];
  let loadPromise = null;
  let mediaLoader = null;
  const storyAdIsActive = window.NewStoryAdBootstrapSupport?.isActive || (() => false);
  const setLoadingState = window.NewStoryAdBootstrapSupport?.setLoadingState || (() => {});

  /** 顺序加载一个脚本，保证旧模块的全局依赖顺序不被破坏。 */
  function loadScript(path = '') {
    const absolute = `${path}?v=${encodeURIComponent(SCRIPT_VERSION)}`;
    const existing = Array.from(document.scripts).find(script => script.src.includes(path));
    if (existing?.dataset.loaded === 'true') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = existing || document.createElement('script');
      script.src = existing?.src || absolute;
      script.async = false;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`脚本加载失败：${path}`)), { once: true });
      if (!existing) (document.body || document.head || document.documentElement).appendChild(script);
    });
  }

  /** 只预取首次渲染需要的核心脚本；审片和费用模块进入第 6 步时再加载。 */
  function preloadScripts() {
    CORE_SCRIPT_PATHS.forEach(path => {
      if (document.querySelector(`link[data-nsa-script-preload="${path}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'script';
      link.href = `${path}?v=${encodeURIComponent(SCRIPT_VERSION)}`;
      link.dataset.nsaScriptPreload = path;
      document.head.appendChild(link);
    });
  }

  /** 在其余模块下载期间并行读取当前路由任务，减少恢复阶段的串行等待。 */
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

  /** 等剧情广告静态表单完整解析后再挂载，避免依赖整页脚本下载完成。 */
  function waitForStoryTemplate() {
    if (document.querySelector('[data-nsa-template-ready]')) return Promise.resolve();
    return new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[data-nsa-template-ready]')) return;
        observer.disconnect();
        resolve();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  /** 首次进入剧情广告时加载全部兼容模块，后续进入直接复用。 */
  async function loadStoryAd() {
    if (window.__newStoryAdLegacyUI) return window.__newStoryAdLegacyUI;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      setLoadingState('loading', '正在按需加载剧情广告工作台，不会影响其他平台模块…');
      let restoreFinished = false;
      const onRestoreFinished = () => {
        restoreFinished = true;
        setLoadingState('ready');
      };
      document.addEventListener('new-story-ad:restore-finished', onRestoreFinished, { once: true });
      preloadScripts();
      for (const path of CORE_SCRIPT_PATHS) {
        await loadScript(path);
        if (path.endsWith('/api.js')) prefetchRouteTask();
      }
      await waitForStoryTemplate();
      document.dispatchEvent(new CustomEvent('new-story-ad:mount'));
      const restoring = window.__newStoryAdLegacyUI?.state?.restoringTask === true;
      let routeTaskExpected = false;
      try {
        routeTaskExpected = !!new URLSearchParams(location.search || '').get('nsa_task_id');
      } catch {}
      if ((restoring || routeTaskExpected) && !restoreFinished) {
        setLoadingState('loading', '正在恢复已保存的任务数据，任务内容不会丢失…');
      } else {
        document.removeEventListener('new-story-ad:restore-finished', onRestoreFinished);
        setLoadingState('ready');
      }
      return window.__newStoryAdLegacyUI || null;
    })().catch((error) => {
      loadPromise = null;
      setLoadingState('error', error?.message || '剧情广告工作台加载失败，请刷新页面后重试。');
      throw error;
    });
    return loadPromise;
  }

  /** 监听路由、标签点击和可见状态，在真正需要时启动加载。 */
  function bindLazyEntry() {
    if (storyAdIsActive()) loadStoryAd().catch(() => {});
    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('.dh-nav-item[data-tab="new-story-ad"]')) loadStoryAd().catch(() => {});
      if (event.target?.closest?.('[data-nsa-step="6"], #dhNsaAdGenerateVideos, #dhNsaAdCompose')) loadMediaModules().catch(() => {});
    }, true);
    document.addEventListener('pointerover', event => {
      if (event.target?.closest?.('[data-nsa-step="6"]')) loadMediaModules().catch(() => {});
    }, true);
    window.addEventListener('popstate', () => {
      if (storyAdIsActive()) loadStoryAd().catch(() => {});
    });
    const pane = document.querySelector('.dh-tab-pane[data-pane="new-story-ad"]');
    if (pane) new MutationObserver(() => {
      if (storyAdIsActive()) loadStoryAd().catch(() => {});
    }).observe(pane, { attributes: true, attributeFilter: ['class'] });
  }

  // 媒体加载器本身属于核心小模块，但四个大型媒体模块只在第 6 步请求。
  const getMediaLoader = () => mediaLoader || (mediaLoader = window.NewStoryAdMediaLoader?.create({
    loadCore: loadStoryAd,
    loadScript,
  }));
  const loadMediaModules = async () => {
    await loadStoryAd();
    return getMediaLoader()?.load();
  };
  const mediaModulesReady = () => getMediaLoader()?.ready() === true;

  window.NewStoryAdBootstrap = {
    load: loadStoryAd,
    loadMedia: loadMediaModules,
    mediaReady: mediaModulesReady,
    isActive: storyAdIsActive,
  };
  // 脚本位于 body 末尾，所需工作台 DOM 已经存在；立即绑定可与主工作台脚本并行加载。
  bindLazyEntry();
})();
