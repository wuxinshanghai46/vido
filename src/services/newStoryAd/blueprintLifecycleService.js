const storage = require('./storageService');
const { assertContextConsistent, cleanText } = require('./contextBuilder');
const { generateBlueprint } = require('./blueprintService');
const blueprintProgress = require('./blueprintProgressService');

function checkpointMatches(checkpoint, task, inputFingerprint) {
  if (!checkpoint || checkpoint.reusable !== true || !checkpoint.payload) return false;
  if (Number(checkpoint.content_revision || 0) !== Number(task.content_revision || 0)) return false;
  const expectedFingerprint = cleanText(inputFingerprint || task.active_input_fingerprint || '', 200);
  return !!expectedFingerprint && checkpoint.input_fingerprint === expectedFingerprint;
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
  storage.updateTask(taskId, { status: 'running', stage: 'blueprint' });
  storage.saveStage(taskId, 'blueprint', { status: 'running', input_summary: ctx.brief });
  blueprintProgress.update(taskId, {
    phase: 'context_ready', completed: 1, total: blueprintProgress.BLUEPRINT_PROGRESS_TOTAL,
    message: '上下文和原创过审规则已准备，正在生成剧本初稿。',
  }, { generationId });
  const previous = storage.getOutput(taskId, 'blueprint') || {};
  const inputFingerprint = cleanText(options.inputFingerprint || options.input_fingerprint || task.active_input_fingerprint || '', 200);
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
  const blueprint = versionedBlueprint(generated, previous);
  if (!Array.isArray(blueprint.beats) || !blueprint.beats.length) {
    const error = new Error('剧本模型没有返回可用镜头，本次结果未保存；请重新生成剧本');
    error.code = 'BLUEPRINT_OUTPUT_EMPTY';
    error.retryable = true;
    throw error;
  }
  storage.saveOutput(taskId, 'blueprint', blueprint);
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

module.exports = { generateBlueprintStage, checkpointMatches };
