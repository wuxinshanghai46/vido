const jsonRepair = require('./jsonRepairService');

const MODES = new Set(['brief_dialogue', 'dialogue_intake']);
const NEXT_STEPS = new Set(['idea_details', 'reference', 'review']);

function cleanText(value = '', max = 1600) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function cleanInline(value = '', max = 240) {
  return cleanText(value, max).replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ');
}

function isMode(mode = '') { return MODES.has(String(mode || '').trim()); }

function assertInput(body = {}) {
  if (cleanText(body.user_message || body.message || '', 1600)) return;
  const error = new Error('请先输入你想制作的内容；没有调用文本模型');
  error.code = 'BRIEF_DIALOGUE_MESSAGE_EMPTY';
  error.status = 400;
  throw error;
}

function modeLabel(mode = '') {
  return mode === 'commercial_subject' ? '商业广告' : (mode === 'narrative_story' ? '剧情短片' : '尚未确认');
}

function systemPrompt() {
  return [
    '你是 VIDO 剧情广告模块的导演助理，负责用自然中文完成对话式立项。只输出 JSON 对象，不要 markdown。',
    '每次必须直接回应用户刚刚说的具体内容，先用一句话准确复述你理解到的人物、事件、产品价值或情绪目标，再根据当前立项流程只追问最关键的 1 至 2 个缺口。',
    '剧情短片成立至少需要：主要人物或主体、关键事件或变化、希望观众感受到的情绪或主题。商业广告成立至少需要：产品或服务、要证明的价值、目标观众或使用情境、希望观众记住或采取的行动。',
    '用户一次已经讲完整时不得重复盘问，next_step 应进入 reference，并自然询问是否有参考视频、图片或链接；参考材料不是必填项。',
    '时长、画幅、清晰度、时代地区、视觉形态和制作方式属于可选精调项。除非用户主动提到或它们会造成明显冲突，否则不要逐项询问，也不要把系统默认值说成用户已经确认。',
    '不得编造用户没有说过的人物、品牌、产品功效、价格、时代、地点或结局；不得引用旧任务、知识库案例或其它用户内容。',
    '回复控制在 40 至 220 个中文字符，像真实创作伙伴交流，不要说“已整理到确认单”之类机械模板。',
  ].join('\n');
}

function userPrompt(body = {}) {
  const history = Array.isArray(body.history) ? body.history.slice(-8).map(item => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: cleanText(item?.content, 600),
  })).filter(item => item.content) : [];
  return [
    `当前内容类型：${modeLabel(cleanInline(body.content_mode, 40))}`,
    `当前累计设想：${cleanText(body.accumulated_idea || body.brief || '', 2400) || '空'}`,
    `用户刚刚发送：${cleanText(body.user_message || body.message || '', 1600)}`,
    `参考材料状态：${body.reference_attached === true ? '已上传' : (body.reference_skipped === true ? '用户明确无参考' : '尚未决定')}`,
    `最近对话：${JSON.stringify(history)}`,
    '请判断核心设想是否已经足以进入参考材料确认，并输出：',
    '{"reply":"结合用户原话的自然回应与下一问","idea_ready":true,"missing_topics":[],"next_step":"reference"}',
    'next_step 只能是 idea_details、reference、review。idea_ready=false 时 missing_topics 必须列出 1 至 2 个具体缺口；已经有充分信息时 idea_ready=true。',
  ].join('\n');
}

function normalizeParsed(parsed = {}) {
  const reply = cleanText(parsed.reply || parsed.dialogue_reply || parsed.message || '', 300);
  const ideaReady = parsed.idea_ready === true;
  const missingTopics = (Array.isArray(parsed.missing_topics) ? parsed.missing_topics : [])
    .map(item => cleanInline(item, 80)).filter(Boolean).slice(0, 2);
  let nextStep = cleanInline(parsed.next_step, 40);
  if (!NEXT_STEPS.has(nextStep)) nextStep = ideaReady ? 'reference' : 'idea_details';
  return { reply, idea_ready: ideaReady, missing_topics: missingTopics, next_step: nextStep };
}

function validateRaw(raw = '') {
  try {
    const value = normalizeParsed(jsonRepair.parseJson(raw, 'object'));
    return value.reply.length >= 12
      && value.reply.length <= 300
      && NEXT_STEPS.has(value.next_step)
      && (value.idea_ready || value.missing_topics.length > 0);
  } catch {
    return false;
  }
}

function buildResponse({ parsed = {}, modelResult = {} } = {}) {
  const value = normalizeParsed(parsed);
  if (!value.reply || (!value.idea_ready && !value.missing_topics.length)) {
    const error = new Error('导演助理没有返回可用的下一问，请保留当前输入后重试');
    error.code = 'BRIEF_DIALOGUE_REPLY_INCOMPLETE';
    error.status = 422;
    error.retryable = true;
    throw error;
  }
  return {
    dialogue_reply: value.reply,
    idea_ready: value.idea_ready,
    missing_topics: value.missing_topics,
    next_step: value.next_step,
    model_meta: {
      used_model: modelResult.used_model,
      fallback_used: modelResult.fallback_used,
      failed_models: modelResult.failed_models,
    },
  };
}

module.exports = {
  isMode,
  assertInput,
  systemPrompt,
  userPrompt,
  validateRaw,
  buildResponse,
  normalizeParsed,
};
