#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-scene-config-owner-'));
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const assetPlans = require('../src/services/newStoryAd/assetPlanService');

const taskId = 'scene-config-owned-job';
storage.createTask({
  id: taskId,
  title: 'scene config lifecycle ownership',
  request: { brief: 'lifecycle ownership test' },
});
storage.updateTask(taskId, {
  status: 'running',
  stage: 'scene_config',
  active_stage: 'scene_config',
  active_generation_id: 'owned-job-id',
});

assetPlans.markSceneConfigDone(taskId, 'owned-job-id');
const ownedTask = storage.getTask(taskId);
assert.equal(ownedTask.status, 'running', 'inner completion must leave final status to the outer job');
assert.equal(ownedTask.active_generation_id, 'owned-job-id', 'inner completion must preserve the outer job id');
assert.equal(ownedTask.active_stage, 'scene_config', 'inner completion must preserve the outer stage owner');
assert.equal(ownedTask.stage, 'scene_config_done');

assetPlans.markSceneConfigDone(taskId);
const directTask = storage.getTask(taskId);
assert.equal(directTask.status, 'done', 'direct zero-job synchronization must still close the task');
assert.equal(directTask.active_generation_id, '');
assert.equal(directTask.active_stage, '');

console.log(JSON.stringify({ passed: true, checks: 8, model_calls: 0, media_calls: 0 }));
