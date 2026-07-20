const storage = require('./storageService');
const { cleanText } = require('./contextBuilder');

const BLUEPRINT_PROGRESS_TOTAL = 6;

function update(taskId, progress = {}, { generationId = '' } = {}) {
  const task = storage.getTask(taskId);
  if (!task) return null;
  const activeId = String(task.active_generation_id || '');
  const expectedId = String(generationId || activeId || task.generation_progress?.generation_id || '');
  if (generationId && activeId !== String(generationId)) return null;
  if (task.active_stage && task.active_stage !== 'blueprint') return null;
  const total = Math.max(1, Number(progress.total || BLUEPRINT_PROGRESS_TOTAL) || BLUEPRINT_PROGRESS_TOTAL);
  const completed = Math.max(0, Math.min(total, Number(progress.completed) || 0));
  const now = new Date().toISOString();
  const next = {
    stage: 'blueprint',
    status: completed >= total ? 'completed' : 'running',
    generation_id: expectedId,
    phase: cleanText(progress.phase || 'preparing', 80),
    completed,
    total,
    percent: Math.round((completed / total) * 100),
    message: cleanText(progress.message || '正在生成剧本。', 300),
    started_at: task.generation_started_at || task.generation_queued_at || task.generation_progress?.started_at || now,
    updated_at: now,
    ...(completed >= total ? { finished_at: now } : {}),
  };
  storage.updateTask(taskId, { generation_progress: next });
  return next;
}

module.exports = { BLUEPRINT_PROGRESS_TOTAL, update };
