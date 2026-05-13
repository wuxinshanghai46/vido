const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const c = new Client();
c.on('ready', () => {
  const cmd = `cd /opt/vido/app && node -e "
const { loadSettings } = require('./src/services/settingsService');
const s = loadSettings();
const dy = (s.providers||[]).find(p => (p.id==='deyunai' || p.preset==='deyunai') && p.api_key);
const axios = require('axios');
const url = 'https://api.deyunai.com/v1/images/generations';
const headers = { Authorization: 'Bearer '+dy.api_key, 'Content-Type': 'application/json' };
async function tryBody(label, body) {
  try {
    const r = await axios.post(url, body, { headers, timeout: 25000, validateStatus: () => true });
    console.log(label, '=>', 'status', r.status, JSON.stringify(r.data).slice(0, 280));
  } catch (e) { console.log(label, '=> ERR', e.message); }
}
(async () => {
  await tryBody('1. nano-banana 纯文 1024x1024', { model: 'nano-banana', prompt: 'a cat sitting on a chair, photo', n: 1, size: '1024x1024' });
  await tryBody('2. nano-banana 720x1280       ', { model: 'nano-banana', prompt: 'a cat, photo', n: 1, size: '720x1280' });
  await tryBody('3. nano-banana 带 image_url   ', { model: 'nano-banana', prompt: 'a cat holding a phone, photo', n: 1, size: '1024x1024', image_url: 'https://vido.smsend.cn/public/jimeng-assets/sample.jpg' });
  await tryBody('4. nano-banana 带 image_urls  ', { model: 'nano-banana', prompt: 'a cat holding a phone, photo', n: 1, size: '1024x1024', image_url: 'https://vido.smsend.cn/public/jimeng-assets/sample.jpg', image_urls: ['https://vido.smsend.cn/public/jimeng-assets/sample.jpg'] });
  await tryBody('5. nano-banana-pro 带 image_url', { model: 'nano-banana-pro', prompt: 'a cat holding a phone, photo', n: 1, size: '1024x1024', image_url: 'https://vido.smsend.cn/public/jimeng-assets/sample.jpg' });
  // 完整 product fusion 重现 (带超长 prompt + image_urls)
  const longPrompt = 'Compose a BRAND-NEW realistic product-presenter photo from two refs. NOT preservation — a new shot. Reference 1 = PERSON identity. Reference 2 = EXACT product. SCENE: place the person in a new real-world location. POSE: hand grips product with five fingers visible. PHOTOGRAPHY: candid phone-camera. PRODUCT LOCK. AVOID copying ref background.';
  await tryBody('6. nano-banana 长prompt+多图   ', { model: 'nano-banana', prompt: longPrompt, n: 1, size: '720x1280', image_url: 'https://vido.smsend.cn/public/jimeng-assets/sample.jpg', image_urls: ['https://vido.smsend.cn/public/jimeng-assets/sample.jpg', 'https://vido.smsend.cn/public/jimeng-assets/sample2.jpg'] });
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
