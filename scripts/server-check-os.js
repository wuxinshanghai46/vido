// 探测远端服务器 OS 类型 + 是否已装 Chrome/Chromium
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
function exec(c, cmd) {
  return new Promise(res => {
    c.exec(cmd, (e, stream) => {
      if (e) return res(e.message);
      let o = ''; stream.on('data', d => o += d); stream.stderr.on('data', d => o += d);
      stream.on('close', () => res(o));
    });
  });
}

(async () => {
  if (!HOST || !PASSWORD) { console.error('缺 env'); process.exit(1); }
  console.log('[probe] 连接', HOST);
  const c = await connect();
  const cmds = [
    ['OS 信息', 'cat /etc/os-release | head -5'],
    ['内核', 'uname -a'],
    ['Chrome 是否已装', 'which google-chrome google-chrome-stable chromium chromium-browser 2>&1; ls /usr/bin/*chrome* /usr/bin/*chromium* 2>/dev/null'],
    ['Chrome 版本（如有）', 'google-chrome --version 2>&1; chromium --version 2>&1; chromium-browser --version 2>&1'],
    ['Node 版本', 'node -v'],
    ['PM2 运行中', 'pm2 ls 2>&1 | head -8'],
    ['磁盘空间', 'df -h / | tail -1'],
    ['已装中文字体（puppeteer 渲染需要）', 'fc-list :lang=zh 2>&1 | head -3'],
  ];
  for (const [label, cmd] of cmds) {
    console.log('\n──', label);
    console.log((await exec(c, cmd)).trim());
  }
  c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
