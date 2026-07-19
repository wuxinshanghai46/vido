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
    schema_version: 4,
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
    view_issues: [],
    cameras: views.map(view => ({ view_id: view.key, reference_image_url: view.url })),
  };
}

function rejectedReverseContract() {
  return {
    schema_version: 4,
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
    view_issues: [{
      code: 'REVERSE_COVERAGE_LOW',
      view_keys: ['reverse'],
      reason: '反向或侧向空间覆盖不足',
      evidence: '反向视图与主视图机位近似',
      confidence: 0.96,
    }],
  };
}

async function main() {
  const originalGenerateVision = modelGateway.generateVision;
  let visionCalls = 0;
  const completeDecision = {
    pass: false,
    status: 'rejected',
    observed_summary: 'same scene except interaction view',
    requirement_qa: { pass: true, layout_match_score: 0.95, material_light_match_score: 0.92, interaction_match_score: 0.9, surface_topology_match_score: 0.94, negative_compliance_score: 0.98, mismatch_reasons: [] },
    cross_view_qa: { pass: false, scene_consistency_score: 0.4, geometry_consistency_score: 0.4, material_consistency_score: 0.5, mismatch_reasons: ['interaction view differs'] },
    spatial_coverage_qa: { pass: false, layout_topology_score: 0.9, camera_diversity_score: 0.8, reverse_coverage_score: 0.8, interaction_zone_score: 0.2, reasons: ['interaction zone missing'] },
    view_issues: [{ code: 'INTERACTION_ZONE_MISSING', view_keys: ['interaction'], reason: '互动位缺少空置区', evidence: '未见可达目标与通路', confidence: 0.95 }],
  };
  const truncatedOptionalJson = `${JSON.stringify(completeDecision).slice(0, -1)},"anchors":[{"id":"anchor_1","visible_in`;
  modelGateway.generateVision = async () => {
    visionCalls += 1;
    return { text: `\`\`\`json\n${truncatedOptionalJson}`, used_model: 'mock/truncated-optional-json' };
  };
  const salvagedContract = await sceneSpace.analyzeSceneViews({
    taskId: 'salvaged-json-contract',
    sceneId: 'salvaged-json-scene',
    revision: 1,
    views: ['master', 'reverse', 'interaction', 'detail', 'layout'].map(key => ({ key, url: `https://test.invalid/${key}.png` })),
    requested: {},
    layoutRequired: true,
  });
  assert.equal(visionCalls, 1, 'complete QA gates must be salvaged without another vision request');
  assert.equal(salvagedContract.status, 'rejected');
  assert.equal(salvagedContract.cross_view_qa.scene_consistency_score, 0.4);
  assert.equal(salvagedContract.spatial_coverage_qa.interaction_zone_score, 0.2);

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
  assert.match(auditSafePrompt, /real high-oblique whole-space photograph/i);
  assert.match(auditSafePrompt, /brushed stainless steel/i);
  assert.match(auditSafePrompt, /not a neutral diagram, clay render, dollhouse/i);
  assert.doesNotMatch(auditSafePrompt, /arms|hands|legs|body|silhouette|fingerprints/i);
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
  assert.equal(currentFailurePlan.action, 'reverify', 'free-text reasons must never trigger paid regeneration');
  assert.deepEqual(currentFailurePlan.view_keys, []);

  const legacyMaterialFailurePlan = sceneAssets.buildSceneRepairPlan({
    view_acquisition: { layout_policy: 'required_for_all_new_scenes' },
    scene_contract: {
      schema_version: 3,
      status: 'rejected',
      verification: { state: 'rejected', reasons: ['主表面的材质身份与当前任务要求不符'] },
      requirement_qa: { pass: false, layout_match_score: 1, material_light_match_score: 0.3, interaction_match_score: 1, surface_topology_match_score: 1, negative_compliance_score: 1, mismatch_reasons: ['材质身份错误'] },
      cross_view_qa: { pass: true },
      spatial_coverage_qa: { pass: true, layout_topology_score: 1, camera_diversity_score: 1, reverse_coverage_score: 1, interaction_zone_score: 1, reasons: [] },
    },
  });
  assert.equal(legacyMaterialFailurePlan.action, 'reverify', 'legacy material prose must be reverified under the structured contract');

  const geometryOnlyMaterialFailurePlan = sceneAssets.buildSceneRepairPlan({
    view_acquisition: { layout_policy: 'required_for_all_new_scenes', layout_appearance_role: 'geometry_only' },
    scene_contract: {
      schema_version: 3,
      status: 'rejected',
      verification: { state: 'rejected', reasons: ['主表面的材质身份与当前任务要求不符'] },
      requirement_qa: { pass: false, layout_match_score: 1, material_light_match_score: 0.3, interaction_match_score: 1, surface_topology_match_score: 1, negative_compliance_score: 1, mismatch_reasons: ['材质身份错误'] },
      cross_view_qa: { pass: true },
      spatial_coverage_qa: { pass: true, layout_topology_score: 1, camera_diversity_score: 1, reverse_coverage_score: 1, interaction_zone_score: 1, reasons: [] },
    },
  });
  assert.equal(geometryOnlyMaterialFailurePlan.action, 'reverify', 'old geometry-first prose must not expand into paid generation');

  const upgradedLegacyAsset = sceneAssets.normalizeSceneAssets([{
    id: 'legacy-v1-plan',
    scene_id: 'legacy-v1-plan',
    layout_summary: 'A coherent legacy scene with one continuous main surface.',
    view_acquisition: { layout_policy: 'required_for_all_new_scenes' },
    repair_plan: { version: 1, action: 'regenerate_views', view_keys: ['master', 'reverse', 'interaction', 'detail'], count: 4 },
    scene_contract: legacyMaterialFailurePlan.action === 'regenerate_views' ? {
      schema_version: 3,
      status: 'rejected',
      verification: { state: 'rejected', reasons: ['material identity and texture do not match the request'] },
      requirement_qa: { pass: false, material_light_match_score: 0.3, mismatch_reasons: ['material finish is wrong'] },
      cross_view_qa: { pass: true },
      spatial_coverage_qa: { pass: true },
    } : {},
  }])[0];
  assert.equal(upgradedLegacyAsset.repair_plan.version, 5, 'stored v1 repair plans must be upgraded on read');
  assert.equal(upgradedLegacyAsset.repair_plan.action, 'reverify');
  assert.deepEqual(upgradedLegacyAsset.repair_plan.view_keys, []);

  const explicitInteractionFailurePlan = sceneAssets.buildSceneRepairPlan({
    scene_contract: {
      schema_version: 3,
      status: 'rejected',
      verification: { state: 'rejected', reasons: ['第三张图展示了一个与其余四张图完全不同的场景。'] },
      requirement_qa: { pass: false, layout_match_score: 0.5, material_light_match_score: 0.8, interaction_match_score: 1, surface_topology_match_score: 0, negative_compliance_score: 0, mismatch_reasons: ['第三张图的背景墙为模块化矩形拼板，严重违反连续完整墙体要求。'] },
      cross_view_qa: { pass: false, scene_consistency_score: 0, geometry_consistency_score: 0, material_consistency_score: 0, mismatch_reasons: ['第三张图展示了一个与其余四张图完全不同的场景。'] },
      spatial_coverage_qa: { pass: false, layout_topology_score: 1, camera_diversity_score: 1, reverse_coverage_score: 1, interaction_zone_score: 1, reasons: ['主场景的空间覆盖完整。'] },
      view_issues: [{ code: 'CROSS_VIEW_DRIFT', view_keys: ['interaction'], reason: '互动位与其余视图不是同一场景', evidence: '固定锚点不一致', confidence: 0.98 }],
    },
  });
  assert.deepEqual(explicitInteractionFailurePlan.view_keys, ['interaction'], 'an explicitly failed third view must not expand into five paid regenerations');

  const emptyEvidenceIssues = sceneSpace.normalizeViewIssues([{
    code: 'PHOTOREALISM_INVALID',
    view_keys: ['master', 'reverse'],
    reason: 'photorealism is insufficient',
    evidence: '',
    confidence: 0.9,
  }]);
  assert.deepEqual(emptyEvidenceIssues, [], 'an issue without visible evidence must not authorize paid regeneration');
  const emptyEvidencePlan = sceneAssets.buildSceneRepairPlan({
    status: 'rejected',
    verification: { state: 'rejected' },
    view_issues: [{
      code: 'PHOTOREALISM_INVALID',
      view_keys: ['master', 'reverse'],
      reason: 'photorealism is insufficient',
      evidence: '',
      confidence: 0.9,
    }],
  });
  assert.equal(emptyEvidencePlan.action, 'reverify');
  assert.deepEqual(emptyEvidencePlan.view_keys, []);

  const masterScopedPlan = sceneAssets.buildSceneRepairPlan({
    status: 'rejected',
    verification: { state: 'rejected' },
    view_issues: [{
      code: 'PHOTOREALISM_INVALID',
      view_keys: ['master', 'reverse'],
      reason: 'two views contain visibly synthetic geometry',
      evidence: 'the sofa legs merge into the floor in master and reverse',
      confidence: 0.9,
    }],
  });
  assert.deepEqual(masterScopedPlan.view_keys, ['master', 'reverse'], 'a non-root master issue must remain scoped to its exact views');

  const upgradedEvidenceFreeV4Asset = sceneAssets.normalizeSceneAssets([{
    id: 'evidence-free-v4-plan',
    scene_id: 'evidence-free-v4-plan',
    layout_summary: 'A coherent existing scene.',
    repair_plan: { version: 4, action: 'regenerate_failed_views', view_keys: ['master', 'layout', 'reverse', 'interaction', 'detail'], count: 5 },
    scene_contract: {
      schema_version: 4,
      status: 'rejected',
      verification: { state: 'rejected' },
      view_issues: [{ code: 'CAMERA_DIVERSITY_LOW', view_keys: ['layout'], reason: 'coverage low', evidence: '', confidence: 0.8 }],
    },
  }])[0];
  assert.equal(upgradedEvidenceFreeV4Asset.repair_plan.version, 5, 'stored v4 plans must be migrated through the evidence gate');
  assert.equal(upgradedEvidenceFreeV4Asset.repair_plan.action, 'reverify');
  assert.deepEqual(upgradedEvidenceFreeV4Asset.repair_plan.view_keys, []);

  const observableOnlyIssue = sceneSpace.normalizeViewIssues([{
    code: 'ROOT_MATERIAL_IDENTITY_INVALID',
    view_keys: ['master'],
    reason: '无法仅凭名称识别专有饰面',
    evidence: '没有附带材质样本',
    confidence: 0.8,
  }], { material_contract: { evidence_mode: 'observable_only' } });
  assert.equal(observableOnlyIssue[0].code, 'MATERIAL_DETAIL_WEAK');
  assert.deepEqual(observableOnlyIssue[0].view_keys, ['detail'], '无样本时不得因专有名词误杀整套场景');
  const observableOnlyPlan = sceneAssets.buildSceneRepairPlan({
    status: 'rejected',
    verification: { state: 'rejected' },
    view_issues: observableOnlyIssue,
  });
  assert.deepEqual(observableOnlyPlan.view_keys, ['detail']);
  const exactReferencePlan = sceneAssets.buildSceneRepairPlan({
    status: 'rejected',
    verification: { state: 'rejected' },
    view_issues: [{ code: 'ROOT_MATERIAL_IDENTITY_INVALID', view_keys: ['master'], reason: '与附件样本不符', evidence: '附件样本与主图的纹理方向明显不同' }],
  });
  assert.deepEqual(exactReferencePlan.view_keys, ['master', 'layout', 'reverse', 'interaction', 'detail'], '有附件证据的根材质错误才允许重建完整依赖图');

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
    assert.equal(calls[0].imageModel, 'gpt-image-2');
    assert.match(calls[0].prompt, /Mandatory correction from the previous rejected attempt/i);
    assert.match(calls[0].prompt, /Correction priority: if any reference image conflicts/i);
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
    const persistedUnavailable = storage.getOutput(unavailableTaskId, 'scene_assets')[0];
    assert.equal(persistedUnavailable.scene_revision, 2, 'the paid revision must remain persisted');
    assert.equal(persistedUnavailable.scene_contract.requirement_qa.layout_match_score, null, 'unavailable QA must not be shown as a zero content score');
    assert.equal(persistedUnavailable.scene_contract.cross_view_qa.scene_consistency_score, null);
    assert.equal(persistedUnavailable.scene_contract.spatial_coverage_qa.layout_topology_score, null);
    assert.equal(persistedUnavailable.scene_contract.spatial_coverage_qa.coverage_status, 'unavailable');

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
      legacy_material_repairs: legacyMaterialFailurePlan.view_keys,
      geometry_only_material_repairs: geometryOnlyMaterialFailurePlan.view_keys,
      explicit_interaction_repairs: explicitInteractionFailurePlan.view_keys,
      image2_only_policy: true,
      audit_retry_attempts: auditAttempts,
      targeted_generation_calls: calls.length,
      regenerated_views: result.scene_asset.repair_history[0].regenerated_view_keys,
      final_space_lock: result.scene_asset.scene_contract.full_space_lock,
      malformed_json_code: 'VISION_QA_SCHEMA_INVALID',
      truncated_optional_json_salvaged: true,
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
