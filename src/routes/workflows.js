/**
 * VIDO Workflow API — 复数 /api/workflows
 * 与现有 /api/workflow（drawflow 流程图存储）区分
 */
const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
const engine = require('../services/workflowEngine');
require('../services/workflowCapabilities'); // 触发节点注册

// GET /api/workflows/capabilities — 节点能力列表（供前端编辑器渲染节点选项）
router.get('/capabilities', (req, res) => {
  res.json({ success: true, capabilities: engine.getCapabilities() });
});

// GET /api/workflows — 工作流列表（admin 看全部，普通用户看自己的+内置）
router.get('/', (req, res) => {
  const isAdm = isAdmin(req);
  const userId = req.user?.id;
  const all = engine.listWorkflows({ userId: isAdm ? null : userId });
  res.json({
    success: true,
    workflows: all.map(w => ({
      id: w.id,
      name: w.name,
      description: w.description || '',
      version: w.version || 1,
      category: w.category || 'custom',
      builtin: !!w._builtin,
      owner: w.owner || null,
      inputs: w.inputs || [],
      outputs: w.outputs || [],
      stepCount: (w.steps || []).length,
      updated_at: w.updated_at || null,
    })),
  });
});

// GET /api/workflows/:id — 单个工作流详情（含完整 steps）
router.get('/:id', (req, res) => {
  const wf = engine.getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ success: false, error: '工作流不存在' });
  res.json({ success: true, workflow: wf });
});

// POST /api/workflows — 创建/保存工作流（admin only）
router.post('/', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: '需要管理员权限' });
  try {
    const wf = engine.saveWorkflow(req.body, { userId: req.user?.id });
    res.json({ success: true, workflow: wf });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// PUT /api/workflows/:id — 更新工作流（admin only）
router.put('/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: '需要管理员权限' });
  try {
    const body = { ...req.body, id: req.params.id };
    const wf = engine.saveWorkflow(body, { userId: req.user?.id });
    res.json({ success: true, workflow: wf });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// DELETE /api/workflows/:id — 删除工作流（admin only，内置不可删）
router.delete('/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: '需要管理员权限' });
  try {
    const ok = engine.deleteWorkflow(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: '工作流不存在' });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST /api/workflows/:id/run — 触发执行（同步等结果；长任务可改异步）
router.post('/:id/run', async (req, res) => {
  const wf = engine.getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ success: false, error: '工作流不存在' });
  const inputs = req.body?.inputs || {};
  // 同步等结果（前端 modal 显示加载即可；3-5 分钟内完成）
  try {
    const run = await engine.runWorkflow(wf, inputs, {
      onProgress: () => {},
    });
    if (run.status === 'failed') {
      return res.json({ success: false, error: run.error, run });
    }
    res.json({ success: true, run });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/workflows/runs/:runId — 单次运行详情
router.get('/runs/:runId', (req, res) => {
  const r = engine.getRun(req.params.runId);
  if (!r) return res.status(404).json({ success: false, error: '运行记录不存在' });
  res.json({ success: true, run: r });
});

// GET /api/workflows/:id/runs — 某工作流的运行历史
router.get('/:id/runs', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const runs = engine.listRuns({ workflowId: req.params.id, limit });
  res.json({ success: true, runs });
});

// GET /api/workflows/usage/summary — Token+费用汇总（admin）
router.get('/usage/summary', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: '需要管理员权限' });
  const { trackUsage: _, ...tracker } = require('../services/usageTracker');
  const hours = Math.min(720, Math.max(1, Number(req.query.hours) || 24));
  const summary = tracker.usageSummary({ hours });
  res.json({ success: true, ...summary });
});

// GET /api/workflows/usage/log — 最近调用记录（admin）
router.get('/usage/log', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: '需要管理员权限' });
  const { readUsage } = require('../services/usageTracker');
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const source = req.query.source || undefined;
  const recs = readUsage({ limit, source });
  res.json({ success: true, records: recs });
});

module.exports = router;
