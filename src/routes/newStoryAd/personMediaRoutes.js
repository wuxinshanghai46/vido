'use strict';

function registerPersonMediaRoutes(router, deps = {}) {
  const { asyncRoute, taskForReq, userFromReq, personDossiers, storage, mediaModelSelection } = deps;

  router.get('/tasks/:id/person-production', asyncRoute(async (req, res) => {
    taskForReq(req);
    const production = personDossiers.getProduction(req.params.id, userFromReq(req));
    return res.json({ success: true, production });
  }));

  router.post('/tasks/:id/person-outfit-candidates', asyncRoute(async (req, res) => {
    taskForReq(req);
    const body = mediaModelSelection.applySelection('new_story_ad.person_sheet', req.body || {});
    const started = personDossiers.startCandidates({
      taskId: req.params.id,
      user: userFromReq(req),
      sourceId: body.source_id || body.sourceId,
      outfitSourceId: body.outfit_source_id || body.outfitSourceId || '',
      mode: body.mode || 'ai_outfit',
      wardrobe: body.wardrobe || '',
      personProfile: body.person_profile || body.personProfile || {},
      imageModel: body.image_model,
    });
    return res.status(202).json({ success: true, ...started });
  }));

  router.post('/tasks/:id/person-outfit-candidates/:candidateId/approve', asyncRoute(async (req, res) => {
    taskForReq(req);
    const production = personDossiers.approveCandidate({
      taskId: req.params.id,
      candidateId: req.params.candidateId,
      user: userFromReq(req),
    });
    return res.json({ success: true, production });
  }));

  router.post('/tasks/:id/person-dossiers', asyncRoute(async (req, res) => {
    taskForReq(req);
    const body = mediaModelSelection.applySelection('new_story_ad.person_dossier_atlas', req.body || {});
    const started = personDossiers.startDossier({ taskId: req.params.id, user: userFromReq(req), imageModel: body.image_model });
    return res.status(202).json({ success: true, ...started });
  }));

  router.post('/tasks/:id/person-action-assets', asyncRoute(async (req, res) => {
    taskForReq(req);
    const body = mediaModelSelection.applySelection('new_story_ad.person_sheet', req.body || {});
    const storyboard = body.storyboard || body.storyboard_table || storage.getOutput(req.params.id, 'storyboard_table') || [];
    const started = personDossiers.startActionAssets({
      taskId: req.params.id, user: userFromReq(req), storyboard, imageModel: body.image_model,
    });
    return res.status(202).json({ success: true, ...started });
  }));

  router.post('/tasks/:id/person-production/:kind/cancel', asyncRoute(async (req, res) => {
    taskForReq(req);
    const production = personDossiers.cancelJob({ taskId: req.params.id, kind: req.params.kind, user: userFromReq(req) });
    return res.json({ success: true, production });
  }));
}

module.exports = registerPersonMediaRoutes;
