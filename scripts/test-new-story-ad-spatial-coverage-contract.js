const assert = require('assert');

process.env.DB_ENABLED = '0';

const modelGateway = require('../src/services/newStoryAd/modelGateway');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');

const fullViews = [
  ['master', 'https://test.invalid/master.png'],
  ['reverse', 'https://test.invalid/reverse.png'],
  ['interaction', 'https://test.invalid/interaction.png'],
  ['detail', 'https://test.invalid/detail.png'],
  ['layout', 'https://test.invalid/layout.png'],
].map(([key, url]) => ({ key, url }));

function passingResult(overrides = {}) {
  return {
    pass: true,
    status: 'verified',
    observed_summary: '同一空间的主视角、反向、互动、细节与轴测布局参考',
    requirement_qa: {
      pass: true,
      layout_match_score: 0.94,
      material_light_match_score: 0.93,
      interaction_match_score: 0.91,
      surface_topology_match_score: 0.95,
      negative_compliance_score: 0.98,
      mismatch_reasons: [],
    },
    cross_view_qa: {
      pass: true,
      scene_consistency_score: 0.94,
      geometry_consistency_score: 0.92,
      material_consistency_score: 0.93,
      mismatch_reasons: [],
    },
    spatial_coverage_qa: {
      pass: true,
      layout_topology_score: 0.93,
      camera_diversity_score: 0.9,
      reverse_coverage_score: 0.91,
      interaction_zone_score: 0.9,
      reasons: [],
    },
    anchors: [],
    zones: [],
    geometry_facts: [],
    materials: [],
    lighting: {},
    ...overrides,
  };
}

