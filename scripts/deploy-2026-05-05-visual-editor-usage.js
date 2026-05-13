/**
 * Deploy 2026-05-05：可视化工作流编辑器 + Token/费用埋点
 *
 * 上传文件:
 *  - src/services/usageTracker.js          (新文件，Token+费用追踪)
 *  - src/services/workflowCapabilities.js  (text_gen 节点加埋点)
 *  - src/services/workflowEngine.js        (stepLog 加 usage 字段)
 *  - src/routes/workflows.js               (加 /usage/summary + /usage/log 端点)
 *  - public/js/admin-workflows.js          (可视化编辑器 + usage 展示)
 *  - public/css/admin-workflows.css        (可视化编辑器样式)
 *  - public/admin.html                     (版本号更新)
 */
const fs = require('fs');
const path = require('path');
const posix = path.posix;
const { Client } = require('ssh2');

const HOST     = process.env.VIDO_DEPLOY_HOST     || '43.98.167.151';
const USER     = process.env.VIDO_DEPLOY_USER     || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const PORT     = Number(process.env.VIDO_DEPLOY_PORT || 22);
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';
const PM2_APP  = process.env.VIDO_DEPLOY_PM2_APP  || 'vido';

const files = [
  'src/services/usageTracker.js',
  'src/services/workflowCapabilities.js',
  'src/services/workflowEngine.js',
  'src/routes/workflows.js',
  'public/js/admin-workflows.js',
  'public/css/admin-workflows.css',
  'public/admin.html',
];

if (!PASSWORD) {
  console.error('❌ 缺少 VIDO_DEPLOY_PASSWORD 环境变量');
  console.error('   用法: VIDO_DEPLOY_PASSWORD=yourpwd node scripts/deploy-2026-05-05-visual-editor-usage.js');
  process.exit(1);
}

function connect() {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c));
    c.on('error', reject);
    c.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 25000 });
  });
}

function exec(c, cmd) {
  return new Promise((resolve, reject) => {
    c.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { errOut += d.toString(); });
      stream.on('close', code => {
        if (code !== 0) return reject(new Error(`command failed ${code}: ${cmd}\n${errOut || out}`));
        resolve({ out, errOut });
      });
    });
  });
}

function sftpOpen(c) {
  return new Promise((resolve, reject) => c.sftp((err, sftp) => err ? reject(err) : resolve(sftp)));
}

function mkdirP(sftp, dir) {
  const parts = dir.split('/').filter(Boolean);
  let cur = '';
  return parts.reduce((p, part) => p.then(() => new Promise(resolve => {
    cur += '/' + part;
    sftp.mkdir(cur, () => resolve());
  })), Promise.resolve());
}

function put(sftp, local, remote) {
  return new Promise((resolve, reject) => sftp.fastPut(local, remote, err => err ? reject(err) : resolve()));
}

(async () => {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  console.log(`[deploy] 连接 ${USER}@${HOST}:${PORT}`);
  const c = await connect();
  try {
    const sftp = await sftpOpen(c);
    await exec(c, `test -d ${REMOTE_ROOT}`);

    for (const rel of files) {
      const local = path.resolve(process.cwd(), rel);
      if (!fs.existsSync(local)) throw new Error(`本地文件不存在: ${rel}`);
      const remote = posix.join(REMOTE_ROOT, rel.replace(/\\/g, '/'));
      const remoteDir = posix.dirname(remote);
      await mkdirP(sftp, remoteDir);
      await exec(c, `if [ -f '${remote}' ]; then cp '${remote}' '${remote}.bak-${stamp}'; fi`);
      await put(sftp, local, remote);
      console.log(`[deploy] ✓ ${rel}`);
    }

    // 确保 usage_log.jsonl 的目录存在
    await exec(c, `mkdir -p ${REMOTE_ROOT}/outputs`);
    console.log('[deploy] outputs 目录已确认');

    console.log(`[deploy] pm2 reload ${PM2_APP}`);
    const reload = await exec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
    console.log(reload.out.trim());

    await new Promise(r => setTimeout(r, 2500));

    const pm2 = await exec(c, `pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='${PM2_APP}');if(!p)throw new Error('pm2 app not found');console.log('status='+p.pm2_env.status+' restarts='+p.pm2_env.restart_time);})"`);
    console.log(`[deploy] ${pm2.out.trim()}`);

    const health = await exec(c, `curl -s -o /tmp/vido-health.out -w "%{http_code}" http://127.0.0.1:4600/api/health && echo && head -c 300 /tmp/vido-health.out`);
    console.log(`[deploy] health: ${health.out.trim()}`);

    // 验证新端点（未登录返回 401，不是 404 即正常）
    const usageCheck = await exec(c, `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/workflows/usage/summary`);
    console.log(`[deploy] /api/workflows/usage/summary (unauth) -> ${usageCheck.out.trim()}  (期望 401)`);

    const log = await exec(c, `pm2 logs ${PM2_APP} --lines 20 --nostream 2>&1 | tail -25`);
    console.log('[deploy] 最近日志:');
    console.log(log.out.trim());

    console.log('\n[deploy] ✅ 全部完成');
  } finally {
    c.end();
  }
})().catch(err => {
  console.error('[deploy] ❌ 失败:', err.message);
  process.exit(1);
});
