#!/usr/bin/env node
'use strict';

const storage = require('../src/services/newStoryAd/storageService');
const freshness = require('../src/services/newStoryAd/keyframeContractFreshnessService');
const performance = require('../src/services/newStoryAd/scenePerformanceCoverageContractService');
const imageGate = require('../src/services/storyAdWorkspace/storyboardImageConfirmationGateService');

const taskId = String(process.argv[2] || process.env.STORY_AD_TASK_ID || '').trim();
const apply = process.argv.includes('--apply') || process.env.APPLY_SPATIAL_STORYBOARD_V302 === '1';
if (!taskId) throw new Error('Usage: node scripts/repair-story-ad-spatial-storyboard-v302.js <task-id> [--apply]');
const task = storage.getTask(taskId);
if (!task) throw Object.assign(new Error('TASK_NOT_FOUND'), { code: 'TASK_NOT_FOUND' });

const beforeShots = storage.getOutput(taskId, 'storyboard_table') || [];
const compiled = freshness.compileCurrentTask(taskId);
const changedIndexes = compiled.shots.map((shot, index) => (
  storage.canonicalFingerprint(shot) === storage.canonicalFingerprint(beforeShots[index] || {}) ? -1 : index
)).filter(index => index >= 0);
const beforePerformance = performance.inspect(beforeShots, compiled.ctx.scene_assets, compiled.ctx);
const afterPerformance = performance.inspect(compiled.shots, compiled.ctx.scene_assets, compiled.ctx);
const report = {
  ok: afterPerformance.ready,
  task_id: taskId,
  mode: apply ? 'apply' : 'dry_run',
  changed_shot_indexes: changedIndexes.map(index => index + 1),
  before_performance: beforePerformance,
  after_performance: afterPerformance,
  provider_calls: 0,
};

if (!apply || !changedIndexes.length) {
  console.log(JSON.stringify({ ...report, applied: false, image_gate: imageGate.inspect(taskId) }, null, 2));
  process.exit(afterPerformance.ready ? 0 : 4);
}

storage.withWriteBatch(() => {
  storage.saveOutput(taskId, 'storyboard_table', compiled.shots);
  freshness.persist(taskId, compiled.contracts, { changedIndexes, clearDownstream: false });
  const meta = storage.getOutput(taskId, 'storyboard_meta') || {};
  storage.saveOutput(taskId, 'storyboard_meta', {
    ...meta,
    status: meta.status || 'ready',
    scene_performance_contract_version: performance.CONTRACT_VERSION,
    scene_performance_repaired_at: new Date().toISOString(),
    scene_performance_changed_shot_indexes: changedIndexes.map(index => index + 1),
  });
  storage.saveOutput(taskId, 'spatial_storyboard_migration_v302', {
    contract_version: performance.CONTRACT_VERSION,
    changed_shot_indexes: changedIndexes.map(index => index + 1),
    provider_calls: 0,
    applied_at: new Date().toISOString(),
  });
});

console.log(JSON.stringify({ ...report, applied: true, image_gate: imageGate.inspect(taskId) }, null, 2));
