/**
 * Deploy: 商品数字人两个 bug 修复
 *   1. CSS gallery 卡片过大 → grid 布局（digital-human-wizard.css v30）
 *   2. 融合忽略上传人物 → 本地图片转 base64 data URI（digitalHuman.js）
 */
const fs = require('fs');
const path = require('path');
const posix = path.posix;
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const PORT = Number(process.env.VIDO_DEPLOY_PORT || 22);
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';
const PM2_APP = process.env.VIDO_DEPLOY_PM2_APP || 'vido';

const staticFiles = [
  'public/digital-human.html',
  'public/js/digital-human.js',
  'public/css/digital-human-wizard.css',
];
const serverFiles = [
  'src/routes/digitalHuman.js',
];

if (!PASSWORD) { console.error('缺少 VIDO_DEPLOY_PASSWORD'); process.exit(1); }

function connect() {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c));
    c.on('error', reject);
    c.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 25000 });
  });
}
function exec(c, cmd) {
  return new Promise((resolve, reject) => {
    c.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { errOut += d.toString(); });
      stream.on('close', code => {
        if (code !== 0) return reject(new Error(`fail ${code}: ${cmd}\n${errOut || out}`));
        resolve({ out, errOut });
      });
    });
  });
}
function sftpOpen(c) { return new Promise((res, rej) => c.sftp((err, sftp) => err ? rej(err) : res(sftp))); }
function put(sftp, local, remote) { return new Promise((res, rej) => sftp.fastPut(local, remote, err => err ? rej(err) : res())); }

(async () => {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const c = await connect();
  try {
    const sftp = await sftpOpen(c);
    for (const rel of [...staticFiles, ...serverFiles]) {
      const local = path.resolve(rel);
      if (!fs.existsSync(local)) { console.warn('[skip]', rel); continue; }
      const remote = posix.join(REMOTE_ROOT, rel.replace(/\\/g, '/'));
      await exec(c, `if [ -f '${remote}' ]; then cp '${remote}' '${remote}.bak-${stamp}'; fi`);
      await put(sftp, local, remote);
      console.log(`[deploy] ✓ ${rel}`);
    }
    console.log('[deploy] PM2 重启…');
    await exec(c, `pm2 restart ${PM2_APP}`);
    console.log('[deploy] ✅ 商品数字人 bug 修复已上线（gallery grid + base64 图像传参）');
  } finally { c.end(); }
})().catch(err => { console.error('[deploy] ❌', err.message); process.exit(1); });
