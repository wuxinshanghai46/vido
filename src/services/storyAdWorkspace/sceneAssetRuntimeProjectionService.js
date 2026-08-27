function project(asset = {}, { clean, list } = {}) {
  const viewStatuses = Object.fromEntries(Object.entries(asset.view_statuses || {}).slice(0, 8).map(([key, value = {}]) => [clean(key, 40), {
    state: clean(value.state, 40), status: clean(value.status, 40), error_code: clean(value.error_code, 120),
    billing_state: clean(value.billing_state, 40), submission_state: clean(value.submission_state, 60),
    provider_id: clean(value.provider_id, 120), model_id: clean(value.model_id, 160),
    http_status: clean(value.http_status || value.provider_status, 60),
    platform_request_id: clean(value.platform_request_id || value.submission_id, 120),
    provider_request_id: clean(value.provider_request_id, 180), provider_task_id: clean(value.provider_task_id, 180),
    message: clean(value.message, 220),
  }]));
  const repair = asset.repair_plan && typeof asset.repair_plan === 'object' ? asset.repair_plan : null;
  return {
    partial_checkpoint: asset.partial_checkpoint === true,
    checkpoint_status: clean(asset.checkpoint_status, 40),
    checkpoint_error_code: clean(asset.checkpoint_error_code, 120),
    completed_view_keys: list(asset.completed_view_keys).slice(0, 8).map(key => clean(key, 40)),
    failed_view_keys: list(asset.failed_view_keys).slice(0, 8).map(key => clean(key, 40)),
    view_statuses: viewStatuses,
    billing_review_required: asset.billing_review_required === true,
    repair_plan: repair ? {
      version: Number(repair.version || 0), action: clean(repair.action, 80),
      view_keys: list(repair.view_keys).slice(0, 8).map(key => clean(key, 40)),
      view_labels: list(repair.view_labels).slice(0, 8).map(label => clean(label, 80)),
      count: Number(repair.count || 0), provider_image_call_count: Number(repair.provider_image_call_count || 0),
      reasons: list(repair.reasons).slice(0, 6).map(reason => clean(reason, 220)),
      issue_codes: list(repair.issue_codes).slice(0, 8).map(code => clean(code, 120)),
      requires_billing_review: repair.requires_billing_review === true,
      message: clean(repair.message, 260),
    } : null,
    checkpoint_verification: asset.verification && typeof asset.verification === 'object' ? asset.verification : null,
  };
}

module.exports = { project };
