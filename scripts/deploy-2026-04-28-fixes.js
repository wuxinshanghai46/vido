#!/usr/bin/env node
/**
 * 2026-04-28 修复部署：
 *   1. avatar.js: _dispatchLipSync 加 provider-enabled 预检（model_id → 实际 provider 映射）
 *   2. admin.js:  stage edit modal 的 stale 判断二阶放行（同 provider_id 有其他模型就不标禁用）
 *
 * 用法: VIDO_SSH_PASS='xxx' node scripts/deploy-2026-04-28-fixes.js
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '43.98.167.151', USER = 'root';
const PASS = process.env.VIDO_SSH_PASS;
if (!PASS) { console.error('需 VIDO_SSH_PASS'); process.exit(1); }

const REMOTE_BASE = '/opt/vido/app';
const FILES = [
  'src/routes/avatar.js',
  'public/js/admin.js',
];

function exec(conn, cmd, opts = {}) {
  return new Promise((resolve) => {
    let out = '', err = '';
    conn.exec(cmd, (e, stream) => {
      if (e) return resolve({ ok: false, err: String(e) });
      stream.on('close', (code) => resolve({ ok: code === 0, code, out: out.trim(), err: err.trim() }));
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => err += d);
    });
  });
}

const conn = new Client();
conn.on('ready', () => {
  conn.sftp(async (e, sftp) => {
    if (e) { console.error('sftp err:', e); process.exit(2); }
    try {
      const ts = Date.now();
      // 备份目录
      const bk = await exec(conn, `mkdir -p ${REMOTE_BASE}/.deploy-backup/${ts}`);
      if (!bk.ok) throw new Error('mkdir backup failed: ' + bk.err);
      console.log(`▶ 备份目录: ${REMOTE_BASE}/.deploy-backup/${ts}`);

      // 备份 + 上传
      for (const rel of FILES) {
        const localPath = path.join(__dirname, '..', rel.replace(/\//g, path.sep));
        if (!fs.existsSync(localPath)) throw new Error('本地不存在: ' + localPath);
        const remote = `${REMOTE_BASE}/${rel}`;
        const remoteBk = `${REMOTE_BASE}/.deploy-backup/${ts}/${rel.replace(/\//g, '__')}`;
        const cp = await exec(conn, `cp ${remote} ${remoteBk} 2>/dev/null || true`);
        await new Promise((res, rej) => sftp.fastPut(localPath, remote, e => e ? rej(e) : res()));
        const sz = fs.statSync(localPath).size;
        console.log(`  ✓ ${rel}  ${sz}B`);
      }

      // pm2 reload
      console.log('\n▶ pm2 reload vido --update-env');
      const r = await exec(conn, 'pm2 reload vido --update-env');
      console.log(r.out.split('\n').slice(-5).join('\n'));

      // 健康检查 + 烟测：在生产上跑 dispatcher dry-run
      const probe = await exec(conn, `cd ${REMOTE_BASE} && node -e "
const pms = require('./src/services/pipelineModelService');
const settingsService = require('./src/services/settingsService');
const settings = settingsService.loadSettings();
let chain = pms.pickAllEnabled('avatar.lip_sync');
if (!chain.length) chain = pms.getStageDefaults('avatar.lip_sync');
const ACTUAL_PROVIDER = {
  'jimeng_realman_avatar_picture_omni_v15': 'jimeng',
  'wan2.2-animate-move': 'dashscope',
  'character-3': 'hedra', 'character-2': 'hedra',
  'hifly': 'hifly', 'hifly-free': 'hifly',
};
console.log('=== 生产 lip_sync 链预检 ===');
for (const m of chain) {
  const actualPid = ACTUAL_PROVIDER[m.model_id] || m.provider_id;
  const dep = (settings.providers || []).find(p => p.id === actualPid);
  const status = !dep ? '未找到 provider' : (dep.enabled === false ? '⚠️ 会被预检跳过 (enabled=false)' : '✓ enabled');
  console.log('  ' + (m.priority||'-') + '. ' + m.provider_id + '/' + m.model_id + '  → 依赖 ' + actualPid + '  → ' + status);
}
console.log('=== aliyun-tts stale 测试 ===');
const tts_avail = pms.listAvailableModels('tts');
const tts_chain = pms.getStageDefaults('avatar.tts');
for (const m of tts_chain) {
  const meta = tts_avail.find(a => a.provider_id === m.provider_id && a.model_id === m.model_id);
  let stale = !meta;
  if (stale) {
    const sameProv = tts_avail.some(a => a.provider_id === m.provider_id);
    if (sameProv) stale = false;
  }
  console.log('  ' + m.provider_id + '/' + m.model_id + '  meta=' + !!meta + ' stale=' + stale);
}
"`);
      console.log('\n' + probe.out);
      if (probe.err) console.log('[stderr]', probe.err);

      const hc = await exec(conn, 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health');
      console.log(`\n▶ /api/health: ${hc.out}`);

      console.log('\n✓ 部署完成');
    } catch (e) {
      console.error('错误:', e.message);
      process.exit(2);
    } finally {
      conn.end();
    }
  });
}).on('error', e => { console.error(e.message); process.exit(2); })
  .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 15000 });
