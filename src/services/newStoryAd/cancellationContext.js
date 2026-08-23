const { AsyncLocalStorage } = require('async_hooks');

const context = new AsyncLocalStorage();
const cancelled = new Map();
const active = new Map();

function cancelledError(meta = {}) {
  const deadline = meta.cancelReason === 'deadline';
  const deadlineMessages = {
    blueprint: '剧本生成超过安全执行时限，本次没有产生可用剧本；请重新生成剧本',
    scene_config: '场景配置生成超过安全执行时限，本次没有产生可用配置；请重新生成场景配置',
    storyboard: '分镜生成超过安全执行时限，已保存可恢复进度；请继续生成未完成分镜',
  };
  const error = new Error(deadline
    ? (deadlineMessages[meta.stage] || '本批次已达到安全执行时限，已保存完成结果；可以继续补齐未完成镜头')
    : '用户已取消当前生成');
  error.code = deadline ? 'STAGE_DEADLINE_EXCEEDED' : 'USER_CANCELLED';
  error.status = deadline ? 504 : 409;
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
    snapshotId: String(meta.snapshotId || meta.snapshot_id || ''),
    expectedContentRevision: Math.max(0, Number(meta.expectedContentRevision || meta.expected_content_revision || 0) || 0),
    inputFingerprint: String(meta.inputFingerprint || meta.input_fingerprint || ''),
    authorityId: String(meta.authorityId || meta.authority_id || ''),
    authorityToken: String(meta.authorityToken || meta.authority_token || ''),
    executionIdentity: String(meta.executionIdentity || meta.execution_identity || ''),
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
    const onAbort = () => {
      rejectAbort(normalized.signal.reason instanceof Error
        ? normalized.signal.reason
        : cancelledError(normalized));
    };
    normalized.signal.addEventListener('abort', onAbort, { once: true });
    if (normalized.deadlineMs > 0) {
      timer = setTimeout(() => {
        normalized.cancelReason = 'deadline';
        cancelled.set(normalized.generationId, { ...normalized, controller: undefined, signal: undefined, cancelledAt: new Date().toISOString(), reason: 'deadline' });
        const error = cancelledError(normalized);
        controller.abort(error);
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
      normalized.signal.removeEventListener('abort', onAbort);
      if (normalized.generationId) active.delete(normalized.generationId);
    }
  });
}

function cancel(generationId, details = {}) {
  const id = String(generationId || '');
  if (!id) return false;
  cancelled.set(id, { ...details, cancelledAt: new Date().toISOString() });
  setTimeout(() => cancelled.delete(id), 60 * 60 * 1000).unref?.();
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
  return { cancelled: true, task_id: meta.taskId || '', stage: meta.stage, generation_id: meta.generationId };
}

function throwIfCancelled(taskId = '') {
  const meta = current();
  if (!meta?.generationId) return;
  if (taskId && meta.taskId && String(taskId) !== String(meta.taskId)) return;
  if (isCancelled(meta.generationId) || meta.signal?.aborted) throw cancelledError(meta);
}

function forget(generationId) { cancelled.delete(String(generationId || '')); }

module.exports = { activeGeneration, cancel, cancelActive, cancelledError, current, signal, forget, isCancelled, run, throwIfCancelled };
