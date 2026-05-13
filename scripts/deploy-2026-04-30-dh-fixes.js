#!/usr/bin/env node
/**
 * Deploy 2026-04-30 digital-human fixes.
 *
 * Usage:
 *   VIDO_DEPLOY_PASSWORD='***' node scripts/deploy-2026-04-30-dh-fixes.js
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD || process.env.VIDO_SSH_PASS;
const REMOTE_BASE = process.env.VIDO_REMOTE_BASE || '/opt/vido/app';
const REPO = path.resolve(__dirname, '..');

const FILES = [
  'MCP/md-webcrawl-mcp-master/server.py',
  'package.json',
  'package-lock.json',
  'public/css/digital-human-wizard.css',
  'public/digital-human.html',
  'public/js/digital-human.js',
  'src/routes/avatar.js',
  'src/routes/digitalHuman.js',
  'src/services/aliyunVoiceService.js',
  'src/services/effectsService.js',
  'src/services/hiflyService.js',
  'src/services/ttsService.js',
];

if (!PASSWORD) {
  console.error('Missing VIDO_DEPLOY_PASSWORD');
  process.exit(1);
}

function exec(conn, cmd) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    conn.exec(cmd, (e, stream) => {
      if (e) return resolve({ ok: false, code: -1, out, err: String(e) });
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => err += d.toString());
      stream.on('close', code => resolve({ ok: code === 0, code, out: out.trim(), err: err.trim() }));
    });
  });
}

function sftpOpen(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });
}

function put(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, err => err ? reject(err) : resolve());
  });
}

(async () => {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASSWORD, readyTimeout: 20000 });
  });

  try {
    const sftp = await sftpOpen(conn);
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const backupDir = `${REMOTE_BASE}/.deploy-backup/${stamp}-dh-fixes`;
    let r = await exec(conn, `mkdir -p '${backupDir}'`);
    if (!r.ok) throw new Error(`backup mkdir failed: ${r.err || r.out}`);
    console.log(`backup=${backupDir}`);

    for (const rel of FILES) {
      const local = path.join(REPO, rel);
      if (!fs.existsSync(local)) throw new Error(`local missing: ${rel}`);
      const remote = `${REMOTE_BASE}/${rel}`;
      const remoteBackup = `${backupDir}/${rel.replace(/\//g, '__')}`;
      r = await exec(conn, `mkdir -p '${path.posix.dirname(remote)}' && cp '${remote}' '${remoteBackup}' 2>/dev/null || true`);
      if (!r.ok) throw new Error(`backup failed for ${rel}: ${r.err || r.out}`);
      await put(sftp, local, remote);
      console.log(`uploaded ${rel} ${fs.statSync(local).size}B`);
    }

    r = await exec(conn, `cd '${REMOTE_BASE}' && npm install --omit=dev --no-audit --no-fund`);
    if (!r.ok) throw new Error(`npm install failed: ${r.err || r.out}`);
    console.log('npm install ok');

    r = await exec(conn, `cd '${REMOTE_BASE}' && node --check public/js/digital-human.js && node --check src/routes/avatar.js && node --check src/routes/digitalHuman.js && node --check src/services/aliyunVoiceService.js && node --check src/services/effectsService.js && node --check src/services/hiflyService.js && node --check src/services/ttsService.js`);
    if (!r.ok) throw new Error(`remote syntax check failed: ${r.err || r.out}`);
    console.log('syntax check ok');

    r = await exec(conn, 'pm2 reload vido --update-env');
    if (!r.ok) throw new Error(`pm2 reload failed: ${r.err || r.out}`);
    console.log('pm2 reload ok');

    await new Promise(resolve => setTimeout(resolve, 2500));
    r = await exec(conn, 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health');
    if (r.out !== '200') throw new Error(`health check failed: ${r.out || r.err}`);
    console.log('health=200');
  } finally {
    conn.end();
  }
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
