const router = require('express').Router();
const crypto = require('crypto');
const { isAdmin } = require('../../middleware/auth');
const projectRepository = require('../../services/videoCanvas/projectRepository');
const runRepository = require('../../services/videoCanvas/runRepository');
const { createPlan, materializeNodeRuns } = require('../../services/videoCanvas/planService');
const settingsRepository = require('../../services/videoCanvas/settingsRepository');
const { projectForRequest, runForRequest } = require('./helpers');

router.get('/', (req, res) => {
  const data = runRepository.listRuns({ userId: req.user.id, includeAll: isAdmin(req) && req.query.all === '1', projectId: req.query.projectId || '', status: req.query.status || '', limit: req.query.limit });
  res.json({ success: true, data });
});
router.post('/', (req, res) => {
  const project = projectForRequest(req, req.body.projectId);
  if (!project) return res.status(404).json({ success: false, error: '项目不存在' });
  const revision = projectRepository.getRevision(req.body.revisionId || project.current_revision_id);
  if (!revision || revision.project_id !== project.id) return res.status(404).json({ success: false, error: '图版本不存在' });
  const plan = createPlan({ project, revision, requestedNodeIds: req.body.requestedNodeIds || [] });
  if (!plan.valid) return res.status(400).json({ success: false, code: 'INVALID_GRAPH', errors: plan.errors });
  if (plan.planFingerprint !== req.body.planFingerprint) return res.status(409).json({ success: false, code: 'PLAN_CHANGED', error: '画布或运行计划已变化，请重新确认', data: plan });
  if (plan.paidNodeCount > 0 && req.body.confirmPaid !== true) return res.status(402).json({ success: false, code: 'PAID_CONFIRMATION_REQUIRED', error: '包含付费节点，请确认费用后再运行', data: plan });
  const userSettings = settingsRepository.getSettings(req.user.id).settings;
  if (plan.estimatedCostMax > userSettings.maxCostUsd + 1e-9) return res.status(400).json({ success: false, code: 'USER_COST_LIMIT_EXCEEDED', error: `本次预计费用超过画布个人上限 $${userSettings.maxCostUsd.toFixed(4)}`, data: { plan, settings: userSettings } });
  const limit = Number(req.body.confirmedCostLimit || 0);
  if (plan.estimatedCostMax > 0 && limit + 1e-9 < plan.estimatedCostMax) return res.status(400).json({ success: false, code: 'COST_LIMIT_TOO_LOW', error: '确认的费用上限低于当前计划费用', data: plan });
  const idempotencyKey = String(req.body.idempotencyKey || req.headers['idempotency-key'] || '').trim();
  if (!idempotencyKey) return res.status(400).json({ success: false, code: 'IDEMPOTENCY_KEY_REQUIRED', error: '缺少幂等键' });
  const result = runRepository.createRun({ run: { projectId: project.id, revisionId: revision.id, userId: req.user.id, planFingerprint: plan.planFingerprint, idempotencyKey: idempotencyKey.slice(0, 160), requestedNodeIds: plan.requestedNodeIds, estimatedCostMin: plan.estimatedCostMin, estimatedCostMax: plan.estimatedCostMax, confirmedCostLimit: limit }, nodeRuns: materializeNodeRuns(plan) });
  if (result.idempotencyConflict) return res.status(409).json({ success: false, code: 'IDEMPOTENCY_KEY_REUSED', error: '该幂等键已用于另一份运行计划，请刷新后重新提交' });
  res.status(result.duplicate ? 200 : 202).json({ success: true, duplicate: result.duplicate, data: result });
});
router.get('/:id', (req, res) => {
  if (!runForRequest(req, req.params.id)) return res.status(404).json({ success: false, error: '运行任务不存在' });
  const data = runRepository.getRunBundle(req.params.id); data.costEntries = runRepository.listCostEntries(req.params.id);
  res.json({ success: true, data });
});
router.post('/:id/cancel', (req, res) => {
  if (!runForRequest(req, req.params.id)) return res.status(404).json({ success: false, error: '运行任务不存在' });
  res.json({ success: true, data: runRepository.cancelRun(req.params.id) });
});
router.post('/:id/nodes/:nodeRunId/retry', (req, res) => {
  if (!runForRequest(req, req.params.id)) return res.status(404).json({ success: false, error: '运行任务不存在' });
  const node = runRepository.getNodeRun(req.params.nodeRunId);
  if (!node || node.run_id !== req.params.id) return res.status(404).json({ success: false, error: '节点任务不存在' });
  if (node.billing_state === 'unknown') return res.status(409).json({ success: false, code: 'BILLING_REVIEW_REQUIRED', error: '该节点计费状态未知，必须先核对供应商任务，禁止直接重试' });
  const data = runRepository.retryNode(node.id);
  if (!data) return res.status(409).json({ success: false, error: '当前节点状态不能重试' });
  res.status(202).json({ success: true, data });
});
router.get('/:id/events', (req, res) => {
  if (!runForRequest(req, req.params.id)) return res.status(404).json({ success: false, error: '运行任务不存在' });
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders?.();
  let cursor = Number(req.query.after || req.headers['last-event-id'] || 0); let closed = false;
  const send = () => {
    for (const event of runRepository.listEvents(req.params.id, cursor, 200)) {
      cursor = event.sequence_no; res.write(`id: ${event.sequence_no}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    res.write(': heartbeat\n\n');
  };
  send(); const timer = setInterval(send, 1500);
  req.on('close', () => { closed = true; clearInterval(timer); });
  setTimeout(() => { if (!closed) { clearInterval(timer); res.end(); } }, 30000).unref?.();
});

module.exports = router;
