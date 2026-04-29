// 在远端 CentOS 7 服务器装 yt-dlp（用于抓抖音博主全量作品）
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)).on('error', rej); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function exec(c, cmd, label) {
  console.log('\n──', label || cmd.slice(0, 80));
  return new Promise(res => { c.exec(cmd, (e, st) => { if (e) return res(e.message); let o=''; st.on('data',d=>{o+=d;process.stdout.write(d.toString())}); st.stderr.on('data',d=>{o+=d;process.stdout.write(d.toString())}); st.on('close',()=>res(o)); }); });
}
(async () => {
  const c = await connect();
  // 1) 检查 python3
  await exec(c, 'python3 --version 2>&1; pip3 --version 2>&1', '检查 Python3');
  // 2) 装 yt-dlp（用 pip3 用户级安装到 /usr/local/bin）
  await exec(c, 'pip3 install -U yt-dlp 2>&1 | tail -10', '装 yt-dlp');
  // 3) 验证
  await exec(c, 'which yt-dlp; yt-dlp --version', '验证 yt-dlp');
  // 4) 装 ffmpeg（yt-dlp 解析视频流可能需要） — vido 已经用 ffmpeg-static，但系统级也装一份
  await exec(c, 'rpm -q ffmpeg 2>&1 | head -1', '检查 ffmpeg');
  c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
