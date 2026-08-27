const { cleanText } = require('./contextBuilder');

function project(error = null) {
  const uncertain = Array.isArray(error?.attempts)
    ? error.attempts.find(item => item?.billing_state === 'unknown'
      || item?.provider_submission_state === 'submitted_unknown'
      || item?.code === 'PROVIDER_5XX_AMBIGUOUS')
    : null;
  const source = uncertain || error || {};
  const [routeProvider = '', routeModel = ''] = String(source.model || '').split('/', 2);
  return {
    error_code: cleanText(error?.code || source.code || '', 120),
    provider_id: cleanText(error?.providerId || error?.provider_id || source.provider_id || routeProvider, 120),
    model_id: cleanText(error?.modelId || error?.model_id || source.model_id || routeModel, 160),
    http_status: cleanText(error?.providerStatus || error?.provider_status || source.provider_status || '', 60),
    provider_reason: cleanText(error?.providerReason || error?.provider_reason || source.provider_reason || '', 240),
    provider_error_code: cleanText(error?.providerErrorCode || error?.provider_error_code || source.provider_error_code || '', 120),
    platform_request_id: cleanText(error?.platformRequestId || error?.platform_request_id || error?.submissionId || error?.submission_id || source.submission_id || '', 120),
    provider_request_id: cleanText(error?.providerRequestId || error?.provider_request_id || source.provider_request_id || '', 180),
    provider_task_id: cleanText(error?.providerTaskId || error?.provider_task_id || source.provider_task_id || '', 180),
    provider_submission_state: cleanText(error?.providerSubmissionState || error?.provider_submission_state || source.provider_submission_state || '', 60),
    billing_state: cleanText(error?.billingState || error?.billing_state || source.billing_state || '', 60),
  };
}

module.exports = { project };
