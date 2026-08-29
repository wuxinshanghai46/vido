#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

process.env.DB_ENABLED = '0';
process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-v274-'));
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const gateway = require('../src/services/newStoryAd/modelGateway');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');
const batchFactory = require('../src/services/newStoryAd/sceneBatchOrchestrationService');

const views = ['master', 'reverse', 'interaction', 'detail', 'layout']
  .map(key => ({ key, url: `https://example.test/${key}.png` }));
const camera = (viewId, extra = {}) => ({
  view_id: viewId, label: viewId, role: `${viewId} role`, framing: 'wide', lens_class: '35mm',
  height_class: 'eye', orientation: 'toward target', estimated_azimuth_degrees: viewId === 'reverse' ? 120 : 20,
  estimated_pitch_degrees: 2, ...(viewId === 'reverse' ? { azimuth_delta_from_master_degrees: 100 } : {}),
  normalized_position: [.2, .8], look_at: [.5, .5], position_confidence: .9,
  target_description: 'visible target', allowed_zone_ids: viewId === 'interaction' ? ['zone_action'] : [],
  requirement_refs: viewId === 'interaction' ? ['interaction'] : (viewId === 'detail' ? ['material_light'] : ['layout']),
  visible_evidence: 'visible geometry and target relationship', pass: true, mismatch_reasons: [], ...extra,
});
const scenePartial = {
  pass: true, status: 'verified', observed_summary: 'same coherent scene',
  requirement_qa: { pass: true, layout_match_score: .94, material_light_match_score: .92, interaction_match_score: .9, surface_topology_match_score: .93, negative_compliance_score: .98, mismatch_reasons: [] },
  photographic_realism_qa: { pass: true, photographic_realism_score: .9, physical_material_score: .9, natural_variation_score: .86, optical_capture_score: .88, real_photo_evidence: ['one observation'], synthetic_signals: [], mismatch_reasons: [] },
  cross_view_qa: { pass: true, scene_consistency_score: .94, geometry_consistency_score: .92, material_consistency_score: .93, mismatch_reasons: [] },
  spatial_coverage_qa: { pass: true, layout_topology_score: .92, camera_diversity_score: .9, reverse_coverage_score: .9, interaction_zone_score: .88, reasons: [] },
  view_issues: [], anchors: [], zones: [], geometry_facts: [], materials: [], lighting: {},
};
const cameraQa = { pass: true, role_definition_score: .94, requirement_mapping_score: .92, direction_evidence_score: .9, parameter_completeness_score: .95, layout_mapping_score: .9, mismatch_reasons: [] };

async function verifyPartialQaCompletion() {
  const original = gateway.generateVision;
  const calls = [];
  gateway.generateVision = async request => {
    calls.push(request.userPrompt);
    if (calls.length === 1) return { text: JSON.stringify(scenePartial), used_model: 'fixture/scene' };
    if (calls.length === 2) return { text: JSON.stringify({ photographic_realism_qa: { real_photo_evidence: ['natural lens falloff', 'localized wear and grounded shadows'] } }), used_model: 'fixture/scene-completion' };
    if (calls.length === 3) return { text: JSON.stringify({ camera_design_qa: cameraQa, cameras: ['master', 'reverse', 'interaction'].map(camera) }), used_model: 'fixture/camera' };
    return { text: JSON.stringify({ cameras: [camera('detail')] }), used_model: 'fixture/camera-completion' };
  };
  try {
    const contract = await sceneSpace.analyzeSceneViews({ taskId: 'qa-v274', sceneId: 'scene-a', views, requested: {}, layoutRequired: true });
    assert.equal(calls.length, 4, 'partial scene and camera JSON must each receive one focused completion call');
    assert.match(calls[1], /valid partial JSON/);
    assert.match(calls[3], /Preserve every complete camera record/);
    assert.equal(contract.cameras.length, 4);
    assert.equal(contract.full_space_lock, true);
  } finally {
    gateway.generateVision = original;
  }
}

