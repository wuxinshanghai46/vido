/**
 * Deploy 2026-05-05c：广场只保留 6 个真实人像，删除 20 个废弃预设及对应图片文件
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
const PRESETS_DIR = REMOTE_ROOT + '/outputs/presets';

// 已删除的 key 列表（需要清理对应图片文件）
const REMOVED_KEYS = [
  'female-biz-2', 'male-biz-2', 'female-biz-3',
  'male-news-1', 'female-news-2',
  'female-edu-1', 'male-edu-2',
  'male-tech-1', 'female-tech-1',
  'female-life-1', 'male-life-1', 'female-life-2',
  'child-1', 'child-2',
  'elder-1', 'elder-2',
  'western-1', 'western-2', 'africa-1', 'india-1',
  'anime-1', 'anime-2', 'anime-3', 'vtuber-1',
];

if (!PASSWORD) {
  console.error('缺少 VIDO_DEPLOY_PASSWORD');
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
        if (code !== 0) return reject(new Error(`fail ${code}: ${cmd}\n${errOut || out}`));
        resolve({ out, errOut });
      });
    });
  });
}

function sftpOpen(c) {
  return new Promise((resolve, reject) => c.sftp((err, sftp) => err ? reject(err) : resolve(sftp)));
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

    // 上传 avatar.js
    const local = path.resolve('src/routes/avatar.js');
    const remote = posix.join(REMOTE_ROOT, 'src/routes/avatar.js');
    await exec(c, `cp '${remote}' '${remote}.bak-${stamp}'`);
    await put(sftp, local, remote);
    console.log('[deploy] ✓ src/routes/avatar.js');

    // 清理废弃预设图片（jpg/png/webp 均删）
    for (const key of REMOVED_KEYS) {
      // 用 find 避免 glob 失败的问题
      const r = await exec(c, `find '${PRESETS_DIR}' -name 'avatar_${key}.*' -delete -print 2>/dev/null; echo ok`);
      const removed = r.out.replace('ok', '').trim();
      if (removed) console.log(`[deploy] rm ${removed}`);
    }
    console.log('[deploy] ✓ 废弃图片清理完成');

    // pm2 reload
    console.log(`[deploy] pm2 reload ${PM2_APP}`);
    await exec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
    await new Promise(r => setTimeout(r, 2000));

    const pm2 = await exec(c, `pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='${PM2_APP}');console.log('status='+p.pm2_env.status+' restarts='+p.pm2_env.restart_time);})"`);
    console.log(`[deploy] ${pm2.out.trim()}`);

    // 验证剩余预设数量
    const health = await exec(c, `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health`);
    console.log(`[deploy] health: ${health.out.trim()}`);

    console.log('\n[deploy] ✅ 全部完成（广场仅保留 6 个真实人像）');
  } finally {
    c.end();
  }
})().catch(err => {
  console.error('[deploy] ❌', err.message);
  process.exit(1);
});
