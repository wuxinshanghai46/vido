#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const storage = require('../src/services/newStoryAd/storageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const taskStateAudit = require('../src/services/newStoryAd/taskStateAuditService');

const PLAN_KINDS = ['asset_plan', 'asset_plan_active', 'asset_plan_candidate'];

function signature(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || null)).digest('hex');
}

function profilesFromOutput(output = null) {
  return Array.isArray(output?.plan?.cast_profiles) ? output.plan.cast_profiles
    : (Array.isArray(output?.cast_profiles) ? output.cast_profiles : []);
}

function normalizeProfiles(profiles = [], context = {}) {
  return profiles.map(profile => ({
    ...profile,
    ...assetPlan.normalizeProfileDemographics(profile, profile, context, profiles.length),
  }));
}

function updatePlanOutput(output = null, context = {}, fingerprint = '') {
  if (!output || typeof output !== 'object') return output;
  if (output.plan && typeof output.plan === 'object') {
    const castProfiles = normalizeProfiles(output.plan.cast_profiles || [], context);
    const domainState = Object.fromEntries(Object.entries(output.plan.domain_state || {}).map(([key, value]) => [key, {
      ...value, fingerprint: fingerprint || value?.fingerprint || '',
    }]));
    const plan = { ...output.plan, cast_profiles: castProfiles, fingerprint: fingerprint || output.plan.fingerprint };
    if (Object.keys(domainState).length) plan.domain_state = domainState;
    return { ...output, fingerprint: fingerprint || output.fingerprint, domain_state: plan.domain_state || output.domain_state, plan };
  }
  return {
    ...output,
    cast_profiles: normalizeProfiles(output.cast_profiles || [], context),
    fingerprint: fingerprint || output.fingerprint,
  };
}

function invariantSnapshot(context = {}, outputs = {}) {
  const activePlan = outputs.asset_plan_active?.plan || outputs.asset_plan_active || {};
  return {
    ids: (context.cast_profiles || []).map(profile => profile.id),
    looks: (context.cast_profiles || []).map(profile => ({ id: profile.id, look_profiles: profile.look_profiles || [] })),
    scene_plan: activePlan.scene_plan || outputs.asset_plan?.scene_plan || context.scene_plan || null,
  };
}

function preview(taskId = '') {
  const task = storage.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.active_generation_id || ['queued', 'running', 'processing'].includes(String(task.status || ''))) {
    const error = new Error('PERSON_DEMOGRAPHICS_MIGRATION_ACTIVE_TASK_BLOCKED');
    error.code = 'PERSON_DEMOGRAPHICS_MIGRATION_ACTIVE_TASK_BLOCKED';
    throw error;
  }
  const billingRisk = taskStateAudit.billingRiskForTask(storage.readDb(), taskId);
  if (billingRisk.active_unknown_billing.length || billingRisk.unquarantined_unknown_billing.length) {
    const error = new Error('PERSON_DEMOGRAPHICS_MIGRATION_BILLING_UNKNOWN_BLOCKED');
    error.code = 'PERSON_DEMOGRAPHICS_MIGRATION_BILLING_UNKNOWN_BLOCKED';
    throw error;
  }
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const before = Array.isArray(context.cast_profiles) ? context.cast_profiles : [];
  const after = normalizeProfiles(before, context);
  const primary = after[0] || {};
  const nextContext = {
    ...context,
    cast_profiles: after,
    narrative_cast_profiles: normalizeProfiles(context.narrative_cast_profiles || [], context),
    person_demographics_contract_version: 1,
    person_spec: {
      ...(context.person_spec || {}),
      age: primary.age || primary.age_range || context.person_spec?.age || '',
      ethnicity: primary.ethnicity || context.person_spec?.ethnicity || '',
    },
  };
  nextContext.asset_plan_generated_cast_fingerprint = storage.canonicalFingerprint(after);
  const nextFingerprint = assetPlan.fingerprint(task, nextContext);
  nextContext.asset_plan_fingerprint = nextFingerprint;
  const outputs = Object.fromEntries(PLAN_KINDS.map(kind => [kind, storage.getOutput(taskId, kind) || null]));
  const nextOutputs = Object.fromEntries(PLAN_KINDS.map(kind => [kind, updatePlanOutput(outputs[kind], nextContext, nextFingerprint)]));
  const beforeInvariant = invariantSnapshot(context, outputs);
  const afterInvariant = invariantSnapshot(nextContext, nextOutputs);
  if (signature(beforeInvariant) !== signature(afterInvariant)) {
    const error = new Error('PERSON_DEMOGRAPHICS_MIGRATION_INVARIANT_VIOLATION');
    error.code = 'PERSON_DEMOGRAPHICS_MIGRATION_INVARIANT_VIOLATION';
    throw error;
  }
  return {
    task, context, nextContext, outputs, nextOutputs, before, after,
    changed: signature(context) !== signature(nextContext)
      || PLAN_KINDS.some(kind => signature(outputs[kind]) !== signature(nextOutputs[kind])),
    fingerprint: nextFingerprint,
    before_summary: before.map(profile => ({ id: profile.id, age: profile.age || profile.age_range || '', ethnicity: profile.ethnicity || '' })),
    after_summary: after.map(profile => ({ id: profile.id, age: profile.age || profile.age_range || '', age_source: profile.age_source || '', ethnicity: profile.ethnicity || '', ethnicity_source: profile.ethnicity_source || '' })),
  };
}

