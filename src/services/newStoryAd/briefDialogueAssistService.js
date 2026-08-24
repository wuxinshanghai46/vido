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
const COMMERCIAL_TOPIC_ORDER = [
  'subject_identity', 'subject_motivation', 'commercial_evidence', 'audience_intent',
  'world_region_rules', 'visual_medium', 'visual_tone',
];
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
  subject_identity: ['主要人物分别是什么身份？', ['普通人之间的相遇', '不同职业的人因事件相识', '一方陪伴另一方成长']],
  subject_relationship: ['他们之间最重要的关系是什么？', ['从陌生到彼此信任', '长期陪伴但逐渐产生分歧', '一开始亲近，后来被迫分开']],
  subject_motivation: ['他们各自最想得到或守住什么？', ['守住重要的人和承诺', '找到自己真正想要的生活', '完成一件一直没有完成的事']],
  opposition: ['这段故事最大的阻力来自什么？', ['时间与现实变化', '人物之间的选择冲突', '一次无法回避的意外']],
  plot_trigger: ['发生什么事后，人物不得不开始行动？', ['一次意外打破原有生活', '收到一个无法忽视的消息', '失去重要事物后决定改变']],
  plot_development: ['事情发展后，人物关系和目标怎样变化？', ['陪伴加深，但现实阻力出现', '彼此误解，后来重新理解', '目标一致，却选择了不同道路']],
  climax_ending: ['故事最后最重要的选择是什么？', ['接受离别并完成最后承诺', '放下过去，开始新的生活', '为守住对方付出无法挽回的代价']],
  audience_intent: ['你希望观众看完后最强烈的感受是什么？', ['感受到长期陪伴的重量', '思考时间、失去与选择', '在遗憾中看到温暖和希望']],
  world_era: ['故事发生在什么时期？', ['当代现实生活', '距离现在不远的未来', '不对应现实年代的架空世界']],
  world_region_rules: ['故事主要发生在哪里，这个世界有什么关键规则？', ['城市日常空间', '小城与自然环境', '具有特殊技术规则的未来社会']],
  character_continuity: ['随着时间推进，人物外貌和状态怎样变化？', ['年龄自然增长，身份保持不变', '外貌变化明显，但保留核心特征', '不同阶段使用独立造型表现']],
  visual_medium: ['你希望用哪种方式来拍？', ['真人拍摄', '二维动画', '三维动画']],
  visual_tone: ['你希望画面看起来更接近哪一种？', ['像真实电影一样自然', '画面柔和，突出人物情绪', '视觉风格鲜明，强调想象力']],
  commercial_evidence: ['观众从哪个画面能直接看出产品的好处？', ['使用前后效果对比', '真实使用过程和结果', '用户当场体验后的反应']],
};
const COMMERCIAL_TOPIC_QUESTIONS = {
  subject_identity: ['这条广告最需要集中展示哪一种产品或服务？', ['只展示一个主打产品', '展示同系列的多种产品', '以服务流程和最终成果为主']],
  subject_motivation: ['这条广告最希望观众记住哪个核心卖点？', ['突出产品性能', '突出设计与使用体验', '突出品牌的专业能力']],
  commercial_evidence: ['用哪组画面直接证明这个卖点最合适？', ['展示真实使用过程和结果', '用细节特写呈现材质与工艺', '在实际场景中做前后效果对比']],
  audience_intent: ['这条广告主要给谁看，看完希望他们做什么？', ['让采购方进一步咨询', '让设计师了解并选用', '让普通消费者记住品牌']],
  world_region_rules: ['产品主要放在哪种真实使用场景里展示？', ['门店或展厅现场', '实际安装或使用环境', '干净背景下集中展示产品']],
  visual_medium: ['这条广告希望采用哪种画面方式？', ['真人实拍与产品特写', '产品三维动画', '实拍与三维演示结合']],
  visual_tone: ['整体画面更接近哪一种视觉方向？', ['清晰直接，突出产品信息', '简洁高级，突出材质细节', '有节奏感，突出性能演示']],
};

