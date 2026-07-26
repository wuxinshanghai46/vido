const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const root = path.resolve(__dirname, '..');
const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const files = [
  'public/digital-human.html',
  'public/js/new-story-ad/bootstrap.js',
  'public/js/new-story-ad/scene-assets.js',
  'src/services/newStoryAd/mediaAdapter.js',
  'src/services/newStoryAd/sceneAssetService.js',
  'src/services/newStoryAd/sceneAtlasService.js',
  'src/services/newStoryAd/sceneViewStrategyService.js',
  'scripts/test-new-story-ad-scene-atlas-v7.js',
];

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');

const expectedHashes = Object.fromEntries(files.map(file => [
  file,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
]));
const remoteProbe = `
const crypto = require('crypto');
const fs = require('fs');
const sceneAssets = require('./src/services/newStoryAd/sceneAssetService');
const sceneAtlas = require('./src/services/newStoryAd/sceneAtlasService');
const strategies = require('./src/services/newStoryAd/sceneViewStrategyService');
const files = ${JSON.stringify(files)};
const hashes = Object.fromEntries(files.map(file => [
  file,
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
]));
console.log('PROBE=' + JSON.stringify({
  generation_contract_version: sceneAssets.SCENE_GENERATION_CONTRACT_VERSION,
  space_asset_schema_version: sceneAtlas.SPACE_ASSET_SCHEMA_VERSION,
  atlas_strategy_registered: strategies.STRATEGIES.includes('atlas_2x2'),
  hashes,
}));
`;
const encodedProbe = Buffer.from(remoteProbe, 'utf8').toString('base64');
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const command = [
  `cd ${quote(remoteRoot)}`,
  ...files.filter(file => file.endsWith('.js')).map(file => `node --check ${quote(file)}`),
  `node -e "eval(Buffer.from('${encodedProbe}','base64').toString('utf8'))"`,
  "pm2 jlist | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='vido');console.log('PM2='+JSON.stringify({status:p?.pm2_env?.status,restarts:p?.pm2_env?.restart_time,uptime_seconds:Math.floor((Date.now()-(p?.pm2_env?.pm_uptime||Date.now()))/1000),cwd:p?.pm2_env?.pm_cwd}))})\"",
  "printf 'HEALTH='; curl -fsS -w '|HTTP:%{http_code}\\n' http://127.0.0.1:4600/api/health",
  "printf 'BOOTSTRAP_VERSION='; curl -fsS http://127.0.0.1:4600/js/new-story-ad/bootstrap.js | grep -o '20260725-direct-scene-generation-v25' | head -n 1",
  "printf 'SCENE_JS_CONTRACT='; curl -fsS 'http://127.0.0.1:4600/js/new-story-ad/scene-assets.js?v=20260725-direct-scene-generation-v25' | grep -o \"view_strategy: 'atlas_2x2'\" | head -n 1",
  "printf 'DIRECT_SCENE_GENERATION='; curl -fsS 'http://127.0.0.1:4600/js/new-story-ad/scene-assets.js?v=20260725-direct-scene-generation-v25' | grep -o 'acknowledge_billing_unknown: true' | head -n 1",
].join(' && ');

function exec(client, value) {
  return new Promise((resolve, reject) => client.exec(value, (error, stream) => {
    if (error) return reject(error);
    let stdout = '';
    let stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => code === 0
      ? resolve(stdout)
      : reject(new Error(stderr || stdout || `remote probe exit ${code}`)));
  }));
}

async function publicHealth() {
  const response = await fetch(`http://${host}:4600/api/health`, { signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json() };
}

const client = new Client();
client.on('ready', async () => {
  try {
    const output = await exec(client, command);
    const probeLine = output.split(/\r?\n/).find(line => line.startsWith('PROBE='));
    const pm2Line = output.split(/\r?\n/).find(line => line.startsWith('PM2='));
    if (!probeLine || !pm2Line) throw new Error('远端核对输出缺少 PROBE 或 PM2');
    const probe = JSON.parse(probeLine.slice('PROBE='.length));
    const pm2 = JSON.parse(pm2Line.slice('PM2='.length));
    const hashMismatches = files.filter(file => probe.hashes?.[file] !== expectedHashes[file]);
    if (hashMismatches.length) throw new Error(`远端文件哈希不一致：${hashMismatches.join(', ')}`);
    if (probe.generation_contract_version !== 7
      || probe.space_asset_schema_version !== 7
      || probe.atlas_strategy_registered !== true) {
      throw new Error(`远端 V7 契约未生效：${JSON.stringify(probe)}`);
    }
    if (pm2.status !== 'online') throw new Error(`PM2 非 online：${JSON.stringify(pm2)}`);
    if (!/HEALTH=.*HTTP:200/.test(output)
      || !/BOOTSTRAP_VERSION=20260725-direct-scene-generation-v25/.test(output)
      || !/SCENE_JS_CONTRACT=view_strategy: 'atlas_2x2'/.test(output)
      || !/DIRECT_SCENE_GENERATION=acknowledge_billing_unknown: true/.test(output)) {
      throw new Error(`远端 HTTP 静态契约核对失败：${output}`);
    }
    const publicResult = await publicHealth();
    if (publicResult.status !== 200 || publicResult.body?.status !== 'ok') {
      throw new Error(`公网健康检查失败：${JSON.stringify(publicResult)}`);
    }
    console.log(JSON.stringify({
      status: 'PASS',
      remote_files_hash_matched: files.length,
      generation_contract_version: probe.generation_contract_version,
      space_asset_schema_version: probe.space_asset_schema_version,
      atlas_strategy_registered: probe.atlas_strategy_registered,
      pm2,
      private_health_http: 200,
      public_health: publicResult,
      frontend_cache_version: '20260725-direct-scene-generation-v25',
    }, null, 2));
  } finally {
    client.end();
  }
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({ host, port: 22, username, password, readyTimeout: 25000 });
