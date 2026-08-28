'use strict';

const crypto = require('crypto');
const defaultStorage = require('./storageService');
const works = require('./workAggregateService');
const taskStateAudit = require('./taskStateAuditService');

function text(value = '') { return String(value ?? '').trim(); }
function rows(value) { return Array.isArray(value) ? value : []; }
function legacyBillingId(call = {}) {
  const source = text(call.id) || JSON.stringify([call.task_id, call.stage, call.provider_task_id, call.created_at]);
  return `gu_legacy_billing_${crypto.createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
}
function unknownBilling(call = {}) {
  return text(call.billing_state).toLowerCase() === 'unknown';
}

function legacyCheckpointBillingId(checkpoint = {}) {
  const source = JSON.stringify([checkpoint.task_id, checkpoint.checkpoint_key]);
  return `gu_legacy_checkpoint_${crypto.createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
}

function checkpointUnknownBilling(db = {}) {
  const taskIds = [...new Set(rows(db.outputs).map(row => text(row.task_id)).filter(Boolean))];
  const unknownCalls = rows(db.model_calls).filter(unknownBilling);
  return taskIds.flatMap(taskId => taskStateAudit.checkpointBillingRows(db.outputs, taskId))
    .filter(checkpoint => !unknownCalls.some(call => taskStateAudit.sameBillingAttempt(call, checkpoint)));
}

function plan(db = {}) {
  const tasks = rows(db.tasks);
  const existingWorkIds = new Set(rows(db.works).map(work => text(work.id || work.task_id)));
  const existingRunIds = new Set(rows(db.generation_runs).map(run => text(run.id)));
  const unknownCalls = rows(db.model_calls).filter(unknownBilling);
  const checkpointUnknown = checkpointUnknownBilling(db);
  const modelRisks = unknownCalls
    .map(call => ({ id: legacyBillingId(call), source: 'model_call', call_id: text(call.id), task_id: text(call.task_id), provider_task_id: text(call.provider_task_id) }))
    .filter(item => !existingRunIds.has(item.id));
  const checkpointRisks = checkpointUnknown
    .map(checkpoint => ({
      id: legacyCheckpointBillingId(checkpoint), source: 'generation_checkpoint', checkpoint_key: checkpoint.checkpoint_key,
      task_id: checkpoint.task_id, provider_task_id: checkpoint.provider_task_id,
    }))
    .filter(item => !existingRunIds.has(item.id));
  return {
    schema_version: 1,
    read_only: true,
    task_count: tasks.length,
    tasks_to_create_work: tasks.filter(task => !existingWorkIds.has(text(task.id))).map(task => text(task.id)),
    tasks_to_enable_lineage: tasks.filter(task => task.lineage_enforced !== true).map(task => text(task.id)),
    unknown_billing_to_quarantine: [...modelRisks, ...checkpointRisks],
    model_call_billing_to_quarantine: modelRisks,
    checkpoint_billing_to_quarantine: checkpointRisks,
    model_calls_started: 0,
  };
}

function quarantineCheckpointBilling(checkpoint = {}, storage = defaultStorage) {
  const id = legacyCheckpointBillingId(checkpoint);
  const existing = storage.getGenerationRun(id);
  if (existing) return { created: false, unit: existing };
  const unit = storage.createGenerationRun({
    id,
    task_id: text(checkpoint.task_id),
    work_id: text(checkpoint.task_id),
    domain: text(checkpoint.stage || 'legacy_checkpoint_generation'),
    target_permanent_id: `checkpoint:${text(checkpoint.checkpoint_key)}`,
    operation: 'legacy_checkpoint_billing_reconciliation',
    input_fingerprint: crypto.createHash('sha256').update(text(checkpoint.checkpoint_key)).digest('hex'),
    spec_revision: 1,
    provider_id: 'legacy_checkpoint_unknown',
    model_id: '',
    idempotency_key: crypto.createHash('sha256').update(`legacy-checkpoint-billing\n${id}`).digest('hex'),
    contract_version: 1,
    state: 'billing_unknown',
    unit_version: 1,
    provider_submission_state: text(checkpoint.provider_submission_state || 'submitted_unknown'),
    billing_state: 'unknown',
    retry_blocked: true,
    automatic_retry_allowed: false,
    provider_task_id: text(checkpoint.provider_task_id),
    error_code: 'LEGACY_CHECKPOINT_BILLING_UNKNOWN',
    error_message: '历史生成checkpoint计费状态未知，已隔离并等待人工核账',
    legacy_checkpoint_key: text(checkpoint.checkpoint_key),
    migrated_at: new Date().toISOString(),
    state_history: [{ from: '', to: 'billing_unknown', reason: 'legacy_checkpoint_migration', at: new Date().toISOString() }],
  });
  return { created: true, unit };
}

function quarantineUnknownBilling(call = {}, storage = defaultStorage) {
  const id = legacyBillingId(call);
  const existing = storage.getGenerationRun(id);
  if (existing) return { created: false, unit: existing };
  const now = text(call.created_at || new Date().toISOString());
  const unit = storage.createGenerationRun({
    id,
    task_id: text(call.task_id),
    work_id: text(call.task_id),
    domain: text(call.stage || 'legacy_generation'),
    target_permanent_id: `legacy-call:${text(call.id || id)}`,
    operation: 'legacy_billing_reconciliation',
    input_fingerprint: crypto.createHash('sha256').update(text(call.id || id)).digest('hex'),
    spec_revision: Math.max(1, Number(call.content_revision || 1) || 1),
    provider_id: text(call.provider_id || 'legacy_unknown'),
    model_id: text(call.model_id),
    idempotency_key: crypto.createHash('sha256').update(`legacy-billing\n${id}`).digest('hex'),
    contract_version: 1,
    state: 'billing_unknown',
    unit_version: 1,
    provider_submission_state: text(call.provider_submission_state || (call.provider_task_id ? 'submitted_unknown' : 'unknown')),
    billing_state: 'unknown',
    retry_blocked: true,
    automatic_retry_allowed: false,
    provider_task_id: text(call.provider_task_id),
    error_code: text(call.error_code || 'LEGACY_BILLING_UNKNOWN'),
    error_message: text(call.error_message || '历史调用计费状态未知，迁移后等待人工核账'),
    legacy_model_call_id: text(call.id),
    migrated_at: new Date().toISOString(),
    state_history: [{ from: '', to: 'billing_unknown', reason: 'legacy_migration', at: now }],
  });
  return { created: true, unit };
}

function quarantineInactiveUnknownModelBillingForTask(taskId = '', storage = defaultStorage) {
  const normalizedTaskId = text(taskId);
  if (!normalizedTaskId) return { task_id: '', quarantined: 0, existing: 0, skipped_active: 0, results: [] };
  const modelCalls = storage.listModelCalls(normalizedTaskId);
  const generationRuns = storage.listGenerationRuns({ task_id: normalizedTaskId });
  const risk = taskStateAudit.billingRiskForTask({
    outputs: [], model_calls: modelCalls, generation_runs: generationRuns,
  }, normalizedTaskId);
  const candidates = risk.unquarantined_unknown_billing
    .filter(call => call.source !== 'generation_checkpoint');
  const inactive = candidates.filter(call => !taskStateAudit.isUnknownBilling(call));
  const apply = () => inactive.map(call => quarantineUnknownBilling(call, storage));
  const results = typeof storage.withWriteBatch === 'function' ? storage.withWriteBatch(apply) : apply();
  return {
    task_id: normalizedTaskId,
    quarantined: results.filter(result => result.created).length,
    existing: results.filter(result => !result.created).length,
    skipped_active: candidates.length - inactive.length,
    results,
  };
}

function apply({ storage = defaultStorage, enableLineage = true, promoteAuthority = true, batched = false } = {}) {
  if (!batched && typeof storage.withWriteBatch === 'function') {
    return storage.withWriteBatch(() => apply({ storage, enableLineage, promoteAuthority, batched: true }));
  }
  const before = plan(storage.readDb());
  const result = {
    schema_version: 1,
    committed: true,
    works_created: 0,
    works_synced: 0,
    lineage_enabled: 0,
    billing_quarantined: 0,
    authority_promoted: 0,
    legacy_output_rows_pruned: 0,
    model_calls_started: 0,
    issues: [],
  };
  rows(storage.readDb().tasks).forEach(task => {
    try {
      if (enableLineage && task.lineage_enforced !== true) {
        storage.enableLineage(task.id);
        result.lineage_enabled += 1;
      }
      const existed = !!storage.getWork(task.id);
      works.ensureShadowWork(task.id);
      if (!existed) result.works_created += 1;
      works.syncFromTask(task.id, { domains: works.DOMAIN_KEYS, commandId: `migration:${Number(task.content_revision || 1)}` });
      result.works_synced += 1;
      const comparison = works.compareWithTask(task.id);
      if (!comparison.ok) result.issues.push({ task_id: task.id, issues: comparison.issues });
      else if (promoteAuthority) {
        const beforeMode = storage.getWork(task.id)?.mode;
        works.promoteToAuthoritative(task.id);
        if (beforeMode !== 'authoritative') result.authority_promoted += 1;
        result.legacy_output_rows_pruned += storage.pruneLegacyOutputRows(task.id, Object.keys(works.OUTPUT_DOMAIN_MAP));
      }
    } catch (error) {
      result.issues.push({ task_id: task.id, issues: [text(error.code || error.message)] });
    }
  });
  rows(storage.readDb().model_calls).filter(unknownBilling).forEach(call => {
    const quarantined = quarantineUnknownBilling(call, storage);
    if (quarantined.created) result.billing_quarantined += 1;
  });
  checkpointUnknownBilling(storage.readDb()).forEach(checkpoint => {
    const quarantined = quarantineCheckpointBilling(checkpoint, storage);
    if (quarantined.created) result.billing_quarantined += 1;
  });
  const after = plan(storage.readDb());
  const authoritativeWorks = rows(storage.readDb().works).filter(work => work.mode === 'authoritative').length;
  result.remaining = {
    tasks_without_work: after.tasks_to_create_work.length,
    tasks_without_lineage: enableLineage ? after.tasks_to_enable_lineage.length : before.tasks_to_enable_lineage.length,
    unknown_billing_without_quarantine: after.unknown_billing_to_quarantine.length,
    non_authoritative_works: promoteAuthority ? Math.max(0, after.task_count - authoritativeWorks) : 0,
  };
  result.ok = result.issues.length === 0
    && result.remaining.tasks_without_work === 0
    && result.remaining.unknown_billing_without_quarantine === 0
    && (!promoteAuthority || result.remaining.non_authoritative_works === 0)
    && (!enableLineage || result.remaining.tasks_without_lineage === 0);
  return result;
}

module.exports = {
  apply, checkpointUnknownBilling, legacyBillingId, legacyCheckpointBillingId, plan,
  quarantineCheckpointBilling, quarantineUnknownBilling, quarantineInactiveUnknownModelBillingForTask, unknownBilling,
};
