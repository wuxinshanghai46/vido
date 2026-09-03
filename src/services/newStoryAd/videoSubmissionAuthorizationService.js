'use strict';

const { fingerprint } = require('../videoGenerationCore/domainContract');

// The click authorizes this exact server-compiled scope. Price metadata is an
// estimate for accounting, never proof of model capability or a user cost cap.
function submissionFingerprint(plan = {}) {
  return fingerprint({
    task_id: plan.task_id, mode: plan.mode, provider_route: plan.provider_route,
    execution_plan: plan.execution_plan?.fingerprint,
    scope: plan.scope, expected_lineages: plan.expected_lineages,
    shots: plan.shots, units: plan.units,
  });
}

function authorize(plan = {}, options = {}) {
  const current = submissionFingerprint(plan);
  if (options._videoSubmissionFingerprint && options._videoSubmissionFingerprint !== current) {
    throw Object.assign(new Error('视频输入或模型在提交后发生变化，本次没有调用视频模型。'), {
      code: 'VIDEO_SUBMISSION_CHANGED', status: 409, retryable: false,
    });
  }
  const cost = plan.cost_plan || {};
  return {
    authorized: true, zero_cost: Number(plan.paid_unit_count || 0) === 0,
    authorization_type: 'selected_model_generate_click',
    submission_fingerprint: current,
    fingerprint: cost.fingerprint || '',
    price_known: cost.price_known === true,
    estimated_cost_rmb: cost.price_known === true ? cost.estimated_cost_rmb : null,
    maximum_cost_rmb: cost.price_known === true ? cost.maximum_cost_rmb : null,
    confirmed_cost_limit_rmb: null,
    provider_route: plan.provider_route, scope: plan.scope,
    automatic_paid_retry_count: 0,
  };
}

function failureResponse(payload, canViewErrors) {
  if (canViewErrors) return payload;
  return {
    success: false, code: 'VIDEO_GENERATION_FAILED', error: '视频生成失败。',
    request_id: payload.request_id, retryable: false,
    active_generation_id: payload.active_generation_id,
  };
}

module.exports = { authorize, submissionFingerprint, failureResponse };
