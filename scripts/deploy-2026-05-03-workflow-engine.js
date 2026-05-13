/**
 * Deploy AI 工作流编排引擎 (P1 + P2 + P3 + 内置 3 个工作流)
 *
 * 上传文件:
 *  - 后端引擎:        src/services/workflowEngine.js
 *  - 节点能力库:      src/services/workflowCapabilities.js
 *  - 路由:            src/routes/workflows.js
 *  - server 注册:     src/server.js
 *  - 后台 UI:         public/admin.html
 *  - 后台 JS:         public/js/admin-workflows.js
 *  - 后台 CSS:        public/css/admin-workflows.css
 *  - 内置工作流 JSON: config/workflows-builtin/*.json
 */
const fs = require('fs');
const path = require('path');
const posix = path.posix;
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const PORT = Number(process.env.VIDO_DEPLOY_PORT || 22);
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';
const PM2_APP = process.env.VIDO_DEPLOY_PM2_APP || 'vido';

const files = [
  'src/services/workflowEngine.js',
  'src/services/workflowCapabilities.js',
  'src/routes/workflows.js',
  'src/server.js',
  'public/admin.html',
  'public/js/admin-workflows.js',
  'public/css/admin-workflows.css',
  'config/workflows-builtin/batch-cutout.json',
  'config/workflows-builtin/dreamid-faceswap.json',
  'config/workflows-builtin/product-swap.json',
];

if (!HOST || !PASSWORD) {
  console.error('Missing VIDO_DEPLOY_HOST or VIDO_DEPLOY_PASSWORD');
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
      let out = '';
      let errOut = '';
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
  console.log(`[deploy] connect ${USER}@${HOST}:${PORT}`);
  const c = await connect();
  try {
    const sftp = await sftpOpen(c);
    await exec(c, `test -d ${REMOTE_ROOT}`);

    for (const rel of files) {
      const local = path.resolve(process.cwd(), rel);
      if (!fs.existsSync(local)) throw new Error(`missing local file: ${rel}`);
      const remote = posix.join(REMOTE_ROOT, rel.replace(/\\/g, '/'));
      const remoteDir = posix.dirname(remote);
      await mkdirP(sftp, remoteDir);
      await exec(c, `if [ -f '${remote}' ]; then cp '${remote}' '${remote}.bak-${stamp}'; fi`);
      await put(sftp, local, remote);
      console.log(`[deploy] uploaded ${rel}`);
    }

    // 确保运行时目录存在
    await exec(c, `mkdir -p ${REMOTE_ROOT}/outputs/workflow_runs ${REMOTE_ROOT}/outputs/workflows ${REMOTE_ROOT}/public/workflow-assets`);
    console.log('[deploy] ensured runtime dirs');

    console.log(`[deploy] reload ${PM2_APP}`);
    const reload = await exec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
    console.log(reload.out.trim());

    // 等服务起来
    await new Promise(r => setTimeout(r, 2500));

    const pm2 = await exec(c, `pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='${PM2_APP}'); if(!p) throw new Error('pm2 app not found'); console.log('status='+p.pm2_env.status+' restarts='+p.pm2_env.restart_time);})"`);
    console.log(`[deploy] ${pm2.out.trim()}`);

    const health = await exec(c, `curl -s -o /tmp/vido-health.out -w "%{http_code}" http://127.0.0.1:4600/api/health && echo && head -c 400 /tmp/vido-health.out`);
    console.log(`[deploy] health ${health.out.trim()}`);

    // 验证工作流路由（未登录会返回 401，但应该不是 404）
    const wfHead = await exec(c, `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/workflows/capabilities`);
    console.log(`[deploy] /api/workflows/capabilities (unauth) -> ${wfHead.out.trim()}  (期望 401，非 404)`);

    // 看下内置工作流文件是否到位
    const ls = await exec(c, `ls -la ${REMOTE_ROOT}/config/workflows-builtin/ 2>&1 | head -20`);
    console.log('[deploy] builtin workflows:');
    console.log(ls.out.trim());

    // 看 PM2 日志最后 30 行
    const log = await exec(c, `pm2 logs ${PM2_APP} --lines 30 --nostream 2>&1 | tail -40`);
    console.log('[deploy] recent logs:');
    console.log(log.out.trim());
  } finally {
    c.end();
  }
})().catch(err => {
  console.error('[deploy] failed:', err.message);
  process.exit(1);
});
