// 部署 ytdlpService 升级版 + 测试 visitor cookie 流程
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const FILES = ['src/services/ytdlpService.js', 'src/routes/radar.js'];
const REPO = path.resolve(__dirname, '..');
function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)).on('error', rej); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function sftpOpen(c) { return new Promise((res, rej) => c.sftp((e, s) => e ? rej(e) : res(s))); }
function up(s, l, r) { return new Promise((res, rej) => s.fastPut(l, r, e => e ? rej(e) : res())); }
function exec(c, cmd, label) {
  console.log('\n──', label || cmd.slice(0, 80));
  return new Promise(res => { c.exec(cmd, (e, st) => { if (e) return res(e.message); let o=''; st.on('data',d=>{o+=d;process.stdout.write(d.toString())}); st.stderr.on('data',d=>{o+=d;process.stdout.write(d.toString())}); st.on('close',()=>res(o)); }); });
}
(async () => {
  const c = await connect();
  const sftp = await sftpOpen(c);
  for (const rel of FILES) {
    const local = path.join(REPO, rel);
    const remote = path.posix.join('/opt/vido/app', rel.split(path.sep).join('/'));
    await up(sftp, local, remote);
    console.log('  ✓', rel, fs.statSync(local).size);
  }

  await exec(c, 'pm2 reload vido --update-env 2>&1 | tail -3', 'PM2 reload');
  await new Promise(r => setTimeout(r, 1500));
  await exec(c, 'curl -s -o /dev/null -w "health=%{http_code}\\n" http://127.0.0.1:4600/api/health', '健康检查');

  // 真实测试：用 node 直接调 ytdlpService 跑一遍 visitor + yt-dlp
  const probe = `cd /opt/vido/app && node -e "(async () => {
    const ytdlp = require('./src/services/ytdlpService');
    console.log('yt-dlp 路径:', ytdlp._findYtdlp());
    console.log('开始预热 douyin visitor cookie...');
    const cf = await ytdlp.ensureVisitorCookie('douyin', { force: true });
    console.log('visitor cookie 文件:', cf);
    const fs = require('fs');
    console.log('cookie 行数:', fs.readFileSync(cf, 'utf8').split('\\n').length);
    console.log('cookie 前 500 字符:');
    console.log(fs.readFileSync(cf, 'utf8').slice(0, 500));
    // 用这份 visitor cookie 试解析一个抖音视频
    console.log('\\n尝试用 visitor cookie 解析抖音视频...');
    const videos = await ytdlp.fetchUserVideos('https://www.douyin.com/video/7629387842053016870', { cookieFile: cf, limit: 1, timeout: 30000 }).catch(e => { console.log('FAIL:', e.message); return []; });
    console.log('结果:', JSON.stringify(videos, null, 2).slice(0, 800));
  })().catch(e => { console.error('FATAL:', e.message); process.exit(1); });" 2>&1 | tail -40`;
  await exec(c, probe, 'visitor cookie 真实测试');

  c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
