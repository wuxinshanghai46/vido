const PRE_SUBMIT_FAILURES = new Set([
  'DEYUNAI_ASSET_SUBSCRIPTION_REQUIRED',
  'DEYUNAI_ASSET_GROUP_NOT_FOUND',
  'DEYUNAI_ASSET_API_FAILED',
  'VIDEO_BOUNDARY_REPAIR_EVIDENCE_MISSING',
  'VIDEO_BOUNDARY_REPAIR_INPUT_INCOMPLETE',
  'VIDEO_BOUNDARY_REPAIR_TAIL_INSUFFICIENT',
  'VIDEO_PREFLIGHT_CONFIRMATION_REQUIRED',
  'VIDEO_COST_CONFIRMATION_REQUIRED',
]);

const MESSAGE_ZH = Object.freeze({
  DEYUNAI_ASSET_SUBSCRIPTION_REQUIRED: '当前漫路账号未开通高级素材库，无法创建当前镜头关键帧所需的私有参考素材组。',
});

function text(value = '') {
  return String(value || '').trim();
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
  const values = [...new Set(indexes.map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
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

function clipApproved(clip = {}, index = 0) {
  const hasMedia = !!(clip?.video_url || clip?.videoUrl || clip?.file_path);
  const boundaryReady = index === 0 || clip?.cross_shot_qa?.pass !== false;
  return hasMedia && !clip?.error && !clip?.error_code && clip?.qa?.pass === true && boundaryReady;
}

function failurePhase(code = '', status = {}) {
  if (PRE_SUBMIT_FAILURES.has(text(code).toUpperCase())) return 'pre_submit';
  if (['qa_failed'].includes(text(status.lifecycle)) || text(status.qa_status) === 'failed') return 'qa';
  if (['submitted', 'completed'].includes(text(status.provider_submission_state))) return 'provider_or_post_submit';
  return 'unknown';
}

function projectMediaResult({ task = {}, outputs = {}, videoShotStatuses = [], storyboard = [] } = {}) {
  const clips = Array.isArray(outputs.video_clips) ? outputs.video_clips : [];
  const total = Math.max(storyboard.length, clips.length, videoShotStatuses.length);
  const passed = [], failed = [], pending = [];
  for (let index = 0; index < total; index += 1) {
    const clip = clipAt(clips, index) || {};
    const status = statusAt(videoShotStatuses, index) || {};
    if (clipApproved(clip, index)) { passed.push(index + 1); continue; }
    const code = text(status.error_code || clip.error_code || (Number(task.generation_progress?.current_index) === index + 1 ? task.error_code : ''));
    const lifecycleFailed = ['failed', 'qa_failed', 'cancelled'].includes(text(status.lifecycle));
    if (code || lifecycleFailed) {
      const phase = failurePhase(code, status);
      failed.push({
        index: index + 1,
        phase,
        code,
        message_zh: MESSAGE_ZH[code] || text(status.error || clip.error || task.error || '当前镜头未成功。'),
        provider_submission_state: phase === 'pre_submit' ? 'not_submitted' : text(status.provider_submission_state || ''),
        billing_state: phase === 'pre_submit' ? 'not_submitted' : text(status.billing_state || ''),
        automatic_retry_count: 0,
      });
      continue;
    }
    pending.push(index + 1);
  }
  const finalReady = !!(outputs.final_video?.video_url || outputs.final_video?.videoUrl);
  const composeFailed = /compose_failed/.test(text(task.stage)) && !finalReady;
  const compose = {
    status: finalReady ? 'done' : (composeFailed ? 'failed' : 'blocked'),
    started: finalReady || composeFailed || /^compose/.test(text(task.stage)),
    final_video_ready: finalReady,
  };
  const preSubmit = failed.filter(item => item.phase === 'pre_submit');
  const outcome = finalReady ? 'success' : (failed.length ? (passed.length ? 'partial_failed' : 'failed') : 'incomplete');
  const successLabel = formatIndexes(passed);
  const failedLabel = formatIndexes(failed.map(item => item.index));
  const pendingLabel = formatIndexes(pending);
  return {
    outcome,
    passed_shot_indexes: passed,
    failed_shots: failed,
    pending_shot_indexes: pending,
    compose,
    title: finalReady ? '整条广告已成功生成' : [successLabel ? `${successLabel}已成功` : '', failedLabel ? `${failedLabel}未成功` : '', pendingLabel ? `${pendingLabel}尚未完成` : ''].filter(Boolean).join('；'),
    success_text: successLabel ? `${successLabel}的视频生成和质量审核已通过。` : '当前没有镜头完成全部审核。',
    failure_text: failed.length ? failed.map(item => `${formatIndexes([item.index])}${item.phase === 'pre_submit' ? '在视频模型提交前失败' : (item.phase === 'qa' ? '已生成但质量审核未通过' : '处理失败')}：${item.message_zh}`).join('；') : (pendingLabel ? `${pendingLabel}仍待生成或审核。` : ''),
    cost_text: preSubmit.length ? `${formatIndexes(preSubmit.map(item => item.index))}本次未提交视频模型、未产生本轮视频费用；自动重试 0。` : '系统不会自动再次付费生成。',
    compose_text: finalReady ? '最终成片已经生成。' : (composeFailed ? '镜头均已就绪，但最终封装失败。' : '最终封装未执行；只有全部镜头通过后才会开始。'),
  };
}

module.exports = { PRE_SUBMIT_FAILURES, MESSAGE_ZH, formatIndexes, projectMediaResult };
