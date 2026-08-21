const jsonRepair = require('./jsonRepairService');
const knowledgeBase = require('../knowledgeBaseService');

const MODES = new Set(['brief_dialogue', 'dialogue_intake']);
const NEXT_STEPS = new Set(['idea_details', 'specifications', 'reference', 'review']);
const COVERAGE_TOPICS = ['subject', 'structure', 'audience_intent', 'world_context', 'visual_direction'];
const COVERAGE_LABELS = { subject: '人物/主体', structure: '叙事或价值演示链', audience_intent: '受众与表达目标', world_context: '世界时空', visual_direction: '视觉制作方向' };
const DIALOGUE_TOPICS = new Set([
  'subject_identity', 'subject_relationship', 'subject_motivation', 'opposition',
  'plot_trigger', 'plot_development', 'climax_ending', 'audience_intent',
  'world_era', 'world_region_rules', 'character_continuity', 'visual_medium',
  'visual_tone', 'commercial_evidence',
]);
const TOPIC_ORDER = [...DIALOGUE_TOPICS];
const TOPIC_HINTS = [
  ['opposition', /反派|对手|阻碍|敌人/u], ['subject_relationship', /关系|相识|相遇|彼此|两人/u],
  ['subject_motivation', /动机|为什么|想要|目的|渴望/u], ['plot_trigger', /开端|触发|卷入|第一次出手|导火索/u],
  ['plot_development', /发展|升级|中段|推进/u], ['climax_ending', /高潮|结局|最后|收束/u],
  ['audience_intent', /观众|受众|看完|感受|行动/u], ['world_era', /时代|年代|古代|现代/u],
  ['world_region_rules', /地点|地区|世界|规则|城市|朝代/u], ['character_continuity', /容貌|年龄|造型|连续|转世/u],
  ['visual_medium', /真人|动画|媒介|实拍/u], ['visual_tone', /视觉|质感|风格|气质|美学/u],
  ['commercial_evidence', /卖点|价值|证据|产品|功效/u], ['subject_identity', /人物|主角|主体|身份/u],
];
const TOPIC_QUESTIONS = {
  subject_identity: ['古代女主和现代男主分别是什么身份？', ['守护秘宝的家族传人和文物修复师', '被追杀的女侠和历史研究者', '古代医女和现代急诊医生']],
  subject_relationship: ['他们第一次相遇时，是什么关系？', ['原本陌生，因为秘宝相识', '彼此利用，后来产生感情', '两家有旧怨，一开始互相敌视']],
  subject_motivation: ['他们各自最想得到或守住什么？', ['女主守住秘宝，男主查清身世', '两人都想阻止反派改变历史', '女主想回家，男主想让她留下']],
  opposition: ['那个权贵为什么一定要抢到秘宝？', ['想借秘宝夺取皇位', '想用秘宝让自己长生', '想掩盖与女主家族有关的旧案']],
  plot_trigger: ['反派第一次出手时，做了什么让男女主卷入争夺？', ['嫁祸男主，逼他逃亡追查', '抓走女主亲人，逼她交出秘宝', '借朝廷之手灭门，强夺秘宝']],
  plot_development: ['冲突升级后，两人的关系怎么变化？', ['一起追查，感情逐渐加深', '互相隐瞒，信任彻底破裂', '先分开，再因为真相重新联手']],
  climax_ending: ['最后一场对决中，他们得到什么，又失去什么？', ['守住彼此，但秘宝永远消失', '打败反派，却被迫相隔千年', '放弃秘宝，换来家人与爱人的自由']],
  audience_intent: ['你希望观众看完后最强烈的感受是什么？', ['为跨越千年的爱情感动', '思考命运和自己的选择', '感到复仇结束后的释然']],
  world_era: ['古代部分发生在哪个朝代或年代？', ['参考唐代的繁华城市', '参考明代的江湖与朝堂', '不对应真实朝代的架空古代']],
  world_region_rules: ['故事主要发生在哪里？穿越需要遵守什么规则？', ['古城与现代博物馆，秘宝触发穿越', '江湖门派与现代城市，月圆时穿越', '架空王朝与现代小镇，只能穿越一次']],
  character_continuity: ['到了现代后，人物的长相和年龄怎么变化？', ['长相不变，只改变服装和气质', '五官相似，但年龄和身份改变', '转世为另一个人，保留明显特征']],
  visual_medium: ['你希望用哪种方式来拍？', ['真人拍摄', '二维动画', '三维动画']],
  visual_tone: ['你希望画面看起来更接近哪一种？', ['像真实电影一样自然', '画面柔美，有古风意境', '场面宏大，像传奇故事']],
  commercial_evidence: ['观众从哪个画面能直接看出产品的好处？', ['使用前后效果对比', '真实使用过程和结果', '用户当场体验后的反应']],
};

