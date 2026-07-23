(() => {
  function isNetworkError(error) {
    if (window.NewStoryAdGenerationFlow?.isNetworkError) return window.NewStoryAdGenerationFlow.isNetworkError(error);
    return error instanceof TypeError || /failed to fetch|network|connection (?:reset|aborted)|load failed/i.test(String(error?.message || error || ''));
  }

  function storyboardCore(shots = []) {
    return (Array.isArray(shots) ? shots : []).map(shot => ({
      index: Number(shot?.index || shot?.shot_index || 0),
      duration: Number(shot?.duration || shot?.duration_sec || 0),
      visual: String(shot?.visual || shot?.visual_description || shot?.content_prompt || ''),
      action: String(shot?.action || shot?.visual_action || ''),
      voiceover: String(shot?.voiceover || shot?.narration || shot?.subtitle || ''),
      purpose: String(shot?.purpose || shot?.objective || shot?.role || ''),
      shot_scope: String(shot?.shot_scope || shot?.shotScope || 'auto'),
      surface_topology: shot?.surface_topology || shot?.surfaceTopology || null,
      motion_effect: shot?.motion_effect || shot?.motionEffect || null,
    }));
  }

  function syncStoryboardArtifacts(state = {}, response = {}) {
    const outputs = response?.outputs && typeof response.outputs === 'object' ? response.outputs : {};
    const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source, key);
    const apply = (keys, stateKey, fallback) => {
      for (const source of [outputs, response]) {
        for (const key of keys) {
          if (!hasOwn(source, key)) continue;
          state[stateKey] = source[key] ?? fallback;
          return;
        }
      }
    };
    apply(['keyframes'], 'keyframes', []);
    apply(['quality_review', 'review'], 'review', null);
    apply(['tts_audio'], 'ttsAudio', null);
    apply(['video_clips'], 'videoClips', []);
    apply(['final_video'], 'finalVideo', null);
    return state;
  }

  async function recoverSavedOutput(taskId, outputKey, intended, ctx, originalError) {
    if (!isNetworkError(originalError)) throw originalError;
    const bundle = await ctx.api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}`);
    const persisted = bundle?.outputs?.[outputKey];
    const matches = outputKey === 'storyboard_table'
      ? JSON.stringify(storyboardCore(persisted)) === JSON.stringify(storyboardCore(intended))
      : JSON.stringify(persisted) === JSON.stringify(intended);
    if (!matches) throw originalError;
    ctx.normalizeBundle?.(bundle);
    ctx.toast?.('网络刚刚发生波动，服务器已保存修改，已自动恢复', 'info');
    return bundle;
  }

  async function ensureTask(ctx = {}) {
    const { state, payload, api, rememberTaskId, renderStatus } = ctx;
    if (!state || typeof api !== 'function' || typeof payload !== 'function') throw new Error('任务保存上下文未初始化');
    if (state.taskId) return state.taskId;
    const body = payload();
    if (String(body.brief || '').length < 8) throw new Error('请先填写至少 8 个字的广告需求');
    const created = await api('/api/new-story-ad/tasks', { method: 'POST', body });
    state.taskId = created.task?.id || created.task_id || created.taskId || '';
    state.context = created.context || null;
    if (typeof rememberTaskId === 'function') rememberTaskId(state.taskId);
    if (typeof renderStatus === 'function') renderStatus();
    return state.taskId;
  }

  async function saveBlueprintEdits(taskId, ctx = {}) {
    const { state, api, normalizeBundle, normalizeBlueprintForSave } = ctx;
    if (!state?.blueprint || !taskId) return null;
    if (typeof api !== 'function' || typeof normalizeBlueprintForSave !== 'function') throw new Error('剧本保存上下文未初始化');
    const blueprint = normalizeBlueprintForSave();
    state.blueprint = blueprint;
    let response;
    try {
      response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/blueprint`, {
        method: 'PUT',
        body: { blueprint },
      });
    } catch (error) {
      response = await recoverSavedOutput(taskId, 'blueprint', blueprint, ctx, error);
    }
    if (typeof normalizeBundle === 'function') normalizeBundle(response);
    state.blueprintDirty = false;
    return response;
  }

  async function saveStoryboardEdits(taskId, ctx = {}) {
    const { state, api, normalizeBundle, normalizeSpeechText } = ctx;
    if (!taskId || !Array.isArray(state?.shots) || !state.shots.length) return null;
    if (typeof api !== 'function') throw new Error('分镜保存上下文未初始化');
    const cleanSpeech = typeof normalizeSpeechText === 'function' ? normalizeSpeechText : value => String(value || '').trim();
    const shots = state.shots.map((shot, index) => {
      const duration = shot.duration || shot.duration_sec || 3;
      const visual = shot.visual || shot.visual_description || shot.content_prompt || '';
      const action = shot.action || shot.visual_action || '';
      const voiceover = cleanSpeech(shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || '');
      const purpose = shot.purpose || shot.objective || shot.role || '';
      const userEditedFields = shot._nsa_user_edited_fields || {};
      const userVisualOverride = shot.user_visual_override === true || userEditedFields.visual === true;
      const editedVisualLock = userVisualOverride
        ? [purpose, visual].filter(Boolean).join('\n')
        : purpose;
      return {
        ...shot,
        _prompt_preview: undefined,
        index: index + 1,
        shot_index: index + 1,
        duration,
        duration_sec: duration,
        visual,
        visual_description: visual,
        content_prompt: visual,
        action,
        visual_action: action,
        voiceover,
        narration: voiceover,
        subtitle: voiceover,
        purpose,
        objective: purpose,
        role: purpose || shot.role || '',
        keyframe_notes: editedVisualLock || shot.keyframe_notes || '',
        material_usage: editedVisualLock || shot.material_usage || '',
        user_visual_override: userVisualOverride,
        _nsa_user_edited_fields: userEditedFields,
        scene_id: shot.scene_id || shot.scene_asset_id || '',
        scene_asset_id: shot.scene_asset_id || shot.scene_id || '',
        scene_name: shot.scene_name || '',
        scene_view: shot.scene_view || '',
        scene_zone: shot.scene_zone || '',
        scene_revision: Number(shot.scene_revision || 1) || 1,
        camera_id: shot.camera_id || '',
        zone_ids: Array.isArray(shot.zone_ids) ? shot.zone_ids : [],
        anchor_ids: Array.isArray(shot.anchor_ids) ? shot.anchor_ids : [],
        transition_from: shot.transition_from || '',
        transition_reason: shot.transition_reason || '',
      };
    });
    let response;
    try {
      response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/storyboard`, {
        method: 'PUT',
        body: { shots },
      });
    } catch (error) {
      response = await recoverSavedOutput(taskId, 'storyboard_table', shots, ctx, error);
    }
    if (typeof normalizeBundle === 'function') normalizeBundle(response);
    syncStoryboardArtifacts(state, response);
    return response;
  }

  async function saveSceneAssetsProgress(taskId, ctx = {}) {
    const { state, api, normalizeBundle } = ctx;
    if (!taskId) return null;
    if (typeof api !== 'function') throw new Error('场景资产保存上下文未初始化');
    const sceneAssets = window.NewStoryAdSceneAssets?.payload?.(state) || state.sceneAssets || [];
    const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/scene-assets`, {
      method: 'PUT',
      body: { scene_assets: sceneAssets },
    });
    if (typeof normalizeBundle === 'function') normalizeBundle(response);
    if (typeof window.__dhRefreshNewStoryAdTasks === 'function') {
      await window.__dhRefreshNewStoryAdTasks();
    }
    return response;
  }

  function progressStageForState(state = {}) {
    if (state.finalVideo?.video_url || state.finalVideo?.videoUrl) return 'final_video_ready';
    if (Array.isArray(state.videoClips) && state.videoClips.some(clip => clip?.video_url || clip?.videoUrl || clip?.file_path)) return 'video_ready';
    if (Array.isArray(state.ttsAudio?.tracks) && state.ttsAudio.tracks.length) return 'tts_ready';
    if (Array.isArray(state.keyframes) && state.keyframes.some(frame => frame && (frame.image_url || frame.imageUrl || frame.url))) return 'keyframes_ready';
    if (Array.isArray(state.shots) && state.shots.length) return 'keyframe_contract_ready';
    if (state.blueprint) return 'blueprint_done';
    if (state.sceneConfig) return 'scene_config_done';
    return 'draft';
  }

  function progressSnapshotForState(state = {}, ctx = {}) {
    const sceneAssets = window.NewStoryAdSceneAssets?.payload?.(state) || state.sceneAssets || [];
    const normalizeBlueprint = typeof ctx.normalizeBlueprintForSave === 'function' ? ctx.normalizeBlueprintForSave : () => state.blueprint;
    return {
      context: state.context || null,
      scene_config: state.sceneConfig || null,
      blueprint: state.blueprint ? normalizeBlueprint() : null,
      storyboard_table: Array.isArray(state.shots) ? state.shots : [],
      keyframe_contracts: Array.isArray(state.contracts) ? state.contracts : [],
      keyframes: Array.isArray(state.keyframes) ? state.keyframes : [],
      scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [],
      quality_review: state.review || null,
      tts_audio: state.ttsAudio || null,
      video_clips: Array.isArray(state.videoClips) ? state.videoClips : [],
      final_video: state.finalVideo || null,
    };
  }

  async function saveCurrentTaskProgress(opts = {}, ctx = {}) {
    const { state, api, payload, normalizeBundle, renderAll, toast } = ctx;
    if (!state || typeof api !== 'function' || typeof payload !== 'function') throw new Error('任务保存上下文未初始化');
    const id = await ensureTask(ctx);
    const progressStage = progressStageForState(state);
    const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: {
        ...payload(),
        task_id: id,
        save_progress: true,
        progress_stage: progressStage,
        progress_snapshot: progressSnapshotForState(state, ctx),
      },
    });
    state.pendingChangeScope = 'none';
    if (typeof normalizeBundle === 'function') normalizeBundle(response);
    if (typeof window.__dhRefreshNewStoryAdTasks === 'function') {
      window.__dhRefreshNewStoryAdTasks().catch(() => {});
    }
    if (opts.render !== false && typeof renderAll === 'function') renderAll();
    if (opts.silent !== true && typeof toast === 'function') toast('剧情广告任务已保存，可在任务中心继续制作', 'success');
    return id;
  }

  window.NewStoryAdTaskPersistence = {
    ensureTask,
    saveCurrentTaskProgress,
    saveSceneAssetsProgress,
    saveBlueprintEdits,
    saveStoryboardEdits,
    syncStoryboardArtifacts,
    progressStageForState,
  };
})();

