#!/usr/bin/env node
const path = require('path');
const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || process.env.VIDO_SYNC_HOST || '43.98.167.151';
const user = process.env.VIDO_DEPLOY_USER || process.env.VIDO_SYNC_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD || process.env.VIDO_SYNC_PASSWORD;
const remoteRoot = process.env.VIDO_DEPLOY_REMOTE || process.env.VIDO_SYNC_REMOTE || '/opt/vido/app';
const port = Number(process.env.VIDO_DEPLOY_PORT || process.env.VIDO_SYNC_PORT || 22);
const pm2App = process.env.VIDO_DEPLOY_PM2_APP || 'vido';

const files = [
  'public/digital-human.html',
  'public/css/digital-human-wizard.css',
  'public/js/digital-human.js',
  'src/routes/digitalHuman.js',
  'src/services/pipelineModelService.js',
  'src/services/storyService.js',
];

if (!password) {
  console.error('missing VIDO_DEPLOY_PASSWORD or VIDO_SYNC_PASSWORD');
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = `${remoteRoot}/.deploy-backup/${stamp}-luxury-ad-flow`;

function q(value) {
  return JSON.stringify(String(value));
}

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', reject)
      .connect({ host, port, username: user, password, readyTimeout: 30000 });
  });
}

function exec(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('close', code => resolve({ code, stdout, stderr }));
      stream.on('data', data => { stdout += data.toString(); });
      stream.stderr.on('data', data => { stderr += data.toString(); });
    });
  });
}

function openSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
  });
}

function upload(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, err => (err ? reject(err) : resolve()));
  });
}

async function mustExec(conn, command, label) {
  const result = await exec(conn, command);
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
  return result;
}

async function main() {
  const conn = await connect();
  console.log(`[deploy] connected ${user}@${host}:${remoteRoot}`);

  await mustExec(conn, `mkdir -p ${q(backupRoot)}`, 'create backup dir');
  for (const rel of files) {
    const remote = `${remoteRoot}/${rel}`;
    const backup = `${backupRoot}/${rel}`;
    const command = [
      `mkdir -p ${q(path.posix.dirname(backup))}`,
      `mkdir -p ${q(path.posix.dirname(remote))}`,
      `if [ -f ${q(remote)} ]; then cp ${q(remote)} ${q(backup)}; fi`,
    ].join(' && ');
    await mustExec(conn, command, `backup ${rel}`);
  }
  console.log(`[deploy] backed up ${files.length} files to ${backupRoot}`);

  const sftp = await openSftp(conn);
  for (const rel of files) {
    const local = path.join(repoRoot, rel);
    const remote = `${remoteRoot}/${rel}`;
    await upload(sftp, local, remote);
    console.log(`[deploy] uploaded ${rel}`);
  }

  const checkFiles = files
    .filter(rel => rel.endsWith('.js'))
    .map(rel => `node --check ${q(rel)}`)
    .join(' && ');
  await mustExec(conn, `cd ${q(remoteRoot)} && ${checkFiles}`, 'remote node --check');
  console.log('[deploy] remote node --check passed');

  const schemaCheck = `node -e "const p=require('./src/services/pipelineModelService');const ids=Object.values(p.listSchema()).flat().map(s=>s.id).filter(id=>id&&id.startsWith('luxury_ad.'));const need=['luxury_ad.scene_config','luxury_ad.script','luxury_ad.keyframe','luxury_ad.video','luxury_ad.tts','luxury_ad.post'];const miss=need.filter(id=>!ids.includes(id));if(miss.length){console.error('missing '+miss.join(','));process.exit(2)}console.log(ids.join(','))"`;
  const schema = await mustExec(conn, `cd ${q(remoteRoot)} && ${schemaCheck}`, 'remote pipeline schema check');
  console.log(`[deploy] luxury stages ${schema.stdout.trim()}`);

  await mustExec(conn, `pm2 reload ${q(pm2App)} --update-env`, 'pm2 reload');
  console.log(`[deploy] pm2 reload ${pm2App} done`);

  const health = await mustExec(conn, 'sleep 3; curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health', 'health check');
  if (health.stdout.trim() !== '200') {
    throw new Error(`health check returned ${health.stdout.trim()}`);
  }
  console.log('[deploy] health 200');

  const pm2 = await mustExec(
    conn,
    `pm2 jlist | node -e "let d='';const name=process.argv[1];process.stdin.on('data',c=>d+=c).on('end',()=>{const app=JSON.parse(d).find(x=>x.name===name);console.log(app?('status='+app.pm2_env.status+' restarts='+app.pm2_env.restart_time):'NOT_FOUND')})" ${q(pm2App)}`,
    'pm2 status'
  );
  console.log(`[deploy] ${pm2.stdout.trim()}`);
  conn.end();
}

main().catch(err => {
  console.error('[deploy] fatal:', err.message);
  process.exit(1);
});
