const storage = require('./storageService');
const assetPlanPublication = require('./assetPlanPublicationService');
const { assertContextConsistent, cleanText } = require('./contextBuilder');
const { generateBlueprint } = require('./blueprintService');
const blueprintProgress = require('./blueprintProgressService');
const revisionService = require('./revisionService');
const contentDomainArtifacts = require('./contentDomainArtifactService');

function checkpointMatches(checkpoint, task, inputFingerprint) {
  if (!checkpoint || checkpoint.reusable !== true || !checkpoint.payload) return false;
  if (Number(checkpoint.content_revision || 0) !== Number(task.content_revision || 0)) return false;
  const expectedFingerprint = cleanText(inputFingerprint || task.active_input_fingerprint || '', 200);
  return !!expectedFingerprint && checkpoint.input_fingerprint === expectedFingerprint;
}

function blueprintInputFingerprint(task = {}, ctx = {}) {
  return storage.canonicalFingerprint({
    version: 2,
    contract: 'new_story_ad.blueprint.semantic-input-v2',
    asset_plan_fingerprint: ctx.asset_plan_fingerprint || '',
    brief: ctx.brief,
    product_subject: ctx.product_subject,
    reference_video_analysis: ctx.reference_video_analysis,
    cast_profiles: ctx.cast_profiles,
    pet_profiles: ctx.pet_profiles,
    prop_assets: (ctx.prop_assets || []).map(item => ({
      id: item.prop_id || item.id,
      revision: item.revision || 1,
      states: item.states || item.state_assets || [],
    })),
    scene_plan: ctx.scene_plan,
    scene_assets: (ctx.scene_assets || []).map(item => ({
      id: item.scene_id || item.id,
      revision: item.revision || 1,
      verification: item.verification?.status || item.status || '',
    })),
    target_duration: ctx.target_duration,
    shot_count: ctx.shot_count,
    output_ratio: ctx.output_ratio,
    creative_direction: ctx.creative_direction,
    performance: ctx.performance,
  });
}

function findReusableBlueprintArtifact(taskId, task = {}, ctx = {}, inputFingerprint = '') {
  const expected = cleanText(inputFingerprint, 200);
  if (!expected || typeof storage.listArtifacts !== 'function') return null;
  const currentReferenceId = cleanText(
    ctx.reference_video_analysis?.analysis_id || ctx.reference_video_analysis?.id || '',
    160,
  );
  return storage.listArtifacts(taskId, 'blueprint').find((artifact) => {
    if (!artifact || artifact.execution_disabled === true || artifact.cache_readonly === true) return false;
    if (['rejected', 'failed'].includes(String(artifact.qa_status || '').toLowerCase())) return false;
    if (!Array.isArray(artifact.payload?.beats) || !artifact.payload.beats.length) return false;
    if (cleanText(artifact.input_fingerprint, 200) === expected) return true;
    const snapshot = typeof storage.getSnapshot === 'function' ? storage.getSnapshot(artifact.snapshot_id) : null;
    const historical = snapshot?.payload && typeof snapshot.payload === 'object' ? snapshot.payload : null;
    if (!historical) return false;
    const historicalReferenceId = cleanText(
      historical.reference_video_analysis?.analysis_id || historical.reference_video_analysis?.id || '',
      160,
    );
    if (historicalReferenceId !== currentReferenceId) return false;
    return blueprintInputFingerprint(task, historical) === expected;
  }) || null;
}

function publishReusedBlueprint(taskId, task, blueprint, inputFingerprint, meta = {}) {
  const recovered = {
    ...blueprint,
    source_revision: Math.max(1, Number(task.content_revision || 1) || 1),
    ...(meta.artifact_id ? { recovered_from_artifact_id: meta.artifact_id } : {}),
  };
  if (meta.artifact_id) {
    storage.saveOutput(taskId, 'blueprint', recovered, {
      input_fingerprint: inputFingerprint,
      upstream_artifact_ids: [meta.artifact_id],
      qa_status: 'recovered_compatible',
    });
  }
  storage.saveOutput(taskId, 'blueprint_meta', {
    input_fingerprint: inputFingerprint,
    content_revision: Number(task.content_revision || 1),
    cache_hit: true,
    recovered_from_artifact_id: meta.artifact_id || '',
    completed_at: new Date().toISOString(),
  });
  storage.saveStage(taskId, 'blueprint', {
    status: 'done',
    output_summary: `${recovered.beats.length} 个剧情 beat（输入未变化，已复用）`,
    diagnostics: { input_fingerprint: inputFingerprint, cache_hit: true, recovered_from_artifact_id: meta.artifact_id || '' },
  });
  return recovered;
}

