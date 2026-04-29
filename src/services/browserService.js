/**
 * 浏览器会话管理服务
 * 用 Puppeteer 管理平台登录、Cookie 保存、带 Cookie 抓取
 * 支持：抖音、小红书、快手
 */
const fs = require('fs');
const path = require('path');

const COOKIE_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs', 'cookies');
if (!fs.existsSync(COOKIE_DIR)) fs.mkdirSync(COOKIE_DIR, { recursive: true });

const PLATFORMS = {
  douyin: {
    name: '抖音',
    // 主域：sso.douyin.com 在云服务器 IP 段返回 403（抖音风控）
    loginUrl: 'https://www.douyin.com/?modal_id=login',
    qrSelectors: ['canvas.captcha-canvas', 'img[class*="qrcode"]', '.web-login-scan-code__content canvas', 'canvas'],
    afterNav: async (page) => {
      // 主域进去后右上角是"登录"按钮，点它弹扫码框
      await new Promise(r => setTimeout(r, 3000));
      // 策略 1：用 evaluate 直接找页面里所有文字含"登录"的元素并点
      const clicked = await page.evaluate(() => {
        const candidates = [
          '[data-e2e="navigation-login"]',
          '[data-e2e="login-button"]',
          'button.login-button',
          '[class*="LoginButton"]',
          '[class*="loginBtn"]',
          '[class*="login-btn"]',
        ];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (el) { el.click(); return sel; }
        }
        // 兜底：扫描所有按钮/链接，文字精确为"登录"的就点
        const all = document.querySelectorAll('button, a, [class*="login" i]');
        for (const el of all) {
          const t = (el.textContent || '').trim();
          if (t === '登录' || t === '立即登录' || t === '登录抖音') {
            el.click();
            return 'text-match: ' + t;
          }
        }
        return null;
      }).catch(() => null);
      if (clicked) console.log('[Browser] douyin 触发登录:', clicked);
      // 等扫码弹窗 + 二维码 canvas 出现（最多 12s）
      try {
        await page.waitForSelector('.web-login-scan-code__content canvas, canvas.captcha-canvas, img[class*="qrcode"], [class*="LoginPanel"] canvas, [class*="login-modal"] canvas', { timeout: 12000 });
      } catch {}
      // 再等 1.5s 让二维码图绘完（canvas 渲染异步）
      await new Promise(r => setTimeout(r, 1500));
    },
    checkLogin: async (page) => {
      try {
        const cookies = await page.cookies();
        const hasSession = cookies.some(c => c.name === 'sessionid' || c.name === 'passport_csrf_token' || c.name === 'sid_guard');
        const loggedIn = await page.evaluate(() => {
          return !!document.querySelector('[data-e2e="user-info"]') ||
                 !!document.querySelector('.avatar-wrapper') ||
                 document.cookie.includes('sessionid');
        });
        return hasSession || loggedIn;
      } catch { return false; }
    }
  },
  xiaohongshu: {
    name: '小红书',
    loginUrl: 'https://www.xiaohongshu.com/explore',
    qrSelectors: ['.qrcode-img', '.login-container .qrcode', 'canvas', 'img[src*="qrcode"]'],
    afterNav: async (page) => {
      // 小红书 explore 进去后会弹登录蒙层，等关键 selector 而不是死等
      try { await page.waitForSelector('.login-container, [class*="LoginContainer"], .qrcode-img, canvas', { timeout: 10000 }); } catch {}
      // 部分页面要点"登录"才显示二维码（弹层默认就有 QR）
      try {
        const loginBtn = await page.$('.login-btn, [class*="LoginBtn"]');
        if (loginBtn) await loginBtn.click().catch(()=>{});
        await new Promise(r => setTimeout(r, 1500));
      } catch {}
      // 切扫码 tab（如果有 sms/扫码切换）
      try {
        const qrTab = await page.$('.css-1qjnpym, [class*="qrcode-tab"]');
        if (qrTab) await qrTab.click().catch(()=>{});
      } catch {}
    },
    checkLogin: async (page) => {
      try {
        const cookies = await page.cookies();
        return cookies.some(c => /^(customer-sso-sid|web_session|xsecappid|xhsTrackerId)$/.test(c.name));
      } catch { return false; }
    }
  },
  kuaishou: {
    name: '快手',
    loginUrl: 'https://passport.kuaishou.com/pc/account/login?sid=kuaishou.web.cp.api',
    qrSelectors: ['#qrcode canvas', '.qrcode-login canvas', 'canvas'],
    afterNav: async (page) => {
      // 快手 passport 默认是手机号+短信登录，要点"扫码登录"tab 切换
      await new Promise(r => setTimeout(r, 2000));
      const switched = await page.evaluate(() => {
        // 找文字含"扫码"的 tab/按钮并点击
        const all = document.querySelectorAll('a, button, span, div, li, [class*="tab"]');
        for (const el of all) {
          const t = (el.textContent || '').trim();
          if (t === '扫码登录' || t === '扫一扫登录' || /^扫码$/.test(t)) {
            try { el.click(); return t; } catch {}
          }
        }
        return null;
      }).catch(() => null);
      if (switched) console.log('[Browser] 快手切到扫码 tab:', switched);
      // 等二维码 canvas
      try { await page.waitForSelector('canvas, img[class*="qr"], img[src*="qrcode"]', { timeout: 12000 }); } catch {}
      await new Promise(r => setTimeout(r, 1500));
    },
    checkLogin: async (page) => {
      try {
        const cookies = await page.cookies();
        return cookies.some(c => /^(userId|kuaishou\.web\.cp\.api_st|kuaishou\.web\.at)$/.test(c.name));
      } catch { return false; }
    }
  }
};

