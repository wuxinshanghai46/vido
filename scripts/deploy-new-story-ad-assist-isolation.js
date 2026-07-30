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
const files = [
  'public/digital-human.html',
  'public/js/new-story-ad/bootstrap.js',
  'public/js/new-story-ad/auto-save-confirmation.js',
  'public/js/new-story-ad-legacy-ui.js',
  'public/js/new-story-ad/director-workspace.js',
  'public/js/new-story-ad/reference-video-analysis.js',
  'public/js/new-story-ad/person-age-authority.js',
  'public/js/new-story-ad/scene-assets.js',
  'public/js/new-story-ad/state-sync.js',
  'public/js/new-story-ad/subject-assets-ui.js',
  'public/js/new-story-ad/subject-profile-assist.js',
  'public/js/new-story-ad/subject-profile-authority.js',
  'scripts/audit-new-story-ad-visible-content.js',
  'scripts/audit-new-story-ad-transition-recovery-deploy.js',
  'scripts/deploy-new-story-ad-assist-isolation.js',
  'scripts/repair-new-story-ad-assist-content.js',
  'scripts/test-new-story-ad-director-workspace.js',
  'scripts/test-new-story-ad-person-assist-completeness.js',
  'scripts/test-new-story-ad-compose-gate-autosave.js',
  'scripts/test-new-story-ad-keyframe-submission.js',
  'scripts/test-new-story-ad-reference-person-ui.js',
  'scripts/test-new-story-ad-reference-video-analysis.js',
  'scripts/test-new-story-ad-scene-lock-ui-binding.js',
  'scripts/test-new-story-ad-shot-assist.js',
  'scripts/test-new-story-ad-storyboard-ui.js',
  'scripts/test-new-story-ad-subject-assets.js',
  'scripts/test-new-story-ad-user-readiness.js',
  'scripts/test-pipeline-capability-audit.js',
  'src/services/newStoryAd/assetPlanService.js',
  'src/services/newStoryAd/assistScenePlanService.js',
  'src/services/newStoryAd/assistSubjectProfileService.js',
  'src/services/newStoryAd/contextBuilder.js',
  'src/services/newStoryAd/modelGateway.js',
  'src/services/newStoryAd/referenceEvidenceTextService.js',
  'src/services/newStoryAd/referenceVideoAnalysisService.js',
  'src/services/newStoryAd/sceneAssistCompletenessService.js',
  'src/services/newStoryAd/storyAdService.js',
  'src/services/newStoryAd/subjectProfileTextService.js',
  'src/services/pipelineModelService.js',
];
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupDir = `/opt/vido/backups/new-story-ad-assist-isolation-${stamp}`;
const lockDir = '/opt/vido/deploy-locks/new-story-ad-assist-isolation';
const lockToken = `${stamp}-${crypto.randomBytes(8).toString('hex')}`;
const client = new Client();
let lockAcquired = false;

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
    `test -d ${quote(lockDir)} && rmdir ${quote(lockDir)} 2>/dev/null || true`,
  ].join(' && '));
  lockAcquired = false;
}

async function rollback() {
  await exec([
    `cd ${quote(remoteRoot)}`,
    `test ! -f ${quote(`${backupDir}/files.tar.gz`)} || tar -xzf ${quote(`${backupDir}/files.tar.gz`)} -C ${quote(remoteRoot)}`,
    `for file in ${files.map(quote).join(' ')}; do grep -Fxq "$file" ${quote(`${backupDir}/existed.txt`)} || rm -f -- "$file"; done`,
    'pm2 reload vido --update-env >/dev/null',
  ].join(' && '));
}

