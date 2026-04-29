// 调高 tengine 长任务路径超时 — 修 R1 推理 504 + 视频长任务网关切断
//   原 vido.conf: proxy_connect_timeout 30 / proxy_send_timeout 40 / proxy_read_timeout 40
//   新值:        proxy_connect_timeout 60 / proxy_send_timeout 300 / proxy_read_timeout 300
//
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const CONF = '/opt/module/tengine-2.4.1/conf/conf.d/vido.conf';

function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)).on('error', rej); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function exec(c, cmd) { return new Promise(res => { c.exec(cmd, (e, st) => { if (e) return res(e.message); let o = ''; st.on('data', d => o += d); st.stderr.on('data', d => o += d); st.on('close', () => res(o)); }); }); }

(async () => {
  if (!HOST || !PASSWORD) { console.error('缺少 HOST/PASSWORD'); process.exit(1); }
  console.log('[fix-timeout] 连接', HOST);
  const c = await connect();

  console.log('[1] 备份原配置:');
  console.log((await exec(c, `cp ${CONF} ${CONF}.bak.$(date +%s) && ls -la ${CONF}*`)).trim());
  console.log('');

  console.log('[2] 改 3 行超时（sed 原地）:');
  // 注意 sed 用 |  做分隔符避免和 / 冲突
  const cmds = [
    `sed -i 's|proxy_connect_timeout 30;|proxy_connect_timeout 60;|' ${CONF}`,
    `sed -i 's|proxy_send_timeout 40;|proxy_send_timeout 300;|' ${CONF}`,
    `sed -i 's|proxy_read_timeout 40;|proxy_read_timeout 300;|' ${CONF}`,
  ];
  for (const cmd of cmds) {
    console.log('  $', cmd);
    await exec(c, cmd);
  }
  console.log('');

  console.log('[3] 改完后看新内容（关键行）:');
  console.log((await exec(c, `grep -E 'proxy_(connect|send|read)_timeout' ${CONF}`)).trim());
  console.log('');

  console.log('[4] nginx -t 语法校验:');
  const test = (await exec(c, '/opt/module/tengine-2.4.1/sbin/nginx -t 2>&1')).trim();
  console.log(test);
  if (!/syntax is ok/i.test(test) || !/test is successful/i.test(test)) {
    console.error('[!] 语法不通过，回滚:');
    console.log((await exec(c, `cp $(ls -t ${CONF}.bak.* | head -1) ${CONF} && /opt/module/tengine-2.4.1/sbin/nginx -t 2>&1`)).trim());
    process.exit(1);
  }
  console.log('');

  console.log('[5] reload nginx:');
  console.log((await exec(c, '/opt/module/tengine-2.4.1/sbin/nginx -s reload 2>&1 || systemctl reload nginx')).trim());
  console.log('');

  console.log('[6] 验证 health 仍然 200:');
  console.log((await exec(c, 'curl -sk -o /dev/null -w "health=%{http_code} time=%{time_total}s\\n" https://vido.smsend.cn/api/health')).trim());

  c.end();
  console.log('[fix-timeout] ✅ 完成');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
