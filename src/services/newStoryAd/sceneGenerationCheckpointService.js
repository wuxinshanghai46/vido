const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const storage = require('./storageService');
const mediaAdapter = require('./mediaAdapter');

const CHECKPOINT_SCHEMA_VERSION = 1;
const CHECKPOINT_OUTPUT_PREFIX = 'scene_asset_checkpoint:';
const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000;
const CHECKPOINT_TTL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.NEW_STORY_AD_SCENE_CHECKPOINT_TTL_MS || DEFAULT_TTL_MS) || DEFAULT_TTL_MS,
);
const RESUMABLE_STATUSES = new Set(['running', 'partial', 'ready_for_qa']);

function nowIso() {
  return new Date().toISOString();
}

function safePart(value = '', max = 48) {
  return String(value || '')
    .replace(/[^a-z0-9_-]/ig, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max) || 'scene';
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function inputFingerprint(input = {}) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(stableValue(input)))
    .digest('hex');
}

function outputKind(sceneId = '') {
  return `${CHECKPOINT_OUTPUT_PREFIX}${safePart(sceneId, 100)}`;
}

function shortHash(value = '', length = 10) {
  return crypto.createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, Math.max(6, Math.min(24, Number(length) || 10)));
}

function candidateFilename(checkpoint = {}, viewKey = '') {
  return [
    'scene_asset',
    `t${shortHash(checkpoint.task_id, 10)}`,
    `s${shortHash(checkpoint.scene_id, 10)}`,
    `r${Math.max(1, Number(checkpoint.candidate_revision || 1) || 1)}`,
    safePart(viewKey, 24),
    'candidate',
    String(checkpoint.input_fingerprint || '').slice(0, 12),
    'image',
  ].join('_');
}

function submissionId(checkpoint = {}, viewKey = '', attempt = 1) {
  return [
    'scene',
    shortHash(checkpoint.task_id, 10),
    shortHash(checkpoint.scene_id, 10),
    `r${Math.max(1, Number(checkpoint.candidate_revision || 1) || 1)}`,
    safePart(viewKey, 24),
    `a${Math.max(1, Number(attempt || 1) || 1)}`,
    String(checkpoint.input_fingerprint || '').slice(0, 8),
  ].join('_').slice(0, 100);
}

function assertUniqueCandidateFilenames(checkpoint = {}, viewKeys = []) {
  const inputKeys = Array.isArray(viewKeys) ? viewKeys : [];
  const keys = inputKeys.map(key => safePart(key, 24));
  const rows = keys.map(key => {
    const requested = candidateFilename(checkpoint, key);
    const persisted = mediaAdapter.safeFilename(requested, '.png');
    return { key, requested, persisted };
  });
  const persistedNames = rows.map(row => row.persisted);
  const unique = new Set(persistedNames);
  const missingViewKey = rows.filter(row => !row.persisted.includes(`_${row.key}_`));
  const duplicateOrInvalidViewKeys = inputKeys.some(key => !String(key || '').trim())
    || new Set(keys).size !== keys.length;
  if (duplicateOrInvalidViewKeys || unique.size !== rows.length || missingViewKey.length) {
    const error = new Error('场景五视图候选文件名发生截断碰撞，已在图片调用前停止');
    error.code = 'SCENE_CANDIDATE_FILENAME_COLLISION';
    error.retryable = false;
    error.filename_diagnostics = rows;
    throw error;
  }
  return rows;
}

function viewUrl(view = {}) {
  return String(view.url || view.image_url || view.imageUrl || '').trim();
}

function localAssetFile(view = {}) {
  const direct = String(view.filePath || view.file_path || '').trim();
  if (direct) {
    const resolved = path.resolve(direct);
    const root = path.resolve(mediaAdapter.ASSET_DIR);
    if (resolved === root || resolved.startsWith(root + path.sep)) return resolved;
  }
  const url = viewUrl(view);
  if (!url.startsWith('/api/new-story-ad/assets/')) return '';
  return mediaAdapter.assetPathFromName(decodeURIComponent(url.split('/').pop()?.split('?')[0] || ''));
}

