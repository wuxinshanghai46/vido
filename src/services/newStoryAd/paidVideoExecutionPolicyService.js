const PAID_EXECUTION_POLICY_VERSION = 'story-ad-paid-execution-v1';

const EXTERNAL_BOOLEAN_CONTROLS = [
  'continue_after_unit_failure',
  'continueAfterUnitFailure',
  'allow_throttle_retry',
  'allowThrottleRetry',
  'allow_local_fallback',
  'allowLocalFallback',
  'allow_video_model_fallback',
  'allowVideoModelFallback',
  'parallel_videos',
  'parallelVideos',
  'adaptive_video_concurrency',
  'adaptiveVideoConcurrency',
];

const EXTERNAL_CONCURRENCY_CONTROLS = [
  'video_concurrency',
  'videoConcurrency',
  'video_max_concurrency',
  'videoMaxConcurrency',
];

// 费用、供应商能力和时序锚点认证只能来自服务端，不能由 HTTP 请求声明。
const SERVER_OWNED_CONTROLS = [
  'usd_cny_rate',
  'usdCnyRate',
  'cost_safety_factor',
  'costSafetyFactor',
  'minimum_billable_seconds',
  'minimumBillableSeconds',
  'provider_capability_registry',
  'providerCapabilityRegistry',
  'provider_supports_continuous_generation',
  'providerSupportsContinuousGeneration',
  'provider_supports_temporal_multi_keyframe',
  'providerSupportsTemporalMultiKeyframe',
  'provider_temporal_reference_count',
  'providerTemporalReferenceCount',
  'adapter_supports_temporal_anchor_binding',
  'adapterSupportsTemporalAnchorBinding',
];

function policyError(key = '') {
  const error = new Error(`付费视频执行参数 ${key} 只能由服务端控制，本次没有提交视频模型。`);
  error.code = 'VIDEO_PAID_EXECUTION_OPTION_FORBIDDEN';
  error.status = 422;
  error.retryable = false;
  error.details = { option: key, policy_version: PAID_EXECUTION_POLICY_VERSION };
  return error;
}

/** 在进入后台队列前拒绝试图开启重试、并发或 fallback 的外部请求。 */
function assertExternalRequest(options = {}) {
  for (const key of EXTERNAL_BOOLEAN_CONTROLS) {
    if (options[key] === true) throw policyError(key);
  }
  for (const key of EXTERNAL_CONCURRENCY_CONTROLS) {
    if (Object.prototype.hasOwnProperty.call(options, key) && Number(options[key]) > 1) {
      throw policyError(key);
    }
  }
  for (const key of SERVER_OWNED_CONTROLS) {
    if (Object.prototype.hasOwnProperty.call(options, key)) throw policyError(key);
  }
  return true;
}

/**
 * 构造服务端拥有的唯一付费执行参数。
 * 保留用户确认的镜头范围、费用指纹和媒体配置，但移除费用与能力伪造入口。
 */
function canonicalize(options = {}) {
  const next = { ...options };
  SERVER_OWNED_CONTROLS.forEach(key => { delete next[key]; });
  return {
    ...next,
    continue_after_unit_failure: false,
    continueAfterUnitFailure: false,
    allow_throttle_retry: false,
    allowThrottleRetry: false,
    allow_local_fallback: false,
    allowLocalFallback: false,
    allow_video_model_fallback: false,
    allowVideoModelFallback: false,
    parallel_videos: false,
    parallelVideos: false,
    adaptive_video_concurrency: false,
    adaptiveVideoConcurrency: false,
    video_concurrency: 1,
    videoConcurrency: 1,
    video_max_concurrency: 1,
    videoMaxConcurrency: 1,
    _paidExecution: true,
    _paidExecutionPolicyVersion: PAID_EXECUTION_POLICY_VERSION,
  };
}

function isPaidExecution(options = {}) {
  return options._paidExecution === true
    && options._paidExecutionPolicyVersion === PAID_EXECUTION_POLICY_VERSION;
}

/** 供应商失败后的本地兜底只保留给明确的非付费内部工具。 */
function localFallbackAllowed(options = {}, env = process.env) {
  if (isPaidExecution(options)) return false;
  return options.allow_local_fallback === true
    || options.allowLocalFallback === true
    || env.NEW_STORY_AD_ALLOW_LOCAL_VIDEO_FALLBACK === '1';
}

function publicPolicy() {
  return {
    version: PAID_EXECUTION_POLICY_VERSION,
    automatic_paid_retry_count: 0,
    continue_after_unit_failure: false,
    provider_error_local_fallback: false,
    parallel_paid_units: false,
  };
}

/** 付费批次只要有一个单元失败，就把已完成片段作为证据带回并立即终止。 */
function assertBatchSucceeded(result = {}, clips = [], fallbackIndexes = []) {
  if (!Array.isArray(result.failures) || !result.failures.length) return true;
  const failure = result.failures[0];
  const error = new Error(failure.error || '当前付费生成单元失败，系统已停止自动重试。');
  error.code = failure.error_code || 'SCENE_BLOCK_GENERATION_FAILED';
  error.retryable = failure.retryable === true;
  error.billingState = failure.billing_state || 'unknown';
  error.partial_video_clips = clips.slice();
  error.failed_indexes = result.failed_indexes || failure.indexes || fallbackIndexes;
  throw error;
}

module.exports = {
  PAID_EXECUTION_POLICY_VERSION,
  EXTERNAL_BOOLEAN_CONTROLS,
  EXTERNAL_CONCURRENCY_CONTROLS,
  SERVER_OWNED_CONTROLS,
  assertExternalRequest,
  canonicalize,
  isPaidExecution,
  localFallbackAllowed,
  publicPolicy,
  assertBatchSucceeded,
};
