'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

const root = path.resolve(__dirname, '..');
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-platform-layered-contracts-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const sceneLayers = require('../src/services/newStoryAd/sceneLayerContractService');
const evidenceExpansion = require('../src/services/newStoryAd/referenceEvidenceExpansionService');
const shotCoverage = require('../src/services/newStoryAd/storyBeatShotCoverageService');
const pipeline = require('../src/services/pipelineModelService');
const releaseBundle = require('../src/services/storyAdReleaseBundleService');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function modelCallCount() {
  return (storage.readDb().model_calls || []).length;
}

function fixtureScene(overrides = {}) {
  return {
    id: 'scene_1',
    production_scene_key: 'production_scene_001',
    narrative_visit_id: 'visit_001',
    covered_beat_ids: ['beat_1', 'beat_2'],
    name: '当前任务动态场景',
    description: '完全来自当前任务的基础物理空间，不绑定任何固定行业。',
    story_purpose: '承载人物发现问题并完成状态改变。',
    topology_hash: 'topology-current-input',
    scene_spec: {
      layoutText: '入口、行动区与固定结构关系明确。',
      materialLightText: '材质和光线只按当前任务事实确定。',
      interactionText: '人物从入口进入行动区并完成事件。',
      negativeText: '不得加入输入之外的房间、行业或商品。',
    },
    base_visual: {
      master: {
        asset_id: 'scene-master-1',
        asset_hash: 'sha256-base-scene-master',
        image_url: '/api/new-story-ad/assets/scene-master-1.png',
        lineage: { source: 'fixture', input_fingerprint: 'current-input' },
      },
    },
    ...overrides,
  };
}

function coverageBeats() {
  return [
    {
      id: 'beat_1', phase: 'opening', summary: '人物进入空间并确认目标。',
      required_evidence: ['入口状态清楚', '目标物状态清楚'],
      visible_actions: ['人物进入并停在行动区'],
      state_before: ['人物尚未进入'], state_after: ['人物已进入'], scene_id: 'scene_1',
    },
    {
      id: 'beat_2', phase: 'development', summary: '人物分步处理问题并发现关键线索。',
      required_evidence: ['问题状态可见', '线索状态可见'],
      visible_actions: ['人物检查目标物', '人物拿起线索'],
      state_before: ['问题未解决'], state_after: ['线索已取得'], scene_id: 'scene_1',
    },
    {
      id: 'beat_3', phase: 'resolution', summary: '人物完成处理并展示结果。',
      required_evidence: ['最终结果可见'],
      visible_actions: ['人物确认结果'],
      state_before: ['结果待确认'], state_after: ['结果已确认'], scene_id: 'scene_1',
    },
  ];
}

function planInput(scopeId = 'scene_1') {
  return {
    scope_id: scopeId,
    requirements: [{
      requirement_id: 'requirement_panorama',
      description: '根据当前场景证据逐级补足可验证的观察范围。',
      target_view: 'panorama_360',
      required: true,
      model_stage: 'new_story_ad.scene_panorama',
    }],
    evidence: [{
      evidence_id: 'evidence_base',
      requirement_ids: ['requirement_panorama'],
      capability: 'base_reference',
      asset_hash: 'sha256-existing-base',
      source_type: 'user_upload',
      user_owned: true,
    }],
  };
}

