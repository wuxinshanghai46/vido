// 真实测试：服务器 chromium 访问 sso.douyin.com 拿 console error
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)).on('error', rej); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function exec(c, cmd, label) {
  console.log('\n──', label || cmd.slice(0, 80));
  return new Promise(res => { c.exec(cmd, (e, st) => { if (e) return res(e.message); let o=''; st.on('data',d=>{o+=d;process.stdout.write(d.toString())}); st.stderr.on('data',d=>{o+=d;process.stdout.write(d.toString())}); st.on('close',()=>res(o)); }); });
}
(async () => {
  const c = await connect();
  // curl 测三个域名
  await exec(c, 'curl -sS -o /dev/null --max-time 10 -w "  douyin.com: http=%{http_code} ip=%{remote_ip}\\n" https://www.douyin.com/', '');
  await exec(c, 'curl -sS -o /dev/null --max-time 10 -w "  sso.douyin: http=%{http_code} ip=%{remote_ip}\\n" "https://sso.douyin.com/passport/web/account/info/self/?aid=6383"', '');
  await exec(c, 'curl -sS -o /dev/null --max-time 10 -w "  passport.douyin: http=%{http_code} ip=%{remote_ip}\\n" https://passport.douyin.com/', '');

  // puppeteer 实测
  const probe = `cd /opt/vido/app && node -e "(async () => {
    const puppeteer = require('puppeteer-core');
    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser',
      headless: 'new',
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-proxy-server','--proxy-bypass-list=*','--disable-features=IsolateOrigins,site-per-process','--ignore-certificate-errors','--lang=zh-CN'],
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
    page.on('requestfailed', req => console.log('[req-fail]', req.url(), '|', req.failure()?.errorText));
    page.on('response', r => { if (r.status() >= 400) console.log('[bad-resp]', r.status(), r.url()); });
    let resultUrl = '';
    let errMsg = '';
    try {
      const r = await page.goto('https://sso.douyin.com/passport/web/account/info/self/?aid=6383', { waitUntil: 'domcontentloaded', timeout: 25000 });
      resultUrl = page.url();
      console.log('OK 最终 URL:', resultUrl, ' status:', r?.status());
    } catch (e) { errMsg = e.message; console.log('FAIL:', errMsg); }
    // 截 url + body 提取关键文字
    try {
      const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 400) || '');
      console.log('页面文字摘要:', txt);
    } catch {}
    await browser.close();
  })().catch(e => console.error('FATAL:', e.message));" 2>&1 | tail -40`;
  await exec(c, probe, 'puppeteer 实测 sso.douyin.com');

  c.end();
})().catch(e => console.error(e.message));
