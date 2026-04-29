// 把 CHROME_PATH 写入服务器 .env，重启 PM2，并跑一次 puppeteer 启动测试
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const CHROME = '/usr/bin/chromium-browser';

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
      if (e) { console.log('ERR', e.message); return res({ code: -1, out: e.message }); }
      let out = '';
      stream.on('data', d => { const s = d.toString(); out += s; process.stdout.write(s); });
      stream.stderr.on('data', d => { const s = d.toString(); out += s; process.stdout.write(s); });
      stream.on('close', (code) => res({ code, out }));
    });
  });
}

(async () => {
  if (!HOST || !PASSWORD) { console.error('缺 env'); process.exit(1); }
  console.log('[chrome-path] 连接', HOST);
  const c = await connect();

  // 1) 看现有 .env 有没有 CHROME_PATH
  await exec(c, 'grep -n CHROME_PATH /opt/vido/app/.env 2>&1 | head -3', '现有 CHROME_PATH');

  // 2) 删掉旧的 + 追加新的
  await exec(c, `sed -i '/^CHROME_PATH=/d' /opt/vido/app/.env && echo 'CHROME_PATH=${CHROME}' >> /opt/vido/app/.env && tail -3 /opt/vido/app/.env`, '更新 .env');

  // 3) Puppeteer 启动测试（不启浏览器，只调一次 launch+close）
  const probe = `cd /opt/vido/app && cat > /tmp/probe-chrome.js <<'EOF'
const puppeteer = require('puppeteer-core');
(async () => {
  try {
    const b = await puppeteer.launch({
      executablePath: '${CHROME}',
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
      timeout: 25000,
    });
    const v = await b.version();
    await b.close();
    console.log('OK puppeteer launch 成功:', v);
  } catch (e) {
    console.log('FAIL', e.message);
  }
})();
EOF
node /tmp/probe-chrome.js 2>&1 | tail -5`;
  await exec(c, probe, 'puppeteer 启动测试');

  // 4) 重启 vido
  await exec(c, 'pm2 reload vido --update-env 2>&1 | tail -5', '重启 vido');
  await new Promise(r => setTimeout(r, 1500));
  await exec(c, 'curl -s -o /dev/null -w "health=%{http_code}\\n" http://127.0.0.1:4600/api/health', '健康检查');

  c.end();
  console.log('\n[chrome-path] ✅ 完成');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