// 活跃的登录会话 { platform: { browser, page, status } }
const activeSessions = {};

function getCookiePath(platform) {
  return path.join(COOKIE_DIR, `${platform}_cookies.json`);
}

function hasCookies(platform) {
  return fs.existsSync(getCookiePath(platform));
}

function loadCookies(platform) {
  const p = getCookiePath(platform);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function saveCookies(platform, cookies, meta = {}) {
  fs.writeFileSync(getCookiePath(platform), JSON.stringify(cookies, null, 2));
  // 保存 meta（用户名等）
  const metaPath = getCookiePath(platform).replace('.json', '_meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({ ...meta, updated_at: new Date().toISOString() }));
}

function loadMeta(platform) {
  const metaPath = getCookiePath(platform).replace('.json', '_meta.json');
  if (!fs.existsSync(metaPath)) return {};
  try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return {}; }
}

function deleteCookies(platform) {
  const p = getCookiePath(platform);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/**
 * 获取所有平台登录状态
 */
function getLoginStatus() {
  const result = {};
  for (const [id, info] of Object.entries(PLATFORMS)) {
    const meta = loadMeta(id);
    const has = hasCookies(id);
    let mtime = null, ageHours = null;
    if (has) {
      try {
        const stat = fs.statSync(getCookiePath(id));
        mtime = stat.mtimeMs;
        ageHours = Math.round((Date.now() - mtime) / 3600000);
      } catch {}
    }
    result[id] = {
      name: info.name,
      loggedIn: has,
      username: meta.username || '',
      updatedAt: meta.updated_at || (mtime ? new Date(mtime).toISOString() : null),
      ageHours,
      // 过期判断：抖音/快手 cookie 通常 7 天有效，小红书更短
      possibly_expired: has && ageHours != null && ageHours > 24 * 5,
    };
  }
  return result;
}

/**
 * 查找可用的 Chrome/Chromium 路径
 */
function findChromePath() {
  const candidates = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    // Mac
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * 启动登录流程 — 打开浏览器截图 QR 码
 * @returns {string} base64 截图
 */
// 异步启动 — 立即返回，让前端 polling 拉截图（不再阻塞 puppeteer 启动）
async function startLogin(platform) {
  if (!PLATFORMS[platform]) throw new Error(`不支持的平台: ${platform}`);

  // 清理旧会话
  if (activeSessions[platform]) {
    try { await activeSessions[platform].browser.close(); } catch {}
    delete activeSessions[platform];
  }

  const chromePath = findChromePath();
  if (!chromePath) throw new Error('未找到 Chrome/Chromium，请在服务器安装 chromium-browser 后重试');

  // 占位 session，让 pollLoginStatus 知道正在启动
  activeSessions[platform] = { status: 'launching', startedAt: Date.now(), browser: null, page: null, lastScreenshot: null };
  console.log(`[Browser] ${PLATFORMS[platform].name} 异步启动登录会话...`);

  // 后台启动 + 截图，不阻塞 HTTP 响应
  (async () => {
    const session = activeSessions[platform];
    if (!session) return;
    try {
      const puppeteer = require('puppeteer-core');
      const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: 'new',
        // 服务器 chromium 必须显式 --no-proxy-server 否则会探测系统代理失败显示"无法访问网络"
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
          '--no-proxy-server',
          '--proxy-bypass-list=*',
          '--disable-features=IsolateOrigins,site-per-process,VizDisplayCompositor',
          '--ignore-certificate-errors',
          '--lang=zh-CN',
          '--window-size=1280,800'
        ],
        defaultViewport: { width: 1280, height: 800 }
      });
      session.browser = browser;
      const page = await browser.newPage();
      session.page = page;
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // 关键：扫码登录强制重新扫码 — 不加载历史 cookie 进入 page
      //   原因：之前会自动加载历史 cookie，导致页面打开就处于已登录态，
      //   pollLoginStatus 第一次轮询就直接判定 success，二维码根本不显示给用户。
      //   现在严格按"扫码"流程走：每次都从空 cookie 开始 → 必须扫码 → 扫码成功后保存新 cookie
      try { const ctx = browser.defaultBrowserContext(); await ctx.clearPermissionOverrides?.(); } catch {}
      try { const client = await page.target().createCDPSession(); await client.send('Network.clearBrowserCookies'); await client.send('Network.clearBrowserCache'); } catch {}

      session.status = 'navigating';
      try {
        await page.goto(PLATFORMS[platform].loginUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      } catch (e) {
        console.warn(`[Browser] ${PLATFORMS[platform].name} 主导航超时但继续:`, e.message);
      }

      if (PLATFORMS[platform].afterNav) {
        try { await PLATFORMS[platform].afterNav(page); } catch (e) {
          console.warn(`[Browser] ${PLATFORMS[platform].name} afterNav 失败但继续:`, e.message);
        }
      }

      try {
        session.lastScreenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 });
      } catch {}
      session.status = 'waiting';
      console.log(`[Browser] ${PLATFORMS[platform].name} 登录页就绪，等待扫码...`);
    } catch (err) {
      session.status = 'error';
      session.error = err.message;
      console.error(`[Browser] ${PLATFORMS[platform].name} 启动失败:`, err.message);
      try { if (session.browser) await session.browser.close(); } catch {}
    }
  })();

  return { launching: true, message: '会话启动中，请轮询 /poll 等待二维码' };
}

