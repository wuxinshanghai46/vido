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

// POST /api/radar/monitors - 添加监控账号（去重：相同 user_id + url + platform 复用）
router.post('/monitors', async (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ success: false, error: '请输入账号链接' });

  const { platform, name: platformName } = parsePlatformUrl(url);

  // 去重：先查同一用户下是否已关注（按 url 完全匹配，或同博主不同视频 URL 时按 author 名）
  const existing = db.listMonitors(req.user?.id).find(m =>
    m.platform === platform && (m.account_url === url || (name && m.account_name === name))
  );
  if (existing) {
    return res.json({ success: true, monitor: existing, deduped: true });
  }

  const id = uuidv4();
  let accountName = name || `${platformName}账号`;
  let followers = 0, bio = '';

  // 严格过滤技术 token 名（middleware_perf_timing_start 这种 RUM 监控误识别）
  const isTechName = (s) => !s || /^[a-z_]+$/i.test(s) || /perf_timing|middleware|webpack|chunk|navigator|hydrat|bootstrap_/i.test(s);

  // 通过 MCP 自动抓取博主信息
  const mcpData = await tryMcpCrawlCreator(url);
  if (mcpData) {
    if (mcpData.author && !name && !isTechName(mcpData.author)) accountName = mcpData.author;
    followers = mcpData.followers || 0;
    bio = mcpData.bio || '';
    console.log(`[Radar] MCP 自动获取博主信息: ${accountName}, ${followers} 粉丝`);
  }

  // 二次去重：MCP 拿到 author 后看是否已经有同名监控
  if (mcpData?.author) {
    const dup2 = db.listMonitors(req.user?.id).find(m => m.platform === platform && m.account_name === mcpData.author);
    if (dup2) return res.json({ success: true, monitor: dup2, deduped: true });
  }

  db.insertMonitor({
    id,
    user_id: req.user?.id,
    platform,
    platform_name: platformName,
    account_url: url,
    account_name: accountName,
    followers,
    bio,
    is_active: true,
    last_sync_at: mcpData ? new Date().toISOString() : null
  });

  res.json({ success: true, monitor: { id, platform, platformName, account_name: accountName, followers, bio } });
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
    const platform = monitor.platform;
    let videos = [];
    let crawlSource = 'builtin';

    // 平台 URL 模式
    const VIDEO_PATTERNS = {
      douyin: [/\/video\/(\d{15,25})/g, /v\.douyin\.com\/([A-Za-z0-9]{8,16})/g],
      xiaohongshu: [/\/explore\/([0-9a-f]{20,})/g, /\/discovery\/item\/([0-9a-f]{20,})/g],
      kuaishou: [/\/short-video\/(\d{10,})/g, /v\.kuaishou\.com\/([A-Za-z0-9]{6,})/g],
      bilibili: [/\/video\/(BV[A-Za-z0-9]{10,})/g, /b23\.tv\/([A-Za-z0-9]{6,})/g],
    };
    const VIDEO_BASE = {
      douyin: id => id.startsWith('http') ? id : (id.length < 16 ? `https://v.douyin.com/${id}/` : `https://www.douyin.com/video/${id}`),
      xiaohongshu: id => `https://www.xiaohongshu.com/explore/${id}`,
      kuaishou: id => id.length < 10 ? `https://v.kuaishou.com/${id}` : `https://www.kuaishou.com/short-video/${id}`,
      bilibili: id => `https://www.bilibili.com/video/${id}`,
    };
    const extractFromHtml = (html, plat) => {
      const found = new Set();
      const out = [];
      for (const pat of (VIDEO_PATTERNS[plat] || [])) {
        let m;
        while ((m = pat.exec(html)) !== null) {
          const id = m[1];
          if (!found.has(id)) {
            found.add(id);
            out.push({ url: VIDEO_BASE[plat] ? VIDEO_BASE[plat](id) : id, id });
          }
        }
      }
      return out;
    };

    // 策略 0：yt-dlp 抓全量（最稳，开源社区维护，自动适配抖音 a-bogus 签名等）
    //   getBestCookieFile 会自动：① 优先扫码登录 cookie ② 回退预热的 visitor cookie
    //   即使没扫码也能尝试拿公开数据
    try {
      const ytdlp = require('../services/ytdlpService');
      if (ytdlp.isAvailable()) {
        console.log(`[Radar] 优先用 yt-dlp 抓 ${platform} 博主: ${url}`);
        const cookieFile = await ytdlp.getBestCookieFile(platform);
        const ytVideos = await ytdlp.fetchUserVideos(url, { cookieFile, limit: 100, timeout: 90000 });
        if (ytVideos && ytVideos.length) {
          videos = ytVideos.map(v => ({ url: v.url, id: v.id, title: v.title }));
          crawlSource = 'yt-dlp';
          // 用 yt-dlp 拿到的 uploader 名（通常最准）
          const author = ytVideos.find(v => v.uploader)?.uploader;
          const isTechName = (s) => !s || /^[a-z_]+$/i.test(s) || /perf_timing|middleware|webpack|chunk|navigator|hydrat|bootstrap_/i.test(s);
          const patch = { video_count: ytVideos.length };
          if (author && !isTechName(author)) patch.account_name = author;
          db.updateMonitor(req.params.id, patch);
          console.log(`[Radar] yt-dlp 抓到 ${videos.length} 个，作者=${author || '未知'}`);
        }
      }
    } catch (err) {
      console.warn('[Radar] yt-dlp 抓取失败，回退到 puppeteer:', err.message);
    }

    // 策略 1：crawlAuthorVideos - puppeteer + cookie + scroll 拿全量（参考 douyin/python/douyin_videos.py 思路）
    if (!videos.length) try {
      const browserService = require('../services/browserService');
      if (browserService.hasCookies(platform)) {
        console.log(`[Radar] crawlAuthorVideos 抓 ${platform} 博主主页: ${url}`);
        const r = await browserService.crawlAuthorVideos(platform, url, { maxScroll: 8, maxVideos: 100 });
        videos = (r.videos || []).map(v => ({ url: v.url, id: v.id }));
        if (videos.length || r.author) {
          crawlSource = 'browser-author-scroll';
          const patch = {};
          // 严格过滤：排除技术 token 误识别（middleware_perf_timing_start 等）
          const isTechName = (s) => !s || /^[a-z_]+$/i.test(s) || /perf_timing|middleware|webpack|chunk|navigator|hydrat|bootstrap_/i.test(s);
          if (r.author && !isTechName(r.author)) patch.account_name = r.author;
          if (r.followers > 0) patch.followers = r.followers;
          if (r.bio) patch.bio = r.bio;
          if (r.videoCount > 0) patch.video_count = r.videoCount;
          if (r.avatar) patch.avatar_url = r.avatar;
          if (Object.keys(patch).length) db.updateMonitor(req.params.id, patch);
          console.log(`[Radar] crawlAuthor 抓到 ${videos.length} 个视频，作者=${patch.account_name || '未识别'}, 粉=${patch.followers || 0}`);
        }
      }
    } catch (err) {
      console.warn('[Radar] crawlAuthorVideos 失败:', err.message);
    }

    // 策略 2：MCP media-crawler（无 cookie 也能抓 SSR 部分内容）
    if (!videos.length) {
      const mcpResult = await tryMcpCrawlCreator(url);
      if (mcpResult) {
        crawlSource = 'mcp';
        videos = (mcpResult.videoLinks || []).map(v => typeof v === 'string' ? { url: v } : v);
        if (mcpResult.author) {
          db.updateMonitor(req.params.id, { account_name: mcpResult.author });
        }
        console.log(`[Radar] MCP 抓取博主成功: ${mcpResult.author || url}, ${videos.length} 个视频`);
      }
    }

    // 策略 3：纯 axios 兜底（移动端 UA）
    if (!videos.length) {
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
        videos = extractFromHtml(html, platform);
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

// ═══════ 热度排行（基于 contents 库聚合 — 移植自 douyin/douyin/src/api/douyin.ts）═══════
//
// 抓取过的真实视频数据 = 排行数据源；按 likes/comments/views/duration 排序
// 用 user_id 隔离（admin 看全局）

function _getRankPool(req, opts = {}) {
  const isAdmin = req.user?.role === 'admin';
  const all = isAdmin ? require('../models/database').listContents() : require('../models/database').listContents(req.user?.id);
  const platform = opts.platform || (req.query?.platform);
  const days = +((opts.days ?? req.query?.days) || 0);  // 0 = 不限
  let list = all.filter(c => c && c.id);
  // 过滤垃圾记录：无任何真实指标 + 无封面 + 无作者 = 解析失败的占位记录
  list = list.filter(c => {
    const hasMetric = (+c.likes || 0) > 0 || (+c.views || 0) > 0 || (+c.comments || 0) > 0 || (+c.shares || 0) > 0;
    const hasMeta = !!(c.cover || c.author || c.author_avatar);
    return hasMetric || hasMeta;
  });
  if (platform && platform !== 'all') list = list.filter(c => c.platform === platform);
  if (days > 0) {
    const cutoff = Date.now() - days * 86400 * 1000;
    list = list.filter(c => {
      const t = c.created_at ? new Date(c.created_at).getTime() : 0;
      return t >= cutoff;
    });
  }
  return list;
}

// GET /api/radar/ranking/videos?sort=likes|comments|views|duration&platform=&days=
router.get('/ranking/videos', (req, res) => {
  const sortBy = (req.query.sort || 'likes').toString();
  const list = _getRankPool(req);
  const sortKeyMap = {
    likes: c => +c.likes || 0,
    comments: c => +c.comments || 0,
    views: c => +c.views || 0,
    shares: c => +c.shares || 0,
    duration: c => +c.duration || 0,
  };
  const keyFn = sortKeyMap[sortBy] || sortKeyMap.likes;
  const sorted = list.sort((a, b) => keyFn(b) - keyFn(a));
  res.json({
    success: true,
    sort: sortBy,
    total: sorted.length,
    videos: sorted.slice(0, 100).map(c => ({
      id: c.id,
      title: c.title || '',
      cover: c.cover || '',
      platform: c.platform,
      author: c.author || '',
      author_avatar: c.author_avatar || '',
      duration: c.duration || 0,
      likes: c.likes || 0, comments: c.comments || 0, shares: c.shares || 0, views: c.views || 0,
      video_url: c.video_url || '',
      upload_date: c.upload_date || '',
      created_at: c.created_at || '',
    })),
  });
});

// GET /api/radar/ranking/bloggers - 博主排行（按视频总点赞）
router.get('/ranking/bloggers', (req, res) => {
  const list = _getRankPool(req);
  const byAuthor = {};
  for (const c of list) {
    if (!c.author) continue;
    const k = c.author + '@' + (c.platform || '');
    if (!byAuthor[k]) byAuthor[k] = {
      name: c.author, platform: c.platform || '',
      avatar: c.author_avatar || '',
      video_count: 0, total_likes: 0, total_comments: 0, total_views: 0,
    };
    byAuthor[k].video_count += 1;
    byAuthor[k].total_likes += +c.likes || 0;
    byAuthor[k].total_comments += +c.comments || 0;
    byAuthor[k].total_views += +c.views || 0;
  }
  const bloggers = Object.values(byAuthor)
    .map(b => ({ ...b, avg_likes: Math.round(b.total_likes / Math.max(1, b.video_count)) }))
    .sort((a, b) => b.total_likes - a.total_likes)
    .slice(0, 50);
  res.json({ success: true, total: bloggers.length, bloggers });
});

// GET /api/radar/ranking/today - 今日新增视频
router.get('/ranking/today', (req, res) => {
  const list = _getRankPool(req, { days: 1 });
  const sorted = list.sort((a, b) => (+b.likes || 0) - (+a.likes || 0));
  res.json({ success: true, total: sorted.length, videos: sorted.slice(0, 100) });
});

// GET /api/radar/ranking/stats - 数据概览（视频总数、博主数、点赞、月度趋势、时长分布、互动率TOP10）
router.get('/ranking/stats', (req, res) => {
  const list = _getRankPool(req);
  const totalVideos = list.length;
  const authors = new Set(list.map(c => c.author).filter(Boolean));
  const totalLikes = list.reduce((s, c) => s + (+c.likes || 0), 0);
  const totalComments = list.reduce((s, c) => s + (+c.comments || 0), 0);
  const totalShares = list.reduce((s, c) => s + (+c.shares || 0), 0);
  const totalViews = list.reduce((s, c) => s + (+c.views || 0), 0);
  const avgLikes = totalVideos ? Math.round(totalLikes / totalVideos) : 0;
  const dur = list.map(c => +c.duration || 0).filter(d => d > 0);
  const avgDuration = dur.length ? Math.round(dur.reduce((s, d) => s + d, 0) / dur.length) : 0;

  // 月度趋势
  const monthlyMap = {};
  for (const c of list) {
    if (!c.created_at) continue;
    const m = c.created_at.slice(0, 7);  // YYYY-MM
    if (!monthlyMap[m]) monthlyMap[m] = { month: m, count: 0, likes: 0 };
    monthlyMap[m].count += 1;
    monthlyMap[m].likes += +c.likes || 0;
  }
  const monthly = Object.values(monthlyMap)
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 12)
    .map(m => ({ ...m, avg_likes: Math.round(m.likes / Math.max(1, m.count)) }));

  // 时长分布
  const buckets = { '0-1分钟': 0, '1-3分钟': 0, '3-5分钟': 0, '5分钟以上': 0 };
  for (const d of dur) {
    if (d < 60) buckets['0-1分钟'] += 1;
    else if (d < 180) buckets['1-3分钟'] += 1;
    else if (d < 300) buckets['3-5分钟'] += 1;
    else buckets['5分钟以上'] += 1;
  }
  const durationDist = Object.entries(buckets).map(([range, count]) => ({ range, count }));

  // 高互动率：likes / max(duration,1)
  const highEngagement = list
    .filter(c => (+c.duration || 0) > 0 && (+c.likes || 0) > 0)
    .map(c => ({
      id: c.id, title: c.title || '', cover: c.cover || '',
      platform: c.platform, author: c.author || '',
      duration: +c.duration || 0,
      likes: +c.likes || 0, comments: +c.comments || 0,
      likes_per_sec: Math.round((+c.likes || 0) / Math.max(1, +c.duration || 1) * 10) / 10,
    }))
    .sort((a, b) => b.likes_per_sec - a.likes_per_sec)
    .slice(0, 10);

  res.json({
    success: true,
    totalVideos, totalBloggers: authors.size,
    totalLikes, totalComments, totalShares, totalViews,
    avgLikes, avgDuration,
    monthly, durationDist, highEngagement,
  });
});

