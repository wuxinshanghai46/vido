'use strict';

const INTERNAL_FAILURE = /(?:new_story_ad|\b(?:provider|model|stage|candidate|request|task)[-_ ]?id\b|供应商|模型调用|本阶段候选|全部可用候选|实际尝试|TIMEOUT_OR_NETWORK|PROVIDER_5XX|RATE_LIMIT|apismile|gpt-[\w.-]+|支持编号)/i;

function normalize(value = '', max = 900) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function withoutSupportId(value = '') {
  return String(value || '')
    .replace(/(?:支持编号|任务编号|请求编号|support(?:\s+|_)?id|request(?:\s+|_)?id|task(?:\s+|_)?id)\s*[:：]\s*[\w-]+[。；;]?/gi, '')
    .replace(/\s+/g, ' ').trim();
}

function publicFailureMessage(value = '', clean = normalize) {
  const stripped = withoutSupportId(value);
  if (!stripped) return '';
  if (INTERNAL_FAILURE.test(stripped)) return '本次生成暂时没有完成，已成功保存人物身份和现有资产，请稍后从当前步骤重新生成。';
  return clean(stripped, 220);
}

function publicStage(value = '') {
  const stage = normalize(value, 80).toLowerCase();
  if (/asset[_\s.-]?plan|person[_\s.-]?plan/.test(stage)) return 'person_plan';
  if (stage.startsWith('new_story_ad.')) return stage.slice('new_story_ad.'.length).replace(/[^a-z0-9_-]/g, '');
  return stage;
}

function publicErrorCode(code = '', message = '') {
  const normalized = normalize(code, 100).toUpperCase();
  if (!normalized) return '';
  if (INTERNAL_FAILURE.test(`${normalized} ${message}`) || /^(?:TIMEOUT_OR_NETWORK|PROVIDER_5XX|RATE_LIMIT|MODEL_ATTEMPTS_EXHAUSTED)$/.test(normalized)) return 'GENERATION_INCOMPLETE';
  return normalized;
}

function publicProgress(progress = null, clean = normalize) {
  if (!progress || typeof progress !== 'object') return null;
  const batchSceneIds = Array.isArray(progress.batch_scene_ids)
    ? [...new Set(progress.batch_scene_ids.map(item => clean(item, 120)).filter(Boolean))].slice(0, 30)
    : [];
  return {
    status: clean(progress.status, 40), stage: publicStage(progress.stage),
    mode: clean(progress.mode, 40),
    completed: Math.max(0, Number(progress.completed || 0) || 0), total: Math.max(0, Number(progress.total || 0) || 0),
    generated: Math.max(0, Number(progress.generated || 0) || 0), qa_passed: Math.max(0, Number(progress.qa_passed || 0) || 0),
    processed: Math.max(0, Number(progress.processed || 0) || 0), failed: Math.max(0, Number(progress.failed || 0) || 0),
    percent: Math.max(0, Math.min(100, Number(progress.percent ?? progress.progress ?? 0) || 0)), phase: clean(progress.phase, 80),
    target_total: Math.max(0, Number(progress.target_total || 0) || 0),
    succeeded: Math.max(0, Number(progress.succeeded || 0) || 0),
    image_target_total: Math.max(0, Number(progress.image_target_total || 0) || 0),
    image_processed: Math.max(0, Number(progress.image_processed || 0) || 0),
    image_succeeded: Math.max(0, Number(progress.image_succeeded || 0) || 0),
    image_failed: Math.max(0, Number(progress.image_failed || 0) || 0),
    image_percent: Math.max(0, Math.min(100, Number(progress.image_percent || 0) || 0)),
    current_scene_id: clean(progress.current_scene_id, 120),
    current_scene_name: clean(progress.current_scene_name, 160),
    current_action: clean(progress.current_action, 80),
    current_view_key: clean(progress.current_view_key, 80),
    current_view_label: clean(progress.current_view_label, 120),
    batch_scene_ids: batchSceneIds,
    message: ['failed', 'error'].includes(progress.status) ? taskFailureMessage({ stage: publicStage(progress.stage), error: progress.message }, clean) : publicFailureMessage(progress.message, clean), started_at: clean(progress.started_at, 80),
    updated_at: clean(progress.updated_at, 80), finished_at: clean(progress.finished_at, 80),
  };
}

function taskFailureMessage(task = {}, clean = normalize) {
  const stage = String(task.active_stage || task.stage || '').toLowerCase();
  if (task.error && (/^(?:video|media|compose)(?:_|$)/.test(stage) || /^VIDEO_/.test(task.error_code || ''))) return '视频生成失败。';
  return publicFailureMessage(task.error, clean);
}

