/**
 * Deploy 2026-05-05b：广场去动漫 + 4 个业务工作流
 *
 * 上传文件:
 *  - src/routes/avatar.js                                (删除 anime 分类 4 条)
 *  - config/workflows-builtin/dh-portrait-gen.json       (新建)
 *  - config/workflows-builtin/product-ad-copy.json       (新建)
 *  - config/workflows-builtin/product-cutout-scene.json  (新建)
 *  - config/workflows-builtin/dh-video-script.json       (新建)
 */
const fs = require('fs');
const path = require('path');
const posix = path.posix;
const { Client } = require('ssh2');

const HOST      = process.env.VIDO_DEPLOY_HOST     || '43.98.167.151';
const USER      = process.env.VIDO_DEPLOY_USER     || 'root';
const PASSWORD  = process.env.VIDO_DEPLOY_PASSWORD;
const PORT      = Number(process.env.VIDO_DEPLOY_PORT || 22);
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';
const PM2_APP   = process.env.VIDO_DEPLOY_PM2_APP  || 'vido';

const files = [
  'src/routes/avatar.js',
  'config/workflows-builtin/dh-portrait-gen.json',
  'config/workflows-builtin/product-ad-copy.json',
  'config/workflows-builtin/product-cutout-scene.json',
  'config/workflows-builtin/dh-video-script.json',
];

if (!PASSWORD) {
  console.error('❌ 缺少 VIDO_DEPLOY_PASSWORD 环境变量');
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
        if (code !== 0) return reject(new Error(`failed ${code}: ${cmd}\n${errOut || out}`));
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

    console.log(`[deploy] pm2 reload ${PM2_APP}`);
    const reload = await exec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
    console.log(reload.out.trim());

    await new Promise(r => setTimeout(r, 2500));

    const pm2 = await exec(c, `pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='${PM2_APP}');if(!p)throw new Error('not found');console.log('status='+p.pm2_env.status+' restarts='+p.pm2_env.restart_time);})"`);
    console.log(`[deploy] ${pm2.out.trim()}`);

    const health = await exec(c, `curl -s -o /tmp/vido-health.out -w "%{http_code}" http://127.0.0.1:4600/api/health && echo && head -c 200 /tmp/vido-health.out`);
    console.log(`[deploy] health: ${health.out.trim()}`);

    // 验证广场 API（去掉了 anime 类）
    const plazaCheck = await exec(c, `curl -s http://127.0.0.1:4600/api/avatar/presets | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);const cats=r.categories.map(c=>c.id);const cnt=Object.keys(r.avatars).length;console.log('categories='+cats.join(','));console.log('preset_count='+cnt);})"`);
    console.log(`[deploy] plaza: ${plazaCheck.out.trim()}`);

    // 验证工作流列表（应该包含新增的 4 个内置）
    const wfCheck = await exec(c, `curl -s -H "Authorization: Bearer skip" http://127.0.0.1:4600/api/workflows | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const r=JSON.parse(d);console.log('workflow_count='+r.workflows.length);console.log('builtin='+r.workflows.filter(w=>w.builtin).map(w=>w.id).join(','));}catch(e){console.log(d.slice(0,200));}})"`);
    console.log(`[deploy] workflows: ${wfCheck.out.trim()}`);

    console.log('\n[deploy] ✅ 全部完成');
  } finally {
    c.end();
  }
})().catch(err => {
  console.error('[deploy] ❌ 失败:', err.message);
  process.exit(1);
});
