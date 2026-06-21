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
  'public/digital-human.html',
  'public/js/digital-human.js',
  'public/css/digital-human-wizard.css',
  'tools/pencil/luxury-ad-reference-alignment-2026-05-21.md',
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

  for (const rel of files) {
    const remote = `${remoteRoot}/${rel}`;
    const backup = `${backupRoot}/${rel}`;
    r = await exec(conn, `mkdir -p ${q(path.posix.dirname(backup))} ${q(path.posix.dirname(remote))} && if [ -f ${q(remote)} ]; then cp ${q(remote)} ${q(backup)}; fi`);
    if (r.code !== 0) throw new Error(`backup failed ${rel}: ${r.stderr || r.stdout}`);
  }
  console.log(`[deploy] backed up remote files to ${backupRoot}`);

  const sftp = await new Promise((resolve, reject) => conn.sftp((err, s) => err ? reject(err) : resolve(s)));
  for (const rel of files) {
    await put(sftp, path.join(__dirname, '..', rel), `${remoteRoot}/${rel}`);
    console.log(`[deploy] uploaded ${rel}`);
  }

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
