const assert = require('assert');

const understandingService = require('../src/services/newStoryAd/referenceUnderstandingService');
const analysisService = require('../src/services/newStoryAd/referenceVideoAnalysisService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');

const frames = [
  {
    frame_id: 'F001', timestamp_seconds: 0.5, shot_index: 1, shot_range: [0, 2],
    visible_text: ['公开信息一'], human_presence: true,
  },
  {
    frame_id: 'F002', timestamp_seconds: 2.8, shot_index: 2, shot_range: [2, 4],
    visible_text: ['公开信息二'], human_presence: true,
  },
  {
    frame_id: 'F003', timestamp_seconds: 5, shot_index: 3, shot_range: [4, 6],
    visible_text: ['了解更多'], human_presence: true,
  },
];

const transcript = {
  status: 'completed',
  text: '先建立问题，再展示行动，最后说明结果。',
  segments: [
    { start: 0, end: 2, text: '先建立问题' },
    { start: 2, end: 4, text: '再展示行动' },
    { start: 4, end: 6, text: '最后说明结果' },
  ],
};

const base = {
  schema_version: 6,
  source_facts: {
    product_or_service: '当前可见叙事主体',
    environment: '连续变化的真实空间',
    materials: ['真实可见材质'],
    colors: ['自然色调'],
    layout: '主体位于画面中心，人物从侧面进入并完成互动',
    lighting: '连续自然光线',
    human_presence: true,
    human_count: 1,
    human_actions: ['人物进入画面', '人物完成互动', '人物观察结果'],
    animal_presence: false,
    narrative_animal_presence: false,
    chronological_story: ['建立问题', '执行行动', '呈现结果'],
    evidence_timestamps: [0.5, 2.8, 5],
  },
  summary: '通过连续事件说明主体如何参与问题解决并形成结果。',
  story_outline: {
    logline: '人物发现问题，采取行动并看到结果。',
    opening: '人物进入空间并发现需要解决的问题。',
    development: '人物围绕可见主体完成实际行动。',
    turning_point: '行动产生可见状态变化。',
    resolution: '人物确认结果并完成信息收束。',
  },
  plot_beats: [
    { order: 1, range: [0, 2], purpose: '建立问题', evidence_summary: '人物发现问题' },
    { order: 2, range: [2, 4], purpose: '展示行动', evidence_summary: '人物采取行动' },
    { order: 3, range: [4, 6], purpose: '呈现结果', evidence_summary: '人物确认结果' },
  ],
  character_prompts: [{ id: 'character_prompt_1', role: '叙事行动者' }],
  scene_prompts: [{
    id: 'scene_prompt_1', location_type: '连续变化的真实空间',
    layout_prompt: '环境：连续变化的真实空间；布局：主体位于画面中心；广告主体：当前可见叙事主体',
    material_light_prompt: '材质：真实可见材质；色彩：自然色调；光线：连续自然光线',
    interaction_prompt: '人物围绕主体完成可见行动', camera_purpose: '承载完整事件变化',
  }],
  camera_intents: [
    { range: [0, 2], movement: 'static' },
    { range: [2, 4], movement: 'tracking' },
    { range: [4, 6], movement: 'push_in' },
  ],
  character_actions: [{ role: '叙事行动者', key_action: '人物完成证据中可见的实际行动' }],
  animal_actions: [], animal_prompts: [],
  shot_breakdown: [
    { order: 1, range: [0, 2], visual: '人物进入空间并发现问题', action: '人物观察当前状态', scene_id: 'scene_prompt_1', subject_ids: ['character_prompt_1'], shot_size: 'wide', angle: 'eye_level', movement: 'static', duration_seconds: 2 },
    { order: 2, range: [2, 4], visual: '人物围绕主体完成行动', action: '人物执行实际操作', scene_id: 'scene_prompt_1', subject_ids: ['character_prompt_1'], shot_size: 'medium', angle: 'eye_level', movement: 'tracking', duration_seconds: 2 },
    { order: 3, range: [4, 6], visual: '人物看到行动后的结果', action: '人物观察并确认结果', scene_id: 'scene_prompt_1', subject_ids: ['character_prompt_1'], shot_size: 'close_up', angle: 'eye_level', movement: 'push_in', duration_seconds: 2 },
  ],
  evidence_frames: frames,
  evidence_coverage: {
    complete: true, expected_frame_count: 3, covered_frame_count: 3,
    expected_frame_ids: ['F001', 'F002', 'F003'], covered_frame_ids: ['F001', 'F002', 'F003'], shot_segment_count: 3,
  },
  transcript,
  reference_understanding: {
    story_summary: {
      logline: '人物通过连续行动解决问题并确认结果。',
      short_synopsis: '人物先发现问题，随后采取行动，最终看到变化。',
      full_synopsis: '开场中人物进入真实空间并发现需要处理的问题；发展阶段人物围绕可见主体执行实际行动；关键行动带来状态变化，人物最终观察并确认结果，画面以明确的信息完成收束。',
      central_conflict: '初始状态与期望结果之间存在差距。',
      trigger: '人物发现需要处理的问题。', turning_point: '实际行动改变当前状态。',
      climax: '结果变化被清楚展示。', resolution: '人物确认结果。', brand_function: '可见主体参与解决过程。', cta: '了解更多。',
    },
    causal_chain: [
      { id: 'event_1', range: [0, 2], scene_id: 'scene_prompt_1', subject: '叙事行动者', action: '发现问题', result: '开始寻找处理方式', caused_by: null, leads_to: 'event_2', evidence_refs: ['F001', 'T001'], certainty: 'fact' },
      { id: 'event_2', range: [2, 4], scene_id: 'scene_prompt_1', subject: '叙事行动者', action: '采取行动', motivation: '希望解决问题', result: '当前状态发生变化', caused_by: 'event_1', leads_to: 'event_3', evidence_refs: ['F002', 'T002'], motivation_evidence_refs: [], certainty: 'fact' },
      { id: 'event_3', range: [4, 6], scene_id: 'scene_prompt_1', subject: '叙事行动者', action: '确认结果', result: '故事完成收束', caused_by: 'event_2', leads_to: null, evidence_refs: ['F003', 'T003', 'F999'], certainty: 'fact' },
    ],
    characters: [{ character_id: 'character_prompt_1', role: '叙事行动者', initial_state: '面对问题', goal: '改变当前状态', final_state: '确认结果', evidence_refs: ['F001', 'F003'], certainty: 'fact' }],
    scenes: [{ scene_id: 'scene_prompt_1', narrative_function: '承载问题、行动和结果', events: ['event_1', 'event_2', 'event_3'], state_change: '从问题状态转为结果状态', evidence_refs: ['F001', 'F002', 'F003'], certainty: 'fact' }],
    brand_role: { subject: '当前可见叙事主体', story_function: '参与问题解决', visible_claims: ['公开信息一'], proof_moments: ['event_2', 'event_3'], cta: '了解更多', evidence_refs: ['F002', 'F003'], certainty: 'fact' },
    inferences: [{ id: 'inference_1', claim: '人物希望解决问题', evidence_refs: ['F001', 'F002'], reason: '根据连续行动推断，画面未直接说明内心动机' }],
    unknowns: [{ id: 'unknown_1', question: '人物未明说的具体内心想法是什么？', affected_fields: ['characters.goal'] }],
  },
};

