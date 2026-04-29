const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const FILES = [
  // —— tokenTracker 埋点 ——
  'src/services/jimengAvatarService.js',
  'src/services/avatarService.js',
  'src/services/ttsService.js',
  // —— admin 模块缺失文件 ——
  'public/admin.html',                          // 服务器 53KB → 58KB（5KB 内容缺）
  'src/services/pipelineModelService.js',       // 服务器无
  'src/services/subscriptionScheduler.js',      // 服务器无（导致 PM2 错误日志）
  // —— 爆款复刻全量后端（确保最新版） ——
  'src/routes/radar.js',
  'src/services/radarService.js',
  'src/services/searchProviders/index.js',
  'src/services/searchProviders/bilibiliPopular.js',
  'src/services/searchProviders/bilibiliRegion.js',
  'src/services/searchProviders/douyinHeadless.js',
  'src/services/searchProviders/xiaohongshuHeadless.js',
  'src/services/searchProviders/weibo.js',
  'src/services/searchProviders/youtube.js',
  'src/services/browserService.js',
  'src/services/ytdlpService.js',
  'src/services/douyinExtract.js',
  'src/routes/browser.js',
  'public/replicate.html',
  'public/js/admin.js',  // 包含模型管线工具链路展示
  'MCP/media-crawler/index.js',
];
const REPO = path.resolve(__dirname, '..');
function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)).on('error', rej); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function sftpOpen(c) { return new Promise((res, rej) => c.sftp((e, s) => e ? rej(e) : res(s))); }
function up(s, l, r) { return new Promise((res, rej) => s.fastPut(l, r, e => e ? rej(e) : res())); }
function exec(c, cmd) { return new Promise(res => { c.exec(cmd, (e, st) => { if (e) return res(e.message); let o=''; st.on('data',d=>o+=d); st.stderr.on('data',d=>o+=d); st.on('close',()=>res(o)); }); }); }
(async () => {
  const c = await connect();
  const sftp = await sftpOpen(c);
  let ok=0, fail=0;
  for (const rel of FILES) {
    const local = path.join(REPO, rel);
    if (!fs.existsSync(local)) { console.log('  skip', rel); continue; }
    const remote = path.posix.join('/opt/vido/app', rel.split(path.sep).join('/'));
    try { await up(sftp, local, remote); console.log('  ✓', rel, fs.statSync(local).size); ok++; }
    catch (e) { console.log('  ✗', rel, e.message); fail++; }
  }
  console.log(`\n[deploy] ✓${ok} ✗${fail}`);
  console.log((await exec(c, '> /root/.pm2/logs/vido-error.log; pm2 reload vido --update-env 2>&1 | tail -3')).trim());
  await new Promise(r => setTimeout(r, 2000));
  console.log((await exec(c, 'curl -s -o /dev/null -w "health=%{http_code}\\n" http://127.0.0.1:4600/api/health')).trim());
  console.log((await exec(c, 'tail -8 /root/.pm2/logs/vido-error.log 2>&1 | head -10')).trim());
  c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
