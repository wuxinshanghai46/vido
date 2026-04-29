#!/usr/bin/env node
/**
 * 迁移脚本 Step 2 — 续接：安装 Node.js 16 (nvm) + 传输 + 解压 + 启动
 *
 * 旧服务器用 nvm + Node 16.20.2，新服务器照搬
 */
const { Client } = require('ssh2');

const OLD = { host: '119.29.128.12', username: 'root', password: process.env.OLD_SERVER_PASS, readyTimeout: 30000 };
const NEW = { host: '43.98.167.151', username: 'root', password: process.env.NEW_SERVER_PASS, readyTimeout: 30000 };
const REMOTE_ROOT = '/opt/vido/app';
const ARCHIVE = '/tmp/vido-app-backup.tar.gz';

function connect(cfg, label) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => { console.log(`[${label}] connected`); resolve(c); });
    c.on('error', e => reject(new Error(`[${label}] ${e.message}`)));
    c.connect(cfg);
  });
}

function exec(c, cmd, label, { timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[${label}] timeout: ${cmd.slice(0,80)}`)), timeout);
    c.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err); }
      let out = '', errOut = '';
      stream.on('close', code => { clearTimeout(timer); resolve({ code, out, errOut }); });
      stream.on('data', d => { out += d.toString(); process.stdout.write(d); });
      stream.stderr.on('data', d => { errOut += d.toString(); process.stderr.write(d); });
    });
  });
}

(async () => {
  console.log('\n=== Step 2 迁移续接 ===\n');

  const [oldConn, newConn] = await Promise.all([
    connect(OLD, '旧'),
    connect(NEW, '新')
  ]);

  // --- 1. 在新服务器安装 nvm + Node 16 ---
  console.log('\n--- 1. 安装 nvm + Node 16 ---');
  const nodeCheck = await exec(newConn, 'source /root/.nvm/nvm.sh 2>/dev/null; node --version 2>/dev/null || echo "NOT_FOUND"', '新');

  if (nodeCheck.out.includes('NOT_FOUND')) {
    console.log('安装 nvm...');
    await exec(newConn, 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash', '新', { timeout: 60000 });

    console.log('安装 Node.js 16.20.2...');
    await exec(newConn, 'source /root/.nvm/nvm.sh && nvm install 16.20.2 && nvm alias default 16.20.2', '新', { timeout: 120000 });

    // 创建全局 symlink 让 PM2 也能用
    await exec(newConn, `
      source /root/.nvm/nvm.sh
      NODE_PATH=$(which node)
      NPM_PATH=$(which npm)
      ln -sf $NODE_PATH /usr/local/bin/node
      ln -sf $NPM_PATH /usr/local/bin/npm
      ln -sf $(dirname $NODE_PATH)/npx /usr/local/bin/npx
      node --version
      npm --version
    `, '新');
  } else {
    console.log(`Node.js 已存在: ${nodeCheck.out.trim()}`);
  }

  // 安装 PM2
  console.log('\n--- 2. 安装 PM2 ---');
  const pm2Check = await exec(newConn, 'source /root/.nvm/nvm.sh 2>/dev/null; pm2 --version 2>/dev/null || echo "NOT_FOUND"', '新');
  if (pm2Check.out.includes('NOT_FOUND')) {
    await exec(newConn, 'source /root/.nvm/nvm.sh && npm install -g pm2', '新', { timeout: 60000 });
    await exec(newConn, `
      source /root/.nvm/nvm.sh
      PM2_PATH=$(which pm2)
      ln -sf $PM2_PATH /usr/local/bin/pm2
      pm2 --version
    `, '新');
  } else {
    console.log(`PM2 已存在: ${pm2Check.out.trim()}`);
  }

  // --- 3. 检查传输状态 / 重新传输 ---
  console.log('\n--- 3. 文件传输 ---');
  const archiveCheck = await exec(newConn, `ls -lh ${ARCHIVE} 2>/dev/null || echo "NO_FILE"`, '新');

  // 旧服务器上的大小
  const oldSize = await exec(oldConn, `stat -c%s ${ARCHIVE} 2>/dev/null || echo "0"`, '旧');
  const oldBytes = parseInt(oldSize.out.trim()) || 0;

  let needTransfer = true;
  if (!archiveCheck.out.includes('NO_FILE')) {
    const newSize = await exec(newConn, `stat -c%s ${ARCHIVE} 2>/dev/null || echo "0"`, '新');
    const newBytes = parseInt(newSize.out.trim()) || 0;
    console.log(`旧服务器: ${(oldBytes/1024/1024/1024).toFixed(2)}G, 新服务器: ${(newBytes/1024/1024/1024).toFixed(2)}G`);
    if (newBytes > 0 && Math.abs(newBytes - oldBytes) < 1024) {
      console.log('文件已完整传输，跳过');
      needTransfer = false;
    } else {
      console.log('文件不完整，重新传输...');
    }
  }

  if (needTransfer) {
    console.log(`传输 ${(oldBytes/1024/1024/1024).toFixed(2)}G 中... (可能需要几分钟)`);
    // 从旧服务器推送到新服务器（旧服务器有 sshpass）
    const oldHasSshpass = await exec(oldConn, 'which sshpass 2>/dev/null && echo "YES" || echo "NO"', '旧');

    if (oldHasSshpass.out.includes('YES')) {
      console.log('从旧服务器推送到新服务器...');
      await exec(oldConn, `sshpass -p '${NEW.password}' scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${ARCHIVE} ${NEW.username}@${NEW.host}:${ARCHIVE}`, '旧', { timeout: 1800000 });
    } else {
      // 旧服务器装 sshpass
      await exec(oldConn, 'yum install -y sshpass', '旧', { timeout: 30000 });
      await exec(oldConn, `sshpass -p '${NEW.password}' scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${ARCHIVE} ${NEW.username}@${NEW.host}:${ARCHIVE}`, '旧', { timeout: 1800000 });
    }

    // 验证
    const verify = await exec(newConn, `stat -c%s ${ARCHIVE}`, '新');
    const vBytes = parseInt(verify.out.trim()) || 0;
    if (Math.abs(vBytes - oldBytes) > 1024) {
      throw new Error(`传输不完整: 期望 ${oldBytes} 字节, 实际 ${vBytes} 字节`);
    }
    console.log('传输完成并验证');
  }

  // --- 4. 解压 ---
  console.log('\n--- 4. 解压 ---');
  await exec(newConn, 'mkdir -p /opt/vido', '新');
  await exec(newConn, `cd /opt/vido && tar xzf ${ARCHIVE}`, '新', { timeout: 300000 });

  const ls = await exec(newConn, `ls ${REMOTE_ROOT}/package.json ${REMOTE_ROOT}/src/server.js`, '新');
  if (ls.code !== 0) throw new Error('解压后文件不完整');
  console.log('解压完成');

  // --- 5. 更新 .env ---
  console.log('\n--- 5. 配置 .env ---');
  const envBefore = await exec(newConn, `cat ${REMOTE_ROOT}/.env 2>/dev/null`, '新');

  await exec(newConn, `
    cd ${REMOTE_ROOT}
    if [ -f .env ]; then
      if grep -q '^PUBLIC_URL=' .env; then
        sed -i 's|^PUBLIC_URL=.*|PUBLIC_URL=http://${NEW.host}:4600|' .env
      else
        echo 'PUBLIC_URL=http://${NEW.host}:4600' >> .env
      fi
    else
      echo 'PORT=4600' > .env
      echo 'PUBLIC_URL=http://${NEW.host}:4600' >> .env
    fi
  `, '新');

  const envAfter = await exec(newConn, `cat ${REMOTE_ROOT}/.env`, '新');
  console.log(`\n.env 内容:\n${envAfter.out}`);

  // --- 6. npm rebuild ---
  console.log('\n--- 6. npm rebuild ---');
  await exec(newConn, `source /root/.nvm/nvm.sh && cd ${REMOTE_ROOT} && npm rebuild 2>&1 || true`, '新', { timeout: 120000 });

  // --- 7. PM2 启动 ---
  console.log('\n--- 7. PM2 启动 ---');
  await exec(newConn, 'source /root/.nvm/nvm.sh && pm2 delete vido 2>/dev/null || true', '新');
  await exec(newConn, `source /root/.nvm/nvm.sh && cd ${REMOTE_ROOT} && pm2 start src/server.js --name vido --update-env`, '新');
  await exec(newConn, 'source /root/.nvm/nvm.sh && pm2 save', '新');

  console.log('等待服务启动 (5s)...');
  await new Promise(r => setTimeout(r, 5000));

  await exec(newConn, 'source /root/.nvm/nvm.sh && pm2 list', '新');
  const health = await exec(newConn, 'curl -s http://127.0.0.1:4600/api/health 2>&1 || echo "(no response)"', '新');
  console.log(`\nHealth: ${health.out.trim()}`);

  // --- 8. 清理 ---
  console.log('\n--- 8. 清理 ---');
  await exec(oldConn, `rm -f ${ARCHIVE}`, '旧');
  await exec(newConn, `rm -f ${ARCHIVE}`, '新');

  oldConn.end();
  newConn.end();

  console.log('\n' + '='.repeat(50));
  console.log(' 迁移完成!');
  console.log(` 新地址: http://${NEW.host}:4600`);
  console.log('='.repeat(50) + '\n');
})().catch(e => {
  console.error('\n 失败:', e.message);
  process.exit(1);
});
