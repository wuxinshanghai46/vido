/**
 * 浏览器登录管理 API
 * 管理抖音/小红书/快手的扫码登录和 cookie
 */
const express = require('express');
const router = express.Router();
const browserService = require('../services/browserService');

// GET /api/browser/status - 获取所有平台登录状态
router.get('/status', (req, res) => {
  const status = browserService.getLoginStatus();
  const hasChrome = !!browserService.findChromePath();
  res.json({ success: true, platforms: status, hasChrome });
});

// POST /api/browser/login/:platform - 启动扫码登录
router.post('/login/:platform', async (req, res) => {
  try {
    const screenshot = await browserService.startLogin(req.params.platform);
    res.json({ success: true, screenshot: `data:image/jpeg;base64,${screenshot}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/browser/login/:platform/poll - 轮询登录状态
router.get('/login/:platform/poll', async (req, res) => {
  try {
    const result = await browserService.pollLoginStatus(req.params.platform);
    if (result.screenshot) result.screenshot = `data:image/jpeg;base64,${result.screenshot}`;
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/browser/login/:platform/cancel - 取消登录
router.post('/login/:platform/cancel', async (req, res) => {
  await browserService.cancelLogin(req.params.platform);
  res.json({ success: true });
});

// POST /api/browser/logout/:platform - 退出登录
router.post('/logout/:platform', (req, res) => {
  browserService.logout(req.params.platform);
  res.json({ success: true });
});

module.exports = router;
