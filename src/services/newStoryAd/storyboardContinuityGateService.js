function text(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sceneIdentity(shot = {}, contract = {}) {
  return {
    id: text(
      contract?.scene_lock?.scene_id
      || contract?.scene_id
      || shot.scene_id
      || shot.scene_asset_id,
    ),
    revision: Number(
      contract?.scene_lock?.scene_revision
      || contract?.scene_revision
      || shot.scene_revision
      || 0,
    ),
  };
}

function direction(value = '') {
  const source = text(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (/left_to_right|从左(?:侧)?向右|左往右|向右/.test(source)) return 'left_to_right';
  if (/right_to_left|从右(?:侧)?向左|右往左|向左/.test(source)) return 'right_to_left';
  if (/toward_camera|朝向镜头|靠近镜头|向镜头/.test(source)) return 'toward_camera';
  if (/away_from_camera|远离镜头|背离镜头/.test(source)) return 'away_from_camera';
  return '';
}

function stateFlags(value = '') {
  const source = text(value);
  return {
    no_contact: /(?:未|不|没有|尚未|避免)(?:接触|触碰|碰到|贴住)|距(?:离)?[^。；;]{0,16}(?:厘米|cm)|停在[^。；;]{0,16}(?:前|外)/i.test(source),
    contact: /(?:已经|保持|开始|正在|手指|指尖|手掌)?(?:接触|触碰|碰到|贴住|按在|扶在)/i.test(source)
      && !/(?:未|不|没有|尚未|避免)(?:接触|触碰|碰到|贴住)/i.test(source),
    seated: /坐(?:下|着|姿)|落座/.test(source),
    standing: /站(?:立|着|稳)|起身/.test(source),
  };
}

function contradictoryState(previousValue = '', currentValue = '') {
  const previous = stateFlags(previousValue);
  const current = stateFlags(currentValue);
  const labels = [];
  if (previous.no_contact && current.contact) labels.push('接触状态从“未接触”跳成“已接触”');
  if (previous.contact && current.no_contact) labels.push('接触状态从“已接触”跳成“未接触”');
  if (previous.seated && current.standing) labels.push('人物姿态从坐姿跳成站姿');
  if (previous.standing && current.seated) labels.push('人物姿态从站姿跳成坐姿');
  return labels;
}

function requiresExactInheritance(shot = {}) {
  return shot.requires_previous_frame === true
    || String(shot.requires_previous_frame || '').toLowerCase() === 'true';
}

/**
 * Static, read-only continuity check that runs before any TTS or video provider
 * submission. It validates authored state contracts; visual QA remains
 * responsible for judging each accepted keyframe.
 */
function reviewContinuity({ shots = [], contracts = [] } = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const issues = [];
  for (let index = 1; index < list.length; index += 1) {
    const previous = list[index - 1] || {};
    const current = list[index] || {};
    const previousScene = sceneIdentity(previous, contracts[index - 1] || {});
    const currentScene = sceneIdentity(current, contracts[index] || {});
    const sameAuthoredScene = previousScene.id && currentScene.id && previousScene.id === currentScene.id;
    const transitionType = text(current.transition_type).toLowerCase();
    if (previousScene.id && currentScene.id && !sameAuthoredScene && !text(current.transition_reason)) {
      issues.push(`第 ${index}→${index + 1} 镜切换到不同场景，但缺少转场原因`);
    }
    if (transitionType === 'match_cut' && !text(current.transition_match_anchor || current.match_anchor)) {
      issues.push(`第 ${index}→${index + 1} 镜使用匹配切换，但缺少可验证的匹配锚点`);
    }
    if (['dissolve', 'fade'].includes(transitionType)
      && !(Number(current.transition_duration_sec) > 0)) {
      issues.push(`第 ${index}→${index + 1} 镜使用${transitionType === 'dissolve' ? '叠化' : '淡出/淡入'}，但缺少有效转场时长`);
    }

    if (sameAuthoredScene && previousScene.revision > 0 && currentScene.revision > 0
      && previousScene.revision !== currentScene.revision) {
      issues.push(`第 ${index}→${index + 1} 镜使用同一场景但场景版本不一致（r${previousScene.revision}→r${currentScene.revision}）`);
    }

    if (!requiresExactInheritance(current)) continue;
    const required = [
      ['上一镜出镜状态', previous.exit_frame_state],
      ['本镜入镜状态', current.entry_frame_state],
      ['上一镜动作终点', previous.action_end],
      ['本镜动作起点', current.action_start],
      ['本镜转场类型', current.transition_type],
    ];
    required.forEach(([label, value]) => {
      if (!text(value)) issues.push(`第 ${index}→${index + 1} 镜要求继承上一帧，但缺少${label}`);
    });

    const previousState = [
      previous.exit_frame_state,
      previous.action_end,
      previous.object_states,
    ].map(text).filter(Boolean).join('；');
    const currentState = [
      current.entry_frame_state,
      current.action_start,
      current.object_states,
    ].map(text).filter(Boolean).join('；');
    contradictoryState(previousState, currentState).forEach((label) => {
      issues.push(`第 ${index}→${index + 1} 镜连续性冲突：${label}`);
    });

    const previousDirection = direction(previous.screen_direction);
    const currentDirection = direction(current.screen_direction);
    if (previousDirection && currentDirection && previousDirection !== currentDirection) {
      issues.push(`第 ${index}→${index + 1} 镜要求继承上一帧，但运动方向发生反转`);
    }
    const previousAxis = text(previous.camera_axis);
    const currentAxis = text(current.camera_axis);
    if (previousAxis && currentAxis && previousAxis !== currentAxis
      && !/切换|越轴|反打|新轴线/.test(text(current.transition_reason))) {
      issues.push(`第 ${index}→${index + 1} 镜要求继承上一帧，但摄影轴线不一致且未说明切换原因`);
    }
  }
  return {
    pass: issues.length === 0,
    issues: [...new Set(issues)],
    checked_boundaries: Math.max(0, list.length - 1),
  };
}

module.exports = {
  direction,
  stateFlags,
  contradictoryState,
  requiresExactInheritance,
  reviewContinuity,
};
