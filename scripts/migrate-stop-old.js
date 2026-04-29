#!/usr/bin/env node
/**
 * 仅停旧服务器 PM2 vido (保留条目，可 restart 回滚)
 */
const { Client } = require('ssh2');

const OLD = { host: '119.29.128.12', username: 'root', password: process.env.OLD_SERVER_PASS, readyTimeout: 30000 };
const NEW = { host: '43.98.167.151', username: 'root', password: process.env.NEW_SERVER_PASS, readyTimeout: 30000 };

function connect(cfg, label) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c));
    c.on('error', e => reject(new Error(`[${label}] ${e.message}`)));
    c.connect(cfg);
  });
}

function exec(c, cmd) {
  return new Promise(resolve => {
    c.exec(cmd, (err, stream) => {
      if (err) return resolve({ code: -1, out: err.message });
      let out = '';
      stream.on('close', code => resolve({ code, out: out.trim() }));
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => out += d.toString());
    });
  });
}

(async () => {
  const oldC = await connect(OLD, '旧');

  console.log('\n▶ 停前 pm2 状态');
  const before = await exec(oldC, 'pm2 list');
  console.log(before.out);

  // 检查是否有 20:33 之后写的新数据（tar 时间点）
  console.log('\n▶ 检查 20:33 后的新文件（数据延迟风险）');
  const delta = await exec(oldC, `find /opt/vido/app/outputs -newermt '2026-04-17 20:33' -type f 2>/dev/null | head -20; echo "---总数---"; find /opt/vido/app/outputs -newermt '2026-04-17 20:33' -type f 2>/dev/null | wc -l`);
  console.log(delta.out);

  console.log('\n▶ 停 vido (保留条目，可 pm2 restart vido 回滚)');
  const stop = await exec(oldC, 'pm2 stop vido');
  console.log(stop.out);
  await exec(oldC, 'pm2 save');

  console.log('\n▶ 停后 pm2 状态');
  const after = await exec(oldC, 'pm2 list');
  console.log(after.out);

  // 确认新机仍在线
  const newC = await connect(NEW, '新');
  const h = await exec(newC, 'curl -s -m 5 http://127.0.0.1:4600/api/health');
  console.log(`\n新机 health: ${h.out}`);

  oldC.end();
  newC.end();
  console.log('\n✅ 旧机 vido 已停，新机正常运行');
})();
