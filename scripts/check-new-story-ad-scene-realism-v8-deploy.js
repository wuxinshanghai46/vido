const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const repoRoot = path.resolve(__dirname, '..');
const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD || '';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const taskId = process.env.VIDO_SCENE_AUDIT_TASK_ID || 'd36055d2-890d-444f-9a6b-33d23bb2e2bc';
const cacheVersion = '20260728-story-step-v48';
const files = [
  'public/digital-human.html',
  'public/css/digital-human-wizard.css',
  'public/js/new-story-ad/bootstrap.js',
  'public/js/new-story-ad/scene-assets.js',
  'src/services/newStoryAd/sceneAssetService.js',
];

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');

const expectedHashes = Object.fromEntries(files.map(file => [
  file,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, file))).digest('hex'),
]));
const remoteProbe = `
const crypto = require('crypto');
const fs = require('fs');
const storage = require('./src/services/newStoryAd/storageService');
const storyAdService = require('./src/services/newStoryAd/storyAdService');
const sceneAssetService = require('./src/services/newStoryAd/sceneAssetService');
const sceneSpaceContract = require('./src/services/newStoryAd/sceneSpaceContractService');
const sceneStrategies = require('./src/services/newStoryAd/sceneViewStrategyService');
const files = ${JSON.stringify(files)};
const taskId = ${JSON.stringify(taskId)};
const task = storage.getTask(taskId);
const outputRows = storage.listOutputs(taskId);
const context = storage.getOutput(taskId, 'context') || task?.request || {};
const hashes = Object.fromEntries(files.map(file => [
  file,
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
]));
const rawAssets = storage.getOutput(taskId, 'scene_assets')
  || context.scene_assets
  || task?.request?.scene_assets
  || [];
const projectedAssets = storyAdService.publicTaskBundle(taskId).outputs?.scene_assets || [];
const summarize = asset => {
  const contract = asset.scene_contract || asset.space_contract || {};
  const photo = asset.photographic_realism_qa || contract.photographic_realism_qa || {};
  const cameraQa = asset.camera_design_qa || contract.camera_design_qa || {};
  const acquisition = asset.view_acquisition || {};
  const canonicalSource = asset.space_asset_contract?.canonical_source || {};
  return {
    id: asset.id || asset.scene_id || asset.space_id || '',
    name: asset.name || '',
    view_strategy: asset.view_strategy || acquisition.strategy || '',
    generation_contract_version: asset.generation_contract_version || contract.generation_contract_version || 0,
    schema_version: contract.schema_version || 0,
    view_count: Array.isArray(asset.view_images) ? asset.view_images.length : 0,
    has_mother_atlas: Boolean(canonicalSource.url || canonicalSource.image_url || acquisition.atlas_url || acquisition.mother_image_url || asset.atlas_url),
    mother_atlas_hash_prefix: String(canonicalSource.sha256 || '').slice(0, 12),
    provider_call_count: asset.space_asset_contract?.provider_image_call_count
      ?? acquisition.provider_image_call_count
      ?? acquisition.provider_call_count
      ?? acquisition.model_call_count
      ?? null,
    photographic_realism_pass: photo.pass === true,
    photographic_realism_legacy: photo.legacy === true,
    photographic_realism_score: photo.photographic_realism_score ?? null,
    camera_design_pass: cameraQa.pass === true,
    camera_design_legacy: cameraQa.legacy === true,
    camera_design_scores: {
      role_definition: cameraQa.role_definition_score ?? null,
      requirement_mapping: cameraQa.requirement_mapping_score ?? null,
      direction_evidence: cameraQa.direction_evidence_score ?? null,
      parameter_completeness: cameraQa.parameter_completeness_score ?? null,
      layout_mapping: cameraQa.layout_mapping_score ?? null,
    },
    full_space_lock: contract.full_space_lock === true,
    space_lock_status: contract.space_lock_status || '',
    verification_status: asset.verification_status || contract.status || '',
    repair_action: asset.repair_plan?.action || contract.repair_plan?.action || '',
    camera_evidence: (Array.isArray(contract.cameras) ? contract.cameras : []).map(camera => ({
      id: camera.id || '',
      view_id: camera.view_id || '',
      label: camera.label || '',
      framing: camera.framing || '',
      lens_class: camera.lens_class || '',
      orientation: camera.orientation || '',
      allowed_zone_ids: Array.isArray(camera.allowed_zone_ids) ? camera.allowed_zone_ids : [],
    })),
    layout_evidence: {
      zone_count: Array.isArray(contract.layout_contract?.zones) ? contract.layout_contract.zones.length : 0,
      anchor_count: Array.isArray(contract.layout_contract?.anchors) ? contract.layout_contract.anchors.length : 0,
      camera_path: Array.isArray(contract.layout_contract?.camera_path) ? contract.layout_contract.camera_path : [],
    },
    camera_issue_count: (Array.isArray(contract.view_issues) ? contract.view_issues : [])
      .filter(issue => ['REVERSE_COVERAGE_LOW', 'INTERACTION_ZONE_MISSING', 'CAMERA_DIVERSITY_LOW', 'LAYOUT_ROLE_INVALID', 'LAYOUT_TOPOLOGY_INCOMPLETE'].includes(issue.code)).length,
  };
};
console.log('PROBE=' + JSON.stringify({
  generation_contract_version: sceneAssetService.SCENE_GENERATION_CONTRACT_VERSION,
  normalized_contract_schema_version: sceneSpaceContract.normalizeContract({}).schema_version,
  atlas_strategy_registered: sceneStrategies.STRATEGIES.includes('atlas_2x2'),
  task_exists: Boolean(task),
  task_status: task?.status || '',
  task_stage: task?.stage || '',
  output_kinds: outputRows.map(row => row.kind),
  context_scene_asset_count: Array.isArray(context.scene_assets) ? context.scene_assets.length : 0,
  raw_assets: (Array.isArray(rawAssets) ? rawAssets : []).map(summarize),
  projected_assets: (Array.isArray(projectedAssets) ? projectedAssets : []).map(summarize),
  hashes,
}));
`;
const encodedProbe = Buffer.from(remoteProbe, 'utf8').toString('base64');

