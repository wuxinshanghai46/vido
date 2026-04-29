// 真实测试：跑 yt-dlp 解析一个抖音用户主页（无 cookie 先看能否拿到任何数据）
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
  // 测试 1：抖音单视频提取（最稳的入口）
  await exec(c, 'yt-dlp --no-warnings -j --no-download "https://www.douyin.com/video/7629387842053016870" 2>&1 | head -c 800', '抖音单视频');
  // 测试 2：抖音用户主页（flat-playlist）
  await exec(c, 'yt-dlp --no-warnings --flat-playlist -J --no-download --playlist-end 5 "https://www.douyin.com/user/MS4wLjABAAAA22500377910" 2>&1 | head -c 1500', '抖音用户主页（无 cookie）');
  // 测试 3：当前 cookie 文件
  await exec(c, 'ls -la /opt/vido/app/outputs/cookies/ 2>&1 | head -10', 'cookie 文件状态');
  c.end();
})().catch(e => console.error(e.message));
