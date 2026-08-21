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

function impliedDecisionGap(accumulatedIdea = '') {
  const source = cleanText(accumulatedIdea, 4000);
  const crossesEras = /(?:跨越|穿越|相隔)[^，。；\n]{0,12}(?:百年|千年|时代)|古代[^，。；\n]{0,80}(?:现代|当代)|(?:现代|当代)[^，。；\n]{0,80}古代/u.test(source);
  const continuityAnswered = /(?:容貌|外貌|年龄|老去|不老|衰老|少年|青年|中年|老年|转世|轮回|同一张脸|身份变化|气质变化|服装变化|古今相似)/u.test(source);
  if (crossesEras && !continuityAnswered) return {
    topic: '跨时代人物连续性',
    reply: '这个故事跨越了不同年代，人物如何被观众一眼认出会直接影响选角、造型和情感连续性。你希望人物从古代到现代怎样变化？',
    answers: ['容貌基本不变，只改变服装与气质', '保留相似五官，年龄与身份明显变化', '通过转世延续特征，但成为不同的人'],
  };
  return null;
}

function systemPrompt() {
  return [
    '你是 VIDO 剧情广告模块的资深导演与制片策划，负责用自然、专业、具体的中文完成对话式立项。只输出 JSON 对象，不要 markdown。',
    '不要机械复述整段原话，不要使用“针对【原始创作需求】”“核心已经成立”“已整理到确认单”等模板话术。先指出你真正理解到的创作选择或矛盾，再问能改变剧本或制作方案的具体问题。',
    '每轮只追问 1 个当前最影响创作与制作的缺口；不要向用户罗列检查项或宣布后续流程。进入成片规格前必须覆盖五类制作依据：subject（主要人物/关系或产品主体）、structure（开端触发、发展冲突、高潮/结局，或广告价值演示链）、audience_intent（目标观众及希望留下的情绪/认知/行动）、world_context（足够执行的时代、地区、社会环境或明确架空规则）、visual_direction（真人/动画等媒介、写实度、美学气质或用户明确委托导演建议）。',
    '“古代”“现代”“好看”“电影感”这类宽泛词不能单独算 world_context 或 visual_direction 已明确；应结合用户内容给出 2 至 3 个专业选项帮助选择。用户说“由你建议/你来定”时，先给出具体建议并请用户确认，确认后才能标为 explicit。',
    'coverage 的每个 evidence 必须是从当前累计设想中原样摘取的短语，不能改写或编造。未明确的项 status 必须为 missing。只有五类均为 explicit，idea_ready 才能为 true；否则必须继续 idea_details。',
    '用户一次已经讲完整时不得重复询问已经有直接证据的内容；五类均明确后 next_step 才进入 specifications。时长、画幅和清晰度必须作为一组简洁确认，不能把系统默认值说成用户已经确认。',
    '规格确认后 next_step 才能进入 reference。参考提问必须结合当前剧情或商业内容说明可能有价值的参考类型；参考材料不是必填项，但必须由用户明确选择提供或不提供。',
    '不得编造用户没有说过的人物、品牌、产品功效、价格、时代、地点或结局；不得引用旧任务、知识库案例或其它用户内容。',
    'reply 控制在 45 至 220 个中文字符：先用一句话说出你理解到的具体创作重点，再自然地提出这轮唯一一个问题。不能回复“还要核对若干项”“缺少的内容会逐项询问”之类系统说明。',
    '未完成创意确认时，同时给出 2 至 3 个 suggested_answers。它们必须是贴合当前内容、可由用户直接选用的真实答案，不得是“继续补充”“都可以”“其他”等空标签；每个不超过 36 个中文字符。问题与选项应帮助没有影视专业知识的用户表达，而不是考用户。',
    '你必须主动发现并追问内容本身隐含的制作决策，不能等用户反问才意识到。例如跨越古今、穿越或轮回的故事，要主动确认人物年龄、身份、容貌和造型如何连续；多主角要确认关系与视角；商业内容要确认可见的价值证据。只要这类关键决策仍悬空，idea_ready 必须为 false。',
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
    '{"reply":"先回应具体内容，再提出唯一一个下一问","suggested_answers":["贴合当前内容的答案一","贴合当前内容的答案二","贴合当前内容的答案三"],"coverage":{"subject":{"status":"explicit|missing","evidence":"用户原文短语或空"},"structure":{"status":"explicit|missing","evidence":"用户原文短语或空"},"audience_intent":{"status":"explicit|missing","evidence":"用户原文短语或空"},"world_context":{"status":"explicit|missing","evidence":"用户原文短语或空"},"visual_direction":{"status":"explicit|missing","evidence":"用户原文短语或空"}},"idea_ready":false,"missing_topics":["本轮唯一追问的缺口"],"next_step":"idea_details"}',
    'next_step 只能是 idea_details、specifications、reference、review。五类 coverage 未全部 explicit 时 idea_ready 必须为 false，missing_topics 只能列出本轮唯一追问的一项，并必须返回 2 至 3 个 suggested_answers；进入 specifications 后 suggested_answers 可以为空数组。',
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
  const impliedGap = impliedDecisionGap(accumulatedIdea);
  let ideaReady = parsed.idea_ready === true && coverageReady && !impliedGap;
  let missingTopics = (Array.isArray(parsed.missing_topics) ? parsed.missing_topics : [])
    .map(item => cleanInline(item, 80)).filter(Boolean).slice(0, 1);
  let suggestedAnswers = (Array.isArray(parsed.suggested_answers) ? parsed.suggested_answers : [])
    .map(item => cleanInline(item, 48)).filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .slice(0, 3);
  let nextStep = cleanInline(parsed.next_step, 40);
  if (!NEXT_STEPS.has(nextStep)) nextStep = ideaReady ? 'specifications' : 'idea_details';
  if (!ideaReady) {
    nextStep = 'idea_details';
    if (impliedGap) {
      missingTopics = [impliedGap.topic];
      reply = impliedGap.reply;
      suggestedAnswers = impliedGap.answers;
    } else if (!missingTopics.length) missingTopics = COVERAGE_TOPICS.filter(topic => coverage[topic].status !== 'explicit').slice(0, 1).map(topic => COVERAGE_LABELS[topic]);
    if (!impliedGap && parsed.idea_ready === true && !coverageReady) reply = `现有回答还不能形成可核验的完整立项依据，不能直接进入规格确认。请继续明确${missingTopics.join('和')}，我会以你的原话作为确认依据。`;
  } else suggestedAnswers = [];
  return { reply, idea_ready: ideaReady, missing_topics: missingTopics, suggested_answers: suggestedAnswers, next_step: nextStep, coverage };
}

function validateRaw(raw = '') {
  try {
    const parsed = jsonRepair.parseJson(raw, 'object');
    const evidenceSource = COVERAGE_TOPICS.map(topic => cleanInline(parsed?.coverage?.[topic]?.evidence, 120)).filter(Boolean).join(' ');
    const value = normalizeParsed(parsed, evidenceSource);
    return value.reply.length >= 12
      && value.reply.length <= 300
      && NEXT_STEPS.has(value.next_step)
      && (value.idea_ready || (value.missing_topics.length === 1 && value.suggested_answers.length >= 2));
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
  const nextStep = value.idea_ready
    ? (body.specifications_confirmed !== true ? 'specifications'
      : (!body.reference_attached && !body.reference_skipped ? 'reference' : 'review'))
    : 'idea_details';
  return {
    dialogue_reply: value.reply,
    idea_ready: value.idea_ready,
    missing_topics: value.missing_topics,
    suggested_answers: value.suggested_answers,
    next_step: nextStep,
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
  const accumulatedIdea = body.accumulated_idea || body.brief || '';
  const immediateGap = impliedDecisionGap(accumulatedIdea);
  if (immediateGap) return {
    dialogue_reply: immediateGap.reply,
    idea_ready: false,
    missing_topics: [immediateGap.topic],
    suggested_answers: immediateGap.answers,
    next_step: 'idea_details',
    coverage: normalizeCoverage({}, accumulatedIdea),
    model_meta: { used_model: null, fallback_used: false, failed_models: [], deterministic: true },
  };
  const result = await modelGateway.generateText({
    taskId,
    stage: 'new_story_ad.brief_dialogue',
    systemPrompt: systemPrompt(),
    userPrompt: userPrompt(body),
    maxTokens: 420,
    maxCandidates: 2,
    timeoutMs: 8000,
    stageBudgetMs: 12000,
    structuredOutput: { mode: 'json_object' },
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
  impliedDecisionGap,
  COVERAGE_TOPICS,
};
