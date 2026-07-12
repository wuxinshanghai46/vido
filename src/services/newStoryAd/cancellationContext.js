const { AsyncLocalStorage } = require('async_hooks');

const context = new AsyncLocalStorage();
const cancelled = new Map();
const active = new Map();

function cancelledError(meta = {}) {
  const error = new Error('用户已取消当前生成');
  error.code = 'USER_CANCELLED';
  error.retryable = true;
  error.cancelled = true;
  error.generation_id = meta.generationId || '';
  error.task_id = meta.taskId || '';
  return error;
}

function run(meta = {}, fn) {
  const normalized = {
    generationId: String(meta.generationId || ''),
    taskId: String(meta.taskId || ''),
    stage: String(meta.stage || ''),
    ownerId: String(meta.ownerId || ''),
  };
  if (normalized.generationId) active.set(normalized.generationId, normalized);
  return context.run(normalized, async () => {
    try {
      return await fn();
    } finally {
      if (normalized.generationId) active.delete(normalized.generationId);
    }
  });
}

function cancel(generationId, details = {}) {
  const id = String(generationId || '');
  if (!id) return false;
  cancelled.set(id, { ...details, cancelledAt: new Date().toISOString() });
  return true;
}

function current() { return context.getStore() || null; }
function activeGeneration(generationId) { return active.get(String(generationId || '')) || null; }
function isCancelled(generationId = current()?.generationId) { return !!generationId && cancelled.has(String(generationId)); }

function cancelActive(generationId, { ownerId = '', cancelledBy = '' } = {}) {
  const meta = activeGeneration(generationId);
  if (!meta) return { cancelled: false, not_running: true };
  if (meta.ownerId && ownerId && String(meta.ownerId) !== String(ownerId)) return { cancelled: false, forbidden: true };
  cancel(generationId, { ...meta, cancelledBy });
  return { cancelled: true, stage: meta.stage, generation_id: meta.generationId };
}

function throwIfCancelled(taskId = '') {
  const meta = current();
  if (!meta?.generationId) return;
  if (taskId && meta.taskId && String(taskId) !== String(meta.taskId)) return;
  if (isCancelled(meta.generationId)) throw cancelledError(meta);
}

function forget(generationId) { cancelled.delete(String(generationId || '')); }

module.exports = { activeGeneration, cancel, cancelActive, cancelledError, current, forget, isCancelled, run, throwIfCancelled };
