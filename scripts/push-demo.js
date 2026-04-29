const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const local = path.resolve(__dirname, 'demo-auto-produce.js');
const remoteDir = '/opt/vido/app/scripts';
const remote = `${remoteDir}/demo-auto-produce.js`;

const c = new Client();
c.on('ready', () => {
  c.exec(`mkdir -p ${remoteDir}`, (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('close', () => {
      c.sftp((e, sftp) => {
        if (e) { console.error(e); c.end(); return; }
        sftp.fastPut(local, remote, (err2) => {
          if (err2) {
            console.error('fastPut err:', err2.message);
            c.end();
            return;
          }
          console.log(`↑ 成功上传: ${remote}`);
          c.end();
        });
      });
    });
  });
});
c.on('error', e => { console.error(e.message); process.exit(2); });
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD, readyTimeout: 20000 });
