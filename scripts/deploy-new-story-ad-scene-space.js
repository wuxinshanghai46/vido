const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const password = process.env.VIDO_DEPLOY_PASSWORD || '';
const remoteRoot = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';
const repo = path.resolve(__dirname, '..');
const files = [
  'public/digital-human.html',
  'public/js/new-story-ad-legacy-ui.js',
  'public/js/new-story-ad/keyframes.js',
  'public/js/new-story-ad/scene-assets.js',
  'public/js/new-story-ad/task-persistence.js',
  'src/services/newStoryAd/contextBuilder.js',
  'src/services/newStoryAd/jobService.js',
  'src/services/newStoryAd/mediaAdapter.js',
  'src/services/newStoryAd/modelGateway.js',
  'src/services/newStoryAd/providerAdapterRegistry.js',
  'src/services/newStoryAd/qualityReviewService.js',
  'src/services/newStoryAd/revisionService.js',
  'src/services/newStoryAd/sceneAssetService.js',
  'src/services/newStoryAd/sceneBindingService.js',
  'src/services/newStoryAd/sceneSpaceContractService.js',
  'src/services/newStoryAd/storageService.js',
  'src/services/newStoryAd/storyAdService.js',
  'src/services/newStoryAd/storyboardTableService.js',
];

function connect() {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on('ready', () => resolve(client)).on('error', reject);
    client.connect({ host, port: 22, username: 'root', password, readyTimeout: 25000 });
  });
}

function exec(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let out = '';
      let err = '';
      stream.on('data', chunk => { out += chunk; });
      stream.stderr.on('data', chunk => { err += chunk; });
      stream.on('close', code => code === 0 ? resolve(out) : reject(new Error(err || out || 'remote command failed')));
    });
  });
}

function sftp(client) {
  return new Promise((resolve, reject) => client.sftp((error, channel) => error ? reject(error) : resolve(channel)));
}

function upload(channel, local, remote) {
  return new Promise((resolve, reject) => channel.fastPut(local, remote, error => error ? reject(error) : resolve()));
}

function localHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

(async () => {
  if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
  files.forEach(file => {
    if (!fs.existsSync(path.join(repo, file))) throw new Error('local deployment file missing: ' + file);
  });
  const client = await connect();
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const backupRoot = remoteRoot + '/backups/new-story-ad-scene-space-' + stamp;
  const backupCommands = files.map(file => {
    const quoted = "'" + file.replace(/'/g, "'\\''") + "'";
    return '[ ! -f ' + quoted + ' ] || cp --parents ' + quoted + ' ' + backupRoot;
  }).join(' && ');
  await exec(client, 'cd ' + remoteRoot + ' && mkdir -p ' + backupRoot + ' && ' + backupCommands);
  const channel = await sftp(client);
  for (const file of files) {
    const remote = path.posix.join(remoteRoot, file.split(path.sep).join('/'));
    await exec(client, 'mkdir -p ' + path.posix.dirname(remote));
    await upload(channel, path.join(repo, file), remote);
    const remoteHash = (await exec(client, "sha256sum '" + remote.replace(/'/g, "'\\''") + "' | awk '{print $1}'")).trim();
    if (remoteHash !== localHash(path.join(repo, file))) throw new Error('hash mismatch: ' + file);
    console.log('uploaded ' + file);
  }
  await exec(client, 'cd ' + remoteRoot + ' && node --check src/services/newStoryAd/sceneSpaceContractService.js && node --check src/services/newStoryAd/sceneAssetService.js && node --check src/services/newStoryAd/storyAdService.js');
  console.log((await exec(client, 'pm2 reload vido --update-env 2>&1')).trim());
  await new Promise(resolve => setTimeout(resolve, 2500));
  console.log((await exec(client, "curl -fsS http://127.0.0.1:4600/api/health >/dev/null && echo health=200 && pm2 jlist | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='vido');console.log('pm2='+(p&&p.pm2_env.status))})\"")).trim());
  console.log('backup=' + backupRoot);
  channel.end();
  client.end();
})().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
