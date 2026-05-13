// 远程在生产服务器执行，测试 nano-banana 在不同通道的响应
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const c = new Client();
c.on('ready', () => {
  // 在生产读 settings 拿 key，分别测两个通道，只看 message 字段
  const cmd = `cd /opt/vido/app && node -e "
const { loadSettings } = require('./src/services/settingsService');
const s = loadSettings();
const dy = (s.providers||[]).find(p => (p.id==='deyunai' || p.preset==='deyunai') && p.api_key);
if (!dy) { console.log('NO_DEYUNAI'); process.exit(1); }
const axios = require('axios');
const body = { model: 'nano-banana', prompt: 'a cat sitting on a chair, photo', n: 1, size: '1024x1024' };
async function tryUrl(label, url, headers) {
  try {
    const r = await axios.post(url, body, { headers, timeout: 25000, validateStatus: () => true });
    console.log(label, '=>', 'status', r.status, JSON.stringify(r.data).slice(0, 250));
  } catch (e) {
    console.log(label, '=> ERR', e.message);
  }
}
(async () => {
  await tryUrl('A. /v1 国内通道       ', 'https://api.deyunai.com/v1/images/generations',     { Authorization: 'Bearer '+dy.api_key, 'Content-Type': 'application/json' });
  await tryUrl('B. /c35/v1 海外+vendor', 'https://api.deyunai.com/c35/v1/images/generations', { Authorization: 'Bearer '+dy.api_key, 'Content-Type': 'application/json', vendor: 'API_VENDOR' });
  await tryUrl('C. /c35/v1 海外无 vendor', 'https://api.deyunai.com/c35/v1/images/generations', { Authorization: 'Bearer '+dy.api_key, 'Content-Type': 'application/json' });
  // 也测下 nano-banana-pro
  body.model = 'nano-banana-pro';
  await tryUrl('D. nano-banana-pro /v1', 'https://api.deyunai.com/v1/images/generations',     { Authorization: 'Bearer '+dy.api_key, 'Content-Type': 'application/json' });
  await tryUrl('E. nano-banana-pro /c35', 'https://api.deyunai.com/c35/v1/images/generations', { Authorization: 'Bearer '+dy.api_key, 'Content-Type': 'application/json', vendor: 'API_VENDOR' });
})();
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
