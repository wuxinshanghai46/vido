const storageDefault = require('../newStoryAd/storageService');
const storyFlowSketchGate = require('./storyFlowSketchGateService');

function clean(value = '', max = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function inspect(taskId, dependencies = {}) {
  const storage = dependencies.storage || storageDefault;
  const task = storage.getTask(taskId);
  if (!task) return { ready: false, code: 'TASK_NOT_FOUND', reason: '项目不存在', issues: ['项目不存在'] };
  const shots = storage.getOutput(taskId, 'storyboard_table') || [];
  const contracts = storage.getOutput(taskId, 'keyframe_contracts') || [];
  const review = storage.getOutput(taskId, 'quality_review') || null;
  const meta = storage.getOutput(taskId, 'storyboard_meta') || {};
  const progress = task.generation_progress || {};
  const blocking = Array.isArray(review?.blocking_issues) ? review.blocking_issues.filter(Boolean) : [];
  const rewrites = Array.isArray(review?.rewrite_issues) ? review.rewrite_issues.filter(Boolean) : [];
  const reviewHasVerdict = typeof review?.passed === 'boolean';
  const issues = [];
  const flow = storyFlowSketchGate.inspect(taskId);
  const explicitFailure = task.stage === 'storyboard_failed'
    || meta.status === 'failed'
    || progress.phase === 'review_failed'
    || review?.passed === false
    || blocking.length > 0
    || rewrites.length > 0;
  if (explicitFailure) issues.push(...blocking, ...rewrites, task.error || progress.message || '镜头结构整理未通过');
  if (!Array.isArray(shots) || !shots.length) issues.push('还没有可用的镜头结构合同');
  if (meta.status && meta.status !== 'ready') issues.push(`镜头结构状态为 ${clean(meta.status, 40)}`);
  if (shots.length && contracts.length !== shots.length) issues.push(`关键帧合同不完整（${contracts.length}/${shots.length}）`);
  if (!flow.ready) issues.unshift(flow.reason);
  const ready = flow.ready
    && !explicitFailure
    && Array.isArray(shots)
    && shots.length > 0
    && (!meta.status || meta.status === 'ready')
    && contracts.length === shots.length;
  return {
    ready,
    code: ready ? '' : (explicitFailure ? 'STORYBOARD_REVIEW_REQUIRED' : 'STORYBOARD_CONTRACTS_NOT_READY'),
    reason: ready ? '剧情流向绑定已确认，人物场景分镜合同已通过，可以生成分镜图。' : clean(issues[0] || '人物场景分镜尚未满足生成条件。', 300),
    issues: [...new Set(issues.map(value => clean(value, 300)).filter(Boolean))].slice(0, 20),
    shot_count: shots.length,
    contract_count: contracts.length,
    review_passed: reviewHasVerdict ? (review.passed === true && !blocking.length && !rewrites.length) : null,
    flow,
  };
}

function assertReady(taskId, dependencies = {}) {
  const state = inspect(taskId, dependencies);
  if (state.ready) return state;
  const error = new Error(state.reason || '剧情流向绑定确认后才能生成人物场景分镜');
  error.status = state.code === 'TASK_NOT_FOUND' ? 404 : 409;
  error.code = state.code;
  error.retryable = false;
  error.details = state;
  throw error;
}

module.exports = { inspect, assertReady };
