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
  'public/digital-human.html',
  'public/js/digital-human.js',
  'public/css/digital-human-wizard.css',
  'tools/pencil/luxury-ad-standalone-module-2026-05-21.md',
];

const backupFiles = [
  ...uploadFiles,
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
    r = await exec(conn, `mkdir -p ${q(path.posix.dirname(backup))} ${q(path.posix.dirname(remote))} && if [ -f ${q(remote)} ]; then cp ${q(remote)} ${q(backup)}; fi`);
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
const pipelinePath = ${q(`${remoteRoot}/outputs/pipeline_model_config.json`)};
const cfg = JSON.parse(fs.readFileSync(pipelinePath, 'utf8'));
cfg.stages = cfg.stages || {};
cfg.stages['luxury_ad.video'] = [
  { provider_id: 'topview', model_id: 'topview-image2video-pro', enabled: true, priority: 1 },
  { provider_id: 'topview', model_id: 'topview-image2video-best', enabled: true, priority: 2 },
  { provider_id: 'api-key-20260404180437', model_id: 'doubao-seedance-1-0-pro-250528', enabled: true, priority: 3 },
  { provider_id: 'deyunai', model_id: 'kling-v2.5-turbo-pro', enabled: true, priority: 4 },
  { provider_id: 'deyunai', model_id: 'kling-v2-master', enabled: true, priority: 5 },
  { provider_id: 'deyunai', model_id: 'hailuo-02-fast', enabled: true, priority: 6 },
  { provider_id: 'deyunai', model_id: 'hailuo-02', enabled: true, priority: 7 }
];
fs.writeFileSync(pipelinePath, JSON.stringify(cfg, null, 2));
console.log(cfg.stages['luxury_ad.video'].map(m => m.priority + ':' + m.provider_id + '/' + m.model_id).join('\\n'));
`;
  const encoded = Buffer.from(patchScript, 'utf8').toString('base64');
  r = await exec(conn, `cd ${q(remoteRoot)} && node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`);
  if (r.code !== 0) throw new Error(`remote config patch failed: ${r.stderr || r.stdout}`);
  console.log(`[deploy] remote luxury queue:\n${r.stdout.trim()}`);

  r = await exec(conn, `cd ${q(remoteRoot)} && node --check src/routes/digitalHuman.js && node --check public/js/digital-human.js`);
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
