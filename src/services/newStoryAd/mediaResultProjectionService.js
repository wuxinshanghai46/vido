const PRE_SUBMIT_FAILURES = new Set([
  'DEYUNAI_ASSET_SUBSCRIPTION_REQUIRED',
  'DEYUNAI_ASSET_GROUP_NOT_FOUND',
  'DEYUNAI_ASSET_API_FAILED',
  'DEYUNAI_LIVENESS_GROUP_BINDING_REQUIRED',
  'DEYUNAI_PERSON_REFERENCE_REQUIRED',
  'VIDEO_BOUNDARY_REPAIR_EVIDENCE_MISSING',
  'VIDEO_BOUNDARY_REPAIR_INPUT_INCOMPLETE',
  'VIDEO_BOUNDARY_REPAIR_TAIL_INSUFFICIENT',
  'VIDEO_PREFLIGHT_CONFIRMATION_REQUIRED',
  'VIDEO_COST_CONFIRMATION_REQUIRED',
  'VIDEO_COST_LIMIT_EXCEEDED',
  'VIDEO_DUPLICATE_SUBMISSION',
  'INPUT_PERSON_PRIVACY',
]);

const MESSAGE_ZH = Object.freeze({
  DEYUNAI_ASSET_SUBSCRIPTION_REQUIRED: '当前漫路账号未开通高级素材库，无法创建当前镜头所需的私有参考素材组。',
  DEYUNAI_ASSET_GROUP_NOT_FOUND: '当前镜头所需的漫路素材组不存在，视频模型尚未提交。',
  DEYUNAI_ASSET_API_FAILED: '漫路素材库准备失败，视频模型尚未提交。',
  DEYUNAI_LIVENESS_GROUP_BINDING_REQUIRED: '真人素材尚未绑定已授权的漫路人物素材组，视频模型尚未提交。',
  INPUT_PERSON_PRIVACY: '当前关键帧被供应商判定为可能含真人隐私信息，供应商未创建视频生成任务。请更换为脸部更小、可识别特征更弱的远景关键帧，或改用已验证支持该真人输入的模型能力；不要原样重试。',
});

const ACTIVE_LIFECYCLES = new Set([
  'queued', 'submitting', 'provider_submitted', 'provider_running', 'downloading', 'normalizing', 'generated', 'video_qa',
]);
const FAILED_LIFECYCLES = new Set(['failed', 'qa_failed', 'cancelled']);
const REGENERATE_COMPATIBILITY = new Set(['incompatible', 'outdated', 'stale', 'regenerate_required', 'lineage_changed']);

function text(value = '') {
  return String(value || '').trim();
}

