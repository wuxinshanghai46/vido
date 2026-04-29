const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = `pm2 logs vido --lines 200 --nostream 2>&1 | grep -B 1 -A 5 -iE "preview-voice|TTS.*失败|generateSpeech.*err" | tail -40`;
  c.exec(cmd, (e, s) => { if (e) {console.log(e); c.end(); return;} s.on('data', d => process.stdout.write(d.toString())); s.stderr.on('data', d => process.stderr.write(d.toString())); s.on('close', () => c.end()); });
}).on('error', e => console.log('ERR', e.message));
c.connect({host:'43.98.167.151',port:22,username:'root',password:process.argv[2]});
