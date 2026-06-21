#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const user = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const remoteRoot = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';
const port = Number(process.env.VIDO_DEPLOY_PORT || 22);

if (!password) {
  console.error('missing VIDO_DEPLOY_PASSWORD');
  process.exit(1);
}

const uploadFiles = [
  'src/routes/digitalHuman.js',
];

const backupFiles = [
  ...uploadFiles,
  'outputs/settings.json',
  'outputs/pipeline_model_config.json',
];

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = `${remoteRoot}/.deploy-backup/${stamp}`;

function q(value) {
  return JSON.stringify(String(value));
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('close', code => resolve({ code, stdout, stderr }));
      stream.on('data', d => { stdout += d.toString(); });
      stream.stderr.on('data', d => { stderr += d.toString(); });
    });
  });
}

function put(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, err => err ? reject(err) : resolve());
  });
}

async function main() {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve).on('error', reject).connect({
      host,
      port,
      username: user,
      password,
      readyTimeout: 30000,
    });
  });
  console.log(`[deploy] connected ${user}@${host}:${remoteRoot}`);

  let r = await exec(conn, `mkdir -p ${q(backupRoot)}`);
  if (r.code !== 0) throw new Error(`backup mkdir failed: ${r.stderr || r.stdout}`);
  for (const rel of backupFiles) {
    const remote = `${remoteRoot}/${rel}`;
    const backup = `${backupRoot}/${rel}`;
    r = await exec(conn, `mkdir -p ${q(path.posix.dirname(backup))} && if [ -f ${q(remote)} ]; then cp ${q(remote)} ${q(backup)}; fi`);
    if (r.code !== 0) throw new Error(`backup failed ${rel}: ${r.stderr || r.stdout}`);
  }
  console.log(`[deploy] backed up remote files to ${backupRoot}`);

  const sftp = await new Promise((resolve, reject) => conn.sftp((err, s) => err ? reject(err) : resolve(s)));
  for (const rel of uploadFiles) {
    await put(sftp, path.join(__dirname, '..', rel), `${remoteRoot}/${rel}`);
    console.log(`[deploy] uploaded ${rel}`);
  }

  const patchScript = `
const fs = require('fs');
const settingsPath = ${q(`${remoteRoot}/outputs/settings.json`)};
const pipelinePath = ${q(`${remoteRoot}/outputs/pipeline_model_config.json`)};
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const dy = (settings.providers || []).find(p => p.id === 'deyunai' || p.preset === 'deyunai');
if (!dy) throw new Error('deyunai provider not found');
dy.enabled = dy.enabled !== false;
dy.models = Array.isArray(dy.models) ? dy.models : [];
function ensureModel(id, name) {
  let m = dy.models.find(x => x.id === id);
  if (!m) {
    m = { id, name, type: 'video', use: 'video', channel: 'cn' };
    dy.models.push(m);
  }
  m.name = m.name || name;
  m.type = 'video';
  m.use = 'video';
  m.channel = m.channel || 'cn';
  m.enabled = true;
}
ensureModel('kling-v2-master', 'Kling V2 Master');
ensureModel('kling-v2.5-turbo-pro', 'Kling 2.5 Turbo Pro');
ensureModel('kling-v1-6', 'Kling 1.6');
ensureModel('hailuo-02', 'MiniMax Hailuo 02');
ensureModel('hailuo-02-fast', 'MiniMax Hailuo 02 Fast');
ensureModel('minimax-video-01', 'MiniMax Video-01');
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

const cfg = JSON.parse(fs.readFileSync(pipelinePath, 'utf8'));
cfg.stages = cfg.stages || {};
function setStage(stage, desired) {
  const existing = Array.isArray(cfg.stages[stage]) ? cfg.stages[stage] : [];
  const byKey = new Map(existing.map(m => [m.provider_id + '/' + m.model_id, { ...m }]));
  desired.forEach((m, i) => byKey.set(m.provider_id + '/' + m.model_id, { ...(byKey.get(m.provider_id + '/' + m.model_id) || {}), ...m, priority: i + 1, enabled: m.enabled !== false }));
  const desiredKeys = new Set(desired.map(m => m.provider_id + '/' + m.model_id));
  const rest = [...byKey.values()].filter(m => !desiredKeys.has(m.provider_id + '/' + m.model_id));
  cfg.stages[stage] = [...desired, ...rest].map((m, i) => ({ ...m, priority: i + 1, enabled: m.enabled !== false }));
}
setStage('luxury_ad.video', [
  { provider_id: 'api-key-20260404180437', model_id: 'doubao-seedance-1-0-pro-250528', enabled: true },
  { provider_id: 'deyunai', model_id: 'kling-v2.5-turbo-pro', enabled: true },
  { provider_id: 'deyunai', model_id: 'kling-v2-master', enabled: true },
  { provider_id: 'deyunai', model_id: 'hailuo-02-fast', enabled: true },
  { provider_id: 'deyunai', model_id: 'hailuo-02', enabled: true },
  { provider_id: 'topview', model_id: 'topview-image2video-pro', enabled: true },
]);
setStage('ad_avatar.marketing_video', [
  { provider_id: 'topview', model_id: 'topview-m2v', enabled: true },
  { provider_id: 'api-key-20260404180437', model_id: 'doubao-seedance-1-0-pro-250528', enabled: true },
  { provider_id: 'deyunai', model_id: 'kling-v2.5-turbo-pro', enabled: true },
  { provider_id: 'deyunai', model_id: 'kling-v2-master', enabled: true },
  { provider_id: 'deyunai', model_id: 'hailuo-02-fast', enabled: true },
  { provider_id: 'deyunai', model_id: 'hailuo-02', enabled: true },
]);
fs.writeFileSync(pipelinePath, JSON.stringify(cfg, null, 2));
console.log('deyunai video models enabled and pipeline stages patched');
`;
  const encoded = Buffer.from(patchScript, 'utf8').toString('base64');
  r = await exec(conn, `cd ${q(remoteRoot)} && node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`);
  if (r.code !== 0) throw new Error(`remote config patch failed: ${r.stderr || r.stdout}`);
  console.log(`[deploy] ${r.stdout.trim()}`);

  r = await exec(conn, `cd ${q(remoteRoot)} && node --check src/routes/digitalHuman.js`);
  if (r.code !== 0) throw new Error(`remote node --check failed: ${r.stderr || r.stdout}`);
  console.log('[deploy] remote node --check passed');

  r = await exec(conn, 'pm2 reload vido --update-env');
  if (r.code !== 0) throw new Error(`pm2 reload failed: ${r.stderr || r.stdout}`);
  console.log('[deploy] pm2 reload vido done');

  r = await exec(conn, 'sleep 3; curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health');
  if (r.code !== 0 || !/^200$/.test(r.stdout.trim())) {
    throw new Error(`health check failed: code=${r.code} out=${r.stdout} err=${r.stderr}`);
  }
  console.log('[deploy] health 200');

  r = await exec(conn, `pm2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d).find(x=>x.name==='vido');console.log(j?('status='+j.pm2_env.status+' restarts='+j.pm2_env.restart_time):'NOT_FOUND')})"`);
  console.log(`[deploy] ${r.stdout.trim()}`);

  conn.end();
}

main().catch(err => {
  console.error('[deploy] fatal:', err.message);
  process.exit(1);
});