function apply(taskId = '') {
  const report = preview(taskId);
  if (!report.changed) return { ...report, applied: false, reason: 'already_migrated', model_calls_delta: 0 };
  const beforeCalls = (storage.getTaskBundle(taskId, { diagnostics: true }).model_calls || []).length;
  const backupKind = 'person_demographics_migration_backup_v63';
  storage.withWriteBatch(() => {
    if (!storage.getOutput(taskId, backupKind)) {
      storage.saveOutput(taskId, backupKind, {
        schema_version: 1,
        task_request: report.task.request || {},
        context: report.context,
        ...report.outputs,
        created_at: new Date().toISOString(),
      });
    }
    for (const kind of ['asset_plan_candidate', 'asset_plan']) {
      if (report.nextOutputs[kind]) storage.saveOutput(taskId, kind, report.nextOutputs[kind]);
    }
    storage.saveOutput(taskId, 'context', report.nextContext);
    storage.updateTask(taskId, {
      request: {
        ...(report.task.request || {}),
        cast_profiles: report.nextContext.cast_profiles,
        narrative_cast_profiles: report.nextContext.narrative_cast_profiles,
        person_spec: report.nextContext.person_spec,
        person_demographics_contract_version: report.nextContext.person_demographics_contract_version,
        asset_plan_generated_cast_fingerprint: report.nextContext.asset_plan_generated_cast_fingerprint,
        asset_plan_fingerprint: report.nextContext.asset_plan_fingerprint,
      },
      updated_at: new Date().toISOString(),
    }, { systemFinalization: true });
    // Active Plan 是唯一付费生成权威，必须最后发布，避免前序写入失败时出现半份新权威。
    if (report.nextOutputs.asset_plan_active) storage.saveOutput(taskId, 'asset_plan_active', report.nextOutputs.asset_plan_active);
  });
  const afterCalls = (storage.getTaskBundle(taskId, { diagnostics: true }).model_calls || []).length;
  if (afterCalls !== beforeCalls) throw new Error('PERSON_DEMOGRAPHICS_MIGRATION_MODEL_CALL_DELTA');
  return { ...report, applied: true, backup_kind: backupKind, model_calls_delta: afterCalls - beforeCalls };
}

if (require.main === module) {
  const taskId = String(process.argv.find(arg => arg.startsWith('--task=')) || '').split('=').slice(1).join('=').trim();
  if (!taskId) throw new Error('Usage: node scripts/migrate-story-ad-person-demographics-v63.js --task=<task-id> [--apply]');
  const report = process.argv.includes('--apply') ? apply(taskId) : preview(taskId);
  console.log(JSON.stringify({
    task_id: taskId,
    applied: report.applied === true,
    changed: report.changed,
    before: report.before_summary,
    after: report.after_summary,
    fingerprint: report.fingerprint,
    backup_kind: report.backup_kind || '',
    model_calls_delta: report.model_calls_delta || 0,
  }));
}

module.exports = { apply, invariantSnapshot, normalizeProfiles, preview, updatePlanOutput };
