const CONTRACT_ORDER = Object.freeze(['story', 'timeline', 'cast', 'scenes', 'brand_audio']);

const CONTRACT_LABELS = Object.freeze({
  story: '故事结构',
  timeline: '事件时间线',
  cast: '人物与动物',
  scenes: '物理场景',
  brand_audio: '商品品牌与音画',
});

function objectSchema(properties = {}, required = Object.keys(properties)) {
  return { type: 'object', properties, required, additionalProperties: false };
}

function arraySchema(items = { type: 'object', additionalProperties: true }) {
  return { type: 'array', items };
}

const stringSchema = { type: 'string' };
const stringArraySchema = { type: 'array', items: stringSchema };
const rangeSchema = {
  type: 'array',
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
};

const timelineEventSchema = objectSchema({
  id: stringSchema,
  range: rangeSchema,
  scene_id: stringSchema,
  subject: stringSchema,
  action: stringSchema,
  evidence_refs: stringArraySchema,
  certainty: stringSchema,
}, ['id', 'range', 'scene_id', 'subject', 'action', 'evidence_refs', 'certainty']);

const characterUnderstandingSchema = objectSchema({
  character_id: stringSchema,
  role: stringSchema,
  narrative_function: stringSchema,
  evidence_refs: stringArraySchema,
  certainty: stringSchema,
}, ['character_id', 'role', 'narrative_function', 'evidence_refs', 'certainty']);

const sceneUnderstandingSchema = objectSchema({
  scene_id: stringSchema,
  narrative_function: stringSchema,
  events: stringArraySchema,
  evidence_refs: stringArraySchema,
  certainty: stringSchema,
}, ['scene_id', 'narrative_function', 'events', 'evidence_refs', 'certainty']);

const promptEntitySchema = objectSchema({
  id: stringSchema,
  role: stringSchema,
}, ['id']);

const actionSchema = objectSchema({
  action: stringSchema,
  range: rangeSchema,
  scene_id: stringSchema,
}, ['action', 'range', 'scene_id']);

function semanticSchema(contract = '') {
  const flexibleText = { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] };
  const schemas = {
    story: objectSchema({
      summary: flexibleText,
      story_outline: { type: 'object', additionalProperties: true },
      reference_understanding: objectSchema({
        story_summary: { type: 'object', additionalProperties: true },
      }),
    }),
    timeline: objectSchema({
      plot_beats: arraySchema(),
      reference_understanding: objectSchema({
        causal_chain: arraySchema(timelineEventSchema),
        facts: arraySchema(),
        inferences: arraySchema(),
        unknowns: arraySchema(),
      }),
    }),
    cast: objectSchema({
      character_prompts: arraySchema(promptEntitySchema),
      character_actions: arraySchema(actionSchema),
      animal_prompts: arraySchema(promptEntitySchema),
      animal_actions: arraySchema(actionSchema),
      reference_understanding: objectSchema({ characters: arraySchema(characterUnderstandingSchema) }),
    }),
    scenes: objectSchema({
      reference_understanding: objectSchema({ scenes: arraySchema(sceneUnderstandingSchema) }),
    }),
    brand_audio: objectSchema({
      subtitle_cta: flexibleText,
      reference_understanding: objectSchema({
        brand_role: { type: 'object', additionalProperties: true },
        audio_visual: { type: 'object', additionalProperties: true },
      }),
    }),
  };
  return schemas[contract] || objectSchema({});
}

function structuredOutput(contract = '') {
  return {
    mode: 'json_schema',
    name: `reference_${String(contract || 'semantic')}_contract`,
    strict: false,
    schema: semanticSchema(contract),
  };
}

function compactFrame(frame = {}) {
  return {
    frame_id: frame.frame_id,
    timestamp_seconds: frame.timestamp_seconds,
    summary: String(frame.summary || '').slice(0, 500),
    visible_text: Array.isArray(frame.visible_text) ? frame.visible_text.slice(0, 12) : [],
    subjects: Array.isArray(frame.subjects) ? frame.subjects.slice(0, 12) : [],
    actions: Array.isArray(frame.actions) ? frame.actions.slice(0, 12) : [],
    scene: frame.scene || frame.location || '',
  };
}

function commonEvidence(deterministic = {}) {
  const transcript = deterministic.transcript && typeof deterministic.transcript === 'object'
    ? deterministic.transcript : {};
  return {
    source_facts: deterministic.source_facts || {},
    evidence_frames: (deterministic.evidence_frames || []).map(compactFrame),
    transcript: {
      status: transcript.status || '',
      text: String(transcript.text || '').slice(0, 12000),
      segments: (transcript.segments || []).slice(0, 240).map((item, index) => ({
        id: item.id || `T${String(index + 1).padStart(3, '0')}`,
        start: item.start ?? item.start_seconds,
        end: item.end ?? item.end_seconds,
        text: String(item.text || '').slice(0, 400),
      })),
    },
  };
}

function contractEvidence(contract = '', deterministic = {}) {
  const common = commonEvidence(deterministic);
  if (contract === 'story') return {
    ...common,
    story_outline: deterministic.story_outline || {},
    plot_beats: deterministic.plot_beats || [],
    shot_breakdown: deterministic.shot_breakdown || [],
  };
  if (contract === 'timeline') return {
    ...common,
    plot_beats: deterministic.plot_beats || [],
    shot_breakdown: deterministic.shot_breakdown || [],
    scene_prompts: deterministic.scene_prompts || [],
  };
  if (contract === 'cast') return {
    ...common,
    shot_breakdown: deterministic.shot_breakdown || [],
    character_prompts: deterministic.character_prompts || [],
    character_actions: deterministic.character_actions || [],
    animal_prompts: deterministic.animal_prompts || [],
    animal_actions: deterministic.animal_actions || [],
  };
  if (contract === 'scenes') return {
    ...common,
    scene_prompts: deterministic.scene_prompts || [],
    shot_breakdown: deterministic.shot_breakdown || [],
  };
  return {
    ...common,
    subtitle_cta: deterministic.subtitle_cta || {},
  };
}

function buildRepairPrompts({ contract = '', deterministic = {}, acceptedDraft = {} } = {}) {
  if (!CONTRACT_ORDER.includes(contract)) throw new Error(`未知参考语义合同：${contract}`);
  const label = CONTRACT_LABELS[contract];
  return {
    systemPrompt: [
      `你是参考视频“${label}”合同修复员，只能输出当前合同拥有的字段。`,
      '所有事实必须引用输入中已有 F### 或 T### 证据；证据不足时明确写 unknown，不得新增人物、动物、商品、场景或因果。',
      '合同适用于任意行业、商品、服务、空间和叙事形式，禁止按行业关键词套用模板。',
      '只返回一个 JSON 对象，不要 markdown、解释、前后缀或注释。',
    ].join('\n'),
    userPrompt: [
      `当前合同：${contract}（${label}）`,
      `合同 JSON Schema：${JSON.stringify(semanticSchema(contract))}`,
      `当前合同证据：${JSON.stringify(contractEvidence(contract, deterministic))}`,
      `已通过且禁止改写的其他合同：${JSON.stringify(acceptedDraft || {})}`,
    ].join('\n'),
    structuredOutput: structuredOutput(contract),
  };
}

module.exports = {
  CONTRACT_ORDER,
  CONTRACT_LABELS,
  semanticSchema,
  structuredOutput,
  contractEvidence,
  buildRepairPrompts,
};
