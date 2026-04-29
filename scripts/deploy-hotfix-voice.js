#!/usr/bin/env node
/**
 * Hotfix 部署：声音测试 + 作品库过滤 + 性别识别建议化 + 训练状态及时刷新
 *
 * 用法（Git Bash）：
 *   VIDO_DEPLOY_HOST=43.98.167.151 VIDO_DEPLOY_PASSWORD='xxxxx' \
 *     node scripts/deploy-hotfix-voice.js
 *
 * 只上传本次动过的 3 个文件，然后 pm2 reload vido
 */
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const PORT = parseInt(process.env.VIDO_DEPLOY_PORT || '22', 10);
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';
const PM2_APP = process.env.VIDO_DEPLOY_PM2_APP || 'vido';

if (!HOST || !PASSWORD) {
  console.error('ERROR: 缺少 VIDO_DEPLOY_HOST / VIDO_DEPLOY_PASSWORD');
  process.exit(1);
}

const FILES = [
  'src/services/ttsService.js',
  'src/routes/workbench.js',
  'src/routes/digitalHuman.js',
  'public/js/digital-human.js',
  'public/digital-human.html',
];

const REPO_ROOT = path.resolve(__dirname, '..');

function connect() {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c));
    c.on('error', reject);
    c.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
  });
}

function sftpOpen(c) {
  return new Promise((res, rej) => c.sftp((err, sftp) => err ? rej(err) : res(sftp)));
}

function sftpStat(sftp, p) {
  return new Promise(resolve => sftp.stat(p, (err, stats) => resolve(err ? null : stats)));
}

function sftpMkdirP(sftp, dir) {
  return new Promise((resolve) => {
    sftp.mkdir(dir, { mode: 0o755 }, async (err) => {
      if (!err) return resolve();
      if (err.code === 4 || err.code === 11 || /File exists/i.test(err.message)) return resolve();
      if (err.code === 2 || /No such file/i.test(err.message)) {
        const parent = path.posix.dirname(dir);
        if (parent && parent !== dir) {
          await sftpMkdirP(sftp, parent);
          return sftpMkdirP(sftp, dir).then(resolve);
        }
      }
      resolve();
    });
  });
}

function sftpUpload(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => err ? reject(err) : resolve());
  });
}

function runExec(c, cmd) {
  return new Promise((resolve, reject) => {
    c.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('close', (code) => resolve({ code, out, errOut }));
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => errOut += d.toString());
    });
  });
}

(async () => {
  console.log(`\n▶ 连接 ${USER}@${HOST}:${PORT}`);
  const c = await connect();
  const sftp = await sftpOpen(c);

  const rootStat = await sftpStat(sftp, REMOTE_ROOT);
  if (!rootStat) {
    console.error(`✗ 远端路径 ${REMOTE_ROOT} 不存在`);
    c.end();
    process.exit(2);
  }
  console.log(`✓ 远端根路径存在: ${REMOTE_ROOT}`);

  let uploaded = 0;
  for (const rel of FILES) {
    const local = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(local)) {
      console.log(`  ⊘ 本地缺失: ${rel}`);
      continue;
    }
    const remote = path.posix.join(REMOTE_ROOT, rel.replace(/\\/g, '/'));
    await sftpMkdirP(sftp, path.posix.dirname(remote));
    try {
      await sftpUpload(sftp, local, remote);
      const size = fs.statSync(local).size;
      console.log(`  ↑ ${rel} (${size} bytes)`);
      uploaded++;
    } catch (e) {
      console.error(`  ✗ 上传失败 ${rel}: ${e.message}`);
    }
  }
  console.log(`\n✓ 上传 ${uploaded}/${FILES.length} 个文件`);

  console.log(`\n▶ 重启 PM2 进程 ${PM2_APP}`);
  const r1 = await runExec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
  console.log((r1.out || r1.errOut).trim());

  // 验证
  console.log(`\n▶ 验证`);
  const r2 = await runExec(c, `pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d).find(x=>x.name==='${PM2_APP}');if(j){console.log('status:',j.pm2_env.status,'uptime_ms:',Date.now()-j.pm2_env.pm_uptime,'restarts:',j.pm2_env.restart_time)}else console.log('(not found)')}catch(e){console.log('(parse err)',e.message)}})" 2>&1`);
  console.log('PM2:', (r2.out || r2.errOut).trim());

  const r3 = await runExec(c, `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health || true`);
  console.log('HTTP /api/health:', r3.out.trim() || '(no response)');

  c.end();
  console.log('\n✓ 部署完成');
})().catch(e => {
  console.error('\n✗ 部署失败:', e.message);
  process.exit(3);
});
