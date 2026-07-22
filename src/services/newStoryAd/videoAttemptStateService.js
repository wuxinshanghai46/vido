function queuedProviderState(previous = {}, resumeProviderTaskId = '') {
  const resumed = !!String(resumeProviderTaskId || '').trim();
  return {
    provider_request_id: resumed ? (previous.provider_request_id || '') : '',
    provider_submission_state: resumed ? (previous.provider_submission_state || 'submitted') : 'not_submitted',
    billing_state: resumed ? (previous.billing_state || 'unknown') : 'not_submitted',
    provider_submitted_at: resumed ? (previous.provider_submitted_at || '') : '',
    provider_started_at: resumed ? (previous.provider_started_at || '') : '',
    last_polled_at: resumed ? (previous.last_polled_at || '') : '',
    requested_video_seconds: resumed ? Number(previous.requested_video_seconds || 0) : 0,
  };
}

module.exports = { queuedProviderState };
