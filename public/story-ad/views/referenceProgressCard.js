function statusState(reference = {}) {
  const status = String(reference.status || '').toLowerCase();
  const failed = status === 'failed';
  const cancelled = status === 'cancelled';
  const completedInvalid = status === 'completed' && reference.analysis_valid !== true;
  const errorCode = String(reference.error_code || reference.error?.code || '');
  const extendedConfirmation = failed
    && errorCode === 'REFERENCE_VIDEO_EXTENDED_ANALYSIS_CONFIRMATION_REQUIRED';
  const preflight = reference.analysis_preflight && typeof reference.analysis_preflight === 'object'
    ? reference.analysis_preflight : {};
  const batchProgress = reference.evidence_batch_progress && typeof reference.evidence_batch_progress === 'object'
    ? reference.evidence_batch_progress : {};
  const batchTotal = Math.max(0, Number(batchProgress.total || 0) || 0);
  const batchCompleted = Math.max(0, Math.min(batchTotal, Number(batchProgress.completed || 0) || 0));
  const completeEvidence = batchTotal > 0 && batchCompleted === batchTotal;
  const importFailure = (failed || cancelled)
    && reference.source?.input_type === 'url'
    && !reference.source?.read_method
    && !completeEvidence;
  const canReuseEvidence = reference.visual_evidence_reusable === true || completeEvidence;
  const retryLabel = extendedConfirmation
    ? `确认分批分析（${Number(preflight.batch_count || 0)} 批）`
    : (importFailure
      ? '重新读取链接'
      : (reference.semantic_result_reusable === true
        ? '复用已保留结果重新校验'
        : (canReuseEvidence
          ? '重新整理内容'
          : (completedInvalid || cancelled
            ? '重新识别当前视频'
            : (batchCompleted > 0 && batchCompleted < batchTotal
              ? `继续读取缺失镜头（${batchCompleted}/${batchTotal} 批）`
              : '重新读取镜头证据')))));
  return { recovery: failed || cancelled || completedInvalid, retryLabel };
}

export function referenceProgress(reference = {}) {
  if (!reference.analysis_id || reference.client_pending === true) return '';
  const state = statusState(reference);
  // 对话气泡是阶段、百分比和失败说明的唯一展示位置。此挂载点只保留
  // 必需的用户决策按钮，避免同一进度在文本和大卡片中重复出现。
  if (!state.recovery) return '';
  return `<div class="reference-recovery-actions" aria-label="参考视频恢复操作">
    <button class="btn" type="button" data-reference-abandon>跳过这个参考</button>
    <button class="btn" type="button" data-reference-retry>${state.retryLabel}</button>
  </div>`;
}

export const _private = { statusState };
