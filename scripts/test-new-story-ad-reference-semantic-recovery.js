const assert = require('assert');
const recovery = require('../src/services/newStoryAd/referenceSemanticRecoveryService');
const understanding = require('../src/services/newStoryAd/referenceUnderstandingService');

const sceneOnlyFailures = {
  reference_understanding: {
    completeness: {
      valid: false,
      failures: ['scene_semantics_incomplete', 'scene_event_mapping_incomplete'],
    },
  },
  story_outline: { logline: '保留的候选故事' },
};
const sceneAudit = recovery.auditContracts(sceneOnlyFailures);
assert.equal(sceneAudit.score, 80);
assert.deepStrictEqual(recovery.missingContracts(sceneAudit), ['scenes']);
assert.equal(recovery.isRepairable(sceneAudit), true);

const weakCandidate = {
  reference_understanding: {
    completeness: {
      valid: false,
      failures: [
        'story_semantics_incomplete',
        'character_semantics_incomplete',
        'scene_semantics_incomplete',
        'brand_semantics_incomplete',
      ],
    },
  },
};
const inputFingerprint = recovery.fingerprint({ evidence: ['F001', 'F002'], transcript: 'none' });
assert.equal(
  inputFingerprint,
  recovery.fingerprint({ transcript: 'none', evidence: ['F001', 'F002'] }),
  '输入字段顺序不得改变持久化幂等摘要',
);
let checkpoint = recovery.emptyCheckpoint(inputFingerprint);
assert.equal(recovery.publicProgress(checkpoint).completed, 0);
checkpoint = recovery.retainBestCandidate(checkpoint, {
  analysis: weakCandidate,
  model: 'provider/weak',
  candidateIndex: 0,
  savedAt: '2026-08-05T10:00:00.000Z',
});
checkpoint = recovery.retainBestCandidate(checkpoint, {
  analysis: sceneOnlyFailures,
  model: 'provider/scene-repairable',
  candidateIndex: 1,
  savedAt: '2026-08-05T10:00:01.000Z',
});
assert.equal(checkpoint.best_candidate.model, 'provider/scene-repairable');
assert.equal(checkpoint.best_candidate.audit.score, 80);
assert.equal(checkpoint.attempt_summaries.length, 2);
assert.equal(recovery.checkpointMatches(checkpoint, inputFingerprint), true);
assert.equal(recovery.checkpointMatches(checkpoint, recovery.fingerprint({ evidence: ['F003'] })), false);
assert.deepStrictEqual(recovery.publicProgress(checkpoint).missing_contracts, ['scenes']);
assert.equal(Object.prototype.hasOwnProperty.call(recovery.publicProgress(checkpoint), 'best_candidate'), false);

for (let index = 2; index < 10; index += 1) {
  checkpoint = recovery.retainBestCandidate(checkpoint, {
    analysis: weakCandidate,
    model: `provider/weak-${index}`,
    candidateIndex: index,
    savedAt: `2026-08-05T10:00:${String(index).padStart(2, '0')}.000Z`,
  });
}
assert.equal(checkpoint.attempt_summaries.length, recovery.MAX_ATTEMPT_SUMMARIES);
assert.equal(checkpoint.best_candidate.model, 'provider/scene-repairable', '低质量后续候选不得覆盖最佳草稿');

const hardFailure = recovery.auditContracts(['provider_refusal', 'scene_semantics_incomplete']);
assert.equal(recovery.isRepairable(hardFailure), false, '供应商拒绝不得伪装成可定向补写的候选');
const unknownFailure = recovery.auditContracts(['new_unclassified_contract_failure']);
assert.equal(recovery.isRepairable(unknownFailure), false, '未知质量失败必须保持关闭，不能被错误放行');
assert.throws(
  () => recovery.extractSemanticDraft({ summary: '长'.repeat(recovery.MAX_BEST_DRAFT_BYTES) }),
  error => error.code === 'REFERENCE_SEMANTIC_CANDIDATE_TOO_LARGE',
  '超长候选不得无限扩张 record.json 和轮询读取成本',
);