client.on('ready', async () => {
  let sftp = null;
  try {
    await exec([
      'mkdir -p /opt/vido/deploy-locks',
      `if test -d ${quote(lockDir)} && find ${quote(lockDir)} -maxdepth 0 -mmin +120 | grep -q .; then rm -f ${quote(`${lockDir}/token`)} && rmdir ${quote(lockDir)}; fi`,
      `mkdir ${quote(lockDir)}`,
      `printf %s ${quote(lockToken)} > ${quote(`${lockDir}/token`)}`,
    ].join(' && '));
    lockAcquired = true;

    const preflightText = await exec([
      `cd ${quote(remoteRoot)}`,
      `node -e ${quote(`
        const { execFileSync } = require('child_process');
        const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }) || '[]');
        const processInfo = processes.find(item => item && item.name === 'vido');
        if (!processInfo) throw new Error('PM2 vido process not found');
        const scalarEnv = source => Object.fromEntries(Object.entries(source || {})
          .filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
            && ['string', 'number', 'boolean'].includes(typeof value))
          .map(([key, value]) => [key, String(value)]));
        Object.assign(process.env, scalarEnv(processInfo.pm2_env && processInfo.pm2_env.env));
        Object.assign(process.env, scalarEnv(processInfo.pm2_env));
        const storage = require('./src/services/newStoryAd/storageService');
        const active = storage.listTasks({ limit: 1000 })
          .filter(task => task.active_generation_id || task.active_stage)
          .map(task => ({ id: task.id, stage: task.active_stage || task.stage || '' }));
        console.log(JSON.stringify({
          active,
          db_enabled: process.env.DB_ENABLED === '1' || process.env.DB_ENABLED === 'true',
          db_read_primary: process.env.DB_READ_PRIMARY === '1' || process.env.DB_READ_PRIMARY === 'true',
          pm2_status: processInfo.pm2_env && processInfo.pm2_env.status,
        }));
      `)}`,
    ].join(' && '));
    const preflight = JSON.parse(preflightText.split(/\r?\n/).filter(Boolean).pop());
    console.log(`PREFLIGHT=${JSON.stringify(preflight)}`);
    if (preflight.active.length) throw new Error(`生产存在活动任务，停止部署：${preflight.active.map(item => item.id).join(', ')}`);
    if (!preflight.db_enabled || !preflight.db_read_primary) throw new Error('生产 SQLite 主读配置不符合预期，停止部署');

    await exec([
      `mkdir -p ${quote(backupDir)}`,
      `cd ${quote(remoteRoot)}`,
      `for file in ${files.map(quote).join(' ')}; do test ! -f "$file" || echo "$file"; done > ${quote(`${backupDir}/existed.txt`)}`,
      `tar -czf ${quote(`${backupDir}/files.tar.gz`)} -T ${quote(`${backupDir}/existed.txt`)}`,
      `cp -a /data/vido/db/vido.sqlite ${quote(`${backupDir}/vido.sqlite.before-deploy`)}`,
      `mkdir -p ${[...new Set(files.map(file => path.posix.dirname(file)))].map(quote).join(' ')}`,
    ].join(' && '));

    sftp = await new Promise((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)));
    for (const file of files) {
      await new Promise((resolve, reject) => sftp.fastPut(
        path.join(root, file),
        `${remoteRoot}/${file}`,
        error => error ? reject(error) : resolve(),
      ));
    }

    const syntaxChecks = files.filter(file => file.endsWith('.js'))
      .map(file => `node --check ${quote(file)}`)
      .join(' && ');
    const isolatedOutput = `${backupDir}/test-outputs`;
    const output = await exec([
      `cd ${quote(remoteRoot)}`,
      syntaxChecks,
      `mkdir -p ${quote(isolatedOutput)}`,
      `env OUTPUT_DIR=${quote(isolatedOutput)} DB_ENABLED=0 DB_READ_PRIMARY=0 DB_DUAL_WRITE=0 DB_JSON_FALLBACK=1 npm run story-ad:v3:test`,
      'pm2 reload vido --update-env >/dev/null',
      'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 5; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && curl -fsS https://vido.smsend.cn/api/health >/dev/null && echo DEPLOY_OK && exit 0; done; exit 1',
    ].join(' && '));

    const localHashes = Object.fromEntries(files.map(file => [
      file,
      crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
    ]));
    const spec = Buffer.from(JSON.stringify({ files, localHashes }), 'utf8').toString('base64');
    const hashText = await exec([
      `cd ${quote(remoteRoot)}`,
      `node -e ${quote(`
        const crypto = require('crypto');
        const fs = require('fs');
        const spec = JSON.parse(Buffer.from('${spec}', 'base64').toString('utf8'));
        const mismatches = spec.files.filter(file => (
          crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== spec.localHashes[file]
        ));
        console.log(JSON.stringify({ checked: spec.files.length, mismatches }));
      `)}`,
    ].join(' && '));
    const hashAudit = JSON.parse(hashText.split(/\r?\n/).filter(Boolean).pop());
    if (hashAudit.mismatches.length) throw new Error(`生产文件哈希不一致：${hashAudit.mismatches.join(', ')}`);
    console.log(`${output}\nHASH_AUDIT=${JSON.stringify(hashAudit)}\nBACKUP=${backupDir}`);
    await releaseLock();
    sftp.end();
    client.end();
  } catch (error) {
    if (sftp) sftp.end();
    try {
      await rollback();
      console.error('DEPLOY_FAILED_ROLLED_BACK');
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
