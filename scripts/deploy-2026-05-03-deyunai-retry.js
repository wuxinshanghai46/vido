// 修复 deyunai 偶发 400 + "module not exists:v1" 错误
// - _generateViaDeyunaiNanoBanana 加 3 次重试 + 指数退避（2s/4s）
// - 仅对 5xx / 429 / module-not-exists / network 类错误重试，业务错误（1201 prompt 超长）不重试
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

const files = ['src/routes/digitalHuman.js'];

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
      await exec(c, `if [ -f '${remote}' ]; then cp '${remote}' '${remote}.bak-${stamp}'; fi`);
      await put(sftp, local, remote);
      console.log(`[deploy] uploaded ${rel}`);
      await exec(c, `cd ${REMOTE_ROOT} && node -c '${remote}'`);
      console.log(`[deploy] syntax-ok ${rel}`);
    }

    const reload = await exec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
    console.log(reload.out.trim());

    const pm2 = await exec(c, `pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='${PM2_APP}'); if(!p) throw new Error('pm2 app not found'); console.log('status='+p.pm2_env.status+' restarts='+p.pm2_env.restart_time);})"`);
    console.log(`[deploy] ${pm2.out.trim()}`);

    const health = await exec(c, `curl -s -o /tmp/vido-health.out -w "%{http_code}" http://127.0.0.1:4600/api/health && echo && head -c 300 /tmp/vido-health.out`);
    console.log(`[deploy] health ${health.out.trim()}`);
  } finally {
    c.end();
  }
})().catch(err => { console.error('[deploy] failed:', err.message); process.exit(1); });
