const { AsyncLocalStorage } = require('async_hooks');

const context = new AsyncLocalStorage();
const cancelled = new Map();
const active = new Map();

function cancelledError(meta = {}) {
  const deadline = meta.cancelReason === 'deadline';
  const error = new Error(deadline ? '本批次已达到安全执行时限，已保存完成结果；可以继续补齐未完成镜头' : '用户已取消当前生成');
  error.code = deadline ? 'STAGE_DEADLINE_EXCEEDED' : 'USER_CANCELLED';
  error.retryable = true;
  error.cancelled = true;
  error.generation_id = meta.generationId || '';
  error.task_id = meta.taskId || '';
  return error;
}

function run(meta = {}, fn) {
  const controller = new AbortController();
  const normalized = {
    generationId: String(meta.generationId || ''),
    taskId: String(meta.taskId || ''),
    stage: String(meta.stage || ''),
    ownerId: String(meta.ownerId || ''),
    controller,
    signal: controller.signal,
    cancelReason: '',
    deadlineMs: Math.max(0, Number(meta.deadlineMs || 0) || 0),
  };
  if (normalized.generationId) active.set(normalized.generationId, normalized);
  return context.run(normalized, async () => {
    let timer = null;
    let rejectAbort = null;
    const abortPromise = new Promise((resolve, reject) => {
      rejectAbort = reject;
    });
    if (normalized.deadlineMs > 0) {
      timer = setTimeout(() => {
        normalized.cancelReason = 'deadline';
        cancelled.set(normalized.generationId, { ...normalized, controller: undefined, signal: undefined, cancelledAt: new Date().toISOString(), reason: 'deadline' });
        const error = cancelledError(normalized);
        controller.abort(error);
        rejectAbort(error);
      }, normalized.deadlineMs);
      timer.unref?.();
    }
    try {
      // Some provider SDKs do not honour AbortSignal. Racing the work against
      // the deadline guarantees that the persisted job reaches a terminal
      // state instead of leaving the browser polling indefinitely. Any late
      // write is still rejected by storageService.throwIfCancelled().
      const workPromise = Promise.resolve().then(fn);
      workPromise.catch(() => {});
      return await Promise.race([workPromise, abortPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      if (normalized.generationId) active.delete(normalized.generationId);
    }
  });
}

function cancel(generationId, details = {}) {
  const id = String(generationId || '');
  if (!id) return false;
  cancelled.set(id, { ...details, cancelledAt: new Date().toISOString() });
  const meta = active.get(id);
  if (meta?.controller && !meta.signal?.aborted) {
    meta.cancelReason = details.reason || 'user';
    meta.controller.abort(cancelledError(meta));
  }
  return true;
}

function current() { return context.getStore() || null; }
function signal() { return current()?.signal || null; }
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
  if (isCancelled(meta.generationId) || meta.signal?.aborted) throw cancelledError(meta);
}

function forget(generationId) { cancelled.delete(String(generationId || '')); }

module.exports = { activeGeneration, cancel, cancelActive, cancelledError, current, signal, forget, isCancelled, run, throwIfCancelled };
