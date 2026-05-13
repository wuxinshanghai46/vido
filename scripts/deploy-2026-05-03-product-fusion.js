// 商品数字人 Topview 级真融合升级
// - prompt 重写：强制"换新场景 + 自然手持"
// - 新增 8 种拍摄场景模板 + 选择器
// - 删除 sharp/FFmpeg 贴图兜底（左右橘色"假手"块的根源）
// - Step 3 不再二次融合（avatar 已 fused 时直接驱动）
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
  'src/routes/digitalHuman.js',
  'public/digital-human.html',
  'public/js/digital-human.js',
  'public/css/digital-human-wizard.css',
];

if (!HOST || !PASSWORD) { console.error('Missing VIDO_DEPLOY_HOST or VIDO_DEPLOY_PASSWORD'); process.exit(1); }

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
      let out = ''; let errOut = '';
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { errOut += d.toString(); });
      stream.on('close', code => {
        if (code !== 0) return reject(new Error(`command failed ${code}: ${cmd}\n${errOut || out}`));
        resolve({ out, errOut });
      });
    });
  });
}
function sftpOpen(c) { return new Promise((resolve, reject) => c.sftp((err, sftp) => err ? reject(err) : resolve(sftp))); }
function mkdirP(sftp, dir) {
  const parts = dir.split('/').filter(Boolean);
  let cur = '';
  return parts.reduce((p, part) => p.then(() => new Promise(resolve => { cur += '/' + part; sftp.mkdir(cur, () => resolve()); })), Promise.resolve());
}
function put(sftp, local, remote) { return new Promise((resolve, reject) => sftp.fastPut(local, remote, err => err ? reject(err) : resolve())); }

(async () => {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  console.log(`[deploy] connect ${USER}@${HOST}:${PORT}`);
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

    for (const rel of files.filter(f => f.endsWith('.js'))) {
      const remote = posix.join(REMOTE_ROOT, rel.replace(/\\/g, '/'));
      await exec(c, `cd ${REMOTE_ROOT} && node -c '${remote}'`);
      console.log(`[deploy] syntax-ok ${rel}`);
    }

    console.log(`[deploy] reload ${PM2_APP}`);
    const reload = await exec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
    console.log(reload.out.trim());

    const pm2 = await exec(c, `pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='${PM2_APP}'); if(!p) throw new Error('pm2 app not found'); console.log('status='+p.pm2_env.status+' restarts='+p.pm2_env.restart_time);})"`);
    console.log(`[deploy] ${pm2.out.trim()}`);

    const health = await exec(c, `curl -s -o /tmp/vido-health.out -w "%{http_code}" http://127.0.0.1:4600/api/health && echo && head -c 300 /tmp/vido-health.out`);
    console.log(`[deploy] health ${health.out.trim()}`);

    // 新端点检查
    const scenes = await exec(c, `curl -s http://127.0.0.1:4600/api/dh/product-scenes | head -c 400`);
    console.log(`[deploy] scenes: ${scenes.out.trim()}`);
  } finally {
    c.end();
  }
})().catch(err => { console.error('[deploy] failed:', err.message); process.exit(1); });