function recoverBlueprintWithoutProvider(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  const assetPlan = assetPlanPublication.currentPlan(taskId) || {};
  const inputFingerprint = blueprintInputFingerprint(task, { ...ctx, asset_plan_fingerprint: assetPlan.fingerprint || '' });
  const current = storage.getOutput(taskId, 'blueprint') || {};
  const currentMeta = storage.getOutput(taskId, 'blueprint_meta') || {};
  if (currentMeta.input_fingerprint === inputFingerprint && Array.isArray(current.beats) && current.beats.length) {
    return { blueprint: current, input_fingerprint: inputFingerprint, artifact_id: '', source: 'current' };
  }
  const artifact = findReusableBlueprintArtifact(taskId, task, {
    ...ctx,
    asset_plan_fingerprint: assetPlan.fingerprint || '',
  }, inputFingerprint);
  if (!artifact) return null;
  const blueprint = publishReusedBlueprint(taskId, task, artifact.payload, inputFingerprint, { artifact_id: artifact.id });
  blueprintProgress.update(taskId, {
    phase: 'artifact_recovered',
    completed: blueprintProgress.BLUEPRINT_PROGRESS_TOTAL,
    total: blueprintProgress.BLUEPRINT_PROGRESS_TOTAL,
    message: '已恢复语义一致的历史剧情蓝图，本次没有再次调用模型。',
  });
  storage.updateTask(taskId, {
    status: 'done',
    stage: 'blueprint_done',
    active_stage: '',
    active_generation_id: '',
    error: '',
    error_code: '',
    retryable: false,
  });
  return { blueprint, input_fingerprint: inputFingerprint, artifact_id: artifact.id, source: 'artifact' };
}