async function testSceneLayers() {
  const taskId = 'layered-scene-task';
  storage.createTask({ id: taskId, title: '平台分层场景测试', content_revision: 1, request: {} });
  const core = sceneLayers.publishCore(taskId, fixtureScene(), { content_revision: 1 });
  assert.equal(sceneLayers.coreEligibility(core).eligible, true);
  const coreBefore = sceneLayers.activeCore(taskId, 'scene_1');
  const baseAssetHash = coreBefore.core.base_visual.master.asset_hash;

  const enhanced = await sceneLayers.enhance(taskId, 'scene_1', async () => ({
    reference_evidence: { detail_views: [{ asset_hash: 'sha256-detail-1' }] },
    visual_detail: { notes: ['补充当前空间中目标物的可见细节'] },
  }));
  assert.equal(enhanced.status, 'active');
  const activeEnhancementBeforeFailure = sceneLayers.activeEnhancement(taskId, 'scene_1');
  const coreHashBeforeFailure = digest(sceneLayers.activeCore(taskId, 'scene_1'));

  await assert.rejects(
    () => sceneLayers.enhance(taskId, 'scene_1', async () => {
      const error = new Error('fixture enhancement failed');
      error.code = 'FIXTURE_ENHANCEMENT_FAILED';
      throw error;
    }),
    error => error?.code === 'FIXTURE_ENHANCEMENT_FAILED',
  );
  assert.equal(digest(sceneLayers.activeCore(taskId, 'scene_1')), coreHashBeforeFailure,
    '增强失败不得改变基础场景');
  assert.deepEqual(sceneLayers.activeEnhancement(taskId, 'scene_1'), activeEnhancementBeforeFailure,
    '增强失败不得覆盖上一版成功增强');
  assert.equal(sceneLayers.checkpoint(taskId, 'scene_1').status, 'failed');
  assert.equal(sceneLayers.activeCore(taskId, 'scene_1').core.base_visual.master.asset_hash, baseAssetHash,
    '成功基础资产哈希不得因增强成功或失败变化');

  assert.throws(() => sceneLayers.stageEnhancement(taskId, 'scene_1', {
    base_visual: { master: { asset_hash: 'forbidden-overwrite' } },
  }), error => error?.code === 'SCENE_ENHANCEMENT_SCOPE_INVALID');
  assert.throws(() => sceneLayers.stageEnhancement(taskId, 'scene_1', {
    scene_spec: { layoutText: 'forbidden topology overwrite' },
  }), error => error?.code === 'SCENE_ENHANCEMENT_SCOPE_INVALID');

  const rawCore = sceneLayers.activeCore(taskId, 'scene_1', { include_incompatible: true });
  const staleBundle = JSON.parse(JSON.stringify(rawCore));
  staleBundle.release_envelope.producer_bundle_id = 'old-release-bundle';
  storage.saveOutput(taskId, `${sceneLayers.CORE_KIND}scene_1`, staleBundle);
  assert.equal(sceneLayers.activeCore(taskId, 'scene_1'), null, '旧 release bundle 的基础场景不得复用');
  assert.equal(sceneLayers.composeActiveScene(staleBundle, activeEnhancementBeforeFailure), null,
    '旧 bundle 场景不得被合成为可用场景');

  const tampered = JSON.parse(JSON.stringify(rawCore));
  tampered.core.description = '被旧缓存覆盖的内容';
  assert.equal(sceneLayers.coreEligibility(tampered).eligible, false, '内容与指纹不一致的旧 core 必须失效');
  storage.saveOutput(taskId, `${sceneLayers.CORE_KIND}scene_1`, rawCore);
  assert.equal(sceneLayers.activeCore(taskId, 'scene_1').core.base_visual.master.asset_hash, baseAssetHash);
}

