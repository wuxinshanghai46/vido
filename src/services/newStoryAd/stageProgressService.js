const storage = require('./storageService');
const { cleanText } = require('./contextBuilder');

/** 将场景、分镜和合成阶段的真实里程碑统一写入任务，供前端轮询展示。 */
function update(taskId, {
  stage = '', status = 'running', phase = 'preparing', completed = 0, total = 1,
  processed, currentIndex, percent, generationId = '', startedAt = '', message = '',
} = {}) {
  const previous = storage.getTask(taskId)?.generation_progress || {};
  const safeGenerationId = cleanText(generationId, 80);
  const sameGeneration = Boolean(safeGenerationId && previous.generation_id === safeGenerationId);
  const terminal = ['done', 'completed', 'succeeded', 'failed', 'blocked', 'cancelled', 'interrupted'].includes(String(status || '').toLowerCase());
  const safeTotal = Math.max(1, Number(total) || 1);
  const safeCompleted = Math.max(0, Math.min(safeTotal, Number(completed) || 0));
  const next = {
    stage: cleanText(stage, 80), status: cleanText(status, 40), phase: cleanText(phase, 80),
    completed: safeCompleted, total: safeTotal,
    percent: Math.max(0, Math.min(100, Number.isFinite(Number(percent)) ? Number(percent) : Math.round((safeCompleted / safeTotal) * 100))),
    generation_id: safeGenerationId,
    started_at: startedAt || (sameGeneration ? previous.started_at : '') || new Date().toISOString(),
    message: cleanText(message, 300), updated_at: new Date().toISOString(),
  };
  if (terminal) next.finished_at = new Date().toISOString();
  if (processed !== undefined) next.processed = Math.max(0, Math.min(safeTotal, Number(processed) || 0));
  if (currentIndex !== undefined) next.current_index = Math.max(1, Math.min(safeTotal, Number(currentIndex) || 1));
  storage.updateTask(taskId, { generation_progress: next });
  return next;
}

module.exports = { update };
