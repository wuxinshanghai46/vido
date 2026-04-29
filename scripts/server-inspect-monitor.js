const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)).on('error', rej); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function exec(c, cmd) { return new Promise(res => { c.exec(cmd, (e, st) => { if (e) return res(e.message); let o=''; st.on('data',d=>o+=d); st.stderr.on('data',d=>o+=d); st.on('close',()=>res(o)); }); }); }
(async () => {
  const c = await connect();
  console.log(await exec(c, 'cat /opt/vido/app/outputs/monitor_db.json'));
  console.log('---');
  console.log(await exec(c, 'ls /data/outputs/monitor_db.json /opt/vido/data/monitor_db.json /opt/vido/outputs/monitor_db.json 2>&1'));
  console.log('---');
  console.log(await exec(c, 'find /opt/vido /data -name "monitor_db.json" 2>/dev/null | head -5'));
  c.end();
})().catch(e => console.error(e.message));
