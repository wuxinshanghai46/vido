#!/usr/bin/env node
/**
 * 一次性：把生产 .env 里的 PUBLIC_BASE_URL 更新为新域名，pm2 restart --update-env
 * 用法：
 *   VIDO_DEPLOY_HOST=43.98.167.151 VIDO_DEPLOY_PASSWORD=... \
 *     node scripts/update-public-base-url.js https://vido.smsend.cn
 * 凭证只走 env，不落盘。
 */
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PWD  = process.env.VIDO_DEPLOY_PASSWORD;
const NEW  = process.argv[2] || 'https://vido.smsend.cn';

if (!HOST || !PWD) {
  console.error('需要 VIDO_DEPLOY_HOST / VIDO_DEPLOY_PASSWORD');
  process.exit(1);
}
if (!/^https?:\/\//.test(NEW)) { console.error('URL 需带协议'); process.exit(2); }

function exec(c, cmd) {
  return new Promise((resolve, reject) => {
    c.exec(cmd, (err, s) => {
      if (err) return reject(err);
      let o='', e='';
      s.on('data', d => o += d);
      s.stderr.on('data', d => e += d);
      s.on('close', code => resolve({ code, stdout: o, stderr: e }));
    });
  });
}

(async () => {
  const c = new Client();
  await new Promise((res, rej) => {
    c.on('ready', res); c.on('error', rej);
    c.connect({ host: HOST, username: USER, password: PWD, port: 22, readyTimeout: 20000 });
  });
  console.log('✓ 已连接');

  // 找 .env 位置
  const { stdout: findOut } = await exec(c,
    'for f in /etc/.env /opt/vido/app/.env /opt/vido/.env; do [ -f "$f" ] && echo "$f"; done');
  const envFiles = findOut.trim().split('\n').filter(Boolean);
  console.log('  找到 .env:', envFiles);
  if (!envFiles.length) { console.error('✗ 无 .env'); c.end(); process.exit(3); }

  for (const f of envFiles) {
    const cmd = `
if grep -q "^PUBLIC_BASE_URL=" "${f}"; then
  sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=${NEW}|" "${f}"
  echo "更新: ${f}"
else
  echo "PUBLIC_BASE_URL=${NEW}" >> "${f}"
  echo "新增: ${f}"
fi
grep "PUBLIC_BASE_URL" "${f}"
    `;
    const r = await exec(c, cmd);
    console.log('  ' + r.stdout.trim().replace(/\n/g, '\n  '));
  }

  // pm2 restart --update-env
  console.log('\n▶ pm2 restart vido --update-env');
  const r2 = await exec(c, 'pm2 restart vido --update-env 2>&1 | tail -5');
  console.log(r2.stdout);

  // 验证环境变量是否生效
  console.log('▶ 验证 env 进程内可见');
  const r3 = await exec(c,
    'sleep 2 && pm2 env 0 2>/dev/null | grep PUBLIC_BASE_URL || echo "未直接读到"');
  console.log(r3.stdout);

  // 调用一个会回显 base URL 的接口验证
  console.log('▶ /api/dh/status（通过 curl 本机验证）');
  const r4 = await exec(c,
    'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/dh/status');
  console.log('  local HTTP', r4.stdout.trim());

  c.end();
  console.log('\n✓ 完成');
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
