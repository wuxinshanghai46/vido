#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const PORT = Number(process.env.VIDO_DEPLOY_PORT || 22);
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';
const PM2_APP = process.env.VIDO_DEPLOY_PM2_APP || 'vido';
const REPO_ROOT = path.resolve(__dirname, '..');

const FILES = [
  'src/routes/digitalHuman.js',
  'src/routes/admin.js',
  'src/routes/avatar.js',
  'src/services/pipelineModelService.js',
  'src/services/topviewService.js',
  'public/admin.html',
  'public/js/admin.js',
  'public/digital-human.html',
  'public/js/digital-human.js',
  'public/css/digital-human-wizard.css',
];

if (!PASSWORD) {
  console.error('ERROR: missing VIDO_DEPLOY_PASSWORD');
  process.exit(1);
}

function connect() {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c));
    c.on('error', reject);
    c.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 30000 });
  });
}

function exec(c, cmd) {
  return new Promise((resolve, reject) => {
    c.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { errOut += d.toString(); });
      stream.on('close', code => {
        if (code !== 0) return reject(new Error(`command failed ${code}: ${cmd}\n${errOut || out}`));
        resolve({ out, errOut });
      });
    });
  });
}

function sftpOpen(c) {
  return new Promise((resolve, reject) => c.sftp((err, sftp) => err ? reject(err) : resolve(sftp)));
}

function upload(sftp, local, remote) {
  return new Promise((resolve, reject) => sftp.fastPut(local, remote, err => err ? reject(err) : resolve()));
}

(async () => {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  console.log(`[deploy] connect ${USER}@${HOST}:${PORT}`);
  const c = await connect();
  try {
    const sftp = await sftpOpen(c);
    for (const rel of FILES) {
      const local = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(local)) throw new Error(`local file missing: ${rel}`);
      const remote = path.posix.join(REMOTE_ROOT, rel.replace(/\\/g, '/'));
      await exec(c, `mkdir -p '${path.posix.dirname(remote)}' && if [ -f '${remote}' ]; then cp -p '${remote}' '${remote}.bak-${stamp}'; fi`);
      await upload(sftp, local, remote);
      console.log(`[deploy] uploaded ${rel}`);
    }

    await exec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
    console.log('[deploy] pm2 reloaded');
    await new Promise(resolve => setTimeout(resolve, 2500));

    const health = await exec(c, `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health`);
    console.log(`[deploy] health ${health.out.trim()}`);
    if (health.out.trim() !== '200') throw new Error(`health check failed: ${health.out.trim()}`);

    const jsCheck = await exec(c, `cd '${REMOTE_ROOT}' && node --check public/js/digital-human.js >/tmp/vido-dh-check.out 2>&1 && echo OK || (cat /tmp/vido-dh-check.out; exit 1)`);
    console.log(`[deploy] remote js ${jsCheck.out.trim()}`);

    const assetCheck = await exec(c, `grep -q '20260513-provider-labels' '${REMOTE_ROOT}/public/admin.html' && grep -q 'provider_name' '${REMOTE_ROOT}/public/js/admin.js' && grep -q 'pickModelWithDefault' '${REMOTE_ROOT}/src/services/pipelineModelService.js' && grep -q '20260513-product-voice-picker' '${REMOTE_ROOT}/public/digital-human.html' && grep -q 'pdhOpenVoiceModal' '${REMOTE_ROOT}/public/js/digital-human.js' && grep -q 'scriptMode.*audio' '${REMOTE_ROOT}/src/services/topviewService.js' && echo OK`);
    console.log(`[deploy] remote assets ${assetCheck.out.trim()}`);
  } finally {
    c.end();
  }
})().catch(err => {
  console.error(`[deploy] failed: ${err.message}`);
  process.exit(1);
});
