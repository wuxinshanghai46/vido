/**
 * SSH 到服务器端，流式跑 demo-matting.js
 * 先下一张背景，再跑抠像合成。
 */
const { Client } = require('ssh2');

const pwd = process.env.VIDO_DEPLOY_PASSWORD;
if (!pwd) { console.error('need VIDO_DEPLOY_PASSWORD'); process.exit(1); }

const videoPath = process.argv[2] || '/opt/vido/app/outputs/jimeng-assets/demo_20s_1776511412.mp4';
const bgUrl = process.argv[3] || 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=720&h=1280&fit=crop&q=80';
const outName = process.argv[4] || `matted_demo_${Date.now()}.mp4`;

const remoteScript = `
set -e
cd /opt/vido/app
BG_PATH="outputs/jimeng-assets/bg_office_$(date +%s).jpg"
echo "▶ 下载背景: ${bgUrl}"
curl -sS -o "$BG_PATH" "${bgUrl}"
ls -la "$BG_PATH"
echo
echo "▶ 开跑 demo-matting.js"
node scripts/demo-matting.js "${videoPath}" "$BG_PATH" "${outName}"
`;

const c = new Client();
c.on('ready', () => {
  c.exec(remoteScript, (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('close', (code) => { console.log(`\n▶ 远程退出码: ${code}`); c.end(); process.exit(code || 0); });
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
  });
});
c.on('error', e => { console.error('ssh err:', e.message); process.exit(2); });
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: pwd, readyTimeout: 20000, keepaliveInterval: 30000 });
