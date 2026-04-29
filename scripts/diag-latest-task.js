const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('echo "=== 最近 100 行 PM2 日志（含 TTS/Omni/compose/custom voice）===" && pm2 logs vido --lines 200 --nostream --raw 2>&1 | grep -iE "(TTS|声音|voice|custom|jimeng-omni|omni|matte|compose|抠像|合成|generate|生成|error|失败|fail|background|背景|bg_)" | tail -50 && echo && echo "=== 最近生成的 jimeng task ===" && ls -laht /opt/vido/app/outputs/jimeng-assets/ | head -10', (e, s) => {
    let o = '';
    s.on('close', () => { console.log(o); c.end(); }).on('data', d => o += d.toString()).stderr.on('data', d => o += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
