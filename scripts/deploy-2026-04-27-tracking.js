// Deploy 2026-04-27 v2: 全模型埋点 + 4 项 UX 修复
//
// 一、Token 埋点（每个模型逐一记账）
//   - tokenTracker.record() 失败调用 tokens/cost 全部归零（不再虚假记账）
//   - imageService: NanoBanana / MXAPI Gemini3 / MXAPI Draw 3 处
//   - videoService: MXAPI Sora/Veo/即梦 3 处
//   - hiflyService: 飞影 TTS-Video / Audio-Video 2 处
//   - wanAnimateService: 万相动作迁移 1 处
//   - avatarService: Hedra / Seedance / MiniMax / 智谱视频 ×3 共 5 处
//   - tokenTracker: VIDEO_PRICING/IMAGE_PRICING 大幅扩充（漫路聚合所有模型也覆盖）
//
// 二、UX 修复
//   1. browserService: 扫码登录强制清 cookie/cache，必须扫码（不再自动复用旧会话登录）
//   2. replicate.html: 爆款搜索结果横条提示删掉，卡片直接可点击
//   3. radar.js: search-bloggers 路由 names 提到 for 外，修复 ReferenceError 500
//
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const FILES = [
  // 埋点
  'src/services/tokenTracker.js',
  'src/services/imageService.js',
  'src/services/videoService.js',
  'src/services/hiflyService.js',
  'src/services/wanAnimateService.js',
  'src/services/avatarService.js',
  // UX 修复
  'src/services/browserService.js',
  'src/routes/radar.js',
  'public/replicate.html',
];
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
  let ok = 0, fail = 0;
  for (const rel of FILES) {
    const local = path.join(REPO, rel);
    if (!fs.existsSync(local)) { console.log('  skip', rel); continue; }
    const remote = path.posix.join('/opt/vido/app', rel.split(path.sep).join('/'));
    await exec(c, `mkdir -p ${path.posix.dirname(remote)}`);
    try {
      await up(sftp, local, remote);
      console.log('  ✓', rel, fs.statSync(local).size, 'bytes');
      ok++;
    } catch (e) { console.log('  ✗', rel, e.message); fail++; }
  }
  console.log(`[deploy] 上传 ${ok} 成功 / ${fail} 失败`);

  console.log('[deploy] 重启 PM2:');
  console.log((await exec(c, 'pm2 reload vido --update-env 2>&1')).trim());
  await new Promise(r => setTimeout(r, 2000));

  console.log('[deploy] 健康检查:');
  console.log((await exec(c, 'curl -s -o /dev/null -w "health=%{http_code}\\n" http://127.0.0.1:4600/api/health')).trim());

  console.log('[deploy] 服务器日志（最近 15 行）:');
  console.log((await exec(c, 'pm2 logs vido --lines 15 --nostream 2>&1 | tail -20')).trim());

  c.end();
  console.log('[deploy] ✅ 完成');
})().catch(e => { console.error('[deploy] FATAL', e.message); process.exit(1); });
