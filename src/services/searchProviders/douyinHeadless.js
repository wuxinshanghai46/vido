/**
 * 抖音 Playwright/Puppeteer headless 搜索
 *
 * 实现思路：用浏览器打开 www.douyin.com/search/{keyword} 等待 JS 渲染完成，
 * 解析 DOM 拿视频卡片。**不破解 a-bogus 签名**，接受被风控的可能。
 *
 * 限制：
 *  - 需要本地有 Chrome（puppeteer-core 找不到时报错）
 *  - 抖音对未登录访问有反爬，部分时段可能返回滑块或 403
 *  - 速度慢（启动浏览器 5-10s）
 */
const puppeteerCore = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

function findChrome() {
  // VIDO 已有 browserService 找 chrome 的逻辑，复用其常见路径
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.exports = {
  name: '抖音（Headless 浏览器）',
  platform: 'douyin',
  requiresKey: false,
  description: '用 puppeteer 启动 Chrome 模拟搜索，速度慢（5-15s/次），可能被反爬',
  configSchema: {
    timeout: { type: 'number', default: 30000, label: '超时（ms）' },
  },

  async search({ keyword = '', limit = 24 } = {}, config = {}) {
    if (!keyword) throw new Error('抖音必须传 keyword');
    const chromePath = findChrome();
    if (!chromePath) throw new Error('未找到本地 Chrome 可执行文件，请安装 Chrome 或设置 CHROME_PATH 环境变量');

    // 复用 browserService 持久化的登录 cookie（如果用户在「平台账号绑定」扫码登录过）
    let savedCookies = null;
    try {
      const browserService = require('../browserService');
      if (browserService.hasCookies && browserService.hasCookies('douyin')) {
        savedCookies = browserService.loadCookies('douyin');
      }
    } catch {}
    // 抖音搜索强反爬，没 cookie 99% 拿不到结果 → 返回 needs_login 状态供前端引导（不 throw 让 search 流程能继续）
    if (!savedCookies || !savedCookies.length) {
      return { items: [], message: '抖音搜索需先扫码登录账号', needs_login: true, login_platform: 'douyin' };
    }

    let browser;
    try {
      browser = await puppeteerCore.launch({
        executablePath: chromePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
        timeout: 30000,
      });
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1280, height: 1600 });

      // 注入已登录账号的 cookie（带登录态搜索结果更全，且不易被风控墙）
      if (savedCookies && Array.isArray(savedCookies) && savedCookies.length) {
        try {
          await page.setCookie(...savedCookies);
          console.log(`[douyin-headless] 注入已登录 cookie（${savedCookies.length} 条）`);
        } catch (e) {
          console.warn('[douyin-headless] cookie 注入失败:', e.message);
        }
      }

      const url = 'https://www.douyin.com/search/' + encodeURIComponent(keyword);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeout || 30000 });
      // 等视频卡渲染（最多等 8s）
      await page.waitForSelector('a[href*="/video/"], li[data-e2e="search-card"]', { timeout: 8000 }).catch(() => {});
      // 滚动一下加载更多
      await page.evaluate(() => window.scrollBy(0, 1500));
      await new Promise(r => setTimeout(r, 1500));

      const items = await page.evaluate((max) => {
        const out = [];
        const cards = document.querySelectorAll('li[data-e2e="search-card"], div[data-e2e="search-card"], a[href*="/video/"]');
        const seen = new Set();
        for (const c of cards) {
          const link = c.tagName === 'A' ? c : c.querySelector('a[href*="/video/"]');
          if (!link) continue;
          const href = link.getAttribute('href') || '';
          const idMatch = href.match(/\/video\/(\d+)/);
          if (!idMatch || seen.has(idMatch[1])) continue;
          seen.add(idMatch[1]);
          const title = (c.querySelector('[class*="title"]')?.textContent || link.title || link.textContent || '').trim();
          const author = (c.querySelector('[class*="author"]')?.textContent || c.querySelector('[class*="username"]')?.textContent || '').trim();
          const img = c.querySelector('img');
          const cover = img?.src || img?.getAttribute('data-src') || '';
          const playMatch = (c.textContent || '').match(/(\d+(?:\.\d+)?[万kKwW]?)\s*(?:点赞|播放|观看)/);
          out.push({
            video_id: idMatch[1],
            title: title.slice(0, 100),
            author,
            cover,
            url: href.startsWith('http') ? href : 'https://www.douyin.com' + href,
            stat_text: playMatch?.[1] || '',
          });
          if (out.length >= max) break;
        }
        return out;
      }, limit);

      const parsed = items.map(it => ({
        id: 'dy_' + it.video_id,
        platform: 'douyin',
        platform_name: '抖音',
        title: it.title,
        transcript: '',
        tags: [],
        author: it.author,
        cover: it.cover,
        video_url: it.url,
        views: 0, likes: 0, comments: 0,
        duration: '',
        published_at: null,
        source: 'douyin-headless',
        stat_text: it.stat_text,
      }));

      return { items: parsed, message: `headless 抓取 ${parsed.length} 条（不带签名，可能被风控降级）` };
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  },

  async health() {
    const chromePath = findChrome();
    if (!chromePath) return { ok: false, message: '未找到 Chrome 可执行文件' };
    return { ok: true, message: 'Chrome 路径 ' + chromePath };
  },
};
