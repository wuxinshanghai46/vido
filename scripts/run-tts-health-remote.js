#!/usr/bin/env node
// 在生产服务器上跑 TTS 健康体检 + 拉回结果
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PW = process.env.VIDO_DEPLOY_PASSWORD;
if (!HOST || !PW) { console.error('需要 VIDO_DEPLOY_HOST + VIDO_DEPLOY_PASSWORD'); process.exit(1); }
const c = new Client();
c.on('ready', () => {
  c.exec('cd /opt/vido/app && node scripts/tts-health-check.js 2>&1', (err, stream) => {
    if (err) { console.error(err); process.exit(1); }
    stream.on('close', () => c.end()).on('data', d => process.stdout.write(d)).stderr.on('data', d => process.stderr.write(d));
  });
});
c.on('error', e => { console.error('SSH 连接失败:', e.message); process.exit(2); });
c.connect({ host: HOST, port: 22, username: 'root', password: PW, readyTimeout: 15000 });
