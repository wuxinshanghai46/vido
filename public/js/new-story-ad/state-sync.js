(() => {
  function normalizeTaskOutputs(bundle = {}) {
    const raw = bundle.outputs || {};
    if (!Array.isArray(raw)) return raw && typeof raw === 'object' ? raw : {};
    return Object.fromEntries(raw.map(item => [item.kind, item.payload]));
  }

  function setFieldValue(selector, value, { within } = {}) {
    const el = typeof within === 'function' ? within(selector) : document.querySelector(selector);
    if (!el || value === undefined || value === null) return;
    el.value = String(value);
  }

  function isFallbackPersonAsset(asset = {}) {
    if (!asset || typeof asset !== 'object') return false;
    const metadata = asset.metadata || {};
    const source = [
      asset.generated_by,
      metadata.generated_by,
      asset.source,
      metadata.source,
      asset.status,
      metadata.status,
    ].filter(Boolean).join(' ').toLowerCase();
    return asset.fallback_used === true
      || metadata.fallback_used === true
      || Boolean(asset.fallback_reason || metadata.fallback_reason)
      || /person_sheet\.fallback|fallback_actor_library/.test(source);
  }

  function hydrateSceneAssets(state = {}, { request = {}, outputs = {}, response = {} } = {}) {
    if (window.NewStoryAdSceneAssets?.hydrate) {
      window.NewStoryAdSceneAssets.hydrate(state, { request, outputs, response });
      return;
    }
    state.sceneAssets = outputs.scene_assets
      || response.scene_assets
      || request.scene_assets
      || request.sceneAssets
      || state.sceneAssets
      || [];
  }

  function progressStageMatches(progressStage = '', activeStage = '') {
    const uiStage = String(progressStage || '');
    const serverStage = String(activeStage || '');
    if (!uiStage || !serverStage) return false;
    if (uiStage === serverStage) return true;
    if (uiStage === 'scene' && serverStage === 'scene_config') return true;
    if (uiStage === 'single_keyframe' && serverStage === 'keyframes') return true;
    return false;
  }

  function syncActiveGenerationClock(state = {}, task = {}) {
    const progress = state.stageProgress;
    const generationId = String(task.active_generation_id || '');
    const activeStage = String(task.active_stage || '');
    if (!progress?.active || !generationId || !progressStageMatches(progress.stage, activeStage)) return false;
    if (progress.generationId && String(progress.generationId) !== generationId) return false;
    const timestamp = task.generation_started_at || task.generation_queued_at || task.generation_progress?.started_at || '';
    const startedAt = Date.parse(timestamp);
    if (!Number.isFinite(startedAt)) return false;
    progress.generationId = generationId;
    progress.startedAt = startedAt;
    return true;
  }

  function normalizeBundle(response = {}, ctx = {}) {
    const { state, rememberTaskId } = ctx;
    if (!state) return;
    const bundle = response.bundle || response;
    const task = response.task || bundle.task || {};
    const outputs = bundle.outputs || {};
    state.context = outputs.context || response.context || state.context;
    state.sceneConfig = outputs.scene_config || response.scene_config || state.sceneConfig;
    state.blueprint = outputs.blueprint || response.blueprint || state.blueprint;
    state.storyboardStatus = response.storyboard_status || bundle.storyboard_status || state.storyboardStatus || null;
    state.shots = outputs.storyboard_table || response.shots || state.shots || [];
    state.contracts = outputs.keyframe_contracts || response.keyframe_contracts || state.contracts || [];
    state.keyframes = outputs.keyframes || response.keyframes || state.keyframes || [];
    state.review = outputs.quality_review || response.review || state.review;
    state.ttsAudio = outputs.tts_audio || response.tts_audio || state.ttsAudio;
    state.videoClips = outputs.video_clips || response.video_clips || state.videoClips || [];
    state.finalVideo = outputs.final_video || response.final_video || state.finalVideo;
    hydrateSceneAssets(state, {
      request: state.context || {},
      outputs,
      response,
    });
    state.taskId = response.task_id || response.task?.id || bundle.task?.id || state.taskId;
    state.activeGenerationId = task.active_generation_id || '';
    state.activeStage = task.active_stage || '';
    state.generationProgress = task.generation_progress || null;
    state.generationStartedAt = task.generation_started_at || task.generation_queued_at || task.generation_progress?.started_at || '';
    syncActiveGenerationClock(state, task);
    if (!state.activeGenerationId) state.cancelRequested = false;
    if (state.taskId && typeof rememberTaskId === 'function') rememberTaskId(state.taskId);
  }

  function hydrateAssets(state = {}, request = {}) {
    const assets = Array.isArray(request.assets) ? request.assets : (Array.isArray(request.references) ? request.references : []);
    const byType = type => assets.find(asset => String(asset?.type || '').toLowerCase() === type);
    const product = request.product_asset || byType('product');
    if (product && typeof product === 'object') {
      state.productAsset = {
        ...product,
        previewUrl: product.previewUrl || product.image_url || product.url || product.file_url || '',
      };
    }
    const person = request.person_asset || byType('person_reference');
    if (person && typeof person === 'object' && !state.personAsset && !isFallbackPersonAsset(person)) {
      state.personAsset = {
        ...person,
        previewUrl: person.previewUrl || person.image_url || person.url || person.file_url || '',
      };
      state.actorAsset = state.personAsset;
    }
    state.referenceAssets = assets
      .filter(asset => asset && String(asset.type || '').toLowerCase() === 'storyboard_reference')
      .map((asset, index) => ({
        ...asset,
        id: asset.id || `restored_reference_${index + 1}`,
        previewUrl: asset.previewUrl || asset.image_url || asset.url || asset.file_url || '',
      }));
    if (request.bgm_asset) state.bgmAsset = request.bgm_asset;
  }

  function hydratePersonSpec(request = {}, ctx = {}) {
    const { state, root, applyPersonAssetConstraints } = ctx;
    if (!state) return;
    const spec = request.person_spec || request.personSpec || request.person_context?.person_spec || {};
    Object.entries(spec || {}).forEach(([key, value]) => {
      const el = (typeof root === 'function' ? root() : document)?.querySelector(`[data-nsa-person-spec="${key}"]`);
      if (el && value !== undefined && value !== null) el.value = String(value);
    });
    const personAsset = request.person_asset || request.personAsset || request.person_context?.person_asset || null;
    if (personAsset && typeof personAsset === 'object' && !isFallbackPersonAsset(personAsset)) {
      state.personAsset = {
        ...personAsset,
        previewUrl: personAsset.previewUrl || personAsset.image_url || personAsset.url || '',
      };
      state.actorAsset = state.personAsset;
      if (typeof applyPersonAssetConstraints === 'function') applyPersonAssetConstraints(state.personAsset);
    } else {
      state.castProfiles = Array.isArray(request.cast_profiles || request.castProfiles)
        ? (request.cast_profiles || request.castProfiles)
        : [];
    }
  }

  function hydrateTaskBundle(bundle = {}, ctx = {}) {
    const {
      state,
      within,
      rememberTaskId,
      hydrateControlledProduction,
      applyPersonAssetConstraints,
      root,
    } = ctx;
    if (!state) return;
    const task = bundle.task || {};
    const outputs = normalizeTaskOutputs(bundle);
    const request = {
      ...(task.request || {}),
      ...(outputs.context || {}),
    };
    state.taskId = task.id || request.task_id || request.taskId || state.taskId;
    state.activeGenerationId = task.active_generation_id || '';
    state.activeStage = task.active_stage || '';
    state.generationProgress = task.generation_progress || null;
    state.generationStartedAt = task.generation_started_at || task.generation_queued_at || task.generation_progress?.started_at || '';
    if (!state.activeGenerationId) state.cancelRequested = false;
    state.context = outputs.context || request || state.context;
    state.sceneConfig = outputs.scene_config || state.sceneConfig;
    state.blueprint = outputs.blueprint || state.blueprint;
    state.storyboardStatus = bundle.storyboard_status || state.storyboardStatus || null;
    state.shots = outputs.storyboard_table || state.shots || [];
    state.contracts = outputs.keyframe_contracts || state.contracts || [];
    state.keyframes = outputs.keyframes || state.keyframes || [];
    state.review = outputs.quality_review || state.review;
    state.ttsAudio = outputs.tts_audio || state.ttsAudio;
    state.videoClips = outputs.video_clips || state.videoClips;
    state.finalVideo = outputs.final_video || state.finalVideo;
    hydrateSceneAssets(state, { request, outputs, response: bundle });

    setFieldValue('#dhNsaAdText', request.brief || request.content || task.brief || '', { within });
    setFieldValue('#dhNsaAdDuration', request.duration_sec || request.duration || 30, { within });
    state.outputRatio = request.output_ratio || request.outputRatio || state.outputRatio || '9:16';
    state.outputSize = request.output_size || request.outputSize || state.outputSize || 'standard';
    state.videoResolution = request.video_resolution || request.videoResolution || state.videoResolution || '720p';
    setFieldValue('#dhNsaAdProductionMode', request.production_mode || request.productionMode || 'auto', { within });
    state.voiceId = request.voice_id || request.voiceId || state.voiceId || '';
    state.voiceName = request.voice_name || request.voiceName || state.voiceName || '';
    state.subtitleEnabled = request.subtitle !== false;
    state.subtitleStyle = request.subtitle_style || request.subtitleStyle || state.subtitleStyle || 'popup';
    const subtitleConfig = request.subtitle_config || request.subtitleConfig || {};
    state.subtitleEnabled = subtitleConfig.show === false ? false : state.subtitleEnabled;
    state.subtitleStyle = subtitleConfig.style || state.subtitleStyle;
    state.subtitleOptions = {
      ...(state.subtitleOptions || {}),
      smartEmphasis: subtitleConfig.smartEmphasis !== false,
      fontName: subtitleConfig.fontName || state.subtitleOptions?.fontName || '抖音美好体',
      fontSize: Number(subtitleConfig.fontSize || state.subtitleOptions?.fontSize) || 72,
      color: subtitleConfig.color || '',
      outlineColor: subtitleConfig.outlineColor || '',
    };
    state.voiceVolume = Number(request.voice_volume || request.voiceVolume || state.voiceVolume || 1) || 1;
    state.bgmVolume = Number(request.bgm_volume || request.bgmVolume || state.bgmVolume || 0.16) || 0.16;
    state.bgmProfile = request.bgm_profile || request.bgmProfile || state.bgmProfile || 'auto';
    setFieldValue('#dhNsaAdVoiceId', state.voiceId, { within });
    if (typeof hydrateControlledProduction === 'function') hydrateControlledProduction(request);
    hydratePersonSpec(request, { state, root, applyPersonAssetConstraints });
    hydrateAssets(state, request);
    if (state.taskId && typeof rememberTaskId === 'function') rememberTaskId(state.taskId);
  }

  window.NewStoryAdStateSync = {
    normalizeTaskOutputs,
    normalizeBundle,
    hydrateTaskBundle,
    hydrateAssets,
    hydratePersonSpec,
    progressStageMatches,
    syncActiveGenerationClock,
  };
})();
