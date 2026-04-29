const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  console.log('SSH connected');
  const cmd = `
    echo "=== 1. thumb.jpg 文件 ===";
    find /opt/vido/app/outputs/avatar -name "*.thumb.jpg" 2>/dev/null | head -10;
    echo "=== 2. avatar 视频文件路径 ===";
    find /opt/vido/app/outputs/avatar -name "avatar_final.mp4" 2>/dev/null | head -5;
    echo "=== 3. ffmpeg-static ===";
    ls /opt/vido/app/node_modules/ffmpeg-static/ 2>&1 | head -5;
    echo "=== 4. recent pm2 logs grep thumbnail ===";
    pm2 logs vido --lines 200 --nostream 2>&1 | grep -iE "thumbnail|抽帧|extractFirstFrame" | tail -10;
    echo "=== 5. avatar DB 第一条 ===";
    cd /opt/vido/app && node -e "const db=require('./src/models/database');const ts=db.listAvatarTasks();const w=ts.filter(t=>t.videoPath||t.local_path);console.log('total:',ts.length,'with video:',w.length);w.slice(0,3).forEach(t=>console.log('id='+t.id?.slice(0,8),'videoPath='+(t.videoPath||t.local_path),'exists='+require('fs').existsSync(t.videoPath||t.local_path||'')))" 2>&1
  `;
  c.exec(cmd, (err, stream) => {
    if (err) { console.log('exec err:', err); c.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', code => { console.log('\n--- exit '+code+' ---'); c.end(); });
  });
}).on('error', e => console.log('SSH err:', e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.argv[2], readyTimeout: 25000 });
