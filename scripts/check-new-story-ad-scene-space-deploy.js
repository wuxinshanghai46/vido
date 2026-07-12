const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('ssh2');
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
const repo = path.resolve(__dirname, '..');
const expected = Object.fromEntries(files.map(file => [
  file,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex'),
]));
const client = new Client();
client.on('ready', () => {
  const command = 'cd /opt/vido/app && sha256sum ' + files.map(file => "'" + file + "'").join(' ')
    + " && curl -fsS http://127.0.0.1:4600/api/health >/dev/null && echo HEALTH=200"
    + " && pm2 jlist | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='vido');console.log('PM2='+(p&&p.pm2_env.status))})\"";
  client.exec(command, (error, stream) => {
    if (error) throw error;
    let output = '';
    let stderr = '';
    stream.on('data', chunk => { output += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => {
      const lines = output.split(/\r?\n/).filter(Boolean);
      const actual = {};
      lines.forEach(line => {
        const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
        if (match) actual[match[2]] = match[1];
      });
      const mismatches = files.filter(file => actual[file] !== expected[file]);
      console.log(JSON.stringify({
        success: code === 0 && !mismatches.length,
        mismatches,
        health: lines.includes('HEALTH=200') ? 200 : 0,
        pm2: lines.find(line => line.startsWith('PM2=')) || '',
        stderr: stderr.trim().slice(0, 500),
      }, null, 2));
      client.end();
      if (code !== 0 || mismatches.length) process.exitCode = 1;
    });
  });
}).on('error', error => {
  console.error(error.message);
  process.exitCode = 1;
}).connect({
  host: process.env.VIDO_DEPLOY_HOST || '43.98.167.151',
  port: 22,
  username: 'root',
  password: process.env.VIDO_DEPLOY_PASSWORD,
  readyTimeout: 25000,
});
