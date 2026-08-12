const jsonRepair = require('./jsonRepairService');
const briefAuthority = require('./briefAuthorityService');
const productAssetResolver = require('./productAssetResolverService');

const STRUCTURE_VERSION = 2;

function cleanText(value = '', max = 1200) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function cleanInline(value = '', max = 240) {
  return cleanText(value, max).replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ');
}

function isMode(mode = '') {
  return mode === 'brief_goal' || mode === 'goal';
}

function isNarrative(source = {}) {
  return briefAuthority.contentMode(source) === 'narrative_story';
}

function assertInput(body = {}, context = body) {
  if (cleanText(body.brief || body.content || '', 3000)) {
    productAssetResolver.assertCommercialSubject(context, {
      code: 'ASSIST_AD_SUBJECT_REQUIRED',
      message: '请在想写的广告内容中写明具体产品、服务或品牌；本次没有调用文本模型',
    });
    return;
  }
  const error = new Error('请先输入想写的内容，AI 才能帮你补充；没有调用文本模型');
  error.code = 'ASSIST_BRIEF_GOAL_EMPTY';
  error.status = 400;
  throw error;
}

function normalize(value = '', fallback = '') {
  const text = cleanText(value || fallback, 1800);
  const chineseCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  if (chineseCount < 40) {
    const error = new Error('AI 返回的内容过于简略，请保留当前输入后重试');
    error.code = 'ASSIST_BRIEF_GOAL_INCOMPLETE';
    error.status = 422;
    error.retryable = true;
    throw error;
  }
  return text;
}

function assistedText(parsed = {}) {
  return cleanText(parsed.goal_addition || parsed.goalAddition || parsed.closing || parsed.brief || parsed.content || '', 1800);
}

function hasCommercialDrift(source = {}, addition = '') {
  if (!isNarrative(source)) return false;
  return /产品|商品|品牌|卖点|购买|下单|转化|销售|消费意愿/.test(addition);
}

function normalizeParticipants(value = []) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item, index) => {
    if (typeof item === 'string') return { name: cleanInline(item, 80), role: '', description: '' };
    return {
      name: cleanInline(item?.name || item?.title || `主体${index + 1}`, 80),
      role: cleanInline(item?.role || item?.identity || item?.type || '', 120),
      description: cleanInline(item?.description || item?.arc || item?.function || '', 260),
    };
  }).filter(item => item.name || item.description);
}

function normalizeScenes(value = []) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item, index) => {
    if (typeof item === 'string') return { name: cleanInline(item, 100), time: '', description: '' };
    return {
      name: cleanInline(item?.name || item?.location || `场景${index + 1}`, 100),
      time: cleanInline(item?.time || item?.period || item?.atmosphere || '', 120),
      description: cleanInline(item?.description || item?.purpose || item?.action || '', 300),
    };
  }).filter(item => item.name || item.description);
}

function normalizeSections(value = []) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item, index) => {
    if (typeof item === 'string') return { title: `第${index + 1}段`, content: cleanText(item, 500) };
    return {
      title: cleanInline(item?.title || item?.beat || `第${index + 1}段`, 100),
      content: cleanText(item?.content || item?.description || item?.story || '', 600),
    };
  }).filter(item => item.content);
}

function structuredDraft(parsed = {}) {
  return {
    summary: cleanText(parsed.detailed_summary || parsed.detailedSummary || parsed.synopsis || '', 1400),
    participants: normalizeParticipants(parsed.participants || parsed.characters || parsed.subjects),
    scenes: normalizeScenes(parsed.scenes || parsed.locations),
    sections: normalizeSections(parsed.story_sections || parsed.storySections || parsed.sections || parsed.paragraphs),
    closing: cleanText(parsed.closing || parsed.theme_and_ending || parsed.themeAndEnding || parsed.goal_addition || '', 700),
  };
}

function validateDraft(draft = {}, source = {}) {
  const combined = [draft.summary, ...draft.participants.map(item => `${item.name}${item.role}${item.description}`),
    ...draft.scenes.map(item => `${item.name}${item.time}${item.description}`), ...draft.sections.map(item => item.content), draft.closing].join('\n');
  normalize(combined);
  if (!draft.summary || draft.participants.length < 1 || draft.scenes.length < 1 || draft.sections.length < 2 || !draft.closing) return false;
  if (hasCommercialDrift(source, combined)) return false;
  return true;
}

function validateRaw(raw = '', source = {}) {
  try {
    return validateDraft(structuredDraft(jsonRepair.parseJson(raw, 'object')), source);
  } catch {
    return false;
  }
}

function modePrompt(source = {}) {
  return isNarrative(source)
    ? 'brief_goal 剧情剧本帮写：将用户想法整理为详细剧情描述、出场人物、主要场景、剧情段落与主题结尾'
    : 'brief_goal 广告剧本帮写：将用户想法整理为广告剧情概述、出场人物或展示主体、主要场景、广告段落与传播收束';
}

