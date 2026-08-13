const crypto = require('crypto');
const storage = require('./storageService');
const checkpoints = require('./assetGenerationCheckpointService');
const sceneCheckpoints = require('./sceneGenerationCheckpointService');

function clean(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function checkpointRows(taskId, prefix) {
  return storage.listOutputs(taskId)
    .filter(row => String(row.kind || '').startsWith(prefix))
    .sort((a, b) => String(b.updated_at || b.payload?.updated_at || '').localeCompare(String(a.updated_at || a.payload?.updated_at || '')));
}

function subjectCheckpointRows(taskId) {
  return checkpointRows(taskId, 'subject_asset_checkpoint:');
}

function sceneCheckpointRows(taskId) {
  return checkpointRows(taskId, 'scene_asset_checkpoint:');
}

function ambiguousUnits(taskId) {
  const subjectCandidates = subjectCheckpointRows(taskId).flatMap(row => Object.entries(row.payload?.person_dossier_checkpoints || {})
    .filter(([, checkpoint]) => checkpoints.hasAmbiguousSubmission(checkpoint))
    .map(([key, checkpoint]) => {
      const normalized = checkpoints.normalizeCheckpoint(checkpoint, { key });
      const owner = row.payload?.subject_checkpoint_owners?.[key] || {};
      return {
        lane: 'subjects', kind: 'subject', row, key, review_key: key, checkpoint: normalized,
        subject_id: clean(owner.subject_id, 120), subject_kind: clean(owner.kind, 40), subject_index: Number(owner.index || 0),
        unit: clean(normalized.unit || normalized.asset_type, 120),
        authorized: checkpoints.hasRetryAuthorization(normalized),
      };
    }));
  const seenSubjectReviews = new Set();
  const subjects = subjectCandidates.filter(unit => {
    if (seenSubjectReviews.has(unit.review_key)) return false;
    seenSubjectReviews.add(unit.review_key);
    return true;
  });
  const scenes = sceneCheckpointRows(taskId).flatMap(row => Object.entries(row.payload?.views || {})
    .filter(([, view]) => sceneCheckpoints.hasUnknownBillingRisk(view))
    .map(([key, view]) => {
      const reviewKey = sceneCheckpoints.retryReviewKey(taskId, row.payload?.scene_id, key);
      return {
        lane: 'scenes', kind: 'scene', row, key, review_key: reviewKey, checkpoint: view,
        scene_id: clean(row.payload?.scene_id, 120), unit: clean(key, 80),
        authorized: sceneCheckpoints.hasRetryAuthorization(view, reviewKey),
      };
    }));
  return [...subjects, ...scenes];
}

function publicReview(unit = {}) {
  return {
    review_key: clean(unit.review_key, 260),
    lane: unit.lane,
    kind: unit.kind,
    subject_id: unit.subject_id || '',
    subject_kind: unit.subject_kind || '',
    subject_index: Number(unit.subject_index || 0),
    scene_id: unit.scene_id || '',
    unit: unit.unit || unit.key || '',
    error_code: clean(unit.checkpoint?.error?.code || unit.checkpoint?.error_code || 'GENERATION_BILLING_STATE_UNKNOWN', 120),
    provider_submission_state: clean(unit.checkpoint?.provider_submission_state || 'submitted_unknown', 60),
    billing_state: clean(unit.checkpoint?.billing_state || 'unknown', 40),
    authorized: unit.authorized === true,
  };
}

function billingReviewSupportId(taskId = '', task = {}, units = []) {
  const current = clean(task.support_id, 120);
  if (current) return current;
  if (!units.length) return '';
  const fingerprint = units.map(unit => ({
    review_key: clean(unit.review_key, 260),
    kind: clean(unit.kind, 40),
    error_code: clean(unit.checkpoint?.error?.code || unit.checkpoint?.error_code || 'GENERATION_BILLING_STATE_UNKNOWN', 120),
    provider_submission_state: clean(unit.checkpoint?.provider_submission_state || 'submitted_unknown', 60),
    billing_state: clean(unit.checkpoint?.billing_state || 'unknown', 40),
  })).sort((a, b) => a.review_key.localeCompare(b.review_key));
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify({ task_id: clean(taskId, 120), units: fingerprint }))
    .digest('hex').slice(0, 32);
  return `billing-review-${digest}`;
}

