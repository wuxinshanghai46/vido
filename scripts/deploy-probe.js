#!/usr/bin/env node
/**
 * 连通性探针 — 用来在正式部署前确认新服务器可访问、Node/PM2/目录等状态
 * 用法：
 *   VIDO_DEPLOY_HOST=43.98.167.151 VIDO_DEPLOY_USER=root VIDO_DEPLOY_PASSWORD='...' \
 *     node scripts/deploy-probe.js
 * 不写任何凭证到磁盘。
 */
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const PORT = parseInt(process.env.VIDO_DEPLOY_PORT || '22', 10);
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';

if (!HOST || !PASSWORD) {
  console.error('ERROR: need VIDO_DEPLOY_HOST / VIDO_DEPLOY_PASSWORD env');
  process.exit(1);
}

function runExec(c, cmd) {
  return new Promise((resolve) => {
    c.exec(cmd, (err, stream) => {
      if (err) return resolve({ code: -1, out: '', errOut: err.message });
      let out = '', errOut = '';
      stream.on('close', (code) => resolve({ code, out, errOut }));
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => errOut += d.toString());
    });
  });
}

(async () => {
  const c = new Client();
  c.on('ready', async () => {
    console.log(`✓ SSH 已连接 ${USER}@${HOST}:${PORT}`);
    const probes = [
      ['uname -a', 'OS'],
      ['node --version 2>/dev/null || echo MISSING', 'Node'],
      ['npm --version 2>/dev/null || echo MISSING', 'npm'],
      ['pm2 --version 2>/dev/null || echo MISSING', 'PM2'],
      ['pm2 list 2>/dev/null | head -30 || echo "no pm2 processes"', 'PM2 list'],
      [`ls -la ${REMOTE_ROOT} 2>&1 | head -10`, `目录 ${REMOTE_ROOT}`],
      ['ss -tlnp 2>/dev/null | grep -E ":(3007|4600)" || echo "无 3007/4600 监听"', '端口占用'],
      ['df -h / 2>/dev/null | tail -1', '磁盘'],
      ['free -m 2>/dev/null | head -2', '内存'],
      ['curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health 2>&1 || echo "404/无服务"', '/api/health:4600'],
    ];
    for (const [cmd, label] of probes) {
      const r = await runExec(c, cmd);
      console.log(`\n─── ${label} ───`);
      console.log((r.out || r.errOut).trim() || '(空)');
    }
    c.end();
  });
  c.on('error', (err) => {
    console.error('✗ SSH 连接失败:', err.message);
    process.exit(2);
  });
  c.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
})();
