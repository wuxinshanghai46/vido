#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const apply = process.argv.includes('--apply');
const taskArg = process.argv.find((value, index, values) => values[index - 1] === '--task') || '';
const storage = require('../src/services/newStoryAd/storageService');
const releaseBundle = require('../src/services/storyAdReleaseBundleService');
const publication = require('../src/services/newStoryAd/assetPlanPublicationService');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../outputs'));
const MIGRATION_ID = 'story-ad-platform-v111-lineage-isolation-v1';
const PLANNING_KINDS = new Set([
  'asset_plan', 'scene_config', 'asset_plan_draft_checkpoint', 'asset_plan_candidate', 'asset_plan_active',
]);
const PAID_KIND = /(?:person|subject|prop|product|scene|keyframe|video|media|tts|audio).*(?:asset|output|result|generation|bundle)|(?:keyframes|video|media|tts)$/i;
const FINAL_KIND = /(?:final|compose|video|media_result|delivery)/i;

function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function outputKind(row = {}) {
  const id = String(row.id || '');
  return String(row.kind || (id.includes(':') ? id.slice(id.indexOf(':') + 1) : ''));
}

function classify(task, outputs) {
  const kinds = outputs.map(outputKind).filter(Boolean);
  const hasActiveGeneration = Boolean(String(task.active_generation_id || '').trim());
  const active = publication.activeRecord(task.id);
  const activeBundle = active?.plan?.release_envelope?.producer_bundle_id || '';
  const currentBundle = releaseBundle.identity().bundle_id;
  if (hasActiveGeneration) return { state: 'blocked_active_generation', can_replan: false };
  if (activeBundle === currentBundle) return { state: 'current_bundle', can_replan: true };
  if (kinds.some(kind => FINAL_KIND.test(kind)) || String(task.stage || '') === 'completed') {
    return { state: 'legacy_read_only', can_replan: false };
  }
  if (kinds.some(kind => !PLANNING_KINDS.has(kind) && PAID_KIND.test(kind))) {
    return { state: 'legacy_assets_read_only', can_replan: true };
  }
  if (String(task.status || '').toLowerCase() === 'failed' || /_failed$/.test(String(task.stage || '').toLowerCase())) {
    return { state: 'legacy_quarantine', can_replan: true };
  }
  return { state: 'replan_required', can_replan: true };
}

function reportFor(task) {
  const outputs = storage.listOutputs(task.id);
  const kinds = outputs.map(outputKind).filter(Boolean).sort();
  const classification = classify(task, outputs);
  const planning = outputs.filter(row => PLANNING_KINDS.has(outputKind(row)));
  return {
    migration_id: MIGRATION_ID,
    task_id: task.id,
    state: classification.state,
    can_replan: classification.can_replan,
    active_generation: Boolean(String(task.active_generation_id || '').trim()),
    legacy_planning_kinds: planning.map(outputKind).sort(),
    output_kinds: kinds,
    source_hash: sha({
      task: { id: task.id, content_revision: task.content_revision, status: task.status, stage: task.stage },
      planning: planning.map(row => ({ kind: outputKind(row), payload: row.payload })),
    }),
    target_bundle_id: releaseBundle.identity().bundle_id,
  };
}

function writeBackup(task, report) {
  const backupDir = path.join(OUTPUT_DIR, 'backups', 'story-ad-platform-v111');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${String(task.id).replace(/[^a-z0-9_-]/ig, '_')}-${report.source_hash.slice(0, 16)}.json`);
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, JSON.stringify({ task, outputs: storage.listOutputs(task.id), report }, null, 2), { mode: 0o600 });
  }
  return backupPath;
}

function migrate(task) {
  const report = reportFor(task);
  const existing = storage.getOutput(task.id, 'asset_plan_migration_v111');
  if (!apply || report.state === 'blocked_active_generation') return { ...report, applied: false, backup_path: '' };
  if (existing?.migration_id === MIGRATION_ID
    && existing?.source_hash === report.source_hash
    && existing?.target_bundle_id === report.target_bundle_id) {
    return { ...report, applied: true, idempotent_skip: true, backup_path: existing.backup_path || '' };
  }
  const backupPath = writeBackup(task, report);
  const record = {
    ...report,
    applied: true,
    backup_path: backupPath,
    applied_at: new Date().toISOString(),
    policy: {
      legacy_planning_read_only: true,
      implicit_fallback_forbidden: true,
      automatic_resume_forbidden: true,
      paid_generation_requires_current_active_plan: true,
    },
  };
  storage.saveOutput(task.id, 'asset_plan_migration_v111', record, { content_revision: task.content_revision });
  storage.updateTask(task.id, {
    planning_migration_state: report.state,
    planning_migration_id: MIGRATION_ID,
    required_bundle_id: report.target_bundle_id,
    legacy_planning_read_only: true,
  }, { systemFinalization: true });
  return record;
}

const tasks = taskArg
  ? [storage.getTask(taskArg)].filter(Boolean)
  : storage.listTasks({ limit: 5000 });
const results = tasks.map(migrate);
const summary = results.reduce((acc, row) => {
  acc[row.state] = (acc[row.state] || 0) + 1;
  return acc;
}, {});
console.log(JSON.stringify({
  apply,
  migration_id: MIGRATION_ID,
  task_count: results.length,
  summary,
  blocked_count: results.filter(row => row.state === 'blocked_active_generation').length,
  model_calls: 0,
  paid_calls: 0,
  results,
}, null, 2));
if (results.some(row => row.state === 'blocked_active_generation')) process.exitCode = 3;
