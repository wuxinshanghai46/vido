const { cleanText } = require('./contextBuilder');

const ERROR_MESSAGES = Object.freeze({
  VISION_REFERENCE_UNAVAILABLE: '参考图片无法提供给视觉审核，请检查图片地址后重试',
  VISION_QA_UNAVAILABLE: '视觉审核服务暂时不可用，请稍后重试',
  VISION_CIRCUIT_OPEN: '视觉审核服务当前繁忙，请稍后重试',
  VISION_QA_SCHEMA_INVALID: '视觉审核返回的数据不完整，请重新验证',
  CAMERA_QA_SCHEMA_INVALID: '机位审核缺少结构化参数或可见证据，请重新验证',
  VISION_QA_IMAGE_UNREADABLE: '视觉审核未能读取参考图片，请检查图片后重试',
});

const REASON_RULES_ZH = Object.freeze([
  [/\b(?:shoe|shoes|footwear|sneaker|sneakers|heel|heels|boot|boots)\b/i, '不同视图中的鞋型、鞋跟或鞋子外观不一致。'],
  [/\b(?:wardrobe|outfit|clothing|clothes|garment|dress|shirt|jacket|trouser|pants|skirt|accessor)\w*\b/i, '不同视图中的服装、颜色或配饰不一致。'],
  [/\b(?:hair|hairstyle|bangs|ponytail|hairline)\b/i, '不同视图中的发型、发色或发际线不一致。'],
  [/\b(?:identity|face|facial|same person|different person)\b/i, '不同视图中的人物身份或面部特征不一致。'],
  [/\b(?:age|older|younger)\b/i, '不同视图中的人物年龄特征不一致。'],
  [/\b(?:body|proportion|anatomy|limb|hand|finger)\w*\b/i, '不同视图中的体态、身体比例或肢体结构不一致。'],
  [/\b(?:extra person|multiple people|person count|people count)\b/i, '画面中的人物数量与要求不一致。'],
  [/\b(?:watermark|logo|caption|subtitle|text)\b/i, '参考图中存在不应出现的文字、水印或标识。'],
  [/\b(?:collage|border|grid|panel)\b/i, '参考图存在拼图边框或分栏，无法作为独立视图验证。'],
]);

function hasChinese(value = '') {
  return /[\u3400-\u9fff]/u.test(String(value || ''));
}

function localizeReasonZh(reason = '', subject = '资产') {
  const value = cleanText(reason, 240);
  if (!value || hasChinese(value)) return value;
  const matched = REASON_RULES_ZH.find(([pattern]) => pattern.test(value));
  return matched?.[1] || `${subject}在不同视图中存在不一致，请根据验证评分重新生成或调整后复验。`;
}

function localizeReasonsZh(reasons = [], subject = '资产', qa = {}) {
  const localized = (Array.isArray(reasons) ? reasons : [])
    .map(reason => localizeReasonZh(reason, subject))
    .filter(Boolean);
  if (!localized.length && qa.pass !== true) {
    const dimensions = [
      ['identity_score', 0.82, '人物身份或面部特征'],
      ['age_score', 0.8, '年龄特征'],
      ['wardrobe_score', 0.85, '服装、鞋子或配饰'],
      ['body_score', 0.75, '体态或身体比例'],
    ].filter(([key, threshold]) => Number.isFinite(Number(qa[key])) && Number(qa[key]) < threshold)
      .map(([, , label]) => label);
    if (dimensions.length) localized.push(`${dimensions.join('、')}未达到跨视图一致性要求。`);
  }
  return [...new Set(localized)].slice(0, 12);
}

function unavailable(error = {}, fallbackMessage = '') {
  const code = cleanText(error.code || 'VISION_QA_UNAVAILABLE', 80);
  return {
    state: 'unavailable',
    code,
    message: ERROR_MESSAGES[code] || cleanText(fallbackMessage || error.message || '视觉审核暂时不可用，请稍后重试', 300),
    retryable: error.retryable !== false,
    reference_diagnostics: error.reference_diagnostics || null,
    checked_at: new Date().toISOString(),
  };
}

function rejected(reasons = [], fallbackMessage = '视觉一致性验证未通过') {
  const list = (Array.isArray(reasons) ? reasons : [])
    .map(value => cleanText(value, 240)).filter(Boolean).slice(0, 12);
  return {
    state: 'rejected',
    code: 'VISUAL_CONSISTENCY_REJECTED',
    message: list[0] || fallbackMessage,
    retryable: true,
    reasons: list,
    checked_at: new Date().toISOString(),
  };
}

function verified(model = '') {
  return {
    state: 'verified',
    code: '',
    message: '视觉一致性验证已通过',
    retryable: false,
    used_model: cleanText(model, 160),
    checked_at: new Date().toISOString(),
  };
}

function pending(message = '等待视觉一致性验证') {
  return {
    state: 'pending',
    code: '',
    message: cleanText(message, 300),
    retryable: true,
  };
}

module.exports = {
  ERROR_MESSAGES,
  localizeReasonZh,
  localizeReasonsZh,
  unavailable,
  rejected,
  verified,
  pending,
};
