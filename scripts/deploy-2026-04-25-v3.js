#!/usr/bin/env node
/**
 * 2026-04-25 v3 部署：thumbnail 公开端点 + 阿里 CosyVoice 复刻同步版（v3.5-plus）
 */
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const PORT = parseInt(process.env.VIDO_DEPLOY_PORT || '22', 10);
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';
const PM2_APP = process.env.VIDO_DEPLOY_PM2_APP || 'vido';

if (!HOST || !PASSWORD) { console.error('ERROR: 缺少 VIDO_DEPLOY_HOST / VIDO_DEPLOY_PASSWORD'); process.exit(1); }

const FILES = [
  // thumbnail 公开端点
  'src/server.js',
  // 阿里 CosyVoice 复刻同步版 + workbench 错误提示更新
  'src/services/aliyunVoiceService.js',
  'src/routes/workbench.js',
];

const REPO_ROOT = path.resolve(__dirname, '..');

function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)); c.on('error', rej); c.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 25000 }); }); }
function sftpOpen(c) { return new Promise((res, rej) => c.sftp((err, sftp) => err ? rej(err) : res(sftp))); }
function sftpStat(sftp, p) { return new Promise(resolve => sftp.stat(p, (err, stats) => resolve(err ? null : stats))); }
function sftpUpload(sftp, local, remote) { return new Promise((res, rej) => sftp.fastPut(local, remote, e => e ? rej(e) : res())); }
function runExec(c, cmd) { return new Promise((res, rej) => c.exec(cmd, (err, stream) => { if (err) return rej(err); let out = '', errOut = ''; stream.on('close', code => res({ code, out, errOut })); stream.on('data', d => out += d.toString()); stream.stderr.on('data', d => errOut += d.toString()); })); }

(async () => {
  console.log(`\n▶ 连接 ${USER}@${HOST}:${PORT}`);
  const c = await connect();
  const sftp = await sftpOpen(c);
  const rootStat = await sftpStat(sftp, REMOTE_ROOT);
  if (!rootStat) { console.error(`✗ 远端 ${REMOTE_ROOT} 不存在`); c.end(); process.exit(2); }
  console.log(`✓ 远端根: ${REMOTE_ROOT}`);

  let uploaded = 0;
  for (const rel of FILES) {
    const local = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(local)) { console.log(`  ⊘ 缺失: ${rel}`); continue; }
    const remote = path.posix.join(REMOTE_ROOT, rel.replace(/\\/g, '/'));
    try { await sftpUpload(sftp, local, remote); console.log(`  ↑ ${rel} (${fs.statSync(local).size} bytes)`); uploaded++; }
    catch (e) { console.error(`  ✗ ${rel}: ${e.message}`); }
  }
  console.log(`\n✓ 上传 ${uploaded}/${FILES.length}`);

  console.log(`\n▶ pm2 reload ${PM2_APP}`);
  const r1 = await runExec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
  console.log((r1.out || r1.errOut).trim());

  await new Promise(r => setTimeout(r, 1500));

  console.log(`\n▶ 健康检查 + 缩略图端点（无 token）`);
  const r2 = await runExec(c, `
    curl -s -o /dev/null -w "health=%{http_code}\\n" http://127.0.0.1:4600/api/health
    TID=$(node -e "const db=require('${REMOTE_ROOT}/src/models/database');const ts=db.listAvatarTasks().filter(t=>(t.videoPath||t.local_path)&&require('fs').existsSync(t.videoPath||t.local_path));console.log(ts[0]?.id||'')" 2>/dev/null)
    echo "test task id: $TID"
    curl -s -o /tmp/thumb-public.jpg -w "thumb(无token)=%{http_code} size=%{size_download} ct=%{content_type}\\n" "http://127.0.0.1:4600/api/dh/videos/tasks/$TID/thumbnail"
    file /tmp/thumb-public.jpg | head -1
  `);
  console.log((r2.out || r2.errOut).trim());

  c.end();
  console.log('\n✓ 部署完成');
})().catch(e => { console.error('\n✗ 失败:', e.message); process.exit(3); });
