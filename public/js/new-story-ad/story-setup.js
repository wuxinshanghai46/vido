(() => {
  const clean = (value = '', max = 3000) => String(value || '').trim().slice(0, max);

  function effectiveCastMode(state = {}, getPersonSpec = () => '') {
    const selected = clean(getPersonSpec('castMode'), 40);
    if (selected && selected !== 'auto') return selected;
    return clean(state.context?.cast_mode || state.sceneConfig?.cast_mode || selected || 'auto', 40);
  }

  function hasHumanIdentity(state = {}) {
    const asset = state.personAsset || state.actorAsset || null;
    if (!asset) return false;
    const direct = asset.image_url || asset.imageUrl || asset.previewUrl || asset.url || asset.file_url;
    const views = Array.isArray(asset.view_images) ? asset.view_images : [];
    const members = Array.isArray(asset.cast_assets) ? asset.cast_assets : [];
    return Boolean(direct
      || views.some(view => view?.url || view?.image_url)
      || members.some(member => member?.image_url || member?.url || member?.view_images?.length));
  }

  function petIdentityCount(state = {}) {
    return (Array.isArray(state.petProfiles) ? state.petProfiles : []).filter(pet => {
      const refs = Array.isArray(pet?.reference_images) ? pet.reference_images : [];
      const views = Array.isArray(pet?.view_images) ? pet.view_images : [];
      return Boolean(pet?.image_url || refs.length || views.some(view => view?.url || view?.image_url));
    }).length;
  }

  function sceneReadiness(state = {}) {
    const spaces = Array.isArray(state.sceneConfig?.spaces) ? state.sceneConfig.spaces : [];
    const assets = Array.isArray(state.sceneAssets) ? state.sceneAssets : [];
    if (!spaces.length) return { ready: false, message: '请先生成场景配置。' };
    const complete = spaces.filter(space => {
      const id = clean(space?.id || space?.space_id || space?.scene_id, 120);
      const asset = assets.find(candidate => clean(candidate?.scene_id || candidate?.space_id || candidate?.id, 120) === id);
      return asset && window.NewStoryAdSceneAssets?.sceneLockAssessment?.(asset)?.complete === true;
    }).length;
    return complete === spaces.length
      ? { ready: true, message: `${complete}/${spaces.length} 个场景形象已完整锁定。` }
      : { ready: false, message: `请先完成全部场景形象，目前 ${complete}/${spaces.length} 个完整锁定。` };
  }

  function readiness(state = {}, getPersonSpec = () => '') {
    const scene = sceneReadiness(state);
    if (!scene.ready) return scene;
    const mode = effectiveCastMode(state, getPersonSpec);
    const expectedPets = Math.max(0, Number(getPersonSpec('expectedAnimals') || state.context?.expected_animals || 0) || 0);
    if (!['no_human', 'animal'].includes(mode) && !hasHumanIdentity(state)) {
      return { ready: false, message: '请先生成、上传或选择人物形象；无人广告请明确选择“无人物”。' };
    }
    if (['animal', 'human_pet'].includes(mode) && petIdentityCount(state) < Math.max(1, expectedPets)) {
      return { ready: false, message: `请先完成宠物形象，目前 ${petIdentityCount(state)}/${Math.max(1, expectedPets)} 个已有身份参考。` };
    }
    return { ready: true, message: `${scene.message} 人物/主体形象已确认，可以进入剧情设置。` };
  }

  function creativeDirection(state = {}, within = () => null) {
    return {
      ...(state.context?.creative_direction || {}),
      raw: clean(within('#dhNsaAdCreativeDirection')?.value || state.context?.creative_direction?.raw || ''),
    };
  }

  function payload(state = {}) {
    return { story_setup_confirmed: state.storySetupConfirmed === true };
  }

  function hydrate(state = {}, request = {}) {
    const creative = request.creative_direction || request.creativeDirection || {};
    state.storySetupConfirmed = request.story_setup_confirmed === true || request.storySetupConfirmed === true;
    state.storySetupExpanded = state.storySetupConfirmed
      || Boolean(creative?.raw)
      || clean(request.production_mode || request.productionMode || 'auto', 40) !== 'auto'
      || request.brand_overlay?.enabled === true
      || request.brandOverlay?.enabled === true;
  }

  function invalidate(state = {}, scope = '') {
    if (!['source', 'product', 'scene', 'person'].includes(scope)) return;
    state.storySetupConfirmed = false;
  }

  function render({ state = {}, within = () => null, getPersonSpec = () => '' } = {}) {
    const panel = within('#dhNsaAdStorySetupPanel');
    const next = within('#dhNsaAdStorySetupNext');
    const continueButton = within('#dhNsaAdContinueStorySetup');
    const status = within('#dhNsaAdStorySetupStatus');
    const result = readiness(state, getPersonSpec);
    if (panel) panel.hidden = false;
    if (next) next.hidden = false;
    if (continueButton) continueButton.hidden = false;
    if (status) {
      status.textContent = result.message;
      status.classList.toggle('is-ready', result.ready);
    }
    return result;
  }

  function open({ state = {}, getPersonSpec = () => '', renderAll, showStep, toast } = {}) {
    const result = readiness(state, getPersonSpec);
    if (!result.ready) {
      toast?.(result.message, 'error');
      return false;
    }
    state.storySetupExpanded = true;
    renderAll?.();
    showStep?.(3);
    return true;
  }

  function approve({ state = {}, getPersonSpec = () => '', markSourceDirty, renderAll, toast } = {}) {
    const result = readiness(state, getPersonSpec);
    if (!result.ready) {
      toast?.(result.message, 'error');
      return false;
    }
    markSourceDirty?.('creative');
    state.storySetupExpanded = true;
    state.storySetupConfirmed = true;
    renderAll?.();
    return true;
  }

  async function assist({
    state = {}, button, within = () => null, getPersonSpec = () => '', buildPayload,
    ensureTask, api, markSourceDirty, renderAll, scheduleAutoSave, setButtonBusy, toast,
  } = {}) {
    const ready = readiness(state, getPersonSpec);
    if (!ready.ready) return toast?.(ready.message || '请先完成当前人物与场景形象', 'error');
    const label = '正在按已确认人物和场景辅写...';
    setButtonBusy?.(button, true, label);
    try {
      const taskId = await ensureTask();
      const response = await api('/api/new-story-ad/assist', {
        method: 'POST',
        body: {
          ...buildPayload(),
          task_id: taskId,
          mode: 'creative_direction',
          creative_direction: creativeDirection(state, within),
        },
      });
      const result = response.creative_direction || response.creativeDirection || {};
      const text = clean(result.raw || response.text || response.brief || '', 3000);
      if (!text) throw new Error('AI 没有返回可用的剧情与表演要求');
      const input = within('#dhNsaAdCreativeDirection');
      if (input) input.value = text;
      state.context = { ...(state.context || {}), creative_direction: { ...result, raw: text } };
      markSourceDirty?.('creative');
      renderAll?.();
      scheduleAutoSave?.('creative_direction_assist', { immediate: true });
      toast?.('已按当前人物、主体和场景辅写剧情与表演要求', 'success');
      return response;
    } catch (error) {
      toast?.(error.message || '剧情与表演 AI 辅写失败', 'error');
      return null;
    } finally {
      setButtonBusy?.(button, false);
    }
  }

  window.NewStoryAdStorySetup = {
    readiness,
    creativeDirection,
    payload,
    hydrate,
    invalidate,
    render,
    open,
    approve,
    assist,
  };
})();
