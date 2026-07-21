const { v4: uuidv4 } = require('uuid');
const storage = require('./storageService');
const cancellation = require('./cancellationContext');
const videoCore = require('../videoGenerationCore');

const runningJobs = new Map();
const EXECUTING_STAGES = new Set(['full', 'scene_config', 'blueprint', 'storyboard', 'scene_asset', 'keyframes', 'tts', 'video', 'compose', 'media']);
const ORPHAN_GRACE_MS = Math.max(30000, Number(process.env.NEW_STORY_AD_ORPHAN_GRACE_MS) || 120000);
const ORPHAN_RECONCILE_INTERVAL_MS = Math.max(30000, Math.min(60000, ORPHAN_GRACE_MS));
const DEFAULT_STAGE_BUDGETS = Object.freeze({
  scene_config: 120000,
  blueprint: 480000,
  storyboard: 480000,
  scene_asset: 600000,
  keyframes: 900000,
  tts: 600000,
  video: 1800000,
  compose: 600000,
  media: 3600000,
  full: 3600000,
});

function stageBudgetMs(stage = '') {
  const key = String(stage || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const configured = Number(process.env[`NEW_STORY_AD_${key}_BUDGET_MS`]);
  return Math.max(5000, Number.isFinite(configured) && configured > 0 ? configured : (DEFAULT_STAGE_BUDGETS[stage] || 600000));
}

function jobKey(taskId) {
  return String(taskId);
}

/** 将后台任务失败归类，并保证持久化到项目中的错误提示为中文。 */
function classifyFailure(error) {
  const rawMessage = String(error?.message || error || '未知错误');
  const message = videoCore.chineseError.classifyChineseMessage(error, '后台任务执行失败，请稍后从当前阶段重试。');
  if (String(error?.code || '') === 'PROVIDER_CONTENT_AUDIT') {
    return {
      code: 'PROVIDER_CONTENT_AUDIT',
      retryable: false,
      message: '剧本内容触发供应商审核，已停止继续调用。请移除未经授权的品牌/IP、公众人物、角色复刻或指定艺术家风格后重新生成。',
    };
  }
  if (String(error?.code || '') === 'KEYFRAME_BATCH_PARTIAL_FAILURE') {
    return {
      code: 'KEYFRAME_BATCH_PARTIAL_FAILURE',
      retryable: true,
      message: rawMessage,
    };
  }
  if (error?.code) {
    return { code: String(error.code), retryable: error.retryable === true, message };
  }
  if (/token not valid|invalid.*token|api key|unauthorized|401|403/i.test(rawMessage)) {
    return { code: 'AUTH_CONFIG', retryable: false, message: '模型访问凭证无效，请联系管理员检查模型配置。' };
  }
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|socket hang up/i.test(rawMessage)) {
    return { code: 'TIMEOUT_OR_NETWORK', retryable: true, message };
  }
  if (/429|rate limit|quota|频率|额度/i.test(rawMessage)) {
    return { code: 'RATE_LIMIT', retryable: true, message: '模型调用频率或额度已达到限制，请稍后重试。' };
  }
  if (/JSON_PARSE|Unexpected end|Unexpected token/i.test(rawMessage)) {
    return { code: 'MODEL_JSON', retryable: true, message: '模型返回内容格式不完整，请从当前阶段重试。' };
  }
  if (/model.*not found|configuration not found|not available|disabled|没有可用|不是可用/i.test(rawMessage)) {
    return { code: 'MODEL_CONFIG', retryable: false, message };
  }
  if (/\b5\d\d\b|Internal Server Error|provider.*fail/i.test(rawMessage)) {
    return { code: 'PROVIDER_5XX', retryable: true, message: '模型供应商暂时异常，请稍后从当前阶段重试。' };
  }
  return { code: 'UNKNOWN', retryable: false, message };
}

function withSupportId(message = '', supportId = '') {
  const text = String(message || '').trim();
  if (!supportId || text.includes(String(supportId))) return text;
  return `支持编号：${supportId}。${text}`.trim();
}

function sanitizedFailureDetails(error = null) {
  const details = Array.isArray(error?.details) ? error.details : [];
  return details.slice(0, 50).map(item => ({
    shot_number: Number(item?.shot_number || 0) || 0,
    title: String(item?.title || '').slice(0, 120),
    code: String(item?.code || '').slice(0, 100),
    message: String(item?.message || '').slice(0, 500),
    status: String(item?.status || '').slice(0, 80),
    candidate_exists: item?.candidate_exists === true,
  }));
}

/**
 * 媒体任务会依次写入 tts/video/compose 子阶段进度；收尾必须按同一个 generation_id
 * 归档，不能要求子阶段名与外层 job stage（media）完全相同。
 */
