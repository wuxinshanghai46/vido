const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const root = path.resolve(__dirname, '..');
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 22);
const username = process.env.VIDO_DEPLOY_USER || 'root';

function walk(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.posix.join(relativeDirectory.replace(/\\/g, '/'), entry.name);
    return entry.isDirectory() ? walk(relativePath) : [relativePath];
  });
}

const files = [...new Set([
  'package.json',
  'public/index.html',
  'public/css/dashboard-workbench.css',
  'public/css/style.css',
  'public/js/app.js',
  'public/js/dashboard-workbench.js',
  ...walk('public/story-ad'),
  'scripts/check-story-ad-workspace-v6-boundaries.js',
  'scripts/test-platform-module-navigation.js',
  'scripts/test-story-ad-workspace-v6.js',
  'scripts/test-story-ad-workspace-interactions.js',
  'scripts/test-new-story-ad-reference-person-ui.js',
  'scripts/test-new-story-ad-task-resume.js',
  'scripts/deploy-2026-07-31-story-ad-v6.js',
  'src/routes/dashboard.js',
  'src/routes/storyAdWorkspace.js',
  'src/server.js',
  'src/services/newStoryAd/contextBuilder.js',
  'src/services/newStoryAd/storyAdService.js',
  ...walk('src/services/storyAdWorkspace'),
])].filter(file => fs.existsSync(path.join(root, file)));

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupDir = `/opt/vido/backups/story-ad-v6-${stamp}`;
const stagingDir = `/opt/vido/releases/story-ad-v6-${stamp}`;
const lockDir = '/opt/vido/deploy-locks/story-ad-v6';
const lockToken = `${stamp}-${crypto.randomBytes(8).toString('hex')}`;
const client = new Client();
let lockAcquired = false;
let published = false;

const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const exec = command => new Promise((resolve, reject) => client.exec(command, (error, stream) => {
  if (error) return reject(error);
  let stdout = '';
  let stderr = '';
  stream.on('data', chunk => { stdout += chunk; });
  stream.stderr.on('data', chunk => { stderr += chunk; });
  stream.on('close', code => code === 0
    ? resolve(stdout.trim())
    : reject(new Error(stderr.trim() || stdout.trim() || `exit ${code}`)));
}));

async function releaseLock() {
  if (!lockAcquired) return;
  await exec([
    `test ! -f ${quote(`${lockDir}/token`)} || test "$(cat ${quote(`${lockDir}/token`)})" != ${quote(lockToken)} || rm -f ${quote(`${lockDir}/token`)}`,
    `test ! -d ${quote(lockDir)} || rmdir ${quote(lockDir)} 2>/dev/null || true`,
  ].join(' && '));
  lockAcquired = false;
}

async function rollback() {
  if (!published) return;
  await exec([
    `cd ${quote(remoteRoot)}`,
    `test ! -f ${quote(`${backupDir}/files.tar.gz`)} || tar -xzf ${quote(`${backupDir}/files.tar.gz`)} -C ${quote(remoteRoot)}`,
    `for file in ${files.map(quote).join(' ')}; do grep -Fxq "$file" ${quote(`${backupDir}/existed.txt`)} || rm -f -- "$file"; done`,
    'pm2 reload vido --update-env >/dev/null',
  ].join(' && '));
}

function parseLastJson(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch {}
  }
  throw new Error(`输出中没有 JSON：${lines.slice(-5).join(' | ')}`);
}

