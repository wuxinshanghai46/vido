#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const canonicalFingerprint = value => {
  const canonical = input => {
    if (Array.isArray(input)) return input.map(canonical);
    if (!input || typeof input !== 'object') return input ?? null;
    return Object.fromEntries(Object.keys(input).sort()
      .filter(key => input[key] !== undefined && !['created_at', 'updated_at', 'previewUrl', 'uploading', 'progress'].includes(key))
      .map(key => [key, canonical(input[key])]));
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
};
const acceptanceFactory = require('../src/services/newStoryAd/sceneVisualAcceptanceService');
const sceneWorkflow = require('../src/services/storyAdWorkspace/sceneWorkflowProjectionService');
const navigation = require('../src/services/storyAdWorkspace/workflowNavigationService');

function scene(id = 'scene-a') {
  return {
    scene_id: id,
    name: id,
    revision: 4,
    scene_master: { image_url: `https://assets.test/${id}/master.png`, sha256: `${id}-master` },
    layout: { image_url: `https://assets.test/${id}/layout.png`, sha256: `${id}-layout` },
    view_images: ['reverse', 'interaction', 'detail'].map(key => ({ key, image_url: `https://assets.test/${id}/${key}.png`, sha256: `${id}-${key}` })),
    qa: { full_space_lock: false, qa_unavailable: true },
    repair_plan: { action: 'reverify', count: 0 },
  };
}

function storageFixture(scenes = [scene()]) {
  const outputs = { scene_assets: scenes, context: { scene_setup_confirmed: false } };
  const task = { id: 'task-v276', request: outputs.context, content_revision: 7, active_generation_id: '' };
  return {
    outputs, task, modelCalls: 0,
    storage: {
      canonicalFingerprint,
      getTask: () => task,
      getOutput: (_id, kind) => outputs[kind],
      saveOutput: (_id, kind, value) => { outputs[kind] = value; },
      updateTask: (_id, patch) => Object.assign(task, patch),
      withWriteBatch: callback => callback(),
    },
  };
}

function verifyExplicitAcceptance() {
  const fixture = storageFixture([scene('scene-a'), scene('scene-b')]);
  const service = acceptanceFactory.create({ storage: fixture.storage });
  const accepted = service.acceptCurrent(fixture.task.id, { id: 'user-a' });
  assert.equal(accepted.model_call_count, 0);
  assert.equal(fixture.modelCalls, 0);
  assert.equal(fixture.outputs.context.scene_setup_confirmed, true);
  assert.equal(fixture.outputs.scene_visual_acceptance.status, 'accepted');
  assert.equal(service.inspect(fixture.outputs.scene_assets, accepted).accepted, true);

  const projected = sceneWorkflow.projectBundleState(fixture.outputs.scene_assets, fixture.outputs.context, fixture.outputs);
  assert.equal(projected.scene_workflow.visuals_complete, false, 'QA unavailable must not be rewritten as passed');
  assert.equal(projected.scene_workflow.visuals_accepted, true);
  assert.equal(projected.scene_workflow.confirmed, true);

  const nav = navigation.build({
    task: { title: 'V276' }, context: { ...fixture.outputs.context, project_name: 'V276', brief: 'brief', asset_setup_confirmed: true },
    outputs: { ...fixture.outputs, blueprint: { beats: [{ id: 'b1' }] } }, counts: {},
    clean: value => String(value || '').trim(), list: value => Array.isArray(value) ? value : [],
  });
  assert.equal(nav.steps.storyboard.enabled, true);

  fixture.outputs.scene_assets[0].scene_master.image_url = 'https://assets.test/scene-a/master-v2.png';
  assert.equal(service.inspect(fixture.outputs.scene_assets, accepted).accepted, false, 'asset changes must invalidate old acceptance');
  acceptanceFactory.invalidateIfChanged(fixture.task.id, fixture.outputs.scene_assets, fixture.storage);
  assert.equal(fixture.outputs.scene_visual_acceptance.status, 'invalidated');
  const invalidatedNav = navigation.build({
    task: { title: 'V276' }, context: { ...fixture.outputs.context, project_name: 'V276', brief: 'brief', asset_setup_confirmed: true },
    outputs: { ...fixture.outputs, blueprint: { beats: [{ id: 'b1' }] } }, counts: {},
    clean: value => String(value || '').trim(), list: value => Array.isArray(value) ? value : [],
  });
  assert.equal(invalidatedNav.steps.storyboard.enabled, false);
}

function verifyAcceptanceBoundaries() {
  const missing = scene();
  missing.view_images = missing.view_images.filter(view => view.key !== 'detail');
  const missingFixture = storageFixture([missing]);
  assert.throws(() => acceptanceFactory.create({ storage: missingFixture.storage }).acceptCurrent(missingFixture.task.id),
    error => error.code === 'SCENE_ACCEPTANCE_IMAGES_INCOMPLETE' && error.status === 409);
  const activeFixture = storageFixture([scene()]);
  activeFixture.task.active_generation_id = 'generation-active';
  assert.throws(() => acceptanceFactory.create({ storage: activeFixture.storage }).acceptCurrent(activeFixture.task.id),
    error => error.code === 'SCENE_ACCEPTANCE_GENERATION_ACTIVE' && error.status === 409);
}

function verifyOptimisticProgressIdentity() {
  const source = read('public/story-ad/store/stageSubmissionState.js').replace('export function ', 'function ');
  const sandbox = {};
  vm.runInNewContext(`${source}\nglobalThis.begin = beginStageSubmissionState;`, sandbox);
  let next;
  sandbox.begin({
    state: { bundle: { project: { target_generation_progress: {} } } },
    set: value => { next = value; },
  }, 'scene_asset', 1, '提交中', {
    target_progress: { 'scene_asset:scene-a': { status: 'queued', phase: 'verification', target_total: 1 } },
  });
  const row = next.bundle.project.target_generation_progress['scene_asset:scene-a'];
  assert.equal(row.stage, 'scene_asset');
  assert.equal(row.scene_id, 'scene-a');
  assert.equal(row.phase, 'verification');
  assert.match(row.generation_id, /^client-submitting:/);
}

function verifyUiContract() {
  const page = read('public/story-ad/views/sceneWorldPage.js');
  assert.match(page, /使用当前图片继续/);
  assert.match(page, /重新审核场景/);
  assert.match(page, /acceptCurrentScenes/);
  const qa = read('public/story-ad/views/sceneQaPublicState.js');
  assert.match(qa, /不代表图片不合格/);
  const card = read('public/story-ad/views/sceneDossierCard.js');
  assert.match(card, /qaPublic\.message/);
  const route = read('src/routes/newStoryAd/sceneBatchRoutes.js');
  assert.match(route, /scene-acceptance/);
  assert.match(route, /model_call_count: 0/);
}

verifyExplicitAcceptance();
verifyAcceptanceBoundaries();
verifyOptimisticProgressIdentity();
verifyUiContract();
console.log(JSON.stringify({
  passed: true,
  explicit_acceptance_model_calls: 0,
  incomplete_image_bypass: 'blocked',
  active_generation_bypass: 'blocked',
  changed_asset_acceptance: 'invalidated',
  optimistic_progress_generation_bound: true,
}));