async function testEvidenceExpansion() {
  const taskId = 'reference-expansion-task';
  storage.createTask({ id: taskId, title: '参考证据渐进扩展', content_revision: 1, request: {} });
  const detailOnlyPlan = evidenceExpansion.buildPlan({
    ...planInput('detail-only-scene'),
    evidence: [{
      evidence_id: 'evidence_detail', requirement_ids: ['requirement_panorama'],
      capability: 'detail_view', asset_hash: 'sha256-close-detail', source_type: 'user_upload', user_owned: true,
    }],
  });
  const detailTargets = detailOnlyPlan.steps.map(step => step.target_view);
  const panoramaIndex = detailTargets.indexOf('panorama_360');
  const multiViewIndex = detailTargets.indexOf('multi_view');
  assert(multiViewIndex >= 0 && panoramaIndex > multiViewIndex,
    '只有近景证据时必须先补多视角，禁止直接跳到360');
  assert(detailOnlyPlan.steps[panoramaIndex].depends_on.includes(detailOnlyPlan.steps[multiViewIndex].step_id));

  const plan = evidenceExpansion.buildPlan(planInput());
  assert.deepEqual(plan.steps.map(step => step.target_view), ['multi_view', 'panorama_360'],
    '已有合格基础图时只规划缺失的多视角和360步骤');
  assert.equal(evidenceExpansion.validatePlan(plan), true);
  const existingEvidenceHash = plan.evidence[0].asset_hash;
  let executorCalls = 0;
  const first = evidenceExpansion.nextSteps(plan, null)[0];
  await evidenceExpansion.runStep({
    taskId, plan, stepId: first.step_id, contentRevision: 1,
    execute: async step => {
      executorCalls += 1;
      return { asset_hash: `sha256-${step.target_view}`, image_url: `/${step.target_view}.png` };
    },
  });
  const checkpointAfterFirst = evidenceExpansion.checkpoint(taskId, plan.scope_id);
  assert.deepEqual(evidenceExpansion.nextSteps(plan, checkpointAfterFirst).map(step => step.target_view), ['panorama_360'],
    '完成步骤不得重跑，只补下一个缺失步骤');
  const firstArtifactHash = checkpointAfterFirst.artifacts[first.step_id].asset_hash;
  const second = evidenceExpansion.nextSteps(plan, checkpointAfterFirst)[0];
  const completed = await evidenceExpansion.runStep({
    taskId, plan, stepId: second.step_id, contentRevision: 1,
    execute: async step => {
      executorCalls += 1;
      return { asset_hash: `sha256-${step.target_view}`, image_url: `/${step.target_view}.png` };
    },
  });
  assert.equal(completed.status, 'complete');
  assert.equal(executorCalls, 2, '两个缺失步骤必须各执行一次');
  assert.equal(completed.artifacts[first.step_id].asset_hash, firstArtifactHash,
    '补后续缺失步骤不得覆盖已成功资产哈希');
  assert.equal(plan.evidence[0].asset_hash, existingEvidenceHash, '输入基础证据哈希不得变化');
  assert.deepEqual(evidenceExpansion.nextSteps(plan, completed), []);

  const staleTaskId = 'reference-expansion-stale-checkpoint';
  storage.createTask({ id: staleTaskId, title: '旧checkpoint阻断', content_revision: 1, request: {} });
  const stalePlan = evidenceExpansion.buildPlan(planInput('stale-scene'));
  storage.saveOutput(staleTaskId, `${evidenceExpansion.CHECKPOINT_KIND}${stalePlan.scope_id}`, {
    contract_version: evidenceExpansion.CONTRACT_VERSION,
    plan_id: stalePlan.plan_id,
    scope_id: stalePlan.scope_id,
    input_fingerprint: stalePlan.input_fingerprint,
    producer_bundle_id: 'old-release-bundle',
    release_envelope: { producer_bundle_id: 'old-release-bundle' },
    completed_step_ids: [], artifacts: {}, status: 'partial',
  });
  let forbiddenExecutorCalls = 0;
  const staleStepId = stalePlan.steps[0].step_id;
  const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => evidenceExpansion.runStep({
    taskId: staleTaskId,
    plan: stalePlan,
    stepId: staleStepId,
    execute: async () => {
      forbiddenExecutorCalls += 1;
      return { asset_hash: 'must-not-execute' };
    },
  })));
  assert(attempts.every(item => item.status === 'rejected'
    && item.reason?.code === 'REFERENCE_EXPANSION_CHECKPOINT_MISMATCH'));
  assert.equal(forbiddenExecutorCalls, 0,
    '旧bundle/checkpoint必须在executor及任何可能费用调用之前阻断，10并发也不得误触发');
}

