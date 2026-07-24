(() => {
  const BRIEF_SECTION_LABELS = new Set([
    '广告主题',
    '核心故事线',
    '人物与宠物设定',
    '人物设定',
    '宠物设定',
    '场景设定',
    '产品卖点',
    '核心卖点',
    '目标受众',
    '叙事节奏',
    '画面风格',
    '禁止项',
    '补充要求',
  ]);

  function formatBriefSectionLine(line = '') {
    const text = String(line).trim();
    const match = text.match(/^\s*(?:【([^】]+)】|([^：:\n]{2,18}))\s*[：:]\s*(.*)$/);
    if (!match) return text;
    const label = String(match[1] || match[2] || '').trim();
    const content = String(match[3] || '').trim();
    if (!BRIEF_SECTION_LABELS.has(label)) return text;
    return content ? `【${label}】${content}` : `【${label}】`;
  }

  /**
   * Tasks created before the assisted-brief formatter may persist escaped
   * newlines and Markdown. Normalize at the restore boundary so every caller
   * receives the same readable brief without rewriting historical storage.
   */
  function formatBriefText(value = '', max = 3000) {
    const normalized = String(value || '')
      .replace(/\\r\\n|\\n|\\r/g, '\n')
      .replace(/\\t/g, ' ')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '• ')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    if (!normalized) return '';

    const lines = normalized
      .split(/\n+/)
      .map(formatBriefSectionLine)
      .filter(Boolean);
    const output = [];
    for (const line of lines) {
      const isSection = /^【[^】]+】/.test(line);
      if (isSection && output.length && output[output.length - 1] !== '') output.push('');
      output.push(line);
    }
    return output.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  }

  function normalizeBriefContext(context = {}) {
    if (!context || typeof context !== 'object') return context;
    const rawBrief = context.brief || context.content || '';
    if (!rawBrief) return context;
    return { ...context, brief: formatBriefText(rawBrief) };
  }

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

  function hasOwn(source = {}, key = '') {
    return !!source && Object.prototype.hasOwnProperty.call(source, key);
  }

  function collectDurationContract(control) {
    const targetDuration = Number(control?.value || 30);
    const durationSource = control?.dataset?.durationSource
      || (control?.classList?.contains('dh-luxgen-hidden-control') ? 'ui_default' : 'user_selected');
    return {
      duration_sec: targetDuration,
      duration: targetDuration,
      target_duration: targetDuration,
      duration_source: durationSource,
    };
  }

  /**
   * 媒体结果属于具体任务和具体服务端快照。切换任务或服务端明确返回 null 时必须清空，
   * 不能把上一任务/上一轮尝试的红色提示沿用到当前成功结果。
   */
  function syncMediaResult(state = {}, { response = {}, bundle = {}, incomingTaskId = '' } = {}) {
    const previousTaskId = String(state.taskId || '');
    const nextTaskId = String(incomingTaskId || bundle.task?.id || response.task?.id || response.task_id || '');
    if (previousTaskId && nextTaskId && previousTaskId !== nextTaskId) state.mediaResult = null;
    if (hasOwn(response, 'media_result')) state.mediaResult = response.media_result || null;
    else if (hasOwn(bundle, 'media_result')) state.mediaResult = bundle.media_result || null;
    return state.mediaResult || null;
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

  function isPendingKeyframeSubmission(state = {}) {
    return state.stageProgress?.active === true
      && state.stageProgress?.stage === 'keyframes'
      && state.stageProgress?.submissionPending === true;
  }

  function shouldPreserveTrackedGeneration(state = {}, task = {}) {
    if (isPendingKeyframeSubmission(state)) return true;
    const trackedGenerationId = String(state.stageProgress?.active ? state.stageProgress?.generationId || '' : '');
    if (!trackedGenerationId) return false;
    const incomingActiveId = String(task.active_generation_id || '');
    const incomingProgressId = String(task.generation_progress?.generation_id || '');
    if (incomingActiveId) return incomingActiveId !== trackedGenerationId;
    if (incomingProgressId) return incomingProgressId !== trackedGenerationId;
    return true;
  }

  function syncGenerationProgress(state = {}, task = {}) {
    // Between the click and the POST acknowledgement, save/poll responses still
    // contain the previous batch's terminal counters. Keep the optimistic 0/N
    // snapshot until the new generation id is known.
    if (isPendingKeyframeSubmission(state)) return;
    const activeGenerationId = String(task.active_generation_id || '');
    const activeStage = String(task.active_stage || '');
    const incoming = task.generation_progress && typeof task.generation_progress === 'object'
      ? task.generation_progress
      : null;
    const incomingGenerationId = String(incoming?.generation_id || '');
    const trackedGenerationId = String(state.stageProgress?.generationId || activeGenerationId || '');
    const trackingKeyframes = state.stageProgress?.active === true
      && progressStageMatches(state.stageProgress?.stage, activeStage || incoming?.stage);
    if (incoming && trackingKeyframes && trackedGenerationId
      && (!incomingGenerationId || incomingGenerationId !== trackedGenerationId)) return;
    if (incoming && activeGenerationId && incomingGenerationId && incomingGenerationId !== activeGenerationId) return;
    if (incoming) {
      state.generationProgress = incoming;
      return;
    }
    const preserveOptimisticKeyframeProgress = activeGenerationId
      && activeStage === 'keyframes'
      && state.stageProgress?.active
      && (!state.stageProgress.generationId || String(state.stageProgress.generationId) === activeGenerationId);
    if (!preserveOptimisticKeyframeProgress) state.generationProgress = null;
  }

  function detectMissingStoryboardOutput(state = {}, outputs = {}) {
    const shots = Array.isArray(outputs.storyboard_table) ? outputs.storyboard_table : [];
    const meta = outputs.storyboard_meta || null;
    if (shots.length) {
      if (state.restoreErrorCode === 'STORYBOARD_OUTPUT_MISSING') {
        state.restoreError = '';
        state.restoreErrorCode = '';
      }
      return;
    }
    if (meta?.status !== 'ready') return;
    state.restoreErrorCode = 'STORYBOARD_OUTPUT_MISSING';
    state.restoreError = '服务器记录显示分镜曾经完成，但分镜主体数据已缺失；请从任务备份恢复，不能把 QA 状态当作分镜内容';
  }

  function normalizeBundle(response = {}, ctx = {}) {
    const { state, rememberTaskId } = ctx;
    if (!state) return;
    const bundle = response.bundle || response;
    const task = response.task || bundle.task || {};
    const incomingTaskId = response.task_id || response.task?.id || bundle.task?.id || '';
    const outputs = bundle.outputs || {};
    state.context = normalizeBriefContext(outputs.context || response.context || state.context);
    state.sceneConfig = outputs.scene_config || response.scene_config || state.sceneConfig;
    state.blueprint = outputs.blueprint || response.blueprint || state.blueprint;
    state.storyboardStatus = response.storyboard_status || bundle.storyboard_status || state.storyboardStatus || null;
    state.shots = outputs.storyboard_table || response.shots || state.shots || [];
    state.contracts = outputs.keyframe_contracts || response.keyframe_contracts || state.contracts || [];
    state.keyframes = outputs.keyframes || response.keyframes || state.keyframes || [];
    state.review = outputs.quality_review || response.review || state.review;
    state.ttsAudio = outputs.tts_audio || response.tts_audio || state.ttsAudio;
    state.videoClips = outputs.video_clips || response.video_clips || state.videoClips || [];
    state.videoShotStatuses = response.video_shot_statuses || bundle.video_shot_statuses || state.videoShotStatuses || [];
    syncMediaResult(state, { response, bundle, incomingTaskId });
    state.videoSceneBlocks = outputs.video_scene_blocks || response.video_scene_blocks || state.videoSceneBlocks || [];
    state.finalVideo = outputs.final_video || response.final_video || state.finalVideo;
    detectMissingStoryboardOutput(state, outputs);
    if (task.id || task.status || task.stage || task.error || task.error_code) {
      state.taskStatus = task.status || '';
      state.taskStage = task.stage || '';
      state.taskError = task.error || '';
      state.taskErrorCode = task.error_code || '';
    }
    hydrateSceneAssets(state, {
      request: state.context || {},
      outputs,
      response,
    });
    state.taskId = incomingTaskId || state.taskId;
    if (!shouldPreserveTrackedGeneration(state, task)) {
      state.activeGenerationId = task.active_generation_id || '';
      state.activeStage = task.active_stage || '';
    }
    syncGenerationProgress(state, task);
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
    const restoredBrief = formatBriefText(request.brief || request.content || task.brief || '');
    if (restoredBrief) request.brief = restoredBrief;
    const incomingTaskId = task.id || request.task_id || request.taskId || '';
    syncMediaResult(state, { bundle, incomingTaskId });
    state.taskId = incomingTaskId || state.taskId;
    if (!shouldPreserveTrackedGeneration(state, task)) {
      state.activeGenerationId = task.active_generation_id || '';
      state.activeStage = task.active_stage || '';
    }
    syncGenerationProgress(state, task);
    state.generationStartedAt = task.generation_started_at || task.generation_queued_at || task.generation_progress?.started_at || '';
    if (!state.activeGenerationId) state.cancelRequested = false;
    state.context = normalizeBriefContext({
      ...request,
      ...(outputs.context || {}),
      ...(restoredBrief ? { brief: restoredBrief } : {}),
    }) || state.context;
    state.sceneConfig = outputs.scene_config || state.sceneConfig;
    state.blueprint = outputs.blueprint || state.blueprint;
    state.storyboardStatus = bundle.storyboard_status || state.storyboardStatus || null;
    state.shots = outputs.storyboard_table || state.shots || [];
    state.contracts = outputs.keyframe_contracts || state.contracts || [];
    state.keyframes = outputs.keyframes || state.keyframes || [];
    state.review = outputs.quality_review || state.review;
    state.ttsAudio = outputs.tts_audio || state.ttsAudio;
    state.videoClips = outputs.video_clips || state.videoClips;
    state.videoShotStatuses = bundle.video_shot_statuses || state.videoShotStatuses || [];
    state.videoSceneBlocks = outputs.video_scene_blocks || state.videoSceneBlocks || [];
    state.finalVideo = outputs.final_video || state.finalVideo;
    detectMissingStoryboardOutput(state, outputs);
    state.taskStatus = task.status || '';
    state.taskStage = task.stage || '';
    state.taskError = task.error || '';
    state.taskErrorCode = task.error_code || '';
    hydrateSceneAssets(state, { request, outputs, response: bundle });

    setFieldValue('#dhNsaAdText', restoredBrief, { within });
    setFieldValue('#dhNsaAdDuration', request.target_duration || request.targetDuration || request.duration_sec || request.durationSec || request.duration || 30, { within });
    const durationControl = within('#dhNsaAdDuration');
    if (durationControl) durationControl.dataset.durationSource = request.duration_source || request.durationSource || 'persisted_context';
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
    syncGenerationProgress,
    isPendingKeyframeSubmission,
    shouldPreserveTrackedGeneration,
    detectMissingStoryboardOutput,
    syncMediaResult,
    collectDurationContract,
    formatBriefText,
  };
})();
