const { cleanText } = require('./contextBuilder');

const ERROR_MESSAGES = Object.freeze({
  VISION_REFERENCE_UNAVAILABLE: '参考图片无法提供给视觉审核，请检查图片地址后重试',
  VISION_QA_UNAVAILABLE: '视觉审核服务暂时不可用，请稍后重试',
  VISION_CIRCUIT_OPEN: '视觉审核服务当前繁忙，请稍后重试',
  VISION_QA_SCHEMA_INVALID: '视觉审核返回的数据不完整，请重新验证',
  VISION_QA_IMAGE_UNREADABLE: '视觉审核未能读取参考图片，请检查图片后重试',
});

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

module.exports = { ERROR_MESSAGES, unavailable, rejected, verified, pending };
