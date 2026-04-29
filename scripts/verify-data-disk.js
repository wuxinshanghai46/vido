#!/usr/bin/env node
// 体检：数据盘软链 + outputs 是否落在 /data
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PW = process.env.VIDO_DEPLOY_PASSWORD;
if (!HOST || !PW) { console.error('需要 VIDO_DEPLOY_HOST + VIDO_DEPLOY_PASSWORD 环境变量'); process.exit(1); }
const cmd = [
  'echo "=== outputs 软链 ==="',
  'ls -la /opt/vido/app | grep -E "outputs|logs" || true',
  'echo "=== 数据盘使用 ==="',
  'df -h /data /opt 2>/dev/null',
  'echo "=== outputs 落盘位置 ==="',
  'readlink -f /opt/vido/app/outputs',
  'echo "=== /data 下目录 ==="',
  'ls /data/vido/outputs/ 2>/dev/null | head -20',
  'echo "=== PM2 状态 ==="',
  'pm2 jlist 2>/dev/null | node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c).on(\'end\',()=>{try{JSON.parse(d).forEach(j=>console.log(j.name,j.pm2_env.status,\'uptime\',Math.round((Date.now()-j.pm2_env.pm_uptime)/1000)+\'s\'));}catch(e){}})" 2>/dev/null',
].join(' && ');
const c = new Client();
c.on('ready', () => {
  c.exec(cmd, (err, stream) => {
    if (err) { console.error(err); process.exit(1); }
    stream.on('close', () => c.end()).on('data', d => process.stdout.write(d)).stderr.on('data', d => process.stderr.write(d));
  });
});
c.on('error', e => { console.error('SSH 连接失败:', e.message); process.exit(2); });
c.connect({ host: HOST, port: 22, username: 'root', password: PW, readyTimeout: 15000 });
