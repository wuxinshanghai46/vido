const storage = require('./storageService');
const { assertContextConsistent, cleanText } = require('./contextBuilder');
const { generateBlueprint } = require('./blueprintService');
const blueprintProgress = require('./blueprintProgressService');

async function generateBlueprintStage(taskId, options = {}, { versionedBlueprint } = {}) {
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
  let generated;
  try {
    generated = await generateBlueprint(ctx, {
      taskId,
      onProgress: progress => blueprintProgress.update(taskId, progress, { generationId }),
    });
  } catch (error) {
    if (error?.quality_diagnostics || error?.rejected_blueprint || error?.details) {
      storage.saveOutput(taskId, 'blueprint_rejection_diagnostic', {
        reusable: false,
        code: cleanText(error.code || 'BLUEPRINT_GENERATION_FAILED', 100),
        message: cleanText(error.message || '', 1200),
        quality_diagnostics: error.quality_diagnostics || null,
        structure_diagnostics: error.details || null,
        rejected_blueprint: error.rejected_blueprint || null,
        created_at: new Date().toISOString(),
      });
    }
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

module.exports = { generateBlueprintStage };
