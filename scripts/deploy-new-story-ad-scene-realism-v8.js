const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD || '';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const repoRoot = path.resolve(__dirname, '..');
const files = [
  'public/digital-human.html',
  'public/css/digital-human-wizard.css',
  'public/js/new-story-ad/bootstrap.js',
  'public/js/new-story-ad/scene-assets.js',
  'src/services/newStoryAd/sceneAssetService.js',
];

function quote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function connect() {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on('ready', () => resolve(client)).on('error', reject);
    client.connect({ host, port: 22, username, password, readyTimeout: 25000 });
  });
}

function exec(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = '';
      let stderr = '';
      stream.on('data', chunk => { stdout += chunk; });
      stream.stderr.on('data', chunk => { stderr += chunk; });
      stream.on('close', code => code === 0
        ? resolve(stdout)
        : reject(new Error(stderr || stdout || `remote command failed (${code})`)));
    });
  });
}

function openSftp(client) {
  return new Promise((resolve, reject) => {
    client.sftp((error, channel) => error ? reject(error) : resolve(channel));
  });
}

function upload(channel, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    channel.fastPut(localPath, remotePath, error => error ? reject(error) : resolve());
  });
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

(async () => {
  if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
  files.forEach(file => {
    if (!fs.existsSync(path.join(repoRoot, file))) {
      throw new Error(`local deployment file missing: ${file}`);
    }
  });

  const client = await connect();
  let channel;
  try {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const backupRoot = `${remoteRoot}/backups/new-story-ad-camera-interaction-v10-${stamp}`;
    const backupCommands = files.map(file => {
      const target = quote(file);
      return `[ ! -f ${target} ] || cp --parents ${target} ${quote(backupRoot)}`;
    });
    await exec(client, [
      `cd ${quote(remoteRoot)}`,
      `mkdir -p ${quote(backupRoot)}`,
      ...backupCommands,
    ].join(' && '));

    channel = await openSftp(client);
    for (const file of files) {
      const localPath = path.join(repoRoot, file);
      const remotePath = path.posix.join(remoteRoot, file.replace(/\\/g, '/'));
      await exec(client, `mkdir -p ${quote(path.posix.dirname(remotePath))}`);
      await upload(channel, localPath, remotePath);
      const remoteHash = (await exec(client, `sha256sum ${quote(remotePath)} | awk '{print $1}'`)).trim();
      if (remoteHash !== sha256(localPath)) throw new Error(`hash mismatch: ${file}`);
      console.log(`uploaded ${file}`);
    }

    const javascriptFiles = files.filter(file => file.endsWith('.js'));
    await exec(client, [
      `cd ${quote(remoteRoot)}`,
      ...javascriptFiles.map(file => `node --check ${quote(file)}`),
    ].join(' && '));
    console.log(`remote_node_check=${javascriptFiles.length}`);
    console.log((await exec(client, 'pm2 reload vido --update-env 2>&1')).trim());
    let health = '';
    let lastHealthError;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        health = await exec(client, [
          "curl -fsS http://127.0.0.1:4600/api/health >/dev/null",
          "printf 'private_health=200\\n'",
          "pm2 jlist | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='vido');console.log('pm2_status='+(p&&p.pm2_env.status));if(!p||p.pm2_env.status!=='online')process.exit(1)})\"",
        ].join(' && '));
        break;
      } catch (error) {
        lastHealthError = error;
        if (attempt < 20) await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    if (!health) throw lastHealthError || new Error('health check did not complete');
    console.log(health.trim());
    console.log(`backup=${backupRoot}`);
  } finally {
    if (channel) channel.end();
    client.end();
  }
})().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
