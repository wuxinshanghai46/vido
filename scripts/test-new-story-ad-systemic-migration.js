'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-systemic-migration-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const migration = require('../src/services/newStoryAd/systemicMigrationService');

try {
  storage.createTask({ id: 'legacy-one', brief: 'legacy one', content_revision: 2, request: { brief: 'legacy one', content_mode: 'commercial_subject' } });
  storage.saveOutput('legacy-one', 'context', { brief: 'legacy one', brief_source: 'user', content_mode: 'commercial_subject' });
  storage.saveOutput('legacy-one', 'storyboard_table', [{ id: 'shot-1', title: 'first' }]);
  storage.createTask({ id: 'current-two', brief: 'current two', content_revision: 1, lineage_enforced: true, request: { brief: 'current two' } });
  storage.saveOutput('current-two', 'context', { brief: 'current two', brief_source: 'user' });
  storage.saveModelCall({
    id: 'legacy-call-unknown', task_id: 'legacy-one', stage: 'video', status: 'failed',
    provider_id: 'provider-a', model_id: 'model-a', provider_task_id: 'paid-task-1',
    provider_submission_state: 'submitted_unknown', billing_state: 'unknown', error_code: 'PROVIDER_5XX_AMBIGUOUS',
  });

  const beforeBytes = fs.readFileSync(storage.DB_PATH);
  const dry = migration.plan(storage.readDb());
  const afterDryBytes = fs.readFileSync(storage.DB_PATH);
  assert.strictEqual(Buffer.compare(beforeBytes, afterDryBytes), 0, 'dry-run 不得写数据库');
  assert.strictEqual(dry.model_calls_started, 0);
  assert.strictEqual(dry.tasks_to_enable_lineage.includes('legacy-one'), true);
  assert.strictEqual(dry.unknown_billing_to_quarantine.length, 1);

  const first = migration.apply();
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.model_calls_started, 0);
  assert.strictEqual(first.lineage_enabled, 1);
  assert.strictEqual(first.billing_quarantined, 1);
  assert.strictEqual(first.remaining.tasks_without_work, 0);
  assert.strictEqual(first.remaining.tasks_without_lineage, 0);
  assert.strictEqual(first.remaining.unknown_billing_without_quarantine, 0);
  const unit = storage.getGenerationRun(migration.legacyBillingId({ id: 'legacy-call-unknown' }));
  assert.strictEqual(unit.state, 'billing_unknown');
  assert.strictEqual(unit.retry_blocked, true);
  assert.strictEqual(unit.provider_task_id, 'paid-task-1');
  assert.strictEqual(storage.getWork('legacy-one').mode, 'authoritative');
  assert.strictEqual(first.authority_promoted, 2);
  assert.strictEqual(first.legacy_output_rows_pruned > 0, true);
  assert.strictEqual(storage.readDb().outputs.some(row => ['context', 'storyboard_table'].includes(row.kind)), false);
  assert.strictEqual(storage.getOutput('legacy-one', 'context').brief, 'legacy one');

  const second = migration.apply();
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.works_created, 0);
  assert.strictEqual(second.lineage_enabled, 0);
  assert.strictEqual(second.billing_quarantined, 0);
  assert.strictEqual(second.authority_promoted, 0);
  assert.strictEqual(storage.listGenerationRuns().length, 1, '重复迁移不得复制计费隔离单元');

  const legacyOutputCount = storage.readDb().outputs.length;
  storage.saveOutput('legacy-one', 'blueprint', { story_title: 'new blueprint' });
  const synced = storage.getWork('legacy-one');
  assert.strictEqual(synced.domain_payloads.blueprint.story_title, 'new blueprint', '核心输出写入必须自动维护 Work');
  assert.strictEqual(storage.getOutput('legacy-one', 'blueprint').story_title, 'new blueprint');
  assert.strictEqual(storage.listOutputs('legacy-one').find(row => row.kind === 'blueprint').authority, 'work');
  assert.strictEqual(storage.readDb().outputs.length, legacyOutputCount, '权威切换后核心输出不得继续写旧 outputs');

  console.log(JSON.stringify({
    passed: true,
    dry_run_read_only: true,
    idempotent_migration: true,
    lineage_enabled: first.lineage_enabled,
    billing_quarantined: first.billing_quarantined,
    model_calls_started: 0,
    output_write_syncs_work: true,
  }));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
