#!/usr/bin/env node
'use strict';

const storage = require('../src/services/newStoryAd/storageService');
const freshness = require('../src/services/newStoryAd/keyframeContractFreshnessService');
const readability = require('../src/services/newStoryAd/sceneReadabilityContractService');
const imageGate = require('../src/services/storyAdWorkspace/storyboardImageConfirmationGateService');

const taskId = String(process.argv[2] || process.env.STORY_AD_TASK_ID || '').trim();
const apply = process.argv.includes('--apply') || process.env.APPLY_SCENE_READABILITY_REPAIR === '1';

if (!taskId) {
  console.error('Usage: node scripts/repair-story-ad-scene-readability.js <task-id> [--apply]');
  process.exit(2);
}

const task = storage.getTask(taskId);
if (!task) {
  console.error(JSON.stringify({ ok: false, code: 'TASK_NOT_FOUND', task_id: taskId }));
  process.exit(3);
}

const beforeShots = storage.getOutput(taskId, 'storyboard_table') || [];
const sceneAssets = storage.getOutput(taskId, 'scene_assets') || [];
const before = readability.inspect(beforeShots, sceneAssets);
const compiled = freshness.compileCurrentTask(taskId);
const changedIndexes = compiled.shots
  .map((shot, index) => storage.canonicalFingerprint(shot) === storage.canonicalFingerprint(beforeShots[index] || {}) ? -1 : index)
  .filter(index => index >= 0);
const after = readability.inspect(compiled.shots, sceneAssets);
const report = {
  ok: true,
  task_id: taskId,
  mode: apply ? 'apply' : 'dry_run',
  before,
  after,
  changed_shot_indexes: changedIndexes.map(index => index + 1),
  provider_calls: 0,
};

if (!apply || !changedIndexes.length) {
  console.log(JSON.stringify({ ...report, applied: false }, null, 2));
  process.exit(0);
}

storage.withWriteBatch(() => {
  storage.saveOutput(taskId, 'storyboard_table', compiled.shots);
  freshness.persist(taskId, compiled.contracts, { changedIndexes, clearDownstream: false });
  const meta = storage.getOutput(taskId, 'storyboard_meta') || {};
  storage.saveOutput(taskId, 'storyboard_meta', {
    ...meta,
    status: meta.status || 'ready',
    scene_readability_contract_version: readability.CONTRACT_VERSION,
    scene_readability_repaired_at: new Date().toISOString(),
    scene_readability_changed_shot_indexes: changedIndexes.map(index => index + 1),
  });
  storage.saveOutput(taskId, 'scene_readability_migration', {
    contract_version: readability.CONTRACT_VERSION,
    changed_shot_indexes: changedIndexes.map(index => index + 1),
    provider_calls: 0,
    applied_at: new Date().toISOString(),
  });
});

console.log(JSON.stringify({
  ...report,
  applied: true,
  image_gate: imageGate.inspect(taskId),
}, null, 2));