function assistantRole(source = {}) {
  return `你是剧情广告模块的${isNarrative(source) ? '剧情剧本' : '广告剧本'}整理助手。只输出 JSON 对象，不要 markdown。`;
}

function taskRule(source = {}) {
  return `按用户亲自选择的${isNarrative(source) ? '剧情' : '广告'}类型，生成可直接阅读和继续编辑的标准剧本式内容；不得把剧情变广告，也不得把广告改成无商业主体的故事。`;
}

function systemRule(source = {}) {
  const shared = '用户原文中的人物数量、人物关系、时代、地点、动作、内容类型、商品与业务事实都是不可变事实；允许在这些事实范围内补充剧情连接与表达细节，但不得删除、合并、替换或反转。输出必须包含详细概述、出场人物或展示主体、主要场景、至少两个有先后关系的剧情段落以及结尾。这里只写剧本级内容，不写镜号、景别、机位、运镜、逐秒时间轴或生成提示词。';
  if (isNarrative(source)) {
    return `当前是用户明确选择的纯剧情任务。${shared} 禁止添加产品、商品、服务、购买、卖点、品牌、营销、传播或销售转化；人物、场景和剧情段落必须服务于人物关系、事件、情绪与主题。`;
  }
  return `当前是用户明确选择的广告任务。${shared} 必须保留已经确认的产品或服务主体；以人物或展示主体、使用情境、可见证据和期望行动组织广告剧情，不得编造功效、价格、资质、品牌背书或不可验证事实。广告不要求必须出现真人，商品、动物、空间或抽象主体都可按原始需求成为展示主体。`;
}

function outputSchema(source = {}) {
  const narrative = isNarrative(source);
  return `{
  "detailed_summary": "${narrative ? '详细剧情描述' : '详细广告剧情概述'}，180-500字，完整说明起因、发展、冲突或需求、变化与结果",
  "participants": [{"name":"${narrative ? '人物名' : '人物或展示主体名'}","role":"身份、关系或剧情职责","description":"外在目标、内在动机及在本内容中的作用"}],
  "scenes": [{"name":"场景名","time":"时间、时期或氛围；原文未给出时写待根据剧本分析","description":"空间特征、发生的事件及剧情作用"}],
  "story_sections": [{"title":"段落标题","content":"该段发生的详细剧情、出场主体、场景和前后因果；按正常观看顺序排列"}],
  "closing": "${narrative ? '主题、人物关系变化与结尾余韵' : '传播目标、可信收束与期望行动'}"
}`;
}

function renderParticipants(items = []) {
  return items.map((item, index) => `${index + 1}. ${item.name}${item.role ? `｜${item.role}` : ''}${item.description ? `\n   ${item.description}` : ''}`).join('\n');
}

function renderScenes(items = []) {
  return items.map((item, index) => `${index + 1}. ${item.name}${item.time ? `｜${item.time}` : ''}${item.description ? `\n   ${item.description}` : ''}`).join('\n');
}

function renderSections(items = []) {
  return items.map((item, index) => `${index + 1}. ${item.title}\n${item.content}`).join('\n\n');
}

function buildResponse({ parsed = {}, context = {}, mode = 'brief_goal', modelResult = {} } = {}) {
  const source = cleanText(context.brief || context.content || '', 3000);
  const draft = structuredDraft(parsed);
  if (!validateDraft(draft, context)) {
    const error = new Error('AI 返回的剧本结构不完整，原始输入已保留，请重试');
    error.code = 'ASSIST_BRIEF_GOAL_INCOMPLETE';
    error.status = 422;
    error.retryable = true;
    throw error;
  }
  const story = isNarrative(context);
  const blocks = [
    `【${story ? '详细剧情描述' : '广告剧情概述'}】\n${draft.summary}`,
    `【${story ? '出场人物' : '出场人物 / 展示主体'}】\n${renderParticipants(draft.participants)}`,
    `【主要场景】\n${renderScenes(draft.scenes)}`,
    `【${story ? '剧情段落' : '广告剧情段落'}】\n${renderSections(draft.sections)}`,
    `【${story ? '主题与结尾' : '传播目标与收束'}】\n${draft.closing}`,
  ];
  const brief = blocks.filter(Boolean).join('\n\n').slice(0, 5000);
  return {
    brief,
    original_brief: source,
    goal_addition: draft.closing,
    screenplay_structure: draft,
    screenplay_structure_version: STRUCTURE_VERSION,
    mode,
    model_meta: {
      used_model: modelResult.used_model,
      fallback_used: modelResult.fallback_used,
      failed_models: modelResult.failed_models,
    },
  };
}

module.exports = {
  STRUCTURE_VERSION,
  isMode,
  assertInput,
  validateRaw,
  systemRule,
  outputSchema,
  buildResponse,
  normalize,
  hasCommercialDrift,
  isNarrative,
  modePrompt,
  assistantRole,
  taskRule,
  structuredDraft,
};
