#!/usr/bin/env node
/**
 * VIDO 服务器迁移脚本 — 自动检测 OS 包管理器
 */
const { Client } = require('ssh2');

const OLD_SERVER = {
  host: '119.29.128.12',
  username: 'root',
  password: process.env.OLD_SERVER_PASS,
  readyTimeout: 30000
};

const NEW_SERVER = {
  host: '43.98.167.151',
  username: 'root',
  password: process.env.NEW_SERVER_PASS,
  readyTimeout: 30000
};

const REMOTE_ROOT = '/opt/vido/app';
const ARCHIVE = '/tmp/vido-app-backup.tar.gz';

function connect(config, label) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => { console.log(`  [${label}] SSH 连接成功`); resolve(c); });
    c.on('error', (err) => reject(new Error(`[${label}] SSH 连接失败: ${err.message}`)));
    c.connect(config);
  });
}

function exec(c, cmd, label, { timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[${label}] 命令超时`)), timeout);
    c.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err); }
      let out = '', errOut = '';
      stream.on('close', (code) => { clearTimeout(timer); resolve({ code, out, errOut }); });
      stream.on('data', d => { out += d.toString(); process.stdout.write(d); });
      stream.stderr.on('data', d => { errOut += d.toString(); process.stderr.write(d); });
    });
  });
}

async function step(label, fn) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`▶ ${label}`);
  console.log('='.repeat(60));
  await fn();
  console.log(`✓ ${label} — 完成`);
}

(async () => {
  console.log('\n VIDO 服务器迁移开始');
  console.log(`   旧: ${OLD_SERVER.host} -> 新: ${NEW_SERVER.host}\n`);

  // ========== Step 1: 连接两台服务器 ==========
  let oldConn, newConn;
  await step('Step 1: 连接服务器', async () => {
    [oldConn, newConn] = await Promise.all([
      connect(OLD_SERVER, '旧'),
      connect(NEW_SERVER, '新')
    ]);
  });

  // ========== Step 2: 检测新服务器 OS 并安装依赖 ==========
  await step('Step 2: 新服务器环境准备', async () => {
    // 检测 OS
    const osInfo = await exec(newConn, 'cat /etc/os-release 2>/dev/null | head -5 || cat /etc/redhat-release 2>/dev/null || echo "unknown"', '新');
    console.log(`  OS: ${osInfo.out.trim().split('\n')[0]}`);

    // 检测包管理器
    const pkgMgr = await exec(newConn, 'which dnf 2>/dev/null && echo "dnf" || (which yum 2>/dev/null && echo "yum") || (which apt-get 2>/dev/null && echo "apt") || echo "unknown"', '新');
    const pm = pkgMgr.out.trim().split('\n').pop();
    console.log(`  包管理器: ${pm}`);

    // 安装 Node.js
    const nodeCheck = await exec(newConn, 'node --version 2>/dev/null || echo "NOT_FOUND"', '新');
    if (nodeCheck.out.includes('NOT_FOUND')) {
      console.log('  安装 Node.js 20.x ...');
      if (pm === 'dnf' || pm === 'yum') {
        // CentOS/RHEL - 使用 NodeSource RPM
        await exec(newConn, 'curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -', '新', { timeout: 120000 });
        await exec(newConn, `${pm} install -y nodejs`, '新', { timeout: 120000 });
      } else if (pm === 'apt') {
        await exec(newConn, 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs', '新', { timeout: 120000 });
      } else {
        // 兜底：用 nvm 或直接下载二进制
        console.log('  未知包管理器，使用 Node.js 预编译二进制...');
        await exec(newConn, `
          cd /tmp && \
          curl -fsSL https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz -o node.tar.xz && \
          tar xf node.tar.xz && \
          cp -r node-v20.18.0-linux-x64/{bin,lib,include,share} /usr/local/ && \
          rm -rf node.tar.xz node-v20.18.0-linux-x64
        `, '新', { timeout: 120000 });
      }
      const ver = await exec(newConn, 'node --version', '新');
      console.log(`  Node.js 安装完成: ${ver.out.trim()}`);
    } else {
      console.log(`  Node.js: ${nodeCheck.out.trim()}`);
    }

    // 安装 PM2
    const pm2Check = await exec(newConn, 'pm2 --version 2>/dev/null || echo "NOT_FOUND"', '新');
    if (pm2Check.out.includes('NOT_FOUND')) {
      console.log('  安装 PM2 ...');
      await exec(newConn, 'npm install -g pm2', '新', { timeout: 60000 });
    } else {
      console.log(`  PM2: ${pm2Check.out.trim()}`);
    }

    // 安装 sshpass（从旧服务器拉文件用）
    const sshpassCheck = await exec(newConn, 'which sshpass 2>/dev/null || echo "NOT_FOUND"', '新');
    if (sshpassCheck.out.includes('NOT_FOUND')) {
      console.log('  安装 sshpass ...');
      if (pm === 'dnf' || pm === 'yum') {
        // 先尝试 EPEL
        await exec(newConn, `${pm} install -y epel-release 2>/dev/null; ${pm} install -y sshpass 2>/dev/null || echo "sshpass_skip"`, '新', { timeout: 60000 });
      } else if (pm === 'apt') {
        await exec(newConn, 'apt-get install -y sshpass', '新', { timeout: 60000 });
      }
    }

    // 创建目标目录
    await exec(newConn, `mkdir -p ${REMOTE_ROOT}`, '新');
  });

  // ========== Step 3: 旧服务器打包 ==========
  await step('Step 3: 旧服务器打包项目', async () => {
    // 检查是否已有打包文件（上次中断可能留下）
    const existing = await exec(oldConn, `ls -lh ${ARCHIVE} 2>/dev/null || echo "NO_ARCHIVE"`, '旧');
    if (!existing.out.includes('NO_ARCHIVE')) {
      console.log(`  已存在打包文件: ${existing.out.trim()}`);
      console.log('  跳过重新打包（使用已有的）');
      return;
    }

    const du = await exec(oldConn, `du -sh ${REMOTE_ROOT}`, '旧');
    console.log(`  项目大小: ${du.out.trim()}`);

    console.log('  开始打包...');
    await exec(oldConn, `cd /opt/vido && tar czf ${ARCHIVE} --warning=no-file-changed app/ 2>&1; echo "TAR_EXIT=$?"`, '旧', { timeout: 600000 });

    const size = await exec(oldConn, `ls -lh ${ARCHIVE} | awk '{print $5}'`, '旧');
    console.log(`  打包完成: ${size.out.trim()}`);
  });

  // ========== Step 4: 传输 ==========
  await step('Step 4: 传输文件到新服务器', async () => {
    // 方案1: 新服务器有 sshpass，从新服务器拉取
    const hasSshpass = await exec(newConn, 'which sshpass 2>/dev/null && echo "YES" || echo "NO"', '新');

    if (hasSshpass.out.includes('YES')) {
      console.log('  使用 sshpass + scp 从新服务器拉取...');
      const scpCmd = `sshpass -p '${OLD_SERVER.password}' scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${OLD_SERVER.username}@${OLD_SERVER.host}:${ARCHIVE} ${ARCHIVE}`;
      await exec(newConn, scpCmd, '新', { timeout: 600000 });
    } else {
      // 方案2: 从旧服务器推送到新服务器
      console.log('  sshpass 不可用，从旧服务器推送...');
      // 在旧服务器安装 sshpass
      await exec(oldConn, 'which sshpass >/dev/null 2>&1 || yum install -y sshpass 2>/dev/null || apt-get install -y sshpass 2>/dev/null || true', '旧', { timeout: 60000 });

      const oldHasSshpass = await exec(oldConn, 'which sshpass 2>/dev/null && echo "YES" || echo "NO"', '旧');
      if (oldHasSshpass.out.includes('YES')) {
        const scpCmd = `sshpass -p '${NEW_SERVER.password}' scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${ARCHIVE} ${NEW_SERVER.username}@${NEW_SERVER.host}:${ARCHIVE}`;
        await exec(oldConn, scpCmd, '旧', { timeout: 600000 });
      } else {
        // 方案3: 用 ssh2 中转（通过本机）
        throw new Error('两台服务器都没有 sshpass，请手动安装 sshpass 后重试，或手动传输文件');
      }
    }

    // 验证传输完成
    const check = await exec(newConn, `ls -lh ${ARCHIVE} 2>&1`, '新');
    if (check.code !== 0) throw new Error('文件传输失败');
    console.log(`  传输完成: ${check.out.trim()}`);
  });

  // ========== Step 5: 解压配置 ==========
  await step('Step 5: 解压并配置', async () => {
    console.log('  解压中...');
    await exec(newConn, `cd /opt/vido && tar xzf ${ARCHIVE}`, '新', { timeout: 300000 });

    // 验证关键文件
    const verify = await exec(newConn, `ls ${REMOTE_ROOT}/package.json ${REMOTE_ROOT}/src/server.js 2>&1`, '新');
    if (verify.code !== 0) throw new Error('解压后关键文件缺失');
    console.log('  关键文件验证通过');

    // 更新 .env
    console.log('  更新 .env ...');
    const envBefore = await exec(newConn, `cat ${REMOTE_ROOT}/.env 2>/dev/null || echo "(empty)"`, '新');
    console.log(`  当前 .env:\n${envBefore.out}`);

    // 替换 PUBLIC_URL 指向新 IP
    await exec(newConn, `
      cd ${REMOTE_ROOT}
      if [ -f .env ]; then
        if grep -q '^PUBLIC_URL=' .env; then
          sed -i 's|^PUBLIC_URL=.*|PUBLIC_URL=http://${NEW_SERVER.host}:4600|' .env
        else
          echo 'PUBLIC_URL=http://${NEW_SERVER.host}:4600' >> .env
        fi
      else
        echo 'PORT=4600' > .env
        echo 'PUBLIC_URL=http://${NEW_SERVER.host}:4600' >> .env
      fi
    `, '新');

    const envAfter = await exec(newConn, `cat ${REMOTE_ROOT}/.env`, '新');
    console.log(`  更新后 .env:\n${envAfter.out}`);

    // 检查 node_modules
    const nmCheck = await exec(newConn, `[ -d ${REMOTE_ROOT}/node_modules ] && echo "EXISTS" || echo "MISSING"`, '新');
    if (nmCheck.out.includes('MISSING')) {
      console.log('  运行 npm install --production ...');
      await exec(newConn, `cd ${REMOTE_ROOT} && npm install --production`, '新', { timeout: 300000 });
    } else {
      console.log('  node_modules 已迁移');
      // 确保 sharp 等 native 包在新系统能用，rebuild
      console.log('  npm rebuild (确保 native 包兼容)...');
      await exec(newConn, `cd ${REMOTE_ROOT} && npm rebuild 2>&1 || true`, '新', { timeout: 120000 });
    }
  });

  // ========== Step 6: PM2 启动 ==========
  await step('Step 6: PM2 启动服务', async () => {
    await exec(newConn, 'pm2 delete vido 2>/dev/null || true', '新');
    await exec(newConn, `cd ${REMOTE_ROOT} && pm2 start src/server.js --name vido --update-env`, '新');
    await exec(newConn, 'pm2 save', '新');

    // 等待启动
    console.log('  等待服务启动 (5s)...');
    await new Promise(r => setTimeout(r, 5000));

    // 检查状态
    const status = await exec(newConn, 'pm2 list', '新');
    const health = await exec(newConn, 'curl -s http://127.0.0.1:4600/api/health 2>&1 || echo "(no response)"', '新');
    console.log(`\n  Health: ${health.out.trim()}`);
  });

  // ========== Step 7: 清理 ==========
  await step('Step 7: 清理', async () => {
    await exec(oldConn, `rm -f ${ARCHIVE}`, '旧');
    await exec(newConn, `rm -f ${ARCHIVE}`, '新');
    console.log('  临时文件已清理');
  });

  oldConn.end();
  newConn.end();

  console.log('\n' + '='.repeat(60));
  console.log(' 迁移完成!');
  console.log(`  新地址: http://${NEW_SERVER.host}:4600`);
  console.log(`  健康检查: http://${NEW_SERVER.host}:4600/api/health`);
  console.log('='.repeat(60));
  console.log('\n 后续事项:');
  console.log('  1. 浏览器测试: http://43.98.167.151:4600');
  console.log('  2. 更新 deploy-kb.js 的 VIDO_DEPLOY_HOST');
  console.log('  3. 如有域名 DNS，更新 A 记录');
  console.log('  4. 确认旧服务器是否下线\n');

})().catch(e => {
  console.error('\n 迁移失败:', e.message);
  process.exit(1);
});
