/** 建立仅限浏览器内存的新来源占位，立即撤下旧的完成卡片。 */
export function beginReferenceReplacement(state, set, stopPolling, options = {}) {
  const {
    filename = '新参考视频',
    status = 'importing',
    phase = '正在创建新的读取任务',
  } = options;
  stopPolling();
  const token = ++state.referenceReplacementSeq;
  const previousReference = state.bundle?.reference ? { ...state.bundle.reference } : null;
  set({
    bundle: state.bundle ? {
      ...state.bundle,
      reference: {
        analysis_id: `client_pending_reference_${token}`,
        status,
        progress: 1,
        phase,
        filename,
        started_at: new Date().toISOString(),
        client_pending: true,
        error: '',
      },
    } : state.bundle,
  });
  return { token, previousReference };
}

export function replacementCurrent(state, replacement) {
  return replacement?.token === state.referenceReplacementSeq;
}

/** 仅当前请求失败时恢复旧来源；迟到请求不得覆盖后续更换。 */
export function restoreReferenceReplacement(state, set, replacement) {
  if (!replacementCurrent(state, replacement) || !state.bundle) return;
  set({
    bundle: {
      ...state.bundle,
      reference: replacement.previousReference || {},
    },
  });
}

/** 解除当前项目参考绑定，并立即让迟到的替换或轮询响应失效。 */
export async function removeProjectReference({ state, set, request, stopPolling, applyMutationResult } = {}) {
  const taskId = state.bundle?.project?.id || '';
  if (!taskId) throw new Error('当前项目尚未建立，不能移除参考视频。');
  state.referenceReplacementSeq += 1;
  stopPolling();
  set({ saving: true, error: '' });
  try {
    const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/reference-video`, {
      method: 'DELETE',
      // JSON fallback projects can take longer than the generic 30-second
      // request window while invalidated outputs and the new snapshot are
      // persisted. Keep this destructive mutation attached to its real result
      // so the client never reports failure after the server has committed it.
      timeoutMs: 120000,
      body: {
        base_content_revision: state.bundle?.revisions?.content || 1,
        client_edit_seq: (state.bundle?.revisions?.client_edit_seq || 0) + 1,
      },
    });
    const next = applyMutationResult(data) || state.bundle;
    set({ bundle: next ? { ...next, reference: {} } : next, saving: false });
    return data;
  } catch (error) {
    set({ saving: false, error: error.message });
    throw error;
  }
}
