// 在远端 CentOS 7 安装 Chromium for puppeteer-core
// 策略：先试 EPEL 的 chromium；失败则退到旧版 Google Chrome（CentOS 7 glibc 2.17 兼容版）
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
  console.log('\n──', label || cmd);
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
  console.log('[install] 连接', HOST);
  const c = await connect();

  // 1) 先确认 EPEL 是否已开
  await exec(c, 'rpm -q epel-release 2>&1 || yum install -y epel-release 2>&1 | tail -10', '确保 EPEL 仓库');

  // 2) CentOS 7 EOL → mirror 切到 vault（避免 404）
  await exec(c, "if grep -q 'mirror.centos.org' /etc/yum.repos.d/CentOS-Base.repo 2>/dev/null; then sed -i.bak 's|^mirrorlist=|#mirrorlist=|g; s|^#baseurl=http://mirror.centos.org|baseurl=http://vault.centos.org|g' /etc/yum.repos.d/CentOS-Base.repo; echo 'CentOS repo 已切到 vault'; else echo 'CentOS repo 已是 vault 或自定义'; fi", "切换 CentOS 仓库到 vault");

  // 3) 装 chromium
  const r1 = await exec(c, 'yum install -y chromium 2>&1 | tail -30', '尝试 yum install chromium');

  // 4) 检查
  const r2 = await exec(c, 'which chromium-browser chromium 2>&1; chromium-browser --version 2>&1 || chromium --version 2>&1', '验证 chromium');

  // 5) 如失败 → 走 Google Chrome 109 旧版（CentOS 7 兼容版）
  if (!/chromium/i.test(r2.out) || /no chromium/i.test(r2.out)) {
    console.log('\n[install] EPEL chromium 失败，尝试 Google Chrome 109 RPM ...');
    await exec(c, 'curl -fsSL -o /tmp/chrome109.rpm https://dl.google.com/linux/chrome/rpm/stable/x86_64/google-chrome-stable-109.0.5414.119-1.x86_64.rpm 2>&1 | tail -5', '下载 chrome 109 rpm');
    await exec(c, 'yum install -y /tmp/chrome109.rpm 2>&1 | tail -20', '安装 chrome 109');
    await exec(c, 'which google-chrome 2>&1; google-chrome --version 2>&1', '验证 google-chrome');
  }

  // 6) 装运行所需的常见依赖（最小集，避免缺 nss/at-spi 等启动失败）
  await exec(c, 'yum install -y -q nss alsa-lib atk at-spi2-atk cups-libs gtk3 libdrm libgbm libXcomposite libXdamage libXfixes libxkbcommon mesa-libgbm 2>&1 | tail -5', '装 puppeteer 必需运行依赖');

  // 7) 最终路径报告 + 把找到的路径建议写到 .env
  const final = await exec(c, 'for p in /usr/bin/chromium-browser /usr/bin/chromium /usr/bin/google-chrome /usr/bin/google-chrome-stable; do if [ -x "$p" ]; then echo "FOUND $p"; "$p" --version 2>&1 | head -1; fi; done', '最终探测');

  c.end();
  console.log('\n[install] 完成。如有 FOUND xxx 行，下一步把该路径写入 /opt/vido/app/.env 的 CHROME_PATH，并 pm2 reload vido');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
