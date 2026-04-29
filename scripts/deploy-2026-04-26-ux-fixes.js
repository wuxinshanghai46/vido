// Deploy 2026-04-26: 5 项 UX 修复
//   1. 移除 login.html (统一首页登录弹窗)
//   2. 选中用这个按钮文字平铺
//   3. AI 写稿弹窗修复 (HTML 缺闭合 div)
//   4. 声音克隆 Tab 切换
//   5. 我的形象 图片素材/视频素材 Tab
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const FILES = [
  'src/server.js',
  'public/digital-human.html',
  'public/js/digital-human.js',
  'public/css/digital-human-wizard.css',
  'public/js/auth.js',
  'public/js/app.js',
  'public/js/home.js',
  'public/js/workflow.js',
];
const REMOTE_DELETE = ['/opt/vido/app/public/login.html'];
const REPO = path.resolve(__dirname, '..');

function connect() {
  return new Promise((res, rej) => {
    const c = new Client();
    c.on('ready', () => res(c)).on('error', rej);
    c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 });
  });
}
function sftpOpen(c) { return new Promise((res, rej) => c.sftp((e, s) => e ? rej(e) : res(s))); }
function up(s, l, r) { return new Promise((res, rej) => s.fastPut(l, r, e => e ? rej(e) : res())); }
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
  if (!HOST || !PASSWORD) { console.error('请设置 VIDO_DEPLOY_HOST 和 VIDO_DEPLOY_PASSWORD'); process.exit(1); }
  console.log('[deploy] 连接', HOST);
  const c = await connect();
  const sftp = await sftpOpen(c);

  console.log('[deploy] 上传文件:');
  for (const rel of FILES) {
    const local = path.join(REPO, rel);
    if (!fs.existsSync(local)) { console.log('  skip (本地不存在)', rel); continue; }
    const remote = path.posix.join('/opt/vido/app', rel.split(path.sep).join('/'));
    try {
      await up(sftp, local, remote);
      console.log('  ✓', rel, fs.statSync(local).size, 'bytes →', remote);
    } catch (e) {
      console.log('  ✗', rel, e.message);
    }
  }

  console.log('[deploy] 删除远端旧文件:');
  for (const f of REMOTE_DELETE) {
    const out = (await exec(c, `rm -f ${f} && echo deleted-${f}`)).trim();
    console.log('  ' + out);
  }

  console.log('[deploy] 重启 PM2:');
  console.log((await exec(c, 'pm2 reload vido --update-env 2>&1')).trim());
  await new Promise(r => setTimeout(r, 1500));

  console.log('[deploy] 健康检查:');
  console.log((await exec(c, 'curl -s -o /dev/null -w "health=%{http_code}\\n" http://127.0.0.1:4600/api/health')).trim());
  console.log((await exec(c, 'curl -s -o /dev/null -w "login_redirect=%{http_code} loc=%{redirect_url}\\n" http://127.0.0.1:4600/login.html')).trim());
  console.log((await exec(c, 'curl -s -o /dev/null -w "home=%{http_code}\\n" http://127.0.0.1:4600/')).trim());

  c.end();
  console.log('[deploy] ✅ 完成');
})().catch(e => { console.error('[deploy] FATAL', e.message); process.exit(1); });
