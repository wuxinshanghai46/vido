(() => {
  const MEDIA_SCRIPT_PATHS = [
    '/js/new-story-ad/audio-preflight.js',
    '/js/new-story-ad/video-unit-availability.js',
    '/js/new-story-ad/transition-review.js',
    '/js/new-story-ad/video-review.js',
    '/js/new-story-ad/video-preflight-ui.js',
  ];

  /** 创建第 6 步媒体模块加载器，把审片、音频和费用代码从首屏核心包中隔离。 */
  function create({ loadCore, loadScript } = {}) {
    let loadPromise = null;
    const ready = () => MEDIA_SCRIPT_PATHS.every(path => Array.from(document.scripts)
      .some(script => script.src.includes(path) && script.dataset.loaded === 'true'));
    const load = async () => {
      if (ready()) return true;
      if (loadPromise) return loadPromise;
      loadPromise = (async () => {
        await loadCore();
        for (const path of MEDIA_SCRIPT_PATHS) await loadScript(path);
        document.dispatchEvent(new CustomEvent('new-story-ad:media-modules-ready'));
        return true;
      })().catch(error => {
        loadPromise = null;
        throw error;
      });
      return loadPromise;
    };
    return { ready, load };
  }

  window.NewStoryAdMediaLoader = { create, paths: MEDIA_SCRIPT_PATHS.slice() };
})();
