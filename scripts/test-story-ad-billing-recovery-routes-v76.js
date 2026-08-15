'use strict';

const assert = require('assert/strict');
const register = require('../src/routes/newStoryAd/visualAssetBillingRoutes');

async function main() {
  const routes = [], calls = [];
  const router = {
    post(path, handler) { routes.push({ method: 'POST', path, handler }); },
    get(path, handler) { routes.push({ method: 'GET', path, handler }); },
  };
  const authorization = {
    authorizeTaskRetry(input) { calls.push(['single', input]); return { authorization_id: 'single-ok' }; },
    authorizeTaskRetryBatch(input) { calls.push(['batch', input]); return { authorization_id: 'batch-ok' }; },
    listBillingReviews(taskId) { calls.push(['list', taskId]); return { task_id: taskId, reviews: [] }; },
  };
  register(router, {
    asyncRoute: handler => handler,
    taskForReq(req) { if (!req.allowed) throw Object.assign(new Error('forbidden'), { code: 'TASK_FORBIDDEN' }); },
    userFromReq: req => req.user,
    authorization,
  });
  assert.deepEqual(routes.map(({ method, path }) => `${method} ${path}`), [
    'POST /tasks/:id/visual-assets/retry-authorization',
    'POST /tasks/:id/visual-assets/retry-authorizations',
    'GET /tasks/:id/visual-assets/billing-reviews',
  ]);
  const response = () => ({ headers: {}, setHeader(name, value) { this.headers[name] = value; }, json(value) { this.body = value; } });
  const denied = { allowed: false, params: { id: 'other-task' }, user: { id: 'attacker' }, body: {} };
  await assert.rejects(() => routes[1].handler(denied, response()), /forbidden/);
  assert.equal(calls.length, 0, 'ownership rejection must happen before authorization service access');

  const batchRes = response();
  await routes[1].handler({
    allowed: true, params: { id: 'task-1' }, user: { id: 'owner-7' },
    body: {
      support_id: 'support-1', checkpoint_keys: ['cp-a', 'cp-b'],
      expected_review_revisions: { 'cp-a': 2, 'cp-b': 4 },
      accept_duplicate_charge_risk: true, accepted_by: 'spoofed-user',
    },
  }, batchRes);
  assert.deepEqual(calls[0], ['batch', {
    taskId: 'task-1', supportId: 'support-1', acceptedBy: 'owner-7',
    acceptDuplicateChargeRisk: true, checkpointKeys: ['cp-a', 'cp-b'],
    expectedReviewRevisions: { 'cp-a': 2, 'cp-b': 4 },
  }]);
  assert.equal(batchRes.body.success, true);

  const getRes = response();
  await routes[2].handler({ allowed: true, params: { id: 'task-1' }, user: { id: 'owner-7' } }, getRes);
  assert.equal(getRes.headers['Cache-Control'], 'private, no-store, no-cache, must-revalidate');
  assert.equal(getRes.headers.Vary, 'Authorization');
  assert.deepEqual(calls[1], ['list', 'task-1']);
  console.log(JSON.stringify({ passed: true, route_count: routes.length, ownership_before_service: true, body_identity_ignored: true }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
