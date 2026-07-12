const { Client } = require('ssh2');
const apply = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const client = new Client();
const dryRun = 'cd /opt/vido/app && node scripts/cleanup-new-story-ad-duplicates.js';
const backupDir = `/root/vido-data-backups/${stamp}-nsa-dedupe`;
const backup = `set -e; mkdir -p ${backupDir}; cp /data/vido/db/vido.sqlite ${backupDir}/vido.sqlite; [ ! -f /data/vido/db/vido.sqlite-wal ] || cp /data/vido/db/vido.sqlite-wal ${backupDir}/vido.sqlite-wal; [ ! -f /data/vido/db/vido.sqlite-shm ] || cp /data/vido/db/vido.sqlite-shm ${backupDir}/vido.sqlite-shm; [ ! -f /opt/vido/app/outputs/new_story_ad_db.json ] || cp /opt/vido/app/outputs/new_story_ad_db.json ${backupDir}/new_story_ad_db.json; test -s ${backupDir}/vido.sqlite`;
const command = apply
  ? `${backup} && cd /opt/vido/app && NSA_DEDUPE_REPORT=${backupDir}/apply-report.json node scripts/cleanup-new-story-ad-duplicates.js --apply && NSA_DEDUPE_REPORT=${backupDir}/postcheck-report.json node scripts/cleanup-new-story-ad-duplicates.js && curl -fsS http://127.0.0.1:4600/api/health >/dev/null && echo DEDUPE_APPLY_OK`
  : dryRun;
client.on('ready', () => client.exec(command, (error, stream) => {
  if (error) throw error;
  stream.on('data', chunk => process.stdout.write(chunk));
  stream.stderr.on('data', chunk => process.stderr.write(chunk));
  stream.on('close', code => { client.end(); process.exitCode = code || 0; });
})).on('error', error => { console.error(error.message || error); process.exitCode = 1; }).connect({ host: process.env.VIDO_DEPLOY_HOST || '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD, readyTimeout: 25000 });