function uniqueIndexes(values = []) {
  return [...new Set(values.map(Number).filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

function clipAt(clips = [], index = 0) {
  return (Array.isArray(clips) ? clips : []).find((clip, clipIndex) => {
    if (!clip) return false;
    if (Number.isInteger(Number(clip.shot_index))) return Number(clip.shot_index) === index;
    if (Number.isInteger(Number(clip.index))) return Number(clip.index) === index + 1;
    return clipIndex === index;
  }) || null;
}

function statusAt(statuses = [], index = 0) {
  return (Array.isArray(statuses) ? statuses : []).find((status, statusIndex) => {
    if (!status) return false;
    const shotIndex = Number(status.shot_index);
    const displayIndex = Number(status.index);
    if (Number.isInteger(shotIndex)) return shotIndex === index;
    if (Number.isInteger(displayIndex)) return displayIndex === index + 1;
    return statusIndex === index;
  }) || null;
}

function formatIndexes(indexes = []) {
  const values = uniqueIndexes(indexes);
  if (!values.length) return '';
  const ranges = [];
  let start = values[0], end = values[0];
  for (const value of values.slice(1)) {
    if (value === end + 1) end = value;
    else { ranges.push(start === end ? `${start}` : `${start}–${end}`); start = value; end = value; }
  }
  ranges.push(start === end ? `${start}` : `${start}–${end}`);
  return `第 ${ranges.join('、')} 镜`;
}

function hasMedia(clip = {}) {
  return !!(clip?.video_url || clip?.videoUrl || clip?.file_path);
}

function sceneBlockId(clip = {}) {
  return text(clip?.scene_block_id || clip?.lineage?.scene_block_id);
}

function sameGenerationUnit(previous = {}, current = {}) {
  const previousBlock = sceneBlockId(previous);
  const currentBlock = sceneBlockId(current);
  if (previousBlock && currentBlock) return previousBlock === currentBlock;
  const previousSource = text(previous?.scene_block_source_path || previous?.source_video_path);
  const currentSource = text(current?.scene_block_source_path || current?.source_video_path);
  return !!(previousSource && currentSource && previousSource === currentSource);
}

function compatibilityOf(clip = {}, status = {}) {
  const assessment = status.artifact_compatibility || clip.artifact_compatibility || {};
  const raw = text(
    assessment.status || status.compatibility_status || status.lineage_compatibility || status.compatibility
    || clip.compatibility_status || clip.lineage_compatibility || clip.compatibility,
  ).toLowerCase();
  const lifecycle = text(status.lifecycle).toLowerCase();
  const explicitlyRegenerate = REGENERATE_COMPATIBILITY.has(raw)
    || lifecycle === 'regenerate_required'
    || status.regenerate_required === true
    || clip.regenerate_required === true
    || status.lineage_compatible === false
    || clip.lineage_compatible === false;
  const reasonCodes = Array.isArray(assessment.reason_codes)
    ? assessment.reason_codes.map(value => text(value)).filter(Boolean)
    : [];
  if (explicitlyRegenerate) return { status: 'regenerate_required', source: raw || lifecycle || 'explicit_flag', reason_codes: reasonCodes };
  if (raw === 'blocked') return { status: 'blocked', source: raw, reason_codes: reasonCodes };
  if (['metadata_migration_ready', 'reverify_required', 'deterministic_repair_ready'].includes(raw)) {
    return { status: raw, source: raw, reason_codes: reasonCodes };
  }
  if (raw === 'legacy_partial' || raw === 'legacy' || status.legacy_inferred === true) {
    return { status: 'legacy_compatible', source: raw || 'legacy_inferred', reason_codes: reasonCodes };
  }
  return { status: 'compatible', source: raw || 'current_or_adopted', reason_codes: reasonCodes };
}

function failurePhase(code = '', status = {}) {
  const normalizedCode = text(code).toUpperCase();
  const lifecycle = text(status.lifecycle).toLowerCase();
  const submission = text(status.provider_submission_state).toLowerCase();
  const providerTaskId = text(status.provider_task_id);
  if (PRE_SUBMIT_FAILURES.has(normalizedCode)) return 'pre_submit';
  if (lifecycle === 'qa_failed' || text(status.qa_status).toLowerCase() === 'failed') return 'qa_failed';
  if (submission === 'not_submitted' && !providerTaskId) return 'pre_submit';
  if (providerTaskId || ['submitted', 'completed', 'accepted', 'running'].includes(submission)) return 'provider';
  return 'provider';
}

function failureState(phase = '') {
  if (phase === 'pre_submit') return 'pre_submit_failed';
  if (phase === 'qa_failed') return 'qa_failed';
  return 'provider_failed';
}

function taskFailureIndexes(task = {}, total = 0) {
  const progress = task.generation_progress || {};
  const failed = uniqueIndexes(Array.isArray(progress.failed_indexes) ? progress.failed_indexes : []);
  if (failed.length) return failed.filter(index => index <= total);
  const current = uniqueIndexes([progress.current_index]);
  if (current.length) return current.filter(index => index <= total);
  const candidates = task.status === 'failed' ? [] : [
    ...(Array.isArray(progress.active_indexes) ? progress.active_indexes : []),
    ...(Array.isArray(progress.target_indexes) ? progress.target_indexes : []),
    ...(Array.isArray(progress.repair_indexes) ? progress.repair_indexes : []),
  ];
  return uniqueIndexes(candidates).filter(index => index <= total);
}

function taskFailureApplies(task = {}, index = 0, total = 0, unresolvedIndexes = []) {
  if (!task.error_code && !task.error) return false;
  const scoped = taskFailureIndexes(task, total);
  if (scoped.length) return scoped.includes(index + 1);
  return unresolvedIndexes.length === 1 && unresolvedIndexes[0] === index + 1;
}

function attemptBilling(status = {}, prefix = '') {
  const providerTaskId = text(status[`${prefix}provider_task_id`] || (!prefix ? status.provider_task_id : ''));
  const providerSubmissionState = text(status[`${prefix}provider_submission_state`] || (!prefix ? status.provider_submission_state : ''));
  const billingState = text(status[`${prefix}billing_state`] || (!prefix ? status.billing_state : ''));
  return {
    provider_task_id: providerTaskId,
    provider_submission_state: providerSubmissionState || (providerTaskId ? 'submitted' : ''),
    billing_state: billingState || (providerTaskId ? 'unknown' : ''),
  };
}

function classifyCurrentState({ clip = {}, status = {}, previousClip = {}, compatibility = {}, taskFailure = null } = {}) {
  if (compatibility.status === 'regenerate_required') return { state: 'regenerate_required', phase: 'compatibility' };
  if (compatibility.status === 'blocked') return { state: 'compatibility_blocked', phase: 'compatibility' };
  if (['metadata_migration_ready', 'reverify_required', 'deterministic_repair_ready'].includes(compatibility.status)) {
    return { state: 'compatibility_repair_required', phase: 'compatibility' };
  }
  const media = hasMedia(clip);
  const qaPass = clip?.qa?.pass === true || text(status.qa_status).toLowerCase() === 'passed' || text(status.lifecycle) === 'qa_passed';
  const qaFail = clip?.qa?.pass === false || text(status.qa_status).toLowerCase() === 'failed' || text(status.lifecycle) === 'qa_failed';
  if (media && clip?.qa?.pass === true && clip?.cross_shot_qa?.pass === false) return { state: 'boundary_failed', phase: 'boundary_failed' };
  if (media && qaFail) return { state: 'qa_failed', phase: 'qa_failed' };
  if (media && !qaPass) return { state: 'generated_qa_pending', phase: 'qa_pending' };
  if (media && qaPass) {
    const boundaryRequired = !!previousClip && hasMedia(previousClip) && !sameGenerationUnit(previousClip, clip);
    if (boundaryRequired && clip?.cross_shot_qa?.pass === false) return { state: 'boundary_failed', phase: 'boundary_failed' };
    if (boundaryRequired && clip?.cross_shot_qa?.pass !== true) return { state: 'generated_qa_pending', phase: 'boundary_pending' };
    return { state: 'passed', phase: 'complete' };
  }
  const code = text(status.error_code || taskFailure?.code);
  if (code || FAILED_LIFECYCLES.has(text(status.lifecycle).toLowerCase())) {
    const phase = failurePhase(code, status);
    return { state: failureState(phase), phase };
  }
  if (ACTIVE_LIFECYCLES.has(text(status.lifecycle).toLowerCase())) return { state: 'provider_running', phase: 'provider' };
  return { state: 'not_started', phase: 'not_started' };
}

function messageFor(code = '', status = {}, clip = {}, task = {}) {
  const normalized = text(code).toUpperCase();
  return MESSAGE_ZH[normalized] || text(status.error || clip.error || task.error || '当前镜头未成功。');
}

function projectShot({ index = 0, clips = [], statuses = [], task = {}, total = 0, unresolvedIndexes = [] } = {}) {
  const clip = clipAt(clips, index) || {};
  const rawStatus = statusAt(statuses, index) || {};
  const restored = rawStatus.previous_clip_restored === true && hasMedia(clip);
  const currentStatus = restored ? {
    compatibility_status: rawStatus.compatibility_status,
    lineage_compatibility: rawStatus.lineage_compatibility,
    legacy_inferred: rawStatus.legacy_inferred,
  } : rawStatus;
  const compatibility = compatibilityOf(clip, rawStatus);
  const taskFailure = taskFailureApplies(task, index, total, unresolvedIndexes)
    ? { code: text(task.error_code), message: text(task.error) }
    : null;
  const current = classifyCurrentState({
    clip,
    status: currentStatus,
    previousClip: index > 0 ? clipAt(clips, index - 1) : null,
    compatibility,
    taskFailure,
  });
  const currentBilling = restored
    ? {
      provider_task_id: text(clip.provider_task_id),
      provider_submission_state: text(clip.provider_submission_state || (clip.provider_task_id ? 'completed' : '')),
      billing_state: text(clip.billing_state || (clip.provider_task_id ? 'confirmed' : '')),
    }
    : attemptBilling(rawStatus);
  const currentCode = current.state.endsWith('_failed')
    ? text(rawStatus.error_code || taskFailure?.code || clip.error_code)
    : text(clip.error_code);
  const currentAttempt = {
    state: current.state,
    phase: current.phase,
    code: currentCode,
    message_zh: current.state.endsWith('_failed') ? messageFor(currentCode, rawStatus, clip, task) : '',
    ...currentBilling,
  };

  const hasLastAttempt = restored
    || !!(rawStatus.last_attempt_provider_task_id || rawStatus.last_attempt_provider_submission_state || rawStatus.last_attempt_billing_state)
    || rawStatus.last_attempt_status === 'failed';
  let lastAttempt = null;
  if (hasLastAttempt) {
    const code = text(rawStatus.last_attempt_error_code || rawStatus.error_code || taskFailure?.code);
    const billing = attemptBilling(rawStatus, 'last_attempt_');
    const phase = failurePhase(code, { ...rawStatus, ...billing });
    lastAttempt = {
      state: failureState(phase),
      phase,
      code,
      message_zh: messageFor(code, rawStatus, {}, task),
      ...billing,
    };
  }
  return {
    index: index + 1,
    state: current.state,
    phase: current.phase,
    compatibility,
    current_attempt: currentAttempt,
    last_attempt: lastAttempt,
  };
}

function failureEntry(shot = {}, attempt = null) {
  const source = attempt || shot.current_attempt || {};
  const phase = source.phase || shot.phase;
  const preSubmit = phase === 'pre_submit';
  return {
    index: shot.index,
    state: source.state || shot.state,
    phase,
    code: text(source.code),
    message_zh: text(source.message_zh || '当前镜头未成功。'),
    provider_submission_state: preSubmit ? 'not_submitted' : text(source.provider_submission_state),
    billing_state: preSubmit ? 'not_submitted' : text(source.billing_state),
    automatic_retry_count: 0,
  };
}

function phaseText(entry = {}) {
  if (entry.phase === 'pre_submit') return '在视频模型提交前失败';
  if (entry.phase === 'provider') return '在视频供应商生成阶段失败';
  if (entry.phase === 'qa_failed') return '视频已生成，但质量审核未通过';
  if (entry.phase === 'boundary_failed') return '单镜已通过，但相邻镜头衔接审核未通过';
  return '处理失败';
}

function projectMediaResult({ task = {}, outputs = {}, videoShotStatuses = [], storyboard = [] } = {}) {
  const clips = Array.isArray(outputs.video_clips) ? outputs.video_clips : [];
  const total = Math.max(storyboard.length, clips.length, videoShotStatuses.length);
  const unresolved = Array.from({ length: total }, (_, index) => ({ index: index + 1, clip: clipAt(clips, index), status: statusAt(videoShotStatuses, index) }))
    .filter(item => !hasMedia(item.clip || {}) || item.status?.regenerate_required === true || REGENERATE_COMPATIBILITY.has(text(item.status?.compatibility_status).toLowerCase()))
    .map(item => item.index);
  const shots = Array.from({ length: total }, (_, index) => projectShot({
    index, clips, statuses: videoShotStatuses, task, total, unresolvedIndexes: unresolved,
  }));
  const passed = shots.filter(shot => shot.state === 'passed').map(shot => shot.index);
  const qaPending = shots.filter(shot => shot.state === 'generated_qa_pending').map(shot => shot.index);
  const qaFailed = shots.filter(shot => shot.state === 'qa_failed').map(shot => shot.index);
  const boundaryFailed = shots.filter(shot => shot.state === 'boundary_failed').map(shot => shot.index);
  const regenerateRequired = shots.filter(shot => shot.state === 'regenerate_required').map(shot => shot.index);
  const compatibilityRepairRequired = shots.filter(shot => shot.state === 'compatibility_repair_required').map(shot => shot.index);
  const compatibilityBlocked = shots.filter(shot => shot.state === 'compatibility_blocked').map(shot => shot.index);
  const notStarted = shots.filter(shot => shot.state === 'not_started').map(shot => shot.index);
  const running = shots.filter(shot => shot.state === 'provider_running').map(shot => shot.index);
  const currentFailures = shots.filter(shot => ['pre_submit_failed', 'provider_failed', 'qa_failed', 'boundary_failed'].includes(shot.state));
  const failed = currentFailures.map(shot => failureEntry(shot));
  const lastAttemptFailed = shots.filter(shot => shot.last_attempt).map(shot => failureEntry(shot, shot.last_attempt));
  const notExecuted = uniqueIndexes((Array.isArray(videoShotStatuses) ? videoShotStatuses : []).filter(status => status?.stopped_after_unit_failure === true && status?.previous_clip_restored !== true).map((status, index) => Number(status.index || status.shot_index || index + 1)));
  const pending = uniqueIndexes([...qaPending, ...regenerateRequired, ...compatibilityRepairRequired, ...compatibilityBlocked, ...notStarted, ...running]);

  const finalReady = !!(outputs.final_video?.video_url || outputs.final_video?.videoUrl);
  const composeFailed = /compose_failed/.test(text(task.stage)) && !finalReady;
  const composeRunning = /^compose(?:_running)?$/.test(text(task.stage)) && text(task.status).toLowerCase() === 'running';
  const allPassed = total > 0 && passed.length === total;
  const anyMedia = clips.some(hasMedia);
  const mediaBlocked = failed.length > 0 || lastAttemptFailed.length > 0 || pending.length > 0;
  const compose = {
    status: finalReady ? 'done' : (composeFailed ? 'failed' : (composeRunning ? 'running' : (allPassed && !mediaBlocked ? 'ready' : (anyMedia ? 'blocked' : 'not_started')))),
    started: finalReady || composeFailed || composeRunning,
    final_video_ready: finalReady,
  };

  let outcome = 'not_started';
  if (finalReady) outcome = 'success';
  else if (composeFailed) outcome = 'compose_failed';
  else if (failed.length || lastAttemptFailed.length) {
    const phases = [...new Set([...failed, ...lastAttemptFailed].map(item => item.phase))];
    if (passed.length || phases.length !== 1) outcome = 'partial_failed';
    else if (phases[0] === 'pre_submit') outcome = 'pre_submit_failed';
    else if (phases[0] === 'provider') outcome = 'provider_failed';
    else if (phases[0] === 'qa_failed') outcome = 'qa_failed';
    else if (phases[0] === 'boundary_failed') outcome = 'boundary_failed';
    else outcome = 'failed';
  }
  else if (regenerateRequired.length || compatibilityRepairRequired.length || compatibilityBlocked.length) outcome = 'compatibility_blocked';
  else if (qaPending.length || running.length || (anyMedia && notStarted.length)) outcome = 'incomplete';
  else if (allPassed) outcome = 'ready_to_compose';

  const successLabel = formatIndexes(passed);
  const failedIndexes = uniqueIndexes([...failed.map(item => item.index), ...lastAttemptFailed.map(item => item.index)]);
  const blockedIndexes = uniqueIndexes([...failedIndexes, ...qaPending, ...regenerateRequired, ...compatibilityRepairRequired, ...compatibilityBlocked, ...notStarted, ...running]);
  const blockedLabel = formatIndexes(blockedIndexes);
  let title = [successLabel ? `${successLabel}已成功` : '', blockedLabel ? `${blockedLabel}尚未成功` : ''].filter(Boolean).join('；');
  if (finalReady) title = '整条广告已成功生成';
  else if (composeFailed) title = '全部镜头已成功；最终封装失败';
  else if (lastAttemptFailed.length) title = `现有已审核片段仍保留；本次${formatIndexes(lastAttemptFailed.map(item => item.index))}生成失败`;
  else if (outcome === 'not_started') title = '整条广告尚未开始生成';
  else if (outcome === 'qa_failed' && qaFailed.length) title = `${formatIndexes(qaFailed)}视频已生成，但质量审核未通过`;
  else if (outcome === 'boundary_failed' && boundaryFailed.length) title = `${formatIndexes(boundaryFailed)}相邻衔接审核未通过`;
  else if (outcome === 'pre_submit_failed') title = `${formatIndexes(failedIndexes)}在视频模型提交前失败`;
  else if (outcome === 'provider_failed') title = `${formatIndexes(failedIndexes)}在视频供应商生成阶段失败`;
  else if (!title) title = '整条广告尚未完成';

  const failureRows = [];
  failed.forEach(item => failureRows.push(`${formatIndexes([item.index])}${phaseText(item)}：${item.message_zh}`));
  lastAttemptFailed.forEach(item => failureRows.push(`${formatIndexes([item.index])}当前可用结果已保留；最近一次尝试${phaseText(item)}：${item.message_zh}`));
  if (notExecuted.length) failureRows.push(`${formatIndexes(notExecuted)}因前一生成单元失败，本次未执行；现有历史片段继续保留。`);
  if (qaPending.length) failureRows.push(`${formatIndexes(qaPending)}视频已生成，质量审核尚未完成。`);
  if (regenerateRequired.length) failureRows.push(`${formatIndexes(regenerateRequired)}与当前版本不兼容，需要重新生成；旧文件继续保留供查看。`);
  if (compatibilityRepairRequired.length) failureRows.push(`${formatIndexes(compatibilityRepairRequired)}需要完成当前版本的本地元数据修复或重新审核，不会自动重新生成视频。`);
  if (compatibilityBlocked.length) failureRows.push(`${formatIndexes(compatibilityBlocked)}兼容性或计费证据不足，已阻止复用和重新提交。`);
  if (notStarted.length && !failedIndexes.some(index => notStarted.includes(index))) failureRows.push(`${formatIndexes(notStarted)}尚未开始生成。`);

  const billingEntries = [...failed, ...lastAttemptFailed];
  const unknownBilling = billingEntries.filter(item => item.billing_state === 'unknown');
  const confirmedBilling = billingEntries.filter(item => item.billing_state === 'confirmed');
  const notSubmittedBilling = billingEntries.filter(item => item.billing_state === 'not_submitted');
  let costText = '系统不会自动再次付费生成；自动付费重试 0。';
  if (unknownBilling.length) costText = `${formatIndexes(unknownBilling.map(item => item.index))}计费状态待核对，禁止直接重试；自动付费重试 0。`;
  else if (confirmedBilling.length) costText = `${formatIndexes(confirmedBilling.map(item => item.index))}已提交视频模型并产生视频生成费用；自动付费重试 0。`;
  else if (notSubmittedBilling.length) costText = `${formatIndexes(notSubmittedBilling.map(item => item.index))}本次未提交视频模型、未产生本轮视频生成费用；自动付费重试 0。`;
  else if (regenerateRequired.length) costText = `${formatIndexes(regenerateRequired)}如需重新生成，必须重新预检并确认费用；自动付费重试 0。`;
  else if (compatibilityRepairRequired.length) costText = `${formatIndexes(compatibilityRepairRequired)}只允许执行对应的无付费恢复或复审动作；自动付费重试 0。`;
  else if (compatibilityBlocked.length) costText = `${formatIndexes(compatibilityBlocked)}在兼容性与计费证据核清前不得重新提交；自动付费重试 0。`;

  const composeText = finalReady
    ? '最终成片已经生成。'
    : (composeFailed
      ? '全部镜头均已通过，但最终封装失败；重新封装不会重新生成视频。'
      : (compose.status === 'ready'
        ? '全部镜头均已通过，已经具备最终封装条件。'
        : (compose.status === 'not_started'
          ? '最终封装尚未开始。'
          : '最终封装已阻止；只有全部镜头通过后才会开始。')));

  let compatibilityStatus = 'compatible';
  if (shots.some(shot => shot.compatibility.status === 'legacy_compatible')) compatibilityStatus = 'legacy_compatible';
  if (compatibilityRepairRequired.length) compatibilityStatus = 'repair_or_reverify_required';
  if (compatibilityBlocked.length) compatibilityStatus = 'blocked';
  if (regenerateRequired.length) compatibilityStatus = 'regenerate_required';
  const compatibility = {
    status: compatibilityStatus,
    regenerate_required_indexes: regenerateRequired,
    repair_or_reverify_required_indexes: compatibilityRepairRequired,
    blocked_indexes: compatibilityBlocked,
    legacy_compatible_indexes: shots.filter(shot => shot.compatibility.status === 'legacy_compatible').map(shot => shot.index),
    final_success_override: finalReady,
  };

  return {
    outcome,
    shot_results: shots,
    passed_shot_indexes: passed,
    failed_shots: failed,
    last_attempt_failed_shots: lastAttemptFailed,
    pending_shot_indexes: pending,
    generated_qa_pending_indexes: qaPending,
    qa_failed_indexes: qaFailed,
    boundary_failed_indexes: boundaryFailed,
    regenerate_required_indexes: regenerateRequired,
    compatibility_repair_required_indexes: compatibilityRepairRequired,
    compatibility_blocked_indexes: compatibilityBlocked,
    not_started_indexes: notStarted,
    not_executed_indexes: notExecuted,
    compatibility,
    failure_phases: [...new Set([...failed, ...lastAttemptFailed].map(item => item.phase))],
    compose,
    title,
    success_text: successLabel ? `${successLabel}的视频生成、质量审核和必需的相邻衔接审核已通过。` : '当前没有镜头完成全部审核。',
    failure_text: finalReady ? '' : failureRows.join('；'),
    cost_text: finalReady ? '最终成片已存在；不会因历史失败状态自动再次付费生成。' : costText,
    compose_text: composeText,
  };
}

module.exports = {
  PRE_SUBMIT_FAILURES,
  MESSAGE_ZH,
  formatIndexes,
  compatibilityOf,
  failurePhase,
  projectMediaResult,
};
