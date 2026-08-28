const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');

const VISIBLE_KEYS = new Set([
  'story_title', 'title', 'logline', 'synopsis', 'name', 'role', 'description', 'profile',
  'plot', 'scene', 'story_visual', 'promo_visual', 'emotional_turn', 'selling_point',
  'visual_proof', 'action', 'spoken_line', 'why_next', 'purpose', 'visual', 'voiceover',
  'line', 'material_usage', 'keyframe_notes', 'scene_name', 'scene_zone', 'scene_zone_label_zh',
  'transition_reason', 'entry_frame_state', 'exit_frame_state', 'action_start', 'action_end',
  'screen_direction', 'eyeline', 'camera_axis', 'camera_movement', 'object_states', 'audio_bridge',
  'composition', 'subject_position', 'ambient_sound', 'sfx', 'music_cue', 'voiceover_timing',
  'label', 'gaze', 'eyelids', 'brows', 'mouth', 'jaw', 'head_pose', 'gesture', 'onset',
  'motif', 'source_object', 'outgoing_end_state', 'incoming_start_state', 'motion_direction',
  'generation_prompt', 'verification_evidence', 'deterministic_fallback', 'prohibited',
  'content', 'space_anchor', 'fixed_subjects', 'continuity_rules',
  'business_boundary', 'advertised_subject', 'story_strategy', 'forbidden', 'usage',
  'setup', 'trigger', 'progression', 'result', 'state_before', 'state_after',
  'intended_changes', 'intended_change', 'visible_evidence', 'evidence_requirements',
]);

function normalizeVisibleTextPolicy(context = {}) {
  const raw = context.visible_text_policy || context.visibleTextPolicy || {};
  const language = typeof raw === 'string'
    ? raw
    : String(raw.language || raw.mode || '').trim().toLowerCase();
  const strictChineseOnly = language === 'zh_only'
    || language === 'chinese_only'
    || context.strict_chinese_only === true
    || context.strictChineseOnly === true;
  return {
    strict_chinese_only: strictChineseOnly,
    forbid_question_marks: strictChineseOnly
      || raw.forbid_question_marks === true
      || raw.forbidQuestionMarks === true,
    forbid_replacement_character: strictChineseOnly
      || raw.forbid_replacement_character === true
      || raw.forbidReplacementCharacter === true,
  };
}

function collectVisibleStrings(value, key = '', out = []) {
  if (typeof value === 'string') {
    if (VISIBLE_KEYS.has(key) && value.trim()) out.push(value.trim());
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectVisibleStrings(item, key, out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([childKey, child]) => collectVisibleStrings(child, childKey, out));
  }
  return out;
}

function assessChineseContent(payload, policy = {}) {
  const strings = collectVisibleStrings(payload);
  const text = strings.join(' ');
  const chineseCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  const latinWords = (text.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
  const chineseRatio = chineseCount / Math.max(1, chineseCount + latinCount);
  const strictChineseOnly = policy.strict_chinese_only === true;
  const forbiddenGlyphCount = (text.match(/[?？�]/gu) || []).length;
  const needsRepair = strictChineseOnly
    ? latinCount > 0 || forbiddenGlyphCount > 0
    : latinWords >= 8 && (chineseCount < 6 || chineseRatio < 0.12);
  return {
    needsRepair,
    strings: strings.length,
    chinese_count: chineseCount,
    latin_count: latinCount,
    latin_words: latinWords,
    chinese_ratio: chineseRatio,
    forbidden_glyph_count: forbiddenGlyphCount,
    strict_chinese_only: strictChineseOnly,
  };
}

function mergeVisibleStrings(original, translated, key = '') {
  if (typeof original === 'string') {
    if (!VISIBLE_KEYS.has(key)) return original;
    const candidate = typeof translated === 'string' ? translated.trim() : '';
    return candidate || original;
  }
  if (Array.isArray(original)) {
    const candidate = Array.isArray(translated) ? translated : [];
    return original.map((item, index) => mergeVisibleStrings(item, candidate[index], key));
  }
  if (original && typeof original === 'object') {
    const candidate = translated && typeof translated === 'object' && !Array.isArray(translated) ? translated : {};
    return Object.fromEntries(Object.entries(original).map(([childKey, child]) => [
      childKey,
      mergeVisibleStrings(child, candidate[childKey], childKey),
    ]));
  }
  return original;
}

async function ensureChineseOutput({ payload, kind, taskId = '', context = {}, gateway = modelGateway, repair = jsonRepair } = {}) {
  const policy = normalizeVisibleTextPolicy(context);
  const before = assessChineseContent(payload, policy);
  if (!before.needsRepair) return { payload, repaired: false, assessment: before, model_meta: null };

  const expected = Array.isArray(payload) ? 'array' : 'object';
  const stage = kind === 'storyboard'
    ? 'new_story_ad.storyboard_language_repair'
    : (kind === 'scene_config'
      ? 'new_story_ad.scene_config_language_repair'
      : 'new_story_ad.blueprint_language_repair');
  const result = await gateway.generateText({
    taskId,
    stage,
    systemPrompt: [
      '你是剧情广告用户可见文案的中文校正器。只返回严格 JSON，不要 Markdown。',
      '将所有面向用户展示的标题、故事主线、人物姓名与说明、画面、动作、台词/旁白、目的/补充、场景和转场说明转换为自然、专业的简体中文。',
      '品牌名、产品名、API、UI、Token 等必要专有名词可以保留原文，但完整句子必须使用简体中文。',
      '不得改变 JSON 键名、数组长度、镜头顺序、数字、时长、ID、枚举值、场景绑定、镜头绑定和技术参数。',
      'scene_zone_label_zh 和 scene_zone 必须使用简体中文；scene_zone_id、zone_ids、anchor_ids 是稳定机器标识，绝对不得翻译或改写。',
      '不得新增、删除、合并或改写剧情事实；只校正显示语言。',
      policy.strict_chinese_only
        ? '本任务采用纯中文显示策略。所有用户可见文字必须改为自然简体中文，不得保留任何英文字母，不得出现半角问号、全角问号或替换字符。品牌英文名也要使用用户给出的中文名称。'
        : '',
    ].join('\n'),
    userPrompt: `任务中文上下文：${JSON.stringify({ brief: context.brief || '', product_subject: context.product_subject || '', characters: context.characters || [] }).slice(0, 5000)}\n\n待校正 JSON：${JSON.stringify(payload)}`,
    maxTokens: kind === 'storyboard' ? 9000 : 7500,
    temperature: 0.1,
  });
  const parsed = await repair.parseOrRepair({ raw: result.text, expected, modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
  const merged = mergeVisibleStrings(payload, parsed);
  const after = assessChineseContent(merged, policy);
  if (after.needsRepair) {
    const error = new Error(`${kind || '剧情广告'}的用户可见内容未通过中文输出校验，已停止保存违规结果`);
    error.code = 'OUTPUT_LANGUAGE_INVALID';
    error.retryable = false;
    error.language_diagnostics = { before, after };
    throw error;
  }
  return {
    payload: merged,
    repaired: true,
    assessment: after,
    model_meta: { used_model: result.used_model, fallback_used: result.fallback_used, failed_models: result.failed_models || [] },
  };
}

module.exports = {
  assessChineseContent,
  collectVisibleStrings,
  mergeVisibleStrings,
  ensureChineseOutput,
  normalizeVisibleTextPolicy,
};
