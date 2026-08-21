'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-v85-sqlite-batch-'));
process.env.DB_ENABLED = 'true';
process.env.DB_TYPE = 'sqlite';
process.env.DB_DUAL_WRITE = 'false';
process.env.DB_PATH = path.join(tempRoot, 'batch.sqlite');
process.env.OUTPUT_DIR = tempRoot;
process.env.CONTENT_RECORD_CACHE_TTL_MS = '0';
if (process.argv.includes('--python')) process.env.SQLITE_DRIVER = 'python';

const sqlite = require('../src/db/sqlite');
const db = sqlite.openDatabase({ force: true });
for (const file of fs.readdirSync(path.join(__dirname, '..', 'src', 'db', 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', file), 'utf8'));
}

const storage = require('../src/services/newStoryAd/storageService');
const taskId = 'v85-sqlite-atomic-task';
storage.createTask({ id: taskId, title: 'before', request: { brief: 'atomic proof' } });
const originalCreatedAt = storage.getTask(taskId).created_at;
storage.saveOutput(taskId, 'context', { version: 'before' });
storage.saveOutput(taskId, 'blueprint', { version: 'delete-proof' });

assert.throws(() => storage.withWriteBatch(() => {
  storage.updateTask(taskId, { title: 'must-rollback' });
  storage.saveOutput(taskId, 'context', { version: 'must-rollback' });
  storage.saveOutput(taskId, 'asset_plan_candidate', { id: 'candidate-rollback' });
  storage.deleteOutputs(taskId, ['blueprint']);
  storage.createGenerationRun({
    id: 'run-rollback', task_id: taskId, state: 'planned', unit_version: 1,
  });
  assert.equal(storage.getTask(taskId).title, 'must-rollback');
  assert.equal(storage.getOutput(taskId, 'asset_plan_candidate').id, 'candidate-rollback');
  assert.equal(storage.getOutput(taskId, 'blueprint'), null);
  throw new Error('EXPECTED_SQLITE_BATCH_ROLLBACK');
}), /EXPECTED_SQLITE_BATCH_ROLLBACK/);

assert.equal(storage.getTask(taskId).title, 'before');
assert.deepEqual(storage.getOutput(taskId, 'context'), { version: 'before' });
assert.equal(storage.getOutput(taskId, 'asset_plan_candidate'), null);
assert.deepEqual(storage.getOutput(taskId, 'blueprint'), { version: 'delete-proof' });
assert.equal(storage.getGenerationRun('run-rollback'), null);

storage.withWriteBatch(() => {
  storage.updateTask(taskId, { title: 'after' });
  storage.saveOutput(taskId, 'context', { version: 'after' });
  storage.saveOutput(taskId, 'asset_plan_candidate', { id: 'candidate-commit' });
  storage.deleteOutputs(taskId, ['blueprint']);
  storage.createGenerationRun({
    id: 'run-commit', task_id: taskId, state: 'planned', unit_version: 1,
  });
});

assert.equal(storage.getTask(taskId).title, 'after');
assert.deepEqual(storage.getOutput(taskId, 'context'), { version: 'after' });
assert.equal(storage.getOutput(taskId, 'asset_plan_candidate').id, 'candidate-commit');
assert.equal(storage.getOutput(taskId, 'blueprint'), null);
assert.equal(storage.getGenerationRun('run-commit').state, 'planned');
assert.equal(storage.getTask(taskId).created_at, originalCreatedAt);

sqlite.closeDatabase();
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log(JSON.stringify({
  passed: true,
  driver: process.argv.includes('--python') ? 'python' : 'native',
  rollback_writes: 0,
  committed_records: 4,
  committed_deletes: 1,
}));
