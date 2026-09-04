const storage = require('./storageService');
const videoFrameQa = require('./videoFrameQaService');
const costAuthorization = require('./videoCostAuthorizationService');
const clipStatusRecovery = require('./videoClipStatusRecoveryService');

/** Prepare only local evidence needed at the boundary of paid scoped units. */
async function prepareRequiredBoundaryEvidence(taskId, preflightPlan = {}) {
  let clips = Array.isArray(storage.getOutput(taskId, 'video_clips'))
    ? storage.getOutput(taskId, 'video_clips')
    : [];
  const recoveredClips = clipStatusRecovery.recoverFromOutputRows(storage.listOutputs(taskId), clips);
  if (recoveredClips.some((clip, index) => clip && !clips[index])) storage.saveOutput(taskId, 'video_clips', recoveredClips);
  clips = recoveredClips;
  const paidIndexes = (preflightPlan.units || []).filter(unit => unit.paid !== false).flatMap(unit => unit.member_indexes || []);
  const reviewIndexes = (preflightPlan.shots || []).filter(item => item.action === 'review_only' && item.review_scope === 'cross_shot').map(item => item.index);
  const targetIndexes = [...new Set(paidIndexes.concat(reviewIndexes))];
  if (!targetIndexes.length) return clips;
  try {
    const evidence = await videoFrameQa.ensureBoundaryFrameEvidence({ taskId, clips, targetIndexes, includeTargetIndexes: reviewIndexes });
    clips = evidence.clips;
    if (evidence.backfilled_indexes.length) storage.saveOutput(taskId, 'video_clips', clips);
    return clips;
  } catch (error) {
    costAuthorization.transition(taskId, 'voided', { void_reason: error.code || 'VIDEO_QA_EVIDENCE_MISSING' });
    throw error;
  }
}

async function prepareClipForReview(taskId, clips, index, { required = true } = {}) {
  const clip = clips[index];
  if (!required) return { clip, frames: null };
  const prepared = await videoFrameQa.prepareClipReviewFrameEvidence({ taskId, clip, index });
  clips[index] = prepared.clip;
  if (prepared.backfilled) storage.saveOutput(taskId, 'video_clips', clips);
  return { clip: prepared.clip, frames: prepared.frames };
}

module.exports = { prepareRequiredBoundaryEvidence, prepareClipForReview };
