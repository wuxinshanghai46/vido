const assert = require('assert');
const fs = require('fs');
const path = require('path');
const graphService = require('../src/services/newStoryAd/temporalEvidenceGraphService');
const { buildKeyframeContracts } = require('../src/services/newStoryAd/keyframeContractService');
const { withContinuityContracts } = require('../src/services/newStoryAd/continuityService');
const temporalPlanner = require('../src/services/newStoryAd/temporalGenerationPlannerService');
const semanticCut = require('../src/services/newStoryAd/semanticCutService');
const videoQa = require('../src/services/newStoryAd/videoFrameQaService');
const sceneBlockService = require('../src/services/newStoryAd/sceneBlockService');

function taskFixture(industryName) {
  const subjectName = `${industryName}任务主体`;
  const shots = withContinuityContracts([
    {
      index: 1,
      title: '建立状态',
      purpose: '展示使用前状态',
      visual: `${subjectName}处于任务开始状态`,
      action: '主体开始执行当前任务要求的动作',
      entry_frame_state: '动作尚未开始',
      exit_frame_state: '动作已经启动',
      temporal_state: {
        state_before: ['动作尚未开始'],
        state_after: ['动作已经启动'],
        intended_changes: ['动作进度发生变化'],
        invariants: [`${subjectName}身份与外观保持不变`],
        evidence_requirements: ['画面可见动作已启动'],
      },
    },
    {
      index: 2,
      title: '完成证据',
      purpose: '展示任务结果',
      visual: `${subjectName}完成当前任务并呈现结果`,
      action: '延续上一镜动作直到结果出现',
      entry_frame_state: '承接上一镜动作',
      exit_frame_state: '结果已经清楚可见',
      temporal_state: {
        state_before: ['承接上一镜动作'],
        state_after: ['结果已经清楚可见'],
        intended_changes: ['任务结果由不可见变为可见'],
        invariants: [`${subjectName}身份与外观保持不变`],
        evidence_requirements: ['结果必须在画面中直接可见'],
        continuity_links: ['shot_1->shot_2'],
      },
    },
  ]);
  return {
    ctx: { product_subject: subjectName, output_ratio: '9:16', characters: [] },
    blueprint: { advertised_subject: subjectName, beats: [{ beat_index: 1 }, { beat_index: 2 }] },
    shots,
  };
}

function signature(graph) {
  return {
    topLevelKeys: Object.keys(graph).sort(),
    entityKeys: Object.keys(graph.entities[0] || {}).sort(),
    eventKeys: Object.keys(graph.events[0] || {}).sort(),
    shotStateKeys: Object.keys(graph.shot_states[0] || {}).sort(),
  };
}

