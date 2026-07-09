(() => {
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
    const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/blueprint`, {
      method: 'PUT',
      body: { blueprint },
    });
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
        transition_from: shot.transition_from || '',
        transition_reason: shot.transition_reason || '',
      };
    });
    const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/storyboard`, {
      method: 'PUT',
      body: { shots },
    });
    if (typeof normalizeBundle === 'function') normalizeBundle(response);
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
    if (state.currentStep >= 5) return 'video_ready';
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
    if (typeof normalizeBundle === 'function') normalizeBundle(response);
    if (typeof window.__dhRefreshNewStoryAdTasks === 'function') {
      window.__dhRefreshNewStoryAdTasks().catch(() => {});
    }
    if (typeof renderAll === 'function') renderAll();
    if (opts.silent !== true && typeof toast === 'function') toast('剧情广告任务已保存，可在任务中心继续制作', 'success');
    return id;
  }

  window.NewStoryAdTaskPersistence = {
    ensureTask,
    saveCurrentTaskProgress,
    saveSceneAssetsProgress,
    saveBlueprintEdits,
    saveStoryboardEdits,
  };
})();