function testShotCoverage() {
  const plan = shotCoverage.planCoverage({
    beats: coverageBeats(), target_shots: 8, target_duration: 30,
    max_shot_duration: 6, max_obligations_per_unit: 2,
  });
  assert.equal(shotCoverage.validateCoveragePlan(plan), true);
  const units = shotCoverage.coverageUnits(plan);
  assert.equal(units.length, 8, '目标8镜必须形成8个独立叙事覆盖单元');
  assert.deepEqual(units.map(unit => unit.global_sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert(plan.beat_coverage.every(row => row.coverage_units.length >= 1), '每个story beat至少覆盖一次');
  assert(plan.beat_coverage.some(row => row.coverage_units.length > 1), '复杂beat必须支持1:N镜头覆盖');
  assert.equal(new Set(units.map(unit => unit.coverage_id)).size, units.length);
  assert(units.every(unit => unit.duration_budget_sec > 0 && unit.duration_budget_sec <= 6));
  assert(units.every(unit => unit.entry_state && unit.exit_state && unit.narrative_instruction));
  assert(units.every(unit => !Object.keys(unit).some(key =>
    shotCoverage.FORBIDDEN_CINEMATOGRAPHY_KEYS.has(key))),
  '剧情覆盖层不得提前写入摄影机、镜头尺寸、镜头或构图字段');

  const contaminated = JSON.parse(JSON.stringify(plan));
  contaminated.beat_coverage[0].coverage_units[0].camera = 'forbidden fixed camera';
  assert.throws(() => shotCoverage.validateCoveragePlan(contaminated),
    error => error?.code === 'SHOT_COVERAGE_PLAN_INVALID'
      && error.issues.some(issue => issue.includes('cinematography_forbidden')));
}

function testGlobalStageRegistrationAndNeutrality() {
  const serviceDir = path.join(root, 'src/services/newStoryAd');
  const stageIds = new Set();
  fs.readdirSync(serviceDir).filter(file => file.endsWith('.js')).forEach((file) => {
    const source = fs.readFileSync(path.join(serviceDir, file), 'utf8');
    for (const match of source.matchAll(/\bstage\s*:\s*['"`](new_story_ad\.[a-z0-9_.-]+)['"`]/gi)) {
      stageIds.add(match[1]);
    }
  });
  assert(stageIds.size >= 30, '必须实际审计全部新剧情广告模型调用阶段，而不是手写少量白名单');
  stageIds.forEach((stage) => {
    assert(pipeline.getStageMeta(stage), `${stage} 未注册到模型管理schema`);
    assert(pipeline.isStrictPipelineManagedStage(stage), `${stage} 仍可绕过严格模型阶段管理`);
  });
  assert.throws(() => evidenceExpansion.assertManagedStage('new_story_ad.unregistered_fixture_stage'),
    error => error?.code === 'MODEL_STAGE_NOT_REGISTERED');

  const forbiddenScenarioTerms = /星月神话|古代竹海|齐胸衫裙|不锈钢厨房|医疗行业|珠宝展厅|酒店大堂|固定行业模板/;
  [
    'sceneLayerContractService.js',
    'referenceEvidenceExpansionService.js',
    'storyBeatShotCoverageService.js',
  ].forEach((file) => {
    const source = fs.readFileSync(path.join(serviceDir, file), 'utf8');
    assert(!forbiddenScenarioTerms.test(source), `${file} 不得写死单个任务、场景或行业`);
  });
}

function testPerformanceAndSize() {
  const timings = [];
  for (let index = 0; index < 300; index += 1) {
    const started = performance.now();
    evidenceExpansion.buildPlan(planInput(`performance-scope-${index}`));
    shotCoverage.planCoverage({
      beats: coverageBeats(), target_shots: 8 + (index % 5), target_duration: 30, max_shot_duration: 6,
    });
    timings.push(performance.now() - started);
  }
  timings.sort((left, right) => left - right);
  const p95 = timings[Math.floor(timings.length * 0.95)];
  assert(p95 < 50, `纯规划组合P95必须低于50ms，实际${p95.toFixed(3)}ms`);

  const files = [
    'sceneLayerContractService.js',
    'referenceEvidenceExpansionService.js',
    'storyBeatShotCoverageService.js',
  ];
  let totalBytes = 0;
  files.forEach((file) => {
    const fullPath = path.join(root, 'src/services/newStoryAd', file);
    const source = fs.readFileSync(fullPath, 'utf8');
    const lines = source.replace(/\r?\n$/, '').split(/\r?\n/).length;
    totalBytes += Buffer.byteLength(source);
    assert(lines <= 600, `${file} 超过项目600行模块边界`);
    assert(Buffer.byteLength(source) <= 24 * 1024, `${file} 超过24KiB独立服务体积边界`);
  });
  assert(totalBytes <= 60 * 1024, '三个平台合同服务总源码不得超过60KiB');
  return p95;
}

async function main() {
  const callsBefore = modelCallCount();
  await testSceneLayers();
  await testEvidenceExpansion();
  testShotCoverage();
  testGlobalStageRegistrationAndNeutrality();
  const p95 = testPerformanceAndSize();
  const callsAfter = modelCallCount();
  assert.equal(callsAfter, callsBefore, '独立平台合同回归不得产生任何真实或模拟持久化模型调用');
  assert.equal(releaseBundle.identity().bundle_id.length > 0, true);
  console.log(JSON.stringify({
    platform_layered_contracts: 'passed',
    scene_core_preserved_after_enhancement_failure: true,
    close_detail_direct_to_panorama_blocked: true,
    story_beat_to_shot_coverage: '1:N',
    managed_model_stages_checked: (() => {
      const ids = new Set();
      fs.readdirSync(path.join(root, 'src/services/newStoryAd')).filter(file => file.endsWith('.js')).forEach((file) => {
        const source = fs.readFileSync(path.join(root, 'src/services/newStoryAd', file), 'utf8');
        for (const match of source.matchAll(/\bstage\s*:\s*['"`](new_story_ad\.[a-z0-9_.-]+)['"`]/gi)) ids.add(match[1]);
      });
      return ids.size;
    })(),
    stale_checkpoint_concurrent_attempts_blocked: 10,
    paid_provider_calls: callsAfter - callsBefore,
    planning_p95_ms: Number(p95.toFixed(3)),
  }));
}

main()
  .finally(() => fs.rmSync(outputDir, { recursive: true, force: true }));
