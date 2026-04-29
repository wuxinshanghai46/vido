// 清理服务器 monitor_db.json 里 middleware_perf_timing_start 等技术名残留
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)).on('error', rej); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function exec(c, cmd, label) {
  console.log('\n──', label || cmd.slice(0, 80));
  return new Promise(res => { c.exec(cmd, (e, st) => { if (e) return res(e.message); let o=''; st.on('data',d=>{o+=d;process.stdout.write(d.toString())}); st.stderr.on('data',d=>{o+=d;process.stdout.write(d.toString())}); st.on('close',()=>res(o)); }); });
}

(async () => {
  const c = await connect();

  await exec(c, 'cat /opt/vido/app/outputs/monitor_db.json | head -80', '清理前 monitor_db');

  // 清理脚本（用 node 跑，过滤掉技术名残留 + 重新落盘）
  const cleanScript = `cd /opt/vido/app && node -e "
const fs = require('fs');
const file = './outputs/monitor_db.json';
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const before = db.accounts.length;
const isTech = s => !s || /^[a-z_]+$/i.test(s) || /perf_timing|middleware|webpack|chunk|navigator|hydrat|bootstrap_/i.test(s);
db.accounts = db.accounts.filter(a => !isTech(a.account_name));
const after = db.accounts.length;
fs.writeFileSync(file, JSON.stringify(db, null, 2));
console.log('清理前', before, '条 → 清理后', after, '条，删除', before - after, '条技术名残留');
"`;
  await exec(c, cleanScript, '清理脚本');

  await exec(c, "node -e \"const d=JSON.parse(require('fs').readFileSync('/opt/vido/app/outputs/monitor_db.json','utf8'));console.log('剩余账号:',d.accounts.map(a=>a.account_name).join(' | '))\"", '清理后剩余');

  c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
