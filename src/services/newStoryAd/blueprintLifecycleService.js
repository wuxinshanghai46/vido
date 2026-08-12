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
    version: 1,
    content_revision: Math.max(1, Number(task.content_revision || 1) || 1),
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
    storage.saveStage(taskId, 'blueprint', {
      status: 'done',
      output_summary: `${previous.beats.length} 个剧情 beat（输入未变化，已复用）`,
      diagnostics: { input_fingerprint: inputFingerprint, cache_hit: true },
    });
    blueprintProgress.update(taskId, {
      phase: 'fingerprint_reused',
      completed: blueprintProgress.BLUEPRINT_PROGRESS_TOTAL,
      total: blueprintProgress.BLUEPRINT_PROGRESS_TOTAL,
      message: '输入指纹一致，已复用完整剧情蓝图。',
    }, { generationId });
    return previous;
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
  storage.saveOutput(taskId, 'blueprint', blueprint);
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

module.exports = { generateBlueprintStage, checkpointMatches, blueprintInputFingerprint };
