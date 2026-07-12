const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST;
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const taskId = String(process.env.VIDO_TASK_ID || '').trim();
if (!host || !password || !taskId) throw new Error('Missing connection variables or VIDO_TASK_ID');
if (!/^[a-zA-Z0-9-]+$/.test(taskId)) throw new Error('Invalid task id');

const client = new Client();
client.on('ready', () => {
  const backupDir = `/opt/vido/backups/keyframe-status-repair-${Date.now()}`;
  const command = `cd '${remoteRoot}' && mkdir -p '${backupDir}' && REPAIR_BACKUP_DIR='${backupDir}' node scripts/repair-new-story-ad-keyframe-status.js '${taskId}'`;
  client.exec(command, (error, stream) => {
    if (error) throw error;
    let output = '';
    let stderr = '';
    stream.on('data', chunk => { output += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => {
      if (output.trim()) console.log(output.trim());
      if (stderr.trim()) console.error(stderr.trim());
      client.end();
      if (code !== 0) process.exitCode = 1;
    });
  });
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({ host, port: 22, username, password, readyTimeout: 25000 });