function topicProfile(contentMode = '') {
  return contentMode === 'commercial_subject'
    ? { order: COMMERCIAL_TOPIC_ORDER, questions: COMMERCIAL_TOPIC_QUESTIONS }
    : { order: TOPIC_ORDER, questions: TOPIC_QUESTIONS };
}

function nextQuestionTopic(profile = {}, completedTopics = []) {
  const order = Array.isArray(profile.order) ? profile.order : [];
  const completed = cleanTopics(completedTopics).filter(topic => order.includes(topic));
  const latestCompletedIndex = completed.reduce((max, item) => Math.max(max, order.indexOf(item)), -1);
  return order.slice(latestCompletedIndex + 1).find(item => !completed.includes(item))
    || order.find(item => !completed.includes(item)) || '';
}

function commercialNarrativeAuthorized(accumulatedIdea = '') {
  return /(?:爱情|恋爱|感情|情感|情侣|夫妻|恋人|两人关系|人物关系|剧情化广告|故事型广告)/u.test(cleanText(accumulatedIdea, 4000));
}

function commercialStoryLeak(value = '') {
  return /(?:男女主|两人的关系|感情逐渐|相爱|爱情|恋人|反派|秘宝|穿越|权贵|冲突升级|最后一场对决)/u.test(String(value || ''));
}

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

function cleanTopicsForMode(value = [], contentMode = '') {
  const allowed = new Set(topicProfile(contentMode).order);
  return cleanTopics(value).filter(topic => allowed.has(topic));
}

function questionBudget(contentMode = '') { return contentMode === 'commercial_subject' ? 2 : 3; }

function questionBudgetReached(value = [], contentMode = '') {
  return cleanTopicsForMode(value, contentMode).length >= questionBudget(contentMode);
}

function creativeDelegationRequested(value = '') {
  return /(?:这些|这个|内容|设定)?(?:你|平台|系统)?(?:帮我|替我|由你|你来|请你)[^，。；\n]{0,16}(?:完善|补全|补充|细化|设计|决定|安排)|(?:完善|补全|补充|细化)[^，。；\n]{0,8}(?:一下|下|吧)/u.test(cleanText(value, 400));
}

