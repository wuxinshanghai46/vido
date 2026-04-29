const { Client } = require('ssh2');
const fs = require('fs');
const c = new Client();
const path = require('path');
const local = path.resolve(__dirname, 'demo-auto-produce.js');
const remote = '/opt/vido/app/scripts/demo-auto-produce.js';
console.log('local exists?', fs.existsSync(local), 'size=', fs.statSync(local).size);

c.on('ready', () => {
  c.exec('ls -la /opt/vido/app/scripts/ | head -5', (err, stream) => {
    let out = '';
    stream.on('close', () => {
      console.log('remote dir:\n', out);
      c.sftp((e, sftp) => {
        if (e) { console.error(e); c.end(); return; }
        // try writeFile via createWriteStream
        const data = fs.readFileSync(local);
        sftp.writeFile(remote, data, {}, (err2) => {
          if (err2) { console.error('writeFile err:', err2.message, err2.code); c.end(); return; }
          console.log('写入成功');
          c.end();
        });
      });
    });
    stream.on('data', d => out += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD, readyTimeout: 20000 });
