const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
assert.deepStrictEqual(recovery.missingContracts(recovery.auditContracts({})), ['story', 'timeline', 'cast', 'scenes', 'brand_audio'],
  '缺少 completeness 的空对象不能被误判为五类合同全部完成');

const productionScore65Audit = recovery.auditContracts({
  reference_understanding: {
    completeness: {
      valid: false,
      failures: ['character_semantics_incomplete', 'scene_semantics_incomplete'],
    },
  },
});
assert.equal(productionScore65Audit.score, 65);
assert.deepStrictEqual(recovery.missingContracts(productionScore65Audit), ['cast', 'scenes']);
assert.equal(
  recovery.isRepairable(productionScore65Audit, { minimumScore: 50 }),
  true,
  '8/8 镜头已完成且仅缺人物、场景合同的 65 分候选必须进入定向修复',
);
const analysisServiceSource = fs.readFileSync(
  path.join(__dirname, '../src/services/newStoryAd/referenceVideoAnalysisService.js'),
  'utf8',
);
assert.doesNotMatch(analysisServiceSource, /isRepairable\(audit, \{ minimumScore: 75 \}\)/);
const checkpointStart = analysisServiceSource.indexOf('if (semanticCheckpoint.best_candidate?.draft)');
const checkpointRepair = analysisServiceSource.indexOf('await repairSemanticCandidate({', checkpointStart);
const fullSynthesis = analysisServiceSource.indexOf('} else response = await modelGateway.generateText({', checkpointStart);
assert.ok(
  checkpointStart >= 0 && checkpointRepair > checkpointStart && fullSynthesis > checkpointRepair,
  '已持久化的 65 分候选必须在任何完整合同模型调用前直接进入缺项修复',
);
const repairFunctionStart = analysisServiceSource.indexOf('const repairSemanticCandidate = async');
const isolatedFailure = analysisServiceSource.indexOf('contractErrors.push({ contract, error })', repairFunctionStart);
const isolatedContinue = analysisServiceSource.indexOf('if (!acceptedCandidate) continue', isolatedFailure);
const aggregateFailure = analysisServiceSource.indexOf("aggregate.code = 'REFERENCE_SEMANTIC_CONTRACTS_INCOMPLETE'", isolatedContinue);
assert.ok(
  isolatedFailure > repairFunctionStart && isolatedContinue > isolatedFailure && aggregateFailure > isolatedContinue,
  '单个语义合同失败必须继续执行后续独立合同，并在全部尝试后统一报告',
);

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

// Equivalent production fixture: Flash returned a useful semantic candidate but
// omitted cast and scene contracts. A later Pro response was not JSON. The
// useful contracts and their owned fields must survive independently.
const flashMissingCastScenes = {
  summary: '人物完成一次可见体验并形成结果。',
  story_outline: { opening: '人物进入', development: '开始体验', resolution: '结果出现' },
  plot_beats: [{ index: 1, event: '进入' }, { index: 2, event: '完成体验' }],
  character_prompts: [],
  character_actions: [],
  reference_understanding: {
    completeness: {
      valid: false,
      failures: ['character_semantics_incomplete', 'scene_semantics_incomplete'],
    },
    story_summary: { full_synopsis: '人物进入当前任务空间，完成体验并得到可见结果。' },
    causal_chain: [{ id: 'event_1', evidence_refs: ['F001'] }],
    facts: [{ content: '体验结果可见', evidence_refs: ['F002'] }],
    inferences: [],
    unknowns: [],
    brand_role: { story_function: '提供完成体验所需的主体' },
    audio_visual: { rhythm: '按可见事件推进' },
  },
};
let providerCheckpoint = recovery.emptyCheckpoint(recovery.fingerprint({ frames: ['F001', 'F002'] }));
providerCheckpoint = recovery.retainBestCandidate(providerCheckpoint, {
  analysis: flashMissingCastScenes,
  model: 'deyunai/gemini-2.5-flash',
  candidateIndex: 0,
  savedAt: '2026-08-05T11:00:00.000Z',
});
assert.deepStrictEqual(recovery.publicProgress(providerCheckpoint).missing_contracts, ['cast', 'scenes']);
assert.equal(recovery.publicProgress(providerCheckpoint).score, 65);
const flashBestDigest = providerCheckpoint.best_candidate.digest;
providerCheckpoint = recovery.recordAttempt(providerCheckpoint, {
  model: 'deyunai/gemini-2.5-pro',
  candidateIndex: 1,
  rawText: 'upstream returned a non-json response',
  status: 'invalid_json',
  errorCode: 'PROVIDER_RESPONSE_INVALID',
  errorMessage: '模型响应不是 JSON',
  savedAt: '2026-08-05T11:00:01.000Z',
});
const afterFirstInvalid = JSON.stringify(providerCheckpoint);
providerCheckpoint = recovery.recordAttempt(providerCheckpoint, {
  model: 'deyunai/gemini-2.5-pro',
  candidateIndex: 1,
  rawText: 'upstream returned a non-json response',
  status: 'invalid_json',
  errorCode: 'PROVIDER_RESPONSE_INVALID',
  errorMessage: '模型响应不是 JSON',
  savedAt: '2026-08-05T11:00:02.000Z',
});
assert.equal(JSON.stringify(providerCheckpoint), afterFirstInvalid, '同一非 JSON 响应重放必须幂等，不得重复扩张 checkpoint');
assert.equal(providerCheckpoint.best_candidate.digest, flashBestDigest, 'Pro 非 JSON 不得覆盖 Flash 的最佳草稿');
assert.ok(!JSON.stringify(providerCheckpoint).includes('upstream returned a non-json response'), '失败原文不得进入持久化 checkpoint');

