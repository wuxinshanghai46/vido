const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const local = path.resolve(__dirname, 'demo-auto-produce.js');
const remote = '/opt/vido/app/scripts/demo-auto-produce.js';

console.log('local:', local, 'exists?', fs.existsSync(local));

const c = new Client();
c.on('ready', () => {
  console.log('SSH ready');
  c.sftp((err, sftp) => {
    if (err) { console.error('sftp err', err); c.end(); return; }
    console.log('SFTP ready');
    // mkdir via SFTP，已存在则忽略
    sftp.mkdir('/opt/vido/app/scripts', { mode: 0o755 }, (merr) => {
      if (merr && merr.code !== 4 && merr.code !== 11 && !/exists/i.test(merr.message)) {
        console.error('mkdir err:', merr.message, merr.code);
      }
      console.log('mkdir done (or already existed)');
      const data = fs.readFileSync(local);
      sftp.writeFile(remote, data, {}, (werr) => {
        if (werr) { console.error('write err:', werr.message, werr.code); c.end(); process.exit(1); }
        console.log('✓ 成功上传:', remote, '大小', data.length);
        c.end();
      });
    });
  });
});
c.on('error', e => { console.error('ssh err:', e.message); process.exit(2); });
c.on('end', () => console.log('SSH closed'));
console.log('connecting...');
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD, readyTimeout: 15000 });
