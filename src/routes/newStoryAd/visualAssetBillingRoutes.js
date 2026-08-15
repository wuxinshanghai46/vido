'use strict';

function registerVisualAssetBillingRoutes(router, deps = {}) {
  const { asyncRoute, taskForReq, userFromReq, authorization } = deps;
  if (!router || typeof asyncRoute !== 'function' || typeof taskForReq !== 'function'
    || typeof userFromReq !== 'function' || !authorization) {
    throw new Error('visual asset billing routes require router, ownership and authorization dependencies');
  }
  const common = req => {
    const body = req.body || {}, user = userFromReq(req) || {};
    return {
      taskId: req.params.id,
      supportId: String(body.support_id || body.supportId || ''),
      acceptedBy: String(user.id || user.userId || user.username || 'anonymous'),
      acceptDuplicateChargeRisk: body.accept_duplicate_charge_risk === true || body.acceptDuplicateChargeRisk === true,
    };
  };

  router.post('/tasks/:id/visual-assets/retry-authorization', asyncRoute(async (req, res) => {
    taskForReq(req);
    const body = req.body || {};
    const result = authorization.authorizeTaskRetry({
      ...common(req), checkpointKey: String(body.checkpoint_key || body.checkpointKey || ''),
    });
    res.json({ success: true, ...result });
  }));
  router.post('/tasks/:id/visual-assets/retry-authorizations', asyncRoute(async (req, res) => {
    taskForReq(req);
    const body = req.body || {};
    const result = authorization.authorizeTaskRetryBatch({
      ...common(req), checkpointKeys: body.checkpoint_keys || body.checkpointKeys || [],
      expectedReviewRevisions: body.expected_review_revisions || body.expectedReviewRevisions || {},
    });
    res.json({ success: true, ...result });
  }));
  router.get('/tasks/:id/visual-assets/billing-reviews', asyncRoute(async (req, res) => {
    taskForReq(req);
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.setHeader('Vary', 'Authorization');
    res.json({ success: true, ...authorization.listBillingReviews(req.params.id) });
  }));
}

module.exports = registerVisualAssetBillingRoutes;
