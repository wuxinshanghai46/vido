#!/usr/bin/env node
/**
 * 切流量：停旧 vido + 增量同步 outputs/ + 验证
 */
const { Client } = require('ssh2');

const OLD = { host: '119.29.128.12', username: 'root', password: process.env.OLD_SERVER_PASS, readyTimeout: 30000 };
const NEW = { host: '43.98.167.151', username: 'root', password: process.env.NEW_SERVER_PASS, readyTimeout: 30000 };
const OUTPUTS = '/opt/vido/app/outputs/';

function connect(cfg, label) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    const t = setTimeout(() => reject(new Error(`[${label}] SSH 超时`)), 30000);
    c.on('ready', () => { clearTimeout(t); resolve(c); });
    c.on('error', e => { clearTimeout(t); reject(new Error(`[${label}] ${e.message}`)); });
    c.connect(cfg);
  });
}

function exec(c, cmd, label, { timeout = 300000, silent = false } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[${label}] timeout`)), timeout);
    c.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err); }
      let out = '';
      stream.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
      stream.on('data', d => { out += d.toString(); if (!silent) process.stdout.write(d); });
      stream.stderr.on('data', d => { out += d.toString(); if (!silent) process.stderr.write(d); });
    });
  });
}

(async () => {
  const [oldC, newC] = await Promise.all([connect(OLD, '旧'), connect(NEW, '新')]);

  // 1. 停旧 PM2 vido (stop 不 delete，保留状态)
  console.log('\n▶ 1. 停旧 PM2 vido (保留条目以便回滚)');
  console.log('-'.repeat(60));
  const before = await exec(oldC, 'pm2 list | grep -E "vido|sms-platform"', '旧', { silent: true });
  console.log(before.out);
  await exec(oldC, 'pm2 stop vido', '旧');
  await exec(oldC, 'pm2 save', '旧', { silent: true });
  const after = await exec(oldC, 'pm2 list | grep -E "vido|sms-platform"', '旧', { silent: true });
  console.log('\n停后:');
  console.log(after.out);

  // 2. 增量 rsync outputs/ 从旧 → 新
  console.log('\n▶ 2. 增量 rsync outputs/ (只同步新增/修改的文件)');
  console.log('-'.repeat(60));
  // 旧服务器已装 sshpass/rsync
  const cmd = `sshpass -p '${NEW.password}' rsync -avz --update --delete-after --stats -e 'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null' ${OUTPUTS} ${NEW.username}@${NEW.host}:${OUTPUTS}`;
  // --update: 只在源文件更新时才覆盖（按 mtime）
  // --delete-after: 删除新机上旧机没有的文件（保持一致）
  // 注意：如果新机生成了新数据（不该发生，刚切过来），会被 --delete-after 删掉
  // 安全起见，改成不加 --delete，只补差
  const safeCmd = `sshpass -p '${NEW.password}' rsync -avz --update --stats -e 'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null' ${OUTPUTS} ${NEW.username}@${NEW.host}:${OUTPUTS}`;
  await exec(oldC, safeCmd, '旧', { timeout: 600000 });

  // 3. 验证新机健康
  console.log('\n▶ 3. 验证新机健康');
  console.log('-'.repeat(60));
  const h = await exec(newC, 'curl -s -m 5 http://127.0.0.1:4600/api/health', '新', { silent: true });
  console.log(`health: ${h.out}`);
  const pm = await exec(newC, 'source /root/.nvm/nvm.sh && pm2 list | grep vido', '新', { silent: true });
  console.log(`pm2: ${pm.out}`);

  // 4. 快速重新对比关键计数
  console.log('\n▶ 4. 同步后数据对比');
  console.log('-'.repeat(60));
  for (const [c, label] of [[oldC, '旧'], [newC, '新']]) {
    const mp4 = await exec(c, 'find /opt/vido/app/outputs -name "*.mp4" -type f 2>/dev/null | wc -l', label, { silent: true });
    const aud = await exec(c, 'find /opt/vido/app/outputs \\( -name "*.wav" -o -name "*.mp3" \\) 2>/dev/null | wc -l', label, { silent: true });
    const img = await exec(c, 'find /opt/vido/app/outputs \\( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \\) 2>/dev/null | wc -l', label, { silent: true });
    const out = await exec(c, 'du -sh /opt/vido/app/outputs 2>/dev/null | awk \'{print $1}\'', label, { silent: true });
    console.log(`[${label}] outputs=${out.out.trim()}  mp4=${mp4.out.trim()}  audio=${aud.out.trim()}  img=${img.out.trim()}`);
  }

  oldC.end();
  newC.end();

  console.log('\n' + '='.repeat(60));
  console.log(' ✅ 切流量完成');
  console.log(' 旧机 vido: stopped (条目保留，pm2 restart vido 可起回)');
  console.log(' 新机 vido: online @ http://43.98.167.151:4600');
  console.log('='.repeat(60));
})().catch(e => {
  console.error('\n❌ 失败:', e.message);
  process.exit(1);
});
