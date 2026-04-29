// 升级服务器 yt-dlp 到最新 standalone 二进制（绕过 CentOS 7 + Python 3.6 限制）
// 下载 GitHub release: yt-dlp_linux（PyInstaller 单文件，自带 Python runtime）
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;

function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)).on('error', rej); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function exec(c, cmd, label, timeout = 120000) {
  console.log('\n──', label || cmd.slice(0, 80));
  return new Promise(res => {
    const t = setTimeout(() => res({ code: -1, out: 'TIMEOUT' }), timeout);
    c.exec(cmd, (e, st) => {
      if (e) { clearTimeout(t); return res({ code: -1, out: e.message }); }
      let out = '';
      st.on('data', d => { const s = d.toString(); out += s; process.stdout.write(s); });
      st.stderr.on('data', d => { const s = d.toString(); out += s; process.stdout.write(s); });
      st.on('close', (code) => { clearTimeout(t); res({ code, out }); });
    });
  });
}

(async () => {
  if (!HOST || !PASSWORD) { console.error('缺 env'); process.exit(1); }
  const c = await connect();

  // 1) 显示当前版本
  await exec(c, 'yt-dlp --version 2>&1 | head -1; which yt-dlp', '升级前版本');

  // 2) 备份 pip 装的旧版
  await exec(c, 'mv /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp.pip-old 2>&1 || true', '备份旧版');

  // 3) 下载 standalone 二进制（GitHub releases 直链）
  //    选择走 ghproxy/mirror 都失败的话试下面镜像
  const downloads = [
    'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
    'https://ghp.ci/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
    'https://mirror.ghproxy.com/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
  ];
  let downloaded = false;
  for (const url of downloads) {
    console.log('\n[try] 下载', url);
    const r = await exec(c, `curl -fL --connect-timeout 15 --max-time 90 -o /tmp/yt-dlp_linux "${url}" -w "  http=%{http_code} size=%{size_download} time=%{time_total}s\\n" 2>&1 | tail -5`, '', 100000);
    if (/http=200/.test(r.out)) { downloaded = true; break; }
  }
  if (!downloaded) {
    console.error('[fail] 三个源全部下载失败');
    c.end();
    process.exit(1);
  }

  // 4) 安装 + 赋可执行权限
  await exec(c, 'install -m 755 /tmp/yt-dlp_linux /usr/local/bin/yt-dlp && rm -f /tmp/yt-dlp_linux', '安装新版');

  // 5) 验证
  const r = await exec(c, 'yt-dlp --version 2>&1; which yt-dlp; ls -la /usr/local/bin/yt-dlp', '升级后版本');
  if (!/^\d{4}\.\d/.test(r.out.trim())) {
    // 标准 yt-dlp 版本是 2024.xx.xx 这种格式
    console.warn('[warn] 版本输出可疑，可能 binary 启动失败（CentOS 7 glibc 太旧？）');
    await exec(c, '/usr/local/bin/yt-dlp 2>&1 | head -10', '直接调用看错误');
  }

  // 6) PM2 reload 让 vido 用新 yt-dlp（其实不需要，subprocess 每次都新拉）
  await exec(c, 'pm2 reload vido --update-env 2>&1 | tail -3', '重启 vido');

  c.end();
  console.log('\n[done] yt-dlp 升级流程结束');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
