function registerPropRoutes(router, {
  asyncRoute,
  taskForReq,
  queueTaskStage,
  propAssetService,
  mediaModelSelection,
}) {
  router.get('/tasks/:id/prop-assets', asyncRoute(async (req, res) => {
    taskForReq(req);
    res.json({
      success: true,
      task_id: req.params.id,
      prop_assets: propAssetService.listPropAssets(req.params.id),
    });
  }));

  router.post('/tasks/:id/prop-assets', asyncRoute(async (req, res) => {
    taskForReq(req);
    const body = mediaModelSelection.applySelection('new_story_ad.prop_dossier_atlas', req.body || {});
    const propId = String(body.id || body.prop_id || body.propId || body.name || 'prop')
      .replace(/[^a-z0-9._-]/ig, '_')
      .slice(0, 100);
    body.idempotency_key = body.idempotency_key
      || `${req.params.id}:prop_asset:${propId}:r${Math.max(1, Number(body.revision || 1) || 1)}`;
    return queueTaskStage(req, res, 'prop_asset', job => propAssetService.generatePropAsset(req.params.id, {
      ...body,
      generation_id: job.generationId,
    }), {
      failureContext: {
        prop_id: body.id || body.prop_id || body.propId || '',
        prop_name: body.name || '',
      },
    });
  }));

  router.post('/tasks/:id/prop-assets/refresh-timeline', asyncRoute(async (req, res) => {
    taskForReq(req);
    res.json({
      success: true,
      task_id: req.params.id,
      prop_assets: propAssetService.refreshPropTimelines(req.params.id),
    });
  }));
}

module.exports = registerPropRoutes;
