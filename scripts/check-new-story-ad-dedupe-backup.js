const { Client } = require('ssh2');
const client = new Client();
const command = `set -e
latest=$(ls -dt /root/vido-data-backups/*-nsa-dedupe 2>/dev/null | head -1)
echo BACKUP_DIR:$latest
ls -lh "$latest" || true
node -e "const fs=require('fs');const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,'utf8'));console.log(JSON.stringify(Object.fromEntries(Object.keys(d).map(k=>[k,Array.isArray(d[k])?d[k].length:0]))))" "$latest/new_story_ad_db.json"
cd /opt/vido/app
sha256sum public/js/new-story-ad-legacy-ui.js public/digital-human.html src/services/newStoryAd/storageService.js scripts/cleanup-new-story-ad-duplicates.js
node -e "const s=require('./src/services/newStoryAd/storageService');const d=s.readDb();console.log(JSON.stringify(Object.fromEntries(Object.keys(d).map(k=>[k,d[k].length]))))"
find /root/vido-data-backups -maxdepth 2 -type f -name 'vido.sqlite' -size +10k -printf '%TY-%Tm-%Td %TH:%TM %s %p\\n' 2>/dev/null | tail -10`;
client.on('ready', () => client.exec(command, (error, stream) => {
  if (error) throw error;
  stream.on('data', chunk => process.stdout.write(chunk));
  stream.stderr.on('data', chunk => process.stderr.write(chunk));
  stream.on('close', code => { client.end(); process.exitCode = code || 0; });
})).on('error', error => { console.error(error.message || error); process.exitCode = 1; }).connect({ host: process.env.VIDO_DEPLOY_HOST || '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD, readyTimeout: 25000 });
