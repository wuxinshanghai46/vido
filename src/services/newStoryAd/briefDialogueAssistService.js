const jsonRepair = require('./jsonRepairService');

const MODES = new Set(['brief_dialogue', 'dialogue_intake']);
const NEXT_STEPS = new Set(['idea_details', 'specifications', 'reference', 'review']);
const COVERAGE_TOPICS = ['subject', 'structure', 'audience_intent', 'world_context', 'visual_direction'];
const COVERAGE_LABELS = { subject: '人物/主体', structure: '叙事或价值演示链', audience_intent: '受众与表达目标', world_context: '世界时空', visual_direction: '视觉制作方向' };

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
    '你是 VIDO 剧情广告模块的资深导演与制片策划，负责用自然、专业、具体的中文完成对话式立项。只输出 JSON 对象，不要 markdown。',
    '不要机械复述整段原话，不要使用“针对【原始创作需求】”“核心已经成立”“已整理到确认单”等模板话术。先指出你真正理解到的创作选择或矛盾，再问能改变剧本或制作方案的具体问题。',
    '每轮只处理最相关的 1 至 2 个缺口，但进入成片规格前必须覆盖五类制作依据：subject（主要人物/关系或产品主体）、structure（开端触发、发展冲突、高潮/结局，或广告价值演示链）、audience_intent（目标观众及希望留下的情绪/认知/行动）、world_context（足够执行的时代、地区、社会环境或明确架空规则）、visual_direction（真人/动画等媒介、写实度、美学气质或用户明确委托导演建议）。',
    '“古代”“现代”“好看”“电影感”这类宽泛词不能单独算 world_context 或 visual_direction 已明确；应结合用户内容给出 2 至 3 个专业选项帮助选择。用户说“由你建议/你来定”时，先给出具体建议并请用户确认，确认后才能标为 explicit。',
    'coverage 的每个 evidence 必须是从当前累计设想中原样摘取的短语，不能改写或编造。未明确的项 status 必须为 missing。只有五类均为 explicit，idea_ready 才能为 true；否则必须继续 idea_details。',
    '用户一次已经讲完整时不得重复询问已经有直接证据的内容；五类均明确后 next_step 才进入 specifications。时长、画幅和清晰度必须作为一组简洁确认，不能把系统默认值说成用户已经确认。',
    '规格确认后 next_step 才能进入 reference。参考提问必须结合当前剧情或商业内容说明可能有价值的参考类型；参考材料不是必填项，但必须由用户明确选择提供或不提供。',
    '不得编造用户没有说过的人物、品牌、产品功效、价格、时代、地点或结局；不得引用旧任务、知识库案例或其它用户内容。',
    '回复控制在 45 至 260 个中文字符，像真正参与创作的导演与制片策划，不说空泛鼓励，不用官样确认语。',
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
    `成片规格确认状态：${body.specifications_confirmed === true ? '用户已确认' : '尚未确认；当前值只能视为建议'}`,
    `最近对话：${JSON.stringify(history)}`,
    '请重新审计五类制作依据，不要继承上一轮未经用户证据支持的判断，并输出：',
    '{"reply":"专业、具体的回应和下一问","coverage":{"subject":{"status":"explicit|missing","evidence":"用户原文短语或空"},"structure":{"status":"explicit|missing","evidence":"用户原文短语或空"},"audience_intent":{"status":"explicit|missing","evidence":"用户原文短语或空"},"world_context":{"status":"explicit|missing","evidence":"用户原文短语或空"},"visual_direction":{"status":"explicit|missing","evidence":"用户原文短语或空"}},"idea_ready":false,"missing_topics":["最优先缺口","次优先缺口"],"next_step":"idea_details"}',
    'next_step 只能是 idea_details、specifications、reference、review。五类 coverage 未全部 explicit 时 idea_ready 必须为 false；missing_topics 列出本轮实际追问的 1 至 2 项。',
  ].join('\n');
}

