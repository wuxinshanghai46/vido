// Deploy 2026-04-28 v2: 漫路全模型接入 + 强制埋点
//
//   后端：
//   - src/services/deyunaiService.js (新)：统一漫路 chat/images/videos 客户端 + 双通道路由 + 埋点
//   - src/services/imageService.js：新增 generateDeyunaiImage + provider switch case
//   - src/services/videoService.js：新增 generateDeyunaiClip + 加入优先级 + provider switch case
//   - src/services/storyService.js：双通道路由 + reasoning_content fallback + JSON 字符串解析
//   - src/services/settingsService.js：deyunai PROVIDER_PRESETS 全量更新（22 文本 + 14 图像 + 10 视频）
//   - src/services/tokenTracker.js：补 dall-e-2/imagen/flux/seedream/gemini-2.5-image 等价目
//
//   数据：
//   - outputs/settings.json：deyunai 模型清单 50 条（24 enabled 默认）
//
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const FILES = [
  'src/services/deyunaiService.js',
  'src/services/imageService.js',
  'src/services/videoService.js',
  'src/services/storyService.js',
  'src/services/settingsService.js',
  'src/services/tokenTracker.js',
];
const REPO = path.resolve(__dirname, '..');

function connect() { return new Promise((res, rej) => { const c = new Client(); c.on('ready', () => res(c)).on('error', rej); c.connect({ host: HOST, port: 22, username: 'root', password: PASSWORD, readyTimeout: 25000 }); }); }
function sftpOpen(c) { return new Promise((res, rej) => c.sftp((e, s) => e ? rej(e) : res(s))); }
function up(s, l, r) { return new Promise((res, rej) => s.fastPut(l, r, e => e ? rej(e) : res())); }
function dl(s, r, l) { return new Promise((res, rej) => s.fastGet(r, l, e => e ? rej(e) : res())); }
function exec(c, cmd) { return new Promise(res => { c.exec(cmd, (e, st) => { if (e) return res(e.message); let o = ''; st.on('data', d => o += d); st.stderr.on('data', d => o += d); st.on('close', () => res(o)); }); }); }

(async () => {
  const c = await connect();
  const sftp = await sftpOpen(c);

  // merge settings.json deyunai 节点 → 远程
  console.log('[1] merge settings.json deyunai (保留远程 api_key 177):');
  const remoteSettingsPath = '/opt/vido/app/outputs/settings.json';
  const localBackup = path.join(REPO, 'outputs/settings.remote.bak.json');
  await dl(sftp, remoteSettingsPath, localBackup);
  const remoteData = JSON.parse(fs.readFileSync(localBackup, 'utf8'));
  const localData = JSON.parse(fs.readFileSync(path.join(REPO, 'outputs/settings.json'), 'utf8'));
  const localDeyunai = localData.providers.find(p => p.id === 'deyunai');
  const idx = remoteData.providers.findIndex(p => p.id === 'deyunai');
  if (idx >= 0) {
    remoteData.providers[idx].models = localDeyunai.models;
    if (localDeyunai.api_url) remoteData.providers[idx].api_url = localDeyunai.api_url;
    console.log(`  ✓ deyunai.models: ${localDeyunai.models.length} 条`);
    const byUse = {};
    localDeyunai.models.forEach(m => { byUse[m.use] = (byUse[m.use] || 0) + 1; });
    console.log(`    分类: ${JSON.stringify(byUse)}`);
  }
  const tmp = path.join(REPO, 'outputs/settings.merged.tmp.json');
  fs.writeFileSync(tmp, JSON.stringify(remoteData, null, 2), 'utf8');

  console.log('[2] 上传 6 个 src/services 文件:');
  for (const rel of FILES) {
    const local = path.join(REPO, rel);
    if (!fs.existsSync(local)) { console.log('  skip', rel); continue; }
    const remote = path.posix.join('/opt/vido/app', rel.split(path.sep).join('/'));
    await exec(c, `mkdir -p ${path.posix.dirname(remote)}`);
    await up(sftp, local, remote);
    console.log('  ✓', rel, fs.statSync(local).size, 'bytes');
  }
  await up(sftp, tmp, remoteSettingsPath);
  console.log('  ✓ outputs/settings.json (merged)');
  try { fs.unlinkSync(tmp); } catch {}

  console.log('[3] pm2 restart:');
  console.log((await exec(c, 'pm2 restart vido --update-env 2>&1 | head -3')).trim());
  await new Promise(r => setTimeout(r, 4000));

  console.log('[4] health:');
  console.log((await exec(c, 'curl -sk https://vido.smsend.cn/api/health 2>&1 | head -c 250')).trim());
  console.log('');

  console.log('[5] E2E: 漫路图像生成 (走 deyunaiService → nano-banana → 埋点):');
  console.log((await exec(c, `cd /opt/vido/app && node -e "
(async () => {
  const dy = require('./src/services/deyunaiService.js');
  try {
    const r = await dy.generateImage({
      model: 'nano-banana',
      prompt: '一只橙色猫咪在花园里晒太阳, 电影级光影, 高清',
      n: 1, size: '1024x1024',
      timeoutMs: 90000, userId: 'deploy_test', agentId: 'image_gen',
    });
    console.log('✅ 图像 OK, taskId:', r.taskId);
    console.log('   url:', r.urls[0].slice(0, 100) + '...');
  } catch (e) { console.error('❌', e.message); }
})();
" 2>&1 | head -20`)).trim());
  console.log('');

  console.log('[6] 检查 token_usage.json 最近 3 条 deyunai 记录:');
  console.log((await exec(c, `cd /opt/vido/app && python3 -c "
import json
with open('outputs/token_usage.json', encoding='utf-8') as f: d = json.load(f)
calls = d.get('calls', d) if isinstance(d, dict) else d
recent = [c for c in calls if c.get('provider') == 'deyunai'][-5:]
for r in recent:
    print(f\"  [{r['timestamp'][:19]}] {r['category']:6} {r['model']:30} status={r['status']:7} cost=\${r['cost_usd']}\")"
  `)).trim());

  c.end();
  console.log('[deploy] ✅ 完成');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
