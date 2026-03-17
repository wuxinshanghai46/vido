/**
 * 社交媒体发布路由
 * POST   /api/publish/accounts          - 绑定/登录第三方账号
 * GET    /api/publish/accounts          - 获取已绑定账号列表
 * DELETE /api/publish/accounts/:platform - 解绑账号
 * GET    /api/publish/platforms          - 获取支持的平台列表
 * POST   /api/publish/copywriting       - AI 生成平台文案
 * POST   /api/publish/send              - 发布视频到平台
 * GET    /api/publish/history            - 发布历史
 */
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const publishService = require('../services/publishService');

// 获取支持的平台列表
router.get('/platforms', (req, res) => {
  const platforms = Object.entries(publishService.PLATFORMS).map(([id, p]) => ({
    id,
    name: p.name,
    icon: p.icon,
    color: p.color,
    maxTitleLen: p.maxTitleLen,
    maxDescLen: p.maxDescLen,
    maxTags: p.maxTags
  }));
  res.json({ success: true, data: platforms });
});

// 获取用户已绑定的账号
router.get('/accounts', (req, res) => {
  try {
    const accounts = publishService.getAccountsByUser(req.user.id);
    // 不返回 token 等敏感信息
    const safe = accounts.map(a => ({
      platform: a.platform,
      nickname: a.nickname,
      avatar_url: a.avatar_url,
      connected_at: a.connected_at,
      name: publishService.PLATFORMS[a.platform]?.name || a.platform
    }));
    res.json({ success: true, data: safe });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 绑定第三方账号（通过 Cookie/Token 快捷登录）
router.post('/accounts', (req, res) => {
  try {
    const { platform, nickname, avatar_url, access_token, refresh_token, open_id, expires_in } = req.body;
    if (!platform || !publishService.PLATFORMS[platform]) {
      return res.status(400).json({ success: false, error: '不支持的平台: ' + platform });
    }
    if (!access_token) {
      return res.status(400).json({ success: false, error: '缺少授权凭证 (access_token)' });
    }

    const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : '';
    const account = publishService.upsertAccount(req.user.id, platform, {
      nickname: nickname || platform + '用户',
      avatar_url: avatar_url || '',
      open_id: open_id || '',
      access_token,
      refresh_token: refresh_token || '',
      expires_at: expiresAt
    });

    res.json({
      success: true,
      data: {
        platform: account.platform,
        nickname: account.nickname,
        avatar_url: account.avatar_url,
        connected_at: account.connected_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 解绑账号
router.delete('/accounts/:platform', (req, res) => {
  try {
    const { platform } = req.params;
    publishService.removeAccount(req.user.id, platform);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// AI 生成平台专属文案
router.post('/copywriting', async (req, res) => {
  try {
    const { project_id, platform } = req.body;
    if (!project_id || !platform) {
      return res.status(400).json({ success: false, error: '缺少 project_id 或 platform' });
    }
    if (!publishService.PLATFORMS[platform]) {
      return res.status(400).json({ success: false, error: '不支持的平台' });
    }

    const project = db.getProject(project_id);
    if (!project) return res.status(404).json({ success: false, error: '项目不存在' });

    const copy = await publishService.generateCopywriting(project, platform);
    res.json({ success: true, data: copy });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 发布视频到平台
router.post('/send', async (req, res) => {
  try {
    const { project_id, platform, title, description, tags } = req.body;
    if (!project_id || !platform) {
      return res.status(400).json({ success: false, error: '缺少 project_id 或 platform' });
    }

    const result = await publishService.publishVideo(
      req.user.id,
      project_id,
      platform,
      { title, description, tags }
    );
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 发布历史
router.get('/history', (req, res) => {
  try {
    const all = db.listPublications ? db.listPublications() : [];
    const filtered = req.user?.role === 'admin' ? all : all.filter(p => p.user_id === req.user?.id);
    res.json({ success: true, data: filtered });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
