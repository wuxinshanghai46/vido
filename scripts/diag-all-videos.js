const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('echo "=== jimeng-assets 最新 15 条 ===" && ls -laht /opt/vido/app/outputs/jimeng-assets/ | head -15 && echo && echo "=== jimeng-matted 最新 15 条 ===" && ls -laht /opt/vido/app/outputs/jimeng-matted/ 2>/dev/null | head -15 && echo && echo "=== avatar 最新任务 5 个 ===" && ls -laht /opt/vido/app/outputs/avatar/ | head -8', (e, s) => {
    let o = '';
    s.on('close', () => { console.log(o); c.end(); }).on('data', d => o += d.toString()).stderr.on('data', d => o += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
