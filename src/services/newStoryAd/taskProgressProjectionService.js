const crypto = require('crypto');
const publicFailure = require('./publicFailureProjectionService');

const PROJECTION_VERSION = 'story-ad-progress-projection-v4';

function text(value = '', max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function compactIndexList(value = [], max = 60) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => Math.round(Number(item) || 0))
    .filter(item => item > 0))]
    .sort((a, b) => a - b)
    .slice(0, max);
}

function compactProgress(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const allowed = [
    'stage', 'substage', 'status', 'phase', 'message', 'generation_id', 'started_at', 'updated_at',
    'target_total', 'total', 'completed', 'processed', 'succeeded', 'failed',
    'current_index', 'percent', 'repair_attempt', 'max_repair_attempts',
    'configured_concurrency', 'effective_concurrency', 'peak_concurrency',
    'wave_number', 'parallelism_lost_reason',
    'queued', 'active', 'generated', 'qa_passed', 'qa_failed',
    'units_total', 'units_generated', 'units_failed', 'scene_block_count',
  ];
  const compact = Object.fromEntries(allowed
    .filter(key => source[key] !== undefined)
    .map(key => [key, typeof source[key] === 'string' ? text(source[key], key === 'message' ? 600 : 120) : source[key]]));
  ['active_indexes', 'queued_indexes'].forEach(key => {
    const indexes = compactIndexList(source[key]);
    if (indexes.length) compact[key] = indexes;
  });
  if (compact.message) compact.message = publicFailure.publicFailureMessage(compact.message, text);
  if (compact.stage) compact.stage = publicFailure.publicStage(compact.stage);
  return compact;
}

/**
 * 轮询只返回任务状态和计数，不读取分镜、图片、视频、场景或模型调用记录。
 * 完成阶段后前端再获取一次完整快照，从根源上避免每 2 秒传输并重绘整项任务。
 */
function projectTaskProgress(task = {}, sinceRevision = '') {
  const progress = compactProgress(task.generation_progress);
  const projectedTask = {
    id: text(task.id, 120),
    status: text(task.status, 40),
    stage: text(task.stage, 80),
    active_generation_id: text(task.active_generation_id, 120),
    active_stage: text(task.active_stage, 80),
    active_target_generations: task.active_target_generations && typeof task.active_target_generations === 'object'
      ? task.active_target_generations : {},
    generation_queued_at: text(task.generation_queued_at, 48),
    generation_started_at: text(task.generation_started_at, 48),
    generation_finished_at: text(task.generation_finished_at, 48),
    generation_progress: progress,
    error: publicFailure.publicFailureMessage(task.error, text),
    error_code: publicFailure.publicErrorCode(task.error_code, task.error),
    retryable: task.retryable === true,
    updated_at: text(task.updated_at, 48),
  };
  const revision = crypto.createHash('sha256')
    .update(JSON.stringify(projectedTask))
    .digest('hex')
    .slice(0, 20);
  return {
    progress_only: true,
    projection_version: PROJECTION_VERSION,
    revision,
    changed: !sinceRevision || sinceRevision !== revision,
    task: projectedTask,
  };
}

module.exports = {
  PROJECTION_VERSION,
  compactIndexList,
  compactProgress,
  projectTaskProgress,
};