function authorizedFailureMessage(code = '', message = '') {
  const source = `${normalize(code, 160)} ${normalize(message, 1800)}`.toLowerCase();
  if (!source.trim()) return '';
  if (/(?:insufficient[_\s-]?quota|provider_billing|余额不足|额度不足|余额、额度|billing|payment|required credits?|not enough credits?)/i.test(source)) {
    return '当前视频供应商余额或额度不足，视频任务未能开始。请联系管理员补充额度，或选择其他可用模型。';
  }
  if (/(?:organization[_\s-]?access[_\s-]?denied|access[_\s-]?denied|未开通(?:模型)?能力|无访问权限)/i.test(source)) {
    return '当前视频供应商账号未开通该模型能力或无访问权限，请联系管理员处理。';
  }
  if (/(?:invalid[_\s-]?api[_\s-]?key|api\s*key.{0,16}(?:无效|缺失)|令牌无效|unauthorized|\b401\b)/i.test(source)) {
    return '当前视频供应商 API Key 无效或缺失，请联系管理员更新配置。';
  }
  if (/(?:rate[_\s-]?limit[_\s-]?exceeded|rate[_\s-]?limit|限流|too many requests|\b429\b)/i.test(source)) {
    return '当前视频供应商请求已触发限流，请稍后重试。';
  }
  if (/(?:video[_\s-]?upstream[_\s-]?unavailable|upstream.{0,12}unavailable|上游暂不可用|\b502\b)/i.test(source)) {
    return '当前视频供应商上游暂不可用，请稍后重试。';
  }
  if (/(?:video[_\s-]?task[_\s-]?not[_\s-]?found|任务不存在|任务已被删除|\b404\b)/i.test(source)) {
    return '供应商侧未找到对应视频任务，任务可能不存在或已被删除。';
  }
  if (/(?:\bconflict\b|状态不允许|\b409\b)/i.test(source)) {
    return '供应商侧任务当前状态不允许该操作，请刷新状态后重试。';
  }
  if (/(?:invalid[_\s-]?request|\bbadrequest\b|参数或状态不合法|请求参数错误|\b400\b)/i.test(source)) {
    return '供应商拒绝了当前请求：参数或任务状态不合法，请联系管理员核对配置。';
  }
  if (/(?:video[_\s-]?internal[_\s-]?error|provider_5xx|internalservererror|服务内部错误|\b5\d\d\b)/i.test(source)) {
    return '当前视频供应商服务内部错误，请稍后重试。';
  }
  return '';
}

function project(task = {}, { isAdmin = false, clean = normalize } = {}) {
  const public_error = taskFailureMessage(task, clean);
  const generation_progress = publicProgress(task.generation_progress, clean);
  const technical_diagnostics = isAdmin ? {
    error: clean(task.error, 1200), error_code: clean(task.error_code, 100),
    operator_error: authorizedFailureMessage(task.error_code, task.error),
    support_id: clean(task.support_id || task.generation_progress?.support_id, 120),
    generation_progress: task.generation_progress && typeof task.generation_progress === 'object' ? task.generation_progress : null,
  } : null;
  return { public_error, generation_progress, technical_diagnostics };
}

function publicTask(task = {}, { isAdmin = false } = {}) {
  if (!task || typeof task !== 'object') return task;
  if (isAdmin) return { ...task };
  const projected = project(task);
  const safe = { ...task, error: projected.public_error, error_code: publicErrorCode(task.error_code, task.error), generation_progress: projected.generation_progress };
  delete safe.support_id;
  delete safe.diagnostics;
  return safe;
}

function submissionFailure(record, canViewErrors = false, { activePlanEligible = false } = {}) {
  if (!record?.finished_at || record.status !== 'failed') return null;
  const errorCode = normalize(record.diagnostics?.error_code || record.error_code, 100).toUpperCase();
  if (activePlanEligible && ['GENERATION_ACTIVE_PLAN_REQUIRED', 'GENERATION_RELEASE_SYNC_BLOCKED'].includes(errorCode)) return null;
  return { finished_at: record.finished_at, error: '视频生成失败。', ...(canViewErrors ? { technical_diagnostics: { error: normalize(record.error, 1200), error_code: normalize(record.diagnostics?.error_code || record.error_code, 100), operator_error: authorizedFailureMessage(record.diagnostics?.error_code || record.error_code, record.error) } } : {}) };
}

module.exports = { authorizedFailureMessage, submissionFailure, taskFailureMessage, project, publicErrorCode, publicFailureMessage, publicProgress, publicStage, publicTask, withoutSupportId };
