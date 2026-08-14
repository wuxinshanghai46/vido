const referenceVideoAnalyses = require('../newStoryAd/referenceVideoAnalysisService');
const referenceAnalysisTaskSync = require('../newStoryAd/referenceAnalysisTaskSyncService');

/**
 * The analysis record is the progress/status authority. Task context is a
 * durable projection and can lag if the browser was closed during analysis.
 */
function snapshot(task = {}, context = {}, clean = value => String(value || '').trim(), options = {}) {
  const saved = context.reference_video_analysis && typeof context.reference_video_analysis === 'object'
    ? context.reference_video_analysis
    : {};
  const analysisId = clean(saved.analysis_id || saved.id || context.reference_video_analysis_id, 120);
  const fallback = { context, analysis: saved, analysis_id: analysisId, source: 'task_context' };
  if (!analysisId) return fallback;
  const ownerId = clean(task.user_id || context.user_id || context.userId, 120);
  if (!ownerId) {
    if (options.required === true) throw Object.assign(new Error('任务缺少参考分析所有者，无法确认权威报告'), { code: 'REFERENCE_OWNER_MISSING', status: 409 });
    return fallback;
  }
  try {
    const analysis = referenceVideoAnalyses.get(analysisId, { id: ownerId, userId: ownerId });
    if (analysis.task_id && String(analysis.task_id) !== String(task.id)) {
      throw Object.assign(new Error('参考分析已绑定到其他任务，无法确认'), { code: 'REFERENCE_TASK_MISMATCH', status: 409 });
    }
    const authoritative = referenceVideoAnalyses.taskRecord(analysis);
    const projectedContext = referenceAnalysisTaskSync.projectContext(context, authoritative);
    return {
      context: projectedContext,
      analysis: projectedContext.reference_video_analysis || authoritative,
      analysis_id: analysisId,
      source: 'analysis_record',
    };
  } catch (error) {
    if (options.required === true) throw error;
    return fallback;
  }
}

function resolve(task = {}, context = {}, clean = value => String(value || '').trim(), options = {}) {
  return snapshot(task, context, clean, options).context;
}

module.exports = { resolve, snapshot };
