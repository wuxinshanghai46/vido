/**
 * MCP 管理 API 路由
 *
 * GET  /api/mcp/instances       — 所有 MCP 实例状态
 * GET  /api/mcp/tools           — 所有可用工具列表
 * POST /api/mcp/call            — 调用指定 MCP 工具
 * POST /api/mcp/resource        — 读取指定 MCP 资源
 * POST /api/mcp/:id/restart     — 重启指定 MCP
 */
const express = require('express');
const router = express.Router();
const mcpManager = require('../services/mcpManager');

// 所有 MCP 实例状态
router.get('/instances', (req, res) => {
  res.json({ success: true, instances: mcpManager.listInstances() });
});

// 所有可用工具
router.get('/tools', (req, res) => {
  res.json({ success: true, tools: mcpManager.listAllTools() });
});

// 调用工具
router.post('/call', async (req, res) => {
  const { mcpId, tool, args } = req.body;
  if (!mcpId || !tool) return res.status(400).json({ success: false, error: '请提供 mcpId 和 tool' });
  try {
    const result = await mcpManager.callTool(mcpId, tool, args || {});
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 读取资源
router.post('/resource', async (req, res) => {
  const { mcpId, uri } = req.body;
  if (!mcpId || !uri) return res.status(400).json({ success: false, error: '请提供 mcpId 和 uri' });
  try {
    const result = await mcpManager.readResource(mcpId, uri);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 重启指定 MCP
router.post('/:id/restart', async (req, res) => {
  try {
    await mcpManager.restartMcp(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
