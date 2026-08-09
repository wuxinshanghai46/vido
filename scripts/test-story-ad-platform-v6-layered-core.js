#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-platform-v6-layered-core-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const releaseBundle = require('../src/services/storyAdReleaseBundleService');
const sceneLayers = require('../src/services/newStoryAd/sceneLayerContractService');
const evidenceExpansion = require('../src/services/newStoryAd/referenceEvidenceExpansionService');
const shotCoverage = require('../src/services/newStoryAd/storyBeatShotCoverageService');

const taskId = 'platform-v6-layered-core-test';

function createTask() {
  storage.createTask({
    id: taskId,
    title: '平台v6分层核心零模型测试',
    brief: '验证分层场景、渐进证据与剧情节拍覆盖。',
    content_revision: 1,
    request: {},
  });
}

function sceneFixture() {
  return {
    id: 'scene_001',
    production_scene_key: 'production_scene_001',
    narrative_visit_id: 'visit_001',
    covered_beat_ids: ['beat_001', 'beat_002'],
    name: '共享测试场景',
    description: '由当前任务事实确定的场景。',
    story_purpose: '承载连续剧情动作。',
    topology_hash: 'topology-sha-001',
    scene_spec: {
      layoutText: '固定结构、出入口与可行动区域。',
      materialLightText: '当前事实要求的材质和光线。',
    },
    base_visual: {
      master: {
        asset_id: 'master_001',
        asset_hash: 'sha256-master-001',
        image_url: '/assets/master-001.png',
        lineage: { source_stage: 'new_story_ad.scene_asset', generation_id: 'generation-001' },
      },
      atlas: {
        asset_id: 'atlas_001',
        asset_hash: 'sha256-atlas-001',
        image_url: '/assets/atlas-001.png',
        lineage: { source_asset_id: 'master_001' },
      },
    },
  };
}

async function testLayeredScene() {
  const core = sceneLayers.publishCore(taskId, sceneFixture(), { content_revision: 1 });
  assert.equal(core.status, 'active');
  assert.equal(core.core.base_visual.master.asset_hash, 'sha256-master-001');
  assert.equal(sceneLayers.coreEligibility(core).eligible, true);

  await sceneLayers.enhance(taskId, 'scene_001', async () => ({
    visual_detail: {
      detail_asset_hash: 'sha256-detail-001',
      source_master_hash: 'sha256-master-001',
    },
    production_notes: ['只增强可见细节，不改写场景拓扑。'],
  }));
  const activeBeforeFailure = sceneLayers.activeEnhancement(taskId, 'scene_001');
  const coreBeforeFailure = sceneLayers.activeCore(taskId, 'scene_001');
  await assert.rejects(
    sceneLayers.enhance(taskId, 'scene_001', async () => {
      const error = new Error('derived_layout_failed');
      error.code = 'DERIVED_LAYOUT_FAILED';
      throw error;
    }),
    error => error.code === 'DERIVED_LAYOUT_FAILED',
  );
  assert.deepEqual(sceneLayers.activeCore(taskId, 'scene_001'), coreBeforeFailure,
    '增强失败不得污染或删除包含master/atlas的Active Core');
  assert.deepEqual(sceneLayers.activeEnhancement(taskId, 'scene_001'), activeBeforeFailure,
    '增强失败不得覆盖此前Active Enhancement');
  assert.equal(sceneLayers.checkpoint(taskId, 'scene_001').status, 'failed');
  assert.equal(
    sceneLayers.composeActiveScene(coreBeforeFailure, activeBeforeFailure).base_visual.master.asset_hash,
    'sha256-master-001',
  );
  assert.throws(
    () => sceneLayers.stageEnhancement(taskId, 'scene_001', {
      base_visual: { master: { asset_hash: 'forged' } },
    }),
    error => error.code === 'SCENE_ENHANCEMENT_SCOPE_INVALID',
    '增强层不得改写主视觉或场景拓扑',
  );
  let unmanagedBuilderCalls = 0;
  await assert.rejects(sceneLayers.enhance(taskId, 'scene_001', async () => {
    unmanagedBuilderCalls += 1;
    return { visual_detail: { asset_hash: 'must-not-run' } };
  }, { requires_model: true, model_stage: 'new_story_ad.unregistered_scene_enhancement' }),
  error => error.code === 'MODEL_STAGE_NOT_REGISTERED');
  assert.equal(unmanagedBuilderCalls, 0, '未登记模型阶段必须在调用builder前fail-closed');

  storage.saveOutput(taskId, `${sceneLayers.CORE_KIND}scene_001`, {
    ...coreBeforeFailure,
    release_envelope: { ...coreBeforeFailure.release_envelope, producer_bundle_id: 'old-bundle' },
  }, { content_revision: 1 });
  assert.equal(sceneLayers.activeCore(taskId, 'scene_001'), null, '旧bundle Core必须fail-closed');
  assert.equal(sceneLayers.composeActiveScene({
    ...coreBeforeFailure,
    release_envelope: { ...coreBeforeFailure.release_envelope, producer_bundle_id: 'old-bundle' },
  }, activeBeforeFailure), null, '旧bundle Core不得组合成Active Scene');
  sceneLayers.publishCore(taskId, sceneFixture(), { content_revision: 1 });
}

