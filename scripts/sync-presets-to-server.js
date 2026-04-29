#!/usr/bin/env node
/**
 * 把本地 outputs/presets/ 下所有预设图片（avatar_*.png + bg_*.png）推到生产服务器
 * 远端路径: /data/vido/outputs/presets/ （outputs 已软链到 /data/vido/outputs）
 *
 * 用法: VIDO_DEPLOY_HOST=... VIDO_DEPLOY_PASSWORD=... node scripts/sync-presets-to-server.js
 */
const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');

const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PW = process.env.VIDO_DEPLOY_PASSWORD;
if (!HOST || !PW) { console.error('需要 VIDO_DEPLOY_HOST + VIDO_DEPLOY_PASSWORD'); process.exit(1); }

const LOCAL_DIR = path.join(__dirname, '..', 'outputs', 'presets');
const REMOTE_DIR = '/opt/vido/app/outputs/presets'; // 走软链 → /data/vido/outputs/presets

(async () => {
  const files = fs.readdirSync(LOCAL_DIR)
    .filter(f => /^(avatar|bg)_.*\.(png|jpg|jpeg|webp)$/i.test(f));
  console.log(`本地 ${files.length} 个预设图待推`);

  const c = new Client();
  await new Promise((resolve, reject) => {
    c.on('ready', resolve).on('error', reject)
     .connect({ host: HOST, port: 22, username: USER, password: PW, readyTimeout: 15000 });
  });
  const sftp = await new Promise((res, rej) => c.sftp((e, s) => e ? rej(e) : res(s)));

  let ok = 0, fail = 0;
  for (const f of files) {
    const local = path.join(LOCAL_DIR, f);
    const remote = `${REMOTE_DIR}/${f}`;
    try {
      await new Promise((res, rej) => sftp.fastPut(local, remote, e => e ? rej(e) : res()));
      const sz = (fs.statSync(local).size / 1024).toFixed(0);
      console.log(`  ↑ ${f} (${sz}KB)`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${f}: ${e.message}`);
      fail++;
    }
  }
  c.end();
  console.log(`\n完成: ${ok} 成功 / ${fail} 失败`);
})().catch(e => { console.error(e); process.exit(2); });
