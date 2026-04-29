const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = `
    cd /opt/vido/app && node -e "
      const db = require('./src/models/database');
      const fs = require('fs');
      const all = db.listVoices();
      console.log('全部 voices:', all.length);
      all.forEach(v => {
        const fileOk = v.file_path && fs.existsSync(v.file_path);
        const isCloneReady = !!(v.aliyun_voice_id || (v.volc_speaker_id && v.status === 'ready'));
        console.log('  ' + v.id, '·', v.name || '(无名)', '·', v.gender || '?', '·', v.status || '?');
        console.log('     aliyun_voice_id:', v.aliyun_voice_id || '空');
        console.log('     volc_speaker_id:', v.volc_speaker_id || '空');
        console.log('     file_exists:', fileOk);
        console.log('     会出现在 dropdown:', fileOk && isCloneReady);
      });
    "
  `;
  c.exec(cmd, (err, stream) => {
    if (err) { console.log(err); c.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => c.end());
  });
}).on('error', e => console.log('ERR', e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.argv[2], readyTimeout: 25000 });
