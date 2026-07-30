(() => {
  const clean = value => String(value || '').trim();
  const list = value => Array.isArray(value) ? value : [];

  /** 首屏只提供数据契约；完整人物档案 UI 进入资产步骤后替换本对象。 */
  window.NewStoryAdSubjectAssetsUI = window.NewStoryAdSubjectAssetsUI || {
    assetCastMode(rawMode = '', count = 0, fallback = 'auto') {
      const mode = clean(rawMode).toLowerCase();
      if (['single', 'dual', 'multi', 'no_human', 'animal', 'human_pet'].includes(mode)) return mode;
      if (Number(count) > 2) return 'multi';
      if (Number(count) === 2) return 'dual';
      if (Number(count) === 1) return 'single';
      return fallback || 'auto';
    },
    castProfiles(asset = {}) {
      const profiles = asset.cast_profiles || asset.metadata?.cast_profiles;
      return Array.isArray(profiles) && profiles.length ? profiles : null;
    },
    reconcileProfiles(state = {}, spec = {}) {
      const mode = spec.castMode || spec.cast_mode || 'auto';
      const people = ['no_human', 'animal'].includes(mode)
        ? 0
        : Math.max(0, Number(spec.expectedPeople || spec.expected_people || state.castProfiles?.length || 0));
      const pets = ['animal', 'human_pet'].includes(mode)
        ? Math.max(1, Number(spec.expectedAnimals || spec.expected_animals || state.petProfiles?.length || 1))
        : 0;
      return { people, pets, total: people + pets };
    },
    petProfiles(state = {}, spec = {}, required = false) {
      if (!required) return [];
      return list(state.petProfiles).slice(0, Math.max(1, Number(spec.expectedAnimals || spec.expected_animals || 1)));
    },
    subjectGalleryHtml(asset = null, pets = [], options = {}) {
      const cover = asset?.cover_image_url || asset?.image_url || asset?.url || '';
      if (!cover && !list(pets).length) return '';
      const escape = options.escapeHtml || (value => clean(value));
      return cover
        ? `<div class="dh-nsa-subject-cover"><img src="${escape(cover)}" alt="${escape(asset?.name || '人物档案封面')}" loading="lazy" decoding="async"></div>`
        : '';
    },
    renderProfiles(host) {
      if (host) host.innerHTML = '<div class="dh-nsa-lazy-placeholder">进入人物、道具与场景步骤后加载完整档案。</div>';
    },
  };

  /** 首屏只保存场景计划和已恢复资产；大型场景编辑/验证模块按需替换本对象。 */
  window.NewStoryAdSceneAssets = window.NewStoryAdSceneAssets || {
    payload: state => list(state?.sceneAssets),
    specPayload: () => ({}),
    planPayload: state => state?.sceneConfig || null,
    applyPlan(state, plan) {
      if (!state || !plan) return false;
      state.sceneConfig = plan;
      return true;
    },
    hydrate(state, input = {}) {
      const outputs = input.outputs || {};
      state.sceneConfig = outputs.scene_config || input.request?.scene_plan || state.sceneConfig || null;
      state.sceneAssets = list(outputs.scene_assets || input.request?.scene_assets || state.sceneAssets);
    },
    sceneSpecFingerprint: value => JSON.stringify(value || {}),
    sceneLockAssessment: asset => ({
      complete: asset?.verification?.status === 'verified' || asset?.scene_contract?.status === 'verified',
    }),
    configInfoHtml({ sceneConfig = null, brief = '' } = {}) {
      const count = list(sceneConfig?.spaces).length;
      const title = count ? `已规划 ${count} 个独立物理空间` : '场景资产尚未规划';
      return `<div class="dh-nsa-lazy-placeholder"><b>${title}</b><small>${clean(brief).slice(0, 120)}</small></div>`;
    },
    clearSpecInputs() {},
    syncSpecSelectionState() {},
    render() {},
  };
})();
