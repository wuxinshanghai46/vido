'use strict';

const sceneBatchFactory = require('../../services/newStoryAd/sceneBatchOrchestrationService');
const sceneVisualAcceptanceFactory = require('../../services/newStoryAd/sceneVisualAcceptanceService');

function registerSceneBatchRoutes(router, deps = {}) {
  const {
    asyncRoute, taskForReq, queueTaskStage, storage,
    sceneAssetService, scenePromptConfirmation, targetProgress, cancellation, mediaModelSelection, userFromReq,
  } = deps;
  const orchestration = sceneBatchFactory.create({
    storage,
    sceneAssets: sceneAssetService,
    promptAuthority: scenePromptConfirmation,
    targetProgress,
    cancellation,
  });
  const sceneVisualAcceptance = sceneVisualAcceptanceFactory.create({ storage });

  router.post('/tasks/:id/scene-acceptance', asyncRoute(async (req, res) => {
    taskForReq(req);
    const acceptance = sceneVisualAcceptance.acceptCurrent(req.params.id, userFromReq?.(req) || {});
    return res.json({ success: true, acceptance, model_call_count: 0 });
  }));

  router.post('/tasks/:id/scene-actions', asyncRoute(async (req, res) => {
    taskForReq(req);
    const selectedBody = mediaModelSelection.applySelection('new_story_ad.scene_asset', req.body || {});
    const batchPlan = orchestration.plan(req.params.id, selectedBody);
    req.body = {
      ...selectedBody,
      request_key: String(selectedBody.request_key || selectedBody.requestKey
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
