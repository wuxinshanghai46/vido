// 重启 pm2 vido 让内存里的旧任务队列清掉（头像补全会在下次对话时才重新触发）
const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('pm2 reload vido --update-env 2>&1 | tail -3 && sleep 3 && pm2 logs vido --lines 5 --nostream --raw 2>&1 | tail -5', (e, s) => {
    let o = '';
    s.on('close', () => { console.log(o); c.end(); }).on('data', d => o += d.toString()).stderr.on('data', d => o += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