// GET /api/radar/trending/:platform - 获取平台热门内容
router.get('/trending/:platform', async (req, res) => {
  try {
    const platform = req.params.platform;
    const mcpManager = require('../services/mcpManager');
    const instances = mcpManager.listInstances();
    const crawler = instances.find(i => i.id === 'media-crawler' && i.status === 'running');
    if (!crawler) return res.json({ success: true, trending: [], links: [], source: 'none', message: 'MCP 爬虫未运行' });

    const result = await mcpManager.callTool('media-crawler', 'search_trending', { platform });
    if (!result?.content?.[0]?.text) return res.json({ success: true, trending: [], links: [] });
    const data = JSON.parse(result.content[0].text);
    res.json({ success: true, ...data, source: 'mcp' });
  } catch (err) {
    res.json({ success: true, trending: [], links: [], error: err.message });
  }
});

// POST /api/radar/batch-extract - 批量提取多个链接
router.post('/batch-extract', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls?.length) return res.status(400).json({ success: false, error: '请提供链接列表' });

    const results = [];
    for (const url of urls.slice(0, 10)) {
      try {
        const content = await extractContent(url, req.user?.id);
        results.push({ url, success: true, content });
      } catch (err) {
        results.push({ url, success: false, error: err.message });
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/radar/extract-blogger - 解析博主主页或视频链接
router.post('/extract-blogger', async (req, res) => {
  try {
    let { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: '请输入链接' });
    // 从混合文本中提取URL（支持抖音分享文案等）
    const urlMatch = url.match(/https?:\/\/[^\s<>"'，。！？、；：）》\]]+/i);
    if (urlMatch) url = urlMatch[0].replace(/[.,;:!?]+$/, '');

    const { platform, name: platformName } = parsePlatformUrl(url);
    const platformIcons = { douyin:'📱', xiaohongshu:'📕', kuaishou:'🎬', bilibili:'📺', weibo:'💬' };

    // 使用 MCP 抓取博主信息和视频列表
    const mcpData = await tryMcpCrawlCreator(url);

    if (mcpData && (mcpData.author || mcpData.videoLinks?.length)) {
      const videos = (mcpData.videoLinks || []).map((v, i) => {
        if (typeof v === 'string') return { url: v, title: `作品 ${i+1}`, stats: {} };
        return { url: v.url || v, title: v.title || `作品 ${i+1}`, cover: v.cover || '', stats: v.stats || {}, date: v.date || '', duration: v.duration || '' };
      });

      return res.json({
        success: true,
        isBlogger: true,
        blogger: {
          name: mcpData.author || platformName + '博主',
          id: mcpData.authorId || '',
          url,
          platform,
          videoCount: mcpData.videoCount || videos.length,
          totalLikes: mcpData.followers || 0,
          bio: mcpData.bio || ''
        },
        videos,
        platformIcon: platformIcons[platform] || '👤'
      });
    }

    // 优先用 Puppeteer + Cookie 抓取（登录后数据更完整）
    const browserService = require('../services/browserService');
    if (browserService.hasCookies(platform)) {
      try {
        console.log(`[Radar] 使用 ${platform} Cookie + Puppeteer 抓取`);
        const result = await browserService.fetchWithCookies(platform, url);
        const html = result.html || '';
        // 复用下方的 HTML 解析逻辑
        if (html.length > 500) {
          const finalUrl = result.url || url;
          // 提取博主名
          let authorName = null;
          const namePatterns = [/"nickname"\s*:\s*"([^"]+)"/, /"author_name"\s*:\s*"([^"]+)"/, /<title[^>]*>([^<]*?)(?:的(?:抖音|主页)|[-|])/i];
          for (const pat of namePatterns) { const m = html.match(pat); if (m && m[1].trim()) { authorName = m[1].trim(); break; } }
          if (!authorName) authorName = platformName + '博主';
          // 提取视频
          const foundUrls = new Set();
          const awemeIds = [...html.matchAll(/"aweme_id"\s*:\s*"(\d+)"/g)];
          awemeIds.forEach(m => foundUrls.add(`https://www.douyin.com/video/${m[1]}`));
          const linkPatterns = [/(?:href|src)=["'](https?:\/\/(?:www\.)?douyin\.com\/video\/\d+[^"']*?)["']/gi];
          for (const pat of linkPatterns) { let m; while ((m = pat.exec(html)) !== null) foundUrls.add(m[1]); }
          const videos = [...foundUrls].map((u, i) => ({ url: u, title: `作品 ${i+1}`, stats: {} }));
          const descMatches = [...html.matchAll(/"desc"\s*:\s*"([^"]{2,200})"/g)];
          descMatches.forEach((m, i) => { if (videos[i]) videos[i].title = m[1]; });
          if (videos.length > 0) {
            return res.json({
              success: true, isBlogger: true,
              blogger: { name: authorName, id: '', url: finalUrl, platform, videoCount: videos.length, totalLikes: 0 },
              videos, platformIcon: platformIcons[platform] || '👤', source: 'browser'
            });
          }
        }
      } catch (browserErr) {
        console.warn(`[Radar] Puppeteer 抓取失败，回退到 HTTP:`, browserErr.message);
      }
    }

    // 回退：HTTP 直接抓取（无登录态）
    const axios = require('axios');
    try {
      const resp = await axios.get(url, {
        timeout: 15000, maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Referer': 'https://www.douyin.com/'
        }
      });
      const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
      const finalUrl = resp.request?.res?.responseUrl || resp.request?.path || url;

      // 尝试从嵌入的 JSON 数据中提取（__INITIAL_STATE__ / RENDER_DATA / SSR_DATA）
      let jsonData = null;
      const jsonPatterns = [
        /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script/,
        /self\.__next_f\.push\(\[.*?"((?:\\"|[^"])*aweme(?:\\"|[^"])*)".*?\]\)/,
        /<script[^>]*id="RENDER_DATA"[^>]*>([\s\S]*?)<\/script>/
      ];
      for (const pat of jsonPatterns) {
        const m = html.match(pat);
        if (m) { try { jsonData = JSON.parse(decodeURIComponent(m[1])); } catch { try { jsonData = JSON.parse(m[1]); } catch {} } break; }
      }

      // 提取博主名 — 多种来源
      let authorName = null;
      const namePatterns = [
        /"nickname"\s*:\s*"([^"]+)"/,
        /"author_name"\s*:\s*"([^"]+)"/,
        /"screen_name"\s*:\s*"([^"]+)"/,
        /"name"\s*:\s*"([^"]{2,30})"/,
        /<title[^>]*>([^<]*?)(?:的(?:抖音|主页|作品)|[-|])/i
      ];
      for (const pat of namePatterns) {
        const m = html.match(pat);
        if (m && m[1].trim()) { authorName = m[1].trim(); break; }
      }
      if (!authorName) authorName = platformName + '博主';

      // 提取作者 UID
      const uidMatch = html.match(/"uid"\s*:\s*"(\d+)"/) || html.match(/"authorId"\s*:\s*"(\d+)"/) || html.match(/"sec_uid"\s*:\s*"([^"]+)"/);
      const authorId = uidMatch ? uidMatch[1] : '';

      // 提取视频链接 — 从 JSON 数据和 HTML 双重提取
      const foundUrls = new Set();

      // JSON 中的 aweme_id / video_id
      const awemeIds = [...html.matchAll(/"aweme_id"\s*:\s*"(\d+)"/g)];
      awemeIds.forEach(m => foundUrls.add(`https://www.douyin.com/video/${m[1]}`));

      // HTML href/src 属性
      const linkPatterns = [
        /(?:href|src)=["'](https?:\/\/(?:www\.)?douyin\.com\/video\/\d+[^"']*?)["']/gi,
        /(?:href|src)=["'](https?:\/\/v\.douyin\.com\/[^"']+)["']/gi,
        /(?:href|src)=["'](https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery|item)\/[^"']+)["']/gi,
        /(?:href|src)=["'](https?:\/\/(?:www\.)?kuaishou\.com\/short-video\/[^"']+)["']/gi,
        /(?:href|src)=["'](https?:\/\/(?:www\.)?bilibili\.com\/video\/[^"']+)["']/gi
      ];
      for (const pat of linkPatterns) { let m; while ((m = pat.exec(html)) !== null) foundUrls.add(m[1]); }

      // 从 URL 本身提取（如果是视频页面）
      const videoIdMatch = finalUrl.match(/\/video\/(\d+)/);
      if (videoIdMatch) foundUrls.add(`https://www.douyin.com/video/${videoIdMatch[1]}`);

      const videos = [...foundUrls].map((u, i) => ({ url: u, title: `作品 ${i+1}`, stats: {} }));

      // 提取视频标题
      const descMatches = [...html.matchAll(/"desc"\s*:\s*"([^"]{2,200})"/g)];
      descMatches.forEach((m, i) => { if (videos[i]) videos[i].title = m[1]; });

      // 提取统计数据
      const likesMatch = html.match(/"digg_count"\s*:\s*(\d+)/);
      const commentMatch = html.match(/"comment_count"\s*:\s*(\d+)/);
      const shareMatch = html.match(/"share_count"\s*:\s*(\d+)/);
      if (videos.length > 0 && (likesMatch || commentMatch)) {
        videos[0].stats = {
          likes: likesMatch ? parseInt(likesMatch[1]) : 0,
          comments: commentMatch ? parseInt(commentMatch[1]) : 0,
          shares: shareMatch ? parseInt(shareMatch[1]) : 0
        };
      }

      return res.json({
        success: true,
        isBlogger: videos.length > 0,
        blogger: {
          name: authorName, id: authorId, url: finalUrl, platform,
          videoCount: videos.length, totalLikes: likesMatch ? parseInt(likesMatch[1]) : 0
        },
        videos,
        platformIcon: platformIcons[platform] || '👤'
      });
    } catch (parseErr) {
      console.warn('[Radar] 内置抓取失败:', parseErr.message);
    }

    // 都失败，返回单视频模式
    res.json({ success: false, isBlogger: false, message: '无法解析为博主主页，将尝试单视频提取' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════ 内容提取/分析 ═══════

// POST /api/radar/extract - 提取视频内容（粘贴链接）
router.post('/extract', async (req, res) => {
  let responded = false;
  const sendOnce = (status, body) => { if (!responded) { responded = true; res.status(status).json(body); } };
  // 整体硬超时 25s（之前 40s）— 抖音 SSR 15s + 短 LLM fallback；超时立即返回不挂死
  const hardTimeout = setTimeout(() => sendOnce(504, { success: false, error: '抓取超时（>25s）— 目标链接可能失效或目标平台限制，请直接换 URL 或去「平台账号绑定」扫码登录' }), 25000);
  try {
    let { url } = req.body;
    if (!url) { clearTimeout(hardTimeout); return sendOnce(400, { success: false, error: '请输入视频链接' }); }
    const urlMatch = url.match(/https?:\/\/[^\s<>"'，。！？、；：）》\]]+/i);
    if (urlMatch) url = urlMatch[0].replace(/[.,;:!?]+$/, '');
    const result = await extractContent(url, req.user?.id);
    clearTimeout(hardTimeout);
    sendOnce(200, { success: true, content: result });
  } catch (err) {
    clearTimeout(hardTimeout);
    console.error('[radar/extract] 失败:', err.message, err.stack?.split('\n')[1]);
    // 给前端一个对用户友好的提示，区分常见错误
    let userMsg = err.message || '抓取失败';
    if (/未配置 AI|model_not_found|No available channel/i.test(userMsg)) userMsg = 'AI 模型不可用（最可能：deyunai 的 gpt-4o-mini 已下线）→ 去「AI 配置」把 story 模型改成 deepseek-chat 或 doubao-seed-2-0-pro';
    else if (/无法从 URL 提取 video_id|短链.*失败|getDouyinVideoInfo/i.test(userMsg)) userMsg = '抖音短链解析失败（链接可能过期或目标视频已删）— 试着粘贴完整 douyin.com/video/xxx 长链';
    else if (/timeout|超时|ETIMEDOUT/i.test(userMsg)) userMsg = '网络超时 — 目标平台限速或链接失效，重试或换 URL';
    else if (/401|403|cookie|登录/i.test(userMsg)) userMsg = '需要登录才能抓取 — 去「平台账号绑定」扫码后重试';
    sendOnce(500, { success: false, error: userMsg, raw: err.message });
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

// POST /api/radar/contents/:id/analyze - 强制让 LLM 补全 hook/structure/highlights
router.post('/contents/:id/analyze', async (req, res) => {
  try {
    const c = db.getContent(req.params.id);
    if (!c) return res.status(404).json({ success: false, error: '内容不存在' });
    const { callLLM } = require('../services/storyService');
    const sysPrompt = '你是专业短视频内容分析师。基于给定的视频标题/口播文案/标签，输出 JSON：{ "hook":"开头钩子(20字)", "structure":"内容结构分析(40字)", "highlights":["爆款要素1","爆款要素2","爆款要素3"] }。直接输出 JSON，不加解释。';
    const userPrompt = `标题：${c.title || ''}\n文案：${c.transcript || ''}\n标签：${(c.tags || []).join(', ')}\n作者：${c.author || ''}`;
    const result = await Promise.race([
      callLLM(sysPrompt, userPrompt),
      new Promise((_, rej) => setTimeout(() => rej(new Error('LLM 解析超时（>25s）')), 25000)),
    ]);
    let parsed = {};
    try {
      const m = result.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : result);
    } catch (e) {
      throw new Error('LLM 返回不是合法 JSON：' + (result || '').slice(0, 200));
    }
    db.updateContent(req.params.id, {
      hook: parsed.hook || c.hook || '',
      structure: parsed.structure || c.structure || '',
      highlights: parsed.highlights || c.highlights || [],
      updated_at: new Date().toISOString(),
    });
    res.json({ success: true, content: db.getContent(req.params.id) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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

function _fmtDuration(sec) {
  if (!sec) return '';
  const s = +sec;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

// ═══════ 搜索 Providers 管理（管理员专用） ═══════
const searchProviders = require('../services/searchProviders');

function _adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: '需要管理员权限' });
  next();
}

// GET /api/radar/providers — 列出全部 provider 元信息（admin only）
router.get('/providers', _adminOnly, (req, res) => {
  try {
    const providers = searchProviders.listProviders();
    const config = searchProviders.loadConfig();
    res.json({
      success: true,
      providers: providers.map(p => ({
        ...p,
        config: config.providers?.[p.id] || { enabled: false },
      }))
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/radar/providers/:id — 更新 provider 配置（admin only）
router.put('/providers/:id', _adminOnly, (req, res) => {
  try {
    const id = req.params.id;
    const provider = searchProviders.getProvider(id);
    if (!provider) return res.status(404).json({ success: false, error: 'provider 不存在' });
    const config = searchProviders.loadConfig();
    config.providers = config.providers || {};
    config.providers[id] = { ...(config.providers[id] || {}), ...req.body };
    searchProviders.saveConfig(config);
    res.json({ success: true, config: config.providers[id] });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/radar/providers/:id/health — 测试 provider 可用性（admin only）
router.post('/providers/:id/health', _adminOnly, async (req, res) => {
  try {
    const provider = searchProviders.getProvider(req.params.id);
    if (!provider) return res.status(404).json({ success: false, error: 'provider 不存在' });
    const config = searchProviders.loadConfig();
    const r = await provider.health(config.providers?.[req.params.id] || {});
    res.json({ success: true, health: r });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ═══════ 订阅管理 ═══════

// GET /api/radar/subscriptions — 列出我的订阅
router.get('/subscriptions', (req, res) => {
  res.json({ success: true, subscriptions: db.listSubscriptions(req.user?.id) });
});

// POST /api/radar/subscriptions { keyword, interval_minutes, providers? } — 添加订阅
router.post('/subscriptions', (req, res) => {
  try {
    const { keyword, interval_minutes = 60, providers = null, enabled = true } = req.body || {};
    if (!keyword?.trim()) return res.status(400).json({ success: false, error: '请输入关键字' });
    const id = require('uuid').v4();
    const row = {
      id,
      user_id: req.user?.id,
      keyword: keyword.trim(),
      interval_minutes: Math.max(10, +interval_minutes || 60),
      providers,  // null = 用所有启用的；array = 指定 provider id 子集
      enabled,
      created_at: new Date().toISOString(),
      next_run_at: new Date(Date.now() + 30 * 1000).toISOString(),  // 30s 后跑第一次
      total_new: 0,
    };
    db.insertSubscription(row);
    res.json({ success: true, subscription: row });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/radar/subscriptions/:id
router.delete('/subscriptions/:id', (req, res) => {
  const sub = db.getSubscription(req.params.id);
  if (!sub) return res.status(404).json({ success: false, error: '订阅不存在' });
  if (sub.user_id !== req.user?.id && req.user?.role !== 'admin') return res.status(403).json({ success: false, error: '无权操作' });
  db.deleteSubscription(req.params.id);
  res.json({ success: true });
});

// PUT /api/radar/subscriptions/:id — 更新订阅（开关/间隔/keyword）
router.put('/subscriptions/:id', (req, res) => {
  const sub = db.getSubscription(req.params.id);
  if (!sub) return res.status(404).json({ success: false, error: '订阅不存在' });
  if (sub.user_id !== req.user?.id && req.user?.role !== 'admin') return res.status(403).json({ success: false, error: '无权操作' });
  const allowed = ['keyword', 'interval_minutes', 'enabled', 'providers'];
  const fields = {};
  for (const k of allowed) if (k in req.body) fields[k] = req.body[k];
  db.updateSubscription(req.params.id, fields);
  res.json({ success: true });
});

// POST /api/radar/subscriptions/:id/run — 立即跑一次
router.post('/subscriptions/:id/run', async (req, res) => {
  const sub = db.getSubscription(req.params.id);
  if (!sub) return res.status(404).json({ success: false, error: '订阅不存在' });
  if (sub.user_id !== req.user?.id && req.user?.role !== 'admin') return res.status(403).json({ success: false, error: '无权操作' });
  try {
    const scheduler = require('../services/subscriptionScheduler');
    const newCount = await scheduler.runOne(sub);
    res.json({ success: true, new_count: newCount });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ═══════ 平台账号绑定状态（普通用户可查 — 不暴露 Key/Cookie 内容，只返回 bound 状态） ═══════
//
// 这是给应用端「平台账号绑定」模块用的简化视图，不需要 admin 权限。
// 实际的 Key/Cookie 配置仍在 admin /api/admin/datasources 那边。
router.get('/platform-status', (req, res) => {
  try {
    const config = searchProviders.loadConfig();
    const PLATFORMS = [
      { key: 'douyin',       name: '抖音',     icon: '📺', need_login: true,  provider_ids: ['douyin-headless'] },
      { key: 'xiaohongshu',  name: '小红书',   icon: '📕', need_login: true,  provider_ids: ['xiaohongshu-headless'] },
      { key: 'kuaishou',     name: '快手',     icon: '📹', need_login: true,  provider_ids: ['kuaishou-headless'] },
      { key: 'weibo',        name: '微博',     icon: '🐦', need_login: false, provider_ids: ['weibo'] },
      { key: 'bilibili',     name: 'B站',      icon: '📺', need_login: false, provider_ids: ['bilibili-popular', 'bilibili-region'] },
      { key: 'youtube',      name: 'YouTube',  icon: '▶',  need_login: false, provider_ids: ['youtube'] },
    ];
    const result = PLATFORMS.map(p => {
      const enabledProviders = p.provider_ids.filter(pid => config.providers?.[pid]?.enabled);
      const hasCookie = p.provider_ids.some(pid => {
        const c = config.providers?.[pid] || {};
        return !!(c.cookie || c.api_key);
      });
      return {
        ...p,
        enabled_count: enabledProviders.length,
        bound: hasCookie || (!p.need_login && enabledProviders.length > 0),
        status_text: enabledProviders.length === 0 ? '未启用'
          : (p.need_login && !hasCookie) ? '已启用·未登录账号'
          : '已就绪',
      };
    });
    res.json({ success: true, platforms: result });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══════ 博主搜索（按关键字找博主而非视频） ═══════
// POST /api/radar/search-bloggers { keyword, platforms?, limit? }
router.post('/search-bloggers', async (req, res) => {
  try {
    const { keyword = '', platforms = [], limit = 12 } = req.body || {};
    const kw = (keyword || '').trim();
    if (!kw) return res.status(400).json({ success: false, error: '请输入博主名/关键字' });

    const results = [];
    const sources = [];
    const wantedPlats = (platforms && platforms.length && !platforms.includes('all')) ? platforms : ['bilibili', 'douyin', 'xiaohongshu'];

    // B 站：真实搜索博主接口（不需登录）
    if (wantedPlats.includes('bilibili')) {
      try {
        const axios = require('axios');
        const r = await axios.get('https://api.bilibili.com/x/web-interface/wbi/search/type', {
          params: { search_type: 'bili_user', keyword: kw, page: 1, page_size: Math.min(limit, 20) },
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0',
            'Referer': 'https://www.bilibili.com/',
            'Cookie': 'buvid3=A4B1F7D2-3E5C-4A1B-9D8C-E7F1A2B3C4D5infoc',
          }
        });
        const list = r.data?.data?.result || [];
        const items = list.slice(0, limit).map(u => ({
          id: 'bili_user_' + u.mid,
          platform: 'bilibili',
          platform_name: 'B站',
          name: (u.uname || '').replace(/<[^>]+>/g, ''),
          uid: u.mid,
          avatar: u.upic ? (u.upic.startsWith('http') ? u.upic : 'https:' + u.upic) : '',
          followers: u.fans || 0,
          video_count: u.videos || 0,
          signature: (u.usign || '').replace(/<[^>]+>/g, ''),
          account_url: 'https://space.bilibili.com/' + u.mid,
          source: 'bilibili-user-search',
        }));
        results.push(...items);
        sources.push({ platform: 'bilibili', name: 'B站', count: items.length, status: 'ok' });
      } catch (e) {
        sources.push({ platform: 'bilibili', name: 'B站', count: 0, status: 'error', message: e.message });
      }
    }

    // 抖音/小红书/快手：必须登录账号才能搜博主
    const platNames = { douyin: '抖音', xiaohongshu: '小红书', kuaishou: '快手' };
    const needsLoginPlats = ['douyin', 'xiaohongshu', 'kuaishou'].filter(p => wantedPlats.includes(p));
    for (const p of needsLoginPlats) {
      const browserService = require('../services/browserService');
      if (!browserService.hasCookies(p)) {
        sources.push({
          platform: p, name: platNames[p] || p, count: 0,
          status: 'needs_login', needs_login: true, login_platform: p,
          message: `${platNames[p] || p}搜博主需扫码登录账号`,
        });
      } else {
        // TODO: 用 puppeteer + cookie 跑各平台 search?keyword=xxx&type=user
        // 当前先返回未实现状态
        sources.push({
          platform: p, name: platNames[p] || p, count: 0,
          status: 'pending', message: `${platNames[p] || p}搜博主功能待实现（已登录但没接 puppeteer 路径）`
        });
      }
    }

    res.json({ success: true, keyword: kw, total: results.length, bloggers: results, sources });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════ 关键字搜索（多平台聚合 — 走 providers 架构） ═══════
//
// POST /api/radar/search { keyword, providers? }
//   并行调用所有 enabled providers，结果合并按数据源分组返回
//   不传 providers = 用配置文件里所有 enabled 的
router.post('/search', async (req, res) => {
  try {
    const { keyword = '', platforms = [], sort = 'comprehensive', region, limit = 24 } = req.body || {};
    const kw = (keyword || '').trim();
    if (!kw) return res.status(400).json({ success: false, error: '请输入关键字' });

    // 走新的 providers 架构
    const r = await searchProviders.searchAll({ keyword: kw, limit, region, platforms, sort });

    // 同时拼接本地 contents 模糊匹配
    let localItems = [];
    try {
      const local = db.listContents(req.user?.id);
      const localMatched = local.filter(c => {
        const hay = (c.title || '') + ' ' + (c.transcript || '') + ' ' + (c.author || '') + ' ' + (c.tags || []).join(' ');
        return hay.toLowerCase().includes(kw.toLowerCase());
      });
      localItems = localMatched.slice(0, 8).map(c => ({
        id: 'local_' + c.id,
        local_content_id: c.id,
        platform: c.platform || 'other',
        platform_name: c.platform_name || '本地',
        title: c.title || '',
        transcript: c.transcript || '',
        author: c.author || '',
        tags: c.tags || [],
        cover: c.cover || '',
        video_url: c.video_url || '',
        views: c.views || 0, likes: c.likes || 0,
        source: 'local-contents',
      }));
    } catch {}

    const allResults = [...localItems, ...r.results];
    const allSources = [
      { provider_id: 'local', name: '本地内容库', platform: 'local', count: localItems.length, status: 'ok' },
      ...r.sources,
    ];

    return res.json({
      success: true,
      keyword: kw,
      total: allResults.length,
      sources: allSources,
      results: allResults,
    });

    // 下面是旧实现（保留以备回退，但当前不会执行）
    const wantedPlatforms = ['bilibili', 'douyin', 'kuaishou', 'xiaohongshu'];
    const results = [];
    const sources = [];

    // ── 1. B站：popular API 拿真实每日热门 + 关键字过滤 ──
    //    （B站 search API 需要 wbi 签名，无登录易被风控；popular 不需要登录就能拿到真数据）
    if (wantedPlatforms.includes('bilibili') || wantedPlatforms.includes('all')) {
      try {
        const axios = require('axios');
        // 取 50 条 popular（每日热门，全站口径）
        const r = await axios.get('https://api.bilibili.com/x/web-interface/popular', {
          params: { ps: 50, pn: 1 },
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://www.bilibili.com/',
            'Cookie': 'buvid3=A4B1F7D2-3E5C-4A1B-9D8C-E7F1A2B3C4D5infoc',
          }
        });
        const all = r.data?.data?.list || [];
        // 按 keyword 模糊过滤（标题 / 作者 / 简介 / 分区）
        const matched = all.filter(v => {
          const hay = (v.title || '') + ' ' + (v.owner?.name || '') + ' ' + (v.desc || '') + ' ' + (v.tname || '');
          return hay.toLowerCase().includes(kw.toLowerCase());
        });
        // 命中策略：精确匹配 → 有命中就返命中；无命中就返全部 popular（让用户至少能看到真数据）
        const finalList = matched.length > 0 ? matched : all.slice(0, 24);
        const matchType = matched.length > 0 ? 'matched' : 'fallback-popular';

        finalList.forEach(v => {
          results.push({
            id: 'bili_' + v.bvid,
            platform: 'bilibili',
            platform_name: 'B站',
            title: v.title || '',
            transcript: v.desc || '',
            tags: v.tname ? [v.tname] : [],
            author: v.owner?.name || '',
            author_avatar: v.owner?.face || '',
            cover: v.pic || '',
            video_url: v.short_link_v2 || ('https://www.bilibili.com/video/' + v.bvid),
            views: v.stat?.view || 0,
            likes: v.stat?.like || 0,
            comments: v.stat?.reply || 0,
            danmaku: v.stat?.danmaku || 0,
            shares: v.stat?.share || 0,
            duration: _fmtDuration(v.duration),
            published_at: v.pubdate ? new Date(v.pubdate * 1000).toISOString() : null,
            source: 'bilibili-popular',
            match_type: matchType,
          });
        });
        sources.push({
          platform: 'bilibili',
          count: finalList.length,
          source: 'popular-api',
          status: 'ok',
          message: matched.length === 0 ? `当前 50 条全站热门中未匹配"${kw}"，已展示全部热门作为参考` : `精确匹配 ${matched.length} 条`,
        });
      } catch (e) {
        console.warn('[search/bilibili] 失败:', e.message);
        sources.push({ platform: 'bilibili', count: 0, source: 'popular-api', status: 'error', error: e.message });
      }
    }

    // ── 2. 抖音/快手/小红书 → 走 MCP search_trending（拿热门，按关键字模糊过滤） ──
    const otherPlatforms = wantedPlatforms.filter(p => ['douyin', 'kuaishou', 'xiaohongshu'].includes(p));
    for (const p of otherPlatforms) {
      try {
        const mcpManager = require('../services/mcpManager');
        const instances = mcpManager.listInstances();
        const crawler = instances.find(i => i.id === 'media-crawler' && i.status === 'running');
        if (!crawler) {
          sources.push({ platform: p, count: 0, source: 'mcp', status: 'not-installed', message: 'MCP media-crawler 未运行 → 该平台搜索不可用' });
          continue;
        }
        const r = await mcpManager.callTool('media-crawler', 'search_trending', { platform: p });
        const data = r?.content?.[0]?.text ? JSON.parse(r.content[0].text) : { trending: [] };
        const trending = data.trending || [];
        // 关键字模糊过滤
        const matched = trending.filter(it => {
          const hay = (it.title || it.desc || '') + ' ' + (it.author || it.nickname || '');
          return hay.toLowerCase().includes(kw.toLowerCase());
        });
        matched.forEach((v, i) => {
          results.push({
            id: `${p}_${i}_${Date.now()}`,
            platform: p,
            platform_name: ({ douyin:'抖音', kuaishou:'快手', xiaohongshu:'小红书' })[p],
            title: v.title || v.desc || '',
            author: v.author || v.nickname || '',
            cover: v.cover || '',
            video_url: v.url || v.share_url || '',
            views: v.views || v.play_count || 0,
            likes: v.likes || v.digg_count || 0,
            duration: v.duration || '',
            source: 'mcp-search-trending',
          });
        });
        sources.push({ platform: p, count: matched.length, source: 'mcp', status: 'ok', total_trending: trending.length });
      } catch (e) {
        console.warn(`[search/${p}] 失败:`, e.message);
        sources.push({ platform: p, count: 0, source: 'mcp', status: 'error', error: e.message });
      }
    }

    // ── 3. 本地 contents 模糊匹配（已抓过的视频按关键字过滤） ──
    try {
      const local = db.listContents(req.user?.id);
      const localMatched = local.filter(c => {
        const hay = (c.title || '') + ' ' + (c.transcript || '') + ' ' + (c.author || '') + ' ' + (c.tags || []).join(' ');
        return hay.toLowerCase().includes(kw.toLowerCase());
      });
      localMatched.slice(0, 10).forEach(c => {
        results.push({
          id: 'local_' + c.id,
          local_content_id: c.id,
          platform: c.platform || 'other',
          platform_name: c.platform_name || '本地',
          title: c.title || '',
          transcript: c.transcript || '',
          author: c.author || '',
          tags: c.tags || [],
          video_url: c.video_url || '',
          views: 0, likes: 0,
          source: 'local-contents',
        });
      });
      sources.push({ platform: 'local', count: localMatched.length, source: 'local-db', status: 'ok' });
    } catch {}

    // 排序：B站点击量优先，本地次之
    results.sort((a, b) => {
      const w = src => src === 'bilibili-api' ? 0 : src === 'mcp-search-trending' ? 1 : 2;
      const dw = w(a.source) - w(b.source);
      if (dw !== 0) return dw;
      return (b.views || 0) - (a.views || 0);
    });

    res.json({
      success: true,
      keyword: kw,
      total: results.length,
      sources,
      results,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/radar/replicate/tasks/:id/file?type=audio|video — 流式输出任务产物
//   <audio>/<video> 标签不能带 Authorization → 用 ?token= 走 query 鉴权
//   task id 是 uuid 不可枚举，且只允许访问对应任务的 audio_path / video_path
router.get('/replicate/tasks/:id/file', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const mime = { '.mp4':'video/mp4', '.webm':'video/webm', '.mov':'video/quicktime',
                  '.wav':'audio/wav', '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.ogg':'audio/ogg' };
  try {
    const task = db.getReplicateTask(req.params.id);
    if (!task) return res.status(404).end();
    // 鉴权：admin 或 owner（authenticate 中间件已验证 token）
    if (req.user?.role !== 'admin' && task.user_id && task.user_id !== req.user?.id) {
      return res.status(403).end();
    }
    const type = req.query.type === 'video' ? 'video' : 'audio';
    const filePath = type === 'video' ? task.video_path : task.audio_path;
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).end();
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[radar/file] error:', err.message);
    res.status(500).end();
  }
});

module.exports = router;
