const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const FILES = [
  'public/replicate.html',
  'src/server.js',
];
const REPO = path.resolve(__dirname, '..');
function connect() { return new Promise((r, j) => { const c = new Client(); c.on('ready', () => r(c)); c.on('error', j); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function sftpOpen(c) { return new Promise((r, j) => c.sftp((e, s) => e ? j(e) : r(s))); }
function up(s, l, r) { return new Promise((res, rej) => s.fastPut(l, r, e => e ? rej(e) : res())); }
function exec(c, cmd) { return new Promise(res => c.exec(cmd, (e, st) => { if (e) return res(e.message); let o = ''; st.on('data', d => o += d); st.stderr.on('data', d => o += d); st.on('close', () => res(o)); })); }
(async () => {
  const c = await connect();
  const sftp = await sftpOpen(c);
  for (const rel of FILES) {
    const local = path.join(REPO, rel);
    const remote = path.posix.join('/opt/vido/app', rel.split(path.sep).join('/'));
    await up(sftp, local, remote);
    console.log('  ↑', rel);
  }
  // 清生产 DB（monitor/content/replicate）
  console.log((await exec(c, `cd /opt/vido/app && node -e "['./outputs/monitor_db.json','./outputs/content_db.json','./outputs/replicate_db.json'].forEach(f=>{if(require('fs').existsSync(f)){const j=JSON.parse(require('fs').readFileSync(f,'utf8'));Object.keys(j).forEach(k=>{if(Array.isArray(j[k]))j[k]=[]});require('fs').writeFileSync(f,JSON.stringify(j,null,2));console.log('cleared',f)}})"`)).trim());
  // 删自建 platformAuth（如果存在）
  await exec(c, 'rm -f /opt/vido/app/src/routes/platformAuth.js /opt/vido/app/src/services/douyinRealService.js');
  console.log((await exec(c, 'pm2 reload vido --update-env 2>&1')).trim());
  await new Promise(r => setTimeout(r, 1500));
  console.log((await exec(c, 'curl -s -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:4600/api/health')).trim());
  c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
