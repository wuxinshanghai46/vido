/**
 * 内容雷达路由
 * 功能：监控账号管理、内容提取分析、AI改写、一键复刻
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const { parsePlatformUrl, extractContent, rewriteContent, replicateContent, tryMcpCrawlCreator } = require('../services/radarService');

// ═══════ 雷达总览 ═══════

// GET /api/radar/overview - 总览统计
router.get('/overview', (req, res) => {
  const userId = req.user?.id;
  const accounts = db.listMonitors(userId);
  const contents = db.listContents(userId);
  const tasks = db.listReplicateTasks(userId);
  const voices = db.listVoices(userId);

  res.json({
    success: true,
    data: {
      account_count: accounts.length,
      content_count: contents.length,
      replicate_count: tasks.filter(t => t.status === 'done').length,
      voice_count: voices.length,
      recent_contents: contents.slice(0, 5),
      recent_tasks: tasks.slice(0, 5)
    }
  });
});

// ═══════ 监控账号管理 ═══════

// POST /api/radar/monitors - 添加监控账号
router.post('/monitors', (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ success: false, error: '请输入账号链接' });

  const { platform, name: platformName } = parsePlatformUrl(url);
  const id = uuidv4();

  db.insertMonitor({
    id,
    user_id: req.user?.id,
    platform,
    platform_name: platformName,
    account_url: url,
    account_name: name || `${platformName}账号`,
    is_active: true,
    last_sync_at: null
  });

  res.json({ success: true, monitor: { id, platform, platformName, account_name: name || `${platformName}账号` } });
});

// GET /api/radar/monitors - 监控账号列表
router.get('/monitors', (req, res) => {
  const monitors = db.listMonitors(req.user?.id);
  res.json({ success: true, monitors });
});

// DELETE /api/radar/monitors/:id - 删除监控账号
router.delete('/monitors/:id', (req, res) => {
  db.deleteMonitor(req.params.id);
  res.json({ success: true });
});

// PUT /api/radar/monitors/:id/toggle - 暂停/启用监控
router.put('/monitors/:id/toggle', (req, res) => {
  const monitor = db.getMonitor(req.params.id);
  if (!monitor) return res.status(404).json({ success: false, error: '账号不存在' });
  db.updateMonitor(req.params.id, { is_active: !monitor.is_active });
  res.json({ success: true, is_active: !monitor.is_active });
});

// GET /api/radar/monitors/:id/crawl - 抓取博主最新视频列表
router.get('/monitors/:id/crawl', async (req, res) => {
  try {
    const monitor = db.getMonitor(req.params.id);
    if (!monitor) return res.status(404).json({ success: false, error: '账号不存在' });

    const url = monitor.account_url;
    let videos = [];
    let crawlSource = 'builtin';

    // 优先尝试 MCP media-crawler
    const mcpResult = await tryMcpCrawlCreator(url);
    if (mcpResult) {
      crawlSource = 'mcp';
      videos = (mcpResult.videoLinks || []).map(v => typeof v === 'string' ? { url: v } : v);
      if (mcpResult.author) {
        db.updateMonitor(req.params.id, { account_name: mcpResult.author });
      }
      console.log(`[Radar] MCP 抓取博主成功: ${mcpResult.author || url}, ${videos.length} 个视频`);
    } else {
      // 回退到内置抓取
      try {
        const axios = require('axios');
        const resp = await axios.get(url, {
          timeout: 15000, maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9'
          }
        });
        const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
        const videoPatterns = [
          /href=["'](https?:\/\/(?:www\.)?douyin\.com\/video\/\d+[^"']*?)["']/gi,
          /href=["'](https?:\/\/v\.douyin\.com\/[^"']+)["']/gi,
          /href=["'](https?:\/\/(?:www\.)?kuaishou\.com\/short-video\/[^"']+)["']/gi,
          /href=["'](https?:\/\/(?:www\.)?bilibili\.com\/video\/[^"']+)["']/gi,
          /href=["'](https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/[^"']+)["']/gi,
          /href=["'](https?:\/\/[^"']*(?:video|watch|play)[^"']+)["']/gi
        ];
        const foundUrls = new Set();
        for (const pat of videoPatterns) {
          let m;
          while ((m = pat.exec(html)) !== null) {
            if (!foundUrls.has(m[1])) { foundUrls.add(m[1]); videos.push({ url: m[1] }); }
          }
        }
        const nameMatch = html.match(/["'](?:nickname|author(?:_name)?)["']\s*:\s*["']([^"']+)/i);
        if (nameMatch && nameMatch[1].length > 1) db.updateMonitor(req.params.id, { account_name: nameMatch[1] });
      } catch (err) {
        console.warn(`[Radar] 内置抓取失败: ${err.message}`);
      }
    }
    db.updateMonitor(req.params.id, { last_sync_at: new Date().toISOString() });

    const contents = db.listContents(req.user?.id).filter(c => c.platform === monitor.platform);

    // 重新读取最新的 monitor（可能被 crawl 更新了名字）
    const updated = db.getMonitor(req.params.id);
    res.json({
      success: true,
      videos: videos.slice(0, 20),
      contents: contents.slice(0, 20),
      account_name: updated?.account_name || monitor.account_name,
      crawl_source: crawlSource
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════ 内容提取/分析 ═══════

// POST /api/radar/extract - 提取视频内容（粘贴链接）
router.post('/extract', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: '请输入视频链接' });
    const result = await extractContent(url, req.user?.id);
    res.json({ success: true, content: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/radar/contents - 内容库列表
router.get('/contents', (req, res) => {
  const { account_id } = req.query;
  const contents = db.listContents(req.user?.id, account_id);
  res.json({ success: true, contents });
});

// GET /api/radar/contents/:id - 内容详情
router.get('/contents/:id', (req, res) => {
  const content = db.getContent(req.params.id);
  if (!content) return res.status(404).json({ success: false, error: '内容不存在' });
  res.json({ success: true, content });
});

// DELETE /api/radar/contents/:id - 删除内容
router.delete('/contents/:id', (req, res) => {
  db.deleteContent(req.params.id);
  res.json({ success: true });
});

// ═══════ AI 改写 ═══════

// POST /api/radar/rewrite - AI改写文案
router.post('/rewrite', async (req, res) => {
  try {
    const { content_id, style } = req.body;
    if (!content_id) return res.status(400).json({ success: false, error: '缺少内容ID' });
    const result = await rewriteContent(content_id, style || 'same', req.user?.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════ 一键复刻 ═══════

// POST /api/radar/replicate - 一键复刻视频
router.post('/replicate', async (req, res) => {
  try {
    const { content_id, voice_id, style, avatar_image } = req.body;
    if (!content_id) return res.status(400).json({ success: false, error: '缺少内容ID' });

    // 异步执行，先返回任务ID（使用 replicateContent 内部创建的 taskId）
    const promise = replicateContent({
      contentId: content_id,
      voiceId: voice_id,
      style: style || 'same',
      avatarImage: avatar_image,
      userId: req.user?.id,
      onProgress: () => {}
    });
    // replicateContent 在内部立即创建了 task 记录，查最新的
    const tasks = db.listReplicateTasks(req.user?.id);
    const latestTask = tasks[tasks.length - 1];
    res.json({ success: true, taskId: latestTask?.id || 'unknown' });

    promise.catch(err => console.error('[Radar] 复刻失败:', err.message));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/radar/replicate/tasks - 复刻任务列表
router.get('/replicate/tasks', (req, res) => {
  const tasks = db.listReplicateTasks(req.user?.id);
  res.json({ success: true, tasks });
});

// GET /api/radar/replicate/tasks/:id - 任务详情
router.get('/replicate/tasks/:id', (req, res) => {
  const task = db.getReplicateTask(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
  res.json({ success: true, task });
});

module.exports = router;
