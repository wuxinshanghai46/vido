const storage = require('./storageService');
const keyframeContractFreshness = require('./keyframeContractFreshnessService');

/** Persist scoped keyframe freshness and return the browser-authoritative artifact snapshot. */
function persistAndSnapshot(taskId, contracts = []) {
  const previous = storage.getOutput(taskId, 'keyframe_contracts') || [];
  const changedIndexes = contracts
    .map((contract, index) => keyframeContractFreshness.contractMatches(previous[index], contract) ? -1 : index)
    .filter(index => index >= 0);
  keyframeContractFreshness.persist(taskId, contracts, {
    clearDownstream: changedIndexes.length > 0,
    changedIndexes,
  });
  return {
    changed_indexes: changedIndexes,
    keyframes: storage.getOutput(taskId, 'keyframes') || [],
    quality_review: storage.getOutput(taskId, 'quality_review'),
    tts_audio: storage.getOutput(taskId, 'tts_audio'),
    video_clips: storage.getOutput(taskId, 'video_clips') || [],
    final_video: storage.getOutput(taskId, 'final_video'),
  };
}

module.exports = { persistAndSnapshot };