function quote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function exec(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = '';
      let stderr = '';
      stream.on('data', chunk => { stdout += chunk; });
      stream.stderr.on('data', chunk => { stderr += chunk; });
      stream.on('close', code => code === 0
        ? resolve(stdout)
        : reject(new Error(stderr || stdout || `remote probe failed (${code})`)));
    });
  });
}

async function publicHealth() {
  const response = await fetch('https://vido.smsend.cn/api/health', {
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  return { status: response.status, body };
}

(async () => {
  const client = new Client();
  await new Promise((resolve, reject) => {
    client.on('ready', resolve).on('error', reject);
    client.connect({ host, port: 22, username, password, readyTimeout: 25000 });
  });
  try {
    const javascriptFiles = files.filter(file => file.endsWith('.js'));
    const command = [
      `cd ${quote(remoteRoot)}`,
      ...javascriptFiles.map(file => `node --check ${quote(file)}`),
      `node -e "eval(Buffer.from('${encodedProbe}','base64').toString('utf8'))"`,
      "pm2 jlist | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='vido');console.log('PM2='+JSON.stringify({status:p?.pm2_env?.status,restarts:p?.pm2_env?.restart_time,uptime_seconds:Math.floor((Date.now()-(p?.pm2_env?.pm_uptime||Date.now()))/1000)}))})\"",
      "printf 'PRIVATE_HEALTH='; curl -fsS -w '|HTTP:%{http_code}\\n' http://127.0.0.1:4600/api/health",
      "printf 'LATEST_BACKUP='; ls -1dt backups/new-story-ad-camera-interaction-v10-* 2>/dev/null | head -n 1",
      `printf 'CACHE_VERSION='; curl -fsS http://127.0.0.1:4600/js/new-story-ad/bootstrap.js | grep -o ${quote(cacheVersion)} | head -n 1`,
      `printf 'CAMERA_QA_UI='; curl -fsS 'http://127.0.0.1:4600/js/new-story-ad/scene-assets.js?v=${cacheVersion}' | grep -o '机位设计验收' | head -n 1`,
      `printf 'CAMERA_EVIDENCE_UI='; curl -fsS 'http://127.0.0.1:4600/js/new-story-ad/scene-assets.js?v=${cacheVersion}' | grep -o '逐机位参数、俯视定位、需求映射与可见证据' | head -n 1`,
      `printf 'CAMERA_LAYOUT_CSS='; curl -fsS 'http://127.0.0.1:4600/css/digital-human-wizard.css?v=${cacheVersion}' | grep -o 'minmax(360px, 440px)' | head -n 1`,
      `printf 'CAMERA_COLLAPSED_UI='; curl -fsS 'http://127.0.0.1:4600/js/new-story-ad/scene-assets.js?v=${cacheVersion}' | grep -o '<details class="dh-nsa-camera-acceptance">' | head -n 1`,
      `printf 'CAMERA_RESPONSE_SYNC='; grep -o 'camera_design_qa: contract.camera_design_qa' src/services/newStoryAd/sceneAssetService.js | head -n 1`,
      `printf 'ATLAS_DEFAULT='; curl -fsS 'http://127.0.0.1:4600/js/new-story-ad/scene-assets.js?v=${cacheVersion}' | grep -o "view_strategy: 'atlas_2x2'" | head -n 1`,
    ].join(' && ');
    const output = await exec(client, command);
    const probeLine = output.split(/\r?\n/).find(line => line.startsWith('PROBE='));
    const pm2Line = output.split(/\r?\n/).find(line => line.startsWith('PM2='));
    if (!probeLine || !pm2Line) throw new Error(`remote output missing PROBE or PM2: ${output}`);
    const probe = JSON.parse(probeLine.slice('PROBE='.length));
    const pm2 = JSON.parse(pm2Line.slice('PM2='.length));
    const latestBackup = output.split(/\r?\n/).find(line => line.startsWith('LATEST_BACKUP='))
      ?.slice('LATEST_BACKUP='.length) || '';
    const hashMismatches = files.filter(file => probe.hashes?.[file] !== expectedHashes[file]);
    if (hashMismatches.length) throw new Error(`remote hash mismatch: ${hashMismatches.join(', ')}`);
    if (probe.generation_contract_version !== 7
      || probe.normalized_contract_schema_version !== 6
      || probe.atlas_strategy_registered !== true) {
      throw new Error(`remote scene contract invalid: ${JSON.stringify(probe)}`);
    }
    if (!probe.task_exists) throw new Error(`target task missing: ${taskId}`);
    if (!Array.isArray(probe.projected_assets)
      || probe.projected_assets.length !== 2
      || probe.projected_assets.some(asset => (
        asset.schema_version !== 6
        || (asset.full_space_lock === true && (
          asset.camera_design_pass !== true
          || asset.space_lock_status !== 'complete'
          || asset.repair_action !== 'none'
        ))
        || (asset.full_space_lock !== true && (
          asset.camera_design_pass === true
          || asset.repair_action === 'none'
        ))
      ))) {
      throw new Error(`target camera projection invalid: ${JSON.stringify(probe.projected_assets)}`);
    }
    if (pm2.status !== 'online') throw new Error(`PM2 is not online: ${JSON.stringify(pm2)}`);
    if (!/PRIVATE_HEALTH=.*HTTP:200/.test(output)
      || !new RegExp(`CACHE_VERSION=${cacheVersion}`).test(output)
      || !/CAMERA_QA_UI=机位设计验收/.test(output)
      || !/CAMERA_EVIDENCE_UI=逐机位参数、俯视定位、需求映射与可见证据/.test(output)
      || !/CAMERA_LAYOUT_CSS=minmax\(360px, 440px\)/.test(output)
      || !/CAMERA_COLLAPSED_UI=<details class="dh-nsa-camera-acceptance">/.test(output)
      || !/CAMERA_RESPONSE_SYNC=camera_design_qa: contract.camera_design_qa/.test(output)
      || !/ATLAS_DEFAULT=view_strategy: 'atlas_2x2'/.test(output)) {
      throw new Error(`remote HTTP/static contract failed: ${output}`);
    }
    const publicResult = await publicHealth();
    if (publicResult.status !== 200 || publicResult.body?.status !== 'ok') {
      throw new Error(`public health failed: ${JSON.stringify(publicResult)}`);
    }
    console.log(JSON.stringify({
      status: 'PASS',
      remote_files_hash_matched: files.length,
      remote_node_check_passed: javascriptFiles.length,
      generation_contract_version: probe.generation_contract_version,
      normalized_contract_schema_version: probe.normalized_contract_schema_version,
      atlas_strategy_registered: probe.atlas_strategy_registered,
      frontend_cache_version: cacheVersion,
      pm2,
      latest_backup: latestBackup,
      private_health_http: 200,
      public_health: publicResult,
      target_task_read_only: {
        task_id: taskId,
        task_status: probe.task_status,
        task_stage: probe.task_stage,
        output_kinds: probe.output_kinds,
        context_scene_asset_count: probe.context_scene_asset_count,
        raw_assets: probe.raw_assets,
        projected_assets: probe.projected_assets,
      },
      model_or_image_calls_triggered: 0,
      writes_to_target_task: 0,
    }, null, 2));
  } finally {
    client.end();
  }
})().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
