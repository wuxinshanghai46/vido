// 看生产上正在跑的 jimeng 任务状态 + pm2 最近日志
const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('pm2 logs vido --lines 80 --nostream --raw 2>&1 | grep -E "(jimeng|即梦|504|403|error|Error|omni|matte|compose|抠像)" | tail -40', (e, s) => {
    let o = '';
    s.on('close', () => { console.log(o); c.end(); })
      .on('data', d => o += d.toString())
      .stderr.on('data', d => o += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
