(() => {
  // V3.0 发布资源使用独立版本号，避免浏览器复用旧的五步流程脚本。
  const SCRIPT_VERSION = '20260731-reference-grounding-v2';
  const CORE_SCRIPT_PATHS = [
    '/js/new-story-ad/api.js', '/js/new-story-ad/video-boundaries.js',
    '/js/new-story-ad/director-workspace.js',
    '/js/new-story-ad/bootstrap-media-loader.js',
    '/js/new-story-ad/bootstrap-asset-loader.js',
    '/js/new-story-ad/asset-ui-contract.js',
    '/js/new-story-ad/task-store.js',
    '/js/new-story-ad/task-session.js',
    '/js/new-story-ad/progress.js', '/js/new-story-ad/assist-progress.js',
    '/js/new-story-ad/state-sync.js',
    '/js/new-story-ad/button-state.js',
    '/js/new-story-ad/step-navigation.js',
    '/js/new-story-ad/task-persistence.js', '/js/new-story-ad/auto-save-confirmation.js',
    '/js/new-story-ad/storyboard.js',
    '/js/new-story-ad/person-pet-spec.js',
    '/js/new-story-ad/person-age-authority.js',
    '/js/new-story-ad/actors.js',
    '/js/new-story-ad/subject-profile-authority.js',
    '/js/new-story-ad/subject-checkpoint-polling.js',
    '/js/new-story-ad/verification-language.js',
    '/js/new-story-ad/error-guidance.js',
    '/js/new-story-ad/keyframes.js',
    '/js/new-story-ad/uploads.js',
    '/js/new-story-ad/story-setup.js',
    '/js/new-story-ad/role-voice-ui.js',
    '/js/new-story-ad/person-reference-inheritance.js',
    '/js/new-story-ad/reference-video-analysis.js',
    '/js/new-story-ad/brand-overlay.js',
    '/js/new-story-ad/generation-flow.js',
    '/js/new-story-ad/cancelable-generation.js',
  ]; let loadPromise = null, mediaLoader = null;
  let assetLoader = null;
  const bootstrapSupport = window.NewStoryAdBootstrapSupport || {};
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
  /** 在其余模块下载期间并行读取当前路由任务，减少恢复阶段的串行等待。 */
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
    const params = new URLSearchParams(location.search || '');
    const taskId = String(params.get('nsa_task_id') || params.get('task_id') || '').trim();
    const step = Math.max(1, Math.min(6, Number(params.get('nsa_step') || 1) || 1));
    const view = ['brief', 'assets', 'plot', 'storyboard', 'shot', 'final'][step - 1];
    const target = taskId
      ? `/story-ad/projects/${encodeURIComponent(taskId)}?view=${encodeURIComponent(view)}`
      : '/story-ad/';
    if (`${location.pathname}${location.search}` !== target) location.assign(target);
    return null;
  }

  /** 人物档案生产、演员库和单人物 AI 补齐只在第 2 步需要，不进入参考识别首屏。 */
  /** 监听路由、标签点击和可见状态，在真正需要时启动加载。 */
  function bindLazyEntry() {
    if (storyAdIsActive()) loadStoryAd().catch(() => {});
    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('.dh-nav-item[data-tab="new-story-ad"]')) loadStoryAd().catch(() => {});
      const assetStudioTarget = event.target?.closest?.('#dhNsaAdRealPersonOpen, #dhNsaAdActorLibrary, [data-nsa-subject-assist-index]');
      if (assetStudioTarget && !assetModulesReady()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        loadAssetModules().then(() => assetStudioTarget.click()).catch(() => {});
        return;
      }
      const assetStepTarget = event.target?.closest?.('[data-nsa-step="2"]');
      if (assetStepTarget && !assetModulesReady()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        loadAssetModules().then(() => assetStepTarget.click()).catch(() => {});
        return;
      }
      if (event.target?.closest?.('[data-nsa-step="6"], #dhNsaAdGenerateVideos, #dhNsaAdCompose')) loadMediaModules().catch(() => {});
    }, true);
    document.addEventListener('pointerover', event => {
      if (event.target?.closest?.('[data-nsa-step="2"], #dhNsaAdRealPersonOpen, #dhNsaAdActorLibrary')) loadAssetModules().catch(() => {});
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
  const getAssetLoader = () => assetLoader || (assetLoader = window.NewStoryAdAssetLoader?.create({
    loadCore: loadStoryAd,
    loadScript,
  }));
  const loadAssetModules = async () => {
    await loadStoryAd();
    return getAssetLoader()?.load();
  };
  const assetModulesReady = () => getAssetLoader()?.ready() === true;

  window.NewStoryAdBootstrap = {
    load: loadStoryAd,
    loadAssetStudio: loadAssetModules,
    loadMedia: loadMediaModules,
    mediaReady: mediaModulesReady,
    isActive: storyAdIsActive,
  };
  // 脚本位于 body 末尾，所需工作台 DOM 已经存在；立即绑定可与主工作台脚本并行加载。
  bindLazyEntry();
})();
