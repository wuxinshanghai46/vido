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
  const complete = sceneSpace.normalizeContract(passingResult(), {
    sceneId: 'scene-complete',
    views: fullViews,
  });
  assert.equal(complete.schema_version, 3);
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
  assert.equal(legacy.schema_version, 3);
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
    strict_v3_schema_retry: true,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
