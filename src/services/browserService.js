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
    loginUrl: 'https://sso.douyin.com/passport/web/account/info/self/?aid=6383',
    afterNav: async (page) => {
      // SSO 页面会自动跳转到扫码登录或已登录页面
      await new Promise(r => setTimeout(r, 5000));
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
    afterNav: async (page) => {
      await new Promise(r => setTimeout(r, 3000));
      // 小红书会弹出登录框，尝试点击
      try {
        const loginBtn = await page.$('.login-btn') || await page.$('[class*="LoginBtn"]') || await page.$('[class*="login-container"]');
        if (loginBtn) await loginBtn.click();
        await new Promise(r => setTimeout(r, 3000));
        // 切到扫码登录tab
        const qrTab = await page.$('[class*="qrcode"]') || await page.$('span:has-text("扫码登录")');
        if (qrTab) await qrTab.click();
        await new Promise(r => setTimeout(r, 2000));
      } catch {}
    },
    checkLogin: async (page) => {
      try {
        const cookies = await page.cookies();
        return cookies.some(c => c.name === 'customer-sso-sid' || c.name === 'xhsTrackerId');
      } catch { return false; }
    }
  },
  kuaishou: {
    name: '快手',
    loginUrl: 'https://passport.kuaishou.com/pc/account/login?sid=kuaishou.web.cp.api',
    afterNav: async (page) => {
      await new Promise(r => setTimeout(r, 5000));
    },
    checkLogin: async (page) => {
      try {
        const cookies = await page.cookies();
        return cookies.some(c => c.name === 'userId' || c.name === 'kuaishou.web.cp.api_st');
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

function saveCookies(platform, cookies) {
  fs.writeFileSync(getCookiePath(platform), JSON.stringify(cookies, null, 2));
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
    result[id] = {
      name: info.name,
      loggedIn: hasCookies(id),
      cookieAge: null
    };
    if (hasCookies(id)) {
      try {
        const stat = fs.statSync(getCookiePath(id));
        result[id].cookieAge = Date.now() - stat.mtimeMs;
      } catch {}
    }
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
async function startLogin(platform) {
  if (!PLATFORMS[platform]) throw new Error(`不支持的平台: ${platform}`);

  // 清理旧会话
  if (activeSessions[platform]) {
    try { await activeSessions[platform].browser.close(); } catch {}
    delete activeSessions[platform];
  }

  const puppeteer = require('puppeteer-core');
  const chromePath = findChromePath();
  if (!chromePath) throw new Error('未找到 Chrome/Chromium，请安装 Google Chrome');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,720'
    ],
    defaultViewport: { width: 1280, height: 720 }
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // 加载已有 cookie（可能已过期但仍有部分状态）
  const oldCookies = loadCookies(platform);
  if (oldCookies) {
    try { await page.setCookie(...oldCookies); } catch {}
  }

  await page.goto(PLATFORMS[platform].loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  // 平台特定：点击登录按钮等
  if (PLATFORMS[platform].afterNav) {
    await PLATFORMS[platform].afterNav(page);
  } else {
    await new Promise(r => setTimeout(r, 3000));
  }

  // 截图
  const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 });

  activeSessions[platform] = { browser, page, status: 'waiting' };
  console.log(`[Browser] ${PLATFORMS[platform].name} 登录页面已打开，等待扫码...`);

  return screenshot;
}

/**
 * 轮询登录状态 — 检查是否已登录并截图
 */
async function pollLoginStatus(platform) {
  const session = activeSessions[platform];
  if (!session) return { status: 'expired', message: '会话已过期' };

  try {
    const { page } = session;
    const loggedIn = await PLATFORMS[platform].checkLogin(page);

    if (loggedIn) {
      // 保存 cookies
      const cookies = await page.cookies();
      saveCookies(platform, cookies);
      session.status = 'success';

      // 截图确认
      const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 });

      // 关闭浏览器
      try { await session.browser.close(); } catch {}
      delete activeSessions[platform];

      console.log(`[Browser] ${PLATFORMS[platform].name} 登录成功，已保存 ${cookies.length} 个 cookie`);
      return { status: 'success', message: '登录成功', screenshot };
    }

    // 未登录，返回当前截图
    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 });
    return { status: 'waiting', message: '等待扫码...', screenshot };
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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setCookie(...cookies);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    const html = await page.content();
    const title = await page.title();

    return { html, title, url: page.url() };
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
  hasCookies,
  loadCookies,
  findChromePath
};
