#!/usr/bin/env node
/**
 * 一次性部署脚本 — 把知识库改动同步到生产
 *
 * 用法：
 *   VIDO_DEPLOY_HOST=119.29.128.12 VIDO_DEPLOY_USER=root VIDO_DEPLOY_PASSWORD='...' \
 *     node scripts/deploy-kb.js
 *
 * 策略：
 *   - 远程路径: /opt/vido/app
 *   - outputs/knowledge_base.json 若远端已存在则 **不覆盖**（仅在不存在时新建）
 *   - 其他代码/前端文件 **覆盖**
 *   - 重启 PM2 进程 vido
 *   - 密码只从环境变量读取，脚本不留存
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

// 要推送的文件清单（相对仓库根）
// [ localPath, overwrite ]
const FILES = [
  ['src/models/database.js', true],
  ['src/services/knowledgeBaseService.js', true],
  ['src/services/knowledgeBaseSeed.js', true],
  // 分文件 seed（v2 + v3 + v4 + v5）
  ['src/services/seeds/digital_human.js', true],
  ['src/services/seeds/drama.js', true],
  ['src/services/seeds/storyboard.js', true],
  ['src/services/seeds/atmosphere.js', true],
  ['src/services/seeds/production.js', true],
  ['src/services/seeds/engineering.js', true],
  // CLAUDE.md + 会话日志
  ['CLAUDE.md', true],
  // AI 团队 v4 新增
  ['src/services/aiTeamService.js', true],
  ['src/routes/aiTeam.js', true],
  // v6 新增：每日学习 + Agent 跨调用
  ['src/services/knowledgeSources.js', true],
  ['src/services/dailyLearnService.js', true],
  ['src/services/agentOrchestrator.js', true],
  // v8 新增：Token 追踪 + 服务器监控
  ['src/services/tokenTracker.js', true],
  // 其他代码
  ['src/services/dramaService.js', true],
  ['src/services/storyService.js', true],
  ['src/services/imageService.js', true],   // v15: 三视图 helper
  ['src/routes/admin.js', true],
  ['src/routes/drama.js', true],
  ['src/routes/story.js', true],            // v15: /generate-character-three-view 路由
  ['src/server.js', true],
  ['public/admin.html', true],
  ['public/js/admin.js', true],
  ['public/css/admin.css', true],
  ['public/index.html', true],              // v15c: cache-bust
  ['public/js/app.js', true],               // v15: 三视图 UI + parseScript 字段映射修复
  ['public/css/style.css', true],           // v15: 三视图 CSS + sto-li-loading
  ['public/home.html', true],               // v18: 新首页 (三色渐变 + 方形拼接)
  ['public/css/home.css', true],            // v18: 首页 CSS
  ['public/js/home.js', true],              // v18: 首页 JS (showcase + composer)
  ['public/drama-studio.html', true],       // v15h: 网剧编辑器原型
  ['public/js/drama-studio.js', true],      // v15h: 网剧编辑器 API 集成层
  ['src/services/imageService.js', true],   // 包含 NanoBanana 接入
  ['src/services/portraitService.js', true], // v16: 模型选择支持
  ['src/services/projectService.js', true], // v16: 工作流集成
  ['src/routes/comic.js', true],            // v16: 工作流集成
  ['src/routes/novel.js', true],            // v16: 工作流集成
  ['src/routes/portrait.js', true],         // v16: 模型选择支持
  ['docs/KB_VERIFICATION.md', true],
  // KB 数据文件：不覆盖（仅当远端不存在时才上传；增量 seed 会在服务端启动时自动补齐新 id）
  ['outputs/knowledge_base.json', false],
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
      // 已存在或父目录缺失
      if (err.code === 4 || err.code === 11 || /File exists/i.test(err.message)) return resolve();
      if (err.code === 2 || /No such file/i.test(err.message)) {
        const parent = path.posix.dirname(dir);
        if (parent && parent !== dir) {
          await sftpMkdirP(sftp, parent);
          return sftpMkdirP(sftp, dir).then(resolve);
        }
      }
      resolve(); // best effort
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

  // 确保远端根目录存在
  const rootStat = await sftpStat(sftp, REMOTE_ROOT);
  if (!rootStat) {
    console.error(`✗ 远端路径 ${REMOTE_ROOT} 不存在，请确认 VIDO_DEPLOY_REMOTE`);
    c.end();
    process.exit(2);
  }
  console.log(`✓ 远端根路径存在: ${REMOTE_ROOT}`);

  let uploaded = 0, skipped = 0;
  for (const [rel, overwrite] of FILES) {
    const local = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(local)) {
      console.log(`  ⊘ 本地缺失，跳过: ${rel}`);
      continue;
    }
    const remote = path.posix.join(REMOTE_ROOT, rel.replace(/\\/g, '/'));
    const remoteDir = path.posix.dirname(remote);
    await sftpMkdirP(sftp, remoteDir);

    if (!overwrite) {
      const exists = await sftpStat(sftp, remote);
      if (exists) {
        console.log(`  = 已存在，按策略不覆盖: ${rel}`);
        skipped++;
        continue;
      }
    }
    try {
      await sftpUpload(sftp, local, remote);
      console.log(`  ↑ ${rel}`);
      uploaded++;
    } catch (e) {
      console.error(`  ✗ 上传失败 ${rel}: ${e.message}`);
    }
  }
  console.log(`\n✓ 上传 ${uploaded} 个文件，跳过 ${skipped} 个`);

  // 重启 PM2
  console.log(`\n▶ 重启 PM2 进程 ${PM2_APP}`);
  const r1 = await runExec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
  console.log(r1.out || r1.errOut);

  // 验证进程状态 + 端口
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
