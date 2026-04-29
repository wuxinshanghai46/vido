// Deploy 2026-04-26: Radar/搜索/扫码/博主抓取/TTS/字幕 一揽子改动
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;

const FILES = [
  // 后端
  'src/services/browserService.js',
  'src/services/searchProviders/index.js',
  'src/services/searchProviders/bilibiliPopular.js',
  'src/services/searchProviders/douyinHeadless.js',
  'src/services/searchProviders/xiaohongshuHeadless.js',
  'src/services/ttsService.js',
  'src/services/radarService.js',
  'src/routes/radar.js',
  'src/routes/browser.js',
  'src/routes/avatar.js',
  'src/routes/digitalHuman.js',
  'src/routes/workbench.js',
  'src/server.js',
  // 前端
  'public/replicate.html',
  'public/digital-human.html',
  'public/js/digital-human.js',
  'public/js/app.js',
  'public/js/auth.js',
  'public/js/home.js',
  'public/js/workflow.js',
  'public/css/digital-human.css',
  'public/css/digital-human-wizard.css',
  // MCP
  'MCP/media-crawler/index.js',
  // 配置
  'outputs/search_providers.json',
];
const REMOTE_DELETE = ['/opt/vido/app/public/login.html'];
const REPO = path.resolve(__dirname, '..');

function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)).on('error', rej); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function sftpOpen(c) { return new Promise((res, rej) => c.sftp((e, s) => e ? rej(e) : res(s))); }
function up(s, l, r) { return new Promise((res, rej) => s.fastPut(l, r, e => e ? rej(e) : res())); }
function exec(c, cmd) { return new Promise(res => { c.exec(cmd, (e, st) => { if (e) return res(e.message); let o=''; st.on('data',d=>o+=d); st.stderr.on('data',d=>o+=d); st.on('close',()=>res(o)); }); }); }
function mkdirP(s, dir) {
  return new Promise(res => {
    s.mkdir(dir, e => res()); // 若已存在会报错，忽略
  });
}

(async () => {
  if (!HOST || !PASSWORD) { console.error('缺 env'); process.exit(1); }
  console.log('[deploy] 连接', HOST);
  const c = await connect();
  const sftp = await sftpOpen(c);

  // 确保所有上传目录存在
  const dirsToEnsure = new Set();
  FILES.forEach(rel => {
    const dir = path.posix.dirname(rel.split(path.sep).join('/'));
    let cur = '';
    dir.split('/').forEach(p => { cur = cur ? cur + '/' + p : p; dirsToEnsure.add('/opt/vido/app/' + cur); });
  });
  for (const d of dirsToEnsure) { await mkdirP(sftp, d); }

  console.log('[deploy] 上传文件:');
  let okCnt = 0, skipCnt = 0, failCnt = 0;
  for (const rel of FILES) {
    const local = path.join(REPO, rel);
    if (!fs.existsSync(local)) { console.log('  skip', rel); skipCnt++; continue; }
    const remote = path.posix.join('/opt/vido/app', rel.split(path.sep).join('/'));
    try {
      await up(sftp, local, remote);
      console.log('  ✓', rel, fs.statSync(local).size, 'bytes');
      okCnt++;
    } catch (e) {
      console.log('  ✗', rel, e.message);
      failCnt++;
    }
  }
  console.log(`[deploy] 上传统计: ✓${okCnt} ✗${failCnt} skip${skipCnt}`);

  console.log('\n[deploy] 删除远端旧文件:');
  for (const f of REMOTE_DELETE) {
    const out = (await exec(c, `rm -f ${f} && echo deleted-${f}`)).trim();
    console.log('  ' + out);
  }

  console.log('\n[deploy] 重启 PM2 vido:');
  console.log((await exec(c, 'pm2 reload vido --update-env 2>&1')).trim());

  await new Promise(r => setTimeout(r, 2000));
  console.log('\n[deploy] 健康检查:');
  console.log((await exec(c, 'curl -s -o /dev/null -w "health=%{http_code}\\n" http://127.0.0.1:4600/api/health')).trim());
  console.log((await exec(c, 'curl -s -o /dev/null -w "browser-status=%{http_code}\\n" http://127.0.0.1:4600/api/browser/status')).trim());

  // PM2 日志最新几行
  console.log('\n[deploy] PM2 最新日志（看 MCP 是否加载新版）:');
  console.log((await exec(c, 'pm2 logs vido --lines 12 --nostream 2>&1 | tail -20')).trim());

  c.end();
  console.log('\n[deploy] ✅ 完成');
})().catch(e => { console.error('[deploy] FATAL', e.message); process.exit(1); });
