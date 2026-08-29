'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const selection = require('../src/services/newStoryAd/mediaGenerationModelSelectionService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const sceneBatchFactory = require('../src/services/newStoryAd/sceneBatchOrchestrationService');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

async function main() {
  const configuredImage = selection.PUBLIC_MEDIA_CHOICES.image.map((choice, index) => ({
    route: choice.execution_route, provider_id: choice.execution_route.split('/')[0],
    model_id: choice.execution_route.split('/')[1], media_type: 'image', priority: index + 1, available: true,
  }));
  const configuredVideo = selection.PUBLIC_MEDIA_CHOICES.video.map((choice, index) => ({
    route: choice.execution_route, provider_id: choice.execution_route.split('/')[0],
    model_id: choice.execution_route.split('/')[1], media_type: 'video', priority: index + 1, available: true,
  }));
  const sceneCatalog = selection.publicCatalog('new_story_ad.scene_asset', configuredImage);
  const videoCatalog = selection.publicCatalog('new_story_ad.video', configuredVideo);
  assert.strictEqual(sceneCatalog.selection_required, true);
  assert.strictEqual(sceneCatalog.fallback_after_failure, false);
  assert.deepStrictEqual(sceneCatalog.models.map(model => `${model.public_name} · ${model.provider_code}`), [
    'Image · SZ', 'Image · WB', 'Image · DY',
    'Nano Banana · SZ', 'Nano Banana · WB', 'Nano Banana · DY',
  ]);
  assert.strictEqual(sceneCatalog.default_selection, 'image-sz');
  assert.strictEqual(videoCatalog.default_selection, 'seedance-dy');
  assert(sceneCatalog.models.every(model => !model.provider_id && !model.model_id && !model.provider_name));
  assert(sceneCatalog.models.some(model => model.available), 'scene catalog must expose a configured model');
  assert(videoCatalog.models.some(model => model.available), 'video catalog must expose a configured model');

  const publicSelection = sceneCatalog.models.find(model => model.available).route;
  const chosen = selection.applyResolvedSelection({}, selection.resolveSelection('new_story_ad.scene_asset', publicSelection, configuredImage));
  assert.strictEqual(publicSelection, 'image-sz');
  assert.strictEqual(chosen.image_model, 'smscrw/gpt-image-2');
  assert.strictEqual(chosen.single_attempt, true);
  assert.strictEqual(chosen.max_scene_retries, 0);
  assert.throws(() => selection.applySelection('new_story_ad.scene_asset', {}), error => (
    error.code === 'MEDIA_GENERATION_MODEL_SELECTION_REQUIRED'
  ));
  assert.throws(() => selection.catalog('new_story_ad.qa'), error => (
    error.code === 'MEDIA_GENERATION_MODEL_STAGE_INVALID'
  ));
  assert.throws(() => selection.resolveSelection('new_story_ad.scene_asset', 'deyunai/seedream-3.0', configuredImage), error => (
    error.code === 'MEDIA_GENERATION_MODEL_SELECTION_INVALID'
  ));

  const exact = mediaAdapter.selectImageCandidates('new_story_ad.scene_asset', 'p2/m2', [
    { provider_id: 'p1', model_id: 'm1' },
    { provider_id: 'p2', model_id: 'm2' },
  ]);
  assert.deepStrictEqual(exact.candidatePool.map(row => `${row.provider_id}/${row.model_id}`), ['p2/m2']);
  assert.strictEqual(exact.exactRouteRequested, true);

  const task = { id: 'task-v257', active_target_generations: {} };
  const outputs = { scene_assets: [] };
  let paidCalls = 0;
  const storage = {
    getTask: () => task,
    getOutput: (_taskId, kind) => outputs[kind],
    updateTask: (_taskId, patch) => Object.assign(task, patch),
    saveOutput: (_taskId, kind, value) => { outputs[kind] = value; },
  };
  const orchestration = sceneBatchFactory.create({
    storage,
    sceneAssets: {
      normalizeSceneAssets: rows => rows,
      currentSceneAssets: () => outputs.scene_assets,
      buildSceneRepairPlan: () => ({ action: 'generate' }),
      generateSceneAsset: async () => {
        paidCalls += 1;
        const error = new Error('selected provider failed');
        error.code = 'SELECTED_MODEL_FAILED';
        throw error;
      },
      fixSceneAsset: async () => { paidCalls += 1; return {}; },
      reverifySceneAsset: async () => ({}),
    },
    promptAuthority: { assertCurrentPrompt: (_taskId, sceneId) => ({ prompt_version_id: `prompt:${sceneId}` }) },
    targetProgress: { upsert: (_task, entry) => ({ generation_progress: entry.progress }) },
    cancellation: { throwIfCancelled: () => {} },
  });
  const plan = orchestration.plan(task.id, {
    image_model: chosen.image_model,
    actions: [{ scene_id: 'scene-1' }, { scene_id: 'scene-2' }],
  });
  assert(plan.actions.every(action => action.image_model === chosen.image_model && action.single_attempt === true));
  const batch = await orchestration.execute(task.id, plan, { generationId: 'generation-v257' });
  assert.strictEqual(paidCalls, 2, 'independent scenes must be submitted concurrently with the same explicit user selection');
  assert.strictEqual(batch.status, 'failed');
  assert.strictEqual(batch.results.length, 2);
  assert(batch.results.every(item => item.status === 'failed' && item.error_code === 'SELECTED_MODEL_FAILED'));

  const routeSource = source('src/routes/newStoryAd.js');
  for (const stage of ['person_sheet', 'product_asset', 'scene_asset', 'scene_panorama', 'keyframe', 'video']) {
    assert(routeSource.includes(`new_story_ad.${stage}`), `route boundary missing selection stage ${stage}`);
  }
  const workspaceRoute = source('src/routes/storyAdWorkspace.js');
  assert(workspaceRoute.includes("applySelection('new_story_ad.story_flow_sketch'"));
  assert(workspaceRoute.includes("applySelection('new_story_ad.storyboard_image'"));
  const pickerSource = source('public/story-ad/views/generationModelPicker.js');
  assert(pickerSource.includes('data-generation-model-picker'));
  assert(source('public/story-ad/views/sceneCardInteractions.js').includes('image_model: imageModel'));
  assert(source('public/story-ad/views/storyboardView.js').includes('image_model: selectedSketchModel()'));
  assert(source('public/story-ad/views/finalView.js').includes('video_model_route: videoModelRoute'));

  console.log(JSON.stringify({
    passed: true,
    scene_models: sceneCatalog.models.length,
    video_models: videoCatalog.models.length,
    public_selection: publicSelection,
    selected_scene_model: chosen.image_model,
    independent_scene_calls: paidCalls,
    automatic_model_switches: 0,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
