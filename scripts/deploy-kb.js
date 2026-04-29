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
  // === 核心 ===
  ['src/server.js', true],
  ['CLAUDE.md', true],
  // === 数据层 ===
  ['src/models/database.js', true],
  ['src/models/authStore.js', true],
  ['src/models/editStore.js', true],
  // === 中间件 ===
  ['src/middleware/auth.js', true],
  ['src/middleware/credits.js', true],
  ['src/middleware/streamAuth.js', true],
  ['src/middleware/apiAuth.js', true],
  // === 路由 ===
  ['src/routes/admin.js', true],
  ['src/routes/agent.js', true],
  ['src/routes/aiCap.js', true],
  ['src/routes/aiTeam.js', true],
  ['src/routes/assets.js', true],
  ['src/routes/auth.js', true],
  ['src/routes/avatar.js', true],
  ['src/routes/avatar-preset-img.js', true],
  ['src/routes/hifly.js', true],
  ['src/routes/digitalHuman.js', true],
  ['src/routes/browser.js', true],
  ['src/routes/comic.js', true],
  ['src/routes/dashboard.js', true],
  ['src/routes/drama.js', true],
  ['src/routes/editor.js', true],
  ['src/routes/effects-stream.js', true],
  ['src/routes/i2v.js', true],
  ['src/routes/i2v-stream.js', true],
  ['src/routes/imggen.js', true],
  ['src/routes/mcp.js', true],
  ['src/routes/novel.js', true],
  ['src/routes/portrait.js', true],
  ['src/routes/project-stream.js', true],
  ['src/routes/projects.js', true],
  ['src/routes/publish.js', true],
  ['src/routes/radar.js', true],
  ['src/routes/settings.js', true],
  ['src/routes/story.js', true],
  ['src/routes/sync.js', true],
  ['src/routes/workbench.js', true],
  ['src/routes/workflow.js', true],
  ['src/routes/works.js', true],
  ['src/routes/openapi.js', true],
  // === 服务层（全量同步，避免漏文件）===
  ['src/services/agentOrchestrator.js', true],
  ['src/services/aiTeamService.js', true],
  ['src/services/avatarService.js', true],
  ['src/services/browserService.js', true],
  ['src/services/comicService.js', true],
  ['src/services/dailyLearnService.js', true],
  ['src/services/dramaService.js', true],
  ['src/services/editService.js', true],
  ['src/services/effectsService.js', true],
  ['src/services/ffmpegService.js', true],
  ['src/services/imageService.js', true],
  ['src/services/knowledgeBaseSeed.js', true],
  ['src/services/knowledgeBaseService.js', true],
  ['src/services/knowledgeSources.js', true],
  ['src/services/mcpManager.js', true],
  ['src/services/motionService.js', true],
  ['src/services/musicService.js', true],
  ['src/services/novelService.js', true],
  ['src/services/pipelineService.js', true],
  ['src/services/portraitService.js', true],
  ['src/services/projectService.js', true],
  ['src/services/publishService.js', true],
  ['src/services/radarService.js', true],
  ['src/services/settingsService.js', true],
  ['src/services/slangService.js', true],
  ['src/services/soraService.js', true],
  ['src/services/storyService.js', true],
  ['src/services/syncService.js', true],
  ['src/services/tokenTracker.js', true],
  ['src/services/ttsService.js', true],
  ['src/services/videoService.js', true],
  ['src/services/voiceLibrary.js', true],
  ['src/services/apiCatalog.js', true],
  ['src/services/jimengAvatarService.js', true],
  ['src/services/hiflyService.js', true],
  ['src/services/cozeService.js', true],
  ['src/services/wanAnimateService.js', true],
  ['src/services/aliyunVoiceService.js', true],
  ['src/services/tutorialProducer.js', true],
  ['src/services/baiduMattingService.js', true],
  ['src/services/videoMattingPipeline.js', true],
  ['scripts/demo-auto-produce.js', true],
  ['scripts/demo-matting.js', true],
  ['scripts/tts-health-check.js', true],
  // === KB Seeds ===
  ['src/services/seeds/digital_human.js', true],
  ['src/services/seeds/drama.js', true],
  ['src/services/seeds/storyboard.js', true],
  ['src/services/seeds/atmosphere.js', true],
  ['src/services/seeds/production.js', true],
  ['src/services/seeds/engineering.js', true],
  ['src/services/seeds/era_anchors.js', true],
  // === 前端 ===
  ['public/index.html', true],
  ['public/admin.html', true],
  ['public/home.html', true],
  ['public/drama-studio.html', true],
  ['public/drama-demo.html', true],
  ['public/aicanvas.html', true],
  ['public/home-prototype.html', true],
  ['public/css/style.css', true],
  ['public/css/admin.css', true],
  ['public/css/home.css', true],
  ['public/css/aicanvas.css', true],
  ['public/js/app.js', true],
  ['public/js/admin.js', true],
  ['public/js/home.js', true],
  ['public/js/drama-studio.js', true],
  ['public/js/aicanvas.js', true],
  ['public/js/workflow.js', true],
  ['public/js/admin-api-accounts.js', true],
  ['public/api-docs.html', true],
  ['public/jimeng-omni.html', true],
  ['public/digital-human.html', true],
  ['public/js/digital-human.js', true],
  ['public/css/digital-human.css', true],
  ['public/css/digital-human-wizard.css', true],
  // === 文档 ===
  ['docs/KB_VERIFICATION.md', true],
  // === KB 数据：不覆盖 ===
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