function terminalGenerationProgress(task = {}, jobStage = '', generationId = '', patch = {}) {
  const progress = task.generation_progress;
  if (!progress || typeof progress !== 'object') return null;
  const progressGenerationId = String(progress.generation_id || '');
  const jobGenerationId = String(generationId || '');
  const bothHaveGenerationIds = !!progressGenerationId && !!jobGenerationId;
  const sameGeneration = bothHaveGenerationIds && progressGenerationId === jobGenerationId;
  const sameStage = String(progress.stage || '') === String(jobStage || '');
  if (bothHaveGenerationIds ? !sameGeneration : !sameStage) return null;
  return { ...progress, ...patch };
}

function publicJob(job = {}) {
  return {
    id: job.id,
    task_id: job.taskId,
    stage: job.stage,
    status: job.status,
    queued_at: job.queuedAt,
    started_at: job.startedAt || '',
    finished_at: job.finishedAt || '',
    error_code: job.errorCode || '',
    error: job.error || '',
    support_id: job.supportId || job.id || '',
    retryable: job.retryable === true,
  };
}

function getJob(taskId, stage) {
  const job = runningJobs.get(jobKey(taskId)) || null;
  return !stage || job?.stage === stage ? job : null;
}

function interruptedPatch(task = {}, reason = '后台工作进程已重启，原任务已停止，可从当前阶段重新执行') {
  return {
    status: 'failed',
    stage: `${String(task.active_stage || task.stage || 'generation').replace(/_(queued|running|failed|done)$/, '')}_failed`,
    active_stage: '',
    active_generation_id: '',
    generation_finished_at: new Date().toISOString(),
    error: reason,
    error_code: 'WORKER_INTERRUPTED',
    retryable: true,
  };
}

function reconcileInterruptedJobs({ now = Date.now() } = {}) {
  const tasks = storage.readDb().tasks || [];
  const result = { interrupted: 0, normalized: 0 };
  for (const task of tasks) {
    if (!task?.id || runningJobs.has(jobKey(task.id))) continue;
    const status = String(task.status || '').toLowerCase();
    const stage = String(task.stage || '');
    const updatedAt = Date.parse(task.generation_started_at || task.updated_at || task.created_at || 0) || 0;
    const stale = !updatedAt || now - updatedAt >= ORPHAN_GRACE_MS;
    if (task.active_generation_id && stale) {
      storage.saveStage(task.id, task.active_stage || stage || 'generation', {
        status: 'failed',
        error: '后台工作进程已重启，任务已停止并释放，可安全重试',
        diagnostics: { error_code: 'WORKER_INTERRUPTED', retryable: true, reconciled_at: new Date(now).toISOString() },
      });
      storage.updateTask(task.id, interruptedPatch(task));
      result.interrupted += 1;
      continue;
    }
    if (!task.active_generation_id && ['queued', 'running'].includes(status)) {
      if (/_done$|_ready$/.test(stage)) {
        storage.updateTask(task.id, { status: 'done', active_stage: '', active_generation_id: '', error: '', error_code: '', retryable: false });
        result.normalized += 1;
      } else if (stale && (/_queued$|_running$/.test(stage) || EXECUTING_STAGES.has(stage))) {
        storage.updateTask(task.id, interruptedPatch(task));
        result.interrupted += 1;
      }
    }
  }
  return result;
}

function cancelJob(taskId, { generationId = '', cancelledBy = '' } = {}) {
  const key = jobKey(taskId);
  const task = storage.getTask(taskId);
  const job = runningJobs.get(key) || null;
  if (!task) return { cancelled: false, not_found: true, job: null };
  if (!job || !['queued', 'running'].includes(job.status)) {
    return {
      cancelled: String(task.status || '') === 'cancelled',
      already_cancelled: String(task.status || '') === 'cancelled',
      not_running: String(task.status || '') !== 'cancelled',
      job: job ? publicJob(job) : null,
    };
  }
  if (generationId && String(generationId) !== String(job.id)) {
    return { cancelled: false, conflict: true, job: publicJob(job) };
  }
  const finishedAt = new Date().toISOString();
  cancellation.cancel(job.id, { taskId: String(taskId), stage: job.stage, cancelledBy });
  job.status = 'cancelled';
  job.finishedAt = finishedAt;
  job.errorCode = 'USER_CANCELLED';
  job.error = '用户已取消当前生成';
  job.retryable = true;
  storage.saveStage(taskId, job.stage, {
    status: 'cancelled',
    started_at: job.startedAt || job.queuedAt,
    finished_at: finishedAt,
    output_summary: '用户取消，已停止后续调用和结果写入',
    diagnostics: { generation_id: job.id, error_code: 'USER_CANCELLED', cancelled_by: cancelledBy || '' },
  });
  storage.updateTask(taskId, {
    status: 'cancelled',
    stage: `${job.stage}_cancelled`,
    active_stage: '',
    active_generation_id: '',
    generation_finished_at: finishedAt,
    error: '',
    error_code: 'USER_CANCELLED',
    retryable: true,
    cancelled_at: finishedAt,
    cancelled_by: cancelledBy || '',
    generation_progress: {
      ...(task.generation_progress || {}),
      status: 'cancelled',
      finished_at: finishedAt,
      updated_at: finishedAt,
    },
  });
  setTimeout(() => cancellation.forget(job.id), 60 * 60 * 1000).unref?.();
  return { cancelled: true, already_cancelled: false, job: publicJob(job) };
}

