// 部署 2026-05-05 形象广场重构：
// - 移除独立 prototype，改成数字人页面内的 plaza tab
// - 只展示有真实图片的预设形象（过滤 url=null）
// - 新增 ?tab=plaza deeplink + 旧 prototype URL 自动重定向
const fs = require('fs');
const path = require('path');
const posix = path.posix;
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const PORT = Number(process.env.VIDO_DEPLOY_PORT || 22);
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';
const PM2_APP = process.env.VIDO_DEPLOY_PM2_APP || 'vido';

const files = [
  'public/digital-human.html',
  'public/js/digital-human.js',
  'public/css/digital-human-wizard.css',
  'public/digital-human-plaza-prototype.html',
];

if (!HOST || !PASSWORD) {
  console.error('Missing VIDO_DEPLOY_HOST or VIDO_DEPLOY_PASSWORD');
  process.exit(1);
}

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
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => errOut += d.toString());
      stream.on('close', code => code !== 0
        ? reject(new Error(`cmd failed ${code}: ${cmd}\n${errOut || out}`))
        : resolve({ out, errOut }));
    });
  });
}
function sftpOpen(c) { return new Promise((resolve, reject) => c.sftp((err, s) => err ? reject(err) : resolve(s))); }
function mkdirP(sftp, dir) {
  const parts = dir.split('/').filter(Boolean);
  let cur = '';
  return parts.reduce((p, part) => p.then(() => new Promise(resolve => {
    cur += '/' + part;
    sftp.mkdir(cur, () => resolve());
  })), Promise.resolve());
}
function put(sftp, local, remote) {
  return new Promise((resolve, reject) => sftp.fastPut(local, remote, err => err ? reject(err) : resolve()));
}

(async () => {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  console.log(`[deploy] ${USER}@${HOST}:${PORT}`);
  const c = await connect();
  try {
    const sftp = await sftpOpen(c);
    await exec(c, `test -d ${REMOTE_ROOT}`);

    for (const rel of files) {
      const local = path.resolve(process.cwd(), rel);
      if (!fs.existsSync(local)) throw new Error(`missing local file: ${rel}`);
      const remote = posix.join(REMOTE_ROOT, rel.replace(/\\/g, '/'));
      const remoteDir = posix.dirname(remote);
      await mkdirP(sftp, remoteDir);
      await exec(c, `if [ -f '${remote}' ]; then cp '${remote}' '${remote}.bak-${stamp}'; fi`);
      await put(sftp, local, remote);
      console.log(`[deploy] uploaded ${rel}`);
    }

    // 静态文件不强制 reload，但和过往脚本保持一致：reload pm2 让进程重读
    console.log(`[deploy] reload ${PM2_APP}`);
    const reload = await exec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
    console.log(reload.out.trim());

    const pm2 = await exec(c, `pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='${PM2_APP}'); if(!p) throw new Error('pm2 app not found'); console.log('status='+p.pm2_env.status+' restarts='+p.pm2_env.restart_time);})"`);
    console.log(`[deploy] ${pm2.out.trim()}`);

    const health = await exec(c, `curl -s -o /tmp/vido-health.out -w "%{http_code}" http://127.0.0.1:4600/api/health && echo && head -c 200 /tmp/vido-health.out`);
    console.log(`[deploy] health ${health.out.trim()}`);

    // 验证新版 HTML 包含 plaza tab
    const verify = await exec(c, `grep -c 'data-tab="plaza"' ${REMOTE_ROOT}/public/digital-human.html || true`);
    console.log(`[deploy] plaza-tab markers in html: ${verify.out.trim()}`);
  } finally {
    c.end();
  }
})().catch(err => {
  console.error('[deploy] failed:', err.message);
  process.exit(1);
});
