const assert = require('assert');
const strategy = require('../src/services/newStoryAd/referenceEvidenceStrategyService');

const short = strategy.planSegmentSamples({ shot_index: 1, range: [0, 0.6] }, { duration: 20 });
assert.deepStrictEqual(short.map(item => item.sample_role), ['representative']);
assert.deepStrictEqual(short[0].intents, strategy.INTENTS);

const medium = strategy.planSegmentSamples({ shot_index: 2, range: [1, 2.8] }, { duration: 20 });
assert.deepStrictEqual(medium.map(item => item.sample_role), ['opening', 'closing']);
assert.ok(medium[0].intents.includes('scene'));
assert.ok(medium[1].intents.includes('action'));

const long = strategy.planSegmentSamples({ shot_index: 3, range: [3, 8] }, { duration: 20 });
assert.deepStrictEqual(long.map(item => item.sample_role), ['opening', 'midpoint', 'closing']);
assert.equal(long[1].timestamp_seconds, 5.5);
assert.ok(long[1].intents.includes('action'));

const plan = strategy.buildAdaptiveEvidencePlan({
  duration: 20,
  segments: [
    { shot_index: 1, range: [0, 0.6] },
    { shot_index: 2, range: [1, 2.8] },
    { shot_index: 3, range: [3, 8], motion_score: 0.9 },
  ],
  max_frames: 12,
});
assert.equal(plan.contract_version, strategy.CONTRACT_VERSION);
assert.equal(plan.frames.length, 6);
assert.equal(plan.sampled_segment_count, 3);
assert.deepStrictEqual(plan.frames.map(item => item.frame_id), ['F001', 'F002', 'F003', 'F004', 'F005', 'F006']);
assert.ok(plan.frames.every(item => item.strategy_version === strategy.CONTRACT_VERSION));

const budgeted = strategy.buildAdaptiveEvidencePlan({
  duration: 30,
  segments: Array.from({ length: 5 }, (_, index) => ({
    shot_index: index + 1,
    range: [index * 5, (index + 1) * 5],
    motion_score: index === 3 ? 1 : 0,
  })),
  max_frames: 7,
});
assert.equal(budgeted.frames.length, 7);
assert.equal(budgeted.sampled_segment_count, 5, '帧预算收紧时也不能静默丢弃完整镜头片段');
assert.equal(budgeted.budget.optional_frames_omitted, 8);
assert.equal(budgeted.budget.limited, true);
assert.ok(budgeted.frames.some(item => item.shot_index === 4 && item.sample_role !== 'representative'), '高变化风险片段应优先获得额外证据位');

assert.throws(
  () => strategy.buildAdaptiveEvidencePlan({
    duration: 10,
    segments: Array.from({ length: 4 }, (_, index) => ({ shot_index: index + 1, range: [index * 2, index * 2 + 1] })),
    max_frames: 3,
  }),
  error => error.code === 'REFERENCE_EVIDENCE_SEGMENT_BUDGET_EXCEEDED' && error.retryable === false,
);

assert.deepStrictEqual(
  strategy.routeFrameIntents({ sample_role: 'midpoint' }),
  ['entity', 'action', 'brand_text'],
);
assert.deepStrictEqual(
  strategy.routeFrameIntents({ sample_role: 'custom', intents: ['scene', 'action', 'unknown', 'scene'] }),
  ['scene', 'action'],
);

const completeEvidence = plan.frames.map(frame => ({
  frame_id: frame.frame_id,
  covered_intents: frame.intents,
  entity_observation_complete: true,
  scene_observation_complete: true,
  action_observation_complete: true,
  transition_observation_complete: true,
  brand_text_observation_complete: true,
}));
const completeCoverage = strategy.computeCoverage(plan, completeEvidence);
assert.equal(completeCoverage.complete, true);
assert.equal(completeCoverage.returned_frame_count, plan.frames.length);
assert.equal(completeCoverage.complete_frame_count, plan.frames.length);
assert.equal(completeCoverage.expected_shot_count, 3);
assert.equal(completeCoverage.covered_shot_count, 3);
assert.equal(completeCoverage.overall_ratio, 1);

const missingTransition = completeEvidence.map(row => ({ ...row }));
const transitionFrame = plan.frames.find(frame => frame.intents.includes('transition'));
delete missingTransition.find(row => row.frame_id === transitionFrame.frame_id).transition_observation_complete;
missingTransition.find(row => row.frame_id === transitionFrame.frame_id).covered_intents = transitionFrame.intents
  .filter(intent => intent !== 'transition');
const partialCoverage = strategy.computeCoverage(plan, missingTransition);
assert.equal(partialCoverage.complete, false, '帧编号齐全但专项意图缺失时不得标记完整');
assert.equal(partialCoverage.returned_frame_count, plan.frames.length);
assert.ok(partialCoverage.dimensions.transition.missing_frame_ids.includes(transitionFrame.frame_id));
assert.ok(partialCoverage.missing_frame_ids.includes(transitionFrame.frame_id));

const normalizedEvidenceCoverage = strategy.computeCoverage([
  { frame_id: 'F101', shot_index: 10, intents: ['entity', 'scene', 'action', 'transition', 'brand_text'] },
], [{
  payload: {
    frames: [{
      frame_id: 'F101',
      human_presence: false,
      animal_presence: false,
      environment: '可见的通用物理空间',
      layout: '主体位于画面中央',
      visible_text: [],
      action_observation_complete: true,
      scene_change: false,
    }],
  },
}]);
assert.equal(normalizedEvidenceCoverage.complete, true, '明确的否定观察也应算作已完成识别，而不是强迫模型编造对象或文字');

assert.ok(!JSON.stringify(strategy.routeFrameIntents({ sample_role: 'representative' })).match(/汽车|家具|宠物|教育|医疗/), '核心策略不得包含行业词路由');

console.log('reference evidence strategy tests passed');
