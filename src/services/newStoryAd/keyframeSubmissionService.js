const crypto = require('crypto');
const storage = require('./storageService');

const OUTPUT_KIND = 'keyframe_provider_submissions';
const UNRESOLVED_STATES = new Set(['preparing', 'submitted', 'streaming', 'result_available', 'recovering', 'billing_unknown']);

function clean(value, max = 180) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function fingerprint(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function rows(taskId) {
  const value = storage.getOutput(taskId, OUTPUT_KIND);
  return Array.isArray(value) ? value : [];
}

function saveRows(taskId, list = []) {
  const normalized = (Array.isArray(list) ? list : []).slice(-300);
  storage.saveOutput(taskId, OUTPUT_KIND, normalized);
  return normalized;
}

function update(taskId, id, patch = {}) {
  const now = new Date().toISOString();
  let found = null;
  const next = rows(taskId).map(row => {
    if (String(row.id || '') !== String(id || '')) return row;
    found = { ...row, ...patch, id: row.id, updated_at: now };
    return found;
  });
  if (!found) return null;
  saveRows(taskId, next);
  return found;
}

function unresolvedForShot(taskId, shotIndex) {
  return rows(taskId)
    .filter(row => Number(row.shot_index) === Number(shotIndex))
    .filter(row => UNRESOLVED_STATES.has(String(row.status || '')))
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
}

function legacyTimeout(frame = {}) {
  if (frame && (frame.image_url || frame.imageUrl || frame.url)) return false;
  const source = `${frame?.error_code || ''} ${frame?.error || ''} ${frame?.latest_attempt?.error_code || ''} ${frame?.latest_attempt?.error || ''}`;
  return /TIMEOUT_OR_NETWORK|DEYUNAI_GPT_IMAGE2_STREAM_TIMEOUT|timeout|timed\s*out|ECONNRESET|socket hang up/i.test(source);
}

function blockerSummary(blocker = {}) {
  return {
    shot_number: Number(blocker.shot_index) + 1,
    submission_id: clean(blocker.id, 100),
    provider_request_id: clean(blocker.provider_request_id, 160),
    provider_task_id: clean(blocker.provider_task_id, 160),
    status: clean(blocker.status || 'billing_unknown', 40),
    billing_state: clean(blocker.billing_state || 'unknown', 40),
    created_at: blocker.created_at || '',
    legacy: blocker.legacy === true,
  };
}

function acknowledge(taskId, blockers = [], actor = '') {
  const now = new Date().toISOString();
  const list = rows(taskId);
  const blockedIds = new Set(blockers.filter(item => !item.legacy).map(item => String(item.id || '')));
  const next = list.map(row => blockedIds.has(String(row.id || '')) ? {
    ...row,
    status: 'abandoned_by_user',
    billing_state: 'accepted_unknown',
    resolution: 'explicit_user_acknowledgement',
    resolved_at: now,
    resolved_by: clean(actor || 'task_owner', 100),
    updated_at: now,
  } : row);
  blockers.filter(item => item.legacy).forEach(item => next.push({
    id: `legacy_ack_${crypto.randomUUID()}`,
    task_id: clean(taskId, 100),
    shot_index: Number(item.shot_index),
    status: 'legacy_abandoned_by_user',
    billing_state: 'accepted_unknown',
    resolution: 'explicit_user_acknowledgement',
    legacy: true,
    resolved_at: now,
    resolved_by: clean(actor || 'task_owner', 100),
    created_at: now,
    updated_at: now,
  }));
  saveRows(taskId, next);
}

function preflight(taskId, shotIndexes = [], options = {}) {
  const frames = Array.isArray(options.frames) ? options.frames : [];
  const blockers = [];
  for (const shotIndex of [...new Set((shotIndexes || []).map(Number).filter(Number.isInteger))]) {
    const unresolved = unresolvedForShot(taskId, shotIndex);
    if (unresolved.length) {
      if (String(unresolved[0].status || '') === 'result_available') continue;
      blockers.push(unresolved[0]);
      continue;
    }
    const legacyAlreadyAcknowledged = rows(taskId).some(row => Number(row.shot_index) === shotIndex
      && row.legacy === true && String(row.status || '') === 'legacy_abandoned_by_user');
    if (!legacyAlreadyAcknowledged && legacyTimeout(frames[shotIndex])) {
      blockers.push({
        id: `legacy_timeout_shot_${shotIndex + 1}`,
        task_id: taskId,
        shot_index: shotIndex,
        status: 'billing_unknown',
        billing_state: 'unknown',
        legacy: true,
        created_at: frames[shotIndex]?.latest_attempt?.finished_at || frames[shotIndex]?.updated_at || '',
      });
    }
  }
  if (!blockers.length) return { allowed: true, blockers: [], acknowledged: false };
  const activeBlockers = blockers.filter(item => !item.legacy
    && ['preparing', 'submitted', 'streaming'].includes(String(item.status || '')));
  if (activeBlockers.length) {
    const error = new Error(`检测到 ${activeBlockers.length} 个仍在提交或生成中的图片请求，已阻止并发重复提交。`);
    error.code = 'KEYFRAME_SUBMISSION_ALREADY_PENDING';
    error.status = 409;
    error.retryable = false;
    error.details = { blockers: activeBlockers.map(blockerSummary) };
    throw error;
  }
  if (options.acknowledgeBillingUnknown === true) {
    acknowledge(taskId, blockers, options.acknowledgedBy);
    return { allowed: true, blockers: blockers.map(blockerSummary), acknowledged: true };
  }
  const error = new Error(`检测到 ${blockers.length} 个计费状态未知的历史图片请求。系统不会自动重复提交；如确认放弃等待旧结果并接受可能的重复计费，请在二次确认后继续。`);
  error.code = 'KEYFRAME_SUBMISSION_BILLING_UNKNOWN';
  error.status = 409;
  error.retryable = false;
  error.details = { requires_billing_acknowledgement: true, blockers: blockers.map(blockerSummary) };
  throw error;
}

function begin(taskId, options = {}) {
  const shotIndex = Number(options.shotIndex);
  const unresolved = unresolvedForShot(taskId, shotIndex);
  if (unresolved.length) {
    const error = new Error(`第 ${shotIndex + 1} 镜已有计费状态未知的图片请求，已阻止并发或重复提交。`);
    error.code = 'KEYFRAME_SUBMISSION_ALREADY_PENDING';
    error.status = 409;
    error.retryable = false;
    error.details = { blockers: unresolved.slice(0, 1).map(blockerSummary) };
    throw error;
  }
  const now = new Date().toISOString();
  const id = clean(options.id || crypto.randomUUID(), 100);
  const row = {
    id,
    task_id: clean(taskId, 100),
    shot_index: shotIndex,
    generation_id: clean(options.generationId, 100),
    qa_attempt: Math.max(1, Number(options.qaAttempt) || 1),
    provider_id: clean(options.providerId, 80),
    model_id: clean(options.modelId, 120),
    contract_fingerprint: clean(options.contractFingerprint, 128),
    prompt_fingerprint: fingerprint(options.prompt),
    status: 'preparing',
    provider_submission_state: 'not_submitted',
    billing_state: 'not_submitted',
    provider_request_id: '',
    provider_task_id: '',
    created_at: now,
    updated_at: now,
  };
  saveRows(taskId, [...rows(taskId), row]);
  return row;
}

function markSubmitting(taskId, id) {
  return update(taskId, id, {
    status: 'submitted',
    provider_submission_state: 'submitted_unknown',
    billing_state: 'unknown',
    submitted_at: new Date().toISOString(),
  });
}

function markSubmitted(taskId, id, event = {}) {
  return update(taskId, id, {
    status: 'submitted',
    provider_submission_state: 'submitted',
    billing_state: 'unknown',
    provider_request_id: clean(event.providerRequestId || event.requestId, 160),
    provider_task_id: clean(event.taskId || event.providerTaskId, 160),
    provider_status: clean(event.status || 'submitted', 60),
    submitted_at: event.submittedAt || new Date().toISOString(),
  });
}

function markProgress(taskId, id, event = {}) {
  const completedUrls = (Array.isArray(event.completedUrls) ? event.completedUrls : []).map(value => clean(value, 1000)).filter(Boolean).slice(0, 4);
  return update(taskId, id, {
    status: completedUrls.length ? 'result_available' : 'streaming',
    provider_submission_state: completedUrls.length ? 'completed' : 'streaming',
    billing_state: 'unknown',
    provider_request_id: clean(event.providerRequestId || event.requestId, 160),
    provider_task_id: clean(event.taskId || event.providerTaskId, 160),
    provider_status: clean(event.status || 'streaming', 60),
    completed_urls: completedUrls,
    last_progress_at: event.at || event.polledAt || new Date().toISOString(),
  });
}

function takeRecoverable(taskId, shotIndex) {
  const candidate = unresolvedForShot(taskId, shotIndex)
    .find(row => String(row.status || '') === 'result_available'
      && Array.isArray(row.completed_urls) && row.completed_urls.some(Boolean));
  if (!candidate) return null;
  return update(taskId, candidate.id, {
    status: 'recovering',
    provider_submission_state: 'completed',
    recovery_started_at: new Date().toISOString(),
  });
}

function restoreRecoverable(taskId, id, error = null) {
  const current = rows(taskId).find(row => String(row.id || '') === String(id || '')) || {};
  return update(taskId, id, {
    status: 'billing_unknown',
    provider_submission_state: 'completed',
    billing_state: 'unknown',
    recovery_error_code: clean(error?.code, 100),
    recovery_error: clean(error?.message || error, 500),
    completed_urls: Array.isArray(current.completed_urls) ? current.completed_urls : [],
  });
}

function markSuccess(taskId, id, result = {}) {
  return update(taskId, id, {
    status: 'succeeded',
    provider_submission_state: 'completed',
    billing_state: 'confirmed',
    provider_request_id: clean(result.provider_request_id || result.providerRequestId, 160),
    provider_task_id: clean(result.taskId || result.provider_task_id, 160),
    result_url: clean(result.source_url || result.image_url || result.imageUrl || result.url, 1000),
    completed_at: new Date().toISOString(),
    resolved_at: new Date().toISOString(),
  });
}

function markFailure(taskId, id, error = null) {
  const current = rows(taskId).find(row => String(row.id || '') === String(id || '')) || {};
  const source = `${error?.code || ''} ${error?.message || error || ''}`;
  const unknown = /TIMEOUT_OR_NETWORK|DEYUNAI_GPT_IMAGE2_STREAM_TIMEOUT|PROVIDER_5XX|timeout|timed\s*out|ECONNRESET|socket hang up/i.test(source)
    || error?.billingState === 'unknown' || error?.billing_state === 'unknown';
  const wasSubmitted = !['', 'not_submitted'].includes(String(current.provider_submission_state || 'not_submitted'));
  return update(taskId, id, {
    status: unknown ? 'billing_unknown' : 'failed_confirmed',
    provider_submission_state: clean(error?.providerSubmissionState || error?.provider_submission_state || (unknown ? 'submitted_unknown' : (wasSubmitted ? 'rejected' : 'not_submitted')), 60),
    billing_state: unknown ? 'unknown' : (wasSubmitted ? 'rejected' : 'not_submitted'),
    provider_request_id: clean(error?.providerRequestId || error?.provider_request_id, 160),
    provider_task_id: clean(error?.providerTaskId || error?.provider_task_id, 160),
    error_code: clean(error?.code, 100),
    error: clean(error?.message || error, 500),
    failed_at: new Date().toISOString(),
    ...(unknown ? {} : { resolved_at: new Date().toISOString() }),
  });
}

module.exports = {
  OUTPUT_KIND,
  UNRESOLVED_STATES,
  rows,
  unresolvedForShot,
  legacyTimeout,
  preflight,
  begin,
  markSubmitting,
  markSubmitted,
  markProgress,
  takeRecoverable,
  restoreRecoverable,
  markSuccess,
  markFailure,
};