/**
 * 轮询登录状态 — 检查是否已登录并截图
 */
async function pollLoginStatus(platform) {
  const session = activeSessions[platform];
  if (!session) return { status: 'expired', message: '会话已过期' };
  const elapsed = Math.round((Date.now() - (session.startedAt || Date.now())) / 1000);

  // 启动失败
  if (session.status === 'error') {
    const err = session.error || '未知错误';
    delete activeSessions[platform];
    return { status: 'error', message: err };
  }

  // 还在 launching/navigating — page 还没就绪，先返回上次截图（可能是 null）
  if (!session.page || session.status === 'launching' || session.status === 'navigating') {
    return {
      status: 'launching',
      message: session.status === 'navigating' ? '正在打开登录页...' : '正在启动浏览器...',
      screenshot: session.lastScreenshot || null,
      elapsed,
    };
  }

  try {
    const { page } = session;
    const loggedIn = await PLATFORMS[platform].checkLogin(page);

    if (loggedIn) {
      let username = '';
      try {
        username = await page.evaluate(() => {
          const el = document.querySelector('[data-e2e="user-info"] .name') ||
                     document.querySelector('.avatar-wrapper + span') ||
                     document.querySelector('.user-name') ||
                     document.querySelector('[class*="nickname"]') ||
                     document.querySelector('[class*="userName"]');
          if (el) return el.textContent.trim();
          const m = document.cookie.match(/(?:nickname|user_name|username)=([^;]+)/);
          return m ? decodeURIComponent(m[1]) : '';
        });
      } catch {}

      const cookies = await page.cookies();
      saveCookies(platform, cookies, { username });
      session.status = 'success';

      let screenshot = null;
      try { screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 }); } catch {}

      try { await session.browser.close(); } catch {}
      delete activeSessions[platform];

      console.log(`[Browser] ${PLATFORMS[platform].name} 登录成功，已保存 ${cookies.length} 个 cookie`);
      return { status: 'success', message: '登录成功', screenshot, elapsed };
    }

    // 未登录，返回最新截图（每 3s 拍一次）
    let screenshot = session.lastScreenshot;
    try {
      screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 });
      session.lastScreenshot = screenshot;
    } catch {}
    return { status: 'waiting', message: '等待扫码...', screenshot, elapsed };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/**
 * 取消登录
 */
async function cancelLogin(platform) {
  const session = activeSessions[platform];
  if (session) {
    try { await session.browser.close(); } catch {}
    delete activeSessions[platform];
  }
}

/**
 * 退出登录（删除 cookie）
 */
function logout(platform) {
  deleteCookies(platform);
  if (activeSessions[platform]) {
    try { activeSessions[platform].browser.close(); } catch {}
    delete activeSessions[platform];
  }
}

