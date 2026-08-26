'use strict';

const storage = require('../src/services/newStoryAd/storageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const publication = require('../src/services/newStoryAd/assetPlanPublicationService');

function argument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

function modelCallCount(taskId) {
  return storage.listModelCalls(taskId).length;
}

function inspect(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw Object.assign(new Error('TASK_NOT_FOUND'), { code: 'TASK_NOT_FOUND' });
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const active = publication.activeRecord(taskId);
  const plan = active?.plan || null;
  const candidate = storage.getOutput(taskId, publication.CANDIDATE_KIND);
  const fingerprint = assetPlan.fingerprint(task, context);
  return {
    task,
    fingerprint,
    active,
    compatibility: publication.releaseCompatibility({
      task, context, plan, activeRecord: active, candidate, fingerprint,
    }),
  };
}

function main() {
  const taskId = argument('task');
  const apply = process.argv.includes('--apply');
  if (apply && !taskId) throw Object.assign(new Error('--apply requires explicit --task <id>'), { code: 'EXPLICIT_TASK_REQUIRED' });
  if (!taskId) throw Object.assign(new Error('dry-run requires explicit --task <id>'), { code: 'EXPLICIT_TASK_REQUIRED' });
  const before = inspect(taskId);
  const callsBefore = modelCallCount(taskId);
  let migration = { migrated: false, dry_run: true, compatibility: before.compatibility };
  if (apply) migration = publication.migrateCompatibleRelease(taskId, {
    fingerprint: before.fingerprint,
    reason: 'controlled_cli_release_migration',
  });
  const after = inspect(taskId);
  const callsAfter = modelCallCount(taskId);
  const report = {
    schema_version: 1,
    mode: apply ? 'apply' : 'dry-run',
    task_id: taskId,
    compatible: migration.compatibility?.compatible === true,
    issues: migration.compatibility?.issues || before.compatibility.issues,
    before_bundle_id: before.compatibility.from_bundle_id,
    required_bundle_id: before.compatibility.to_bundle_id,
    after_bundle_id: after.active?.plan?.release_envelope?.producer_bundle_id || '',
    plan_id_before: before.active?.plan_id || '',
    plan_id_after: after.active?.plan_id || '',
    active_revision_before: Number(before.active?.active_revision || 0),
    active_revision_after: Number(after.active?.active_revision || 0),
    migrated: migration.migrated === true,
    blocked: migration.blocked === true,
    idempotent: apply && before.compatibility.already_current === true && migration.migrated !== true,
    model_calls_before: callsBefore,
    model_calls_after: callsAfter,
    model_calls_added: callsAfter - callsBefore,
  };
  console.log(JSON.stringify(report));
  if (report.model_calls_added !== 0) throw Object.assign(new Error('MODEL_CALL_COUNT_CHANGED'), { code: 'MODEL_CALL_COUNT_CHANGED' });
  if (apply && migration.blocked) process.exitCode = 2;
  if (apply && !migration.migrated && !before.compatibility.already_current) process.exitCode = 3;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({ success: false, code: error.code || 'ACTIVE_PLAN_RELEASE_MIGRATION_FAILED', error: error.message }));
    process.exitCode = 1;
  }
}

module.exports = { argument, inspect, main, modelCallCount };
