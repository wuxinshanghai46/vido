#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function browserModule(file, windowSeed = {}) {
  const sandbox = {
    window: {
      crypto: { randomUUID: () => `test-generation-${Date.now()}` },
      ...windowSeed,
    },
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  return sandbox.window;
}

async function verifyLatestEditAuthority(flow) {
  const state = {
    taskId: 'task-current',
    taskSessionEpoch: 7,
    clientEditSeq: 12,
    activeGenerationId: '',
  };
  let release;
  const pending = flow.runInlineGeneration(
    'assist_scene_spec',
    { state, renderAll() {}, setBusy() {} },
    () => new Promise(resolve => { release = resolve; }),
  );
  assert.equal(state.activeGenerationScope, 'inline');
  assert.equal(state.activeStage, 'assist_scene_spec');
  state.clientEditSeq = 13;
  release({ layoutText: 'stale model result' });
  await assert.rejects(pending, error => error?.code === 'STALE_INLINE_RESULT');
  assert.equal(state.activeGenerationId, '');
  assert.equal(state.activeGenerationScope, '');

  const requestBodies = [];
  const current = await flow.requestInlineGeneration('assist_scene_spec', {
    state,
    renderAll() {},
    setBusy() {},
    api: async (url, options) => {
      requestBodies.push({ url, options });
      return { layoutText: options.body.layoutText };
    },
  }, {
    body: () => ({ layoutText: 'NEW_USER_LAYOUT', task_id: 'task-current' }),
  });
  assert.equal(current.layoutText, 'NEW_USER_LAYOUT');
  assert.equal(requestBodies.length, 1);
  assert.equal(requestBodies[0].options.body.layoutText, 'NEW_USER_LAYOUT');
  assert.match(requestBodies[0].options.body.generation_id, /^test-generation-/);
}

async function verifyFullStop(flow) {
  const state = {
    taskId: 'task-current',
    taskSessionEpoch: 2,
    clientEditSeq: 4,
    activeGenerationId: '',
  };
  const requested = [];
  let capturedSignal;
  const pending = flow.runInlineGeneration(
    'person_sheet',
    { state, renderAll() {}, setBusy() {} },
    ({ signal }) => {
      capturedSignal = signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  );
  const generationId = state.activeGenerationId;
  const stopped = await flow.cancelStage({
    state,
    renderAll() {},
    setBusy() {},
    toast() {},
    api: async (url, options) => {
      requested.push({ url, options });
      return { success: true, cancelled: true };
    },
  });
  assert.equal(stopped, true);
  assert.equal(capturedSignal.aborted, true);
  assert.equal(requested.length, 1);
  assert.equal(requested[0].url, `/api/new-story-ad/generations/${generationId}/cancel`);
  await assert.rejects(pending, error => error?.code === 'USER_CANCELLED');
  assert.equal(state.activeGenerationId, '');
  assert.equal(state.activeGenerationScope, '');
}

function verifyPreciseGuidance() {
  const guidance = browserModule('public/js/new-story-ad/error-guidance.js').NewStoryAdErrorGuidance;
  const scene = guidance.format({
    stage: 'scene_asset',
    message: '场景字段不完整',
    data: {
      error_code: 'SCENE_FIELD_MISSING',
      support_id: 'support-scene-001',
      scene_name: '现代客厅',
      failure_details: [{ field: 'materialLightText' }, { field: 'interactionText' }],
    },
  });
  assert.match(scene.message, /现代客厅/);
  assert.match(scene.message, /materialLightText/);
  assert.match(scene.message, /interactionText/);
  assert.match(scene.message, /support-scene-001/);
  assert.match(scene.message, /处理方法/);

  const keyframe = guidance.format({
    stage: 'keyframes',
    message: '部分关键帧失败',
    data: {
      error_code: 'KEYFRAME_BATCH_PARTIAL_FAILURE',
      failure_details: [{ shot_number: 1 }, { shot_number: 3 }, { shot_number: 3 }],
    },
  });
  assert.match(keyframe.message, /第 1、3 镜/);
  assert.match(keyframe.message, /补齐未生成镜头/);

  const provider = guidance.format({
    stage: 'storyboard',
    message: 'provider timeout',
    data: { error_code: 'PROVIDER_TIMEOUT' },
  });
  assert.match(provider.message, /模型 \/ 供应商链路异常/);
  assert.match(provider.message, /不需要修改创作内容/);
}

function verifyWiring() {
  const legacy = fs.readFileSync(path.join(root, 'public/js/new-story-ad-legacy-ui.js'), 'utf8');
  const flow = fs.readFileSync(path.join(root, 'public/js/new-story-ad/generation-flow.js'), 'utf8');
  const cancelable = fs.readFileSync(path.join(root, 'public/js/new-story-ad/cancelable-generation.js'), 'utf8');
  const actors = fs.readFileSync(path.join(root, 'public/js/new-story-ad/actors.js'), 'utf8');
  const scenes = fs.readFileSync(path.join(root, 'public/js/new-story-ad/scene-assets.js'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'src/routes/newStoryAd.js'), 'utf8');
  const storage = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storageService.js'), 'utf8');
  const ttsAdapter = fs.readFileSync(path.join(root, 'src/services/newStoryAd/ttsAdapter.js'), 'utf8');

  assert.equal((legacy.match(/\/api\/new-story-ad\/assist/g) || []).length, 0);
  assert.equal((flow.match(/\/api\/new-story-ad\/assist/g) || []).length, 1);
  assert.match(cancelable, /flow\.requestInlineGeneration\(stage, ctx, options\)/);
  assert.match(legacy, /requestCancelableGeneration\('assist_person_spec'/);
  assert.match(legacy, /requestCancelableGeneration\('assist_scene_spec'/);
  assert.match(legacy, /requestCancelableGeneration\('subject_assets'/);
  assert.match(actors, /data-nsa-cancel-generation/);
  assert.match(scenes, /data-nsa-cancel-generation/);
  assert.match(route, /router\.post\('\/assist'[\s\S]*?cancellation\.run\(/);
  assert.match(route, /router\.post\('\/generations\/:generationId\/cancel'/);
  assert.match(storage, /function updateTask\(id, patch, options = \{\}\)[\s\S]*?throwIfCancelled/);
  assert.match(ttsAdapter, /signal:\s*cancellation\.signal\(\)/);
}

async function main() {
  const flow = browserModule('public/js/new-story-ad/generation-flow.js').NewStoryAdGenerationFlow;
  await verifyLatestEditAuthority(flow);
  await verifyFullStop(flow);
  verifyPreciseGuidance();
  verifyWiring();
  console.log(JSON.stringify({
    status: 'PASS',
    latest_edit_authority: true,
    stale_inline_result_blocked: true,
    inline_stop_aborts_client_and_server: true,
    person_scene_stop_controls: true,
    precise_failure_guidance: true,
    tts_abort_signal: true,
    real_model_calls: 0,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
