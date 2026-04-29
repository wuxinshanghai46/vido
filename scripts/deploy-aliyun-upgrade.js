const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const FILES = [
  'src/routes/workbench.js',
  'public/js/digital-human.js',
];
const REPO = path.resolve(__dirname, '..');

function connect() {
  return new Promise((res, rej) => {
    const c = new Client();
    c.on('ready', () => res(c));
    c.on('error', rej);
    c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 });
  });
}
function sftpOpen(c) { return new Promise((res, rej) => c.sftp((e, s) => e ? rej(e) : res(s))); }
function up(s, l, r) { return new Promise((res, rej) => s.fastPut(l, r, e => e ? rej(e) : res())); }
function exec(c, cmd) {
  return new Promise(res => c.exec(cmd, (e, stream) => {
    if (e) return res(e.message);
    let o = '';
    stream.on('data', d => o += d);
    stream.stderr.on('data', d => o += d);
    stream.on('close', () => res(o));
  }));
}

(async () => {
  const c = await connect();
  const sftp = await sftpOpen(c);
  for (const rel of FILES) {
    const local = path.join(REPO, rel);
    if (!fs.existsSync(local)) { console.log('  skip', rel); continue; }
    const remote = path.posix.join('/opt/vido/app', rel.split(path.sep).join('/'));
    await up(sftp, local, remote);
    console.log('  uploaded', rel, fs.statSync(local).size, 'bytes');
  }
  console.log('---reload---');
  console.log((await exec(c, 'pm2 reload vido --update-env 2>&1')).trim());
  await new Promise(r => setTimeout(r, 1500));
  console.log((await exec(c, 'curl -s -o /dev/null -w "health=%{http_code}\\n" http://127.0.0.1:4600/api/health')).trim());
  c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