/**
 * 用已保存的 cookie 抓取页面
 */
async function fetchWithCookies(platform, url) {
  const cookies = loadCookies(platform);
  if (!cookies) throw new Error(`${PLATFORMS[platform]?.name || platform} 未登录`);

  const puppeteer = require('puppeteer-core');
  const chromePath = findChromePath();
  if (!chromePath) throw new Error('未找到 Chrome');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-blink-features=AutomationControlled', '--no-proxy-server', '--proxy-bypass-list=*',
      '--disable-features=IsolateOrigins,site-per-process', '--ignore-certificate-errors', '--lang=zh-CN'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setCookie(...cookies);
    // domcontentloaded 比 networkidle2 稳（SPA 永远 idle 不下来）
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (e) {
      console.warn(`[fetchWithCookies] ${url} 主导航超时但继续:`, e.message);
    }
    await new Promise(r => setTimeout(r, 3000));

    const html = await page.content();
    const title = await page.title();

    return { html, title, url: page.url() };
  } finally {
    await browser.close();
  }
}

/**
 * 抓取博主主页 + scroll 触发懒加载，返回所有视频链接
 *  参考 douyin 文件夹做法（用 cookie 拿全量），但用 puppeteer 而不是 yt-dlp
 *  @param {string} platform 'douyin' | 'xiaohongshu' | 'kuaishou' | 'bilibili'
 *  @param {string} url 博主主页或视频链接（会自动从视频 URL 提取作者主页）
 *  @param {object} opts { maxScroll: 8, scrollDelay: 1500, maxVideos: 100 }
 *  @returns {Promise<{ author, bio, followers, videos:[{id,url,title,cover}], html, currentUrl }>}
 */
