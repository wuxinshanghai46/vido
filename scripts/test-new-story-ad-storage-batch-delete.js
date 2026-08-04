#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-storage-batch-delete-'));
process.env.OUTPUT_DIR = tempRoot;
process.env.DB_ENABLED = '1';
process.env.DB_PATH = path.join(tempRoot, 'vido.sqlite');
process.env.SQLITE_DRIVER = 'python';
process.env.DB_READ_PRIMARY = '1';
process.env.DB_DUAL_WRITE = '1';
process.env.DB_JSON_FALLBACK = '1';

require('./db/run-migrations');
const storage = require('../src/services/newStoryAd/storageService');

function createTask(id) {
  storage.createTask({
    id,
    user_id: 'batch-owner',
    title: id,
    brief: 'batch delete regression',
    request: { brief: 'batch delete regression' },
    lineage_enforced: true,
  });
}

try {
  createTask('batch-main');
  createTask('batch-other');
  storage.saveOutput('batch-main', 'blueprint', { value: 1 });
  storage.saveOutput('batch-main', 'final_video', { value: 2 });
  storage.saveOutput('batch-main', 'context', { value: 3 });
  storage.saveOutput('batch-other', 'blueprint', { value: 4 });

  const deleted = storage.deleteOutputs('batch-main', ['blueprint', 'final_video', 'blueprint']);
  assert.deepEqual(deleted, ['blueprint', 'final_video']);
  assert.equal(storage.getOutput('batch-main', 'blueprint'), null);
  assert.equal(storage.getOutput('batch-main', 'final_video'), null);
  assert.deepEqual(storage.getOutput('batch-main', 'context'), { value: 3 });
  assert.deepEqual(storage.getOutput('batch-other', 'blueprint'), { value: 4 });

  const manifest = storage.getManifest('batch-main');
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.artifacts || {}, 'blueprint'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.artifacts || {}, 'final_video'), false);
  assert.equal(Boolean(manifest.invalidated?.blueprint), true);
  assert.equal(Boolean(manifest.invalidated?.final_video), true);

  const mirror = JSON.parse(fs.readFileSync(path.join(tempRoot, 'new_story_ad_db.json'), 'utf8'));
  const mirrorIds = new Set((mirror.outputs || []).map(item => item.id));
  assert.equal(mirrorIds.has('batch-main:blueprint'), false);
  assert.equal(mirrorIds.has('batch-main:final_video'), false);
  assert.equal(mirrorIds.has('batch-main:context'), true);
  assert.equal(mirrorIds.has('batch-other:blueprint'), true);

  console.log(JSON.stringify({ passed: true, checks: 14, sqlite_driver: 'python', json_mirror: true }));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