function cleanText(value = '', max = 1600) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function cleanInline(value = '', max = 240) {
  return cleanText(value, max).replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ');
}

function isMode(mode = '') { return MODES.has(String(mode || '').trim()); }

function cleanTopics(value = []) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => cleanInline(item, 40)).filter(item => DIALOGUE_TOPICS.has(item)))].slice(0, DIALOGUE_TOPICS.size);
}

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

function impliedDecisionGap(accumulatedIdea = '', completedTopics) {
  const source = cleanText(accumulatedIdea, 4000);
  if (Array.isArray(completedTopics)) {
    const completed = new Set(cleanTopics(completedTopics));
    const earlierTopics = TOPIC_ORDER.slice(0, TOPIC_ORDER.indexOf('character_continuity'));
    if (!earlierTopics.every(topic => completed.has(topic))) return null;
  }
  const crossesEras = /(?:跨越|穿越|相隔)[^，。；\n]{0,12}(?:百年|千年|时代)|古代[^，。；\n]{0,80}(?:现代|当代)|(?:现代|当代)[^，。；\n]{0,80}古代/u.test(source);
  const continuityAnswered = /(?:容貌|外貌|年龄|老去|不老|衰老|少年|青年|中年|老年|转世|轮回|同一张脸|身份变化|气质变化|服装变化|古今相似)/u.test(source);
  if (crossesEras && !continuityAnswered) return {
    topic: '跨时代人物连续性',
    question_topic: 'character_continuity',
    reply: TOPIC_QUESTIONS.character_continuity[0],
    answers: TOPIC_QUESTIONS.character_continuity[1],
  };
  return null;
}

