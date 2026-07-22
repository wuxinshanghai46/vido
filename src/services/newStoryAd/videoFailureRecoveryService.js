/** 计算失败后必须恢复的镜头：当前单元与尚未运行的后续单元都回到付费提交前快照。 */
function rollbackIndexes({ generationError = null, unitIndexes = [], remainingUnits = [] } = {}) {
  const remainingIndexes = (Array.isArray(remainingUnits) ? remainingUnits : []).flatMap(item => item?.member_indexes || []);
  return [...new Set([...(Array.isArray(unitIndexes) ? unitIndexes : []), ...remainingIndexes])];
}

/** 把失败单元恢复到提交前快照，避免准备素材或供应商拒绝时覆盖已经付费生成的历史片段。 */
function restorePreviousClips({ clips = [], previousClips = [], indexes = [] } = {}) {
  (Array.isArray(indexes) ? indexes : []).forEach(index => { clips[index] = previousClips[index] || clips[index] || null; });
  return clips;
}

/** 供应商失败或单镜 QA 失败才回滚；相邻交接失败必须保留已付费且单镜合格的新产物。 */
function shouldRestoreUnitFailure({ generationError = null, unitIndexes = [], qaFailures = [] } = {}) {
  if (generationError) return true;
  const members = new Set((Array.isArray(unitIndexes) ? unitIndexes : []).map(Number));
  return (Array.isArray(qaFailures) ? qaFailures : []).some(failure => (
    members.has(Number(failure?.index)) && String(failure?.kind || '') !== 'cross_shot_qa'
  ));
}

function recordFailedCandidates({ storage, taskId = '', options = {}, unitIndexes = [], clips = [], qaFailures = [] } = {}) {
  if (!qaFailures.length) return;
  const history = Array.isArray(storage.getOutput(taskId, 'video_failed_candidates')) ? storage.getOutput(taskId, 'video_failed_candidates') : [];
  history.push({
    generation_id: options.generation_id || options._generationId || storage.getTask(taskId)?.active_generation_id || '',
    unit_indexes: unitIndexes.slice(), clips: unitIndexes.map(index => clips[index] || null),
    qa_failures: qaFailures, recorded_at: new Date().toISOString(),
  });
  storage.saveOutput(taskId, 'video_failed_candidates', history.slice(-50));
}

function restoreUnitFailure({ storage, videoAdapter, taskId = '', clips = [], previousClips = [], unitIndexes = [], remainingUnits = [], totalShots = 0 } = {}) {
  const indexes = rollbackIndexes({ unitIndexes, remainingUnits });
  restorePreviousClips({ clips, previousClips, indexes });
  const failedIndexes = new Set((Array.isArray(unitIndexes) ? unitIndexes : []).map(Number));
  indexes.forEach(index => {
    const status = storage.getOutput(taskId, `video_shot_status_${index + 1}`) || {};
    if (!failedIndexes.has(index)) {
      videoAdapter.updateVideoShotStatus(taskId, index, { ...status, stopped_after_unit_failure: true }, totalShots);
      return;
    }
    videoAdapter.updateVideoShotStatus(taskId, index, {
      ...status, last_attempt_provider_task_id: status.provider_task_id || '',
      last_attempt_provider_submission_state: status.provider_submission_state || (status.provider_task_id ? 'submitted' : 'not_submitted'),
      last_attempt_billing_state: status.billing_state || (status.provider_task_id ? 'unknown' : 'not_submitted'),
      stopped_after_unit_failure: true, previous_clip_restored: !!previousClips[index],
    }, totalShots);
  });
  storage.saveOutput(taskId, 'video_clips', clips);
  return indexes;
}

module.exports = { rollbackIndexes, restorePreviousClips, shouldRestoreUnitFailure, recordFailedCandidates, restoreUnitFailure };
