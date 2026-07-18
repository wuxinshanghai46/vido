const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'new-story-ad-scene-repair');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_PUBLIC_BASE_URL = 'https://test.invalid';

const storage = require('../src/services/newStoryAd/storageService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');

function passingContract(views = []) {
  return {
    schema_version: 3,
    status: 'verified',
    full_space_lock: true,
    space_lock_status: 'complete',
    verification: { state: 'verified', message: '通过' },
    requirement_qa: {
      pass: true,
      layout_match_score: 0.95,
      material_light_match_score: 0.94,
      interaction_match_score: 0.93,
      surface_topology_match_score: 0.96,
      negative_compliance_score: 0.98,
      mismatch_reasons: [],
    },
    cross_view_qa: {
      pass: true,
      scene_consistency_score: 0.95,
      geometry_consistency_score: 0.94,
      material_consistency_score: 0.95,
      mismatch_reasons: [],
    },
    spatial_coverage_qa: {
      pass: true,
      layout_topology_score: 0.94,
      camera_diversity_score: 0.91,
      reverse_coverage_score: 0.9,
      interaction_zone_score: 0.9,
      reasons: [],
    },
    layout_contract: { required: true, status: 'available' },
    cameras: views.map(view => ({ view_id: view.key, reference_image_url: view.url })),
  };
}

function rejectedReverseContract() {
  return {
    schema_version: 3,
    status: 'rejected',
    full_space_lock: false,
    verification: {
      state: 'rejected',
      retryable: true,
      message: '反向视图覆盖不足',
      reasons: ['第2张反向/侧向图与主视图差异极小', '反向或侧向空间覆盖不足'],
    },
    requirement_qa: {
      pass: true,
      layout_match_score: 0.95,
      material_light_match_score: 0.94,
      interaction_match_score: 0.93,
      surface_topology_match_score: 0.96,
      negative_compliance_score: 0.98,
      mismatch_reasons: [],
    },
    cross_view_qa: {
      pass: true,
      scene_consistency_score: 0.95,
      geometry_consistency_score: 0.94,
      material_consistency_score: 0.95,
      mismatch_reasons: [],
    },
    spatial_coverage_qa: {
      pass: false,
      layout_topology_score: 0.94,
      camera_diversity_score: 0.9,
      reverse_coverage_score: 0.1,
      interaction_zone_score: 0.9,
      reasons: ['第2张反向/侧向图与主视图差异极小', '反向或侧向空间覆盖不足'],
    },
    layout_contract: { required: true, status: 'available' },
  };
}

