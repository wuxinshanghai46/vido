#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const PORT = Number(process.env.VIDO_DEPLOY_PORT || 22);
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';
const PM2_APP = process.env.VIDO_DEPLOY_PM2_APP || 'vido';
const REPO_ROOT = path.resolve(__dirname, '..');
const FILES = [
  'public/digital-human.html',
  'public/js/digital-human.js',
  'public/css/digital-human-wizard.css',
  'src/routes/digitalHuman.js',
];

if (!HOST || !PASSWORD) {
  console.error('Missing VIDO_DEPLOY_HOST or VIDO_DEPLOY_PASSWORD');
  process.exit(1);
}

function connect() {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on('ready', () => resolve(client));
    client.on('error', reject);
    client.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
  });
}

function openSftp(client) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });
}

function exec(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('close', code => resolve({ code, stdout, stderr }));
      stream.on('data', data => stdout += data.toString());
      stream.stderr.on('data', data => stderr += data.toString());
    });
  });
}

function upload(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, err => err ? reject(err) : resolve());
  });
}

(async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = `${REMOTE_ROOT}/.deploy-backup/${stamp}`;
  const client = await connect();
  try {
    const sftp = await openSftp(client);
    await exec(client, `mkdir -p ${JSON.stringify(backupDir)}`);
    for (const rel of FILES) {
      const localPath = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(localPath)) throw new Error(`Local file not found: ${rel}`);
      const remotePath = `${REMOTE_ROOT}/${rel.replace(/\\/g, '/')}`;
      const remoteBackup = `${backupDir}/${rel.replace(/\\/g, '/')}`;
      await exec(client, `mkdir -p ${JSON.stringify(path.posix.dirname(remoteBackup))} ${JSON.stringify(path.posix.dirname(remotePath))}`);
      await exec(client, `if [ -f ${JSON.stringify(remotePath)} ]; then cp ${JSON.stringify(remotePath)} ${JSON.stringify(remoteBackup)}; fi`);
      await upload(sftp, localPath, remotePath);
      console.log(`uploaded ${rel}`);
    }
    const reload = await exec(client, `cd ${JSON.stringify(REMOTE_ROOT)} && pm2 reload ${JSON.stringify(PM2_APP)} --update-env`);
    if (reload.code !== 0) throw new Error(`pm2 reload failed: ${reload.stderr || reload.stdout}`);
    const health = await exec(client, `curl -fsS --max-time 10 http://127.0.0.1:4600/api/health`);
    if (health.code !== 0) throw new Error(`health check failed: ${health.stderr || health.stdout}`);
    console.log(`backup ${backupDir}`);
    console.log(`health ${health.stdout.trim()}`);
  } finally {
    client.end();
  }
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