const maliciousCastScenePatch = {
  summary: '试图覆盖已通过故事',
  plot_beats: [{ index: 99, event: '试图覆盖已通过时间线' }],
  subtitle_cta: '试图覆盖已通过品牌音频',
  character_prompts: [{ id: 'person_1', role: '当前证据中的人物' }],
  character_actions: [{ character_id: 'person_1', action: '完成可见动作', evidence_refs: ['F001'] }],
  reference_understanding: {
    story_summary: { full_synopsis: '不应写入' },
    causal_chain: [{ id: 'event_bad' }],
    characters: [{ id: 'person_1', evidence_refs: ['F001'] }],
    scenes: [{ scene_id: 'scene_1', events: ['event_1'], evidence_refs: ['F001', 'F002'] }],
    brand_role: { story_function: '不应写入' },
  },
};
const ownedMerge = recovery.mergeContractPatch(flashMissingCastScenes, maliciousCastScenePatch, ['cast', 'scenes']);
assert.equal(ownedMerge.summary, flashMissingCastScenes.summary);
assert.deepStrictEqual(ownedMerge.plot_beats, flashMissingCastScenes.plot_beats);
assert.deepStrictEqual(ownedMerge.reference_understanding.story_summary, flashMissingCastScenes.reference_understanding.story_summary);
assert.deepStrictEqual(ownedMerge.reference_understanding.brand_role, flashMissingCastScenes.reference_understanding.brand_role);
assert.equal(ownedMerge.character_prompts.length, 1);
assert.equal(ownedMerge.reference_understanding.scenes.length, 1);

const castSceneOnlyCandidate = {
  character_prompts: ownedMerge.character_prompts,
  character_actions: ownedMerge.character_actions,
  animal_prompts: [],
  animal_actions: [],
  reference_understanding: {
    completeness: {
      valid: false,
      failures: ['story_semantics_incomplete', 'causal_chain_missing', 'brand_semantics_incomplete'],
    },
    characters: ownedMerge.reference_understanding.characters,
    scenes: ownedMerge.reference_understanding.scenes,
  },
};
providerCheckpoint = recovery.retainBestCandidate(providerCheckpoint, {
  analysis: castSceneOnlyCandidate,
  model: 'targeted-contract-repair',
  candidateIndex: 0,
  savedAt: '2026-08-05T11:00:03.000Z',
});
const independentProgress = recovery.publicProgress(providerCheckpoint);
assert.equal(independentProgress.valid, true, '互补候选中分别通过的五类合同必须可独立汇合');
assert.equal(independentProgress.completed, 5);
assert.equal(providerCheckpoint.best_candidate.digest, flashBestDigest, '低总分互补候选不得覆盖整份最佳草稿');
const composite = recovery.compositeDraft(providerCheckpoint);
assert.equal(composite.summary, flashMissingCastScenes.summary);
assert.equal(composite.character_prompts[0].id, 'person_1');
assert.equal(composite.reference_understanding.scenes[0].scene_id, 'scene_1');
assert.ok(Object.values(providerCheckpoint.contract_candidates).every(candidate => candidate && candidate.fragment));
assert.ok(Object.values(providerCheckpoint.contract_candidates).every(candidate => !Object.prototype.hasOwnProperty.call(candidate, 'draft')),
  '逐合同候选只能保存 owned fragment，不能重复保存整份大草稿');

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
const blockedCheckpoint = recovery.retainBestCandidate(recovery.emptyCheckpoint('blocked-fixture'), {
  analysis: { reference_understanding: { completeness: { valid: false, failures: ['provider_refusal'] } } },
  model: 'provider/refusal',
});
assert.equal(recovery.publicProgress(blockedCheckpoint).completed, 0, '硬失败候选不得把五类合同误记为完成');
assert.ok(Object.values(recovery.publicProgress(blockedCheckpoint).contracts).every(state => state.status === 'blocked'));
const unknownFailure = recovery.auditContracts(['new_unclassified_contract_failure']);
assert.equal(recovery.isRepairable(unknownFailure), false, '未知质量失败必须保持关闭，不能被错误放行');
const compactedOversize = recovery.extractSemanticDraft({
  summary: '长'.repeat(recovery.MAX_BEST_DRAFT_BYTES),
});
assert.equal(compactedOversize.summary.length, 4000, '异常超长单一标量应受控压缩，不应误杀整份合法候选');
assert.ok(Buffer.byteLength(JSON.stringify(compactedOversize), 'utf8') < recovery.MAX_BEST_DRAFT_BYTES);

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
  shot_breakdown: largeChain.map((event, index) => ({
    order: index + 1,
    range: event.range,
    scene_id: event.scene_id,
    subject_ids: ['person_1'],
    action: event.action,
  })),
  reference_understanding: { ...baseAnalysis.reference_understanding, causal_chain: largeChain },
}, {
  visualEvidence: [{ payload: { frames } }],
  transcript: { status: 'no_audio', text: '', segments: [] },
});
const mappedEventIds = largeNormalized.reference_understanding.scenes.flatMap(scene => scene.events);
assert.equal(mappedEventIds.length, 120);
assert.equal(new Set(mappedEventIds).size, 120, '最大事件集合中的每个事件必须且只能归属一个权威场景');

