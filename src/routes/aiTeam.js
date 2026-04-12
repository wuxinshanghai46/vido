/**
 * AI 团队 API 路由
 *
 * 暴露 4 个新 agent 的 REST 端点：
 *   POST /api/ai-team/market-research  — 市场调研官
 *   POST /api/ai-team/copywriter       — 文案策划
 *   POST /api/ai-team/editor           — 剪辑顾问
 *   POST /api/ai-team/localizer        — 本地化
 *   GET  /api/ai-team/roster           — 团队名单
 */

const router = require('express').Router();
const aiTeam = require('../services/aiTeamService');
const kb = require('../services/knowledgeBaseService');
const orchestrator = require('../services/agentOrchestrator');

// —— 团队名单（用于前端展示所有 AI 岗位）——
router.get('/roster', (req, res) => {
  const types = kb.listAgentTypes();
  const callable = ['market_research', 'copywriter', 'editor', 'localizer'];
  const roster = types.map(t => ({
    ...t,
    callable: callable.includes(t.id),
    kb_only: !callable.includes(t.id),
  }));
  res.json({ success: true, data: roster });
});

// —— 市场调研官 ——
router.post('/market-research', async (req, res) => {
  try {
    const { query, platform, market, goal } = req.body || {};
    if (!query) return res.status(400).json({ success: false, error: 'query 必填' });
    const result = await aiTeam.agentMarketResearch({ query, platform, market, goal });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— 文案策划 ——
router.post('/copywriter', async (req, res) => {
  try {
    const { content, platform, genre, variantCount } = req.body || {};
    if (!content) return res.status(400).json({ success: false, error: 'content 必填' });
    const result = await aiTeam.agentCopywriter({ content, platform, genre, variantCount });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— 剪辑顾问 ——
router.post('/editor', async (req, res) => {
  try {
    const { shots, genre, targetDuration, mood } = req.body || {};
    if (!shots || !Array.isArray(shots) || shots.length === 0) {
      return res.status(400).json({ success: false, error: 'shots 数组必填' });
    }
    const result = await aiTeam.agentEditor({ shots, genre, targetDuration, mood });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— 本地化 ——
router.post('/localizer', async (req, res) => {
  try {
    const { content, sourceLang, targetMarket, contentType } = req.body || {};
    if (!content) return res.status(400).json({ success: false, error: 'content 必填' });
    if (!targetMarket) return res.status(400).json({ success: false, error: 'targetMarket 必填' });
    const result = await aiTeam.agentLocalizer({ content, sourceLang, targetMarket, contentType });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// 【v6 新增】跨 agent 调用 & 自主编排
// ═══════════════════════════════════════════════════

// 直接调用单个 agent（统一接口）
router.post('/execute/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { task } = req.body || {};
    if (!task) return res.status(400).json({ success: false, error: 'task 必填' });
    const result = await orchestrator.executeAgent(agentId, task);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 自主编排：用户只给自然语言任务，系统自动决定调用哪些 agent
router.post('/auto-execute', async (req, res) => {
  try {
    const { task } = req.body || {};
    if (!task) return res.status(400).json({ success: false, error: 'task 必填' });
    const result = await orchestrator.autoExecute(task);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 【v12 新增】运行完整多阶段工作流
// 真正跑 pipeline，每步调多个 agent，返回完整协作记录
// 【v13】新增 workflow_name 参数，可指定 9 种业务子工作流之一
router.post('/run-workflow', async (req, res) => {
  try {
    const { task, task_type = 'auto', workflow_name = 'auto' } = req.body || {};
    if (!task) return res.status(400).json({ success: false, error: 'task 必填' });

    // 设置更长的超时（多阶段 × 多 agent 并行调 LLM 可能需要 1-5 分钟）
    req.setTimeout(300000);
    res.setTimeout(300000);

    const result = await orchestrator.runWorkflow(task, {
      taskType: task_type,
      workflowName: workflow_name,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    console.error('[runWorkflow] failed:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 【v12 兼容】获取单一工作流定义（business=video, rd=rd_task）
router.get('/workflow-phases/:type', (req, res) => {
  try {
    const { type } = req.params;
    const phases = type === 'business' ? orchestrator.BUSINESS_PHASES : orchestrator.RD_PHASES;
    const simple = phases.map(p => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      agents: p.agents.map(a => ({ id: a.id, action: a.action })),
    }));
    res.json({ success: true, data: simple });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 【v13 新增】列出所有 10 种工作流（9 业务 + 1 研发），用于前端图谱展示
router.get('/workflows', (req, res) => {
  try {
    const list = [];
    // 业务 9 种
    Object.entries(orchestrator.BUSINESS_WORKFLOWS).forEach(([key, wf]) => {
      list.push({
        key,
        type: 'business',
        name: wf.name,
        emoji: wf.emoji,
        desc: wf.desc,
        phases: wf.phases.map(p => ({
          id: p.id,
          name: p.name,
          emoji: p.emoji,
          agents: p.agents.map(a => ({ id: a.id, action: a.action })),
        })),
      });
    });
    // 研发 1 种
    list.push({
      key: 'rd_task',
      type: 'rd',
      name: '研发任务',
      emoji: '🛠️',
      desc: '产品需求 → 设计 → 开发 → 测试 → 部署的完整研发流水线',
      phases: orchestrator.RD_PHASES.map(p => ({
        id: p.id,
        name: p.name,
        emoji: p.emoji,
        agents: p.agents.map(a => ({ id: a.id, action: a.action })),
      })),
    });
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