client.on('ready', async () => {
  let sftp;
  try {
    await exec([
      'mkdir -p /opt/vido/deploy-locks /opt/vido/releases /opt/vido/backups',
      `if test -d ${quote(lockDir)} && find ${quote(lockDir)} -maxdepth 0 -mmin +120 | grep -q .; then rm -f ${quote(`${lockDir}/token`)} && rmdir ${quote(lockDir)}; fi`,
      `mkdir ${quote(lockDir)}`,
      `printf %s ${quote(lockToken)} > ${quote(`${lockDir}/token`)}`,
    ].join(' && '));
    lockAcquired = true;

    const preflightText = await exec([
      `cd ${quote(remoteRoot)}`,
      'node scripts/run-with-pm2-env.js vido node scripts/check-new-story-ad-active-tasks.js',
    ].join(' && '));
    const activeBefore = parseLastJson(preflightText);
    if (Number(activeBefore.active_count) !== 0) {
      throw new Error(`生产存在 ${activeBefore.active_count} 个活动生成任务，停止部署`);
    }

    const healthBefore = parseLastJson(await exec('curl -fsS http://127.0.0.1:4600/api/health'));
    if (healthBefore.status !== 'ok' || !healthBefore.database?.enabled || healthBefore.database?.status !== 'ok') {
      throw new Error(`生产健康或数据库状态异常：${JSON.stringify(healthBefore)}`);
    }

    const fileArgs = files.map(quote).join(' ');
    await exec([
      `mkdir -p ${quote(backupDir)} ${quote(stagingDir)}`,
      `cd ${quote(remoteRoot)}`,
      `for file in ${fileArgs}; do test ! -f "$file" || echo "$file"; done > ${quote(`${backupDir}/existed.txt`)}`,
      `tar -czf ${quote(`${backupDir}/files.tar.gz`)} -T ${quote(`${backupDir}/existed.txt`)}`,
      `cp -a /data/vido/db/vido.sqlite ${quote(`${backupDir}/vido.sqlite.before-deploy`)}`,
    ].join(' && '));

    const directories = [...new Set(files.map(file => path.posix.dirname(file)).filter(dir => dir && dir !== '.'))];
    await exec(`mkdir -p ${directories.map(dir => quote(`${stagingDir}/${dir}`)).join(' ')}`);
    sftp = await new Promise((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)));
    for (const file of files) {
      await new Promise((resolve, reject) => sftp.fastPut(
        path.join(root, file),
        `${stagingDir}/${file}`,
        error => error ? reject(error) : resolve(),
      ));
    }

    const stagingChecks = files.filter(file => file.endsWith('.js'))
      .map(file => file.startsWith('public/story-ad/')
        ? `node --input-type=module --check < ${quote(`${stagingDir}/${file}`)}`
        : `node --check ${quote(`${stagingDir}/${file}`)}`)
      .join(' && ');
    await exec(stagingChecks);

    const publishCommands = files.map(file => {
      const target = `${remoteRoot}/${file}`;
      return `mkdir -p ${quote(path.posix.dirname(target))} && cp ${quote(`${stagingDir}/${file}`)} ${quote(`${target}.${lockToken}.tmp`)} && mv -f ${quote(`${target}.${lockToken}.tmp`)} ${quote(target)}`;
    });
    await exec(publishCommands.join(' && '));
    published = true;

    const testOutput = await exec([
      `cd ${quote(remoteRoot)}`,
      `mkdir -p ${quote(`${backupDir}/test-outputs`)}`,
      `env OUTPUT_DIR=${quote(`${backupDir}/test-outputs`)} DB_ENABLED=0 DB_READ_PRIMARY=0 DB_DUAL_WRITE=0 DB_JSON_FALLBACK=1 npm run platform:upgrade:test`,
      'pm2 reload vido --update-env >/dev/null',
      'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 5; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && curl -fsS https://vido.smsend.cn/api/health >/dev/null && echo DEPLOY_OK && exit 0; done; exit 1',
    ].join(' && '));

    const localHashes = Object.fromEntries(files.map(file => [
      file,
      crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
    ]));
    const hashSpec = Buffer.from(JSON.stringify({ files, localHashes }), 'utf8').toString('base64');
    const hashAudit = parseLastJson(await exec([
      `cd ${quote(remoteRoot)}`,
      `node -e ${quote(`
        const crypto = require('crypto');
        const fs = require('fs');
        const spec = JSON.parse(Buffer.from('${hashSpec}', 'base64').toString('utf8'));
        const mismatches = spec.files.filter(file => !fs.existsSync(file)
          || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== spec.localHashes[file]);
        console.log(JSON.stringify({ checked: spec.files.length, mismatches }));
      `)}`,
    ].join(' && ')));
    if (hashAudit.mismatches.length) throw new Error(`生产哈希不一致：${hashAudit.mismatches.join(', ')}`);

    const activeAfter = parseLastJson(await exec([
      `cd ${quote(remoteRoot)}`,
      'node scripts/run-with-pm2-env.js vido node scripts/check-new-story-ad-active-tasks.js',
    ].join(' && ')));
    if (Number(activeAfter.active_count) !== 0) throw new Error('部署验证期间出现活动生成任务');

    const healthAfter = parseLastJson(await exec('curl -fsS http://127.0.0.1:4600/api/health'));
    const summary = String(testOutput || '').split(/\r?\n/).filter(line => /passed|通过|DEPLOY_OK|real_model_calls/i.test(line)).slice(-30);
    console.log(summary.join('\n'));
    console.log(`RELEASE=${JSON.stringify({ files: files.length, hashAudit, activeBefore: activeBefore.active_count, activeAfter: activeAfter.active_count, health: healthAfter.status, database: healthAfter.database?.status, backupDir })}`);
    await exec(`rm -rf -- ${quote(stagingDir)}`);
    await releaseLock();
    sftp.end();
    client.end();
  } catch (error) {
    if (sftp) sftp.end();
    try {
      await rollback();
      if (published) console.error('DEPLOY_FAILED_ROLLED_BACK');
    } catch (rollbackError) {
      console.error(`ROLLBACK_FAILED: ${rollbackError.message || rollbackError}`);
    }
    try { await releaseLock(); } catch {}
    console.error(error.message || error);
    client.end();
    process.exitCode = 1;
  }
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect(connectionOptions({ host, port, username }));
