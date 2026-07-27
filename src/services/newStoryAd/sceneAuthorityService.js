const revisionService = require('./revisionService');

function currentState({ storage, taskId, task, normalizeScenePlan }) {
  const planInput = storage.getOutput(taskId, 'scene_config');
  const assetsInput = storage.getOutput(taskId, 'scene_assets');
  return {
    plan: planInput ? normalizeScenePlan(planInput) : null,
    assets: Array.isArray(assetsInput) ? assetsInput : [],
  };
}

function resolveChange({ previousCtx, builtCtx, explicitScenePlan, currentPlan, body, requestedScope }) {
  const nextPlan = explicitScenePlan || currentPlan;
  const delta = revisionService.scenePlanDelta(currentPlan || {}, nextPlan || {});
  const previous = currentPlan ? { ...previousCtx, scene_mode: currentPlan.scene_mode, scene_plan: currentPlan } : previousCtx;
  const next = nextPlan ? { ...builtCtx, scene_mode: nextPlan.scene_mode, scene_plan: nextPlan } : builtCtx;
  const requested = Array.isArray(body.changed_domains || body.changedDomains)
    ? [...(body.changed_domains || body.changedDomains)]
    : String(body.changed_domains || body.changedDomains || requestedScope || '').split(/[,\s]+/);
  const authoritativeRequested = nextPlan && !delta.changed
    ? requested.filter(domain => String(domain || '').trim().toLowerCase() !== 'scene')
    : requested;
  return {
    delta,
    changed_domains: revisionService.changeDomains(previous, next, authoritativeRequested),
  };
}

function assetsForContext(currentAssets, delta) {
  return delta.changed
    ? revisionService.compatibleSceneAssets(currentAssets, delta)
    : currentAssets;
}

function assertCompletePlan({ savingProgress, requestedScope, explicitScenePlan, currentPlan, changedDomains }) {
  if (explicitScenePlan) return;
  if (!(savingProgress && requestedScope === 'scene') && !(currentPlan && changedDomains.includes('scene'))) return;
  const error = new Error('场景变更缺少完整逐空间场景计划；已在持久化和失效清理前停止，原场景合同未改动');
  error.code = 'SCENE_PLAN_REQUIRED_FOR_SCENE_SAVE';
  error.status = 422;
  error.retryable = false;
  throw error;
}

function publishAndInvalidate({
  storage,
  taskId,
  explicitScenePlan,
  delta,
  changedDomains,
  sceneAssets,
  contentRevision,
}) {
  const preserved = !!(
    explicitScenePlan
    && delta.changed
    && changedDomains.includes('scene')
    && !changedDomains.includes('source')
    && !changedDomains.includes('product')
  );
  if (preserved) {
    storage.saveOutput(taskId, 'scene_config', explicitScenePlan, { content_revision: contentRevision });
    if (sceneAssets.length) storage.saveOutput(taskId, 'scene_assets', sceneAssets, { content_revision: contentRevision });
    else storage.deleteOutput(taskId, 'scene_assets');
  }
  return {
    preserved,
    invalidated: revisionService.invalidateOutputs(storage, taskId, changedDomains, {
      preserveKinds: preserved ? ['scene_config', 'scene_assets'] : [],
    }),
  };
}

module.exports = {
  currentState,
  resolveChange,
  assetsForContext,
  assertCompletePlan,
  publishAndInvalidate,
};