async function verifyOneTaskDiagnosesAndRepairs() {
  const task = { id: 'task-v274', target_generation_progress: {} };
  const outputs = {};
  let fixCalls = 0;
  let directReverifyCalls = 0;
  const storage = {
    getTask: () => task,
    updateTask: (_id, patch) => Object.assign(task, patch),
    saveOutput: (_id, key, value) => { outputs[key] = value; },
  };
  const targetProgress = { upsert: (_task, options) => {
    const progress = options.progress;
    task.target_generation_progress[`scene_asset:${options.scopeId}`] = progress;
    return { target_generation_progress: task.target_generation_progress };
  } };
  const sceneAssets = {
    currentSceneAssets: () => [{ scene_id: 'scene-a', repair_plan: { action: 'reverify' } }],
    reverifySceneAsset: async () => { directReverifyCalls += 1; },
    fixSceneAsset: async (_taskId, _sceneId, body, options) => {
      fixCalls += 1;
      assert.equal(body.image_model, 'image-selected-by-user');
      assert.equal(options.maxRepairCycles, 1);
      return { scene_asset: { scene_id: 'scene-a', repair_plan: { action: 'none' } }, provider_image_call_count: 1 };
    },
    buildSceneRepairPlan: asset => asset.repair_plan,
  };
  const orchestrator = batchFactory.create({ storage, targetProgress, sceneAssets, promptAuthority: {}, cancellation: { throwIfCancelled() {} } });
  const result = await orchestrator.execute('task-v274', { actions: [{ scene_id: 'scene-a', name: 'A', action: 'reverify', image_total: 0, image_model: 'image-selected-by-user' }] }, { generationId: 'generation-v274' });
  assert.equal(result.status, 'succeeded');
  assert.equal(fixCalls, 1, 'reverify must diagnose and perform one bounded targeted repair in the same task');
  assert.equal(directReverifyCalls, 0, 'batch orchestration must not stop between diagnosis and targeted repair');
  assert.equal(result.provider_image_call_count, 1);
}

async function verifyUnavailableQaNeverCallsImages() {
  const task = { id: 'task-v274-unavailable', target_generation_progress: {} };
  let imageCalls = 0;
  const storage = {
    getTask: () => task,
    updateTask: (_id, patch) => Object.assign(task, patch),
    saveOutput() {},
  };
  const targetProgress = { upsert: (_task, options) => {
    task.target_generation_progress[`scene_asset:${options.scopeId}`] = options.progress;
    return { target_generation_progress: task.target_generation_progress };
  } };
  const sceneAssets = {
    async fixSceneAsset() {
      const error = new Error('审核模型未返回可定位证据');
      error.code = 'SCENE_QA_EVIDENCE_UNAVAILABLE';
      error.provider_image_call_count = 0;
      throw error;
    },
    async generateSceneAsset() { imageCalls += 1; },
    currentSceneAssets: () => [{ scene_id: 'scene-a' }],
    buildSceneRepairPlan: () => ({ action: 'reverify' }),
  };
  const orchestrator = batchFactory.create({ storage, targetProgress, sceneAssets, promptAuthority: {}, cancellation: { throwIfCancelled() {} } });
  const result = await orchestrator.execute(task.id, { actions: [{ scene_id: 'scene-a', action: 'reverify', image_total: 0 }] }, { generationId: 'generation-unavailable' });
  assert.equal(result.status, 'failed');
  assert.equal(result.results[0].error_code, 'SCENE_QA_EVIDENCE_UNAVAILABLE');
  assert.equal(result.provider_image_call_count, 0);
  assert.equal(imageCalls, 0, 'missing QA evidence must never guess which paid image to regenerate');
}

function verifyNewestProgressAndMotion() {
  const source = read('public/story-ad/views/sceneWorldPage.js');
  const start = source.indexOf('export function latestSceneTargetProgress');
  const end = source.indexOf('\n}\n', start) + 2;
  const sandbox = { Date };
  vm.runInNewContext(`${source.slice(start, end).replace('export ', '')}\nglobalThis.pick=latestSceneTargetProgress;`, sandbox);
  const selected = sandbox.pick({
    'scene_qa:scene-a': { stage: 'scene_qa', scene_id: 'scene-a', generation_id: 'old', started_at: '2026-08-28T17:58:11.411Z' },
    'scene_asset:scene-a': { stage: 'scene_asset', scene_id: 'scene-a', generation_id: 'new', started_at: '2026-08-29T07:34:29.209Z' },
  }, 'scene-a', 'new');
  assert.equal(selected.generation_id, 'new', 'current asset progress must win over yesterday QA timer');
  const css = read('public/story-ad/workspace-ux.css');
  assert.match(css, /font-size:13px/);
  assert.match(css, /scene-progress-scan/);
  assert.match(css, /prefers-reduced-motion:reduce/);
}

(async () => {
  await verifyPartialQaCompletion();
  await verifyOneTaskDiagnosesAndRepairs();
  await verifyUnavailableQaNeverCallsImages();
  verifyNewestProgressAndMotion();
  console.log(JSON.stringify({ passed: true, focused_qa_completions: 2, automatic_repair_cycles: 1, unavailable_qa_image_calls: 0, stale_timer_reuse: 0, progress_motion: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
