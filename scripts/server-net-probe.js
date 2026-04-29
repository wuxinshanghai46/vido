// 探测服务器是否能访问国内主流社媒站
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;

function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)).on('error', rej); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function exec(c, cmd, label) {
  console.log('\n──', label || cmd);
  return new Promise(res => { c.exec(cmd, (e, st) => { if (e) return res(e.message); let o=''; st.on('data',d=>{o+=d;process.stdout.write(d.toString())}); st.stderr.on('data',d=>{o+=d;process.stdout.write(d.toString())}); st.on('close',()=>res(o)); }); });
}
(async () => {
  const c = await connect();
  const targets = [
    'https://www.xiaohongshu.com/explore',
    'https://www.douyin.com',
    'https://passport.kuaishou.com/pc/account/login',
    'https://api.bilibili.com/x/web-interface/popular?ps=1',
    'https://v.douyin.com/aby2TV903Kc/',
  ];
  await exec(c, 'cat /etc/resolv.conf | head -3', 'DNS 配置');
  for (const url of targets) {
    await exec(c, `curl -sS -o /dev/null -w "  http=%{http_code} ip=%{remote_ip} dns=%{time_namelookup}s connect=%{time_connect}s total=%{time_total}s\\n" --max-time 12 "${url}"`, url);
  }
  c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
