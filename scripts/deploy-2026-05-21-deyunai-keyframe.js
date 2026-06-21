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

const files = [
  'src/routes/digitalHuman.js',
  'src/services/settingsService.js',
];

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = `${remoteRoot}/.deploy-backup/${stamp}`;

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

function jsString(value) {
  return JSON.stringify(String(value));
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

  const mkdir = await exec(conn, `mkdir -p ${jsString(backupRoot)}`);
  if (mkdir.code !== 0) throw new Error(`backup mkdir failed: ${mkdir.stderr}`);

  for (const rel of files) {
    const remote = `${remoteRoot}/${rel}`;
    const backup = `${backupRoot}/${rel}`;
    const cmd = `mkdir -p ${jsString(path.posix.dirname(backup))} && if [ -f ${jsString(remote)} ]; then cp ${jsString(remote)} ${jsString(backup)}; fi`;
    const r = await exec(conn, cmd);
    if (r.code !== 0) throw new Error(`backup failed ${rel}: ${r.stderr}`);
  }
  console.log(`[deploy] backed up remote files to ${backupRoot}`);

  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, s) => err ? reject(err) : resolve(s));
  });
  for (const rel of files) {
    const local = path.join(__dirname, '..', rel);
    const remote = `${remoteRoot}/${rel}`;
    await put(sftp, local, remote);
    console.log(`[deploy] uploaded ${rel}`);
  }

  const patchSettings = `
const fs = require('fs');
const file = ${jsString(`${remoteRoot}/outputs/settings.json`)};
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const dy = (data.providers || []).find(p => p.id === 'deyunai' || p.preset === 'deyunai');
if (!dy) throw new Error('deyunai provider not found');
dy.models = Array.isArray(dy.models) ? dy.models : [];
const additions = [
  { id: 'qwen-image-edit', name: 'Qwen-Image-Edit（图像编辑）', type: 'image', use: 'image', enabled: true, channel: 'cn', note: '2026-05-21 smoke ok via /v1/images/generations' },
  { id: 'qwen-image', name: 'Qwen-Image', type: 'image', use: 'image', enabled: true, channel: 'cn', note: '2026-05-21 smoke ok via /v1/images/generations' },
  { id: 'doubao-seedream-4-0-250828', name: '豆包 Seedream 4.0（图像编辑）', type: 'image', use: 'image', enabled: true, channel: 'cn', note: '2026-05-21 smoke ok via /v1/images/generations' },
];
let changed = false;
for (const item of additions) {
  const existing = dy.models.find(m => m.id === item.id);
  if (existing) {
    Object.assign(existing, item);
  } else {
    const idx = dy.models.findIndex(m => m.id === 'seedream-3.0');
    if (idx >= 0) dy.models.splice(idx, 0, item);
    else dy.models.push(item);
  }
  changed = true;
}
if (changed) fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log('deyunai models ok=' + additions.map(x => x.id).join(','));
`;
  const patchEncoded = Buffer.from(patchSettings, 'utf8').toString('base64');
  const patch = await exec(conn, `cd ${jsString(remoteRoot)} && node -e "eval(Buffer.from('${patchEncoded}','base64').toString('utf8'))"`);
  if (patch.code !== 0) throw new Error(`settings patch failed: ${patch.stderr || patch.stdout}`);
  console.log(`[deploy] ${patch.stdout.trim()}`);

  const checkCmd = `cd ${jsString(remoteRoot)} && node --check src/routes/digitalHuman.js && node --check src/services/settingsService.js`;
  const check = await exec(conn, checkCmd);
  if (check.code !== 0) throw new Error(`node --check failed: ${check.stderr || check.stdout}`);
  console.log('[deploy] remote node --check passed');

  const reload = await exec(conn, 'pm2 reload vido --update-env');
  if (reload.code !== 0) throw new Error(`pm2 reload failed: ${reload.stderr || reload.stdout}`);
  console.log('[deploy] pm2 reload vido done');

  const health = await exec(conn, 'sleep 3; curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health');
  if (health.code !== 0 || !/^200$/.test(health.stdout.trim())) {
    throw new Error(`health check failed: code=${health.code} out=${health.stdout} err=${health.stderr}`);
  }
  console.log('[deploy] health 200');

  const status = await exec(conn, `pm2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d).find(x=>x.name==='vido');console.log(j?('status='+j.pm2_env.status+' restarts='+j.pm2_env.restart_time):'NOT_FOUND')})"`);
  console.log(`[deploy] ${status.stdout.trim()}`);

  conn.end();
}

main().catch(err => {
  console.error('[deploy] fatal:', err.message);
  process.exit(1);
});
