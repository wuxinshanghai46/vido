const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const c = new Client();
c.on('ready', () => {
  c.exec("pm2 logs vido --nostream --lines 200 --raw 2>&1 | grep -E '(nano-banana|DH/images|DH/product|DH/videos|Error|失败|1201|403|500)' | tail -80", (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
    stream.on('close', () => c.end());
  });
});
c.on('error', e => { console.error('SSH err:', e.message); process.exit(1); });
c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 });