async function generateBlueprintStage(taskId, options = {}, {
  versionedBlueprint,
  generateBlueprintFn = generateBlueprint,
} = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  if (typeof versionedBlueprint !== 'function') throw new Error('剧本版本服务未初始化');
  const generationId = cleanText(options.generationId || options.generation_id || task.active_generation_id || '', 100);
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  const assetPlan = assetPlanPublication.currentPlan(taskId) || {};
  const inputFingerprint = cleanText(
    options.inputFingerprint || options.input_fingerprint
      || blueprintInputFingerprint(task, { ...ctx, asset_plan_fingerprint: assetPlan.fingerprint || '' }),
    200,
  );
  const previous = storage.getOutput(taskId, 'blueprint') || {};
  const previousMeta = storage.getOutput(taskId, 'blueprint_meta') || {};
  const forceRegenerate = options.force_regenerate === true || options.forceRegenerate === true;
  if (!forceRegenerate && previousMeta.input_fingerprint === inputFingerprint && Array.isArray(previous.beats) && previous.beats.length) {
    const reused = publishReusedBlueprint(taskId, task, previous, inputFingerprint);
    blueprintProgress.update(taskId, {
      phase: 'fingerprint_reused',
      completed: blueprintProgress.BLUEPRINT_PROGRESS_TOTAL,
      total: blueprintProgress.BLUEPRINT_PROGRESS_TOTAL,
      message: '输入指纹一致，已复用完整剧情蓝图。',
    }, { generationId });
    return reused;
  }
  if (!forceRegenerate) {
    const artifact = findReusableBlueprintArtifact(taskId, task, {
      ...ctx,
      asset_plan_fingerprint: assetPlan.fingerprint || '',
    }, inputFingerprint);
    if (artifact) {
      const reused = publishReusedBlueprint(taskId, task, artifact.payload, inputFingerprint, { artifact_id: artifact.id });
      blueprintProgress.update(taskId, {
        phase: 'artifact_recovered',
        completed: blueprintProgress.BLUEPRINT_PROGRESS_TOTAL,
        total: blueprintProgress.BLUEPRINT_PROGRESS_TOTAL,
        message: '已恢复语义一致的历史剧情蓝图，本次没有再次调用模型。',
      }, { generationId });
      storage.updateTask(taskId, { status: 'running', stage: 'blueprint_done' });
      return reused;
    }
  }
  storage.updateTask(taskId, { status: 'running', stage: 'blueprint' });
  storage.saveStage(taskId, 'blueprint', { status: 'running', input_summary: ctx.brief });
  blueprintProgress.update(taskId, {
    phase: 'context_ready', completed: 1, total: blueprintProgress.BLUEPRINT_PROGRESS_TOTAL,
    message: '上下文和原创过审规则已准备，正在生成剧本初稿。',
  }, { generationId });
  if (forceRegenerate) storage.deleteOutput(taskId, 'blueprint_draft_checkpoint');
  const storedCheckpoint = storage.getOutput(taskId, 'blueprint_draft_checkpoint');
  const draftCheckpoint = checkpointMatches(storedCheckpoint, task, inputFingerprint) ? storedCheckpoint : null;
  if (storedCheckpoint && !draftCheckpoint) storage.deleteOutput(taskId, 'blueprint_draft_checkpoint');
  let generated;
  try {
    generated = await generateBlueprintFn(ctx, {
      taskId,
      draftCheckpoint,
      onDraftReady: async draft => storage.saveOutput(taskId, 'blueprint_draft_checkpoint', {
        reusable: true,
        content_revision: Number(task.content_revision || 0),
        input_fingerprint: inputFingerprint,
        snapshot_id: cleanText(task.current_snapshot_id || '', 120),
        payload: draft.payload,
        model_meta: draft.model_meta || {},
        language_repaired: draft.language_repaired === true,
        language_model: cleanText(draft.language_model || '', 200),
        expected_beat_count: Number(draft.expected_beat_count || 0),
        actual_beat_count: Number(draft.actual_beat_count || 0),
        created_at: new Date().toISOString(),
      }),
      onProgress: progress => blueprintProgress.update(taskId, progress, { generationId }),
    });
  } catch (error) {
    storage.saveOutput(taskId, 'blueprint_rejection_diagnostic', {
      reusable: false,
      code: cleanText(error.code || 'BLUEPRINT_GENERATION_FAILED', 100),
      message: cleanText(error.message || '', 1200),
      quality_diagnostics: error.quality_diagnostics || null,
      structure_diagnostics: error.details || null,
      rejected_blueprint: error.rejected_blueprint || null,
      draft_checkpoint_reusable: !!storage.getOutput(taskId, 'blueprint_draft_checkpoint'),
      created_at: new Date().toISOString(),
    });
    throw error;
  }
  const blueprint = versionedBlueprint(contentDomainArtifacts.tagBlueprint(ctx, generated), previous);
  if (!Array.isArray(blueprint.beats) || !blueprint.beats.length) {
    const error = new Error('剧本模型没有返回可用镜头，本次结果未保存；请重新生成剧本');
    error.code = 'BLUEPRINT_OUTPUT_EMPTY';
    error.retryable = true;
    throw error;
  }
  if (forceRegenerate && Array.isArray(previous.beats) && previous.beats.length) {
    revisionService.invalidateOutputs(storage, taskId, ['blueprint']);
  }
  storage.saveOutput(taskId, 'blueprint', blueprint, { input_fingerprint: inputFingerprint });
  storage.saveOutput(taskId, 'blueprint_meta', {
    input_fingerprint: inputFingerprint,
    content_revision: Number(task.content_revision || 1),
    cache_hit: false,
    completed_at: new Date().toISOString(),
  });
  storage.deleteOutput(taskId, 'blueprint_draft_checkpoint');
  storage.deleteOutput(taskId, 'blueprint_rejection_diagnostic');
  storage.saveStage(taskId, 'blueprint', { status: 'done', output_summary: `${blueprint.beats.length} 个剧情 beat`, diagnostics: blueprint.model_meta || {} });
  const finalProgress = blueprintProgress.update(taskId, {
    phase: 'persisted', completed: blueprintProgress.BLUEPRINT_PROGRESS_TOTAL, total: blueprintProgress.BLUEPRINT_PROGRESS_TOTAL,
    message: '最终剧本已通过检查并保存。',
  }, { generationId });
  storage.updateTask(taskId, {
    status: 'running', stage: 'blueprint_done',
    ...(finalProgress ? { generation_progress: finalProgress } : {}),
  });
  return blueprint;
}

module.exports = {
  generateBlueprintStage,
  checkpointMatches,
  blueprintInputFingerprint,
  findReusableBlueprintArtifact,
  publishReusedBlueprint,
  recoverBlueprintWithoutProvider,
};