async function main() {
  // 覆盖用户已经提出的行业以及一个未知行业，证明执行路径不依赖行业枚举。
  const industries = [
    '跑鞋', '瑜伽', '医美', '互联网', '食品', '汽车', '空间材料',
    '纯产品', '金融', '房地产', '教育', '深海设备租赁',
  ];
  const results = industries.map(name => {
    const fixture = taskFixture(name);
    const graph = graphService.buildGraph(fixture);
    const validation = graphService.validateGraph(graph);
    assert.strictEqual(validation.pass, true, `${name} 图校验失败：${validation.errors.join(',')}`);
    assert.strictEqual(graph.version, '2.0');
    assert.strictEqual(graph.metadata.open_vocabulary, true);
    assert.strictEqual(graph.metadata.industry_templates, false);
    assert.strictEqual(graph.shot_states.length, 2);
    assert.strictEqual(graph.shot_states[1].continuity_links[0], 'shot_1->shot_2');
    assert.ok(graph.shot_states[1].invariants.some(value => value.includes(name)));

    const attached = graphService.attachGraphToShots(fixture.shots, graph);
    const contracts = buildKeyframeContracts(
      { ...fixture.ctx, temporal_evidence_graph: graph },
      attached,
    );
    assert.strictEqual(contracts.length, 2);
    assert.ok(contracts[1].temporal_evidence_lock);
    assert.ok(contracts[1].contract_fingerprint);
    return graph;
  });

  const baseSignature = JSON.stringify(signature(results[0]));
  results.slice(1).forEach((graph, index) => {
    assert.strictEqual(
      JSON.stringify(signature(graph)),
      baseSignature,
      `${industries[index + 1]} 使用了不同的数据协议`,
    );
  });

  // 旧版只有入镜、出镜和动作字段时，也必须自动获得 V2.0 证据合同。
  const legacy = graphService.buildGraph({
    ctx: { product_subject: '旧任务主体' },
    shots: [{
      index: 1,
      visual: '旧任务主体清楚可见',
      action: '完成动作',
      entry_frame_state: '开始状态',
      exit_frame_state: '完成状态',
    }],
  });
  assert.strictEqual(graphService.validateGraph(legacy).pass, true);
  assert.deepStrictEqual(legacy.shot_states[0].state_before, ['开始状态']);
  assert.deepStrictEqual(legacy.shot_states[0].state_after, ['完成状态']);
  assert.ok(legacy.shot_states[0].evidence_requirements.length > 0);

  // 连续性分组来自开放状态链接；能力未确认时必须安全拆分，不能冒险重复付费。
  const linkedFixture = taskFixture('任意新行业');
  const linkedGraph = graphService.buildGraph(linkedFixture);
  const linkedShots = graphService.attachGraphToShots(linkedFixture.shots, linkedGraph);
  const linkedContracts = buildKeyframeContracts(
    { ...linkedFixture.ctx, temporal_evidence_graph: linkedGraph },
    linkedShots,
  );
  const safePlan = temporalPlanner.buildGenerationUnits(linkedShots, linkedContracts, {});
  assert.deepStrictEqual(safePlan.continuity_clusters.map(item => item.member_indexes), [[0, 1]]);
  assert.deepStrictEqual(safePlan.generation_units.map(item => item.member_indexes), [[0], [1]]);
  assert.strictEqual(safePlan.generation_units[1].handoff_required, true);
  assert.strictEqual(safePlan.generation_units[1].split_reason, 'provider_continuous_generation_unverified');

  // 只有供应商能力和本地适配器都能绑定每个时间锚点时，才允许生成连续母片。
  const continuousPlan = temporalPlanner.buildGenerationUnits(linkedShots, linkedContracts, {
    provider_supports_temporal_multi_keyframe: true,
    provider_temporal_reference_count: 2,
    adapter_supports_temporal_anchor_binding: true,
  });
  assert.deepStrictEqual(continuousPlan.generation_units.map(item => item.member_indexes), [[0, 1]]);
  assert.strictEqual(continuousPlan.generation_units[0].mode, 'continuous');
  const certifiedOptions = sceneBlockService.certifyTemporalCapabilities({}, {
    provider_supports_continuous_generation: true,
    adapter_supports_temporal_anchor_binding: true,
    max_temporal_anchors: 2,
    max_continuous_duration: 10,
  });
  const continuousBlocks = sceneBlockService.buildSceneBlocks(linkedShots, linkedContracts, certifiedOptions);
  assert.deepStrictEqual(continuousBlocks.map(item => item.member_indexes), [[0, 1]]);
  assert.strictEqual(continuousBlocks[0].generation_mode, 'one_take');
  assert.strictEqual(continuousBlocks[0].temporal_anchor_binding_verified, true);

  // 语义切点需要“上一事件证据 + 下一状态入口”同时成立，才允许使用运动安全点微调。
  const semanticBeats = [
    {
      shot_index: 1,
      start_sec: 0,
      end_sec: 3,
      temporal_evidence: {
        shot_state: {
          evidence_requirements: ['上一事件结果可见'],
          state_before: ['动作开始'],
        },
      },
    },
    {
      shot_index: 2,
      start_sec: 3,
      end_sec: 6,
      temporal_evidence: {
        shot_state: {
          evidence_requirements: ['下一事件结果可见'],
          state_before: ['承接上一事件结果'],
        },
      },
    },
  ];
  const semanticPlan = await semanticCut.buildLockedEditPlan({
    beats: semanticBeats,
    allowSemanticShift: true,
    motionSamples: [
      { second: 2.4, motion_score: 0.08 },
      { second: 2.6, motion_score: 0.08 },
      { second: 2.8, motion_score: 0.08 },
      { second: 3.0, motion_score: 0.08 },
      { second: 3.2, motion_score: 0.02 },
      { second: 3.4, motion_score: 0.02 },
      { second: 3.6, motion_score: 0.02 },
    ],
  });
  assert.strictEqual(semanticPlan.evidence.semantic_boundaries_locked, false);
  assert.strictEqual(semanticPlan.evidence.method, 'v2_event_evidence_motion_safe_boundaries');
  const unqualifiedPlan = await semanticCut.buildLockedEditPlan({
    beats: semanticBeats.map((beat, index) => index ? { ...beat, temporal_evidence: null } : beat),
    allowSemanticShift: true,
    motionSamples: [{ second: 3, motion_score: 0.01 }],
  });
  assert.strictEqual(unqualifiedPlan.evidence.semantic_boundaries_locked, true);

  // V2.0 质检必须逐维返回可见证据；缺少任一必需维度时不能沿用旧版总分放行。
  const requiredQaDimensions = videoQa.requiredTemporalDimensions(
    linkedContracts[1].temporal_evidence_lock,
    { hasScene: true },
  );
  assert.ok(requiredQaDimensions.includes('invariant_preservation'));
  assert.ok(requiredQaDimensions.includes('event_completion'));
  const evidenceChecks = Object.fromEntries(requiredQaDimensions.map(key => [key, {
    pass: true,
    evidence: `${key}在画面中可见`,
    frame_indexes: [0, 4],
  }]));
  const passedEvidence = videoQa.normalizeTemporalEvidenceChecks(
    { evidence_checks: evidenceChecks },
    requiredQaDimensions,
  );
  assert.strictEqual(passedEvidence.pass, true);
  delete evidenceChecks.event_completion;
  const failedEvidence = videoQa.normalizeTemporalEvidenceChecks(
    { evidence_checks: evidenceChecks },
    requiredQaDimensions,
  );
  assert.strictEqual(failedEvidence.pass, false);
  assert.ok(failedEvidence.failed.includes('event_completion'));

  // 源码中不允许出现“行业名 -> 模板”的分支表。
  const source = fs.readFileSync(
    path.join(__dirname, '../src/services/newStoryAd/temporalEvidenceGraphService.js'),
    'utf8',
  );
  industries.slice(0, 11).forEach(name => {
    assert.strictEqual(source.includes(`'${name}'`), false, `发现行业硬编码：${name}`);
  });

  console.log(`剧情广告 V2.0 开放图协议测试通过：${industries.length} 类任务共用同一执行路径。`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