async function crawlAuthorVideos(platform, url, opts = {}) {
  const cookies = loadCookies(platform);
  if (!cookies) throw new Error(`${PLATFORMS[platform]?.name || platform} 未登录，先去「平台账号绑定」扫码`);
  const maxScroll = opts.maxScroll || 8;
  const scrollDelay = opts.scrollDelay || 1500;
  const maxVideos = opts.maxVideos || 100;

  const VIDEO_RE = {
    douyin: /\/video\/(\d{15,25})/g,
    xiaohongshu: /\/(?:explore|discovery\/item)\/([0-9a-f]{20,})/g,
    kuaishou: /\/short-video\/(\d{10,})/g,
    bilibili: /\/video\/(BV[A-Za-z0-9]{10,})/g,
  };
  const VIDEO_BASE = {
    douyin: id => `https://www.douyin.com/video/${id}`,
    xiaohongshu: id => `https://www.xiaohongshu.com/explore/${id}`,
    kuaishou: id => `https://www.kuaishou.com/short-video/${id}`,
    bilibili: id => `https://www.bilibili.com/video/${id}`,
  };

  const puppeteer = require('puppeteer-core');
  const chromePath = findChromePath();
  if (!chromePath) throw new Error('未找到 Chrome/Chromium');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu',
      '--disable-blink-features=AutomationControlled','--no-proxy-server','--proxy-bypass-list=*',
      '--disable-features=IsolateOrigins,site-per-process','--ignore-certificate-errors','--lang=zh-CN',
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1600 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setCookie(...cookies);

    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (e) {
      console.warn(`[crawlAuthor] ${platform} 导航超时但继续:`, e.message);
    }
    // 等视频卡 DOM 出来（最多 8s）
    try { await page.waitForSelector('a[href*="/video/"], a[href*="/explore/"], a[href*="/short-video/"]', { timeout: 8000 }); } catch {}

    // 滚动 N 次拿懒加载
    const collected = new Set();
    const collect = (html) => {
      const re = VIDEO_RE[platform];
      if (!re) return;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(html)) !== null) {
        if (collected.size >= maxVideos) break;
        collected.add(m[1]);
      }
    };
    let lastHeight = 0;
    let stableCount = 0;
    for (let i = 0; i < maxScroll; i++) {
      const html = await page.content();
      collect(html);
      const newHeight = await page.evaluate('document.body.scrollHeight');
      if (newHeight === lastHeight) {
        stableCount++;
        if (stableCount >= 2) break; // 连续 2 次高度不变，停
      } else {
        stableCount = 0;
        lastHeight = newHeight;
      }
      await page.evaluate('window.scrollBy(0, document.body.scrollHeight)');
      await new Promise(r => setTimeout(r, scrollDelay));
    }
    const finalHtml = await page.content();
    collect(finalHtml);

    // 提取作者元信息：优先 DOM selector + 平台特定，其次严格 SSR JSON
    const meta = await page.evaluate((plat) => {
      const t = (sel) => document.querySelector(sel)?.textContent?.trim() || '';

      // —— 抖音 web 主页 ——
      // 真实 DOM：<h1 data-e2e="user-info-nickname"> 或 .nickname-xxx
      // SSR 数据：<script id="RENDER_DATA"> 内 urlencode 后的 JSON，含 nickname/follower_count
      let author = '', bio = '', followers = 0, videoCount = 0, avatar = '';

      if (plat === 'douyin') {
        author = t('[data-e2e="user-info-nickname"]')
          || t('[data-e2e="user-detail-nickname"]')
          || t('h1.j5WZzJdp')   // 抖音随机 class
          || t('h1');
        bio = t('[data-e2e="user-info-desc"]') || t('[class*="signature"]') || '';
        const fansEl = document.querySelector('[data-e2e="user-fans"]') || document.querySelector('[data-e2e="user-info-fans"]');
        if (fansEl) {
          const txt = fansEl.textContent || '';
          const num = txt.match(/([\d.]+)\s*([万亿wWk])?/);
          if (num) {
            let n = parseFloat(num[1]);
            if (num[2] === '万' || num[2] === 'w' || num[2] === 'W') n *= 10000;
            if (num[2] === '亿') n *= 100000000;
            if (num[2] === 'k' || num[2] === 'K') n *= 1000;
            followers = Math.round(n);
          }
        }
        const works = document.querySelector('[data-e2e="user-tab-work-count"]');
        if (works) videoCount = parseInt(works.textContent.replace(/[^\d]/g, '') || '0', 10);
        const avatarEl = document.querySelector('[data-e2e="user-avatar"] img') || document.querySelector('img[class*="avatar"]');
        if (avatarEl) avatar = avatarEl.src || '';

        // 兜底：从 SSR RENDER_DATA 提取
        if (!author || !followers) {
          try {
            const rd = document.querySelector('#RENDER_DATA');
            if (rd?.textContent) {
              const decoded = decodeURIComponent(rd.textContent);
              const m1 = decoded.match(/"nickname"\s*:\s*"([^"]{1,40})"/);
              const m2 = decoded.match(/"follower_count"\s*:\s*(\d+)/);
              const m3 = decoded.match(/"signature"\s*:\s*"([^"]{1,200})"/);
              const m4 = decoded.match(/"aweme_count"\s*:\s*(\d+)/);
              if (m1 && !author) author = m1[1];
              if (m2 && !followers) followers = parseInt(m2[1], 10);
              if (m3 && !bio) bio = m3[1];
              if (m4 && !videoCount) videoCount = parseInt(m4[1], 10);
            }
          } catch {}
        }
      } else if (plat === 'xiaohongshu') {
        author = t('.user-name') || t('.nickname') || t('[class*="UserName"]') || t('h1');
        bio = t('.user-desc') || t('.desc') || '';
        const fansEl = document.querySelector('.fans .count, [class*="fans"] [class*="count"]');
        if (fansEl) followers = parseInt(fansEl.textContent.replace(/[^\d]/g, '') || '0', 10);
      } else if (plat === 'bilibili') {
        author = t('#h-name') || t('.h-name') || t('.nickname');
        bio = t('#h-sign') || t('.sign');
      } else if (plat === 'kuaishou') {
        author = t('.user-name') || t('h1') || t('[class*="userName"]');
      }

      // 终极兜底：用任意 h1 或 title（但禁掉技术 token 名）
      if (!author) {
        const h = document.querySelector('h1');
        const cand = h?.textContent?.trim() || '';
        if (cand && !/^[a-z_]+$|perf_timing|middleware|webpack|chunk|navigator/i.test(cand)) {
          author = cand;
        }
      }

      return { author, bio, followers, videoCount, avatar };
    }, platform);

    const videos = [...collected].slice(0, maxVideos).map(id => ({
      id, url: VIDEO_BASE[platform] ? VIDEO_BASE[platform](id) : id,
    }));

    console.log(`[crawlAuthor] ${platform} 拿到 ${videos.length} 个视频，作者=${meta.author}, 粉丝=${meta.followers}`);
    return { ...meta, videos, html: finalHtml, currentUrl: page.url() };
  } finally {
    await browser.close();
  }
}

module.exports = {
  PLATFORMS,
  getLoginStatus,
  startLogin,
  pollLoginStatus,
  cancelLogin,
  logout,
  fetchWithCookies,
  crawlAuthorVideos,
  hasCookies,
  loadCookies,
  findChromePath
};
