const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('pm2 logs vido --lines 500 --nostream --raw 2>&1 | grep -iE "(jimeng-omni|jimeng-compose|jimeng-auto|matte|抠像|compose|bg_|body_seg|百度|baidu)" | tail -40', (e, s) => {
    let o = '';
    s.on('close', () => { console.log(o); c.end(); }).on('data', d => o += d.toString()).stderr.on('data', d => o += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
