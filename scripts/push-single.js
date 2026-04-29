// SCP 单个文件到服务器
const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');
const local = process.argv[2];
const remote = process.argv[3];
if (!local || !remote) { console.error('usage: push-single.js <local> <remote>'); process.exit(1); }
const pwd = process.env.VIDO_DEPLOY_PASSWORD;
if (!pwd) { console.error('need VIDO_DEPLOY_PASSWORD'); process.exit(1); }
const c = new Client();
c.on('ready', () => {
  c.sftp((err, sftp) => {
    if (err) { console.error(err); c.end(); process.exit(1); }
    sftp.fastPut(local, remote, (err) => {
      if (err) { console.error('upload err:', err.message); c.end(); process.exit(1); }
      console.log(`↑ ${local} → ${remote}`);
      c.end();
    });
  });
});
c.on('error', e => { console.error(e.message); process.exit(2); });
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: pwd, readyTimeout: 20000 });
