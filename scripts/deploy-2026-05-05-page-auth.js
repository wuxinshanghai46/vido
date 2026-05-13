/**
 * Deploy 2026-05-05i：页面级认证（URL 安全加固）
 * - 登录/注册/刷新时种 httpOnly vido_session Cookie (7天 JWT)
 * - /dashboard /digital-human /admin 需要 Cookie 才能访问
 * - 直接 GET .html 文件也被拦截
 * - 未登录访问受保护页面 → 重定向 /?require_login=1
 */
const fs = require('fs');
const path = require('path');
const posix = path.posix;
const { Client } = require('ssh2');

const HOST        = process.env.VIDO_DEPLOY_HOST     || '43.98.167.151';
const USER        = process.env.VIDO_DEPLOY_USER     || 'root';
const PASSWORD    = process.env.VIDO_DEPLOY_PASSWORD;
const PORT        = Number(process.env.VIDO_DEPLOY_PORT || 22);
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE   || '/opt/vido/app';
const PM2_APP     = process.env.VIDO_DEPLOY_PM2_APP  || 'vido';

const files = [
  'src/server.js',
  'src/routes/auth.js',
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
  console.log(`[deploy] 连接 ${USER}@${HOST}:${PORT}`);
  const c = await connect();
  try {
    const sftp = await sftpOpen(c);
    for (const rel of files) {
      const local = path.resolve(rel);
      if (!fs.existsSync(local)) throw new Error(`本地文件不存在: ${rel}`);
      const remote = posix.join(REMOTE_ROOT, rel.replace(/\\/g, '/'));
      await exec(c, `if [ -f '${remote}' ]; then cp '${remote}' '${remote}.bak-${stamp}'; fi`);
      await put(sftp, local, remote);
      console.log(`[deploy] ✓ ${rel}`);
    }
    await exec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
    console.log('[deploy] ✓ pm2 reload');
    await new Promise(r => setTimeout(r, 2000));
    const health = await exec(c, `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health`);
    console.log(`[deploy] health: ${health.out.trim()}`);
    console.log('\n[deploy] ✅ 页面级认证上线\n  - 未登录访问 /digital-human → 重定向首页\n  - 直接访问 .html 文件同样被拦截\n  - 登录后自动获得 vido_session Cookie (7天)');
  } finally { c.end(); }
})().catch(err => { console.error('[deploy] ❌', err.message); process.exit(1); });
