#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-scene-config-rebase-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const releaseBundle = require('../src/services/storyAdReleaseBundleService');
const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const jobs = require('../src/services/newStoryAd/jobService');
const checkpoints = require('../src/services/newStoryAd/assetPlanSectionRecoveryContractService');

const owner = { id: 'scene-config-rebase-owner', role: 'user' };

function waitUntil(predicate, timeoutMs = 3000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('scene config rebase test timeout'));
      }
    }, 10);
  });
}

async function main() {
  const created = storyAd.createTask({
    brief: 'A universal two-character story used to verify scene planning release lineage.',
    product_subject: 'release lineage test',
    content_mode: 'commercial_subject',
    content_mode_source: 'user',
    cast_mode: 'human',
  }, owner);
  const taskId = created.task.id;
  const currentBundleId = releaseBundle.identity().bundle_id;
  storage.updateTask(taskId, { required_bundle_id: 'a'.repeat(64) });

  const prepared = storyAd.prepareGeneration(taskId, {
    expected_content_revision: 1,
    target_stage: 'scene_config',
  }, owner);

  let observedBeforeModel = null;
  const queued = jobs.queueStage({
    taskId,
    stage: 'scene_config',
    expectedContentRevision: prepared.content_revision,
    snapshotId: prepared.snapshot_id,
    inputFingerprint: prepared.input_fingerprint,
    execute: async ({ generationId }) => {
      const task = storage.getTask(taskId);
      observedBeforeModel = {
        required_bundle_id: task.required_bundle_id,
        compatibility: checkpoints.checkpointCompatibility(task, null, {
          content_revision: prepared.content_revision,
          fingerprint: prepared.input_fingerprint,
          generation_id: generationId,
        }),
      };
    },
  });
  assert.equal(queued.accepted, true);
  await waitUntil(() => !storage.getTask(taskId).active_generation_id);
  assert.equal(observedBeforeModel.required_bundle_id, currentBundleId);
  assert.deepEqual(observedBeforeModel.compatibility.issues, []);

  const scenePlanCreated = storyAd.createTask({
    brief: 'A scene-plan queue integration task with historical release lineage.',
    product_subject: 'scene-plan queue integration',
    content_mode: 'commercial_subject',
    content_mode_source: 'user',
    cast_mode: 'human',
  }, owner);
  const scenePlanTaskId = scenePlanCreated.task.id;
  storage.updateTask(scenePlanTaskId, { required_bundle_id: 'c'.repeat(64) });
  const scenePlanPrepared = storyAd.prepareGeneration(scenePlanTaskId, {
    expected_content_revision: 1,
    target_stage: 'scene_plan',
  }, owner);
  let scenePlanObserved = null;
  const scenePlanQueued = jobs.queueStage({
    taskId: scenePlanTaskId,
    stage: 'scene_plan',
    expectedContentRevision: scenePlanPrepared.content_revision,
    snapshotId: scenePlanPrepared.snapshot_id,
    inputFingerprint: scenePlanPrepared.input_fingerprint,
    execute: async ({ generationId }) => {
      const task = storage.getTask(scenePlanTaskId);
      const checkpoint = checkpoints.saveCheckpointAtomic(
        scenePlanTaskId,
        'scene_plan_queue_rebase_probe',
        {},
        storage.getOutput(scenePlanTaskId, 'context') || task.request || {},
        {
          content_revision: scenePlanPrepared.content_revision,
          fingerprint: scenePlanPrepared.input_fingerprint,
          generation_id: generationId,
          status: 'queue_rebase_verified',
        },
      );
      scenePlanObserved = {
        required_bundle_id: task.required_bundle_id,
        checkpoint_bundle_id: checkpoint.release_envelope.producer_bundle_id,
        generation_id: checkpoint.generation_id,
        active_generation_id: task.active_generation_id,
      };
    },
  });
  assert.equal(scenePlanQueued.accepted, true, 'scene-plan queue must accept a fresh current-revision job');
  await waitUntil(() => !storage.getTask(scenePlanTaskId).active_generation_id);
  assert.equal(scenePlanObserved.required_bundle_id, currentBundleId, 'scene-plan queue must rebase the task before execute');
  assert.equal(scenePlanObserved.checkpoint_bundle_id, currentBundleId, 'the first scene-plan checkpoint CAS must use the current bundle');
  assert.equal(scenePlanObserved.generation_id, scenePlanObserved.active_generation_id, 'checkpoint CAS must remain owned by the active queued generation');

  const guardTask = storage.getTask(taskId);
  storage.updateTask(taskId, { required_bundle_id: 'b'.repeat(64) });
  const guarded = checkpoints.checkpointCompatibility(storage.getTask(taskId), null, {
    content_revision: guardTask.content_revision,
    fingerprint: prepared.input_fingerprint,
    generation_id: 'direct-guard-check',
  });
  assert(guarded.issues.includes('task_bundle_mismatch'), 'out-of-band checkpoint writes must remain blocked');

  const nonPlanningPatch = require('../src/services/newStoryAd/assetPlanCheckpointLineageService')
    .queuedPlanningTaskPatch('storyboard', currentBundleId);
  assert.deepEqual(nonPlanningPatch, {}, 'non-planning stages must not silently rebase planning lineage');

  const oldWorkerPatch = require('../src/services/newStoryAd/assetPlanCheckpointLineageService')
    .queuedPlanningTaskPatch('scene_plan', 'd'.repeat(64));
  assert.deepEqual(oldWorkerPatch, {}, 'a worker from a different release must not rebase task lineage');

  const staleCreated = storyAd.createTask({
    brief: 'A stale scene-plan worker must stop before execute.',
    product_subject: 'stale scene-plan worker',
    content_mode: 'commercial_subject',
    content_mode_source: 'user',
    cast_mode: 'human',
  }, owner);
  const staleTaskId = staleCreated.task.id;
  const stalePrepared = storyAd.prepareGeneration(staleTaskId, {
    expected_content_revision: 1,
    target_stage: 'scene_plan',
  }, owner);
  let staleExecuteCalls = 0;
  const staleQueued = jobs.queueStage({
    taskId: staleTaskId,
    stage: 'scene_plan',
    expectedContentRevision: stalePrepared.content_revision,
    snapshotId: stalePrepared.snapshot_id,
    inputFingerprint: stalePrepared.input_fingerprint,
    execute: async () => { staleExecuteCalls += 1; },
  });
  assert.equal(staleQueued.accepted, true);
  storage.updateTask(staleTaskId, { content_revision: stalePrepared.content_revision + 1 });
  await waitUntil(() => !storage.getTask(staleTaskId).active_generation_id);
  assert.equal(staleExecuteCalls, 0, 'a stale revision worker must stop before execute or checkpoint writes');
  assert.equal(storage.getTask(staleTaskId).error_code, 'STALE_GENERATION_REVISION');
  console.log('story ad scene-config release rebase v130: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
