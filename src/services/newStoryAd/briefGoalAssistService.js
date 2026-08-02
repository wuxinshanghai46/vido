const jsonRepair = require('./jsonRepairService');

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

function validateRaw(raw = '') {
  try {
    const parsed = jsonRepair.parseJson(raw, 'object');
    normalize(parsed.brief || parsed.content || '');
    return true;
  } catch {
    return false;
  }
}

function systemRule() {
  return '当 mode 是 brief_goal 时，只扩写“广告目标”这一项：保留用户的产品或主题，说明面向谁、要传达什么价值、希望观众形成什么认知或行动。禁止提前编写完整故事、人物设定、场景清单、脚本、分镜、机位或执行步骤。输出一个普通用户能直接修改的中文段落。';
}

function outputSchema() {
  return `{
  "brief": "只包含广告目标的完整中文段落，100-260 字；保留用户原意，不写故事、人物、场景、分镜、机位或执行步骤"
}`;
}

function buildResponse({ parsed = {}, context = {}, mode = 'brief_goal', modelResult = {} } = {}) {
  return {
    brief: normalize(parsed.brief || parsed.content || '', context.brief),
    mode,
    model_meta: {
      used_model: modelResult.used_model,
      fallback_used: modelResult.fallback_used,
      failed_models: modelResult.failed_models,
    },
  };
}

module.exports = { isMode, assertInput, validateRaw, systemRule, outputSchema, buildResponse, normalize };
