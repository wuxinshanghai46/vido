#!/usr/bin/env node
const { Client } = require('ssh2');

const OLD = { host: '119.29.128.12', username: 'root', password: process.env.OLD_SERVER_PASS, readyTimeout: 15000 };
const NEW = { host: '43.98.167.151', username: 'root', password: process.env.NEW_SERVER_PASS, readyTimeout: 15000 };
const REMOTE_ROOT = '/opt/vido/app';
const ARCHIVE = '/tmp/vido-app-backup.tar.gz';

function connect(cfg, label) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    const t = setTimeout(() => reject(new Error(`[${label}] SSH 超时`)), 20000);
    c.on('ready', () => { clearTimeout(t); resolve(c); });
    c.on('error', e => { clearTimeout(t); reject(new Error(`[${label}] ${e.message}`)); });
    c.connect(cfg);
  });
}

function exec(c, cmd) {
  return new Promise((resolve) => {
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
  console.log('=== 探测迁移状态 ===\n');

  let oldC, newC;
  try { oldC = await connect(OLD, '旧'); console.log('[旧 119.29.128.12] 连接 OK'); }
  catch (e) { console.log(`[旧] 连接失败: ${e.message}`); }

  try { newC = await connect(NEW, '新'); console.log('[新 43.98.167.151] 连接 OK'); }
  catch (e) { console.log(`[新] 连接失败: ${e.message}`); }

  console.log();

  if (oldC) {
    console.log('--- 旧服务器 ---');
    const ar = await exec(oldC, `ls -lh ${ARCHIVE} 2>&1 || true`);
    console.log(`archive: ${ar.out}`);
    const sz = await exec(oldC, `stat -c%s ${ARCHIVE} 2>/dev/null || echo 0`);
    console.log(`archive bytes: ${sz.out}`);
    const vido = await exec(oldC, 'pm2 list 2>&1 | grep -E "vido|online|stopped" | head -5');
    console.log(`pm2:\n${vido.out}`);
    oldC.end();
  }

  console.log();

  if (newC) {
    console.log('--- 新服务器 ---');
    const os = await exec(newC, 'cat /etc/os-release 2>/dev/null | grep -E "^(NAME|VERSION)=" | head -2');
    console.log(`OS:\n${os.out}`);
    const node = await exec(newC, 'source /root/.nvm/nvm.sh 2>/dev/null; node --version 2>/dev/null || echo NOT_INSTALLED');
    console.log(`node: ${node.out}`);
    const pm2 = await exec(newC, 'source /root/.nvm/nvm.sh 2>/dev/null; pm2 --version 2>/dev/null || echo NOT_INSTALLED');
    console.log(`pm2: ${pm2.out}`);
    const ar = await exec(newC, `ls -lh ${ARCHIVE} 2>&1 || true`);
    console.log(`archive: ${ar.out}`);
    const sz = await exec(newC, `stat -c%s ${ARCHIVE} 2>/dev/null || echo 0`);
    console.log(`archive bytes: ${sz.out}`);
    const dir = await exec(newC, `ls -la ${REMOTE_ROOT} 2>&1 | head -20 || true`);
    console.log(`${REMOTE_ROOT}:\n${dir.out}`);
    const env = await exec(newC, `cat ${REMOTE_ROOT}/.env 2>/dev/null | head -30 || echo "(no .env)"`);
    console.log(`.env:\n${env.out}`);
    const pmList = await exec(newC, 'source /root/.nvm/nvm.sh 2>/dev/null; pm2 list 2>&1 | head -15');
    console.log(`pm2 list:\n${pmList.out}`);
    const health = await exec(newC, 'curl -s -m 3 http://127.0.0.1:4600/api/health 2>&1 | head -c 300 || echo "(no response)"');
    console.log(`health: ${health.out}`);
    newC.end();
  }
})();
