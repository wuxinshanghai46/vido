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

  storage.updateTask(taskId, { required_bundle_id: 'c'.repeat(64) });
  const scenePlanPatch = require('../src/services/newStoryAd/assetPlanCheckpointLineageService')
    .queuedPlanningTaskPatch('scene_plan', currentBundleId);
  assert.equal(scenePlanPatch.required_bundle_id, currentBundleId, 'independent scene-plan jobs must rebase lineage before checkpoint CAS');
  storage.updateTask(taskId, scenePlanPatch);
  assert(!checkpoints.checkpointCompatibility(storage.getTask(taskId), null, {
    content_revision: prepared.content_revision,
    fingerprint: prepared.input_fingerprint,
    generation_id: 'direct-scene-plan-check',
  }).issues.includes('task_bundle_mismatch'), 'scene-plan rebase must clear the historical task bundle mismatch');

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
  console.log('story ad scene-config release rebase v130: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
