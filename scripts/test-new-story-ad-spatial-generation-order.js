const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'new-story-ad-spatial-generation-order');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_PUBLIC_BASE_URL = 'https://test.invalid';
process.env.NEW_STORY_AD_SCENE_IMAGE_RETRY_DELAY_MS = '1';

const storage = require('../src/services/newStoryAd/storageService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const pipelineModels = require('../src/services/pipelineModelService');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const storyAdService = require('../src/services/newStoryAd/storyAdService');

async function main() {
  const taskId = 'spatial-generation-order-test';
  const context = {
    brief: 'Lock one reusable commercial interior before storyboard generation.',
    product_subject: 'current task subject',
    scene_spec: {
      layoutText: 'One complete room with a main wall, entrance, sofa, table and empty interaction zone.',
      materialLightText: 'Continuous metal feature wall with warm grazing light and realistic stone floor.',
      interactionText: 'Keep a reachable action zone beside the table and an unobstructed route from the entrance.',
      negativeText: 'No people, no text, no duplicated furniture and no visible decorative panel seams.',
      surfaceTopology: {
        mode: 'continuous',
        seam_policy: 'hidden',
        finish_distribution: 'regional',
      },
    },
  };
  storage.createTask({ id: taskId, title: 'spatial generation order', request: context });
  storage.saveOutput(taskId, 'context', context);

  const calls = [];
  let activeImageCalls = 0;
  let peakImageCalls = 0;
  let transientFailuresRemaining = 0;
  let transientFilenamePattern = null;
  let layoutPreflightFailuresRemaining = 0;
  let finalQaLayoutFailuresRemaining = 0;
  let finalQaUnavailableRemaining = 0;
  const originalGenerateImage = mediaAdapter.generateImage;
  const originalAnalyze = sceneSpace.analyzeSceneViews;
  const originalValidateLayout = sceneSpace.validateLayoutAcquisition;
  mediaAdapter.generateImage = async options => {
    calls.push(options);
    const callNumber = calls.length;
    activeImageCalls += 1;
    peakImageCalls = Math.max(peakImageCalls, activeImageCalls);
    await new Promise(resolve => setTimeout(resolve, 5));
    if (transientFailuresRemaining > 0 && transientFilenamePattern?.test(options.filename || '')) {
      transientFailuresRemaining -= 1;
      activeImageCalls -= 1;
      throw new Error('gpt-image-2 provider error: code=500, message=Internal Server Error');
    }
    const url = `/mock-scene-view-${callNumber}.png`;
    activeImageCalls -= 1;
    return { url, image_url: url, provider_used: 'mock/spatial-order' };
  };
  sceneSpace.analyzeSceneViews = async options => {
    if (finalQaUnavailableRemaining > 0) {
      finalQaUnavailableRemaining -= 1;
      const error = new Error('vision service temporarily unavailable');
      error.code = 'VISION_QA_UNAVAILABLE';
      error.retryable = true;
      throw error;
    }
    const layoutRejected = finalQaLayoutFailuresRemaining > 0;
    if (layoutRejected) finalQaLayoutFailuresRemaining -= 1;
    return {
      schema_version: 4,
      status: layoutRejected ? 'rejected' : 'verified',
      full_space_lock: !layoutRejected,
      observed_summary: 'One locked location represented by five distinct spatial views.',
      verification: layoutRejected
        ? { state: 'rejected', reasons: ['第5张俯视布局只是主视图的轻微抬高重构'] }
        : { state: 'verified', reasons: [] },
      cross_view_qa: {
        pass: true,
        scene_consistency_score: 0.96,
        geometry_consistency_score: 0.95,
        material_consistency_score: 0.96,
        mismatch_reasons: [],
      },
      requirement_qa: {
        pass: true,
        layout_match_score: 0.96,
        material_light_match_score: 0.95,
        interaction_match_score: 0.94,
        surface_topology_match_score: 0.96,
        negative_compliance_score: 0.97,
        mismatch_reasons: [],
      },
      spatial_coverage_qa: {
        pass: !layoutRejected,
        layout_topology_score: layoutRejected ? 0.2 : 0.95,
        camera_diversity_score: layoutRejected ? 0.4 : 0.92,
        reverse_coverage_score: 0.9,
        interaction_zone_score: 0.9,
        reasons: layoutRejected ? ['第5张俯视布局只是主视图的轻微抬高重构'] : [],
      },
      layout_contract: { required: true, status: 'available' },
      view_issues: layoutRejected ? [{
        code: 'LAYOUT_ROLE_INVALID',
        view_keys: ['layout'],
        reason: '俯视布局只是主视图的轻微抬高重构',
        evidence: '未覆盖完整可用范围',
        confidence: 0.98,
      }] : [],
      cameras: options.views.map(view => ({ view_id: view.key, reference_image_url: view.url })),
    };
  };
  sceneSpace.validateLayoutAcquisition = async () => {
    if (layoutPreflightFailuresRemaining > 0) {
      layoutPreflightFailuresRemaining -= 1;
      return {
        pass: false,
        layout_role_score: 0.2,
        footprint_coverage_score: 0.2,
        scene_identity_score: 0.95,
        camera_relocation_score: 0.2,
        reasons: ['机位仍接近主视图，没有展示完整可用范围'],
      };
    }
    return {
      pass: true,
      layout_role_score: 0.95,
      footprint_coverage_score: 0.94,
      scene_identity_score: 0.96,
      camera_relocation_score: 0.93,
      reasons: [],
    };
  };

  try {
    const generated = await sceneAssets.generateSceneAsset(taskId, {
      scene_id: 'locked-room',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    const asset = generated.scene_asset;

    assert.equal(sceneAssets.needsLayoutView({ layout: 'one simple wall' }), true);
    assert.deepEqual(sceneAssets.REQUIRED_SCENE_VIEW_KEYS, ['layout', 'master', 'reverse', 'interaction', 'detail']);
    assert.deepEqual(sceneAssets.SCENE_GENERATION_ORDER, ['master', 'layout', 'reverse', 'interaction', 'detail']);
    assert.equal(calls.length, 5, 'one generation call per required asset, with no service-level retry');
    assert.equal(peakImageCalls, 3, 'reverse, interaction and detail must run in parallel after master and overview are ready');
    assert.match(calls[0].filename, /_master_/);
    assert.deepEqual(calls[0].referenceImages || [], []);
    assert.equal(calls[0].imageModel, 'gpt-image-2');
    assert.match(calls[0].prompt, /MASTER ESTABLISHING PHOTOGRAPH/i);
    assert.match(calls[0].prompt, /real on-location photograph/i);
    assert.match(calls[0].prompt, /must not resemble an architectural visualization/i);
    assert.doesNotMatch(calls[0].prompt, /geometry-only spatial blueprint/i);
    assert.match(calls[0].auditSafePrompt, /root master establishing photograph/i);
    assert.ok(calls[0].auditSafePrompt.length <= 2200);

    assert.match(calls[1].filename, /_layout_/);
    assert.deepEqual(calls[1].referenceImages, ['/mock-scene-view-1.png']);
    assert.equal(calls[1].requireReferences, true);
    assert.equal(calls[1].inputFidelity, 'low');
    assert.equal(calls[1].imageModel, 'gpt-image-2');
    assert.match(calls[1].prompt, /PHOTOGRAPHIC HIGH-OBLIQUE WHOLE-SPACE OVERVIEW/i);
    assert.match(calls[1].prompt, /65 to 80 degree downward pitch/i);
    assert.match(calls[1].prompt, /usable ground\/base footprint must occupy most of the frame/i);
    assert.match(calls[1].prompt, /master reference controls scene identity.*not the target camera composition/i);
    assert.doesNotMatch(calls[1].prompt, /Scene interaction and camera position requirement/i);
    assert.ok(calls[1].prompt.length <= 6200, 'layout role prompt must remain compact enough for Image2 to prioritize camera acquisition');
    assert.match(calls[1].prompt, /Reference image 1 is the master establishing view/i);
    assert.match(calls[1].prompt, /same location|exact physical location/i);
    assert.match(calls[1].prompt, /not a neutral diagram, clay render, dollhouse/i);
    assert.match(calls[1].prompt, /Material identity and surface topology are independent constraints/i);
    assert.match(calls[1].auditSafePrompt, /real high-oblique whole-space photograph/i);

    for (const call of calls.slice(2, 4)) {
      assert.deepEqual(call.referenceImages, ['/mock-scene-view-1.png', '/mock-scene-view-2.png']);
      assert.equal(call.requireReferences, true);
      assert.equal(call.inputFidelity, 'low');
      assert.equal(call.imageModel, 'gpt-image-2');
      assert.match(call.prompt, /Reference image 1 is the master establishing view.*Reference image 2 is the master-derived high-oblique spatial overview/i);
      assert.match(call.prompt, /master as the primary scene\/appearance identity/i);
      assert.match(call.prompt, /no people/i);
      assert.ok(call.auditSafePrompt.length <= 2200);
    }
    assert.match(calls[2].filename, /_reverse_/);
    assert.match(calls[2].prompt, /at least about 90 degrees of azimuth change/i);
    assert.match(calls[2].prompt, /not a small reframing|near-identical composition/i);
    assert.match(calls[3].filename, /_interaction_/);
    assert.match(calls[3].prompt, /human eye\/chest height/i);
    assert.match(calls[3].prompt, /empty standing\/action clearance/i);
    assert.match(calls[4].filename, /_detail_/);
    assert.deepEqual(calls[4].referenceImages, ['/mock-scene-view-1.png']);
    assert.equal(calls[4].inputFidelity, 'high');
    assert.match(calls[4].prompt, /Reference image 1 is the master establishing view/i);
    assert.match(calls[4].prompt, /close or macro crop/i);
    assert.match(calls[4].prompt, /must not be another wide room view/i);

    assert.deepEqual(asset.view_images.map(view => view.key), ['master', 'reverse', 'interaction', 'detail', 'layout']);
    assert.equal(asset.image_url, '/mock-scene-view-1.png', 'master remains the historical primary thumbnail');
    assert.equal(asset.view_count, 5);
    assert.equal(asset.generation_contract_version, 5);
    assert.equal(asset.layout_contract.required, true);
    assert.equal(asset.view_acquisition.layout_policy, 'required_for_all_new_scenes');
    assert.equal(asset.view_acquisition.layout_appearance_role, 'master_derived_photographic_overview');
    assert.equal(asset.view_acquisition.generation_contract_version, 5);
    assert.deepEqual(asset.view_acquisition.generation_order, ['master', 'layout', 'reverse', 'interaction', 'detail']);
    assert.deepEqual(asset.view_acquisition.reference_graph, {
      master: [],
      layout: ['master'],
      reverse: ['master', 'layout'],
      interaction: ['master', 'layout'],
      detail: ['master'],
    });
    const progress = storage.getTask(taskId).generation_progress;
    assert.equal(progress.stage, 'scene_asset');
    assert.equal(progress.status, 'completed');
    assert.equal(progress.target_total, 5);
    assert.equal(progress.succeeded, 5);
    assert.deepEqual(progress.completed_view_keys, ['master', 'layout', 'reverse', 'interaction', 'detail']);
    assert.equal(storyAdService.taskSummary(storage.getTask(taskId)).generation_progress.stage, 'scene_asset', 'scene progress must reach the polling API');
    const publicSceneAsset = storyAdService.publicTaskBundle(taskId).outputs.scene_assets[0];
    assert.equal(publicSceneAsset.repair_plan.version, 5, 'the public bundle must normalize scene assets before rendering the repair action');

    const retryTaskId = 'spatial-generation-transient-retry-test';
    storage.createTask({ id: retryTaskId, title: 'transient image2 retry', request: context });
    storage.saveOutput(retryTaskId, 'context', context);
    const callsBeforeRetryTask = calls.length;
    transientFailuresRemaining = 1;
    transientFilenamePattern = /_reverse_/;
    const retried = await sceneAssets.generateSceneAsset(retryTaskId, {
      scene_id: 'retry-room',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    assert.equal(calls.length - callsBeforeRetryTask, 6, 'one transient Image2 500 must retry only the failed view once');
    assert.equal(retried.scene_asset.view_count, 5);
    assert.equal(storage.getTask(retryTaskId).generation_progress.status, 'completed');

    const preflightTaskId = 'spatial-layout-preflight-retry-test';
    storage.createTask({ id: preflightTaskId, title: 'layout preflight retry', request: context });
    storage.saveOutput(preflightTaskId, 'context', context);
    const callsBeforePreflightTask = calls.length;
    layoutPreflightFailuresRemaining = 1;
    const preflightRetried = await sceneAssets.generateSceneAsset(preflightTaskId, {
      scene_id: 'preflight-room',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    const preflightCalls = calls.slice(callsBeforePreflightTask);
    assert.equal(preflightCalls.length, 6, 'a role-invalid layout must retry only the layout once before derived views');
    assert.deepEqual(preflightCalls.map(call => /_(master|layout|reverse|interaction|detail)(?:_|\.)/.exec(call.filename)?.[1]), [
      'master', 'layout', 'layout', 'reverse', 'interaction', 'detail',
    ]);
    assert.match(preflightCalls[2].prompt, /Automated layout-role validation rejected the previous candidate/i);
    assert.equal(preflightRetried.scene_asset.view_count, 5);

    const autoRepairTaskId = 'spatial-final-qa-auto-repair-test';
    storage.createTask({ id: autoRepairTaskId, title: 'bounded auto repair', request: context });
    storage.saveOutput(autoRepairTaskId, 'context', context);
    const callsBeforeAutoRepair = calls.length;
    finalQaLayoutFailuresRemaining = 1;
    const autoRepaired = await sceneAssets.generateSceneAsset(autoRepairTaskId, {
      scene_id: 'auto-repair-location',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    assert.equal(calls.length - callsBeforeAutoRepair, 6, 'final QA layout rejection must auto-regenerate only layout once');
    assert.equal(autoRepaired.scene_asset.scene_revision, 2);
    assert.equal(autoRepaired.scene_asset.scene_contract.full_space_lock, true);
    assert.deepEqual(autoRepaired.scene_asset.repair_history[0].regenerated_view_keys, ['layout']);

    const boundedTaskId = 'spatial-final-qa-bounded-repair-test';
    storage.createTask({ id: boundedTaskId, title: 'bounded repeated rejection', request: context });
    storage.saveOutput(boundedTaskId, 'context', context);
    const callsBeforeBounded = calls.length;
    finalQaLayoutFailuresRemaining = 2;
    const bounded = await sceneAssets.generateSceneAsset(boundedTaskId, {
      scene_id: 'bounded-repair-location',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    assert.equal(calls.length - callsBeforeBounded, 6, 'automatic paid repair must stop after one targeted cycle');
    assert.equal(bounded.scene_asset.scene_revision, 2);
    assert.equal(bounded.scene_asset.scene_contract.full_space_lock, false);
    assert.deepEqual(bounded.scene_asset.repair_plan.view_keys, ['layout']);

    const unavailableTaskId = 'spatial-final-qa-unavailable-test';
    storage.createTask({ id: unavailableTaskId, title: 'qa unavailable preservation', request: context });
    storage.saveOutput(unavailableTaskId, 'context', context);
    const callsBeforeUnavailable = calls.length;
    finalQaUnavailableRemaining = 1;
    const qaUnavailable = await sceneAssets.generateSceneAsset(unavailableTaskId, {
      scene_id: 'qa-unavailable-location',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    assert.equal(calls.length - callsBeforeUnavailable, 5, 'QA infrastructure failure must never trigger paid image regeneration');
    assert.equal(qaUnavailable.scene_asset.scene_contract.qa_unavailable, true);
    assert.equal(qaUnavailable.scene_asset.repair_plan.action, 'reverify');

    const genericCases = [
      { material: 'open-grain oak veneer with directional grain and soft wax sheen', forbidden: /stainless steel/i },
      { material: 'translucent borosilicate glass with crisp refraction and matte polymer', forbidden: /oak veneer/i },
      { material: 'woven acoustic fabric with readable fibre scale and anodized aluminium', forbidden: /borosilicate/i },
    ];
    for (const [index, item] of genericCases.entries()) {
      const genericPrompt = sceneAssets.buildSceneSheetPrompt({
        ctx: { brief: `generic business case ${index + 1}` },
        body: { scene_spec: { layoutText: 'one coherent reusable space', materialLightText: item.material } },
        outputRole: 'contract',
      });
      assert.ok(genericPrompt.includes(item.material), 'the current task material must remain authoritative');
      assert.match(genericPrompt, /Keep every task-provided proprietary or trade finish name as content authority/i);
      assert.match(genericPrompt, /Multiple finish terms do not authorize bands, swatches or catalogue panels/i);
      assert.doesNotMatch(genericPrompt, item.forbidden, 'a different test industry/material must never be injected');
    }
    const universalLayoutCases = [
      { layout: 'an enclosed clinic with two access points and fixed treatment anchors', forbidden: /outdoor road|construction yard/i },
      { layout: 'an outdoor road work zone with barriers, access lane and equipment anchors', forbidden: /clinic|office furniture/i },
      { layout: 'a semi-open retail courtyard with two entrances and a central display anchor', forbidden: /treatment|road work/i },
    ];
    universalLayoutCases.forEach((item, index) => {
      const rolePrompt = sceneAssets.buildLayoutAcquisitionPrompt({
        ctx: { brief: `universal location ${index + 1}` },
        body: {
          scene_spec: {
            layoutText: item.layout,
            materialLightText: 'task-specific observable material and natural practical light',
            interactionText: 'eye-level camera tracks parallel to the wall, then cuts to a close-up cinematic lens',
          },
        },
      });
      assert.ok(rolePrompt.length <= 3600);
      assert.ok(rolePrompt.includes(item.layout));
      assert.match(rolePrompt, /65 to 80 degree downward pitch/i);
      assert.match(rolePrompt, /usable ground\/base footprint must occupy most of the frame/i);
      assert.doesNotMatch(rolePrompt, /eye-level camera tracks parallel to the wall|close-up cinematic lens/i);
      assert.doesNotMatch(rolePrompt, item.forbidden);
    });
    const continuousTradeFinishPrompt = sceneAssets.buildSceneSheetPrompt({
      ctx: { brief: 'generic continuous-surface task' },
      body: {
        scene_spec: {
          layoutText: '一整面连续完整平直的主表面',
          materialLightText: '专有蚀刻纹理、做旧金属风格和细腻拉丝质感的装饰面板',
          negativeText: '禁止模块化拼板、竖向接缝、网格和样品展示墙',
          surfaceTopology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'regional' },
        },
      },
      outputRole: 'contract',
    });
    assert.match(continuousTradeFinishPrompt, /ONE monolithic uninterrupted visual plane/i);
    assert.match(continuousTradeFinishPrompt, /ZERO visible joints/i);
    assert.match(continuousTradeFinishPrompt, /one coherent dominant finish over the primary surface/i);
    assert.match(continuousTradeFinishPrompt, /No authoritative material sample image is attached/i);
    assert.doesNotMatch(continuousTradeFinishPrompt, /physically supplied as sheets, boards or panels|Keep any physically necessary task-supported joints visually recessive/i);
    assert.deepEqual(sceneAssets.sceneMaterialReferenceImages({
      product_contract: { reference_images: ['https://example.invalid/material-a.png', 'https://example.invalid/material-a.png'] },
    }), ['https://example.invalid/material-a.png']);
    const referencedMaterialPrompt = sceneAssets.buildSceneSheetPrompt({
      ctx: { product_contract: { reference_images: ['https://example.invalid/material-a.png'] } },
      body: { scene_spec: { materialLightText: 'task-defined finish' } },
      outputRole: 'contract',
    });
    assert.match(referencedMaterialPrompt, /attached task reference image is appearance evidence/i);
    const glassDetailPrompt = sceneAssets.buildSceneAuditSafePrompt({
      body: { scene_spec: { materialLightText: 'translucent architectural glass with natural refraction' } },
      viewKey: 'detail',
    });
    assert.doesNotMatch(glassDetailPrompt, /required metal finish/i, 'generic detail fallback must not hard-code a metal industry');
    assert.match(glassDetailPrompt, /task-required finish/i);
    assert.equal(mediaAdapter.requiredImageModelForStage('new_story_ad.person_sheet'), 'gpt-image-2');
    assert.equal(mediaAdapter.requiredImageModelForStage('new_story_ad.scene_asset'), 'gpt-image-2');
    assert.equal(mediaAdapter.requiredImageModelForStage('new_story_ad.keyframe'), 'gpt-image-2');
    assert.equal(mediaAdapter.requiredImageModelForStage('unrelated.image'), '');
    const policyCandidates = mediaAdapter.applyImageModelPolicy('new_story_ad.keyframe', [
      { provider_id: 'deyunai', model_id: 'nano-banana-pro' },
      { provider_id: 'deyunai', model_id: 'gpt-image-2' },
      { provider_id: 'deyunai', model_id: 'nano-banana' },
    ]);
    assert.deepEqual(policyCandidates.map(item => item.model_id), ['gpt-image-2'], 'story-ad image policy must remove every Nano Banana fallback');
    const strictImageStages = ['new_story_ad.person_sheet', 'new_story_ad.scene_asset', 'new_story_ad.keyframe'];
    strictImageStages.forEach(stageId => {
      assert.ok(pipelineModels.getStageDefaults(stageId).length > 0, `${stageId} must keep at least one Image2 default`);
      assert.ok(pipelineModels.getStageDefaults(stageId).every(item => item.model_id === 'gpt-image-2'), `${stageId} defaults must contain only Image2`);
      assert.ok(pipelineModels.listAvailableModelsForStage(stageId).every(item => item.model_id === 'gpt-image-2'), `${stageId} admin candidates must contain only Image2`);
      assert.equal(pipelineModels.validateStageModel(stageId, { provider_id: 'deyunai', model_id: 'nano-banana-pro' }).reason, 'stage_requires_gpt_image_2');
    });
    const sanitizedPipeline = pipelineModels.sanitizePipelineConfig({
      stages: {
        'new_story_ad.scene_asset': [
          { provider_id: 'deyunai', model_id: 'nano-banana-pro', enabled: true },
          { provider_id: 'deyunai', model_id: 'gpt-image-2', enabled: true },
          { provider_id: 'deyunai', model_id: 'nano-banana', enabled: true },
        ],
      },
    });
    assert.deepEqual(sanitizedPipeline.stages['new_story_ad.scene_asset'].map(item => item.model_id), ['gpt-image-2']);

    const circuitTaskId = 'spatial-image2-circuit-test';
    storage.createTask({ id: circuitTaskId, title: 'image2 circuit', request: context });
    storage.saveOutput(circuitTaskId, 'context', context);
    const callsBeforeCircuit = calls.length;
    transientFailuresRemaining = 2;
    transientFilenamePattern = /_master_/;
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(circuitTaskId, { scene_id: 'circuit-room', scene_spec: context.scene_spec }),
      /Internal Server Error/,
    );
    assert.equal(calls.length - callsBeforeCircuit, 2, 'two consecutive upstream failures must stop after one shared-budget retry');
    const cooldownTaskId = 'spatial-image2-cooldown-test';
    storage.createTask({ id: cooldownTaskId, title: 'image2 cooldown', request: context });
    storage.saveOutput(cooldownTaskId, 'context', context);
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(cooldownTaskId, { scene_id: 'cooldown-room', scene_spec: context.scene_spec }),
      error => error?.code === 'SCENE_IMAGE_PROVIDER_COOLDOWN',
    );
    assert.equal(calls.length - callsBeforeCircuit, 2, 'open circuit must reject without another paid provider call');
    sceneAssets._resetSceneImageCircuit();
    transientFailuresRemaining = 0;
    transientFilenamePattern = null;

    console.log(JSON.stringify({
      success: true,
      generation_order: asset.view_acquisition.generation_order,
      stored_view_order: asset.view_images.map(view => view.key),
      generation_calls: calls.length,
      peak_parallel_image_calls: peakImageCalls,
      real_progress_views: progress.succeeded,
      generic_material_cases: genericCases.length,
      all_views_empty_scene: calls.every(call => /no people/i.test(call.prompt)),
      primary_view_backward_compatible: asset.image_url === '/mock-scene-view-1.png',
      model_management_image2_only: true,
      task_extra_attempt_budget: sceneAssets.SCENE_IMAGE_EXTRA_ATTEMPTS,
      provider_circuit_breaker: true,
    }, null, 2));
  } finally {
    mediaAdapter.generateImage = originalGenerateImage;
    sceneSpace.analyzeSceneViews = originalAnalyze;
    sceneSpace.validateLayoutAcquisition = originalValidateLayout;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