function systemPrompt(dynamicKnowledge = '') {
  const lines = [
    '你是 VIDO 剧情广告模块的资深导演与制片策划，负责用自然、专业、具体的中文完成对话式立项。只输出 JSON 对象，不要 markdown。',
    '不要复述、确认或总结用户刚刚回答的内容，不要说“我记下了”“我理解了”“这部分已经清楚”“接下来”。直接提出当前唯一一个问题；只有问题本身不易理解时，才允许加一句很短的通俗说明。',
    '每轮只追问 1 个当前最影响创作与制作的缺口；不要向用户罗列检查项或宣布后续流程。进入成片规格前必须覆盖五类制作依据：subject（主要人物/关系或产品主体）、structure（开端触发、发展冲突、高潮/结局，或广告价值演示链）、audience_intent（目标观众及希望留下的情绪/认知/行动）、world_context（足够执行的时代、地区、社会环境或明确架空规则）、visual_direction（真人/动画等媒介、写实度、美学气质或用户明确委托导演建议）。',
    '问询顺序必须连贯：先理清人物/主体、关系、动机与对立，再理清触发、发展和结局，然后确认受众与表达目标，再确认时空规则和跨时代连续性，最后确认视觉媒介与气质。用户原话已明确的部分直接跳过，只问该顺序中最早的真实缺口，不能在不同层级之间来回跳。',
    '“古代”“现代”“好看”“电影感”这类宽泛词不能单独算 world_context 或 visual_direction 已明确；应结合用户内容给出 2 至 3 个专业选项帮助选择。用户说“由你建议/你来定”时，先给出具体建议并请用户确认，确认后才能标为 explicit。',
    'coverage 的每个 evidence 必须是从当前累计设想中原样摘取的短语，不能改写或编造。未明确的项 status 必须为 missing。只有五类均为 explicit，idea_ready 才能为 true；否则必须继续 idea_details。',
    '用户一次已经讲完整时不得重复询问已经有直接证据的内容；completed_topics 中的决策已经回答，禁止换一种说法再次询问。五类均明确后 next_step 才进入 specifications。时长、画幅和清晰度必须作为一组简洁确认，不能把系统默认值说成用户已经确认。',
    '规格确认后 next_step 才能进入 reference。参考提问必须结合当前剧情或商业内容说明可能有价值的参考类型；参考材料不是必填项，但必须由用户明确选择提供或不提供。',
    '不得编造用户没有说过的人物、品牌、产品功效、价格、时代、地点或结局；不得引用旧任务、知识库案例或其它用户内容。',
    'reply 控制在 12 至 100 个中文字符，只说用户需要回答的问题。不要解释系统为什么要问，不要展示审核、证据、覆盖率、流程或内部判断；不要使用“真实克制”“东方诗意”“宏大传奇”等专业概括，要换成普通用户一看就懂的话。',
    '未完成创意确认时，同时给出 2 至 3 个 suggested_answers。它们必须是贴合当前内容、可由用户直接选用的真实答案，不得是“继续补充”“都可以”“其他”等空标签；每个不超过 36 个中文字符。一个选项只表达当前问题的一种选择，不要在媒介名称后用逗号追加第二层风格评价。问题与选项应帮助没有影视专业知识的用户表达，而不是考用户。',
    '你必须主动发现并追问内容本身隐含的制作决策，不能等用户反问才意识到。例如跨越古今、穿越或轮回的故事，要主动确认人物年龄、身份、容貌和造型如何连续；多主角要确认关系与视角；商业内容要确认可见的价值证据。只要这类关键决策仍悬空，idea_ready 必须为 false。',
  ];
  if (dynamicKnowledge) lines.push(
    '下面是按当前项目动态检索的导演知识，只用于改善提问方法和创作判断；不得照搬其中案例、人物或设定，不得覆盖用户原话：',
    dynamicKnowledge,
  );
  return lines.join('\n');
}

function knowledgeContext(body = {}) {
  const query = [body.accumulated_idea || body.brief, body.user_message || body.message].map(item => cleanText(item, 1800)).filter(Boolean).join('\n');
  if (!query) return '';
  try { return knowledgeBase.searchForAgent('director', query, { limit: 2, maxCharsPerDoc: 360 }); } catch { return ''; }
}

function inferQuestionTopic(reply = '', missingTopics = [], completedTopics = []) {
  const completed = new Set(cleanTopics(completedTopics));
  const source = `${cleanText(reply, 400)} ${listText(missingTopics)}`;
  const matched = TOPIC_HINTS.find(([topic, pattern]) => !completed.has(topic) && pattern.test(source));
  return matched?.[0] || TOPIC_ORDER.find(topic => !completed.has(topic)) || '';
}

function listText(value = []) { return (Array.isArray(value) ? value : []).map(item => cleanInline(item, 80)).join(' '); }

