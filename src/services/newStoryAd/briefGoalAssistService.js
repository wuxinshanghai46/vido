const jsonRepair = require('./jsonRepairService');
const briefAuthority = require('./briefAuthorityService');

function cleanText(value = '', max = 1200) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function isMode(mode = '') {
  return mode === 'brief_goal' || mode === 'goal';
}

function assertInput(body = {}) {
  if (cleanText(body.brief || body.content || '', 3000)) return;
  const error = new Error('请先输入想写的内容，AI 才能帮你补充；没有调用文本模型');
  error.code = 'ASSIST_BRIEF_GOAL_EMPTY';
  error.status = 400;
  throw error;
}

function normalize(value = '', fallback = '') {
  const text = cleanText(value || fallback);
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
  return cleanText(parsed.goal_addition || parsed.goalAddition || parsed.brief || parsed.content || '', 1600);
}

function hasCommercialDrift(source = {}, addition = '') {
  if (briefAuthority.contentMode(source) !== 'narrative_story') return false;
  return /产品|商品|品牌|卖点|购买|下单|转化|销售|消费意愿/.test(addition);
}

function validateRaw(raw = '', source = {}) {
  try {
    const parsed = jsonRepair.parseJson(raw, 'object');
    const addition = normalize(assistedText(parsed));
    if (hasCommercialDrift(source, addition)) return false;
    return true;
  } catch {
    return false;
  }
}

function isNarrative(source = {}) {
  return briefAuthority.contentMode(source) === 'narrative_story';
}

function modePrompt(source = {}) {
  return isNarrative(source)
    ? 'brief_goal 剧情表达目标帮写：围绕人物、关系、地点、事件、情绪和主题补充表达方向'
    : 'brief_goal 广告传播目标帮写：围绕产品或服务、目标人群、核心价值、可信依据和期望行动补充传播方向';
}

function assistantRole(source = {}) {
  return `你是剧情广告模块的${isNarrative(source) ? '剧情表达' : '广告传播'}目标整理助手。只输出 JSON 对象，不要 markdown。`;
}
function taskRule() {
  return '你的任务是按用户亲自选择的内容类型补充目标；不得把剧情变广告，也不得把广告改成无商业主体的故事。';
}

function systemRule(source = {}) {
  const shared = '不得改写、摘要、替换或删除用户原文。用户原文中的人物数量、人物关系、时代、地点、动作、内容类型和是否存在商品都是不可变事实。禁止提前编写完整故事、人物设定、场景清单、脚本、分镜、机位或执行步骤。';
  if (isNarrative(source)) {
    return `当 mode 是 brief_goal 时，当前是用户明确选择的纯剧情任务，只扩写“剧情表达目标”，并以一段“剧情表达补充”返回；围绕人物、关系、地点、事件、情绪和主题说明故事想让观众理解或感受到什么。${shared} 禁止添加产品、商品、服务、购买、卖点、品牌、营销、传播或销售转化。`;
  }
  return `当 mode 是 brief_goal 时，当前是用户明确选择的广告任务，只扩写“广告传播目标”，并以一段“广告目标补充”返回；围绕已确认的产品或服务、目标人群、核心价值、可信依据和期望行动补充，不得编造功效、价格、资质或品牌事实。${shared}`;
}

function outputSchema(source = {}) {
  const description = isNarrative(source)
    ? '只包含剧情表达补充的中文段落，100-260 字；围绕人物、关系、地点、事件、情绪和主题；不得复述、改写或省略用户原文；不得添加商品、品牌、卖点、购买、营销、传播或转化'
    : '只包含广告目标补充的中文段落，100-260 字；围绕产品或服务、目标人群、核心价值、可信依据和期望行动；不得复述、改写或省略用户原文；不得编造功效、价格、资质或品牌事实';
  return `{
  "goal_addition": "${description}"
}`;
}

function buildResponse({ parsed = {}, context = {}, mode = 'brief_goal', modelResult = {} } = {}) {
  const source = cleanText(context.brief || context.content || '', 3000);
  const addition = normalize(assistedText(parsed));
  if (hasCommercialDrift(context, addition)) {
    const error = new Error('AI 补充内容把纯故事误写成了商品广告，原始输入已保留，请重试');
    error.code = 'ASSIST_BRIEF_GOAL_FACT_DRIFT';
    error.status = 422;
    throw error;
  }
  return {
    brief: source ? `${source}\n\n【${isNarrative(context) ? '剧情表达补充' : '广告目标补充'}】${addition}` : addition,
    original_brief: source,
    goal_addition: addition,
    mode,
    model_meta: {
      used_model: modelResult.used_model,
      fallback_used: modelResult.fallback_used,
      failed_models: modelResult.failed_models,
    },
  };
}

module.exports = { isMode, assertInput, validateRaw, systemRule, outputSchema, buildResponse, normalize, hasCommercialDrift, isNarrative, modePrompt, assistantRole, taskRule };
