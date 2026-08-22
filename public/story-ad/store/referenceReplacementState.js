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

export function referenceSyncInterrupted(reference = {}, error = null, interruptedAt = '') {
  return {
    ...reference,
    status: 'sync_interrupted',
    last_known_status: reference.last_known_status || reference.status || '',
    sync_interrupted: true,
    sync_interrupted_at: interruptedAt,
    updated_at: interruptedAt,
    phase: '状态同步暂时中断，正在自动重连',
    error: error?.message || String(error || ''),
  };
}

/** 重新识别点击后立即显示受理态，不等待网络或同步存储响应。 */
export function beginReferenceRetry(state, set) {
  const previousReference = state.bundle?.reference ? { ...state.bundle.reference } : null;
  const requestedAt = new Date().toISOString();
  set({
    saving: true,
    error: '',
    bundle: state.bundle ? {
      ...state.bundle,
      reference: {
        ...(state.bundle.reference || {}),
        status: 'queued',
        progress: 1,
        phase: '重新识别请求已提交，正在等待服务器受理',
        started_at: requestedAt,
        updated_at: requestedAt,
        completed_at: '',
        failed_at: '',
        cancelled_at: '',
        error: '',
        sync_interrupted: false,
        sync_interrupted_at: '',
        last_known_status: '',
      },
    } : state.bundle,
  });
  return previousReference;
}

export function restoreReferenceRetry(state, set, previousReference, error) {
  set({
    saving: false,
    error: error?.message || String(error || ''),
    bundle: state.bundle && previousReference ? {
      ...state.bundle,
      reference: previousReference,
    } : state.bundle,
  });
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
  const previousReference = state.bundle?.reference || {};
  const previousBriefIntake = state.bundle?.brief?.brief_intake || {};
  state.referenceReplacementSeq += 1;
  stopPolling();
  set({
    saving: true,
    error: '',
    bundle: state.bundle ? {
      ...state.bundle,
      reference: {},
      brief: {
        ...(state.bundle.brief || {}),
        brief_intake: {
          ...previousBriefIntake,
          reference_decision: 'skipped',
          active_dialogue_topic: '',
        },
      },
    } : state.bundle,
  });
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
    set({
      saving: false,
      error: error.message,
      bundle: state.bundle ? {
        ...state.bundle,
        reference: previousReference,
        brief: { ...(state.bundle.brief || {}), brief_intake: previousBriefIntake },
      } : state.bundle,
    });
    throw error;
  }
}
