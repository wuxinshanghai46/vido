#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const storage = require('../src/services/newStoryAd/storageService');
const releaseBundle = require('../src/services/storyAdReleaseBundleService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const checkpointLineage = require('../src/services/newStoryAd/assetPlanCheckpointLineageService');
const contentSkill = require('../src/services/newStoryAd/contentSkillService');
const briefAuthority = require('../src/services/newStoryAd/briefAuthorityService');
const sectionRecovery = require('../src/services/newStoryAd/assetPlanSectionRecoveryContractService');

const MIGRATION_ID = 'story-ad-v120-to-v126-deterministic-checkpoint-v1';
const SOURCE_BUILD_DEFAULT = '20260809-platform-cinematic-layers-v120';
const SOURCE_CONTRACT = 'story-scene-platform-v6';
const BACKUP_KIND = 'asset_plan_release_migration_v126_backup';
const RECORD_KIND = 'asset_plan_release_migration_v126';
const PLANNING_KINDS = Object.freeze([
  'asset_plan_draft_checkpoint',
  'asset_plan_candidate',
  'asset_plan_active',
  'asset_plan',
]);
const SOURCE_SEMANTICS = Object.freeze({
  story_facts_schema_version: 'story-facts-v1',
  normalizer_version: 'narrative-normalizer-v1',
  topology_compiler_version: 'topology-compiler-v1',
  validator_version: 'story-scene-validator-v6',
  scene_layer_contract_version: 'scene-layer-contract-v6',
  reference_expansion_contract_version: 'reference-evidence-expansion-v6',
  storyboard_coverage_contract_version: 'story-beat-shot-coverage-v6',
});

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sourceEnvelopeIssues(envelope = {}, options = {}) {
  const issues = [];
  if (String(envelope.producer_bundle_id || '') !== options.sourceBundle) issues.push('source_bundle_mismatch');
  if (String(envelope.build_id || '') !== options.sourceBuild) issues.push('source_build_mismatch');
  if (String(envelope.contract_version || '') !== SOURCE_CONTRACT) issues.push('source_contract_mismatch');
  Object.entries(SOURCE_SEMANTICS).forEach(([key, expected]) => {
    if (String(envelope[key] || '') !== expected) issues.push(`source_${key}_mismatch`);
  });
  return issues;
}

function contextFor(task) {
  return storage.getOutput(task.id, 'context') || task.request || {};
}

function planningSnapshot(task) {
  return Object.fromEntries(PLANNING_KINDS.map(kind => [kind, clone(storage.getOutput(task.id, kind))]));
}

function sourceHash(task, planning) {
  return sha({
    task: {
      id: task.id,
      content_revision: Number(task.content_revision || 1) || 1,
      planning_migration_state: task.planning_migration_state || '',
      required_bundle_id: task.required_bundle_id || '',
    },
    planning,
  });
}

function validateDraft(task, context, draft, expectedFingerprint, expectedMode, options) {
  if (!draft) return { present: false, valid: false, issues: [] };
  const issues = sourceEnvelopeIssues(draft.release_envelope, options);
  const validSections = assetPlan.validAssetPlanSections(draft.payload, context);
  const missingSections = assetPlan.missingAssetPlanSections(draft.payload, context);
  const modeViolations = assetPlan.rawContentModeViolations(draft.payload, context);
  if (Number(draft.content_revision || 0) !== Number(task.content_revision || 1)) issues.push('draft_content_revision_mismatch');
  if (String(draft.fingerprint || '') !== expectedFingerprint) issues.push('draft_input_fingerprint_mismatch');
  if (String(draft.content_mode || '') !== expectedMode) issues.push('draft_content_mode_mismatch');
  if (draft.reusable !== true) issues.push('draft_not_reusable');
  if (!assetPlan.reusableDraftPayload(draft.payload, context)) issues.push('draft_payload_not_reusable');
  if (modeViolations.length) issues.push(...modeViolations.map(issue => `draft_content_mode:${issue}`));
  return {
    present: true,
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    valid_sections: validSections,
    missing_sections: missingSections,
  };
}

function validateActive(task, context, active, expectedFingerprint, expectedMode, options) {
  if (!active) return { present: false, valid: false, issues: [] };
  const plan = active.plan || null;
  const issues = [];
  if (!plan || typeof plan !== 'object') issues.push('active_plan_missing');
  issues.push(...sourceEnvelopeIssues(plan?.release_envelope, options));
  issues.push(...sourceEnvelopeIssues(active.release_envelope, options).map(issue => `record_${issue}`));
  if (String(plan?.status || '') !== 'active') issues.push('active_plan_status_invalid');
  if (Number(plan?.content_revision || 0) !== Number(task.content_revision || 1)) issues.push('active_content_revision_mismatch');
  if (String(plan?.fingerprint || active.fingerprint || '') !== expectedFingerprint) issues.push('active_input_fingerprint_mismatch');
  if (String(plan?.content_mode || '') !== expectedMode) issues.push('active_content_mode_mismatch');
  if (plan && !assetPlan.complete(plan, context)) issues.push('active_plan_incomplete');
  if (plan) {
    try { assetPlan.assertContentModeIsolation(plan, context); } catch (error) { issues.push(error.code || 'active_content_mode_invalid'); }
    try { briefAuthority.assertPlanAuthority(plan, context); } catch (error) { issues.push(error.code || 'active_authority_invalid'); }
  }
  return { present: true, valid: issues.length === 0, issues: [...new Set(issues)] };
}

function analyze(task, options) {
  const context = contextFor(task);
  const planning = planningSnapshot(task);
  const expectedFingerprint = assetPlan.fingerprint(task, context);
  const expectedMode = contentSkill.mode(context.content_mode || context.product_presentation?.mode);
  const existing = storage.getOutput(task.id, RECORD_KIND);
  const targetBundleId = releaseBundle.identity().bundle_id;
  if (existing?.migration_id === MIGRATION_ID
    && existing?.status === 'applied'
    && existing?.target_bundle_id === targetBundleId) {
    return {
      migration_id: MIGRATION_ID,
      task_id: task.id,
      state: 'already_migrated',
      source_hash: existing.source_hash,
      source_bundle_id: existing.source_bundle_id,
      source_build_id: options.sourceBuild,
      target_bundle_id: targetBundleId,
      content_revision: Number(task.content_revision || 1) || 1,
      content_mode: expectedMode,
      expected_fingerprint: expectedFingerprint,
      draft: { present: Boolean(planning.asset_plan_draft_checkpoint), valid: false, issues: [] },
      active: { present: Boolean(planning.asset_plan_active), valid: false, issues: [] },
      issues: [],
      planning,
    };
  }
  const activeGeneration = Boolean(String(task.active_generation_id || '').trim());
  const canceled = ['cancelled', 'canceled', 'deleted'].includes(String(task.status || '').toLowerCase());
  const draft = validateDraft(task, context, planning.asset_plan_draft_checkpoint, expectedFingerprint, expectedMode, options);
  const active = validateActive(task, context, planning.asset_plan_active, expectedFingerprint, expectedMode, options);
  const present = draft.present || active.present;
  const issues = [
    ...(activeGeneration ? ['active_generation_present'] : []),
    ...(canceled ? ['task_not_mutable'] : []),
    ...draft.issues,
    ...active.issues,
  ];
  let state = 'no_v120_checkpoint';
  if (activeGeneration) state = 'blocked_active_generation';
  else if (canceled) state = 'legacy_read_only';
  else if (present && issues.length === 0) state = 'migratable';
  else if (present) state = 'replan_required';
  return {
    migration_id: MIGRATION_ID,
    task_id: task.id,
    state,
    source_hash: sourceHash(task, planning),
    source_bundle_id: options.sourceBundle,
    source_build_id: options.sourceBuild,
    target_bundle_id: releaseBundle.identity().bundle_id,
    content_revision: Number(task.content_revision || 1) || 1,
    content_mode: expectedMode,
    expected_fingerprint: expectedFingerprint,
    draft,
    active,
    issues: [...new Set(issues)],
    planning,
  };
}

function migrationEnvelope(report) {
  return releaseBundle.envelope({
    content_revision: report.content_revision,
    migrated_from_bundle_id: report.source_bundle_id,
    migration_id: MIGRATION_ID,
  });
}

function migratedPlan(report, source) {
  const envelope = migrationEnvelope(report);
  const planId = `migrated-${sha({ migration_id: MIGRATION_ID, source_hash: report.source_hash, target_bundle_id: report.target_bundle_id }).slice(0, 32)}`;
  const activeRevision = Math.max(1, Number(source.active_revision || source.plan?.active_revision || 0) + 1);
  const plan = {
    ...clone(source.plan),
    candidate_id: planId,
    status: 'active',
    active_revision: activeRevision,
    release_envelope: envelope,
    release_migration: {
      migration_id: MIGRATION_ID,
      source_bundle_id: report.source_bundle_id,
      source_hash: report.source_hash,
      target_bundle_id: report.target_bundle_id,
    },
  };
  return {
    planId,
    activeRevision,
    plan,
    active: {
      ...clone(source),
      plan_id: planId,
      active_revision: activeRevision,
      release_envelope: envelope,
      plan,
    },
  };
}

function backupPayload(task, report) {
  return {
    migration_id: MIGRATION_ID,
    task_id: task.id,
    content_revision: report.content_revision,
    source_hash: report.source_hash,
    source_bundle_id: report.source_bundle_id,
    target_bundle_id: report.target_bundle_id,
    task_fields: {
      planning_migration_state: task.planning_migration_state,
      planning_migration_id: task.planning_migration_id,
      required_bundle_id: task.required_bundle_id,
      legacy_planning_read_only: task.legacy_planning_read_only,
    },
    planning: report.planning,
    created_at: new Date().toISOString(),
  };
}

function savePlanning(taskId, kind, value, revision) {
  if (value === null || value === undefined) storage.deleteOutput(taskId, kind);
  else storage.saveOutput(taskId, kind, value, { content_revision: revision });
}

function applyMigration(task, report) {
  const existing = storage.getOutput(task.id, RECORD_KIND);
  if (existing?.migration_id === MIGRATION_ID
    && existing?.source_hash === report.source_hash
    && existing?.target_bundle_id === report.target_bundle_id
    && existing?.status === 'applied') return { ...report, applied: true, idempotent_skip: true, planning: undefined };

  if (report.state !== 'migratable') {
    if (report.state === 'replan_required' || report.state === 'legacy_read_only') {
      storage.updateTask(task.id, {
        planning_migration_state: report.state,
        planning_migration_id: MIGRATION_ID,
        required_bundle_id: report.target_bundle_id,
        legacy_planning_read_only: true,
      }, { systemFinalization: true });
    }
    return { ...report, applied: false, planning: undefined };
  }

  const backup = storage.getOutput(task.id, BACKUP_KIND);
  if (!backup || backup.migration_id !== MIGRATION_ID || backup.source_hash !== report.source_hash) {
    storage.saveOutput(task.id, BACKUP_KIND, backupPayload(task, report), { content_revision: report.content_revision });
  }
  const envelope = migrationEnvelope(report);
  if (report.draft.valid) {
    const sourceDraft = report.planning.asset_plan_draft_checkpoint;
    const checkpointId = `migrated-checkpoint-${sha({
      migration_id: MIGRATION_ID,
      source_hash: report.source_hash,
      source_checkpoint_hash: sha(sourceDraft),
      target_bundle_id: report.target_bundle_id,
    }).slice(0, 32)}`;
    const draft = {
      ...clone(sourceDraft),
      ...checkpointLineage.checkpointFields(task),
      checkpoint_id: checkpointId,
      contract_version: sectionRecovery.CONTRACT_VERSION,
      generation_id: checkpointId,
      valid_sections: report.draft.valid_sections,
      missing_sections: report.draft.missing_sections,
      release_envelope: envelope,
      release_migration: {
        migration_id: MIGRATION_ID,
        source_bundle_id: report.source_bundle_id,
        source_hash: report.source_hash,
        source_checkpoint_id: sourceDraft.checkpoint_id || '',
        source_checkpoint_hash: sha(sourceDraft),
        target_checkpoint_id: checkpointId,
      },
    };
    savePlanning(task.id, 'asset_plan_draft_checkpoint', draft, report.content_revision);
  }
  if (report.active.valid) {
    const migrated = migratedPlan(report, report.planning.asset_plan_active);
    const candidate = {
      ...clone(migrated.plan),
      status: 'candidate',
      validation_status: 'passed',
      validation_issues: [],
    };
    savePlanning(task.id, 'asset_plan_candidate', candidate, report.content_revision);
    savePlanning(task.id, 'asset_plan_active', migrated.active, report.content_revision);
    savePlanning(task.id, 'asset_plan', migrated.plan, report.content_revision);
  }
  const record = {
    migration_id: MIGRATION_ID,
    status: 'applied',
    task_id: task.id,
    source_hash: report.source_hash,
    source_bundle_id: report.source_bundle_id,
    target_bundle_id: report.target_bundle_id,
    migrated_draft: report.draft.valid,
    migrated_active_plan: report.active.valid,
    model_calls: 0,
    paid_calls: 0,
    applied_at: new Date().toISOString(),
  };
  storage.saveOutput(task.id, RECORD_KIND, record, { content_revision: report.content_revision });
  storage.updateTask(task.id, {
    ...checkpointLineage.currentPlanningTaskPatch(),
    planning_migration_id: MIGRATION_ID,
  }, { systemFinalization: true });
  return { ...report, ...record, applied: true, planning: undefined };
}

function rollbackTask(task) {
  const backup = storage.getOutput(task.id, BACKUP_KIND);
  const record = storage.getOutput(task.id, RECORD_KIND);
  if (!backup || backup.migration_id !== MIGRATION_ID || record?.status !== 'applied') {
    return { migration_id: MIGRATION_ID, task_id: task.id, rolled_back: false, reason: 'migration_backup_not_found' };
  }
  Object.entries(backup.planning || {}).forEach(([kind, value]) => savePlanning(task.id, kind, value, backup.content_revision || task.content_revision));
  storage.updateTask(task.id, backup.task_fields || {}, { systemFinalization: true });
  storage.saveOutput(task.id, RECORD_KIND, { ...record, status: 'rolled_back', rolled_back_at: new Date().toISOString() }, { content_revision: task.content_revision });
  return { migration_id: MIGRATION_ID, task_id: task.id, rolled_back: true, source_hash: backup.source_hash };
}

function main() {
  const apply = process.argv.includes('--apply');
  const rollback = process.argv.includes('--rollback');
  const summaryOnly = process.argv.includes('--summary-only');
  const sourceBuild = arg('--source-build', SOURCE_BUILD_DEFAULT);
  const sourceBundle = arg('--source-bundle');
  const taskId = arg('--task');
  if (!rollback && !/^[a-f0-9]{64}$/.test(sourceBundle)) {
    throw new Error('v120 migration requires an exact 64-character --source-bundle; build labels alone are not migration authority');
  }
  if (apply && rollback) throw new Error('--apply and --rollback are mutually exclusive');
  const tasks = taskId ? [storage.getTask(taskId)].filter(Boolean) : storage.listTasks({ limit: 5000 });
  const options = { sourceBuild, sourceBundle };
  const analyses = rollback ? [] : tasks.map(task => analyze(task, options));
  const hasBlockedTask = analyses.some(row => row.state === 'blocked_active_generation');
  const results = rollback
    ? tasks.map(rollbackTask)
    : analyses.map((report, index) => apply && !hasBlockedTask
      ? applyMigration(tasks[index], report)
      : ({ ...report, applied: false, planning: undefined }));
  const summary = results.reduce((acc, row) => {
    const key = rollback ? (row.rolled_back ? 'rolled_back' : row.reason) : row.state;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({
    apply,
    rollback,
    migration_id: MIGRATION_ID,
    source_build_id: sourceBuild,
    source_bundle_id: sourceBundle,
    target_bundle_id: releaseBundle.identity().bundle_id,
    task_count: results.length,
    summary,
    blocked_count: results.filter(row => row.state === 'blocked_active_generation').length,
    model_calls: 0,
    paid_calls: 0,
    results: summaryOnly ? undefined : results,
  }, null, 2));
  if (results.some(row => row.state === 'blocked_active_generation')) process.exitCode = 3;
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack || error.message || error); process.exitCode = 1; }
}

module.exports = {
  MIGRATION_ID,
  SOURCE_BUILD_DEFAULT,
  SOURCE_CONTRACT,
  SOURCE_SEMANTICS,
  BACKUP_KIND,
  RECORD_KIND,
  analyze,
  applyMigration,
  rollbackTask,
  sourceEnvelopeIssues,
};
