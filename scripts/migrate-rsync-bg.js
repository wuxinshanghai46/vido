#!/usr/bin/env node
/**
 * 在旧服务器 nohup 启动 rsync 后台续传，然后定期拉进度
 */
const { Client } = require('ssh2');

const OLD = { host: '119.29.128.12', username: 'root', password: process.env.OLD_SERVER_PASS, readyTimeout: 30000 };
const NEW = { host: '43.98.167.151', username: 'root', password: process.env.NEW_SERVER_PASS, readyTimeout: 30000 };
const ARCHIVE = '/tmp/vido-app-backup.tar.gz';
const RSYNC_LOG = '/tmp/vido-rsync.log';
const RSYNC_PID_FILE = '/tmp/vido-rsync.pid';

function connect(cfg, label) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    const t = setTimeout(() => reject(new Error(`[${label}] SSH 超时`)), 30000);
    c.on('ready', () => { clearTimeout(t); resolve(c); });
    c.on('error', e => { clearTimeout(t); reject(new Error(`[${label}] ${e.message}`)); });
    c.connect(cfg);
  });
}

function exec(c, cmd, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: -1, out: '(timeout)' }), timeout);
    c.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); return resolve({ code: -1, out: err.message }); }
      let out = '';
      stream.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => out += d.toString());
    });
  });
}

(async () => {
  const [oldC, newC] = await Promise.all([connect(OLD, '旧'), connect(NEW, '新')]);

  console.log('\n=== rsync 后台续传 ===\n');

  // 目标大小
  const oldSize = parseInt((await exec(oldC, `stat -c%s ${ARCHIVE}`)).out.trim()) || 0;
  console.log(`目标大小: ${oldSize} bytes (${(oldSize / 1024 / 1024 / 1024).toFixed(2)}G)`);

  // 检查 rsync 是否还在跑
  const runCheck = await exec(oldC, `pgrep -f "rsync.*vido-app-backup" | head -3`);
  if (runCheck.out.trim()) {
    console.log(`rsync 已在跑 (pid=${runCheck.out.trim()})，不重启`);
  } else {
    console.log('启动 rsync 后台...');
    const cmd = `nohup sshpass -p '${NEW.password}' rsync -avz --partial --append-verify --progress -e 'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=30 -o ServerAliveCountMax=10' ${ARCHIVE} ${NEW.username}@${NEW.host}:${ARCHIVE} > ${RSYNC_LOG} 2>&1 & echo $! > ${RSYNC_PID_FILE}`;
    await exec(oldC, cmd);
    const pid = (await exec(oldC, `cat ${RSYNC_PID_FILE}`)).out.trim();
    console.log(`后台 pid=${pid}`);
  }

  // 轮询
  console.log('\n每 30s 查进度...');
  const startTime = Date.now();
  const TIMEOUT_MIN = 40;

  while (true) {
    await new Promise(r => setTimeout(r, 30000));

    const newSize = parseInt((await exec(newC, `stat -c%s ${ARCHIVE} 2>/dev/null || echo 0`)).out.trim()) || 0;
    const pct = ((newSize / oldSize) * 100).toFixed(2);
    const gb = (newSize / 1024 / 1024 / 1024).toFixed(3);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`[+${elapsed}s] ${gb}G / ${(oldSize / 1024 / 1024 / 1024).toFixed(2)}G (${pct}%)`);

    // 完成？
    if (Math.abs(oldSize - newSize) < 1024) {
      console.log('\n✅ 传输完成');
      break;
    }

    // rsync 挂了？
    const alive = await exec(oldC, `pgrep -f "rsync.*vido-app-backup" | head -1`);
    if (!alive.out.trim()) {
      console.log('\n⚠ rsync 进程已退出，查看日志...');
      const log = await exec(oldC, `tail -20 ${RSYNC_LOG}`);
      console.log(log.out);

      // 再拉一次状态
      const finalSize = parseInt((await exec(newC, `stat -c%s ${ARCHIVE} 2>/dev/null || echo 0`)).out.trim()) || 0;
      if (Math.abs(oldSize - finalSize) < 1024) {
        console.log('✅ 但大小匹配，视为成功');
        break;
      }

      // 重启 rsync
      console.log('重启 rsync...');
      const cmd = `nohup sshpass -p '${NEW.password}' rsync -avz --partial --append-verify --progress -e 'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=30 -o ServerAliveCountMax=10' ${ARCHIVE} ${NEW.username}@${NEW.host}:${ARCHIVE} > ${RSYNC_LOG} 2>&1 & echo $! > ${RSYNC_PID_FILE}`;
      await exec(oldC, cmd);
      const pid = (await exec(oldC, `cat ${RSYNC_PID_FILE}`)).out.trim();
      console.log(`新 pid=${pid}`);
    }

    if ((Date.now() - startTime) / 60000 > TIMEOUT_MIN) {
      console.log(`\n⏱ 超过 ${TIMEOUT_MIN} 分钟，退出轮询（rsync 仍在后台跑，可手动检查）`);
      break;
    }
  }

  oldC.end();
  newC.end();
})();
