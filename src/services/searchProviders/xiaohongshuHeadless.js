/** 小红书 Headless 搜索（不破解签名，可能被风控） */
const puppeteerCore = require('puppeteer-core');
const fs = require('fs');

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.exports = {
  name: '小红书（Headless 浏览器）',
  platform: 'xiaohongshu',
  requiresKey: false,
  description: '需 Chrome；小红书反爬较强，部分时段可能要求登录',
  configSchema: {
    timeout: { type: 'number', default: 30000 },
    cookie: { type: 'password', label: '小红书 Cookie（可选，提升稳定性）' },
  },

  async search({ keyword = '', limit = 24 } = {}, config = {}) {
    if (!keyword) throw new Error('小红书必须传 keyword');
    const chromePath = findChrome();
    if (!chromePath) throw new Error('未找到本地 Chrome');

    // 优先使用 browserService 持久化的扫码登录 cookie
    let savedCookies = null;
    try {
      const browserService = require('../browserService');
      if (browserService.hasCookies && browserService.hasCookies('xiaohongshu')) {
        savedCookies = browserService.loadCookies('xiaohongshu');
      }
    } catch {}

    // 没扫码 cookie 也没手填 cookie → 直接返回 needs_login 让前端引导（小红书反爬比抖音稍弱但仍需登录）
    if ((!savedCookies || !savedCookies.length) && !config.cookie) {
      return { items: [], message: '小红书搜索需先扫码登录账号', needs_login: true, login_platform: 'xiaohongshu' };
    }

    let browser;
    try {
      browser = await puppeteerCore.launch({
        executablePath: chromePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
      });
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0');
      await page.setViewport({ width: 1280, height: 1600 });
      // 1) 扫码登录 cookie（优先）
      if (savedCookies && Array.isArray(savedCookies) && savedCookies.length) {
        try {
          await page.setCookie(...savedCookies);
          console.log(`[xhs-headless] 注入扫码登录 cookie（${savedCookies.length} 条）`);
        } catch (e) {
          console.warn('[xhs-headless] cookie 注入失败:', e.message);
        }
      } else if (config.cookie) {
        // 2) 兼容：手填 cookie 字符串
        const cookies = config.cookie.split(';').map(s => s.trim()).filter(Boolean).map(kv => {
          const i = kv.indexOf('=');
          return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: '.xiaohongshu.com', path: '/' };
        });
        await page.setCookie(...cookies);
      }
      const url = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(keyword) + '&type=51';
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeout || 30000 });
      await page.waitForSelector('a[href*="/explore/"], section.note-item', { timeout: 8000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));

      const items = await page.evaluate((max) => {
        const out = [];
        const cards = document.querySelectorAll('section.note-item, a.cover, a[href*="/explore/"]');
        const seen = new Set();
        for (const c of cards) {
          const link = c.tagName === 'A' ? c : c.querySelector('a[href*="/explore/"]');
          if (!link) continue;
          const href = link.getAttribute('href') || '';
          const idMatch = href.match(/\/explore\/([0-9a-f]+)/);
          if (!idMatch || seen.has(idMatch[1])) continue;
          seen.add(idMatch[1]);
          const title = (c.querySelector('.title, [class*="title"]')?.textContent || '').trim();
          const author = (c.querySelector('[class*="user"], [class*="author"]')?.textContent || '').trim();
          const img = c.querySelector('img');
          const cover = img?.src || img?.getAttribute('data-src') || '';
          out.push({
            note_id: idMatch[1],
            title: title.slice(0, 100),
            author,
            cover,
            url: href.startsWith('http') ? href : 'https://www.xiaohongshu.com' + href,
          });
          if (out.length >= max) break;
        }
        return out;
      }, limit);

      const parsed = items.map(it => ({
        id: 'xhs_' + it.note_id,
        platform: 'xiaohongshu',
        platform_name: '小红书',
        title: it.title,
        transcript: '',
        tags: [],
        author: it.author,
        cover: it.cover,
        video_url: it.url,
        views: 0, likes: 0, comments: 0,
        duration: '',
        published_at: null,
        source: 'xiaohongshu-headless',
      }));
      return { items: parsed, message: `抓取 ${parsed.length} 条${config.cookie ? '（带 cookie）' : '（匿名）'}` };
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  },

  async health() {
    const chromePath = findChrome();
    return chromePath ? { ok: true, message: 'Chrome ' + chromePath } : { ok: false, message: '未找到 Chrome' };
  },
};
