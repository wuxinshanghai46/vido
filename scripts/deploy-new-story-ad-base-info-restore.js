const path = require('path');
const { Client } = require('ssh2');

const root = path.resolve(__dirname, '..');
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const host = process.env.VIDO_DEPLOY_HOST;
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const files = [
  'public/digital-human.html',
  'public/js/new-story-ad-legacy-ui.js',
  'public/js/new-story-ad/scene-assets.js',
];
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupDir = `/opt/vido/backups/new-story-ad-base-info-${stamp}`;
const client = new Client();

if (!host || !password) throw new Error('缺少生产服务器部署环境变量');
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const exec = command => new Promise((resolve, reject) => client.exec(command, (error, stream) => {
  if (error) return reject(error);
  let stdout = '';
  let stderr = '';
  stream.on('data', chunk => { stdout += chunk; });
  stream.stderr.on('data', chunk => { stderr += chunk; });
  stream.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || stdout.trim() || `exit ${code}`)));
}));

client.on('ready', async () => {
  let sftp = null;
  try {
    const fileArgs = files.map(quote).join(' ');
    await exec(`mkdir -p ${quote(backupDir)} && cd ${quote(remoteRoot)} && tar -czf ${quote(`${backupDir}/files.tar.gz`)} ${fileArgs}`);
    sftp = await new Promise((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)));
    for (const file of files) {
      await new Promise((resolve, reject) => sftp.fastPut(path.join(root, file), `${remoteRoot}/${file}`, error => error ? reject(error) : resolve()));
    }
    const output = await exec(`cd ${quote(remoteRoot)} && node --check public/js/new-story-ad-legacy-ui.js && node --check public/js/new-story-ad/scene-assets.js && node scripts/test-new-story-ad-reliability.js && node scripts/test-new-story-ad-scene-space.js && node scripts/test-new-story-ad-commercial-readiness.js && pm2 reload vido --update-env >/dev/null && for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 5; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && echo DEPLOY_OK && exit 0; done; exit 1`);
    console.log(output);
    sftp.end();
    client.end();
  } catch (error) {
    if (sftp) sftp.end();
    try { await exec(`cd ${quote(remoteRoot)} && tar -xzf ${quote(`${backupDir}/files.tar.gz`)} -C ${quote(remoteRoot)} && pm2 reload vido --update-env >/dev/null`); }
    catch (rollbackError) { console.error(`回滚失败: ${rollbackError.message || rollbackError}`); }
    console.error(error.message || error);
    client.end();
    process.exitCode = 1;
  }
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({ host, port: 22, username, password, readyTimeout: 25000 });
