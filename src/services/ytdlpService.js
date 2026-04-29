/**
 * yt-dlp 包装 — 用于抖音/快手等平台抓博主全量视频列表
 * 服务器端用 /usr/local/bin/yt-dlp（pip 装），开发机可以 npm i -g yt-dlp 或直接装 pip
 *
 * 不下载视频本体，只用 --flat-playlist 拿元数据 JSON
 */
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

function _findYtdlp() {
  const cands = [
    process.env.YT_DLP_PATH,
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    'yt-dlp', // 让 PATH 解析
  ].filter(Boolean);
  for (const p of cands) {
    if (p === 'yt-dlp') return p; // 留给 PATH
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

function isAvailable() {
  return !!_findYtdlp();
}

/**
 * 拿用户主页的视频列表
 * @param {string} userUrl 博主主页（抖音 https://www.douyin.com/user/MS4w...）
 * @param {object} opts
 * @param {string} [opts.cookieFile]  cookie 文件路径（Netscape 格式）
 * @param {number} [opts.limit=0]     0=不限
 * @param {number} [opts.timeout=120000]
 * @returns {Promise<Array<{id,title,uploader,uploader_id,thumbnail,duration,view_count,like_count,upload_date,url}>>}
 */
async function fetchUserVideos(userUrl, opts = {}) {
  const ytdlp = _findYtdlp();
  if (!ytdlp) throw new Error('yt-dlp 未安装（pip3 install yt-dlp 或设 YT_DLP_PATH 环境变量）');

  const args = ['--flat-playlist', '-j', '--no-download', '--no-warnings', '--no-check-certificate'];
  if (opts.cookieFile && fs.existsSync(opts.cookieFile)) {
    args.push('--cookies', opts.cookieFile);
  }
  if (opts.limit && opts.limit > 0) {
    args.push('--playlist-end', String(opts.limit));
  }
  args.push(userUrl);

  return new Promise((resolve, reject) => {
    execFile(ytdlp, args, { maxBuffer: 50 * 1024 * 1024, timeout: opts.timeout || 120000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').slice(0, 400);
        if (/login|cookies?\s+expired|400 Client Error|403/i.test(msg)) {
          return reject(new Error('需要登录 cookie：去「平台账号绑定」扫码 → 自动导出 cookie 后再试'));
        }
        return reject(new Error('yt-dlp 失败: ' + msg));
      }
      const lines = String(stdout || '').trim().split('\n').filter(Boolean);
      const videos = [];
      for (const line of lines) {
        try {
          const d = JSON.parse(line);
          videos.push({
            id: d.id || '',
            title: d.title || '',
            uploader: d.uploader || d.channel || '',
            uploader_id: d.uploader_id || d.channel_id || '',
            thumbnail: d.thumbnail || '',
            duration: d.duration || 0,
            view_count: d.view_count || 0,
            like_count: d.like_count || 0,
            comment_count: d.comment_count || 0,
            upload_date: d.upload_date || '',
            url: d.webpage_url || d.url || '',
          });
        } catch {}
      }
      resolve(videos);
    });
  });
}

/**
 * 把 puppeteer cookies (JSON 格式) 转成 yt-dlp 需要的 Netscape 格式
 *  - puppeteer cookie: { name, value, domain, path, expires, httpOnly, secure }
 *  - Netscape: domain  TRUE/FALSE  path  TRUE/FALSE  expires  name  value
 */
function puppeteerCookiesToNetscape(cookies, outputFile) {
  const lines = ['# Netscape HTTP Cookie File', '# Auto-converted from puppeteer cookies', ''];
  for (const c of cookies || []) {
    const domain = c.domain || '';
    const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const exp = c.expires && c.expires > 0 ? Math.round(c.expires) : 0;
    const sec = c.secure ? 'TRUE' : 'FALSE';
    lines.push([domain, flag, c.path || '/', sec, exp, c.name, c.value].join('\t'));
  }
  fs.writeFileSync(outputFile, lines.join('\n'), 'utf8');
  return outputFile;
}

// ═══════════════════════════════════════════════════════════════════════════
// 无登录 visitor cookie 预热（puppeteer 访问平台首页拿匿名 token）
// ═══════════════════════════════════════════════════════════════════════════
//
// 抖音 web 现在所有接口都要 cookie 验证（__ac_nonce / ttwid / s_v_web_id 等），
// 不带 cookie 直接 curl/yt-dlp 都被反爬拦截。
//
// 这个函数：
//   1. 检查是否已有该平台的 visitor cookie 文件 + 是否过期（默认 30 分钟）
//   2. 没有则用 puppeteer 跑无头浏览器访问 platform 首页，等几秒让网站设置 cookie
//   3. 把拿到的 cookies 转 Netscape 格式存到 outputs/cookies/{platform}_visitor.txt
//   4. 返回该 cookie 文件路径供 yt-dlp 使用
//
// 注：visitor cookie 时效短（抖音通常 1 小时），且不能拿登录态独占数据，
//     但能让 yt-dlp 拿到公开数据（视频元数据/作者信息），免扫码可用。
// ═══════════════════════════════════════════════════════════════════════════

const VISITOR_HOMES = {
  douyin: 'https://www.douyin.com/',
  xiaohongshu: 'https://www.xiaohongshu.com/explore',
  kuaishou: 'https://www.kuaishou.com/',
  bilibili: 'https://www.bilibili.com/',
};
const VISITOR_TTL_MS = 30 * 60 * 1000; // 30 分钟内复用同一 visitor cookie

function _visitorCookiePath(platform) {
  const dir = path.resolve(process.env.OUTPUT_DIR || './outputs', 'cookies');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${platform}_visitor.txt`);
}

/**
 * 确保有可用 visitor cookie。如已存在且未过期则复用，否则用 puppeteer 重新拿一次。
 * @param {string} platform 'douyin' | 'xiaohongshu' | 'kuaishou' | 'bilibili'
 * @param {object} [opts] { force: boolean — 强制刷新；ttlMs: 自定义过期时间 }
 * @returns {Promise<string>} Netscape 格式的 cookie 文件路径
 */
async function ensureVisitorCookie(platform, opts = {}) {
  if (!VISITOR_HOMES[platform]) throw new Error('不支持 visitor 预热：' + platform);
  const file = _visitorCookiePath(platform);
  const ttl = opts.ttlMs || VISITOR_TTL_MS;

  // 复用未过期的
  if (!opts.force && fs.existsSync(file)) {
    const age = Date.now() - fs.statSync(file).mtimeMs;
    if (age < ttl) {
      console.log(`[ytdlp:visitor] ${platform} 复用现有 visitor cookie（${Math.round(age/1000)}s 前生成）`);
      return file;
    }
  }

  // 用 puppeteer 跑一次拿 cookie
  const puppeteer = require('puppeteer-core');
  let chromePath;
  try {
    const browserService = require('./browserService');
    chromePath = browserService.findChromePath();
  } catch {}
  if (!chromePath) throw new Error('未找到 Chrome/Chromium，无法预热 visitor cookie');

  console.log(`[ytdlp:visitor] ${platform} 启动 puppeteer 预热 visitor cookie...`);
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
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    // 访问首页，让网站 set cookie
    try {
      await page.goto(VISITOR_HOMES[platform], { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch (e) {
      console.warn(`[ytdlp:visitor] ${platform} 主导航超时但继续:`, e.message);
    }
    // 等 5s 让 SPA 完成第一波 fingerprint + 反爬 token 写入
    await new Promise(r => setTimeout(r, 5000));
    // 滚动一下触发更多 cookie（抖音的 ttwid/s_v_web_id 可能延迟写入）
    try { await page.evaluate('window.scrollBy(0, 300)'); await new Promise(r => setTimeout(r, 1500)); } catch {}

    const cookies = await page.cookies();
    if (!cookies || cookies.length === 0) {
      throw new Error('puppeteer 没拿到任何 cookie（可能反爬墙拦截）');
    }
    puppeteerCookiesToNetscape(cookies, file);
    console.log(`[ytdlp:visitor] ${platform} 拿到 ${cookies.length} 条 visitor cookie → ${file}`);
    return file;
  } finally {
    try { await browser.close(); } catch {}
  }
}

/**
 * 智能拿 cookie：优先扫码登录的 cookie，其次预热 visitor cookie
 * @param {string} platform
 * @returns {Promise<string|null>} Netscape cookie 文件路径
 */
async function getBestCookieFile(platform) {
  // 1. 已扫码登录的 cookie 优先
  try {
    const browserService = require('./browserService');
    if (browserService.hasCookies(platform)) {
      const loggedInCookies = browserService.loadCookies(platform);
      if (loggedInCookies && loggedInCookies.length) {
        const file = path.resolve(process.env.OUTPUT_DIR || './outputs', 'cookies', `${platform}_yt_dlp.txt`);
        puppeteerCookiesToNetscape(loggedInCookies, file);
        return file;
      }
    }
  } catch {}
  // 2. 回退到匿名 visitor cookie（自动预热）
  try {
    return await ensureVisitorCookie(platform);
  } catch (e) {
    console.warn(`[ytdlp] visitor cookie 预热失败:`, e.message);
    return null;
  }
}

module.exports = {
  isAvailable,
  fetchUserVideos,
  puppeteerCookiesToNetscape,
  ensureVisitorCookie,
  getBestCookieFile,
  _findYtdlp,
};