function displayableReply(reply = '', history = []) {
  const value = cleanInline(reply, 300);
  if (/我记下了|我理解|这部分已经清楚|接下来|可核验|立项依据|覆盖率|真实克制|东方诗意|宏大传奇/u.test(value)) return false;
  const priorAssistantReplies = (Array.isArray(history) ? history : [])
    .filter(item => item?.role === 'assistant').map(item => cleanInline(item.content, 300));
  return !priorAssistantReplies.includes(value);
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
    `已经回答、禁止重复询问的创作决策：${cleanTopics(body.completed_topics).join('、') || '无'}`,
    `最近对话：${JSON.stringify(history)}`,
    '请重新审计五类制作依据，不要继承上一轮未经用户证据支持的判断，并输出：',
    '{"reply":"直接提出唯一一个下一问","question_topic":"从允许值中选择本轮问题身份","suggested_answers":["贴合当前内容的答案一","贴合当前内容的答案二","贴合当前内容的答案三"],"coverage":{"subject":{"status":"explicit|missing","evidence":"用户原文短语或空"},"structure":{"status":"explicit|missing","evidence":"用户原文短语或空"},"audience_intent":{"status":"explicit|missing","evidence":"用户原文短语或空"},"world_context":{"status":"explicit|missing","evidence":"用户原文短语或空"},"visual_direction":{"status":"explicit|missing","evidence":"用户原文短语或空"}},"idea_ready":false,"missing_topics":["本轮唯一追问的缺口"],"next_step":"idea_details"}',
    `question_topic 只能是：${[...DIALOGUE_TOPICS].join('、')}。它是本轮唯一问题的稳定身份，不能选择已经完成的值。`,
    'next_step 只能是 idea_details、specifications、reference、review。五类 coverage 未全部 explicit 时 idea_ready 必须为 false，missing_topics 只能列出本轮唯一追问的一项，并必须返回 2 至 3 个 suggested_answers；进入 specifications 后 question_topic 为空、suggested_answers 可以为空数组。',
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

function normalizeParsed(parsed = {}, accumulatedIdea = '', completedTopics = null) {
  let reply = cleanText(parsed.reply || parsed.dialogue_reply || parsed.message || '', 300);
  const coverage = normalizeCoverage(parsed, accumulatedIdea);
  const coverageReady = COVERAGE_TOPICS.every(topic => coverage[topic].status === 'explicit');
  const impliedGap = impliedDecisionGap(accumulatedIdea, Array.isArray(completedTopics) ? completedTopics : undefined);
  let ideaReady = parsed.idea_ready === true && coverageReady && !impliedGap;
  let missingTopics = (Array.isArray(parsed.missing_topics) ? parsed.missing_topics : [])
    .map(item => cleanInline(item, 80)).filter(Boolean).slice(0, 1);
  let suggestedAnswers = (Array.isArray(parsed.suggested_answers) ? parsed.suggested_answers : [])
    .map(item => cleanInline(item, 48)).filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .slice(0, 3);
  let nextStep = cleanInline(parsed.next_step, 40);
  let questionTopic = cleanInline(parsed.question_topic, 40);
  if (!DIALOGUE_TOPICS.has(questionTopic)) questionTopic = '';
  if (!NEXT_STEPS.has(nextStep)) nextStep = ideaReady ? 'specifications' : 'idea_details';
  if (!ideaReady) {
    nextStep = 'idea_details';
    if (impliedGap) {
      missingTopics = [impliedGap.topic];
      questionTopic = impliedGap.question_topic;
      reply = impliedGap.reply;
      suggestedAnswers = impliedGap.answers;
    } else if (!missingTopics.length) missingTopics = COVERAGE_TOPICS.filter(topic => coverage[topic].status !== 'explicit').slice(0, 1).map(topic => COVERAGE_LABELS[topic]);
    if (!questionTopic) questionTopic = inferQuestionTopic(reply, missingTopics, completedTopics);
    if (!impliedGap && parsed.idea_ready === true && !coverageReady && TOPIC_QUESTIONS[questionTopic]) {
      [reply, suggestedAnswers] = TOPIC_QUESTIONS[questionTopic];
      missingTopics = [questionTopic];
    }
  } else { suggestedAnswers = []; questionTopic = ''; }
  return { reply, question_topic: questionTopic, idea_ready: ideaReady, missing_topics: missingTopics, suggested_answers: suggestedAnswers, next_step: nextStep, coverage };
}

function validateRaw(raw = '', { accumulatedIdea = '', completedTopics = [], history = [] } = {}) {
  try {
    const parsed = jsonRepair.parseJson(raw, 'object');
    const value = normalizeParsed(parsed, accumulatedIdea, completedTopics);
    const completed = cleanTopics(completedTopics);
    return Boolean(value.reply.length >= 12
      && value.reply.length <= 300
      && displayableReply(value.reply, history)
      && NEXT_STEPS.has(value.next_step)
      && (value.idea_ready || (value.question_topic && !completed.includes(value.question_topic) && value.missing_topics.length === 1 && value.suggested_answers.length >= 2)));
  } catch {
    return false;
  }
}

function buildResponse({ parsed = {}, modelResult = {}, body = {} } = {}) {
  const value = normalizeParsed(parsed, body.accumulated_idea || body.brief || '', body.completed_topics);
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
    question_topic: value.question_topic,
    next_step: nextStep,
    coverage: value.coverage,
    model_meta: {
      used_model: modelResult.used_model,
      fallback_used: modelResult.fallback_used,
      failed_models: modelResult.failed_models,
    },
  };
}

