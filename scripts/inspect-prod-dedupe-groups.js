const { Client } = require('ssh2');
const client = new Client();
const command = `cd /opt/vido/app && node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('outputs/new-story-ad-dedupe-report.json','utf8'));console.log(JSON.stringify({total_tasks:r.total_tasks,duplicate_groups:r.duplicate_groups,records_to_remove:r.records_to_remove,groups:r.groups},null,2))"`;
client.on('ready', () => client.exec(command, (error, stream) => {
  if (error) throw error;
  stream.on('data', chunk => process.stdout.write(chunk));
  stream.stderr.on('data', chunk => process.stderr.write(chunk));
  stream.on('close', code => { client.end(); process.exitCode = code || 0; });
})).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({ host: process.env.VIDO_DEPLOY_HOST || '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD, readyTimeout: 25000 });
