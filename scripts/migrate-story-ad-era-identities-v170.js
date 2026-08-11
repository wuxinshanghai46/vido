#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const storage = require('../src/services/newStoryAd/storageService');
const personLooks = require('../src/services/newStoryAd/personLookProfileService');

function modeForCount(count = 0) {
  if (!count) return 'no_human';
  if (count === 1) return 'single';
  if (count === 2) return 'dual';
  return 'multi';
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || [])).digest('hex');
}

function migratePlan(plan = {}, profiles = [], castMode = 'auto') {
  if (!plan || typeof plan !== 'object') return plan;
  const scenePlan = plan.scene_plan && typeof plan.scene_plan === 'object'
    ? { ...plan.scene_plan, cast_mode: castMode }
    : plan.scene_plan;
  return { ...plan, cast_profiles: profiles, ...(scenePlan ? { scene_plan: scenePlan } : {}) };
}

function preview(taskId = '') {
  const task = storage.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.active_generation_id || ['queued', 'running', 'processing'].includes(String(task.status || ''))) {
    const error = new Error('ERA_IDENTITY_MIGRATION_ACTIVE_TASK_BLOCKED');
    error.code = 'ERA_IDENTITY_MIGRATION_ACTIVE_TASK_BLOCKED';
    throw error;
  }
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const before = Array.isArray(context.cast_profiles) ? context.cast_profiles : [];
  const after = personLooks.splitCrossEraProfiles(before, { brief: context.brief || task.brief || '' });
  return {
    task,
    context,
    before,
    after,
    changed: fingerprint(before) !== fingerprint(after),
    cast_mode: modeForCount(after.length),
    before_names: before.map(item => item.displayName || item.name || item.id),
    after_names: after.map(item => item.displayName || item.name || item.id),
    retained_checkpoint_subject_ids: after.filter(item => item.era_identity === 'ancient')
      .map(item => item.lineage_identity_id || item.source_identity_id).filter(Boolean),
    pending_new_subject_ids: after.filter(item => item.era_identity === 'modern')
      .map(item => item.id).filter(Boolean),
  };
}

function apply(taskId = '') {
  const report = preview(taskId);
  if (!report.changed) return { ...report, applied: false, reason: 'already_migrated' };
  const { task, context, before, after, cast_mode: castMode } = report;
  const backupKind = 'era_identity_migration_backup_v170';
  if (!storage.getOutput(taskId, backupKind)) {
    storage.saveOutput(taskId, backupKind, {
      schema_version: 1,
      task_request: task.request || {},
      context,
      asset_plan: storage.getOutput(taskId, 'asset_plan') || null,
      asset_plan_active: storage.getOutput(taskId, 'asset_plan_active') || null,
      asset_plan_candidate: storage.getOutput(taskId, 'asset_plan_candidate') || null,
      scene_config: storage.getOutput(taskId, 'scene_config') || null,
      created_at: new Date().toISOString(),
    });
  }
  const primary = after[0] || {};
  const nextContext = {
    ...context,
    cast_profiles: after,
    cast_mode: castMode,
    expected_people: after.length,
    asset_setup_confirmed: false,
    shot_design_confirmed: false,
    asset_plan_generated_cast_fingerprint: fingerprint(after),
    era_identity_contract_version: 2,
    person_spec: {
      ...(context.person_spec || {}),
      castMode,
      expectedPeople: after.length,
      displayName: primary.displayName || primary.name || '',
      roleName: primary.roleName || primary.role || '',
      appearanceText: primary.appearanceText || '',
      wardrobeText: primary.wardrobeText || '',
      look_profiles: primary.look_profiles || [],
      hairMakeupText: primary.hairMakeupText || '',
      negativeText: primary.negativeText || '',
    },
  };
  ['asset_plan', 'asset_plan_active', 'asset_plan_candidate'].forEach(kind => {
    const plan = storage.getOutput(taskId, kind);
    if (plan) storage.saveOutput(taskId, kind, migratePlan(plan, after, castMode));
  });
  const sceneConfig = storage.getOutput(taskId, 'scene_config');
  if (sceneConfig) storage.saveOutput(taskId, 'scene_config', { ...sceneConfig, cast_mode: castMode });
  storage.saveOutput(taskId, 'context', nextContext);
  storage.updateTask(taskId, {
    request: { ...(task.request || {}), ...nextContext },
    updated_at: new Date().toISOString(),
  }, { systemFinalization: true });
  return { ...report, applied: true, backup_kind: backupKind, before_count: before.length, after_count: after.length };
}

if (require.main === module) {
  const taskId = String(process.argv.find(arg => arg.startsWith('--task=')) || '').split('=').slice(1).join('=').trim();
  const shouldApply = process.argv.includes('--apply');
  if (!taskId) throw new Error('Usage: node scripts/migrate-story-ad-era-identities-v170.js --task=<task-id> [--apply]');
  const report = shouldApply ? apply(taskId) : preview(taskId);
  console.log(JSON.stringify({
    task_id: taskId,
    apply_requested: shouldApply,
    applied: report.applied === true,
    changed: report.changed,
    before_names: report.before_names,
    after_names: report.after_names,
    retained_checkpoint_subject_ids: report.retained_checkpoint_subject_ids,
    pending_new_subject_ids: report.pending_new_subject_ids,
    backup_kind: report.backup_kind || '',
  }));
}

module.exports = { apply, migratePlan, modeForCount, preview };
