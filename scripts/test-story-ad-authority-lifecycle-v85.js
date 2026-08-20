'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-v85-authority-'));
process.env.DB_ENABLED = 'true';
process.env.DB_TYPE = 'sqlite';
process.env.DB_DUAL_WRITE = 'false';
process.env.DB_PATH = path.join(tempRoot, 'authority.sqlite');
process.env.OUTPUT_DIR = tempRoot;
process.env.CONTENT_RECORD_CACHE_TTL_MS = '0';
if (process.argv.includes('--python')) process.env.SQLITE_DRIVER = 'python';

const sqlite = require('../src/db/sqlite');
const db = sqlite.openDatabase({ force: true });
for (const file of fs.readdirSync(path.join(__dirname, '..', 'src', 'db', 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', file), 'utf8'));
}

const storage = require('../src/services/newStoryAd/storageService');
const lifecycle = require('../src/services/newStoryAd/authorityLifecycleService');
const generationUnits = require('../src/services/newStoryAd/generationUnitService');

const taskId = 'v85-authority-task';
storage.createTask({ id: taskId, title: 'authority proof', content_revision: 1, request: {} });
storage.saveOutput(taskId, 'asset_plan_candidate', {
  candidate_id: 'plan-1', status: 'candidate', validation_status: 'passed', content_revision: 1,
});
storage.saveOutput(taskId, 'asset_plan_active', {
  plan_id: 'plan-1', active_revision: 1, content_revision: 1, release_bundle_id: 'bundle-1',
  plan: { candidate_id: 'plan-1', status: 'active', active_revision: 1, content_revision: 1 },
});
const artifact = storage.saveArtifact(taskId, 'keyframes', [{ id: 'kf-1' }], { id: 'artifact-1' });
storage.createGenerationRun({
  id: 'legacy-run', task_id: taskId, work_id: taskId, state: 'succeeded', unit_version: 1,
  billing_state: 'confirmed', provider_submission_state: 'completed',
});

const first = lifecycle.ensureCurrent(taskId, storage.getOutput(taskId, 'asset_plan_active'));
assert.equal(first.state, 'active');
assert.equal(storage.getTask(taskId).active_authority_id, first.authority_id);
assert.equal(storage.getArtifact(artifact.id).authority_id, first.authority_id);
assert.equal(storage.getArtifact(artifact.id).execution_disabled, false);
assert.equal(storage.getGenerationRun('legacy-run').execution_disabled, true);

storage.createGenerationRun({
  id: 'retryable-old-run', task_id: taskId, work_id: taskId, state: 'failed_retryable', unit_version: 1,
  billing_state: 'not_billed', provider_submission_state: 'not_submitted', authority_id: first.authority_id,
  execution_identity: first.execution_identity,
});

const nextPlan = { candidate_id: 'plan-2', status: 'active', active_revision: 2, content_revision: 1 };
let second;
storage.withWriteBatch(() => {
  second = lifecycle.activate(taskId, nextPlan, {
    plan_id: 'plan-2', active_revision: 2, content_revision: 1, release_bundle_id: 'bundle-1',
  }, {
    candidate_id: 'plan-2', status: 'candidate', validation_status: 'passed', content_revision: 1,
  });
  storage.saveOutput(taskId, 'asset_plan_active', {
    plan_id: 'plan-2', active_revision: 2, content_revision: 1, release_bundle_id: 'bundle-1',
    authority_id: second.authority_id, authority_token: second.authority_token,
    execution_identity: second.execution_identity, plan: nextPlan,
  });
});

assert.notEqual(second.authority_id, first.authority_id);
assert.equal(storage.getOutput(taskId, lifecycle.historyKind(first.authority_id)).state, 'superseded');
assert.equal(storage.getOutput(taskId, lifecycle.candidateHistoryKind('plan-1')).execution_disabled, true);
assert.equal(storage.getGenerationRun('retryable-old-run').execution_disabled, true);
assert.equal(storage.getArtifact(artifact.id).cache_readonly, true);
assert.throws(() => lifecycle.assertCurrent(taskId, {
  authority_id: first.authority_id, authority_token: first.authority_token,
}), error => error?.code === 'EXECUTION_AUTHORITY_STALE');
assert.throws(() => generationUnits.transition('retryable-old-run', 'ready', {}, {
  expected_version: storage.getGenerationRun('retryable-old-run').unit_version,
}), error => error?.code === 'GENERATION_UNIT_EXECUTION_DISABLED');
assert.equal(lifecycle.assertCurrent(taskId, {
  authority_id: second.authority_id,
  authority_token: second.authority_token,
  execution_identity: second.execution_identity,
  plan_id: 'plan-2',
}).authority_id, second.authority_id);

sqlite.closeDatabase();
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log(JSON.stringify({
  passed: true,
  driver: process.argv.includes('--python') ? 'python' : 'native',
  unique_active: 1,
  old_runs_execution_disabled: 2,
  old_artifacts_cache_readonly: 1,
}));
