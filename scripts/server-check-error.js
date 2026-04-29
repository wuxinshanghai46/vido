const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)).on('error', rej); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function exec(c, cmd) { return new Promise(res => { c.exec(cmd, (e, st) => { if (e) return res(e.message); let o=''; st.on('data',d=>o+=d); st.stderr.on('data',d=>o+=d); st.on('close',()=>res(o)); }); }); }
(async () => {
  const c = await connect();
  console.log(await exec(c, 'tail -60 /root/.pm2/logs/vido-error.log'));
  console.log('---');
  console.log(await exec(c, 'pm2 ls'));
  c.end();
})().catch(e => console.error(e.message));
