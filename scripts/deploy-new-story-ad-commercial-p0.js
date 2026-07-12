const path = require('path');
const { Client } = require('ssh2');

const root = path.resolve(__dirname, '..');
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const host = process.env.VIDO_DEPLOY_HOST;
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const files = [
  'src/routes/newStoryAd.js',
  'src/routes/dashboard.js',
  'src/services/newStoryAd/composeService.js',
  'src/services/newStoryAd/contextBuilder.js',
  'src/services/newStoryAd/continuityService.js',
  'src/services/newStoryAd/jobService.js',
  'src/services/newStoryAd/jsonRepairService.js',
  'src/services/newStoryAd/keyframeContractService.js',
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
  'src/services/newStoryAd/ttsAdapter.js',
  'src/services/newStoryAd/videoAdapter.js',
  'public/digital-human.html',
  'public/index.html',
  'public/css/digital-human-wizard.css',
  'public/css/dashboard-workbench.css',
  'public/js/new-story-ad-legacy-ui.js',
  'public/js/dashboard-workbench.js',
  'scripts/test-new-story-ad-reliability.js',
  'scripts/test-new-story-ad-scene-space.js',
  'scripts/test-new-story-ad-commercial-readiness.js'
];
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupDir = `/opt/vido/backups/new-story-ad-commercial-p0-${stamp}`;
const client = new Client();

if (!host || !password) throw new Error('缺少生产服务器部署环境变量');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function exec(command) {
  return new Promise((resolve, reject) => client.exec(command, (error, stream) => {
    if (error) return reject(error);
    let out = '';
    let err = '';
    stream.on('data', chunk => { out += chunk; });
    stream.stderr.on('data', chunk => { err += chunk; });
    stream.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`)));
  }));
}

async function rollback() {
  const fileArgs = files.map(shellQuote).join(' ');
  await exec(`cd ${shellQuote(remoteRoot)} && for f in ${fileArgs}; do grep -Fxq "$f" ${shellQuote(`${backupDir}/manifest.txt`)} || rm -f "$f"; done; [ ! -s ${shellQuote(`${backupDir}/files.tar.gz`)} ] || tar -xzf ${shellQuote(`${backupDir}/files.tar.gz`)} -C ${shellQuote(remoteRoot)}; pm2 reload vido --update-env >/dev/null`);
}

client.on('ready', async () => {
  let sftp;
  try {
    const fileArgs = files.map(shellQuote).join(' ');
    await exec(`mkdir -p ${shellQuote(backupDir)} && cd ${shellQuote(remoteRoot)} && : > ${shellQuote(`${backupDir}/manifest.txt`)} && for f in ${fileArgs}; do if [ -f "$f" ]; then echo "$f" >> ${shellQuote(`${backupDir}/manifest.txt`)}; fi; mkdir -p "$(dirname "$f")"; done && if [ -s ${shellQuote(`${backupDir}/manifest.txt`)} ]; then tar -czf ${shellQuote(`${backupDir}/files.tar.gz`)} -T ${shellQuote(`${backupDir}/manifest.txt`)}; else : > ${shellQuote(`${backupDir}/files.tar.gz`)}; fi`);
    sftp = await new Promise((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)));
    for (const file of files) {
      await new Promise((resolve, reject) => sftp.fastPut(path.join(root, file), `${remoteRoot}/${file}`, error => error ? reject(error) : resolve()));
    }
    const jsChecks = files.filter(file => file.endsWith('.js') && !file.startsWith('public/')).map(file => `node --check ${shellQuote(file)}`).join(' && ');
    const result = await exec(`cd ${shellQuote(remoteRoot)} && ${jsChecks} && node --check public/js/new-story-ad-legacy-ui.js && node --check public/js/dashboard-workbench.js && node scripts/test-new-story-ad-reliability.js && node scripts/test-new-story-ad-scene-space.js && node scripts/test-new-story-ad-commercial-readiness.js && pm2 reload vido --update-env >/dev/null && for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 5; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && echo NEW_STORY_AD_COMMERCIAL_P0_DEPLOY_OK && exit 0; done; exit 1`);
    console.log(result);
    sftp.end();
    client.end();
  } catch (error) {
    if (sftp) sftp.end();
    try { await rollback(); } catch (rollbackError) { console.error(`回滚失败: ${rollbackError.message || rollbackError}`); }
    console.error(error.message || error);
    client.end();
    process.exitCode = 1;
  }
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({ host, port: 22, username, password, readyTimeout: 25000 });