function reusableView(view = {}) {
  if (!view || view.status !== 'succeeded' || !viewUrl(view)) return false;
  const localFile = localAssetFile(view);
  return localFile ? fs.existsSync(localFile) : true;
}

function checkpointView(checkpoint = {}, viewKey = '') {
  const view = checkpoint.views?.[viewKey] || null;
  return reusableView(view) ? view : null;
}

function initialViewStates(checkpoint = {}, viewKeys = []) {
  return viewKeys.map(key => {
    const view = checkpoint.views?.[key] || {};
    const reusable = reusableView(view);
    return {
      key,
      status: reusable ? 'succeeded' : (view.status === 'failed' ? 'failed' : 'queued'),
      attempt: Math.max(0, Number(view.attempts || 0) || 0),
      error: reusable ? '' : String(view.error || '').slice(0, 240),
      retrying: false,
      updated_at: view.updated_at || checkpoint.updated_at || nowIso(),
    };
  });
}

function save(checkpoint = {}) {
  checkpoint.updated_at = nowIso();
  storage.saveOutput(checkpoint.task_id, outputKind(checkpoint.scene_id), checkpoint);
  return checkpoint;
}

function checkpointExpired(checkpoint = {}) {
  const updated = Date.parse(checkpoint.updated_at || checkpoint.created_at || '') || 0;
  return updated > 0 && Date.now() - updated > CHECKPOINT_TTL_MS;
}

function hasUnknownBillingRisk(view = {}) {
  if (view?.status !== 'failed') return false;
  return view.billing_state === 'unknown'
    || view.provider_submission_state === 'submitted_unknown'
    || view.error_code === 'PROVIDER_5XX_AMBIGUOUS';
}

function requiresBillingReview(view = {}) {
  // Absence of a provider handle is not evidence that a synchronous 5xx was not
  // accepted or billed. Only an explicit not-submitted/not-billed result may
  // bypass review; those states do not satisfy hasUnknownBillingRisk().
  return hasUnknownBillingRisk(view);
}

function retryReviewKey(taskId = '', sceneId = '', viewKey = '') {
  return `${outputKind(sceneId)}#${safePart(viewKey, 40)}`;
}

function hasRetryAuthorization(view = {}, reviewKey = '') {
  const authorization = view?.retry_authorization || {};
  return authorization.accept_duplicate_charge_risk === true
    && Number(authorization.remaining_uses || 0) > 0
    && String(authorization.checkpoint_key || '') === String(reviewKey || '');
}

function authorizeRetry(checkpoint = {}, viewKey = '', authorization = {}) {
  const view = checkpoint.views?.[viewKey] || {};
  if (!hasUnknownBillingRisk(view)) {
    const error = new Error('当前场景视图不存在计费未知状态，不需要重复计费风险授权。');
    error.code = 'GENERATION_RETRY_AUTHORIZATION_NOT_REQUIRED';
    error.status = 409;
    throw error;
  }
  if (authorization.acceptDuplicateChargeRisk !== true && authorization.accept_duplicate_charge_risk !== true) {
    const error = new Error('必须明确接受该场景视图可能重复计费，才能创建一次性重试授权。');
    error.code = 'GENERATION_DUPLICATE_CHARGE_ACCEPTANCE_REQUIRED';
    error.status = 400;
    throw error;
  }
  const reviewKey = retryReviewKey(checkpoint.task_id, checkpoint.scene_id, viewKey);
  checkpoint.views[viewKey] = {
    ...view,
    retry_authorization: {
      id: String(authorization.id || crypto.randomUUID()),
      checkpoint_key: reviewKey,
      accept_duplicate_charge_risk: true,
      accepted_by: String(authorization.acceptedBy || authorization.accepted_by || '').slice(0, 120),
      support_id: String(authorization.supportId || authorization.support_id || '').slice(0, 120),
      reason: String(authorization.reason || 'user_explicit_acceptance').slice(0, 240),
      remaining_uses: 1,
      accepted_at: nowIso(),
      consumed_at: '',
    },
    updated_at: nowIso(),
  };
  return save(checkpoint);
}

