const DEFAULT_ERROR_MESSAGE = '操作失败，请稍后重试；如果问题持续，请联系管理员并提供请求编号。';

const ERROR_MESSAGES = Object.freeze({
  INTERNAL_ERROR: DEFAULT_ERROR_MESSAGE,
  TASK_NOT_FOUND: '没有找到对应项目，项目可能已删除或当前账号无权访问。',
  INVALID_ARGUMENT: '提交的参数不完整或格式不正确，请检查后重试。',
  VIDEO_PLAN_INVALID: '视频执行方案不完整，已停止生成以避免错误扣费。',
  VIDEO_PREFLIGHT_CONFIRMATION_REQUIRED: '视频生成方案尚未确认或内容已经变化，请重新查看并确认生成方案。',
  VIDEO_COST_PRICE_UNKNOWN: '当前视频模型没有可信的人民币计费单价，已停止付费生成。',
  VIDEO_COST_CONFIRMATION_REQUIRED: '尚未确认本次视频生成的人民币最高费用，已停止付费生成。',
  VIDEO_COST_LIMIT_EXCEEDED: '本次预计最高费用超过已确认上限，已停止付费生成。',
  VIDEO_DUPLICATE_SUBMISSION: '相同的视频生成方案已经提交，已阻止重复扣费。',
  VIDEO_COMPLEXITY_REVIEW_REQUIRED: '当前人物或场景复杂度较高，请先确认动画预演和镜头拆分方案。',
  VIDEO_DEPENDENCY_CYCLE: '镜头连续性依赖存在循环，请调整镜头顺序后重试。',
  VIDEO_SHOT_INDEX_INVALID: '指定的镜头序号无效，已停止生成以避免误生成全部镜头。',
  MODEL_CAPACITY: '当前模型服务繁忙，请稍后重试或选择其他可用模型。',
  MODEL_CONFIG: '当前模型配置不可用，请联系管理员检查模型设置。',
  PROVIDER_BILLING: '供应商余额、额度或计费状态异常，已停止继续提交。',
  PROVIDER_RIGHTS_AUDIT: '供应商判定输入可能涉及版权、商标、角色或人物肖像授权，已停止自动重试；请确认素材权利或改用原创内容。',
  PROVIDER_CONTENT_AUDIT: '供应商内容审核未通过，已停止自动重试；请检查素材和生成要求。',
  PROVIDER_5XX_AMBIGUOUS: '供应商返回 5xx；该状态可能同时表示版权/审核拦截或服务异常，已停止自动付费重试，请先检查授权和输入内容。',
  TIMEOUT_OR_NETWORK: '模型服务响应超时或网络中断，本次任务已停止，请稍后从当前阶段重试。',
  USER_CANCELLED: '用户已取消当前生成。',
});

/** 判断消息中是否已经包含可直接展示的中文。 */
function containsChinese(value = '') {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

/** 根据错误码返回统一的中文用户提示。 */
function messageForCode(code = '', fallback = '') {
  const normalizedCode = String(code || 'INTERNAL_ERROR').trim().toUpperCase();
  if (ERROR_MESSAGES[normalizedCode]) return ERROR_MESSAGES[normalizedCode];
  if (containsChinese(fallback)) return String(fallback).trim();
  return DEFAULT_ERROR_MESSAGE;
}

/** 把供应商或系统错误归一为不会泄露内部细节的中文提示。 */
function classifyChineseMessage(error = null, fallback = '') {
  const raw = String(error?.message || error || fallback || '').trim();
  const code = String(error?.code || '').trim().toUpperCase();
  if (containsChinese(raw)) return raw;
  if (/capacity|overloaded|too busy|model.*busy/i.test(raw)) return ERROR_MESSAGES.MODEL_CAPACITY;
  if (/billing|balance|credit|quota|payment|insufficient/i.test(raw)) return ERROR_MESSAGES.PROVIDER_BILLING;
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|socket hang up/i.test(raw)) return ERROR_MESSAGES.TIMEOUT_OR_NETWORK;
  if (/model.*not found|configuration not found|not available|disabled/i.test(raw)) return ERROR_MESSAGES.MODEL_CONFIG;
  return messageForCode(code, fallback);
}

/** 创建带稳定错误码、HTTP 状态和中文提示的领域错误。 */
class VideoGenerationError extends Error {
  constructor(code = 'INTERNAL_ERROR', message = '', options = {}) {
    super(messageForCode(code, message));
    this.name = 'VideoGenerationError';
    this.code = String(code || 'INTERNAL_ERROR').toUpperCase();
    this.status = Number(options.status || 400);
    this.retryable = options.retryable === true;
    if (options.details !== undefined) this.details = options.details;
  }
}

/** 保留原错误的技术字段，同时保证对外消息为中文。 */
function ensureChineseError(error = null, options = {}) {
  const source = error instanceof Error ? error : new Error(String(error || ''));
  const code = String(source.code || options.code || 'INTERNAL_ERROR').toUpperCase();
  source.code = code;
  source.status = Number(source.status || options.status || 500);
  source.retryable = source.retryable === true || options.retryable === true;
  source.technical_message = containsChinese(source.message) ? '' : String(source.message || '').slice(0, 1000);
  source.message = classifyChineseMessage(source, options.fallback || '');
  return source;
}

module.exports = {
  DEFAULT_ERROR_MESSAGE,
  ERROR_MESSAGES,
  VideoGenerationError,
  containsChinese,
  messageForCode,
  classifyChineseMessage,
  ensureChineseError,
};
