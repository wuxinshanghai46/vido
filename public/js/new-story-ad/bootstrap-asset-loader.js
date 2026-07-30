(() => {
  const ASSET_STUDIO_SCRIPT_PATHS = [
    '/js/new-story-ad/subject-assets-ui.js',
    '/js/new-story-ad/person-dossier-ui.js',
    '/js/new-story-ad/scene-assets.js',
    '/js/new-story-ad/subject-profile-assist.js',
    '/js/new-story-ad/prop-assets.js',
    '/js/new-story-ad/real-person-dossier.js',
    '/js/new-story-ad/actor-library.js',
  ];

  /** 创建人物资产工作室加载器，只在用户进入人物与场景步骤时加载重型能力。 */
  function create({ loadCore, loadScript } = {}) {
    let loadPromise = null;
    const ready = () => ASSET_STUDIO_SCRIPT_PATHS.every(path => Array.from(document.scripts)
      .some(script => script.src.includes(path) && script.dataset.loaded === 'true'));
    const load = async () => {
      if (ready()) return true;
      if (loadPromise) return loadPromise;
      loadPromise = (async () => {
        await loadCore();
        for (const path of ASSET_STUDIO_SCRIPT_PATHS) await loadScript(path);
        document.dispatchEvent(new CustomEvent('new-story-ad:asset-studio-ready'));
        return true;
      })().catch(error => {
        loadPromise = null;
        throw error;
      });
      return loadPromise;
    };
    return { ready, load };
  }

  window.NewStoryAdAssetLoader = { create, paths: ASSET_STUDIO_SCRIPT_PATHS.slice() };
})();
