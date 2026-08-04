const referenceVideoAnalyses = require('../newStoryAd/referenceVideoAnalysisService');
const referenceAnalysisTaskSync = require('../newStoryAd/referenceAnalysisTaskSyncService');

/**
 * The analysis record is the progress/status authority. Task context is a
 * durable projection and can lag if the browser was closed during analysis.
 */
function resolve(task = {}, context = {}, clean = value => String(value || '').trim()) {
  const saved = context.reference_video_analysis && typeof context.reference_video_analysis === 'object'
    ? context.reference_video_analysis
    : {};
  const analysisId = clean(saved.analysis_id || saved.id || context.reference_video_analysis_id, 120);
  if (!analysisId) return context;
  const ownerId = clean(task.user_id || context.user_id || context.userId, 120);
  if (!ownerId) return context;
  try {
    const analysis = referenceVideoAnalyses.get(analysisId, { id: ownerId, userId: ownerId });
    if (analysis.task_id && String(analysis.task_id) !== String(task.id)) return context;
    return referenceAnalysisTaskSync.projectContext(context, referenceVideoAnalyses.taskRecord(analysis));
  } catch {
    return context;
  }
}

module.exports = { resolve };