const enriched = understandingService.enrichAnalysis(base, { transcript });
assert.equal(enriched.schema_version, 6);
assert.equal(enriched.reference_understanding.contract_version, 'reference-understanding-v6');
assert.equal(enriched.reference_understanding.causal_chain.length, 3);
assert.deepEqual(enriched.reference_understanding.causal_chain[2].evidence_refs, ['F003', 'T003'], '无效证据引用必须被移除');
assert.equal(enriched.reference_understanding.causal_chain[1].certainty, 'inference', '推断不得升级为事实');
assert.ok(enriched.reference_understanding.story_summary.full_synopsis.includes('开场'));
assert.equal(enriched.reference_understanding.characters.length, 1);
assert.equal(enriched.reference_understanding.scenes.length, 1);
assert.equal(enriched.reference_understanding.audio_visual.alignments.length, 3);
assert.equal(enriched.reference_understanding.audio_visual.ocr.length, 3);
assert.equal(enriched.reference_understanding.completeness.valid, true);
assert.equal(enriched.reference_understanding.completeness.story_complete, true);
assert.equal(enriched.reference_understanding.completeness.cause_chain_complete, true);
assert.doesNotThrow(() => understandingService.validate(enriched));

const normalized = analysisService._private.normalizeResult(enriched);
assert.equal(normalized.analysis_quality.reference_understanding_complete, true);
assert.ok(normalized.generated_brief.includes('完整故事'));
const context = contextBuilder.normalizeReferenceVideoAnalysis({
  analysis_id: 'reference-understanding-v6-test', status: 'completed', ...normalized,
});
assert.equal(context.reference_understanding.contract_version, 'reference-understanding-v6');
assert.equal(context.reference_understanding.causal_chain.length, 3);
const prompt = contextBuilder.referenceVideoAnalysisPrompt(context);
assert.ok(prompt.includes('reference_understanding'));
assert.ok(prompt.includes('full_synopsis'));
assert.ok(prompt.includes('inference'));

const legacyZeroCall = understandingService.enrichAnalysis({
  ...base,
  schema_version: 5,
  evidence_frames: [],
  reference_understanding: null,
}, { transcript: { status: 'no_audio', segments: [] } });
assert.equal(legacyZeroCall.reference_understanding.causal_chain.length, 3);
assert.ok(legacyZeroCall.reference_understanding.causal_chain.every(row => row.evidence_refs.length), '旧合同应从已审计逐镜结果零模型迁移证据引用');
assert.doesNotThrow(() => understandingService.validate(legacyZeroCall));

console.log(JSON.stringify({
  passed: true,
  checks: 26,
  contract: enriched.reference_understanding.contract_version,
  events: enriched.reference_understanding.causal_chain.length,
  evidence_refs: enriched.reference_understanding.causal_chain.flatMap(row => row.evidence_refs).length,
  model_calls: 0,
}));