function cleanupUnpublishedFiles(checkpoint = {}) {
  if (!checkpoint || checkpoint.status === 'published') return 0;
  const assetRoot = path.resolve(mediaAdapter.ASSET_DIR);
  const thumbRoot = path.resolve(mediaAdapter.THUMB_DIR);
  let removed = 0;
  Object.values(checkpoint.views || {}).forEach(view => {
    const file = localAssetFile(view);
    if (!file || !path.basename(file).includes('_candidate_')) return;
    const resolved = path.resolve(file);
    if (!(resolved.startsWith(assetRoot + path.sep))) return;
    try {
      if (fs.existsSync(resolved)) {
        fs.rmSync(resolved, { force: true });
        removed += 1;
      }
      const base = path.basename(resolved);
      if (fs.existsSync(thumbRoot)) {
        fs.readdirSync(thumbRoot)
          .filter(name => name.startsWith(`${base}.`))
          .forEach(name => fs.rmSync(path.join(thumbRoot, name), { force: true }));
      }
    } catch (_) {}
  });
  return removed;
}

function open({
  taskId,
  sceneId,
  fingerprint,
  candidateRevision,
  viewKeys = [],
  retryBudget = null,
  metadata = {},
  compatibleFingerprints = [],
  acknowledgeBillingUnknown = false,
  acknowledgedBy = '',
} = {}) {
  const kind = outputKind(sceneId);
  const existing = storage.getOutput(taskId, kind);
  const unknownBillingViews = Object.entries(existing?.views || {})
    .filter(([, view]) => requiresBillingReview(view))
    .map(([key, view]) => ({
      key,
      generation_id: String(view.generation_id || ''),
      submission_id: String(view.submission_id || ''),
      error_code: String(view.error_code || ''),
      provider_request_id: String(view.provider_request_id || ''),
      provider_task_id: String(view.provider_task_id || ''),
      failed_at: view.failed_at || '',
      review_key: retryReviewKey(taskId, sceneId, key),
      authorized: hasRetryAuthorization(view, retryReviewKey(taskId, sceneId, key)),
    }));
  if (unknownBillingViews.length === 1 && acknowledgeBillingUnknown === true && !unknownBillingViews[0].authorized) {
    authorizeRetry(existing, unknownBillingViews[0].key, {
      acceptDuplicateChargeRisk: true,
      acceptedBy: acknowledgedBy,
      reason: 'legacy_single_scene_explicit_acknowledgement',
    });
    unknownBillingViews[0].authorized = true;
  }
  const unreviewedBillingViews = unknownBillingViews.filter(view => !view.authorized);
  if (unreviewedBillingViews.length) {
    const error = new Error(`场景 ${sceneId} 有 ${unknownBillingViews.length} 个图片请求计费状态未知，系统禁止自动重复提交；如确认放弃等待旧结果并接受可能的重复计费，请二次确认后只补失败视图。`);
    error.code = 'SCENE_ASSET_BILLING_UNKNOWN';
    error.status = 409;
    error.retryable = false;
    error.billingState = 'unknown';
    error.partial_scene_checkpoint = true;
    error.details = {
      requires_billing_acknowledgement: true,
      scene_id: String(sceneId),
      failed_views: unreviewedBillingViews,
    };
    throw error;
  }
  const acceptedFingerprints = new Set([
    String(fingerprint || ''),
    ...(Array.isArray(compatibleFingerprints) ? compatibleFingerprints : [])
      .map(value => String(value || ''))
      .filter(Boolean),
  ]);
  const canResume = existing
    && existing.schema_version === CHECKPOINT_SCHEMA_VERSION
    && acceptedFingerprints.has(String(existing.input_fingerprint || ''))
    && RESUMABLE_STATUSES.has(existing.status)
    && !checkpointExpired(existing);

  if (canResume) {
    if (existing.input_fingerprint !== fingerprint) {
      existing.migrated_from_input_fingerprint = existing.input_fingerprint;
      existing.input_fingerprint = String(fingerprint);
      existing.prompt_policy_migrated_at = nowIso();
    }
    existing.status = 'running';
    existing.resume_count = Math.max(0, Number(existing.resume_count || 0) || 0) + 1;
    existing.last_resumed_at = nowIso();
    existing.view_keys = [...new Set([...(existing.view_keys || []), ...viewKeys])];
    existing.metadata = { ...(existing.metadata || {}), ...metadata };
    return { checkpoint: save(existing), resumed: true };
  }

  if (existing && existing.status !== 'published') {
    existing.status = 'invalidated';
    existing.invalidated_at = nowIso();
    existing.invalidated_reason = checkpointExpired(existing) ? 'checkpoint_expired' : 'input_fingerprint_changed';
    cleanupUnpublishedFiles(existing);
  }

  const checkpoint = {
    schema_version: CHECKPOINT_SCHEMA_VERSION,
    task_id: String(taskId),
    scene_id: String(sceneId),
    input_fingerprint: String(fingerprint),
    candidate_revision: Math.max(1, Number(candidateRevision || 1) || 1),
    status: 'running',
    view_keys: [...new Set(viewKeys)],
    views: {},
    retry_budget: {
      max_extra: Math.max(0, Number(retryBudget?.maxExtra ?? retryBudget?.max_extra ?? 0) || 0),
      used_extra: Math.max(0, Number(retryBudget?.usedExtra ?? retryBudget?.used_extra ?? 0) || 0),
      reasons: Array.isArray(retryBudget?.reasons) ? retryBudget.reasons.slice(-20) : [],
    },
    metadata,
    resume_count: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  return { checkpoint: save(checkpoint), resumed: false };
}

function syncRetryBudget(checkpoint = {}, budget = {}) {
  checkpoint.retry_budget = {
    max_extra: Math.max(0, Number(budget.maxExtra || 0) || 0),
    used_extra: Math.max(0, Number(budget.usedExtra || 0) || 0),
    reasons: Array.isArray(budget.reasons) ? budget.reasons.slice(-20) : [],
  };
  return save(checkpoint);
}

function markSucceeded(checkpoint = {}, viewKey = '', view = {}, budget = null) {
  checkpoint.views[viewKey] = {
    ...(checkpoint.views[viewKey] || {}),
    ...view,
    key: viewKey,
    status: 'succeeded',
    attempts: Math.max(1, Number(view.attempts || checkpoint.views[viewKey]?.attempts || 1) || 1),
    error: '',
    error_code: '',
    billing_state: 'confirmed',
    provider_submission_state: 'completed',
    succeeded_at: nowIso(),
    updated_at: nowIso(),
  };
  if (budget) checkpoint.retry_budget = {
    max_extra: budget.maxExtra,
    used_extra: budget.usedExtra,
    reasons: Array.isArray(budget.reasons) ? budget.reasons.slice(-20) : [],
  };
  return save(checkpoint);
}

function markSubmitting(checkpoint = {}, viewKey = '', event = {}) {
  const existing = checkpoint.views[viewKey] || {};
  const reviewKey = retryReviewKey(checkpoint.task_id, checkpoint.scene_id, viewKey);
  const retryAuthorization = hasUnknownBillingRisk(existing) && hasRetryAuthorization(existing, reviewKey)
    ? { ...existing.retry_authorization, remaining_uses: 0, consumed_at: nowIso() }
    : existing.retry_authorization;
  checkpoint.views[viewKey] = {
    ...existing,
    key: viewKey,
    status: 'running',
    attempts: Math.max(1, Number(event.attempt || existing.attempts || 1) || 1),
    generation_id: String(event.generationId || event.generation_id || existing.generation_id || '').slice(0, 100),
    submission_id: String(event.clientRequestId || event.submissionId || event.submission_id || existing.submission_id || '').slice(0, 100),
    provider_submission_state: 'submitted_unknown',
    billing_state: 'unknown',
    submitting_at: event.submittedAt || nowIso(),
    retry_authorization: retryAuthorization || null,
    updated_at: nowIso(),
  };
  return save(checkpoint);
}

function markSubmitted(checkpoint = {}, viewKey = '', event = {}) {
  const existing = checkpoint.views[viewKey] || {};
  checkpoint.views[viewKey] = {
    ...existing,
    key: viewKey,
    status: 'running',
    attempts: Math.max(1, Number(event.attempt || existing.attempts || 1) || 1),
    generation_id: String(event.generationId || event.generation_id || existing.generation_id || '').slice(0, 100),
    submission_id: String(event.clientRequestId || event.submissionId || event.submission_id || existing.submission_id || '').slice(0, 100),
    provider_request_id: String(event.providerRequestId || event.provider_request_id || existing.provider_request_id || '').slice(0, 180),
    provider_task_id: String(event.taskId || event.providerTaskId || event.provider_task_id || existing.provider_task_id || '').slice(0, 180),
    provider_submission_state: String(event.status || 'submitted').slice(0, 60),
    billing_state: 'unknown',
    submitted_at: event.submittedAt || nowIso(),
    updated_at: nowIso(),
  };
  return save(checkpoint);
}

function markFailed(checkpoint = {}, viewKey = '', error = null, budget = null) {
  const providerTaskId = String(error?.providerTaskId || error?.provider_task_id || '');
  const billingState = String(error?.billingState || error?.billing_state || (providerTaskId ? 'unknown' : 'not_submitted'));
  checkpoint.status = 'partial';
  checkpoint.views[viewKey] = {
    ...(checkpoint.views[viewKey] || {}),
    key: viewKey,
    status: 'failed',
    attempts: Math.max(1, Number(error?.attempt || checkpoint.views[viewKey]?.attempts || 1) || 1),
    generation_id: String(error?.generationId || error?.generation_id || checkpoint.views[viewKey]?.generation_id || '').slice(0, 100),
    submission_id: String(error?.submissionId || error?.submission_id || checkpoint.views[viewKey]?.submission_id || '').slice(0, 100),
    error: String(error?.message || error || '').slice(0, 500),
    error_code: String(error?.code || 'SCENE_VIEW_GENERATION_FAILED').slice(0, 100),
    retryable: error?.retryable === true,
    billing_state: billingState,
    provider_submission_state: String(error?.providerSubmissionState || error?.provider_submission_state || (billingState === 'unknown' ? 'submitted_unknown' : '')),
    provider_request_id: String(error?.providerRequestId || error?.provider_request_id || '').slice(0, 180),
    provider_task_id: providerTaskId.slice(0, 180),
    provider_id: String(error?.providerId || error?.provider_id || '').slice(0, 120),
    model_id: String(error?.modelId || error?.model_id || '').slice(0, 160),
    provider_status: String(error?.providerStatus || error?.provider_status || '').slice(0, 60),
    provider_reason: String(error?.providerReason || error?.provider_reason || '').slice(0, 240),
    provider_error_code: String(error?.providerErrorCode || error?.provider_error_code || '').slice(0, 120),
    platform_request_id: String(error?.platformRequestId || error?.platform_request_id || error?.submissionId || error?.submission_id || '').slice(0, 120),
    failed_at: nowIso(),
    updated_at: nowIso(),
  };
  if (budget) checkpoint.retry_budget = {
    max_extra: budget.maxExtra,
    used_extra: budget.usedExtra,
    reasons: Array.isArray(budget.reasons) ? budget.reasons.slice(-20) : [],
  };
  return save(checkpoint);
}

function invalidateSucceededView(checkpoint = {}, viewKey = '', reason = {}) {
  const existing = checkpoint.views?.[viewKey] || {};
  if (!reusableView(existing)) {
    const error = new Error(`场景视图 ${viewKey} 不是可复用成功资产，不能执行质检作废。`);
    error.code = 'SCENE_VIEW_INVALIDATION_NOT_APPLICABLE';
    throw error;
  }
  const rejectedUrl = viewUrl(existing);
  checkpoint.status = 'partial';
  checkpoint.views[viewKey] = {
    ...existing,
    key: viewKey,
    status: 'failed',
    image_url: '',
    url: '',
    rejected_image_url: rejectedUrl,
    error: String(reason.message || '场景空镜出现未授权人物，已退出复用队列。').slice(0, 500),
    error_code: String(reason.code || 'SCENE_UNEXPECTED_PERSON').slice(0, 100),
    retryable: true,
    billing_state: 'confirmed',
    provider_submission_state: 'completed',
    qa: {
      ...(existing.qa && typeof existing.qa === 'object' ? existing.qa : {}),
      pass: false,
      unexpected_person: true,
      source: String(reason.source || 'manual_visual_audit').slice(0, 100),
      checked_at: nowIso(),
    },
    failed_at: nowIso(),
    updated_at: nowIso(),
  };
  checkpoint.last_error = checkpoint.views[viewKey].error;
  checkpoint.last_error_code = checkpoint.views[viewKey].error_code;
  return save(checkpoint);
}

function setLayoutAcquisition(checkpoint = {}, value = null) {
  checkpoint.layout_acquisition = value;
  return save(checkpoint);
}

function markReadyForQa(checkpoint = {}) {
  checkpoint.status = 'ready_for_qa';
  checkpoint.ready_for_qa_at = nowIso();
  return save(checkpoint);
}

function markPartial(checkpoint = {}, error = null) {
  checkpoint.status = 'partial';
  checkpoint.last_error = String(error?.message || error || '').slice(0, 500);
  checkpoint.last_error_code = String(error?.code || 'SCENE_VIEWS_INCOMPLETE').slice(0, 100);
  return save(checkpoint);
}

function markCancelled(checkpoint = {}, viewKey = '', error = null, budget = null) {
  const succeeded = Object.values(checkpoint.views || {}).filter(view => view?.status === 'succeeded').length;
  checkpoint.status = succeeded > 0 ? 'partial' : 'cancelled';
  checkpoint.cancelled_at = nowIso();
  checkpoint.last_error = String(error?.message || '用户已取消场景生成').slice(0, 500);
  checkpoint.last_error_code = 'USER_CANCELLED';
  checkpoint.cancelled_view_keys = [...new Set([
    ...(Array.isArray(checkpoint.cancelled_view_keys) ? checkpoint.cancelled_view_keys : []),
    String(viewKey || ''),
  ].filter(Boolean))];
  if (budget) checkpoint.retry_budget = {
    max_extra: budget.maxExtra,
    used_extra: budget.usedExtra,
    reasons: Array.isArray(budget.reasons) ? budget.reasons.slice(-20) : [],
  };
  return save(checkpoint);
}

function markPublished(checkpoint = {}, asset = {}) {
  checkpoint.status = 'published';
  checkpoint.published_revision = Number(asset.scene_revision || checkpoint.candidate_revision || 1) || 1;
  checkpoint.published_at = nowIso();
  checkpoint.last_error = '';
  checkpoint.last_error_code = '';
  return save(checkpoint);
}

function markReviewRequired(checkpoint = {}, asset = {}, error = null) {
  checkpoint.status = 'review_required';
  checkpoint.review_revision = Number(asset.scene_revision || checkpoint.candidate_revision || 1) || 1;
  checkpoint.review_required_at = nowIso();
  checkpoint.last_error = String(error?.message || '场景视觉验证未通过').slice(0, 500);
  checkpoint.last_error_code = String(error?.code || 'SCENE_VISUAL_QA_REJECTED').slice(0, 100);
  return save(checkpoint);
}

module.exports = {
  CHECKPOINT_SCHEMA_VERSION,
  CHECKPOINT_OUTPUT_PREFIX,
  CHECKPOINT_TTL_MS,
  inputFingerprint,
  outputKind,
  candidateFilename,
  submissionId,
  assertUniqueCandidateFilenames,
  reusableView,
  checkpointView,
  initialViewStates,
  open,
  syncRetryBudget,
  markSucceeded,
  markSubmitting,
  markSubmitted,
  markFailed,
  invalidateSucceededView,
  setLayoutAcquisition,
  markReadyForQa,
  markPartial,
  markCancelled,
  markPublished,
  markReviewRequired,
  cleanupUnpublishedFiles,
  hasUnknownBillingRisk,
  requiresBillingReview,
  retryReviewKey,
  hasRetryAuthorization,
  authorizeRetry,
};