function listBillingReviews(taskId) {
  const task = storage.getTask(taskId);
  if (!task) {
    const error = new Error('任务不存在。');
    error.code = 'TASK_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const units = ambiguousUnits(taskId);
  const reviews = units.map(publicReview);
  return { support_id: billingReviewSupportId(taskId, task, units), review_count: reviews.length, reviews };
}

function authorizeTaskRetry({
  taskId = '', supportId = '', checkpointKey = '', acceptedBy = '', acceptDuplicateChargeRisk = false,
} = {}) {
  const task = storage.getTask(taskId);
  if (!task) {
    const error = new Error('任务不存在。'); error.code = 'TASK_NOT_FOUND'; error.status = 404; throw error;
  }
  if (String(task.active_generation_id || '')) {
    const error = new Error('当前任务仍在运行，不能修改计费重试授权。');
    error.code = 'VISUAL_ASSET_RETRY_AUTHORIZATION_ACTIVE_TASK'; error.status = 409; throw error;
  }
  const units = ambiguousUnits(taskId);
  if (!units.length) {
    const error = new Error('当前任务没有需要授权的计费未知生成单元。');
    error.code = 'VISUAL_ASSET_BILLING_REVIEW_NOT_REQUIRED'; error.status = 409; throw error;
  }
  const expectedSupportId = billingReviewSupportId(taskId, task, units);
  if (!supportId || supportId !== expectedSupportId) {
    const error = new Error('计费核对编号已变化，请刷新页面后重新确认。');
    error.code = 'VISUAL_ASSET_RETRY_SUPPORT_ID_MISMATCH'; error.status = 409; throw error;
  }
  const selected = checkpointKey
    ? units.filter(unit => unit.review_key === checkpointKey)
    : units;
  if (!selected.length) {
    const error = new Error('指定的计费核对单元不存在或已变化，请刷新后重试。');
    error.code = 'VISUAL_ASSET_BILLING_REVIEW_MISMATCH'; error.status = 409; throw error;
  }
  if (selected.length !== 1) {
    const error = new Error(`当前任务存在 ${selected.length} 个计费未知单元，必须逐项核对，不能批量授权。`);
    error.code = 'VISUAL_ASSET_MULTIPLE_BILLING_REVIEWS_REQUIRED'; error.status = 409;
    error.details = { ambiguous_unit_count: selected.length, reviews: selected.map(publicReview) }; throw error;
  }
  const unit = selected[0];
  if (unit.authorized) {
    return { authorized: true, duplicate: true, checkpoint_key: unit.review_key, authorization_id: unit.checkpoint.retry_authorization.id, remaining_uses: 1 };
  }
  if (unit.kind === 'subject') {
    const authorized = checkpoints.authorizeAmbiguousRetry(unit.checkpoint, {
      acceptDuplicateChargeRisk, acceptedBy, supportId, reason: 'user_explicit_acceptance_from_visual_asset_ui',
    });
    storage.saveOutput(taskId, unit.row.kind, {
      ...unit.row.payload,
      person_dossier_checkpoints: { ...(unit.row.payload?.person_dossier_checkpoints || {}), [unit.key]: authorized },
      updated_at: new Date().toISOString(),
    });
    return { authorized: true, duplicate: false, checkpoint_key: unit.review_key, authorization_id: authorized.retry_authorization.id, remaining_uses: 1 };
  }
  const updated = sceneCheckpoints.authorizeRetry(unit.row.payload, unit.key, {
    acceptDuplicateChargeRisk, acceptedBy, supportId, reason: 'user_explicit_acceptance_from_visual_asset_ui',
  });
  return {
    authorized: true, duplicate: false, checkpoint_key: unit.review_key,
    authorization_id: updated.views[unit.key].retry_authorization.id, remaining_uses: 1,
  };
}

module.exports = {
  subjectCheckpointRows, sceneCheckpointRows, ambiguousUnits, publicReview, billingReviewSupportId, listBillingReviews, authorizeTaskRetry,
};
