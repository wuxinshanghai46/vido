const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = `
    cat /tmp/preview.mp3
    echo ""
    echo "--- recent log ---"
    sleep 1
    pm2 logs vido --lines 30 --nostream 2>&1 | grep -iE "preview|cosyvoice|aliyun|TTS" | tail -15
  `;
  c.exec(cmd, (e, s) => { if (e) {console.log(e); c.end(); return;} s.on('data', d => process.stdout.write(d.toString())); s.stderr.on('data', d => process.stderr.write(d.toString())); s.on('close', () => c.end()); });
}).on('error', e => console.log('ERR', e.message));
c.connect({host:'43.98.167.151',port:22,username:'root',password:process.argv[2]});
