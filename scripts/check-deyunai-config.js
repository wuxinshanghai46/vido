const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const c = new Client();
c.on('ready', () => {
  const cmd = `cd /opt/vido/app && node -e "
const { loadSettings } = require('./src/services/settingsService');
const s = loadSettings();
const dy = (s.providers||[]).find(p => (p.id==='deyunai' || p.preset==='deyunai'));
console.log('id:', dy.id);
console.log('preset:', dy.preset);
console.log('api_url:', JSON.stringify(dy.api_url));
console.log('enabled:', dy.enabled);
console.log('models:', (dy.models||[]).filter(m => /nano-banana|gemini|jimeng-t2i/i.test(m.id)).map(m => ({id:m.id, enabled:m.enabled, use:m.use})));
"`;
  c.exec(cmd, (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
    stream.on('close', () => c.end());
  });
});
c.on('error', e => { console.error('SSH err:', e.message); process.exit(1); });
c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 });
