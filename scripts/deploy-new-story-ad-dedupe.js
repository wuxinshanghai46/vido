const path = require('path');
const { Client } = require('ssh2');
const client = new Client();
const root = path.resolve(__dirname, '..');
const remoteRoot = '/opt/vido/app';
const files = [
  'public/js/new-story-ad-legacy-ui.js',
  'public/digital-human.html',
  'src/services/newStoryAd/storageService.js',
  'src/services/newStoryAd/storyAdService.js',
  'scripts/cleanup-new-story-ad-duplicates.js',
];
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
function exec(command) { return new Promise((resolve, reject) => client.exec(command, (error, stream) => { if (error) return reject(error); let out='', err=''; stream.on('data', chunk => out += chunk); stream.stderr.on('data', chunk => err += chunk); stream.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`))); })); }
client.on('ready', async () => {
  try {
    await exec(`cd ${remoteRoot} && mkdir -p scripts && for f in ${files.join(' ')}; do [ ! -f "$f" ] || cp "$f" "$f.bak-${stamp}-dedupe"; done`);
    const sftp = await new Promise((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)));
    for (const file of files) await new Promise((resolve, reject) => sftp.fastPut(path.join(root, file), `${remoteRoot}/${file}`, error => error ? reject(error) : resolve()));
    const output = await exec(`cd ${remoteRoot} && node --check public/js/new-story-ad-legacy-ui.js && node --check src/services/newStoryAd/storageService.js && node --check src/services/newStoryAd/storyAdService.js && node --check scripts/cleanup-new-story-ad-duplicates.js && node scripts/test-new-story-ad-reliability.js && pm2 reload vido --update-env >/dev/null && for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 5; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && echo NEW_STORY_AD_DEDUPE_DEPLOY_OK && exit 0; done; exit 1`);
    console.log(output); sftp.end(); client.end();
  } catch (error) { console.error(error.message || error); client.end(); process.exitCode = 1; }
}).on('error', error => { console.error(error.message || error); process.exitCode = 1; }).connect({ host: process.env.VIDO_DEPLOY_HOST || '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD, readyTimeout: 25000 });
