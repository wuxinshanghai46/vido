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
  const error = new Error('请先输入一句广告想法，AI 才能帮你丰富目标；没有调用文本模型');
  error.code = 'ASSIST_BRIEF_GOAL_EMPTY';
  error.status = 400;
  throw error;
}

function normalize(value = '', fallback = '') {
  const text = cleanText(value || fallback);
  const chineseCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  if (chineseCount < 40) {
    const error = new Error('AI 返回的广告目标过于简略，请保留当前想法后重试');
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

function systemRule() {
  return '当 mode 是 brief_goal 时，只扩写“广告目标”这一项，并以一段“传播目标补充”返回；不得改写、摘要、替换或删除用户原文。用户原文中的人物数量、人物关系、时代、地点、动作、故事类型和是否存在商品都是不可变事实。如果产品或主题字段为空且原文没有明确商品、品牌或服务，必须按纯故事主题表达，禁止添加产品、商品、购买、卖点、品牌或销售转化。禁止提前编写完整故事、人物设定、场景清单、脚本、分镜、机位或执行步骤。';
}

function outputSchema() {
  return `{
  "goal_addition": "只包含传播目标补充的中文段落，100-260 字；不得复述、改写或省略用户原文；纯故事任务不得添加商品、品牌、卖点、购买或转化"
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
    brief: source ? `${source}\n\n【传播目标补充】${addition}` : addition,
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

module.exports = { isMode, assertInput, validateRaw, systemRule, outputSchema, buildResponse, normalize, hasCommercialDrift };
