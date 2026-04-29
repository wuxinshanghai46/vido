// 在远端 /opt/vido/app 目录里跑 puppeteer 启动测试
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;

function connect() {
  return new Promise((res, rej) => {
    const c = new Client();
    c.on('ready', () => res(c)).on('error', rej);
    c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 });
  });
}
function exec(c, cmd, label) {
  console.log('\n──', label || cmd.slice(0, 80));
  return new Promise(res => {
    c.exec(cmd, (e, stream) => {
      if (e) return res(e.message);
      let out = '';
      stream.on('data', d => { const s = d.toString(); out += s; process.stdout.write(s); });
      stream.stderr.on('data', d => { const s = d.toString(); out += s; process.stdout.write(s); });
      stream.on('close', () => res(out));
    });
  });
}

(async () => {
  const c = await connect();
  // 把 probe 脚本放进 /opt/vido/app/scripts 目录里跑
  const probeBody = `
const puppeteer = require('puppeteer-core');
(async () => {
  try {
    const b = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser',
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
      timeout: 30000,
    });
    const v = await b.version();
    const page = await b.newPage();
    await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => console.log('  page.goto fail (可能正常):', e.message.slice(0,80)));
    const title = await page.title().catch(()=>'');
    await b.close();
    console.log('OK puppeteer-core 启动成功');
    console.log('  version:', v);
    console.log('  test page title:', title.slice(0, 80));
    process.exit(0);
  } catch (e) {
    console.log('FAIL', e.message);
    process.exit(1);
  }
})();
`.trim();
  // 写到 app 目录下，确保能 require puppeteer-core
  const wrap = `cat > /opt/vido/app/scripts/_probe-chrome.js <<'EOF'\n${probeBody}\nEOF\ncd /opt/vido/app && node scripts/_probe-chrome.js 2>&1 | tail -30`;
  await exec(c, wrap, 'puppeteer 启动 + 打开 bilibili 测试');
  await exec(c, 'rm -f /opt/vido/app/scripts/_probe-chrome.js', '清理 probe');
  c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