function queueStage({ taskId, stage, execute, deadlineMs = 0 }) {
  if (!taskId || !stage || typeof execute !== 'function') throw new Error('剧情广告后台任务参数不完整');
  const key = jobKey(taskId);
  const active = runningJobs.get(key);
  if (active && ['queued', 'running'].includes(active.status)) {
    return { accepted: false, duplicate: true, job: publicJob(active) };
  }
  const persisted = storage.getTask(taskId);
  if (persisted?.active_generation_id && !active) {
    const reconciled = reconcileInterruptedJobs();
    const current = storage.getTask(taskId);
    if (current?.active_generation_id) {
      return { accepted: false, duplicate: true, job: publicJob({ id: current.active_generation_id, taskId, stage: current.active_stage || stage, status: current.status || 'running', queuedAt: current.generation_queued_at, startedAt: current.generation_started_at }) };
    }
    if (reconciled.interrupted) storage.updateTask(taskId, { retryable: true });
  }

  const id = uuidv4();
  const queuedAt = new Date().toISOString();
  const job = {
    id,
    taskId: String(taskId),
    stage: String(stage),
    status: 'queued',
    queuedAt,
    startedAt: '',
    finishedAt: '',
    errorCode: '',
    error: '',
    retryable: false,
    supportId: id,
    deadlineMs: Math.max(5000, Number(deadlineMs) || stageBudgetMs(stage)),
  };
  runningJobs.set(key, job);
  storage.updateTask(taskId, {
    status: 'queued',
    stage: `${stage}_queued`,
    active_stage: stage,
    active_generation_id: id,
    generation_queued_at: queuedAt,
    generation_started_at: '',
    generation_finished_at: '',
    generation_progress: null,
    error: '',
    error_code: '',
    support_id: '',
  });
  storage.saveStage(taskId, stage, {
    status: 'queued',
    started_at: queuedAt,
    diagnostics: { generation_id: id },
  });

  setImmediate(() => {
    const execution = cancellation.run({ generationId: id, taskId, stage, deadlineMs: job.deadlineMs }, async () => {
    if (cancellation.isCancelled(id)) {
      setTimeout(() => {
        if (runningJobs.get(key)?.id === id) runningJobs.delete(key);
      }, 5 * 60 * 1000).unref?.();
      return;
    }
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    storage.updateTask(taskId, {
      status: 'running',
      stage,
      active_stage: stage,
      active_generation_id: id,
      generation_started_at: job.startedAt,
      error: '',
      error_code: '',
    });
    storage.saveStage(taskId, stage, {
      status: 'running',
      started_at: job.startedAt,
      diagnostics: { generation_id: id },
    });
    try {
      await execute({ generationId: id, taskId, stage });
      cancellation.throwIfCancelled(taskId);
      job.status = 'succeeded';
      job.finishedAt = new Date().toISOString();
      const current = storage.getTask(taskId);
      if (String(current?.active_generation_id || '') === id) {
        const stageUnchanged = String(current?.stage || '') === String(stage);
        const needsTerminalStatus = ['queued', 'running'].includes(String(current?.status || ''));
        storage.updateTask(taskId, {
          ...(stageUnchanged ? { stage: `${stage}_done` } : {}),
          ...(needsTerminalStatus ? { status: 'done' } : {}),
          active_stage: '',
          active_generation_id: '',
          generation_finished_at: job.finishedAt,
          error: '',
          error_code: '',
          support_id: '',
        });
      }
    } catch (error) {
      if (error?.code !== 'STAGE_DEADLINE_EXCEEDED'
        && (error?.code === 'USER_CANCELLED' || error?.cancelled === true || cancellation.isCancelled(id))) {
        job.status = 'cancelled';
        job.finishedAt = job.finishedAt || new Date().toISOString();
        job.errorCode = 'USER_CANCELLED';
        job.error = '用户已取消当前生成';
        job.retryable = true;
        return;
      }
      const failure = classifyFailure(error);
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      job.errorCode = failure.code;
      job.supportId = id;
      job.error = withSupportId(failure.message, id).slice(0, 1000);
      job.retryable = failure.retryable;
      const failureDetails = sanitizedFailureDetails(error);
      const current = storage.getTask(taskId);
      if (String(current?.active_generation_id || '') === id) {
        const terminalProgress = terminalGenerationProgress(current, stage, id, {
          status: 'failed',
          error_code: failure.code,
          support_id: id,
          ...(failureDetails.length ? { failure_details: failureDetails } : {}),
          message: job.error,
          finished_at: job.finishedAt,
          updated_at: job.finishedAt,
        });
        storage.saveStage(taskId, stage, {
          status: 'failed',
          started_at: job.startedAt,
          finished_at: job.finishedAt,
          output_summary: '执行失败，未保存可用结果',
          error: job.error,
          diagnostics: {
            generation_id: id,
            support_id: id,
            error_code: failure.code,
            retryable: failure.retryable,
            ...(failureDetails.length ? { failure_details: failureDetails } : {}),
          },
        }, { systemFinalization: true });
        storage.updateTask(taskId, {
          status: 'failed',
          stage: `${stage}_failed`,
          active_stage: '',
          active_generation_id: '',
          generation_finished_at: job.finishedAt,
          error: job.error,
          error_code: failure.code,
          support_id: id,
          retryable: failure.retryable,
          ...(terminalProgress ? { generation_progress: terminalProgress } : {}),
        });
      }
    } finally {
      setTimeout(() => {
        if (runningJobs.get(key)?.id === id) runningJobs.delete(key);
      }, 5 * 60 * 1000).unref?.();
    }
    });
    execution.catch(error => {
      // A hard deadline wins the race even when the provider ignores abort.
      // Finalize the persisted job here; the late provider continuation cannot
      // overwrite outputs because its cancellation context remains marked.
      if (error?.code !== 'STAGE_DEADLINE_EXCEEDED') return;
      const failure = classifyFailure(error);
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      job.errorCode = failure.code;
      job.supportId = id;
      job.error = withSupportId(failure.message, id).slice(0, 1000);
      job.retryable = true;
      const current = storage.getTask(taskId);
      if (String(current?.active_generation_id || '') !== id) return;
      const terminalProgress = terminalGenerationProgress(current, stage, id, {
        status: 'failed',
        error_code: failure.code,
        support_id: id,
        message: job.error,
        finished_at: job.finishedAt,
        updated_at: job.finishedAt,
      });
      storage.saveStage(taskId, stage, {
        status: 'failed',
        started_at: job.startedAt,
        finished_at: job.finishedAt,
        output_summary: '执行超时，未保存可用结果',
        error: job.error,
        diagnostics: { generation_id: id, support_id: id, error_code: failure.code, retryable: true },
      }, { systemFinalization: true });
      storage.updateTask(taskId, {
        status: 'failed',
        stage: `${stage}_failed`,
        active_stage: '',
        active_generation_id: '',
        generation_finished_at: job.finishedAt,
        error: job.error,
        error_code: failure.code,
        support_id: id,
        retryable: true,
        ...(terminalProgress ? { generation_progress: terminalProgress } : {}),
      });
    });
  });

  return { accepted: true, duplicate: false, job: publicJob(job) };
}

module.exports = {
  cancelJob,
  classifyFailure,
  stageBudgetMs,
  getJob,
  publicJob,
  terminalGenerationProgress,
  queueStage,
  reconcileInterruptedJobs,
};

function runBackgroundReconciliation(label = 'startup') {
  try {
    const result = reconcileInterruptedJobs();
    if (result.interrupted || result.normalized) console.warn(`[new-story-ad:jobs] ${label} reconciliation`, result);
  } catch (error) {
    console.error(`[new-story-ad:jobs] ${label} reconciliation failed:`, String(error.message || error));
  }
}

setTimeout(() => runBackgroundReconciliation('startup'), 1500).unref?.();

// A PM2 reload can start the replacement worker only seconds after a stage was
// persisted. The first startup pass intentionally honours ORPHAN_GRACE_MS so
// the old worker may finish, but a single pass would leave that fresh orphan
// marked active forever. Re-run reconciliation periodically; jobs owned by
// this process are skipped through runningJobs above.
setInterval(
  () => runBackgroundReconciliation('periodic'),
  ORPHAN_RECONCILE_INTERVAL_MS,
).unref?.();
