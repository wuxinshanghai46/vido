const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = `
    echo "=== 直接调阿里 CosyVoice WS 合成 ===";
    cd /opt/vido/app && node -e "
      const aliyun = require('./src/services/aliyunVoiceService');
      const path = require('path');
      const out = path.join('/tmp', 'cosytest_' + Date.now() + '.mp3');
      console.log('voice_id:', 'cosyvoice-v3.5-plus-vido-fb30374e855840b6b7e23e0dd0ee3f1e');
      aliyun.synthesize('这是一个测试，看看声音是否能正常合成', 'cosyvoice-v3.5-plus-vido-fb30374e855840b6b7e23e0dd0ee3f1e', out)
        .then(p => { console.log('OK:', p, 'size:', require('fs').statSync(p).size); })
        .catch(e => { console.log('ERR:', e.message); });
    " 2>&1 | head -20
  `;
  c.exec(cmd, (err, stream) => {
    if (err) { console.log(err); c.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => c.end());
  });
}).on('error', e => console.log('ERR', e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.argv[2], readyTimeout: 25000 });
