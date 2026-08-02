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
  'package.json',
  'public/js/new-story-ad/person-dossier-ui.js',
  'public/js/new-story-ad/real-person-dossier.js',
  'public/story-ad/app.js',
  'public/story-ad/components/ui.js',
  'public/story-ad/index.html',
  'public/story-ad/store/projectStore.js',
  'public/story-ad/store/referenceReplacementState.js',
  'public/story-ad/views/assetCenterView.js',
  'public/story-ad/views/assetCenterPersonSources.js',
  'public/story-ad/views/briefView.js',
  'public/story-ad/views/finalView.js',
  'public/story-ad/views/plotRoomView.js',
  'public/story-ad/views/personDossierShowcase.js',
  'public/story-ad/views/shotDesignerView.js',
  'public/story-ad/views/storyboardView.js',
  'public/story-ad/views/workflowInlineEditor.js',
  'public/story-ad/views/workflowView.js',
  'public/story-ad/workspace.css',
  'scripts/deploy-2026-08-01-reference-intake.js',
  'scripts/check-new-story-ad-dossier-boundaries.js',
  'scripts/check-story-ad-workspace-v6-boundaries.js',
  'scripts/test-new-story-ad-person-dossier.js',
  'scripts/test-new-story-ad-reference-video-analysis.js',
  'scripts/test-new-story-ad-story-setup-flow.js',
  'scripts/test-new-story-ad-subject-assets.js',
  'scripts/test-story-ad-asset-center-person-provider.js',
  'scripts/test-story-ad-workspace-v6-ui-regressions.js',
  'scripts/test-story-ad-workspace-v6.js',
  'scripts/test-story-ad-workspace-reference-intake.js',
  'src/routes/newStoryAd.js',
  'src/routes/newStoryAd/personDossierApprovalRoute.js',
  'src/services/newStoryAd/assetPlanService.js',
  'src/services/newStoryAd/briefGoalAssistService.js',
  'src/services/newStoryAd/contextBuilder.js',
  'src/services/newStoryAd/deyunaiPersonAssetService.js',
  'src/services/newStoryAd/dossierCompositeService.js',
  'src/services/newStoryAd/modelGateway.js',
  'src/services/newStoryAd/personDossierCompiler.js',
  'src/services/newStoryAd/personDossierService.js',
  'src/services/newStoryAd/personProviderAssetLifecycleService.js',
  'src/services/newStoryAd/productAssetGenerationService.js',
  'src/services/newStoryAd/propAssetService.js',
  'src/services/newStoryAd/referenceEvidenceTextService.js',
  'src/services/newStoryAd/referenceDetachService.js',
  'src/services/newStoryAd/referenceVideoAnalysisService.js',
  'src/services/newStoryAd/revisionService.js',
  'src/services/newStoryAd/sceneBindingService.js',
  'src/services/newStoryAd/storyAdService.js',
  'src/services/newStoryAd/subjectAssetBundleService.js',
  'src/services/newStoryAd/videoAdapter.js',
  'src/services/newStoryAd/workflowTransitionContractService.js',
  'src/services/storyAdWorkspace/projectBundleService.js',
  'src/services/storyAdWorkspace/projectCountProjectionService.js',
  'src/services/storyAdWorkspace/projectTimingProjectionService.js',
  'src/services/storyAdWorkspace/referenceDraftProjectionService.js',
  'src/services/storyAdWorkspace/workflowNavigationService.js',
];

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupDir = `/opt/vido/backups/reference-shot-aware-${stamp}`;
const stagingDir = `/opt/vido/releases/reference-shot-aware-${stamp}`;
const lockDir = '/opt/vido/deploy-locks/reference-shot-aware';
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

function parseLastJson(output) {
  const lines = String(output || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch {}
  }
  throw new Error(`No JSON object found in output: ${lines.slice(-5).join(' | ')}`);
}

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