function recoveryResponse(body = {}, failedModels = []) {
  const completed = cleanTopics(body.completed_topics);
  const latestCompletedIndex = completed.reduce((max, item) => Math.max(max, TOPIC_ORDER.indexOf(item)), -1);
  const topic = TOPIC_ORDER.slice(latestCompletedIndex + 1).find(item => !completed.includes(item))
    || TOPIC_ORDER.find(item => !completed.includes(item)) || 'plot_trigger';
  const fallback = TOPIC_QUESTIONS[topic] || TOPIC_QUESTIONS.subject_identity;
  return {
    dialogue_reply: fallback[0], idea_ready: false, missing_topics: [topic], question_topic: topic,
    suggested_answers: fallback[1], next_step: 'idea_details',
    coverage: normalizeCoverage({}, body.accumulated_idea || body.brief || ''),
    model_meta: { used_model: null, fallback_used: true, failed_models: failedModels, deterministic: true, recovery_reason: 'provider_response_invalid' },
  };
}

async function run({ body = {}, modelGateway, taskId = '' } = {}) {
  assertInput(body);
  const accumulatedIdea = body.accumulated_idea || body.brief || '';
  const immediateGap = impliedDecisionGap(accumulatedIdea, body.completed_topics);
  if (immediateGap) return {
    dialogue_reply: immediateGap.reply,
    idea_ready: false,
    missing_topics: [immediateGap.topic],
    question_topic: immediateGap.question_topic,
    suggested_answers: immediateGap.answers,
    next_step: 'idea_details',
    coverage: normalizeCoverage({}, accumulatedIdea),
    model_meta: { used_model: null, fallback_used: false, failed_models: [], deterministic: true },
  };
  let result;
  try {
    result = await modelGateway.generateText({
      taskId,
      stage: 'new_story_ad.brief_dialogue',
      systemPrompt: systemPrompt(knowledgeContext(body)),
      userPrompt: userPrompt(body),
      maxTokens: 420,
      maxCandidates: 2,
      timeoutMs: 8000,
      stageBudgetMs: 12000,
      structuredOutput: { mode: 'json_object' },
      validateText: raw => validateRaw(raw, { accumulatedIdea, completedTopics: body.completed_topics, history: body.history }),
    });
  } catch (error) {
    if (error?.code !== 'MODEL_ATTEMPTS_EXHAUSTED') throw error;
    return recoveryResponse(body, error.failed_models || []);
  }
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
  inferQuestionTopic,
  knowledgeContext,
  recoveryResponse,
  displayableReply,
  cleanTopics,
  DIALOGUE_TOPICS,
  COVERAGE_TOPICS,
};