function contextualQuestion(profile = {}, topic = '', accumulatedIdea = '', contentMode = '') {
  const fallback = profile.questions?.[topic] || ['', []];
  if (contentMode === 'commercial_subject' || !/(?:机器人|机械人|仿生人|AI陪伴|人工智能)/u.test(cleanText(accumulatedIdea, 4000))) return fallback;
  const robotQuestions = {
    subject_identity: ['青年和机器人分别是什么身份，机器人为什么会陪伴他？', ['普通青年与家用陪伴机器人', '独居创作者与实验型机器人', '青年工程师与他亲手造的机器人']],
    subject_relationship: ['青年和机器人的关系希望怎样发展？', ['从工具变成一生的家人', '彼此陪伴但始终保持克制', '青年依赖它，后来学会告别']],
    subject_motivation: ['他们一生最想守住的是什么？', ['守住彼此陪伴的记忆', '让青年不再独自面对人生', '完成一起去看海的约定']],
    opposition: ['这段陪伴最大的阻力来自什么？', ['人的衰老与机器人的长久存在', '记忆逐渐消失但机器人仍记得', '机器人老化，无法继续陪伴']],
    plot_trigger: ['哪件事让机器人开始陪伴青年？', ['青年独居时收到陪伴机器人', '青年在故障仓库救下机器人', '青年亲手完成机器人的首次启动']],
    plot_development: ['青年逐渐老去时，他们的关系怎样变化？', ['机器人照顾他并保存共同记忆', '青年失忆后一次次重新认识它', '机器人逐渐故障却隐瞒自己的状态']],
    climax_ending: ['青年离世后，机器人为什么选择沉入海底？', ['履行一起看海的最后约定', '把共同记忆永久封存在海底', '完成告别后主动结束漫长等待']],
    audience_intent: ['你希望观众从这段人机陪伴中感受到什么？', ['陪伴终会结束但记忆会留下', '生命有限让相处更珍贵', '机器人也学会了爱与告别']],
    world_era: ['这个人机陪伴故事发生在当代还是近未来？', ['当代城市，机器人技术较先进', '近未来，陪伴机器人已经普及', '从当代开始，跨越到近未来']],
    world_region_rules: ['他们一生主要在哪些地方共同生活？', ['城市住宅、医院与最后的海边', '小城老屋、公园与海岸', '未来公寓、养老机构与深海']],
    character_continuity: ['青年从年轻到老年，机器人外观怎样随时间变化？', ['青年自然老去，机器人保留同一外观', '青年分阶段变老，机器人也逐渐磨损', '机器人定期换外壳但保留同一核心身份']],
  };
  return robotQuestions[topic] || fallback;
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

function impliedDecisionGap(accumulatedIdea = '', completedTopics, contentMode = '') {
  if (contentMode === 'commercial_subject') return null;
  const source = cleanText(accumulatedIdea, 4000);
  if (Array.isArray(completedTopics)) {
    const completed = new Set(cleanTopicsForMode(completedTopics, contentMode));
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

function systemPrompt(dynamicKnowledge = '', contentMode = '') {
  const commercial = contentMode === 'commercial_subject';
  const lines = [
    '你是 VIDO 剧情广告模块的资深导演与制片策划，负责用自然、专业、具体的中文完成对话式立项。只输出 JSON 对象，不要 markdown。',
    '不要复述、确认或总结用户刚刚回答的内容，不要说“我记下了”“我理解了”“这部分已经清楚”“接下来”。直接提出当前唯一一个问题；只有问题本身不易理解时，才允许加一句很短的通俗说明。',
    '每轮只追问 1 个当前最影响创作与制作的缺口；不要向用户罗列检查项或宣布后续流程。进入成片规格前必须覆盖五类制作依据：subject（主要人物/关系或产品主体）、structure（开端触发、发展冲突、高潮/结局，或广告价值演示链）、audience_intent（目标观众及希望留下的情绪/认知/行动）、world_context（足够执行的时代、地区、社会环境或明确架空规则）、visual_direction（真人/动画等媒介、写实度、美学气质或用户明确委托导演建议）。',
    commercial
      ? '当前是商业广告。广告与剧情短片必须使用不同问询合同：只确认产品或服务主体、核心卖点、可见证据、目标受众与行动、真实展示场景、画面方式和视觉方向。禁止追问人物关系、感情变化、反派、冲突升级、穿越、高潮或故事结局；只有用户明确要求剧情化广告并亲自提出人物情感时，才可沿用户原话确认，不能主动添加爱情或其它情感线。'
      : '当前是剧情短片。问询顺序必须连贯：先理清人物、关系、动机与对立，再理清触发、发展和结局，然后确认受众与表达目标，再确认时空规则和跨时代连续性，最后确认视觉媒介与气质。用户原话已明确的部分直接跳过，只问该顺序中最早的真实缺口，不能在不同层级之间来回跳。',
    '“古代”“现代”“好看”“电影感”这类宽泛词不能单独算 world_context 或 visual_direction 已明确；应结合用户内容给出 2 至 3 个专业选项帮助选择。用户说“由你建议/你来定”时，先给出具体建议并请用户确认，确认后才能标为 explicit。',
    '用户说“帮我完善”“你来补充”“由你决定”等委托创作时，必须根据当前累计设想给出一项具体、可直接采用的完善建议，并用一个简短问题请用户确认；不得沉默、不得跳过回复，也不得套用与当前题材无关的古代、爱情、权贵、秘宝或穿越案例。',
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

function inferQuestionTopic(reply = '', missingTopics = [], completedTopics = [], contentMode = '') {
  const completed = new Set(cleanTopicsForMode(completedTopics, contentMode));
  const profile = topicProfile(contentMode);
  const source = `${cleanText(reply, 400)} ${listText(missingTopics)}`;
  const matched = TOPIC_HINTS.find(([topic, pattern]) => !completed.has(topic) && pattern.test(source));
  if (matched?.[0] && profile.order.includes(matched[0])) return matched[0];
  return profile.order.find(topic => !completed.has(topic)) || '';
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
  const profile = topicProfile(body.content_mode);
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
    `已经回答、禁止重复询问的创作决策：${cleanTopicsForMode(body.completed_topics, body.content_mode).join('、') || '无'}`,
    `最近对话：${JSON.stringify(history)}`,
    '请重新审计五类制作依据，不要继承上一轮未经用户证据支持的判断，并输出：',
    '{"reply":"直接提出唯一一个下一问","question_topic":"从允许值中选择本轮问题身份","suggested_answers":["贴合当前内容的答案一","贴合当前内容的答案二","贴合当前内容的答案三"],"coverage":{"subject":{"status":"explicit|missing","evidence":"用户原文短语或空"},"structure":{"status":"explicit|missing","evidence":"用户原文短语或空"},"audience_intent":{"status":"explicit|missing","evidence":"用户原文短语或空"},"world_context":{"status":"explicit|missing","evidence":"用户原文短语或空"},"visual_direction":{"status":"explicit|missing","evidence":"用户原文短语或空"}},"idea_ready":false,"missing_topics":["本轮唯一追问的缺口"],"next_step":"idea_details"}',
    `question_topic 只能是：${profile.order.join('、')}。它是本轮唯一问题的稳定身份，不能选择已经完成的值。`,
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

function normalizeParsed(parsed = {}, accumulatedIdea = '', completedTopics = null, contentMode = '') {
  const profile = topicProfile(contentMode);
  const completed = cleanTopicsForMode(completedTopics, contentMode);
  let reply = cleanText(parsed.reply || parsed.dialogue_reply || parsed.message || '', 300);
  const coverage = normalizeCoverage(parsed, accumulatedIdea);
  const coverageReady = COVERAGE_TOPICS.every(topic => coverage[topic].status === 'explicit');
  const impliedGap = impliedDecisionGap(accumulatedIdea, Array.isArray(completedTopics) ? completedTopics : undefined, contentMode);
  let ideaReady = parsed.idea_ready === true && coverageReady && !impliedGap;
  let missingTopics = (Array.isArray(parsed.missing_topics) ? parsed.missing_topics : [])
    .map(item => cleanInline(item, 80)).filter(Boolean).slice(0, 1);
  let suggestedAnswers = (Array.isArray(parsed.suggested_answers) ? parsed.suggested_answers : [])
    .map(item => cleanInline(item, 48)).filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .slice(0, 3);
  let nextStep = cleanInline(parsed.next_step, 40);
  let questionTopic = cleanInline(parsed.question_topic, 40);
  if (!profile.order.includes(questionTopic)) questionTopic = '';
  const repeatedCanonicalTopic = profile.order.find(topic => completed.includes(topic)
    && cleanInline(profile.questions[topic]?.[0], 300) === cleanInline(reply, 300));
  const repeatedCompletedTopic = completed.includes(questionTopic) || Boolean(repeatedCanonicalTopic);
  if (repeatedCompletedTopic) {
    questionTopic = nextQuestionTopic(profile, completed);
    if (questionTopic && profile.questions[questionTopic]) {
      [reply, suggestedAnswers] = contextualQuestion(profile, questionTopic, accumulatedIdea, contentMode);
      missingTopics = [questionTopic];
      ideaReady = false;
    }
  }
  if (!NEXT_STEPS.has(nextStep)) nextStep = ideaReady ? 'specifications' : 'idea_details';
  if (!ideaReady) {
    nextStep = 'idea_details';
    if (impliedGap) {
      missingTopics = [impliedGap.topic];
      questionTopic = impliedGap.question_topic;
      reply = impliedGap.reply;
      suggestedAnswers = impliedGap.answers;
    } else if (!missingTopics.length) missingTopics = COVERAGE_TOPICS.filter(topic => coverage[topic].status !== 'explicit').slice(0, 1).map(topic => COVERAGE_LABELS[topic]);
    if (!questionTopic) questionTopic = inferQuestionTopic(reply, missingTopics, completedTopics, contentMode);
    if (!impliedGap && parsed.idea_ready === true && !coverageReady && profile.questions[questionTopic]) {
      [reply, suggestedAnswers] = contextualQuestion(profile, questionTopic, accumulatedIdea, contentMode);
      missingTopics = [questionTopic];
    }
    if (contentMode === 'commercial_subject'
      && !commercialNarrativeAuthorized(accumulatedIdea)
      && commercialStoryLeak(`${reply} ${suggestedAnswers.join(' ')}`)) {
      questionTopic = profile.order.find(topic => !cleanTopicsForMode(completedTopics, contentMode).includes(topic)) || profile.order[0];
      [reply, suggestedAnswers] = contextualQuestion(profile, questionTopic, accumulatedIdea, contentMode);
      missingTopics = [questionTopic];
    }
  } else { suggestedAnswers = []; questionTopic = ''; }
  return { reply, question_topic: questionTopic, idea_ready: ideaReady, missing_topics: missingTopics, suggested_answers: suggestedAnswers, next_step: nextStep, coverage };
}

function validateRaw(raw = '', { accumulatedIdea = '', completedTopics = [], history = [], contentMode = '' } = {}) {
  try {
    const parsed = jsonRepair.parseJson(raw, 'object');
    const value = normalizeParsed(parsed, accumulatedIdea, completedTopics, contentMode);
    const completed = cleanTopicsForMode(completedTopics, contentMode);
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
  const value = normalizeParsed(parsed, body.accumulated_idea || body.brief || '', body.completed_topics, body.content_mode);
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
  const completed = cleanTopicsForMode(body.completed_topics, body.content_mode);
  const profile = topicProfile(body.content_mode);
  const topic = nextQuestionTopic(profile, completed) || profile.order[0];
  const fallback = contextualQuestion(profile, topic, body.accumulated_idea || body.brief || '', body.content_mode);
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
  if (questionBudgetReached(body.completed_topics, body.content_mode) && !creativeDelegationRequested(body.user_message || body.message)) return {
    dialogue_reply: '创作关键信息已足够，接下来确认成片规格。',
    idea_ready: true,
    missing_topics: [],
    question_topic: '',
    suggested_answers: [],
    next_step: body.specifications_confirmed !== true ? 'specifications'
      : (!body.reference_attached && !body.reference_skipped ? 'reference' : 'review'),
    coverage: normalizeCoverage({}, accumulatedIdea),
    model_meta: { used_model: null, fallback_used: false, failed_models: [], deterministic: true, reason: 'question_budget_reached' },
  };
  const immediateGap = impliedDecisionGap(accumulatedIdea, body.completed_topics, body.content_mode);
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
      systemPrompt: systemPrompt(knowledgeContext(body), body.content_mode),
      userPrompt: userPrompt(body),
      maxTokens: 420,
      maxCandidates: 2,
      timeoutMs: 8000,
      stageBudgetMs: 12000,
      structuredOutput: { mode: 'json_object' },
      validateText: raw => validateRaw(raw, { accumulatedIdea, completedTopics: body.completed_topics, history: body.history, contentMode: body.content_mode }),
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
  cleanTopicsForMode,
  questionBudget,
  questionBudgetReached,
  creativeDelegationRequested,
  contextualQuestion,
  topicProfile,
  nextQuestionTopic,
  commercialNarrativeAuthorized,
  commercialStoryLeak,
  DIALOGUE_TOPICS,
  COVERAGE_TOPICS,
};