async function testProgressiveEvidence() {
  const plan = evidenceExpansion.buildPlan({
    scope_id: 'scene_001',
    requirements: [{
      requirement_id: 'environment_continuity',
      description: '补足当前场景从局部证据到空间连续性的可验证证据。',
      target_view: 'spatial_3d',
      required: true,
    }],
    evidence: [{
      evidence_id: 'user_detail_001',
      requirement_ids: ['environment_continuity'],
      capability: 'detail_view',
      asset_hash: 'sha256-user-detail-001',
      source_type: 'user_upload',
    }],
  });
  const targets = plan.steps.map(step => step.target_view);
  assert(targets.includes('multi_view'));
  assert(targets.includes('panorama_360'));
  assert(targets.includes('spatial_3d'));
  assert(targets.indexOf('multi_view') < targets.indexOf('panorama_360'));
  assert(targets.indexOf('panorama_360') < targets.indexOf('spatial_3d'));
  assert.throws(
    () => evidenceExpansion.assertManagedStage('new_story_ad.unregistered_reference_expansion'),
    error => error.code === 'MODEL_STAGE_NOT_REGISTERED',
  );

  storage.saveOutput(taskId, `${evidenceExpansion.CHECKPOINT_KIND}scene_001`, {
    contract_version: evidenceExpansion.CONTRACT_VERSION,
    plan_id: 'old-plan',
    scope_id: 'scene_001',
    input_fingerprint: 'old-fingerprint',
    producer_bundle_id: 'old-bundle',
    completed_step_ids: [],
    artifacts: {},
    release_envelope: { producer_bundle_id: 'old-bundle' },
  }, { content_revision: 1 });
  let executorCalls = 0;
  await assert.rejects(
    evidenceExpansion.runStep({
      taskId,
      plan,
      stepId: plan.steps[0].step_id,
      execute: async () => {
        executorCalls += 1;
        return { asset_hash: 'must-not-exist' };
      },
    }),
    error => error.code === 'REFERENCE_EXPANSION_CHECKPOINT_MISMATCH',
  );
  assert.equal(executorCalls, 0, '旧checkpoint必须在任何潜在付费executor之前被拒绝');
  storage.deleteOutput(taskId, `${evidenceExpansion.CHECKPOINT_KIND}scene_001`);

  let current = null;
  while (evidenceExpansion.nextSteps(plan, current).length) {
    const step = evidenceExpansion.nextSteps(plan, current)[0];
    current = await evidenceExpansion.runStep({
      taskId,
      plan,
      stepId: step.step_id,
      execute: async candidate => ({
        asset_hash: `sha256-${candidate.target_view}`,
        source_step_id: candidate.step_id,
      }),
    });
  }
  assert.equal(current.status, 'complete');
  assert.equal(current.completed_step_ids.length, plan.steps.length);
  assert.equal(current.producer_bundle_id, releaseBundle.identity().bundle_id);
}

function testBeatShotCoverage() {
  const plan = shotCoverage.planCoverage({
    beats: [{
      id: 'beat_001',
      role: 'development',
      summary: '人物完成一组连续且可见的行动并形成结果。',
      visible_actions: ['接近目标', '操作目标', '确认结果'],
      required_evidence: ['目标初始状态', '操作中的状态', '最终结果状态'],
      state_before: ['目标尚未变化'],
      state_after: ['结果已稳定可见'],
      invariants: ['人物身份与场景结构保持一致'],
    }, {
      id: 'beat_002',
      role: 'resolution',
      summary: '结果得到回应。',
      required_evidence: ['回应必须可见'],
    }],
    target_shots: 4,
    target_duration: 18,
    max_shot_duration: 6,
    max_obligations_per_unit: 2,
  });
  const first = plan.beat_coverage.find(row => row.story_beat_id === 'beat_001');
  assert(first.required_shot_count > 1, '复杂Story Beat必须允许1:N覆盖，而非强制一Beat一镜');
  assert.equal(shotCoverage.coverageUnits(plan).length, plan.shot_coverage_count);
  assert.equal(shotCoverage.validateCoveragePlan(plan), true);
  assert.equal(JSON.stringify(plan).includes('lens_mm'), false, '覆盖规划不得混入摄影设计');
  assert.throws(() => shotCoverage.validateCoveragePlan({
    ...plan,
    beat_coverage: plan.beat_coverage.map((row, rowIndex) => rowIndex ? row : ({
      ...row,
      coverage_units: row.coverage_units.map((unit, unitIndex) => unitIndex ? unit : ({ ...unit, lens_mm: 50 })),
    })),
  }), error => error.code === 'SHOT_COVERAGE_PLAN_INVALID');
}

async function main() {
  try {
    createTask();
    await testLayeredScene();
    await testProgressiveEvidence();
    testBeatShotCoverage();
    const bundle = storage.getTaskBundle(taskId);
    assert.equal(bundle.model_calls.length, 0, '定向测试不得触发任何真实或mock模型调用');
    console.log(JSON.stringify({
      passed: true,
      checks: 31,
      model_calls: bundle.model_calls.length,
      scene_layer_contract: sceneLayers.CONTRACT_VERSION,
      evidence_expansion_contract: evidenceExpansion.CONTRACT_VERSION,
      shot_coverage_contract: shotCoverage.CONTRACT_VERSION,
    }));
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
