// 看最近生成的 composed 视频实际数据 + ffprobe
const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('ls -laht /opt/vido/app/outputs/jimeng-assets/ | grep -E "(composed|matte|avatar_raw|demo)" | head -10 && echo "---" && FILE=$(ls -t /opt/vido/app/outputs/jimeng-assets/composed_*.mp4 2>/dev/null | head -1) && if [ -n "$FILE" ]; then echo "最新 composed: $FILE"; ls -la "$FILE"; /opt/vido/app/node_modules/ffmpeg-static/ffmpeg -i "$FILE" 2>&1 | head -25; echo "---avatar_raw 对比---"; LATEST_TASK=$(basename $(dirname $(ls -t /opt/vido/app/outputs/avatar/*/avatar_raw.mp4 2>/dev/null | head -1))); echo "latest task: $LATEST_TASK"; ls -la /opt/vido/app/outputs/avatar/$LATEST_TASK/ 2>&1 | head -5; fi', (e, s) => {
    let o = '';
    s.on('close', () => { console.log(o); c.end(); }).on('data', d => o += d.toString()).stderr.on('data', d => o += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
