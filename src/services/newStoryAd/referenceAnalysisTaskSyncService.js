const storage = require('./storageService');
const storyAdService = require('./storyAdService');
const assetPlanService = require('./assetPlanService');
const productAssetResolver = require('./productAssetResolverService');

const activeSyncs = new Map();

function text(value = '') {
  return String(value || '').trim();
}

function comparableText(value = '') {
  return text(value).replace(/\s+/g, ' ');
}

function terminalAt(reference = {}) {
  return text(reference.completed_at || reference.failed_at || reference.cancelled_at);
}

function referenceId(value = {}) {
  return text(value.analysis_id || value.id);
}

function completedAndValid(reference = {}) {
  return reference.status === 'completed' && reference.analysis_quality?.valid === true;
}

function canReplaceBrief(context = {}) {
  const brief = text(context.brief || context.content);
  const source = text(context.brief_source || context.briefSource);
  return !brief || source !== 'user';
}

function canReplaceProduct(context = {}) {
  const product = text(context.product_subject || context.productSubject);
  return !product || productAssetResolver.GENERIC_SUBJECTS.has(product);
}

function completionPatch(context = {}, reference = {}) {
  const patch = { reference_video_analysis: reference };
  if (!completedAndValid(reference)) return patch;

  const generatedBrief = text(
    reference.generated_brief
      || reference.summary
      || reference.story_outline?.logline,
  );
  const product = text(reference.source_facts?.product_or_service);
  if (generatedBrief && canReplaceBrief(context)) Object.assign(patch, {
    brief: generatedBrief,
    content: generatedBrief,
    brief_source: 'reference_analysis',
  });
  if (product && canReplaceProduct(context)) patch.product_subject = product;
  return patch;
}

/**
 * Build the read projection from the authoritative analysis record. This is
 * intentionally side-effect free so opening an old project cannot replay a
 * historical progress bar while a repair write is still pending.
 */
function projectContext(context = {}, reference = {}) {
  const currentId = referenceId(context.reference_video_analysis || {});
  const nextId = referenceId(reference);
  if (!nextId || (currentId && currentId !== nextId)) return context;
  return { ...context, ...completionPatch(context, reference) };
}

async function runSync(analysis = {}, reference = {}) {
  const taskId = text(analysis.task_id || analysis.taskId);
  const analysisId = referenceId(reference) || referenceId(analysis);
  if (!taskId || !analysisId) return { synced: false, reason: 'analysis_not_bound' };

  const task = storage.getTask(taskId);
  if (!task) return { synced: false, reason: 'task_not_found' };
  const ownerId = text(task.user_id || task.request?.user_id || analysis.user_id);
  if (text(analysis.user_id) && ownerId && text(analysis.user_id) !== ownerId) {
    return { synced: false, reason: 'owner_mismatch' };
  }

  const previousContext = storage.getOutput(taskId, 'context') || task.request || {};
  const boundId = referenceId(previousContext.reference_video_analysis || {});
  if (boundId && boundId !== analysisId) return { synced: false, reason: 'newer_reference_bound' };

  const patch = completionPatch(previousContext, reference);
  const currentReference = previousContext.reference_video_analysis || {};
  const completedValid = completedAndValid(reference);
  const projectionFingerprint = completedValid
    ? assetPlanService.referenceProjectionFingerprint(reference)
    : '';
  const sameProjection = !completedValid
    || text(previousContext.reference_analysis_projection?.fingerprint) === projectionFingerprint;
  const sameCompletedContract = !completedAndValid(reference)
    || (
      currentReference.analysis_quality?.valid === true
      && Boolean(currentReference.reference_understanding)
      && text(currentReference.generated_brief) === text(reference.generated_brief)
    );
  const sameBrief = !Object.prototype.hasOwnProperty.call(patch, 'brief')
    || (comparableText(previousContext.brief) === comparableText(patch.brief)
      && text(previousContext.brief_source) === 'reference_analysis');
  const sameProduct = !Object.prototype.hasOwnProperty.call(patch, 'product_subject')
    || text(previousContext.product_subject) === text(patch.product_subject);
  const sameTerminal = reference.status === previousContext.reference_video_analysis?.status
    && Number(reference.progress || 0) === Number(previousContext.reference_video_analysis?.progress || 0)
    && terminalAt(reference) === terminalAt(previousContext.reference_video_analysis || {})
    && sameCompletedContract
    && sameBrief
    && sameProduct
    && sameProjection;

  let updated = { context: previousContext };
  if (!sameTerminal) {
    updated = storyAdService.updateTaskRequest(taskId, patch, { id: ownerId, userId: ownerId });
  }

  let projection = {
    projected: false,
    reason: completedValid && sameProjection ? 'unchanged' : 'reference_not_completed_or_invalid',
    model_call_count: 0,
  };
  if (completedValid && !sameProjection) {
    projection = await assetPlanService.projectReferenceIntake(taskId, {
      previous_context: previousContext,
      reference_analysis: reference,
    });
  }
  return {
    synced: !sameTerminal || projection.projected === true,
    reason: projection.projected ? 'completed_reference_projected' : (sameTerminal ? projection.reason || 'unchanged' : 'terminal_state_synced'),
    model_call_count: 0,
    context: projection.context || updated.context,
  };
}

function syncTerminalAnalysis(analysis = {}, reference = {}) {
  const status = text(reference.status || analysis.status).toLowerCase();
  if (!['completed', 'failed', 'cancelled'].includes(status)) {
    return Promise.resolve({ synced: false, reason: 'analysis_not_terminal' });
  }
  const key = `${text(analysis.task_id || analysis.taskId)}:${referenceId(reference) || referenceId(analysis)}`;
  if (activeSyncs.has(key)) return activeSyncs.get(key);
  const promise = Promise.resolve()
    .then(() => runSync(analysis, reference))
    .finally(() => activeSyncs.delete(key));
  activeSyncs.set(key, promise);
  return promise;
}

module.exports = {
  activeSyncs,
  canReplaceBrief,
  canReplaceProduct,
  comparableText,
  completionPatch,
  completedAndValid,
  projectContext,
  syncTerminalAnalysis,
};