async function main() {
  assert.equal(modelGateway.visionAttemptTimeoutForBudget({
    timeoutMs: 120000,
    stageBudgetMs: 120000,
    elapsedMs: 0,
    remainingCandidates: 2,
  }), 60000, 'first vision candidate must not consume the fallback candidate budget');
  assert.equal(modelGateway.visionAttemptTimeoutForBudget({
    timeoutMs: 120000,
    stageBudgetMs: 120000,
    elapsedMs: 60000,
    remainingCandidates: 1,
  }), 60000, 'the second vision candidate must retain a real timeout window');
  const visionAttempts = [];
  const fallbackResult = await modelGateway.generateVision({
    taskId: 'vision-budget-fallback-test',
    stage: 'new_story_ad.scene_vision',
    systemPrompt: 'Return JSON.',
    userPrompt: 'Inspect the supplied image.',
    imageUrls: ['https://example.test/reference.png'],
    maxCandidates: 2,
    timeoutMs: 120000,
    stageBudgetMs: 120000,
    _candidateModels: [
      { provider_id: 'mock-primary', model_id: 'vision-a', enabled: true },
      { provider_id: 'mock-fallback', model_id: 'vision-b', enabled: true },
    ],
    _generateText: async options => {
      visionAttempts.push({ model: options.model.model_id, timeoutMs: options.timeoutMs });
      if (options.model.model_id === 'vision-a') throw new Error('request timed out');
      return { text: '{"pass":true}', adapter: 'mock', family: 'mock' };
    },
  });
  assert.equal(visionAttempts.length, 2, 'primary vision timeout must execute the fallback candidate');
  assert.ok(visionAttempts[0].timeoutMs >= 59000 && visionAttempts[0].timeoutMs <= 60000);
  assert.ok(visionAttempts[1].timeoutMs >= 59000);
  assert.equal(fallbackResult.fallback_used, true);
  assert.equal(fallbackResult.failed_models[0].code, 'TIMEOUT_OR_NETWORK');
  const complete = sceneSpace.normalizeContract(passingResult(), {
    sceneId: 'scene-complete',
    views: fullViews,
  });
  assert.equal(complete.schema_version, 4);
  assert.equal(complete.status, 'verified');
  assert.equal(complete.spatial_coverage_qa.pass, true);
  assert.equal(complete.spatial_coverage_qa.coverage_status, 'complete');
  assert.equal(complete.space_lock_status, 'complete');
  assert.equal(complete.full_space_lock, true);
  assert.equal(complete.compatibility_status, 'current');
  const changedLayout = sceneSpace.normalizeContract(passingResult(), {
    sceneId: 'scene-complete',
    views: fullViews.map(view => view.key === 'layout' ? { ...view, url: 'https://test.invalid/layout-v2.png' } : view),
  });
  assert.notEqual(changedLayout.reference_fingerprint, complete.reference_fingerprint, '布局参考变化必须更新空间合同指纹');

  const withoutLayout = sceneSpace.normalizeContract(passingResult(), {
    sceneId: 'scene-no-layout',
    views: fullViews.filter(view => view.key !== 'layout'),
  });
  assert.equal(withoutLayout.requirement_qa.pass, true);
  assert.equal(withoutLayout.cross_view_qa.pass, true);
  assert.equal(withoutLayout.status, 'verified', '外观验证状态保持兼容，完整空间锁由独立字段控制');
  assert.equal(withoutLayout.space_lock_status, 'partial');
  assert.equal(withoutLayout.spatial_coverage_qa.pass, false);
  assert.equal(withoutLayout.full_space_lock, false);
  assert(withoutLayout.spatial_coverage_qa.reasons.some(reason => reason.includes('俯视或轴测')));

  const duplicateReverse = sceneSpace.normalizeContract(passingResult(), {
    sceneId: 'scene-duplicate-reverse',
    views: fullViews.map(view => view.key === 'reverse' ? { ...view, url: fullViews[0].url } : view),
  });
  assert.equal(duplicateReverse.status, 'verified');
  assert.equal(duplicateReverse.space_lock_status, 'partial');
  assert.equal(duplicateReverse.spatial_coverage_qa.pass, false);
  assert(duplicateReverse.spatial_coverage_qa.reasons.some(reason => reason.includes('反向或侧向')));

  const duplicateInteraction = sceneSpace.normalizeContract(passingResult(), {
    sceneId: 'scene-duplicate-interaction',
    views: fullViews.map(view => view.key === 'interaction' ? { ...view, url: fullViews[0].url } : view),
  });
  assert.equal(duplicateInteraction.status, 'verified');
  assert.equal(duplicateInteraction.space_lock_status, 'partial');
  assert.equal(duplicateInteraction.spatial_coverage_qa.pass, false);
  assert(duplicateInteraction.spatial_coverage_qa.reasons.some(reason => reason.includes('互动位')));

  const lowDiversity = sceneSpace.normalizeContract(passingResult({
    spatial_coverage_qa: {
      pass: true,
      layout_topology_score: 0.95,
      camera_diversity_score: 0.4,
      reverse_coverage_score: 0.9,
      interaction_zone_score: 0.9,
      reasons: [],
    },
  }), { sceneId: 'scene-low-diversity', views: fullViews });
  assert.equal(lowDiversity.status, 'verified');
  assert.equal(lowDiversity.space_lock_status, 'partial');
  assert.equal(lowDiversity.spatial_coverage_qa.pass, false);
  assert(lowDiversity.spatial_coverage_qa.reasons.some(reason => reason.includes('机位差异不足')));

  const requirementFailed = sceneSpace.normalizeContract(passingResult({
    requirement_qa: {
      pass: false,
      layout_match_score: 0.5,
      material_light_match_score: 0.93,
      interaction_match_score: 0.91,
      surface_topology_match_score: 0.95,
      negative_compliance_score: 0.98,
      mismatch_reasons: ['布局不符合需求'],
    },
  }), { sceneId: 'scene-requirement-failed', views: fullViews });
  assert.equal(requirementFailed.status, 'rejected');
  assert.equal(requirementFailed.requirement_qa.pass, false);
  assert.equal(requirementFailed.cross_view_qa.pass, true);
  assert.equal(requirementFailed.spatial_coverage_qa.pass, true);
  assert.equal(requirementFailed.full_space_lock, false, '需求未通过时不得仅凭空间覆盖冒充完整空间锁');
  assert.equal(requirementFailed.space_lock_status, 'rejected');

  const crossViewFailed = sceneSpace.normalizeContract(passingResult({
    cross_view_qa: {
      pass: false,
      scene_consistency_score: 0.4,
      geometry_consistency_score: 0.4,
      material_consistency_score: 0.9,
      mismatch_reasons: ['固定锚点发生变化'],
    },
  }), { sceneId: 'scene-cross-failed', views: fullViews });
  assert.equal(crossViewFailed.status, 'rejected');
  assert.equal(crossViewFailed.requirement_qa.pass, true);
  assert.equal(crossViewFailed.cross_view_qa.pass, false);
  assert.equal(crossViewFailed.spatial_coverage_qa.pass, true);
  assert.equal(crossViewFailed.full_space_lock, false, '跨视图未通过时不得仅凭空间覆盖冒充完整空间锁');
  assert.equal(crossViewFailed.space_lock_status, 'rejected');

  const legacy = sceneSpace.normalizeContract({
    schema_version: 2,
    status: 'verified',
    cross_view_qa: {
      pass: true,
      scene_consistency_score: 1,
      geometry_consistency_score: 1,
      material_consistency_score: 1,
      mismatch_reasons: [],
    },
  }, { sceneId: 'scene-legacy', views: fullViews.slice(0, 4) });
  assert.equal(legacy.schema_version, 4);
  assert.equal(legacy.source_schema_version, 2);
  assert.equal(legacy.requirement_qa.legacy_assumed, true);
  assert.equal(legacy.compatibility_status, 'legacy_partial');
  assert.equal(legacy.space_lock_status, 'legacy_partial');
  assert.equal(legacy.status, 'verified');
  assert.equal(legacy.full_space_lock, false);
  assert.equal(legacy.spatial_coverage_qa.layout_topology_score, null);

  const unavailable = sceneSpace.buildUnverifiedContract({ sceneId: 'scene-unavailable', views: fullViews });
  assert.equal(unavailable.status, 'unverified');
  assert.equal(unavailable.space_lock_status, 'unavailable');
  assert.equal(unavailable.spatial_coverage_qa.pass, null);

  const originalVision = modelGateway.generateVision;
  try {
    let layoutGateRequest = null;
    const layoutGate = await sceneSpace.validateLayoutAcquisition({
      taskId: 'layout-role-gate-test',
      masterUrl: 'https://test.invalid/master.png',
      layoutUrl: 'https://test.invalid/layout.png?w=560',
      requested: { layout: 'task-defined footprint and access route' },
      gateway: {
        generateVision: async request => {
          layoutGateRequest = request;
          return {
            text: JSON.stringify({
              pass: true,
              layout_role_score: 0.95,
              footprint_coverage_score: 0.94,
              overhead_verticality_score: 0.96,
              boundary_completeness_score: 0.95,
              estimated_downward_pitch_degrees: 88,
              visible_horizon: false,
              dominant_vertical_wall_face: false,
              complete_perimeter_visible: true,
              ceiling_removed_or_not_visible: true,
              master_like_composition: false,
              evidence: ['complete perimeter visible', 'near-orthographic projection'],
              scene_identity_score: 0.96,
              camera_relocation_score: 0.92,
              reasons: [],
            }),
            used_model: 'mock/layout-role',
          };
        },
      },
    });
    assert.equal(layoutGate.pass, true);
    assert.match(layoutGateRequest.userPrompt, /82-90 degree downward/i);
    assert.match(layoutGateRequest.userPrompt, /complete usable ground\/base footprint/i);
    assert.match(layoutGateRequest.userPrompt, /ceiling must be removed/i);
    assert.match(layoutGateRequest.userPrompt, /mild high-angle shot/i);
    assert.match(layoutGateRequest.userPrompt, /overhead_verticality_score must be 0\.35 or lower/i);
    assert.equal(layoutGateRequest.imageUrls[1], 'https://test.invalid/layout.png?w=560');

    const shallowOverhead = await sceneSpace.validateLayoutAcquisition({
      taskId: 'layout-role-shallow-angle-test',
      masterUrl: 'https://test.invalid/master.png',
      layoutUrl: 'https://test.invalid/shallow-layout.png',
      requested: { layout: 'complete task-defined footprint' },
      gateway: {
        generateVision: async () => ({
          text: JSON.stringify({
            pass: true,
            layout_role_score: 0.95,
            footprint_coverage_score: 0.94,
            overhead_verticality_score: 0.3,
            boundary_completeness_score: 0.95,
            estimated_downward_pitch_degrees: 75,
            visible_horizon: false,
            dominant_vertical_wall_face: false,
            complete_perimeter_visible: true,
            ceiling_removed_or_not_visible: true,
            master_like_composition: true,
            evidence: ['same wall-facing sector as master'],
            scene_identity_score: 0.96,
            camera_relocation_score: 0.92,
            reasons: [],
          }),
          used_model: 'mock/layout-role-shallow',
        }),
      },
    });
    assert.equal(shallowOverhead.pass, false, 'a mild high-angle image must fail even when the model says pass');
    assert.match(shallowOverhead.reasons.join(' '), /不足 82°|主视图的近似重构/);

    let successfulReviewCalls = 0;
    modelGateway.generateVision = async () => {
      successfulReviewCalls += 1;
      return {
        text: JSON.stringify(passingResult()),
        used_model: 'mock/spatial-v3',
      };
    };
    const analyzed = await sceneSpace.analyzeSceneViews({
      taskId: 'spatial-v3-test',
      sceneId: 'scene-analyzed',
      views: fullViews,
      requested: { layout: '固定整间空间布局' },
    });
    assert.equal(analyzed.status, 'verified');
    assert.equal(analyzed.vision_model, 'mock/spatial-v3');
    assert.equal(successfulReviewCalls, 1, '三道空间验收必须合并在一次视觉审核请求中，不能串行调用三次');

    const roleInvalid = await sceneSpace.analyzeSceneViews({
      taskId: 'spatial-layout-role-invalid',
      sceneId: 'scene-layout-role-invalid',
      views: fullViews,
      requested: { layout: '固定整间空间布局' },
      layoutRequired: true,
      layoutAcquisition: {
        pass: false,
        layout_role_score: 0.2,
        footprint_coverage_score: 0.3,
        overhead_verticality_score: 0.2,
        boundary_completeness_score: 0.3,
        estimated_downward_pitch_degrees: 45,
        visible_horizon: true,
        dominant_vertical_wall_face: true,
        complete_perimeter_visible: false,
        ceiling_removed_or_not_visible: false,
        master_like_composition: true,
        scene_identity_score: 0.95,
        camera_relocation_score: 0.2,
        reasons: ['只是主视图的轻微抬高重构'],
      },
    });
    assert.equal(roleInvalid.full_space_lock, false);
    assert.equal(roleInvalid.status, 'rejected');
    assert.equal(roleInvalid.layout_contract.status, 'invalid');
    assert.equal(roleInvalid.layout_contract.layout_role_pass, false);
    assert.match(roleInvalid.spatial_coverage_qa.reasons.join('；'), /轻微抬高|高俯角/);

    let calls = 0;
    modelGateway.generateVision = async () => {
      calls += 1;
      const result = passingResult();
      delete result.spatial_coverage_qa;
      return { text: JSON.stringify(result), used_model: 'mock/old-schema' };
    };
    await assert.rejects(
      () => sceneSpace.analyzeSceneViews({ taskId: 'spatial-v3-invalid', sceneId: 'scene-invalid', views: fullViews }),
      error => error?.code === 'VISION_QA_SCHEMA_INVALID',
    );
    assert.equal(calls, 2, '缺少空间覆盖评分时必须只重试一次，然后显式失败');
  } finally {
    modelGateway.generateVision = originalVision;
  }

  console.log(JSON.stringify({
    success: true,
    schema_version: complete.schema_version,
    complete_space_lock: complete.full_space_lock,
    no_layout_status: withoutLayout.space_lock_status,
    duplicate_reverse_status: duplicateReverse.space_lock_status,
    legacy_status: legacy.space_lock_status,
    independent_qa_gates: true,
    strict_v4_schema_retry: true,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
