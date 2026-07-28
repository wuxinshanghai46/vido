function attempt({ generationId = '', status = 'failed', error = null, candidates = [] } = {}) {
  return {
    generation_id: generationId,
    status,
    ...(error ? {
      error: String(error.message || error),
      error_code: error.code || 'KEYFRAME_FAILED',
    } : {}),
    candidates: Array.isArray(candidates) ? candidates : [],
    finished_at: new Date().toISOString(),
  };
}

function isQaInfrastructureError(error) {
  const code = String(error?.code || '').toUpperCase();
  // Explicit media-generation codes are authoritative even when their text
  // contains the same 5xx wording as a downstream vision-QA outage.
  if (/^(?:IMAGE_|PROVIDER_|REFERENCE_IMAGE_|INPUT_)/.test(code)
    || ['INVALID_PROVIDER_INPUT', 'AUTH_CONFIG', 'MODEL_CONFIG', 'PROVIDER_BILLING', 'RATE_LIMIT'].includes(code)) return false;
  if (['VISION_QA_UNAVAILABLE', 'VISION_QA_SCHEMA_INVALID', 'CAMERA_QA_SCHEMA_INVALID', 'VISION_QA_IMAGE_UNREADABLE', 'VISION_CIRCUIT_OPEN', 'MODEL_ATTEMPTS_EXHAUSTED', 'TIMEOUT_OR_NETWORK'].includes(code)) return true;
  const message = String(error?.message || error || '');
  return /视觉模型全部失败|视觉模型未返回有效\s*JSON|视觉\s*QA.*(?:JSON|结构|评分)|vision.*invalid\s*json|invalid\s*json.*vision|timed?\s*out|timeout|ECONNRESET|socket hang up|rate limit|(?:HTTP\s*)?5\d\d/i.test(message);
}

/**
 * 供应商级或计费不确定错误必须停止本批次尚未提交的镜头，避免同类请求继续付费。
 * 单镜内容 QA 未通过不触发批次熔断，只阻断依赖该镜头的连续性分支。
 */
function shouldStopBatch(error) {
  const code = String(error?.code || '').toUpperCase();
  if ([
    'PROVIDER_CONTENT_AUDIT',
    'PROVIDER_RIGHTS_AUDIT',
    'PROVIDER_5XX_AMBIGUOUS',
    'PROVIDER_BILLING',
    'AUTH_CONFIG',
    'MODEL_CONFIG',
    'IMAGE_CIRCUIT_OPEN',
    'NEW_STORY_AD_IMAGE2_UNAVAILABLE',
  ].includes(code)) return true;
  if (error?.billingState === 'unknown' || error?.billing_state === 'unknown') return true;
  return Array.isArray(error?.attempts) && error.attempts.some(attempt => [
    'PROVIDER_CONTENT_AUDIT',
    'PROVIDER_RIGHTS_AUDIT',
    'PROVIDER_5XX_AMBIGUOUS',
    'PROVIDER_BILLING',
  ].includes(String(attempt?.code || '').toUpperCase()) || attempt?.billing_state === 'unknown');
}

function describeBatchFailures({ targetIndexes = [], keyframes = [], shots = [], isComplete = () => false } = {}) {
  return targetIndexes
    .filter(index => !isComplete(keyframes[index]) || keyframes[index]?.qa?.pass !== true)
    .map(index => ({
      index,
      shot_number: index + 1,
      title: shots[index]?.title || `镜头 ${index + 1}`,
      code: keyframes[index]?.error_code || keyframes[index]?.latest_attempt?.error_code || 'KEYFRAME_FAILED',
      message: keyframes[index]?.error || keyframes[index]?.latest_attempt?.error || '分镜图生成或视觉审核未通过',
      status: keyframes[index]?.current_generation_status || 'failed',
      candidate_exists: Array.isArray(keyframes[index]?.candidates)
        && keyframes[index].candidates.some(candidate => candidate?.image_url || candidate?.url),
    }));
}

function batchError(failures = [], keyframes = [], attempts = []) {
  const error = new Error(`第 ${failures.map(item => item.shot_number).join('、')} 镜未生成可用分镜图；已保留成功镜头，可仅补齐失败镜头。`);
  error.code = 'KEYFRAME_BATCH_PARTIAL_FAILURE';
  error.retryable = true;
  error.details = failures;
  error.keyframes = keyframes;
  error.attempts = attempts;
  return error;
}

function taskSummaryPatch(task = {}, keyframes = []) {
  const supportId = task.support_id || task.generation_progress?.generation_id || '';
  const legacyFailure = String(task.stage || '') === 'keyframes_failed'
    && ['UNKNOWN', 'KEYFRAME_GENERATION_FAILED', ''].includes(String(task.error_code || ''));
  if (!legacyFailure) return {
    error: task.error || '',
    error_code: task.error_code || '',
    retryable: task.retryable === true,
    support_id: supportId,
  };
  const failedShots = keyframes
    .map((frame, index) => frame?.error || ['failed', 'rejected', 'qa_unavailable', 'blocked'].includes(frame?.current_generation_status) ? index + 1 : 0)
    .filter(Boolean);
  if (!failedShots.length) return { error: task.error || '', error_code: task.error_code || '', retryable: task.retryable === true, support_id: supportId };
  return {
    error: `${supportId ? `支持编号：${supportId}。` : ''}第 ${failedShots.join('、')} 镜未生成可用分镜图；已保留成功镜头，可仅补齐失败镜头。`,
    error_code: 'KEYFRAME_BATCH_PARTIAL_FAILURE',
    retryable: true,
    support_id: supportId,
  };
}

module.exports = { attempt, isQaInfrastructureError, shouldStopBatch, describeBatchFailures, batchError, taskSummaryPatch };
