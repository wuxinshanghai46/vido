const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST;
const password = process.env.VIDO_DEPLOY_PASSWORD;
const taskId = process.env.VIDO_RETRY_TASK_ID;
if (!host || !password || !taskId) throw new Error('Missing production retry environment variables');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupPath = `/opt/vido/backups/storyboard-retry-${stamp}/${taskId}.json`;
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const client = new Client();

client.on('ready', () => {
  const command = `cd /opt/vido/app && node scripts/retry-new-story-ad-storyboard.js ${quote(taskId)} ${quote(backupPath)}`;
  client.exec(command, (error, stream) => {
    if (error) throw error;
    stream.pipe(process.stdout);
    stream.stderr.pipe(process.stderr);
    stream.on('close', code => {
      client.end();
      process.exitCode = code;
    });
  });
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({ host, port: 22, username: 'root', password, readyTimeout: 25000, keepaliveInterval: 15000 });