async function main() {
  const originalGenerateVision = modelGateway.generateVision;
  modelGateway.generateVision = async () => ({
    text: '{"pass":true,"requirement_qa":',
    used_model: 'mock/broken-json',
  });
  try {
    await assert.rejects(
      () => sceneSpace.analyzeSceneViews({
        taskId: 'broken-json-contract',
        sceneId: 'broken-json-scene',
        revision: 1,
        views: ['master', 'reverse', 'interaction', 'detail', 'layout'].map(key => ({
          key,
          url: `https://test.invalid/${key}.png`,
        })),
        requested: {},
        layoutRequired: true,
      }),
      error => error?.code === 'VISION_QA_SCHEMA_INVALID' && error?.retryable === true,
      'malformed vision JSON must use the preservable QA schema error code',
    );
  } finally {
    modelGateway.generateVision = originalGenerateVision;
  }

  const verbosePrompt = Array.from({ length: 20 }, (_, index) => `Section ${index + 1}: ${'camera material topology '.repeat(18)}`).join('\n\n');
  const auditSafePrompt = sceneAssets.buildSceneAuditSafePrompt({
    ctx: { controlled_production: { style_control: { notes: 'real commercial photography' } } },
    body: {
      scene_spec: {
        layoutText: 'One continuous room with a complete main wall and one entrance.',
        materialLightText: 'Brushed stainless steel, etched metallic texture and warm grazing light.',
        interactionText: 'Clear action zone in front of the main wall.',
        surfaceTopology: { mode: 'continuous', seam_policy: 'hidden' },
      },
    },
    viewKey: 'layout',
  });
  assert.ok(auditSafePrompt.length <= 2200);
  assert.match(auditSafePrompt, /high-oblique architectural survey/i);
  assert.doesNotMatch(auditSafePrompt, /arms|hands|legs|body|silhouette|fingerprints/i);
  const nanoPrompt = mediaAdapter.promptForImageCandidate(verbosePrompt, { modelId: 'nano-banana-pro' }, auditSafePrompt);
  assert.equal(nanoPrompt, auditSafePrompt);
  assert.ok(nanoPrompt.length <= 2400);
  const gptPrompt = mediaAdapter.promptForImageCandidate('normal provider prompt', { modelId: 'gpt-image-2' }, auditSafePrompt);
  assert.equal(gptPrompt, 'normal provider prompt');
  assert.equal(mediaAdapter.promptForImageCandidate('normal provider prompt', { modelId: 'gpt-image-2' }, auditSafePrompt, true), auditSafePrompt);
  let auditAttempts = 0;
  const auditRetryResult = await mediaAdapter.invokeWithAuditSafeRetry(async candidatePrompt => {
    auditAttempts += 1;
    if (auditAttempts === 1) throw new Error('provider error: AuditSubmitIllegal');
    return candidatePrompt;
  }, 'rejected prompt', auditSafePrompt);
  assert.equal(auditAttempts, 2);
  assert.equal(auditRetryResult, auditSafePrompt);

  const currentFailurePlan = sceneAssets.buildSceneRepairPlan({
    scene_contract: {
      schema_version: 3,
      status: 'rejected',
      verification: { state: 'rejected', reasons: ['第5张不是顶视布局且与主图重复', '材质缺失金属拉丝和蚀刻纹理'] },
      requirement_qa: { pass: false, layout_match_score: 0.9, material_light_match_score: 0.5, interaction_match_score: 1, surface_topology_match_score: 1, negative_compliance_score: 1, mismatch_reasons: ['材质缺失金属拉丝和蚀刻纹理'] },
      cross_view_qa: { pass: true },
      spatial_coverage_qa: { pass: false, layout_topology_score: 0, camera_diversity_score: 0.2, reverse_coverage_score: 0.1, interaction_zone_score: 0, reasons: ['第5张不是顶视布局且与主图重复'] },
    },
  });
  assert.deepEqual(currentFailurePlan.view_keys, ['layout', 'master', 'reverse', 'interaction', 'detail']);

  const taskId = 'scene-repair-test';
  const sceneId = 'scene-repair-one';
  const sceneSpec = {
    layoutText: 'One continuous room with a main wall and one entrance.',
    materialLightText: 'Brushed stainless steel and warm grazing light.',
    interactionText: 'Keep a clear interaction zone in front of the main wall.',
    negativeText: 'No people, no text and no visible modular seams.',
    surfaceTopology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'regional' },
  };
  const context = { brief: 'Repair only the failed spatial view.', scene_spec: sceneSpec };
  storage.createTask({ id: taskId, title: 'scene repair', request: context });
  storage.saveOutput(taskId, 'context', context);
  const urls = Object.fromEntries(['master', 'reverse', 'interaction', 'detail', 'layout'].map(key => [key, `/old-${key}.png`]));
  storage.saveOutput(taskId, 'scene_assets', [{
    id: sceneId,
    scene_id: sceneId,
    scene_revision: 1,
    name: 'repair scene',
    image_url: urls.master,
    view_images: ['master', 'reverse', 'interaction', 'detail', 'layout'].map(key => ({ key, url: urls[key], image_url: urls[key] })),
    layout_summary: sceneSpec.layoutText,
    material_summary: sceneSpec.materialLightText,
    interaction_summary: sceneSpec.interactionText,
    negative: sceneSpec.negativeText,
    surface_topology: sceneSpec.surfaceTopology,
    scene_contract: rejectedReverseContract(),
  }]);

  const calls = [];
  const originalGenerateImage = mediaAdapter.generateImage;
  const originalAnalyze = sceneSpace.analyzeSceneViews;
  mediaAdapter.generateImage = async options => {
    calls.push(options);
    return { url: '/new-reverse.png', image_url: '/new-reverse.png', provider_used: 'mock/repair' };
  };
  sceneSpace.analyzeSceneViews = async options => passingContract(options.views);
  try {
    const result = await sceneAssets.repairSceneAsset(taskId, sceneId, { scene_spec: sceneSpec, aspect_ratio: '16:9' });
    assert.equal(calls.length, 1, 'only the rejected reverse view should be regenerated');
    assert.match(calls[0].filename, /_reverse_/);
    assert.deepEqual(calls[0].referenceImages, ['/old-master.png', '/old-layout.png']);
    assert.equal(calls[0].inputFidelity, 'low');
    assert.match(calls[0].prompt, /Mandatory correction from the previous rejected attempt/i);
    assert.equal(result.scene_asset.scene_revision, 2);
    assert.equal(result.scene_asset.view_images.find(view => view.key === 'reverse').url, '/new-reverse.png');
    assert.equal(result.scene_asset.view_images.find(view => view.key === 'master').url, '/old-master.png');
    assert.equal(result.scene_asset.view_images.find(view => view.key === 'layout').url, '/old-layout.png');
    assert.equal(result.scene_asset.scene_contract.full_space_lock, true);
    assert.equal(result.scene_asset.repair_history.length, 1);
    assert.deepEqual(result.scene_asset.repair_history[0].regenerated_view_keys, ['reverse']);
    assert.equal(result.scene_asset.repair_plan.action, 'none');

    const unavailableTaskId = 'scene-repair-qa-unavailable-test';
    const unavailableSceneId = 'scene-repair-qa-unavailable';
    storage.createTask({ id: unavailableTaskId, title: 'preserve generated scene', request: context });
    storage.saveOutput(unavailableTaskId, 'context', context);
    storage.saveOutput(unavailableTaskId, 'scene_assets', [{
      id: unavailableSceneId,
      scene_id: unavailableSceneId,
      scene_revision: 1,
      name: 'preserve scene',
      image_url: urls.master,
      view_images: ['master', 'reverse', 'interaction', 'detail', 'layout'].map(key => ({ key, url: urls[key], image_url: urls[key] })),
      layout_summary: sceneSpec.layoutText,
      material_summary: sceneSpec.materialLightText,
      interaction_summary: sceneSpec.interactionText,
      negative: sceneSpec.negativeText,
      surface_topology: sceneSpec.surfaceTopology,
      scene_contract: rejectedReverseContract(),
    }]);
    sceneSpace.analyzeSceneViews = async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    };
    const unavailableResult = await sceneAssets.repairSceneAsset(unavailableTaskId, unavailableSceneId, {
      scene_spec: sceneSpec,
      aspect_ratio: '16:9',
    });
    assert.equal(calls.length, 2, 'the failed reverse view should be generated exactly once before QA fails');
    assert.equal(unavailableResult.scene_asset.scene_revision, 2);
    assert.equal(unavailableResult.scene_asset.scene_contract.qa_unavailable, true);
    assert.equal(unavailableResult.scene_asset.scene_contract.verification.state, 'unavailable');
    assert.equal(unavailableResult.scene_asset.repair_plan.action, 'reverify');
    assert.equal(storage.getOutput(unavailableTaskId, 'scene_assets')[0].scene_revision, 2, 'the paid revision must remain persisted');

    sceneSpace.analyzeSceneViews = async options => passingContract(options.views);
    const callsBeforeReverify = calls.length;
    const reverified = await sceneAssets.reverifySceneAsset(unavailableTaskId, unavailableSceneId);
    assert.equal(calls.length, callsBeforeReverify, 'reverification must never call the image generator');
    assert.equal(reverified.scene_asset.scene_revision, 2);
    assert.equal(reverified.scene_asset.scene_contract.full_space_lock, true);
    assert.equal(reverified.scene_asset.repair_plan.action, 'none');
    console.log(JSON.stringify({
      success: true,
      current_failure_repairs: currentFailurePlan.view_keys,
      nano_prompt_length: nanoPrompt.length,
      audit_retry_attempts: auditAttempts,
      targeted_generation_calls: calls.length,
      regenerated_views: result.scene_asset.repair_history[0].regenerated_view_keys,
      final_space_lock: result.scene_asset.scene_contract.full_space_lock,
      malformed_json_code: 'VISION_QA_SCHEMA_INVALID',
      preserved_revision_after_qa_failure: unavailableResult.scene_asset.scene_revision,
      reverify_image_calls: calls.length - callsBeforeReverify,
    }, null, 2));
  } finally {
    mediaAdapter.generateImage = originalGenerateImage;
    sceneSpace.analyzeSceneViews = originalAnalyze;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