client.on('ready', async () => {
  let sftp;
  try {
    for (const file of files) {
      if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing deploy file: ${file}`);
    }
    await exec([
      'mkdir -p /opt/vido/deploy-locks /opt/vido/releases /opt/vido/backups',
      `if test -d ${quote(lockDir)} && find ${quote(lockDir)} -maxdepth 0 -mmin +120 | grep -q .; then rm -f ${quote(`${lockDir}/token`)} && rmdir ${quote(lockDir)}; fi`,
      `mkdir ${quote(lockDir)}`,
      `printf %s ${quote(lockToken)} > ${quote(`${lockDir}/token`)}`,
    ].join(' && '));
    lockAcquired = true;

    const activeBefore = parseLastJson(await exec([
      `cd ${quote(remoteRoot)}`,
      'node scripts/run-with-pm2-env.js vido node scripts/check-new-story-ad-active-tasks.js',
    ].join(' && ')));
    if (Number(activeBefore.active_count) !== 0) {
      throw new Error(`Production has ${activeBefore.active_count} active generation task(s)`);
    }
    const healthBefore = parseLastJson(await exec('curl -fsS http://127.0.0.1:4600/api/health'));
    if (healthBefore.status !== 'ok' || healthBefore.database?.status !== 'ok') {
      throw new Error(`Pre-deploy health failed: ${JSON.stringify(healthBefore)}`);
    }

    const fileArgs = files.map(quote).join(' ');
    await exec([
      `mkdir -p ${quote(backupDir)} ${quote(stagingDir)}`,
      `cd ${quote(remoteRoot)}`,
      `for file in ${fileArgs}; do test ! -f "$file" || echo "$file"; done > ${quote(`${backupDir}/existed.txt`)}`,
      `tar -czf ${quote(`${backupDir}/files.tar.gz`)} -T ${quote(`${backupDir}/existed.txt`)}`,
    ].join(' && '));

    const dirs = [...new Set(files.map(file => path.posix.dirname(file)).filter(dir => dir !== '.'))];
    await exec(`mkdir -p ${dirs.map(dir => quote(`${stagingDir}/${dir}`)).join(' ')}`);
    sftp = await new Promise((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)));
    for (const file of files) {
      await new Promise((resolve, reject) => sftp.fastPut(
        path.join(root, file),
        `${stagingDir}/${file}`,
        error => error ? reject(error) : resolve(),
      ));
    }

    const syntaxChecks = files.filter(file => file.endsWith('.js')).map(file => (
      file.startsWith('public/story-ad/')
        ? `node --input-type=module --check < ${quote(`${stagingDir}/${file}`)}`
        : `node --check ${quote(`${stagingDir}/${file}`)}`
    ));
    await exec(syntaxChecks.join(' && '));

    await exec(files.map(file => {
      const target = `${remoteRoot}/${file}`;
      return `mkdir -p ${quote(path.posix.dirname(target))} && cp ${quote(`${stagingDir}/${file}`)} ${quote(`${target}.${lockToken}.tmp`)} && mv -f ${quote(`${target}.${lockToken}.tmp`)} ${quote(target)}`;
    }).join(' && '));
    published = true;

    const testOutput = await exec([
      `cd ${quote(remoteRoot)}`,
      `mkdir -p ${quote(`${backupDir}/test-outputs`)}`,
       `env OUTPUT_DIR=${quote(`${backupDir}/test-outputs`)} DB_ENABLED=0 DB_READ_PRIMARY=0 DB_DUAL_WRITE=0 DB_JSON_FALLBACK=1 node scripts/test-new-story-ad-reference-video-analysis.js`,
      `env OUTPUT_DIR=${quote(`${backupDir}/test-outputs`)} DB_ENABLED=0 DB_READ_PRIMARY=0 DB_DUAL_WRITE=0 DB_JSON_FALLBACK=1 node scripts/test-new-story-ad-story-setup-flow.js`,
      `env OUTPUT_DIR=${quote(`${backupDir}/test-outputs`)} DB_ENABLED=0 DB_READ_PRIMARY=0 DB_DUAL_WRITE=0 DB_JSON_FALLBACK=1 npm run story-ad:dossier:test`,
      `env OUTPUT_DIR=${quote(`${backupDir}/test-outputs`)} DB_ENABLED=0 DB_READ_PRIMARY=0 DB_DUAL_WRITE=0 DB_JSON_FALLBACK=1 npm run story-ad:v6:test`,
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
    if (hashAudit.mismatches.length) throw new Error(`Production hash mismatch: ${hashAudit.mismatches.join(', ')}`);

    const activeAfter = parseLastJson(await exec([
      `cd ${quote(remoteRoot)}`,
      'node scripts/run-with-pm2-env.js vido node scripts/check-new-story-ad-active-tasks.js',
    ].join(' && ')));
    if (Number(activeAfter.active_count) !== 0) throw new Error('Active generation task appeared during deployment');
    const healthAfter = parseLastJson(await exec('curl -fsS http://127.0.0.1:4600/api/health'));
    const summary = String(testOutput || '').split(/\r?\n/)
      .filter(line => /passed|通过|DEPLOY_OK|"checks"/i.test(line)).slice(-20);
    console.log(summary.join('\n'));
    console.log(`RELEASE=${JSON.stringify({
      files: files.length,
      hashAudit,
      activeBefore: activeBefore.active_count,
      activeAfter: activeAfter.active_count,
      health: healthAfter.status,
      database: healthAfter.database?.status,
      backupDir,
    })}`);
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