const frames = [
  { frame_id: 'F001', timestamp_seconds: 0.5, summary: '人物进入住宅客厅并观察空间布局', visible_text: [] },
  { frame_id: 'F002', timestamp_seconds: 2.5, summary: '人物来到门店展示区体验商品细节', visible_text: [] },
];
const baseAnalysis = {
  source_facts: { product_or_service: '测试服务', human_presence: false },
  story_outline: { logline: '人物依次体验两个空间中的服务流程' },
  scene_prompts: [
    { id: 'scene_home', camera_purpose: '住宅客厅负责建立人物出发前的生活状态' },
    { id: 'scene_store', camera_purpose: '门店展示区负责承载服务体验和结果证明' },
  ],
  shot_breakdown: [
    { range: [0, 1], scene_id: 'scene_home', subject_ids: ['person_1'], action: '进入住宅客厅' },
    { range: [2, 3], scene_id: 'scene_store', subject_ids: ['person_1'], action: '进入门店体验服务' },
  ],
  reference_understanding: {
    story_summary: {
      narrative_mode: 'showcase_montage',
      narrative_mode_reason: '内容通过两个真实空间递进展示服务体验。',
      logline: '人物从住宅出发并在门店完成服务体验。',
      short_synopsis: '两个空间共同完成服务体验展示。',
      full_synopsis: '开场在住宅客厅建立人物状态，随后转入门店展示区完成服务体验，并以明确结果结束。',
      theme: '真实空间中的服务体验',
      trigger: '人物从住宅出发',
      turning_point: '进入门店展示区',
      climax: '完成服务体验',
      resolution: '服务体验得到明确证明。',
      brand_function: '测试服务连接两个空间并推动体验完成。',
      cta: '进一步了解测试服务。',
    },
    causal_chain: [
      { id: 'event_1', range: [0, 1], scene_id: 'scene_home', subject: '人物', action: '进入住宅客厅', result: '建立初始状态', caused_by: null, leads_to: null, evidence_refs: ['F001'], certainty: 'fact' },
      { id: 'event_2', range: [2, 3], scene_id: 'invented_scene', subject: '人物', action: '进入门店体验服务', result: '完成体验证明', caused_by: null, leads_to: null, evidence_refs: ['F002'], certainty: 'fact' },
    ],
    characters: [],
    scenes: [
      { scene_id: 'scene_home', narrative_function: '建立住宅中的初始生活状态', events: ['event_1', 'event_2'], evidence_refs: ['F001'], certainty: 'fact' },
      { scene_id: 'scene_home', narrative_function: '重复且错误的住宅条目', events: ['event_2'], evidence_refs: ['F002'], certainty: 'fact' },
      { scene_id: 'invented_scene', narrative_function: '模型编造的空间', events: ['event_1'], evidence_refs: ['F001'], certainty: 'fact' },
    ],
    brand_role: { subject: '测试服务', story_function: '推动体验完成', evidence_refs: ['F001'], certainty: 'fact' },
    facts: [], inferences: [], unknowns: [],
  },
};
const normalized = understanding.enrichAnalysis(baseAnalysis, {
  visualEvidence: [{ payload: { frames } }],
  transcript: { status: 'no_audio', text: '', segments: [] },
});
assert.deepStrictEqual(normalized.reference_understanding.scenes.map(scene => scene.scene_id), ['scene_home', 'scene_store']);
assert.deepStrictEqual(normalized.reference_understanding.causal_chain.map(event => event.scene_id), ['scene_home', 'scene_store']);
assert.deepStrictEqual(normalized.reference_understanding.scenes[0].events, ['event_1']);
assert.deepStrictEqual(normalized.reference_understanding.scenes[1].events, ['event_2']);
assert.equal(normalized.reference_understanding.completeness.scene_coverage, 1);
assert.equal(normalized.reference_understanding.completeness.valid, true, JSON.stringify(normalized.reference_understanding.completeness));

const largeChain = Array.from({ length: 120 }, (_, index) => ({
  id: `event_${index + 1}`,
  range: [index, index + 0.5],
  scene_id: index % 2 ? 'scene_store' : 'scene_home',
  subject: '人物',
  action: `完成第 ${index + 1} 个可见动作`,
  result: '推进展示',
  caused_by: null,
  leads_to: null,
  evidence_refs: [index % 2 ? 'F002' : 'F001'],
  certainty: 'fact',
}));
const largeNormalized = understanding.enrichAnalysis({
  ...baseAnalysis,
  reference_understanding: { ...baseAnalysis.reference_understanding, causal_chain: largeChain },
}, {
  visualEvidence: [{ payload: { frames } }],
  transcript: { status: 'no_audio', text: '', segments: [] },
});
const mappedEventIds = largeNormalized.reference_understanding.scenes.flatMap(scene => scene.events);
assert.equal(mappedEventIds.length, 120);
assert.equal(new Set(mappedEventIds).size, 120, '最大事件集合中的每个事件必须且只能归属一个权威场景');

console.log('reference semantic recovery: ok', {
  best_score: checkpoint.best_candidate.audit.score,
  missing_contracts: recovery.publicProgress(checkpoint).missing_contracts,
  authoritative_scenes: normalized.reference_understanding.scenes.length,
  max_events_mapped: mappedEventIds.length,
});