const extremeSemanticCandidate = {
  summary: '覆盖长参考片的语义摘要',
  story_outline: { opening: '开始', development: '推进', resolution: '完成' },
  plot_beats: largeChain.map((event, index) => ({ index: index + 1, event: event.action })),
  character_prompts: Array.from({ length: 12 }, (_, index) => ({ id: `person_${index + 1}`, role: `人物${index + 1}` })),
  character_actions: Array.from({ length: 120 }, (_, index) => ({ character_id: `person_${(index % 12) + 1}`, action: `动作${index + 1}` })),
  animal_prompts: [],
  animal_actions: [],
  subtitle_cta: '按当前任务证据收束',
  reference_understanding: {
    completeness: { valid: true, failures: [] },
    story_summary: { full_synopsis: '120 个事件按证据时间线完成，不依赖任何行业模板。' },
    causal_chain: largeChain,
    facts: largeChain.map(event => ({ content: event.action, evidence_refs: event.evidence_refs })),
    inferences: [],
    unknowns: [],
    characters: Array.from({ length: 12 }, (_, index) => ({ id: `person_${index + 1}`, evidence_refs: [index % 2 ? 'F002' : 'F001'] })),
    scenes: Array.from({ length: 24 }, (_, index) => ({ scene_id: `scene_${index + 1}`, events: [`event_${index + 1}`], evidence_refs: [index % 2 ? 'F002' : 'F001'] })),
    brand_role: { story_function: '按证据推动事件完成' },
    audio_visual: { rhythm: '按事件顺序推进' },
  },
};
let extremeCheckpoint = recovery.emptyCheckpoint('extreme-120-events');
extremeCheckpoint = recovery.retainBestCandidate(extremeCheckpoint, {
  analysis: extremeSemanticCandidate,
  model: 'fixture/extreme',
  savedAt: '2026-08-05T12:00:00.000Z',
});
assert.equal(extremeCheckpoint.contract_candidates.timeline.fragment.reference_understanding.causal_chain.length, 120);
assert.equal(extremeCheckpoint.contract_candidates.cast.fragment.reference_understanding.characters.length, 12);
assert.equal(extremeCheckpoint.contract_candidates.scenes.fragment.reference_understanding.scenes.length, 24);
assert.ok(Buffer.byteLength(JSON.stringify(extremeCheckpoint), 'utf8') < recovery.MAX_BEST_DRAFT_BYTES * 2 + 128 * 1024,
  '120事件、多人物、多场景 checkpoint 必须保持有界，合同候选不得五份复制完整草稿');

console.log('reference semantic recovery: ok', {
  best_score: checkpoint.best_candidate.audit.score,
  missing_contracts: recovery.publicProgress(checkpoint).missing_contracts,
  authoritative_scenes: normalized.reference_understanding.scenes.length,
  max_events_mapped: mappedEventIds.length,
});