function normalizeCoverage(parsed = {}, accumulatedIdea = '') {
  const source = cleanText(accumulatedIdea, 4000);
  const raw = parsed.coverage && typeof parsed.coverage === 'object' ? parsed.coverage : {};
  return Object.fromEntries(COVERAGE_TOPICS.map(topic => {
    const item = raw[topic] && typeof raw[topic] === 'object' ? raw[topic] : {};
    const evidence = cleanInline(item.evidence, 120);
    const tooGeneric = topic === 'world_context'
      ? /^(?:古代|现代|当代|未来|架空|古代故事|现代故事|未来世界)$/u.test(evidence)
      : (topic === 'visual_direction' && /^(?:好看|高级|唯美|写实|电影感|动画|真人)$/u.test(evidence));
    const explicit = item.status === 'explicit' && evidence.length >= 2 && source.includes(evidence) && !tooGeneric;
    return [topic, { status: explicit ? 'explicit' : 'missing', evidence: explicit ? evidence : '' }];
  }));
}

function normalizeParsed(parsed = {}, accumulatedIdea = '') {
  let reply = cleanText(parsed.reply || parsed.dialogue_reply || parsed.message || '', 300);
  const coverage = normalizeCoverage(parsed, accumulatedIdea);
  const coverageReady = COVERAGE_TOPICS.every(topic => coverage[topic].status === 'explicit');
  const ideaReady = parsed.idea_ready === true && coverageReady;
  let missingTopics = (Array.isArray(parsed.missing_topics) ? parsed.missing_topics : [])
    .map(item => cleanInline(item, 80)).filter(Boolean).slice(0, 2);
  let nextStep = cleanInline(parsed.next_step, 40);
  if (!NEXT_STEPS.has(nextStep)) nextStep = ideaReady ? 'specifications' : 'idea_details';
  if (!ideaReady) {
    nextStep = 'idea_details';
    if (!missingTopics.length) missingTopics = COVERAGE_TOPICS.filter(topic => coverage[topic].status !== 'explicit').slice(0, 2).map(topic => COVERAGE_LABELS[topic]);
    if (parsed.idea_ready === true && !coverageReady) reply = `现有回答还不能形成可核验的完整立项依据，不能直接进入规格确认。请继续明确${missingTopics.join('和')}，我会以你的原话作为确认依据。`;
  }
  return { reply, idea_ready: ideaReady, missing_topics: missingTopics, next_step: nextStep, coverage };
}

function validateRaw(raw = '') {
  try {
    const parsed = jsonRepair.parseJson(raw, 'object');
    const evidenceSource = COVERAGE_TOPICS.map(topic => cleanInline(parsed?.coverage?.[topic]?.evidence, 120)).filter(Boolean).join(' ');
    const value = normalizeParsed(parsed, evidenceSource);
    return value.reply.length >= 12
      && value.reply.length <= 300
      && NEXT_STEPS.has(value.next_step)
      && (value.idea_ready || value.missing_topics.length > 0);
  } catch {
    return false;
  }
}

function buildResponse({ parsed = {}, modelResult = {}, body = {} } = {}) {
  const value = normalizeParsed(parsed, body.accumulated_idea || body.brief || '');
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
    coverage: value.coverage,
    model_meta: {
      used_model: modelResult.used_model,
      fallback_used: modelResult.fallback_used,
      failed_models: modelResult.failed_models,
    },
  };
}

async function run({ body = {}, modelGateway, taskId = '' } = {}) {
  assertInput(body);
  const result = await modelGateway.generateText({
    taskId,
    stage: 'new_story_ad.assist',
    systemPrompt: systemPrompt(),
    userPrompt: userPrompt(body),
    maxTokens: 420,
    validateText: validateRaw,
  });
  const parsed = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'object',
    modelGateway,
    taskId,
    stage: 'new_story_ad.json_repair',
  });
  return buildResponse({ parsed, modelResult: result, body });
}

module.exports = {
  isMode,
  run,
  assertInput,
  systemPrompt,
  userPrompt,
  validateRaw,
  buildResponse,
  normalizeParsed,
  normalizeCoverage,
  COVERAGE_TOPICS,
};
