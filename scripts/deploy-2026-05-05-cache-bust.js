const fs = require('fs');
const path = require('path');
const posix = path.posix;
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const PORT = Number(process.env.VIDO_DEPLOY_PORT || 22);
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';

const files = [
  'public/home.html',
  'public/digital-human.html',
  'public/js/home.js',
  'public/js/digital-human.js',
  'public/css/digital-human-wizard.css',
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
function sftpOpen(c) { return new Promise((res, rej) => c.sftp((err, sftp) => err ? rej(err) : res(sftp))); }
function put(sftp, local, remote) { return new Promise((res, rej) => sftp.fastPut(local, remote, err => err ? rej(err) : res())); }

(async () => {
  const c = await connect();
  try {
    const sftp = await sftpOpen(c);
    for (const rel of files) {
      const local = path.resolve(rel);
      if (!fs.existsSync(local)) { console.warn('[skip]', rel); continue; }
      const remote = posix.join(REMOTE_ROOT, rel.replace(/\\/g, '/'));
      await put(sftp, local, remote);
      console.log('[deploy] ✓', rel);
    }
    console.log('[deploy] ✅ 静态文件缓存更新完成');
  } finally { c.end(); }
})().catch(err => { console.error('[deploy] ❌', err.message); process.exit(1); });
