// 测多个平台 visitor cookie 效果
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
  // B站用户视频列表（最稳）
  const probe = `cd /opt/vido/app && node -e "(async () => {
    const ytdlp = require('./src/services/ytdlpService');
    // 测 B 站
    console.log('=== B站 ===');
    const r1 = await ytdlp.fetchUserVideos('https://space.bilibili.com/688010210/video', { limit: 3, timeout: 30000 }).catch(e => ({err:e.message}));
    console.log(JSON.stringify(r1, null, 2).slice(0, 600));
    // 测一个真实抖音用户主页（sec_uid 长版）
    console.log('\\n=== 抖音用户（visitor cookie）===');
    const cf = await ytdlp.ensureVisitorCookie('douyin');
    const r2 = await ytdlp.fetchUserVideos('https://www.douyin.com/user/MS4wLjABAAAA0X1xCmlVbo2WdIMHIqxe5JvdzPtkSPJOiYXpYJOzlyc', { cookieFile: cf, limit: 3, timeout: 60000 }).catch(e => ({err:e.message}));
    console.log(JSON.stringify(r2, null, 2).slice(0, 800));
  })().catch(e => console.error('FATAL:', e.message));" 2>&1 | tail -50`;
  await exec(c, probe, '多平台 visitor 测试');
  c.end();
})().catch(e => console.error(e.message));
