const PRIVACY_ERROR_CODE = 'INPUT_PERSON_PRIVACY';
const BLOCKER_CODE = 'VIDEO_PRIVACY_INPUT_REQUIRES_CHANGE';

function text(value = '') {
  return String(value || '').trim();
}

function paidUnitForIndex(plan = {}, index = -1) {
  return (Array.isArray(plan.units) ? plan.units : []).find(unit => (
    unit?.paid === true && (unit.member_indexes || []).map(Number).includes(index)
  )) || null;
}

function sameRejectedInput(status = {}, expectedLineage = {}, unit = {}) {
  const failedLineage = text(status.lineage_fingerprint);
  const currentLineage = text(expectedLineage.fingerprint);
  const attemptedMode = text(status.input_mode || status.seedance_input_mode).toLowerCase();
  const plannedMode = text(unit.input_strategy).toLowerCase();
  const directFirstFrame = plannedMode === 'approved_keyframe_first_frame_only'
    && ['approved_keyframe_first_frame', 'approved_keyframe_first_frame_only'].includes(attemptedMode);
  return !!(failedLineage && currentLineage && failedLineage === currentLineage && directFirstFrame);
}

/**
 * 同一关键帧已经被供应商真人隐私规则拒绝时，禁止沿同一路径原样付费重试。
 * 更换关键帧或模型会改变 expected lineage，届时可重新预检。
 */
function applyPrivacyRetryBlockers({ plan = {}, statuses = [], expectedLineages = [] } = {}) {
  const blockers = [];
  (Array.isArray(statuses) ? statuses : []).forEach((status, index) => {
    const errorCode = text(status?.last_attempt_error_code || status?.error_code).toUpperCase();
    const unit = paidUnitForIndex(plan, index);
    if (errorCode !== PRIVACY_ERROR_CODE || !unit || !sameRejectedInput(status, expectedLineages[index] || {}, unit)) return;
    blockers.push({
      code: BLOCKER_CODE,
      scope: 'unit',
      unit_id: unit.id,
      shots: unit.shots || [index + 1],
      message: `第 ${index + 1} 镜当前关键帧在“直接首帧”路径被供应商判定为可能含真人隐私信息。本任务其他镜头也可以有人物；本次只拒绝第 ${index + 1} 镜，是对这张具体输入图的判定，不代表其他镜头没有真人。供应商未创建视频生成任务，本次视频费用为 ¥0；系统已阻止同图同路径原样重试。请先换用脸部更小、可识别特征更弱的远景关键帧，或改用已经验证支持该真人输入的模型能力。`,
      details: {
        unit_id: unit.id,
        shots: unit.shots || [index + 1],
        shot_index: index + 1,
        rejected_input_strategy: unit.input_strategy,
        rejected_lineage_fingerprint: expectedLineages[index]?.fingerprint || '',
        provider_task_created: false,
        billing_state: 'not_submitted',
        automatic_retry_count: 0,
      },
    });
  });
  if (!blockers.length) return plan;
  plan.blockers.push(...blockers);
  plan.status = plan.zero_cost_action_count > 0 ? 'partial_ready' : 'blocked';
  return plan;
}

module.exports = {
  PRIVACY_ERROR_CODE,
  BLOCKER_CODE,
  sameRejectedInput,
  applyPrivacyRetryBlockers,
};
