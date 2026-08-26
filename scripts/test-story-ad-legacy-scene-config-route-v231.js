#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-legacy-scene-config-route-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const express = require('express');
const service = require('../src/services/newStoryAd');
const storage = require('../src/services/newStoryAd/storageService');
const jobService = require('../src/services/newStoryAd/jobService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const scenePromptConfirmation = require('../src/services/newStoryAd/scenePromptConfirmationService');

function requestJson(port, pathname, body = {}, method = 'POST') {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: { 'content-type': 'application/json', 'content-length': payload.length },
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function main() {
  const originals = {
    assertTaskOwner: service.assertTaskOwner,
    taskSummary: service.taskSummary,
    generateSceneConfig: service.generateSceneConfig,
    updateScenePlan: service.updateScenePlan,
    queueStage: jobService.queueStage,
    generateText: modelGateway.generateText,
    getTask: storage.getTask,
    updateTask: storage.updateTask,
    saveOutput: storage.saveOutput,
    saveStage: storage.saveStage,
    saveSnapshot: storage.saveSnapshot,
    assertScenePromptConfirmed: scenePromptConfirmation.assertConfirmed,
    confirmScenePrompt: scenePromptConfirmation.confirm,
  };
  const calls = { ownerCheck: 0, legacyService: 0, queue: 0, model: 0, updateTask: 0, saveOutput: 0, saveStage: 0, saveSnapshot: 0, promptGuard: 0 };
  let server = null;
  try {
    service.assertTaskOwner = id => {
      calls.ownerCheck += 1;
      return {
        id,
        status: 'done',
        stage: 'scene_config_done',
        content_revision: 1,
        request: { content_mode: 'commercial_subject', content_mode_source: 'user' },
      };
    };
    service.taskSummary = task => task || {};
    service.generateSceneConfig = async () => { calls.legacyService += 1; return {}; };
    service.updateScenePlan = async () => ({});
    storage.getTask = id => service.assertTaskOwner(id);
    storage.updateTask = () => { calls.updateTask += 1; };
    storage.saveOutput = () => { calls.saveOutput += 1; };
    storage.saveStage = () => { calls.saveStage += 1; };
    storage.saveSnapshot = () => { calls.saveSnapshot += 1; };
    modelGateway.generateText = async () => { calls.model += 1; return {}; };
    jobService.queueStage = entry => {
      calls.queue += 1;
      return { accepted: true, duplicate: false, job: { id: `job-${entry.stage}`, stage: entry.stage } };
    };
    scenePromptConfirmation.assertConfirmed = () => {
      calls.promptGuard += 1;
      const error = new Error('请先确认当前场景提示词，再生成场景画面');
      error.code = 'SCENE_PROMPT_CONFIRMATION_REQUIRED';
      error.status = 409;
      error.retryable = false;
      throw error;
    };
    scenePromptConfirmation.confirm = (_taskId, sceneId) => ({ scene_id: sceneId, confirmation_id: 'a'.repeat(64), confirmed: true });

    delete require.cache[require.resolve('../src/routes/newStoryAd')];
    const router = require('../src/routes/newStoryAd');
    const app = express();
    app.use(express.json());
    app.use('/api/new-story-ad', router);
    server = http.createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;

    const disabled = await requestJson(port, '/api/new-story-ad/tasks/legacy-scene-task/scene-config', {
      replan_scene_coverage: true,
    });
    assert.equal(disabled.status, 410);
    assert.equal(disabled.body.code, 'LEGACY_SCENE_CONFIG_ROUTE_DISABLED');
    assert.equal(disabled.body.retryable, false);
    assert.match(disabled.body.error, /旧场景配置入口已停用/);
    assert.deepEqual(calls, { ownerCheck: 0, legacyService: 0, queue: 0, model: 0, updateTask: 0, saveOutput: 0, saveStage: 0, saveSnapshot: 0, promptGuard: 0 },
      'legacy scene-config rejection must not queue, call models, or persist business state');

    const oldSceneWrite = await requestJson(port, '/api/new-story-ad/tasks/legacy-scene-task/scene-assets', {
      scene_assets: [{ id: 'forged-scene' }],
    }, 'PUT');
    assert.equal(oldSceneWrite.status, 410);
    assert.equal(oldSceneWrite.body.code, 'LEGACY_SCENE_ASSET_WRITE_DISABLED');
    assert.equal(calls.ownerCheck, 0, 'legacy scene output write shell must reject before ownership or persistence');
    assert.equal(calls.updateTask + calls.saveOutput + calls.saveStage + calls.saveSnapshot, 0);

    const unconfirmedScene = await requestJson(port, '/api/new-story-ad/tasks/current-scene-task/scene-assets', {
      scene_id: 'scene-a',
    });
    assert.equal(unconfirmedScene.status, 409);
    assert.equal(unconfirmedScene.body.code, 'SCENE_PROMPT_CONFIRMATION_REQUIRED');
    assert.equal(calls.promptGuard, 1);
    assert.equal(calls.queue, 0, 'prompt confirmation must be checked before queue/permit');
    assert.equal(calls.model, 0);

    const current = await requestJson(port, '/api/new-story-ad/tasks/current-scene-task/scene-plan');
    assert.equal(current.status, 202, 'current scene-plan route must remain available');
    assert.equal(current.body.accepted, true);
    assert.equal(calls.queue, 1, 'current scene-plan route must still queue exactly once');
    assert.equal(calls.model, 0, 'route acceptance alone must not synchronously call a model');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    service.assertTaskOwner = originals.assertTaskOwner;
    service.taskSummary = originals.taskSummary;
    service.generateSceneConfig = originals.generateSceneConfig;
    service.updateScenePlan = originals.updateScenePlan;
    jobService.queueStage = originals.queueStage;
    modelGateway.generateText = originals.generateText;
    storage.getTask = originals.getTask;
    storage.updateTask = originals.updateTask;
    storage.saveOutput = originals.saveOutput;
    storage.saveStage = originals.saveStage;
    storage.saveSnapshot = originals.saveSnapshot;
    scenePromptConfirmation.assertConfirmed = originals.assertScenePromptConfirmed;
    scenePromptConfirmation.confirm = originals.confirmScenePrompt;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log('story ad legacy scene-config route v231: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
