#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const storage = require('../src/services/newStoryAd/storageService');
const personCountContract = require('../src/services/newStoryAd/personCountContractService');

function signature(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || null)).digest('hex');
}

function countFields(source = {}) {
  const resolved = personCountContract.contract(source);
  return {
    narrative_cast_profiles: resolved.narrative_profiles,
    narrative_identity_count: resolved.narrative_identity_count,
    planning_cast_count: resolved.planning_cast_count,
    visual_asset_count: resolved.visual_asset_count,
    expected_people: resolved.visual_asset_count,
  };
}

function updatePlan(plan = {}, fields = {}) {
  if (!plan || typeof plan !== 'object') return plan;
  return {
    ...plan,
    narrative_cast_profiles: fields.narrative_cast_profiles,
    narrative_identity_count: fields.narrative_identity_count,
    planning_cast_count: fields.planning_cast_count,
    visual_asset_count: fields.visual_asset_count,
  };
}

function preview(taskId = '') {
  const task = storage.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.active_generation_id || ['queued', 'running', 'processing'].includes(String(task.status || ''))) {
    const error = new Error('PERSON_COUNT_CONTRACT_MIGRATION_ACTIVE_TASK_BLOCKED');
    error.code = 'PERSON_COUNT_CONTRACT_MIGRATION_ACTIVE_TASK_BLOCKED';
    throw error;
  }
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const fields = countFields(context);
  const nextContext = {
    ...context,
    ...fields,
    person_count_contract_version: 1,
    person_spec: {
      ...(context.person_spec || {}),
      expectedPeople: fields.visual_asset_count,
      narrativeIdentityCount: fields.narrative_identity_count,
      planningCastCount: fields.planning_cast_count,
      visualAssetCount: fields.visual_asset_count,
    },
  };
  return {
    task,
    context,
    fields,
    nextContext,
    changed: signature(context) !== signature(nextContext),
    before: {
      expected_people: Number(context.expected_people || 0) || 0,
      planning_cast_count: Number(context.planning_cast_count || 0) || 0,
      visual_asset_count: Number(context.visual_asset_count || 0) || 0,
    },
    after: {
      expected_people: fields.expected_people,
      planning_cast_count: fields.planning_cast_count,
      narrative_identity_count: fields.narrative_identity_count,
      visual_asset_count: fields.visual_asset_count,
    },
  };
}

function apply(taskId = '') {
  const report = preview(taskId);
  if (!report.changed) return { ...report, applied: false, reason: 'already_migrated' };
  const backupKind = 'person_count_contract_migration_backup_v174';
  if (!storage.getOutput(taskId, backupKind)) {
    storage.saveOutput(taskId, backupKind, {
      schema_version: 1,
      task_request: report.task.request || {},
      context: report.context,
      asset_plan: storage.getOutput(taskId, 'asset_plan') || null,
      asset_plan_active: storage.getOutput(taskId, 'asset_plan_active') || null,
      asset_plan_candidate: storage.getOutput(taskId, 'asset_plan_candidate') || null,
      created_at: new Date().toISOString(),
    });
  }
  ['asset_plan', 'asset_plan_active', 'asset_plan_candidate'].forEach(kind => {
    const plan = storage.getOutput(taskId, kind);
    if (plan) storage.saveOutput(taskId, kind, updatePlan(plan, report.fields));
  });
  storage.saveOutput(taskId, 'context', report.nextContext);
  storage.updateTask(taskId, {
    request: { ...(report.task.request || {}), ...report.nextContext },
    updated_at: new Date().toISOString(),
  }, { systemFinalization: true });
  return { ...report, applied: true, backup_kind: backupKind };
}

if (require.main === module) {
  const taskId = String(process.argv.find(arg => arg.startsWith('--task=')) || '').split('=').slice(1).join('=').trim();
  if (!taskId) throw new Error('Usage: node scripts/migrate-story-ad-person-count-contract-v174.js --task=<task-id> [--apply]');
  const report = process.argv.includes('--apply') ? apply(taskId) : preview(taskId);
  console.log(JSON.stringify({
    task_id: taskId,
    applied: report.applied === true,
    changed: report.changed,
    before: report.before,
    after: report.after,
    backup_kind: report.backup_kind || '',
    model_calls: 0,
  }));
}

module.exports = { apply, countFields, preview, updatePlan };
