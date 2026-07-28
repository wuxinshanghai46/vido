#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const root = path.resolve(__dirname, '..');
const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 2222);
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD || '';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const files = [
  'public/css/digital-human-wizard.css',
  'public/digital-human.html',
  'public/js/new-story-ad/bootstrap.js',
  'public/js/new-story-ad/story-setup.js',
  'src/services/newStoryAd/blueprintService.js',
  'src/services/newStoryAd/textStageRecoveryService.js',
  'scripts/test-new-story-ad-blueprint-quality.js',
  'scripts/test-new-story-ad-compose-gate-autosave.js',
  'scripts/test-new-story-ad-story-setup-flow.js',
  'scripts/test-new-story-ad-content-versioning.js',
  'scripts/test-new-story-ad-scene-lock-ui-binding.js',
];
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupDir = `/opt/vido/backups/blueprint-structure-fix-${stamp}`;
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const client = new Client();

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
const exec = command => new Promise((resolve, reject) => client.exec(command, (error, stream) => {
  if (error) return reject(error);
  let stdout = '';
  let stderr = '';
  stream.on('data', chunk => { stdout += chunk; });
  stream.stderr.on('data', chunk => { stderr += chunk; });
  stream.on('close', code => code === 0
    ? resolve(stdout.trim())
    : reject(new Error(stderr.trim() || stdout.trim() || `exit ${code}`)));
}));
const put = (sftp, local, remote) => new Promise((resolve, reject) => {
  sftp.fastPut(local, remote, error => (error ? reject(error) : resolve()));
});

async function rollback() {
  const fileArgs = files.map(quote).join(' ');
  await exec([
    `cd ${quote(remoteRoot)}`,
    `for f in ${fileArgs}; do grep -Fxq "$f" ${quote(`${backupDir}/manifest.txt`)} || rm -f "$f"; done`,
    `tar -xzf ${quote(`${backupDir}/files.tar.gz`)} -C ${quote(remoteRoot)}`,
    'pm2 reload vido --update-env >/dev/null',
  ].join(' && '));
}

client.on('ready', async () => {
  let sftp;
  try {
    const fileArgs = files.map(quote).join(' ');
    await exec([
      `mkdir -p ${quote(backupDir)}`,
      `cd ${quote(remoteRoot)}`,
      `: > ${quote(`${backupDir}/manifest.txt`)}`,
      `for f in ${fileArgs}; do mkdir -p "$(dirname "$f")"; [ ! -f "$f" ] || echo "$f" >> ${quote(`${backupDir}/manifest.txt`)}; done`,
      `tar -czf ${quote(`${backupDir}/files.tar.gz`)} -T ${quote(`${backupDir}/manifest.txt`)}`,
    ].join(' && '));
    sftp = await new Promise((resolve, reject) => client.sftp((error, value) => (error ? reject(error) : resolve(value))));
    for (const file of files) {
      await put(sftp, path.join(root, file), `${remoteRoot}/${file}`);
    }
    const hashes = Object.fromEntries(files.map(file => [
      file,
      crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
    ]));
    const hashSpec = Buffer.from(JSON.stringify(hashes), 'utf8').toString('base64');
    const output = await exec([
      `cd ${quote(remoteRoot)}`,
      `node -e ${quote(`
        const crypto = require('crypto');
        const fs = require('fs');
        const expected = JSON.parse(Buffer.from('${hashSpec}', 'base64').toString('utf8'));
        const mismatches = Object.entries(expected).filter(([file, hash]) =>
          crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash
        ).map(([file]) => file);
        if (mismatches.length) throw new Error('HASH_MISMATCH:' + mismatches.join(','));
        console.log('HASH_AUDIT=' + Object.keys(expected).length + '/' + Object.keys(expected).length);
      `)}`,
      ...files.filter(file => file.endsWith('.js')).map(file => `node --check ${quote(file)}`),
      'node scripts/test-new-story-ad-blueprint-quality.js',
      'node scripts/test-new-story-ad-story-setup-flow.js',
      'node scripts/test-new-story-ad-content-versioning.js',
      'node scripts/test-new-story-ad-scene-lock-ui-binding.js',
      'node scripts/test-new-story-ad-compose-gate-autosave.js',
      'pm2 reload vido --update-env >/dev/null',
      'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 5; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && echo BLUEPRINT_STRUCTURE_DEPLOY_OK && exit 0; done; exit 1',
    ].join(' && '));
    console.log(`${output}\nBACKUP=${backupDir}`);
    sftp.end();
    client.end();
  } catch (error) {
    if (sftp) sftp.end();
    try {
      await rollback();
      console.error('DEPLOY_FAILED_ROLLED_BACK');
    } catch (rollbackError) {
      console.error(`ROLLBACK_FAILED:${rollbackError.message || rollbackError}`);
    }
    console.error(error.message || error);
    client.end();
    process.exitCode = 1;
  }
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({ host, port, username, password, readyTimeout: 25000 });
