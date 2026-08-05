const storage = require('./storageService');
const checkpoints = require('./assetGenerationCheckpointService');

function clean(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function subjectCheckpointRows(taskId) {
  return storage.listOutputs(taskId)
    .filter(row => String(row.kind || '').startsWith('subject_asset_checkpoint:'))
    .sort((a, b) => String(b.updated_at || b.payload?.updated_at || '').localeCompare(String(a.updated_at || a.payload?.updated_at || '')));
}

function ambiguousUnits(taskId) {
  return subjectCheckpointRows(taskId).flatMap(row => Object.entries(row.payload?.person_dossier_checkpoints || {})
    .filter(([, checkpoint]) => checkpoints.hasAmbiguousSubmission(checkpoint))
    .map(([key, checkpoint]) => ({ row, key, checkpoint: checkpoints.normalizeCheckpoint(checkpoint, { key }) })));
}

function authorizeTaskRetry({
  taskId = '',
  supportId = '',
  acceptedBy = '',
  acceptDuplicateChargeRisk = false,
} = {}) {
  const task = storage.getTask(taskId);
  if (!task) {
    const error = new Error('任务不存在。');
    error.code = 'TASK_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  if (String(task.active_generation_id || '')) {
    const error = new Error('当前任务仍在运行，不能修改计费重试授权。');
    error.code = 'VISUAL_ASSET_RETRY_AUTHORIZATION_ACTIVE_TASK';
    error.status = 409;
    throw error;
  }
  const expectedSupportId = clean(task.support_id, 120);
  if (!supportId || supportId !== expectedSupportId) {
    const error = new Error('支持编号已变化，请刷新页面后重新确认。');
    error.code = 'VISUAL_ASSET_RETRY_SUPPORT_ID_MISMATCH';
    error.status = 409;
    throw error;
  }
  const units = ambiguousUnits(taskId);
  if (!units.length) {
    const error = new Error('当前任务没有需要授权的计费未知生成单元。');
    error.code = 'VISUAL_ASSET_BILLING_REVIEW_NOT_REQUIRED';
    error.status = 409;
    throw error;
  }
  if (units.length !== 1) {
    const error = new Error(`当前任务存在 ${units.length} 个计费未知单元，必须逐项核对，不能批量授权。`);
    error.code = 'VISUAL_ASSET_MULTIPLE_BILLING_REVIEWS_REQUIRED';
    error.status = 409;
    error.details = { ambiguous_unit_count: units.length };
    throw error;
  }
  const unit = units[0];
  if (checkpoints.hasRetryAuthorization(unit.checkpoint)) {
    return {
      authorized: true,
      duplicate: true,
      checkpoint_key: unit.key,
      authorization_id: unit.checkpoint.retry_authorization.id,
      remaining_uses: 1,
    };
  }
  const authorized = checkpoints.authorizeAmbiguousRetry(unit.checkpoint, {
    acceptDuplicateChargeRisk,
    acceptedBy,
    supportId,
    reason: 'user_explicit_acceptance_from_visual_asset_ui',
  });
  storage.saveOutput(taskId, unit.row.kind, {
    ...unit.row.payload,
    person_dossier_checkpoints: {
      ...(unit.row.payload?.person_dossier_checkpoints || {}),
      [unit.key]: authorized,
    },
    updated_at: new Date().toISOString(),
  });
  const progress = task.generation_progress || {};
  const subjects = progress.lanes?.subjects || {};
  storage.updateTask(taskId, {
    retryable: true,
    error_code: 'VISUAL_ASSET_RETRY_AUTHORIZED',
    error: '用户已明确接受该计费未知单元可能重复计费；一次性重试授权已建立，尚未调用模型。',
    generation_progress: {
      ...progress,
      phase: 'retry_authorized',
      message: '已建立一次性补生成授权；只有用户再次确认生成时才会调用模型。',
      lanes: {
        ...(progress.lanes || {}),
        subjects: {
          ...subjects,
          phase: 'retry_authorized',
          message: '用户已接受配饰单元可能重复计费；等待用户提交补生成。',
          updated_at: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    },
  });
  return {
    authorized: true,
    duplicate: false,
    checkpoint_key: unit.key,
    authorization_id: authorized.retry_authorization.id,
    remaining_uses: authorized.retry_authorization.remaining_uses,
  };
}

module.exports = { subjectCheckpointRows, ambiguousUnits, authorizeTaskRetry };
