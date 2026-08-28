'use strict';

const sceneBatchFactory = require('../../services/newStoryAd/sceneBatchOrchestrationService');

function registerSceneBatchRoutes(router, deps = {}) {
  const {
    asyncRoute, taskForReq, queueTaskStage, storage,
    sceneAssetService, scenePromptConfirmation, targetProgress, cancellation,
  } = deps;
  const orchestration = sceneBatchFactory.create({
    storage,
    sceneAssets: sceneAssetService,
    promptAuthority: scenePromptConfirmation,
    targetProgress,
    cancellation,
  });

  router.post('/tasks/:id/scene-actions', asyncRoute(async (req, res) => {
    taskForReq(req);
    const batchPlan = orchestration.plan(req.params.id, req.body || {});
    req.body = {
      ...(req.body || {}),
      request_key: String(req.body?.request_key || req.body?.requestKey
        || `${req.params.id}:scene_batch:${batchPlan.signature}`).slice(0, 180),
    };
    return queueTaskStage(req, res, 'scene_asset', job => (
      orchestration.execute(req.params.id, batchPlan, job)
    ), {
      scopeId: orchestration.DEFAULT_SCOPE_ID,
      deadlineMs: Math.max(20 * 60 * 1000, batchPlan.actions.length * 12 * 60 * 1000),
      failureContext: { scene_name: '场景批处理' },
    });
  }));
}

module.exports = registerSceneBatchRoutes;
