#!/usr/bin/env node
/**
 * 迁移续传 — 从 "传输中断" 状态恢复
 * 1) rsync 续传 archive (不从 0 开始)
 * 2) 解压 / .env / npm rebuild / pm2 启动
 */
const { Client } = require('ssh2');

const OLD = { host: '119.29.128.12', username: 'root', password: process.env.OLD_SERVER_PASS, readyTimeout: 30000 };
const NEW = { host: '43.98.167.151', username: 'root', password: process.env.NEW_SERVER_PASS, readyTimeout: 30000 };
const REMOTE_ROOT = '/opt/vido/app';
const ARCHIVE = '/tmp/vido-app-backup.tar.gz';

function connect(cfg, label) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    const t = setTimeout(() => reject(new Error(`[${label}] SSH 超时`)), 30000);
    c.on('ready', () => { clearTimeout(t); console.log(`[${label}] connected`); resolve(c); });
    c.on('error', e => { clearTimeout(t); reject(new Error(`[${label}] ${e.message}`)); });
    c.connect(cfg);
  });
}

function exec(c, cmd, label, { timeout = 600000, silent = false } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[${label}] timeout: ${cmd.slice(0, 100)}`)), timeout);
    c.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err); }
      let out = '';
      stream.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
      stream.on('data', d => { out += d.toString(); if (!silent) process.stdout.write(d); });
      stream.stderr.on('data', d => { out += d.toString(); if (!silent) process.stderr.write(d); });
    });
  });
}

async function step(label, fn) {
  console.log(`\n▶ ${label}`);
  console.log('-'.repeat(60));
  await fn();
  console.log(`✓ ${label}`);
}

(async () => {
  const [oldC, newC] = await Promise.all([connect(OLD, '旧'), connect(NEW, '新')]);

  // 1. 确认状态
  await step('1. 校验 archive 完整性', async () => {
    const oldSize = parseInt((await exec(oldC, `stat -c%s ${ARCHIVE}`, '旧', { silent: true })).out.trim()) || 0;
    const newSize = parseInt((await exec(newC, `stat -c%s ${ARCHIVE} 2>/dev/null || echo 0`, '新', { silent: true })).out.trim()) || 0;
    console.log(`  旧: ${oldSize} bytes (${(oldSize / 1024 / 1024 / 1024).toFixed(2)}G)`);
    console.log(`  新: ${newSize} bytes (${(newSize / 1024 / 1024 / 1024).toFixed(2)}G)`);

    if (Math.abs(oldSize - newSize) < 1024 && newSize > 0) {
      console.log('  ✓ 已完整，跳过传输');
      return;
    }

    // 2. rsync 续传（旧 → 新）
    console.log('  需要续传...');
    // 确保旧服务器有 rsync
    await exec(oldC, 'which rsync >/dev/null 2>&1 || yum install -y rsync', '旧', { timeout: 60000 });
    // 确保新服务器有 rsync
    await exec(newC, 'which rsync >/dev/null 2>&1 || yum install -y rsync', '新', { timeout: 60000 });
    // 旧服务器有 sshpass
    await exec(oldC, 'which sshpass >/dev/null 2>&1 || yum install -y sshpass', '旧', { timeout: 60000 });

    console.log('  从旧服务器 rsync --partial --append-verify 推送...');
    const rsyncCmd = `sshpass -p '${NEW.password}' rsync -avz --partial --append-verify --progress -e 'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null' ${ARCHIVE} ${NEW.username}@${NEW.host}:${ARCHIVE}`;
    await exec(oldC, rsyncCmd, '旧', { timeout: 1800000 });

    // 验证
    const finalSize = parseInt((await exec(newC, `stat -c%s ${ARCHIVE}`, '新', { silent: true })).out.trim()) || 0;
    if (Math.abs(finalSize - oldSize) > 1024) {
      throw new Error(`传输仍不完整: 期望 ${oldSize}, 实际 ${finalSize}`);
    }
    console.log(`  ✓ 传输完成，大小校验通过: ${finalSize} bytes`);
  });

  // 3. 解压
  await step('2. 解压到 /opt/vido/app', async () => {
    // 清一下残留
    await exec(newC, `ls ${REMOTE_ROOT}/package.json 2>/dev/null && echo EXISTS || echo EMPTY`, '新', { silent: true });
    await exec(newC, 'mkdir -p /opt/vido', '新');
    await exec(newC, `cd /opt/vido && tar xzf ${ARCHIVE}`, '新', { timeout: 600000 });
    const verify = await exec(newC, `ls ${REMOTE_ROOT}/package.json ${REMOTE_ROOT}/src/server.js 2>&1`, '新', { silent: true });
    if (verify.code !== 0) throw new Error(`解压后关键文件缺失: ${verify.out}`);
    console.log('  ✓ package.json + src/server.js 存在');
  });

  // 4. 配置 .env
  await step('3. 配置 .env (PUBLIC_URL 指向新 IP)', async () => {
    const envBefore = await exec(newC, `cat ${REMOTE_ROOT}/.env 2>/dev/null || echo "(无)"`, '新', { silent: true });
    console.log(`  当前 .env:\n${envBefore.out.split('\n').map(l => '    ' + l).join('\n')}`);

    await exec(newC, `
      cd ${REMOTE_ROOT}
      if [ -f .env ]; then
        if grep -q '^PUBLIC_URL=' .env; then
          sed -i 's|^PUBLIC_URL=.*|PUBLIC_URL=http://${NEW.host}:4600|' .env
        else
          echo 'PUBLIC_URL=http://${NEW.host}:4600' >> .env
        fi
        if ! grep -q '^PORT=' .env; then
          sed -i '1i PORT=4600' .env
        fi
      else
        printf 'PORT=4600\\nPUBLIC_URL=http://${NEW.host}:4600\\n' > .env
      fi
    `, '新', { silent: true });

    const envAfter = await exec(newC, `cat ${REMOTE_ROOT}/.env`, '新', { silent: true });
    console.log(`  更新后 .env:\n${envAfter.out.split('\n').map(l => '    ' + l).join('\n')}`);
  });

  // 5. npm rebuild
  await step('4. npm rebuild (确保 native 包兼容新系统)', async () => {
    const result = await exec(newC, `source /root/.nvm/nvm.sh && cd ${REMOTE_ROOT} && npm rebuild 2>&1 | tail -30`, '新', { timeout: 300000 });
    console.log(`  rebuild exit=${result.code}`);
  });

  // 6. PM2 启动
  await step('5. PM2 启动 vido', async () => {
    await exec(newC, 'source /root/.nvm/nvm.sh && pm2 delete vido 2>/dev/null || true', '新', { silent: true });
    await exec(newC, `source /root/.nvm/nvm.sh && cd ${REMOTE_ROOT} && pm2 start src/server.js --name vido --update-env`, '新');
    await exec(newC, 'source /root/.nvm/nvm.sh && pm2 save', '新', { silent: true });

    console.log('  等待 5s 让服务启动...');
    await new Promise(r => setTimeout(r, 5000));

    const health = await exec(newC, 'curl -s -m 5 http://127.0.0.1:4600/api/health 2>&1 || echo "(无响应)"', '新', { silent: true });
    console.log(`  /api/health: ${health.out.slice(0, 300)}`);
    const logs = await exec(newC, 'source /root/.nvm/nvm.sh && pm2 logs vido --lines 15 --nostream 2>&1 | tail -30', '新', { silent: true });
    console.log(`  pm2 logs (tail):\n${logs.out}`);
  });

  // 7. 清理 archive
  await step('6. 清理临时 archive', async () => {
    await exec(oldC, `rm -f ${ARCHIVE}`, '旧', { silent: true });
    await exec(newC, `rm -f ${ARCHIVE}`, '新', { silent: true });
    console.log('  ✓ 两侧 archive 已删除');
  });

  oldC.end();
  newC.end();

  console.log('\n' + '='.repeat(60));
  console.log(' ✅ 迁移完成');
  console.log(` 新地址: http://${NEW.host}:4600`);
  console.log(` 健康检查: http://${NEW.host}:4600/api/health`);
  console.log('='.repeat(60));
  console.log('\n📋 后续 (需用户确认):');
  console.log('  1. 浏览器访问 http://43.98.167.151:4600 做功能验证');
  console.log('  2. 更新 scripts/deploy-kb.js 的 VIDO_DEPLOY_HOST 指向新 IP');
  console.log('  3. 旧服务器 PM2 vido 何时停? (建议并行跑 24-48h 观察)');
  console.log('  4. 有域名的话改 DNS A 记录');
})().catch(e => {
  console.error('\n❌ 失败:', e.message);
  process.exit(1);
});
