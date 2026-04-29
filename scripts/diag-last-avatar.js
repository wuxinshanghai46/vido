const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('pm2 logs vido --lines 120 --nostream --raw 2>&1 | grep -E "(jimeng|Omni|matte|compose|抠像|合成|bg|avatar|generate|403|failed|错误)" | tail -50', (e, s) => {
    let o = '';
    s.on('close', () => { console.log(o); c.end(); }).on('data', d => o += d.toString()).stderr.on('data', d => o += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
