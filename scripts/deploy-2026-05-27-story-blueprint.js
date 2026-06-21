#!/usr/bin/env node
const path = require('path');
const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || process.env.VIDO_SYNC_HOST || '43.98.167.151';
const user = process.env.VIDO_DEPLOY_USER || process.env.VIDO_SYNC_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD || process.env.VIDO_SYNC_PASSWORD;
const remoteRoot = process.env.VIDO_DEPLOY_REMOTE || process.env.VIDO_SYNC_REMOTE || '/opt/vido/app';
const port = Number(process.env.VIDO_DEPLOY_PORT || process.env.VIDO_SYNC_PORT || 22);
const pm2App = process.env.VIDO_DEPLOY_PM2_APP || 'vido';

const files = [
  'public/digital-human.html',
  'public/css/digital-human-wizard.css',
  'public/js/digital-human.js',
  'src/routes/digitalHuman.js',
];

if (!password) {
  console.error('missing VIDO_DEPLOY_PASSWORD or VIDO_SYNC_PASSWORD');
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = `${remoteRoot}/.deploy-backup/${stamp}-story-blueprint`;

function q(value) {
  return JSON.stringify(String(value));
}

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', reject)
      .connect({ host, port, username: user, password, readyTimeout: 30000 });
  });
}

function exec(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('close', code => resolve({ code, stdout, stderr }));
      stream.on('data', data => { stdout += data.toString(); });
      stream.stderr.on('data', data => { stderr += data.toString(); });
    });
  });
}

function openSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
  });
}

function upload(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, err => (err ? reject(err) : resolve()));
  });
}

async function mustExec(conn, command, label) {
  const result = await exec(conn, command);
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
  return result;
}

async function main() {
  const conn = await connect();
  console.log(`[deploy] connected ${user}@${host}:${remoteRoot}`);

  await mustExec(conn, `mkdir -p ${q(backupRoot)}`, 'create backup dir');
  for (const rel of files) {
    const remote = `${remoteRoot}/${rel}`;
    const backup = `${backupRoot}/${rel}`;
    await mustExec(conn, [
      `mkdir -p ${q(path.posix.dirname(backup))}`,
      `mkdir -p ${q(path.posix.dirname(remote))}`,
      `if [ -f ${q(remote)} ]; then cp ${q(remote)} ${q(backup)}; fi`,
    ].join(' && '), `backup ${rel}`);
  }
  console.log(`[deploy] backed up ${files.length} files to ${backupRoot}`);

  const sftp = await openSftp(conn);
  for (const rel of files) {
    await upload(sftp, path.join(repoRoot, rel), `${remoteRoot}/${rel}`);
    console.log(`[deploy] uploaded ${rel}`);
  }

  await mustExec(conn, `cd ${q(remoteRoot)} && node --check src/routes/digitalHuman.js`, 'remote node --check');
  console.log('[deploy] remote node --check passed');

  await mustExec(conn, `pm2 reload ${q(pm2App)} --update-env`, 'pm2 reload');
  console.log(`[deploy] pm2 reload ${pm2App} done`);

  const health = await mustExec(conn, 'sleep 3; curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health', 'health check');
  if (health.stdout.trim() !== '200') throw new Error(`health check returned ${health.stdout.trim()}`);
  console.log('[deploy] health 200');

  conn.end();
}

main().catch(err => {
  console.error('[deploy] fatal:', err.message);
  process.exit(1);
});
