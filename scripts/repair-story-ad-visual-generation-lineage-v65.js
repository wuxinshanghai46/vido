#!/usr/bin/env node
'use strict';

const storage = require('../src/services/newStoryAd/storageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const billingAuthorization = require('../src/services/newStoryAd/visualAssetBillingAuthorizationService');
const taskStateAudit = require('../src/services/newStoryAd/taskStateAuditService');

function text(value = '') { return String(value ?? '').trim(); }
function rows(value) { return Array.isArray(value) ? value : []; }

const VISUAL_FIELDS = [
  'assetId', 'actor_asset_id', 'actor_id', 'sourceType', 'referenceImageUrl', 'image_url',
  'extra_image_urls', 'view_images', 'person_contract', 'identityLock',
];

function restoreAuthoritativeCast(authoritative = [], projected = []) {
  return rows(authoritative).map((profile, index) => {
    const id = text(profile.id || profile.cast_id || profile.castId);
    const visual = rows(projected).find(item => id && [item.id, item.cast_id, item.castId].map(text).includes(id))
      || projected[index] || {};
    const overlay = Object.fromEntries(VISUAL_FIELDS
      .filter(key => visual[key] !== undefined)
      .map(key => [key, visual[key]]));
    return { ...profile, ...overlay };
  });
}

function checkpointSummary(taskId) {
  const units = storage.listOutputs(taskId)
    .filter(row => text(row.kind).startsWith('subject_asset_checkpoint:'))
    .flatMap(row => Object.values(row.payload?.person_dossier_checkpoints || {}));
  return {
    total: units.length,
    completed: units.filter(unit => text(unit.status) === 'completed').length,
    failed_safe: units.filter(unit => text(unit.status) === 'failed'
      && !['unknown', 'submitting', 'submitted', 'submitted_unknown'].includes(text(unit.billing_state || unit.provider_submission_state))).length,
    submitted_unknown: units.filter(unit => text(unit.billing_state) === 'unknown'
      || text(unit.provider_submission_state) === 'submitted_unknown').length,
  };
}

function preview(taskId = '') {
  const task = storage.getTask(taskId);
  if (!task) { const error = new Error('TASK_NOT_FOUND'); error.code = 'TASK_NOT_FOUND'; throw error; }
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const activeRecord = storage.getOutput(taskId, 'asset_plan_active') || {};
  const activePlan = activeRecord.plan || null;
  const activeFingerprint = text(activePlan?.fingerprint || activeRecord.fingerprint);
  const authoritativeCast = rows(activePlan?.cast_profiles);
  const repairedCast = authoritativeCast.length
    ? restoreAuthoritativeCast(authoritativeCast, context.cast_profiles)
    : rows(context.cast_profiles);
  const base = {
    ...context,
    cast_profiles: repairedCast,
    asset_plan_generated_cast_fingerprint: storage.canonicalFingerprint(repairedCast),
  };
  const currentRevision = Math.max(0, Number(context.revisions?.person || context.person_contract?.person_revision || 0) || 0);
  let repairedContext = null;
  for (let revision = currentRevision; revision >= 0; revision -= 1) {
    const candidate = {
      ...base,
      revisions: { ...(base.revisions || {}), person_semantic: revision },
    };
    if (activeFingerprint && assetPlan.fingerprint(task, candidate) === activeFingerprint) {
      repairedContext = candidate;
      break;
    }
  }
  const ambiguous = billingAuthorization.ambiguousUnits(taskId);
  const risk = taskStateAudit.billingRiskForTask(storage.readDb(), taskId);
  const unquarantinedModelCalls = risk.unquarantined_unknown_billing
    .filter(item => item.source !== 'generation_checkpoint');
  return {
    task, context, activePlan, activeFingerprint, repairedContext,
    current_fingerprint: assetPlan.fingerprint(task, context),
    repaired_fingerprint: repairedContext ? assetPlan.fingerprint(task, repairedContext) : '',
    changed: Boolean(repairedContext) && storage.canonicalFingerprint(context) !== storage.canonicalFingerprint(repairedContext),
    repairable: Boolean(activePlan && activeFingerprint && repairedContext),
    active_generation: text(task.active_generation_id),
    checkpoint_summary: checkpointSummary(taskId),
    ambiguous_units: ambiguous.map(unit => ({
      key: unit.review_key, status: unit.checkpoint.status,
      billing_state: unit.checkpoint.billing_state, authorized: unit.authorized === true,
    })),
    unauthorized_unknown_count: ambiguous.filter(unit => !unit.authorized).length,
    unquarantined_model_call_count: unquarantinedModelCalls.length,
  };
}

function blockedError(code, message, report) {
  const error = new Error(message); error.code = code; error.report = report; return error;
}

function apply(taskId = '') {
  const report = preview(taskId);
  if (report.active_generation) throw blockedError('VISUAL_LINEAGE_RECOVERY_ACTIVE_TASK_BLOCKED', '活动生成未结束，禁止恢复写入。', report);
  if (report.unauthorized_unknown_count) {
    throw blockedError('VISUAL_LINEAGE_RECOVERY_BILLING_UNKNOWN_BLOCKED', '存在未人工核清的计费未知checkpoint，禁止恢复写入或重试。', report);
  }
  if (report.unquarantined_model_call_count) {
    throw blockedError('VISUAL_LINEAGE_RECOVERY_MODEL_CALL_UNKNOWN_BLOCKED', '存在未隔离的计费未知model_call，禁止恢复写入。', report);
  }
  if (!report.repairable) throw blockedError('VISUAL_LINEAGE_RECOVERY_FINGERPRINT_UNPROVEN', '无法从Active Plan证明文字输入血缘，禁止猜测修复。', report);
  if (!report.changed) return { ...report, applied: false, model_calls_delta: 0 };
  const beforeCalls = (storage.getTaskBundle(taskId, { diagnostics: true }).model_calls || []).length;
  const backupKind = 'visual_generation_lineage_recovery_backup_v65';
  storage.withWriteBatch(() => {
    if (!storage.getOutput(taskId, backupKind)) storage.saveOutput(taskId, backupKind, {
      schema_version: 1, task_request: report.task.request || {}, context: report.context,
      active_plan_fingerprint: report.activeFingerprint, created_at: new Date().toISOString(),
    });
    storage.saveOutput(taskId, 'context', report.repairedContext);
    storage.updateTask(taskId, {
      request: {
        ...(report.task.request || {}),
        cast_profiles: report.repairedContext.cast_profiles,
        revisions: report.repairedContext.revisions,
        asset_plan_generated_cast_fingerprint: report.repairedContext.asset_plan_generated_cast_fingerprint,
      },
      updated_at: new Date().toISOString(),
    }, { systemFinalization: true });
  });
  const afterCalls = (storage.getTaskBundle(taskId, { diagnostics: true }).model_calls || []).length;
  if (afterCalls !== beforeCalls) throw new Error('VISUAL_LINEAGE_RECOVERY_MODEL_CALL_DELTA');
  return { ...report, applied: true, backup_kind: backupKind, model_calls_delta: 0 };
}

if (require.main === module) {
  const taskId = text(process.argv.find(arg => arg.startsWith('--task='))).split('=').slice(1).join('=');
  if (!taskId) throw new Error('Usage: node scripts/repair-story-ad-visual-generation-lineage-v65.js --task=<task-id> [--apply]');
  const report = process.argv.includes('--apply') ? apply(taskId) : preview(taskId);
  console.log(JSON.stringify({
    task_id: taskId, dry_run: !process.argv.includes('--apply'), applied: report.applied === true,
    repairable: report.repairable, changed: report.changed,
    current_fingerprint: report.current_fingerprint, active_fingerprint: report.activeFingerprint,
    repaired_fingerprint: report.repaired_fingerprint,
    checkpoints: report.checkpoint_summary,
    unauthorized_unknown_count: report.unauthorized_unknown_count,
    unquarantined_model_call_count: report.unquarantined_model_call_count,
    model_calls_delta: report.model_calls_delta || 0,
  }, null, 2));
}

module.exports = { apply, checkpointSummary, preview, restoreAuthoritativeCast };
