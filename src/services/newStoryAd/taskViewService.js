function sceneProjectionRows(outputs = [], sceneAssetsInvalidation = null) {
  const rows = Array.isArray(outputs) ? outputs : [];
  if (!sceneAssetsInvalidation) return rows;
  const invalidatedAt = Date.parse(sceneAssetsInvalidation.invalidated_at || '');
  return rows.filter(row => {
    const kind = String(row?.kind || '');
    if (kind === 'scene_assets') return false;
    if (!kind.startsWith('scene_asset_checkpoint:')) return true;
    const checkpointTime = Date.parse(row.updated_at || row.payload?.updated_at || row.created_at || '');
    return Number.isFinite(invalidatedAt) && Number.isFinite(checkpointTime) && checkpointTime > invalidatedAt;
  });
}

function createTaskViewService(deps = {}) {
  const {
    storage,
    cleanText,
    sceneCheckpointProjection,
    videoStatusProjection,
    videoAttemptLedger,
    sceneAssetLifecycle,
    personAssetLifecycle,
    videoClipStatusRecovery,
    videoBoundaryPolicy,
    mediaResultProjection,
    assetPlanPublication,
    keyframeFailure,
    blueprintFingerprint,
    keyframeCompletion,
    isBeforeOrAtKeyframes,
    assetPlanFingerprint,
  } = deps;

  function storyboardStatus(bundle = {}, outputs = {}) {
    const rows = Array.isArray(bundle.outputs) ? bundle.outputs : [];
    const rowByKind = kind => rows.find(row => row?.kind === kind) || null;
    const blueprintRow = rowByKind('blueprint');
    const storyboardRow = rowByKind('storyboard_table');
    const checkpoint = outputs.storyboard_checkpoint || null;
    const meta = outputs.storyboard_meta || null;
    const blueprint = outputs.blueprint || {};
    const shots = Array.isArray(outputs.storyboard_table) ? outputs.storyboard_table : [];
    const currentFingerprint = blueprint.fingerprint || (Object.keys(blueprint).length ? blueprintFingerprint(blueprint) : '');
    const metaMatches = !!(meta?.blueprint_fingerprint && currentFingerprint && meta.blueprint_fingerprint === currentFingerprint);
    const timestampFresh = !!(blueprintRow && storyboardRow
      && Date.parse(storyboardRow.updated_at || 0) >= Date.parse(blueprintRow.updated_at || 0));
    const ready = shots.length > 0 && (meta
      ? meta.status === 'ready' && metaMatches
      : timestampFresh);
    return {
      ready,
      stale: shots.length > 0 && !ready,
      reason: ready ? '' : (shots.length ? 'BLUEPRINT_NEWER_THAN_STORYBOARD' : 'STORYBOARD_MISSING'),
      blueprint_revision: Number(blueprint.revision || 0),
      storyboard_blueprint_revision: Number(meta?.blueprint_revision || 0),
      checkpoint_available: !!(checkpoint && checkpoint.blueprint_fingerprint === currentFingerprint && Array.isArray(checkpoint.shots) && checkpoint.shots.length),
      checkpoint_completed: Array.isArray(checkpoint?.shots) ? checkpoint.shots.length : 0,
      checkpoint_total: Number(checkpoint?.expected_total || 0),
    };
  }

  function terminalizedGenerationProgress(task = {}, rawProgress = null, hasFinalOutput = false) {
    if (!rawProgress || typeof rawProgress !== 'object' || task.active_generation_id) return rawProgress;
    if (!['queued', 'running'].includes(String(rawProgress.status || '').toLowerCase())) return rawProgress;
    const now = task.generation_finished_at || task.updated_at || new Date().toISOString();
    const total = Number(rawProgress.total || 0);
    const completed = Number(rawProgress.completed || 0);
    const failed = Number(rawProgress.failed || 0);
    const taskFailed = !!(task.error_code || task.error) || String(task.status || '').toLowerCase() === 'failed';
    const status = hasFinalOutput ? 'done'
      : (taskFailed || (total > 0 && completed >= total && failed > 0) ? 'failed' : (total > 0 && completed >= total ? 'done' : 'stopped'));
    return {
      ...rawProgress,
      status,
      ...(status === 'done' ? {
        phase: 'complete',
        percent: 100,
        progress: 100,
        ...(total > 0 ? { completed: total, processed: total } : {}),
      } : {}),
      finished_at: rawProgress.finished_at || now,
      updated_at: now,
    };
  }

  function publicTaskBundle(taskId, { diagnostics = false, includeVideoMonitor = false, sections = '', workspaceSections = [] } = {}) {
    const rawBundle = storage.getTaskBundle(taskId, { diagnostics });
    const rawOutputs = rawBundle.outputs || [];
    const requestedWorkspaceSections = new Set(
      (Array.isArray(workspaceSections) && workspaceSections.length ? workspaceSections : String(sections || '').split(','))
        .map(section => String(section || '').trim()).filter(Boolean),
    );
    const lightweightWorkspaceRead = requestedWorkspaceSections.size > 0
      && [...requestedWorkspaceSections].every(section => ['summary', 'reference'].includes(section));
    if (lightweightWorkspaceRead) {
      const outputs = Object.fromEntries(rawOutputs.map(row => [row.kind, row.payload]));
      return {
        ...rawBundle,
        outputs,
        context: outputs.context || rawBundle.task?.request || {},
        video_shot_statuses: [],
        media_result: null,
        storyboard_status: null,
        keyframe_status: null,
      };
    }
    const invalidated = rawBundle.manifest?.invalidated || {};
    const hasCurrentSceneConfig = rawOutputs.some(row => String(row?.kind || '') === 'scene_config')
      && !Object.prototype.hasOwnProperty.call(invalidated, 'scene_config');
    const sceneAssetsInvalidation = Object.prototype.hasOwnProperty.call(invalidated, 'scene_assets')
      ? invalidated.scene_assets
      : null;
    const sceneAssetsAreCurrent = !sceneAssetsInvalidation;
    // Historical checkpoints remain available for audit/recovery, but they
    // must never be promoted back into the current UI after the authoritative
    // scene plan or scene assets were invalidated.
    const projectedSceneAssets = hasCurrentSceneConfig
      ? sceneAssetLifecycle.currentSceneAssetsFromBundle(rawBundle, storage.listModelCalls(taskId))
      : [];
    const videoShotStatuses = (rawBundle.outputs || [])
      .filter(row => String(row.kind || '').startsWith('video_shot_status_'))
      .sort((a, b) => Number(String(a.kind).slice('video_shot_status_'.length)) - Number(String(b.kind).slice('video_shot_status_'.length)))
      .map(row => row.payload || {})
      .filter(Boolean)
      .map((status, index) => {
        const { currentAttempt, lastAttempt, exposeLastAttempt, untouched } = videoStatusProjection.resolveAttempts(
          videoAttemptLedger,
          { taskId, status, index },
        );
        const artifact = status.artifact_compatibility || {};
        return {
          index: Number(status.index || status.shot_index || index + 1),
          title: cleanText(status.title || '', 120),
          lifecycle: cleanText(status.lifecycle || 'pending', 40),
          scene_block_id: cleanText(status.scene_block_id || '', 100),
          scene_block_members: Array.isArray(status.scene_block_members) ? status.scene_block_members.map(Number).filter(Number.isInteger) : [],
          qa_status: cleanText(status.qa_status || '', 40),
          qa_problems: Array.isArray(status.qa_problems) ? status.qa_problems.map(value => cleanText(value, 220)).filter(Boolean).slice(0, 6) : [],
          qa_failure_labels_zh: Array.isArray(status.qa_failure_labels_zh) ? status.qa_failure_labels_zh.map(value => cleanText(value, 80)).filter(Boolean).slice(0, 6) : [],
          cross_shot_qa_status: cleanText(status.cross_shot_qa_status || '', 40),
          cross_shot_qa_problems: Array.isArray(status.cross_shot_qa_problems) ? status.cross_shot_qa_problems.map(value => cleanText(value, 220)).filter(Boolean).slice(0, 6) : [],
          cross_shot_failure_labels_zh: Array.isArray(status.cross_shot_failure_labels_zh) ? status.cross_shot_failure_labels_zh.map(value => cleanText(value, 80)).filter(Boolean).slice(0, 6) : [],
          provider_submission_state: cleanText(currentAttempt?.provider_submission_state || status.provider_submission_state || '', 40),
          billing_state: cleanText(currentAttempt?.billing_state || status.billing_state || '', 40),
          executed_in_current_generation: !!(currentAttempt || lastAttempt)
            && cleanText((currentAttempt || lastAttempt)?.generation_id || '', 80) === cleanText(rawBundle.task?.generation_progress?.generation_id || rawBundle.task?.active_generation_id || '', 80),
          previous_clip_restored: !untouched && status.previous_clip_restored === true,
          stopped_after_unit_failure: status.stopped_after_unit_failure === true,
          last_attempt_provider_submission_state: cleanText(exposeLastAttempt ? (lastAttempt?.provider_submission_state || status.last_attempt_provider_submission_state || '') : '', 40),
          last_attempt_billing_state: cleanText(exposeLastAttempt ? (lastAttempt?.billing_state || status.last_attempt_billing_state || '') : '', 40),
          last_attempt_error_code: cleanText(exposeLastAttempt ? (lastAttempt?.error_code || status.last_attempt_error_code || '') : '', 160),
          last_attempt_status: cleanText(exposeLastAttempt ? (lastAttempt?.status || status.last_attempt_status || '') : '', 40),
          compatibility_status: cleanText(artifact.status || status.compatibility_status || '', 60),
          artifact_compatibility: artifact,
          compatibility_reason_codes: Array.isArray(artifact.reason_codes || status.compatibility_reason_codes) ? (artifact.reason_codes || status.compatibility_reason_codes).slice(0, 12) : [],
          regenerate_required: (artifact.status || status.compatibility_status) === 'regenerate_required',
          legacy_inferred: status.legacy_inferred === true,
          error: cleanText(status.error || '', 300),
          error_code: cleanText(status.error_code || '', 80),
          retryable: status.retryable === true,
          updated_at: status.updated_at || '',
        };
      });
    let visibleOutputs = (includeVideoMonitor
      ? (rawBundle.outputs || [])
      : (rawBundle.outputs || []).filter(row => !String(row.kind || '').startsWith('video_shot_status_')))
      .filter(row => !/^(?:scene|subject)_asset_checkpoint:/.test(String(row.kind || '')))
      .filter(row => !/^generation_permit:/.test(String(row.kind || '')))
      .filter(row => String(row.kind || '') !== 'asset_plan_candidate')
      .filter(row => String(row.kind || '') !== 'scene_assets' || (hasCurrentSceneConfig && sceneAssetsAreCurrent))
      .map(row => String(row.kind || '') === 'scene_assets'
        ? { ...row, payload: sceneAssetLifecycle.normalizeSceneAssets(projectedSceneAssets) }
        : row);
    visibleOutputs = personAssetLifecycle.projectLatestSubjectCheckpoint(visibleOutputs, rawBundle.outputs);
    if (projectedSceneAssets.length && !visibleOutputs.some(row => String(row.kind || '') === 'scene_assets')) {
      visibleOutputs = [
        ...visibleOutputs,
        { kind: 'scene_assets', payload: sceneAssetLifecycle.normalizeSceneAssets(projectedSceneAssets) },
      ];
    }
    const bundle = { ...rawBundle, outputs: visibleOutputs,
      stages: diagnostics ? rawBundle.stages : (rawBundle.stages || []).map(row => row.stage === 'video_submission'
        ? { task_id: row.task_id, stage: row.stage, status: row.status, error: '视频生成失败。' } : row),
    };
    const outputs = Object.fromEntries(visibleOutputs.map(x => [x.kind, x.payload]));
    const activePlanRecord = outputs.asset_plan_active && typeof outputs.asset_plan_active === 'object'
      ? outputs.asset_plan_active
      : null;
    if (activePlanRecord?.plan) outputs.asset_plan = activePlanRecord.plan;
    const currentPlanFingerprint = typeof assetPlanFingerprint === 'function'
      ? assetPlanFingerprint(bundle.task || {}, outputs.context || bundle.task?.request || {})
      : (activePlanRecord?.fingerprint || '');
    outputs.asset_plan_eligibility = assetPlanPublication
      ? assetPlanPublication.publicEligibility(taskId, { fingerprint: currentPlanFingerprint })
      : { eligible: false, issues: ['asset_plan_publication_service_missing'] };
    outputs.video_clips = videoClipStatusRecovery.recoverFromOutputRows(rawBundle.outputs || [], outputs.video_clips || []);
    const currentStoryboardStatus = storyboardStatus(bundle, outputs);
    const storyboard = Array.isArray(outputs.storyboard_table) ? outputs.storyboard_table : [];
    const contracts = Array.isArray(outputs.keyframe_contracts) ? outputs.keyframe_contracts : [];
    const keyframes = Array.isArray(outputs.keyframes) ? outputs.keyframes : [];
    const keyframeStatus = keyframeCompletion(keyframes, storyboard);
    let task = bundle.task;
    const boundaryFailure = videoBoundaryPolicy.taskFailurePatch(outputs.video_clips || [], storyboard.length);
    if (task && !task.active_generation_id && boundaryFailure) task = { ...task, ...boundaryFailure };
    if (task && !task.active_generation_id && keyframeStatus.failed > 0 && /keyframes_(ready|partial)|^keyframes$/.test(String(task.stage || ''))) {
      task = {
        ...task,
        status: 'failed',
        stage: 'keyframes_failed',
        error: `本次真实画面生成失败 ${keyframeStatus.failed} 张，已保留上一次图片供查看，请处理模型配置后重试`,
        error_code: 'KEYFRAME_GENERATION_FAILED',
        retryable: true,
      };
    }
    if (task && !task.active_generation_id && !String(task.stage || '').endsWith('_failed') && !String(task.stage || '').endsWith('_cancelled')) {
      if (keyframeStatus.total && keyframeStatus.completed) {
        const complete = keyframeStatus.fresh_pass >= keyframeStatus.total;
        if (isBeforeOrAtKeyframes(task.stage)) {
          task = {
            ...task,
            status: complete ? (task.saved_progress === true ? 'working' : 'done') : 'working',
            stage: complete ? 'keyframes_ready' : 'keyframes_partial',
            error: '',
          };
        }
      } else if (currentStoryboardStatus.ready && storyboard.length && ['storyboard', 'storyboard_done', 'storyboard_running'].includes(String(task.stage || ''))) {
        task = {
          ...task,
          status: task.saved_progress === true ? 'working' : 'done',
          stage: contracts.length ? 'keyframe_contract_ready' : 'storyboard_done',
          error: '',
        };
      }
    }
    if (task) {
      const hasFinalOutput = !!(outputs.final_video?.video_url || outputs.final_video?.videoUrl);
      const generationProgress = terminalizedGenerationProgress(task, task.generation_progress, hasFinalOutput);
      const failed = !hasFinalOutput && (task.error_code || generationProgress?.status === 'failed');
      task = {
        ...task,
        ...(generationProgress ? { generation_progress: generationProgress } : {}),
        ...(failed ? { status: 'failed' } : {}),
      };
    }
    const context = outputs.context || bundle.task?.request || {};
    return {
      ...bundle,
      task,
      context,
      outputs,
      video_shot_statuses: videoShotStatuses,
      media_result: mediaResultProjection.projectMediaResult({ task, outputs, videoShotStatuses, storyboard }),
      storyboard_status: currentStoryboardStatus,
      keyframe_status: keyframeStatus,
    };
  }

  function taskSummary(task = {}, { detailed = true, lookupOutputs = true } = {}) {
    const outputMap = detailed && task.id
      ? Object.fromEntries(storage.listOutputs(task.id).map(row => [row.kind, row.payload]))
      : {};
    const storyboard = outputMap.storyboard_table || [];
    const keyframes = outputMap.keyframes || [];
    const finalVideo = outputMap.final_video || (!detailed && lookupOutputs && task.id ? storage.getOutput(task.id, 'final_video') : null);
    const context = outputMap.context || task.request || {};
    const sceneAssets = outputMap.scene_assets || [];
    const firstFrame = keyframes.find(frame => frame?.image_url || frame?.imageUrl || frame?.url) || {};
    const firstScene = sceneAssets[0] || {};
    const finalVideoUrl = finalVideo?.video_url || finalVideo?.videoUrl || task.final_video_url || '';
    let videoShotStatuses = Object.entries(outputMap)
      .filter(([kind]) => String(kind).startsWith('video_shot_status_'))
      .sort(([a], [b]) => Number(a.slice('video_shot_status_'.length)) - Number(b.slice('video_shot_status_'.length)))
      .map(([, payload]) => payload)
      .filter(Boolean);
    if (!videoShotStatuses.length && Array.isArray(outputMap.video_clips)) {
      videoShotStatuses = outputMap.video_clips.map((clip, index) => {
        if (!clip) return null;
        const hasOutput = !!(clip.video_url || clip.videoUrl || clip.file_path);
        const failed = !!clip.error_code || clip.qa?.pass === false || clip.cross_shot_qa?.pass === false;
        return {
          index: index + 1,
          lifecycle: failed ? 'qa_failed' : (clip.qa?.pass === true ? 'qa_passed' : (hasOutput ? 'generated' : 'pending')),
        };
      }).filter(Boolean);
    }
    const hasFinalOutput = !!finalVideoUrl;
    const rawGenerationProgress = task.generation_progress && typeof task.generation_progress === 'object'
      ? task.generation_progress
      : null;
    const storedGenerationProgress = terminalizedGenerationProgress(task, rawGenerationProgress, hasFinalOutput);
    const storedVideoProgress = storedGenerationProgress?.stage === 'video' ? storedGenerationProgress : null;
    const videoProgress = storedVideoProgress || (videoShotStatuses.length ? {
      stage: 'video',
      total: Array.isArray(storyboard) ? storyboard.length : videoShotStatuses.length,
      generated: videoShotStatuses.filter(item => ['generated', 'video_qa', 'qa_passed', 'qa_failed'].includes(item.lifecycle)).length,
      qa_passed: videoShotStatuses.filter(item => item.lifecycle === 'qa_passed').length,
      failed: videoShotStatuses.filter(item => ['qa_failed', 'failed'].includes(item.lifecycle)).length,
    } : null);
    const storedStatus = String(task.status || '').toLowerCase();
    const failureSummary = lookupOutputs
      ? (videoBoundaryPolicy.taskFailurePatch(outputMap.video_clips || [], storyboard.length)
        || keyframeFailure.taskSummaryPatch(task, keyframes))
      : {
        error: task.error || '', error_code: task.error_code || '', support_id: task.support_id || '', retryable: task.retryable === true,
      };
    const taskStatus = hasFinalOutput
      ? 'done'
      : ((failureSummary.error_code || storedGenerationProgress?.status === 'failed')
        ? 'failed'
        : (['done', 'completed', 'succeeded', 'ready'].includes(storedStatus) ? 'working' : task.status));
    return {
      id: task.id,
      type: task.type,
      status: taskStatus,
      stage: task.stage,
      title: task.title,
      brief: cleanText(task.brief || '', 220),
      content_mode: cleanText(context.content_mode || '', 40),
      content_mode_source: cleanText(context.content_mode_source || '', 40),
      user_id: task.user_id,
      saved_progress: task.saved_progress === true,
      active_stage: task.active_stage || '',
      active_generation_id: task.active_generation_id || '',
      active_target_generations: Object.fromEntries(Object.entries(task.active_target_generations || {})
        .filter(([, value]) => String(value?.stage || '') !== 'scene_qa')),
      target_generation_results: task.target_generation_results && typeof task.target_generation_results === 'object'
        ? task.target_generation_results : {},
      content_revision: Math.max(1, Number(task.content_revision || 1) || 1),
      latest_client_edit_seq: Math.max(0, Number(task.latest_client_edit_seq || 0) || 0),
      current_snapshot_id: task.current_snapshot_id || '',
      lineage_enforced: task.lineage_enforced === true,
      error: cleanText(failureSummary.error, 300),
      error_code: failureSummary.error_code,
      support_id: failureSummary.support_id,
      retryable: failureSummary.retryable,
      actor_name: cleanText(context.person_asset?.name || context.person_spec?.displayName || context.person_spec?.roleName || '', 100),
      generation_queued_at: task.generation_queued_at || '',
      generation_started_at: task.generation_started_at || '',
      generation_finished_at: task.generation_finished_at || '',
      generation_progress: storedGenerationProgress || videoProgress,
      shot_count: Number(task.shot_count || 0) || (Array.isArray(storyboard) ? storyboard.length : 0),
      keyframe_count: Number(task.keyframe_count || 0) || (Array.isArray(keyframes) ? keyframes.filter(frame => frame?.image_url || frame?.imageUrl || frame?.url).length : 0),
      thumbnail_url: firstFrame.image_url || firstFrame.imageUrl || firstFrame.url || firstScene.image_url || firstScene.url || task.thumbnail_url || '',
      final_video_url: finalVideoUrl,
      created_at: task.created_at,
      updated_at: task.updated_at,
    };
  }

  function listTaskSummaries({ limit = 50, page = 1, status = '', userId = '' } = {}) {
    let tasks = storage.listTaskRows({ status, userId });
    const total = tasks.length;
    const pageSize = Math.max(1, Math.min(200, Number(limit) || 50));
    const currentPage = Math.max(1, Number(page) || 1);
    tasks = tasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    return {
      total,
      page: currentPage,
      page_size: pageSize,
      tasks: tasks.map(task => taskSummary(task, { detailed: false })),
    };
  }

  return { publicTaskBundle, taskSummary, listTaskSummaries };
}

module.exports = { createTaskViewService, sceneProjectionRows };
