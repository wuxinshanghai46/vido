const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = `
    echo "=== 1. 看最近 preview 失败日志 ===";
    pm2 logs vido --lines 200 --nostream --err 2>&1 | grep -E "preview|VoicePreview|aliyun|cosyvoice|synthesize|TTS" | tail -30;
    echo "=== 2. 看正常输出日志 ===";
    pm2 logs vido --lines 100 --nostream 2>&1 | grep -E "preview|TTS|VoicePreview|cosyvoice" | tail -20;
    echo "=== 3. 找 custom_25037ea4 这条 voice 详情 ===";
    cd /opt/vido/app && node -e "const db=require('./src/models/database');const v=db.getVoice('custom_25037ea4');console.log(JSON.stringify(v,null,2))" 2>&1 | head -30
  `;
  c.exec(cmd, (err, stream) => {
    if (err) { console.log(err); c.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => c.end());
  });
}).on('error', e => console.log('ERR', e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.argv[2], readyTimeout: 25000 });
