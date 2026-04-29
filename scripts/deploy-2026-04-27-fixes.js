// Deploy 2026-04-27: 9 项修复（用户报告的 11 条问题里 9 条 + 部署）
//
//   1. 字幕烧录失败 (Omni-FX) — bundle NotoSansSC 字体 + 兜底逐段烧录 + stderr 详细日志
//   2/3/5/9. stage_id 路由不生效 — avatar.js 新增 _dispatchLipSync(),
//      按 admin 后台 avatar.lip_sync 链路取候选；并发限流自动 fallback；非口型同步模型跳过
//   4. 后端无限重试 — jimengAvatarService._call 命中 Concurrent Limit 立即抛 (不再 3×8s 等)
//   6. AI 配置启用/禁用切换 — 新加 PUT /api/settings/providers/:id/toggle + admin.js UI 滑动开关
//   7/10. 模型调用管理 — 中文展示名（model_name 优先）+ 已禁用模型置灰提示
//   8. 进入工作台跳首页 — auth.js 去重并发 refresh，解决 refresh_token 旋转 race
//   11. Token 监控 — tokenTracker VIDEO_PRICING 新增 jimeng/seedance/wan-animate 行；
//        jimengAvatarService probe 真实音频时长写入埋点
//
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const FILES = [
  // backend
  'src/server.js',
  'src/routes/avatar.js',
  'src/routes/settings.js',
  'src/services/jimengAvatarService.js',
  'src/services/effectsService.js',
  'src/services/tokenTracker.js',
  // frontend
  'public/js/auth.js',
  'public/js/admin.js',
  'public/css/admin.css',
  // bundled fonts (字幕烧录中文修复关键)
  'public/fonts/NotoSansSC-Regular.otf',
  'public/fonts/NotoSansSC-Bold.otf',
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
function mkdir(s, dir) {
  return new Promise(res => s.mkdir(dir, () => res()));  // 失败不报错（已存在）
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
  if (!HOST || !PASSWORD) { console.error('请设置 VIDO_DEPLOY_HOST 和 VIDO_DEPLOY_PASSWORD'); process.exit(1); }
  console.log('[deploy] 连接', HOST);
  const c = await connect();
  const sftp = await sftpOpen(c);

  // 确保 fonts 目录存在
  await exec(c, 'mkdir -p /opt/vido/app/public/fonts');

  console.log('[deploy] 上传文件:');
  let okCount = 0, failCount = 0;
  for (const rel of FILES) {
    const local = path.join(REPO, rel);
    if (!fs.existsSync(local)) { console.log('  skip (本地不存在)', rel); continue; }
    const remote = path.posix.join('/opt/vido/app', rel.split(path.sep).join('/'));
    // 确保父目录存在（fonts/ 等）
    const remoteDir = path.posix.dirname(remote);
    await exec(c, `mkdir -p ${remoteDir}`);
    try {
      await up(sftp, local, remote);
      const sz = fs.statSync(local).size;
      console.log('  ✓', rel, sz, 'bytes →', remote);
      okCount++;
    } catch (e) {
      console.log('  ✗', rel, e.message);
      failCount++;
    }
  }
  console.log(`[deploy] 上传完成: ${okCount} 成功 / ${failCount} 失败`);

  // 安装服务器中文字体（保险：bundled 没生效时仍可用）
  console.log('[deploy] 检查服务器字体（fc-list cjk）:');
  const fcList = (await exec(c, 'fc-list 2>/dev/null | grep -iE "noto|cjk|wqy" | head -3')).trim();
  if (fcList) {
    console.log(' ', fcList);
  } else {
    console.log('  (未发现系统中文字体；项目内置 NotoSansSC 已上传)');
  }

  console.log('[deploy] 重启 PM2:');
  console.log((await exec(c, 'pm2 reload vido --update-env 2>&1')).trim());
  await new Promise(r => setTimeout(r, 2000));

  console.log('[deploy] 健康检查:');
  console.log((await exec(c, 'curl -s -o /dev/null -w "health=%{http_code}\\n" http://127.0.0.1:4600/api/health')).trim());
  console.log((await exec(c, 'curl -s -o /dev/null -w "settings_toggle=%{http_code}\\n" -X PUT http://127.0.0.1:4600/api/settings/providers/jimeng/toggle -H "Content-Type: application/json" -d \'{"enabled":true}\'')).trim());
  console.log((await exec(c, 'curl -s http://127.0.0.1:4600/api/health 2>&1 | head -c 200')).trim());

  // 服务器日志最新 30 行（确认新代码起来了）
  console.log('[deploy] 服务器日志（最新 25 行）:');
  console.log((await exec(c, 'pm2 logs vido --lines 25 --nostream 2>&1 | tail -30')).trim());

  c.end();
  console.log('[deploy] ✅ 完成');
})().catch(e => { console.error('[deploy] FATAL', e.message); process.exit(1); });
