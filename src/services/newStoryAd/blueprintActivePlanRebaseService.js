'use strict';

const assetPlanPublication = require('./assetPlanPublicationService');

function prepare(taskId, { motionOnly = false } = {}) {
  const state = assetPlanPublication.prepareContentRevisionCarry(taskId, {
    reason: motionOnly ? 'motion_only_blueprint_edit_preflight' : 'manual_blueprint_edit_preflight',
  });
  if (state.ready) return state;
  const error = new Error('当前生成方案与任务内容不一致，系统已停止保存，原分镜和首帧均未改动。请先刷新任务状态后重试。');
  error.code = 'BLUEPRINT_ACTIVE_PLAN_REBASE_REQUIRED';
  error.status = 409;
  error.retryable = false;
  error.details = { model_call_started: false, issues: state.eligibility?.issues || [] };
  throw error;
}

function carry(taskId, { contentRevision, motionOnly = false, hadActivePlan = false } = {}) {
  const carried = assetPlanPublication.carryForward(taskId, {
    contentRevision,
    reason: motionOnly ? 'motion_only_blueprint_edit_preserves_storyboard_frames' : 'manual_blueprint_edit_preserves_upstream_plan',
  });
  if (!hadActivePlan || carried) return carried;
  throw Object.assign(new Error('当前生成方案无法安全更新到新的内容版本，系统已停止后续生成。'), {
    code: 'BLUEPRINT_ACTIVE_PLAN_CARRY_FAILED', status: 409, retryable: false,
  });
}

module.exports = { prepare, carry };
