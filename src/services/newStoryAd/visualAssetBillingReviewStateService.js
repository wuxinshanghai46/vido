const crypto = require('crypto');

const STATES = Object.freeze({
  PENDING: 'pending',
  NOT_BILLED: 'not_billed',
  UNVERIFIABLE: 'unverifiable',
  COMPLETED: 'completed',
});

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }

function reviewState(checkpoint = {}) {
  const explicit = clean(checkpoint.billing_review?.state, 40).toLowerCase();
  if (Object.values(STATES).includes(explicit)) return explicit;
  if (checkpoint.status === 'completed' && checkpoint.result) return STATES.COMPLETED;
  if (checkpoint.billing_state === 'not_billed') return STATES.NOT_BILLED;
  return STATES.PENDING;
}

function reviewRevision(checkpoint = {}) {
  return Math.max(1, Number(checkpoint.billing_review?.revision || 1) || 1);
}

function resolve(checkpoint = {}, resolution = {}, options = {}) {
  const currentRevision = reviewRevision(checkpoint);
  const expectedRevision = Math.max(0, Number(resolution.expected_revision || resolution.expectedRevision || 0) || 0);
  if (expectedRevision && expectedRevision !== currentRevision) {
    const error = new Error(`计费核对已更新为版本 ${currentRevision}，请刷新后重试。`);
    error.code = 'VISUAL_ASSET_BILLING_REVIEW_REVISION_CONFLICT'; error.status = 409; throw error;
  }
  const state = clean(resolution.state, 40).toLowerCase();
  if (![STATES.NOT_BILLED, STATES.UNVERIFIABLE, STATES.COMPLETED].includes(state)) {
    const error = new Error('核账结论必须是 not_billed、unverifiable 或 completed。');
    error.code = 'VISUAL_ASSET_BILLING_REVIEW_RESOLUTION_INVALID'; error.status = 422; throw error;
  }
  const currentState = reviewState(checkpoint);
  if (state === currentState) return checkpoint;
  const allowed = currentState === STATES.PENDING
    || (currentState === STATES.UNVERIFIABLE && [STATES.NOT_BILLED, STATES.COMPLETED].includes(state));
  if (!allowed) {
    const error = new Error(`计费核对不能从 ${currentState} 改为 ${state}。`);
    error.code = 'VISUAL_ASSET_BILLING_REVIEW_INVALID_TRANSITION'; error.status = 409; throw error;
  }
  const evidence = clean(resolution.evidence, 1000);
  const reviewer = clean(resolution.reviewer, 120);
  if (!evidence || !reviewer) {
    const error = new Error('受控核账必须记录核对人和证据。');
    error.code = 'VISUAL_ASSET_BILLING_REVIEW_EVIDENCE_REQUIRED'; error.status = 422; throw error;
  }
  if (state === STATES.COMPLETED && !(checkpoint.result || checkpoint.provider_result)) {
    const error = new Error('供应商结果尚未回收，不能把该单元标记为已完成。');
    error.code = 'VISUAL_ASSET_BILLING_REVIEW_RESULT_REQUIRED'; error.status = 409; throw error;
  }
  const at = clean(options.at || new Date().toISOString(), 40);
  const billingReview = {
    id: clean(checkpoint.billing_review?.id || crypto.randomUUID(), 120),
    state,
    revision: currentRevision + 1,
    reviewer,
    evidence,
    resolved_at: at,
  };
  if (state === STATES.NOT_BILLED) return {
    ...checkpoint, status: 'failed', provider_submission_state: 'not_submitted', billing_state: 'not_billed',
    retry_authorization: null, billing_review: billingReview, updated_at: at,
  };
  if (state === STATES.COMPLETED) return {
    ...checkpoint, status: 'completed', provider_submission_state: 'completed', billing_state: 'confirmed',
    result: checkpoint.result || checkpoint.provider_result, retry_authorization: null, billing_review: billingReview, updated_at: at,
  };
  return { ...checkpoint, billing_review: billingReview, updated_at: at };
}

function publicState(checkpoint = {}) {
  return { state: reviewState(checkpoint), revision: reviewRevision(checkpoint) };
}

module.exports = { STATES, publicState, resolve, reviewRevision, reviewState };
