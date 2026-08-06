'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const root = path.resolve(__dirname, '..');
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const username = process.env.VIDO_DEPLOY_USER || 'root';
const release = require('../config/story-ad-release.json');
const releaseManifest = require('../public/story-ad/release-manifest.json');
const publicReleaseFiles = releaseManifest.files.map(item => item.path);
const extraFiles = [
  'config/story-ad-release.json',
  'package.json',
  'package-lock.json',
  'public/story-ad/release-manifest.json',
  'src/server.js',
  'src/routes/newStoryAd.js',
  'src/routes/newStoryAd/subjectAssetPersistence.js',
  'src/routes/storyAdWorkspace.js',
  'src/repositories/contentRecordRepository.js',
  'src/services/newStoryAd/contextBuilder.js',
  'src/services/newStoryAd/blueprintService.js',
  'src/services/newStoryAd/storyboardTableService.js',
  'src/services/newStoryAd/qualityReviewService.js',
  'src/services/newStoryAd/composeService.js',
  'src/services/newStoryAd/finalVideoQaService.js',
  'src/services/newStoryAd/ttsAdapter.js',
  'src/services/newStoryAd/jobService.js',
  'src/services/newStoryAd/mediaAdapter.js',
  'src/services/newStoryAd/modelGateway.js',
  'src/services/newStoryAd/providerAdapterRegistry.js',
  'src/services/newStoryAd/assetPlanService.js',
  'src/services/newStoryAd/assetGenerationCheckpointService.js',
  'src/services/newStoryAd/personConsistencyQaService.js',
  'src/services/newStoryAd/personDossierCompiler.js',
  'src/services/newStoryAd/personDossierService.js',
  'src/services/newStoryAd/dossierCompositeService.js',
  'src/services/newStoryAd/productAssetResolverService.js',
  'src/services/newStoryAd/productConsistencyQaService.js',
  'src/services/newStoryAd/productIdentityContractService.js',
  'src/services/newStoryAd/productionLimitsService.js',
  'src/services/newStoryAd/keyframeContractService.js',
  'src/services/newStoryAd/referenceEntityContinuityService.js',
  'src/services/newStoryAd/referenceEvidenceStrategyService.js',
  'src/services/newStoryAd/referenceSemanticRecoveryService.js',
  'src/services/newStoryAd/referenceSemanticContractPromptService.js',
  'src/services/newStoryAd/referenceSelectionService.js',
  'src/services/newStoryAd/referenceAnalysisTaskSyncService.js',
  'src/services/newStoryAd/referenceDetachService.js',
  'src/services/newStoryAd/referenceUnderstandingEditService.js',
  'src/services/newStoryAd/referenceUnderstandingService.js',
  'src/services/newStoryAd/referenceVideoAnalysisService.js',
  'src/services/newStoryAd/revisionService.js',
  'src/services/newStoryAd/sceneAssetService.js',
  'src/services/newStoryAd/sceneBindingService.js',
  'src/services/newStoryAd/sceneGenerationPolicyService.js',
  'src/services/newStoryAd/panoramaProjectionService.js',
  'src/services/newStoryAd/panoramaProjectionWorker.js',
  'src/services/newStoryAd/scenePanoramaService.js',
  'src/services/newStoryAd/shotReferencePackService.js',
  'src/services/newStoryAd/storyAdService.js',
  'src/services/newStoryAd/storageService.js',
  'src/services/newStoryAd/subjectAssetBundleService.js',
  'src/services/newStoryAd/videoAdapter.js',
  'src/services/newStoryAd/videoFrameQaService.js',
  'src/services/newStoryAd/videoLineageService.js',
  'src/services/newStoryAd/visualAssetProgressService.js',
  'src/services/newStoryAd/visualAssetOrchestrationService.js',
  'src/services/newStoryAd/visualAssetBillingAuthorizationService.js',
  'src/services/storyAdReleaseIntegrityService.js',
  'src/services/modelCapabilityService.js',
  'src/services/pipelineModelService.js',
  'src/services/knowledgeBaseSeed.js',
  'src/services/seeds/character_asset_card.js',
  'src/services/storyAdWorkspace/directorSceneService.js',
  'src/services/storyAdWorkspace/authoritativeReferenceProjectionService.js',
  'src/services/storyAdWorkspace/graphProjectionService.js',
  'src/services/storyAdWorkspace/projectBundleService.js',
  'src/services/storyAdWorkspace/projectTimingProjectionService.js',
  'src/services/storyAdWorkspace/sceneWorldAssetProjectionService.js',
  'src/services/storyAdWorkspace/sceneWorldService.js',
  'src/services/storyAdWorkspace/referenceUnderstandingConfirmationService.js',
  'src/services/storyAdWorkspace/referenceUnderstandingProjectionService.js',
  'scripts/build-story-ad-release.js',
  'scripts/check-new-story-ad-dossier-boundaries.js',
  'scripts/check-story-ad-workspace-v6-boundaries.js',
  'scripts/test-new-story-ad-keyframe-parallel.js',
  'scripts/test-new-story-ad-image2-realism.js',
  'scripts/test-new-story-ad-duration-contract.js',
  'scripts/test-new-story-ad-longform-compose-contract.js',
  'scripts/test-new-story-ad-multi-space-cast-recovery.js',
  'scripts/test-new-story-ad-person-dossier.js',
  'scripts/test-new-story-ad-panorama.js',
  'scripts/test-pipeline-capability-audit.js',
  'scripts/test-new-story-ad-reference-understanding-v6.js',
  'scripts/test-new-story-ad-reference-entity-continuity.js',
  'scripts/test-new-story-ad-reference-semantic-recovery.js',
  'scripts/test-new-story-ad-structured-output.js',
  'scripts/test-new-story-ad-product-proof-contract.js',
  'scripts/test-new-story-ad-reference-video-analysis.js',
  'scripts/test-new-story-ad-spatial-generation-order.js',
  'scripts/test-reference-evidence-strategy.js',
  'scripts/test-new-story-ad-reference-video-link.js',
  'scripts/test-new-story-ad-storage-batch-delete.js',
  'scripts/test-new-story-ad-reliability.js',
  'scripts/test-new-story-ad-subject-assets.js',
  'scripts/test-new-story-ad-visual-asset-failure-recovery.js',
  'scripts/test-new-story-ad-video-frame-qa.js',
  'scripts/test-reference-analysis-task-sync.js',
  'scripts/test-reference-understanding-edit.js',
  'scripts/test-reference-understanding-edit-persistence.js',
  'scripts/test-story-ad-director-scene-v1.js',
  'scripts/test-story-ad-reference-understanding-confirmation.js',
  'scripts/test-story-ad-reference-confirm-continue.js',
  'scripts/test-story-ad-reference-understanding-ui.js',
  'scripts/test-story-ad-release-integrity.js',
  'scripts/test-story-ad-scene-world-v1.js',
  'scripts/test-story-ad-visual-assets-sync-v21.js',
  'scripts/test-story-ad-workflow-director-nodes.js',
  'scripts/test-story-ad-workspace-v6-ui-regressions.js',
  'scripts/test-story-ad-workspace-reference-intake.js',
  'scripts/deploy-story-ad-release.js',
];
const files = [...new Set([...publicReleaseFiles, ...extraFiles])].sort();

for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing release file: ${file}`);
}

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const token = `${stamp}-${process.pid}`;
const releaseSlug = `story-ad-${String(release.build_id || 'release').replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
const lockDir = `/opt/vido/deploy-locks/${releaseSlug}`;
const stagingDir = `/opt/vido/releases/${releaseSlug}-${token}`;
const backupDir = `/opt/vido/backups/${releaseSlug}-${stamp}`;
const client = new Client();
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
let lockAcquired = false;
let published = false;

const localHashes = Object.fromEntries(files.map(file => [
  file,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
]));
const hashSpec = Buffer.from(JSON.stringify({ files, localHashes }), 'utf8').toString('base64');

function exec(command) {
  return new Promise((resolve, reject) => client.exec(command, (error, stream) => {
    if (error) return reject(error);
    let stdout = '';
    let stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => {
      if (code === 0) return resolve(stdout.trim());
      const detail = `${stdout}\n${stderr}`.trim();
      return reject(new Error(detail.slice(-12000) || `Remote exit ${code}`));
    });
  }));
}

function parseLastJson(output) {
  const lines = String(output || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch {}
  }
  throw new Error(`No JSON in remote output: ${lines.slice(-5).join(' | ')}`);
}

async function auditRemoteHashes() {
  return parseLastJson(await exec([
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
}

async function releaseLock() {
  if (!lockAcquired) return;
  await exec(`test ! -f ${quote(`${lockDir}/token`)} || test "$(cat ${quote(`${lockDir}/token`)})" != ${quote(token)} || rm -f ${quote(`${lockDir}/token`)} && rmdir ${quote(lockDir)} 2>/dev/null || true`);
  lockAcquired = false;
}

async function rollback() {
  if (!published) return;
  const fileArgs = files.map(quote).join(' ');
  await exec([
    `cd ${quote(remoteRoot)}`,
    `test ! -f ${quote(`${backupDir}/files.tar.gz`)} || tar -xzf ${quote(`${backupDir}/files.tar.gz`)} -C ${quote(remoteRoot)}`,
    `for file in ${fileArgs}; do grep -Fxq "$file" ${quote(`${backupDir}/existed.txt`)} || rm -f -- "$file"; done`,
    'pm2 reload vido --update-env >/dev/null',
  ].join(' && '));
}

client.on('ready', async () => {
  let sftp;
  try {
    await exec([
      'mkdir -p /opt/vido/deploy-locks /opt/vido/releases /opt/vido/backups',
      `if test -d ${quote(lockDir)} && find ${quote(lockDir)} -maxdepth 0 -mmin +120 | grep -q .; then rm -f ${quote(`${lockDir}/token`)} && rmdir ${quote(lockDir)}; fi`,
      `mkdir ${quote(lockDir)}`,
      `printf %s ${quote(token)} > ${quote(`${lockDir}/token`)}`,
    ].join(' && '));
    lockAcquired = true;

    await exec([
      `cd ${quote(remoteRoot)}`,
      `node scripts/run-with-pm2-env.js vido node -e ${quote("if(process.env.STORY_AD_VERIFY_RELEASE==='0'||process.env.STORY_AD_ALLOW_LEGACY_CLIENT==='1')throw new Error('unsafe story-ad release gate environment')")}`,
    ].join(' && '));

    const activeBefore = parseLastJson(await exec([
      `cd ${quote(remoteRoot)}`,
      'node scripts/run-with-pm2-env.js vido node scripts/check-new-story-ad-active-tasks.js',
    ].join(' && ')));
    if (Number(activeBefore.active_count) !== 0) throw new Error(`Production has ${activeBefore.active_count} active generation tasks`);

    const healthBefore = parseLastJson(await exec('curl -fsS http://127.0.0.1:4600/api/health'));
    if (healthBefore.status !== 'ok' || healthBefore.database?.status !== 'ok') {
      throw new Error(`Production preflight unhealthy: ${JSON.stringify(healthBefore)}`);
    }
    const quickCheckBefore = await exec('echo UFJBR01BIHF1aWNrX2NoZWNrOw== | base64 -d | sqlite3 /data/vido/db/vido.sqlite');
    if (quickCheckBefore.trim() !== 'ok') throw new Error(`SQLite quick_check failed: ${quickCheckBefore}`);

    const fileArgs = files.map(quote).join(' ');
    await exec([
      `mkdir -p ${quote(backupDir)} ${quote(stagingDir)}`,
      `cd ${quote(remoteRoot)}`,
      `for file in ${fileArgs}; do test ! -f "$file" || echo "$file"; done > ${quote(`${backupDir}/existed.txt`)}`,
      `tar -czf ${quote(`${backupDir}/files.tar.gz`)} -T ${quote(`${backupDir}/existed.txt`)}`,
      `cp -a /data/vido/db/vido.sqlite ${quote(`${backupDir}/vido.sqlite.before-deploy`)}`,
    ].join(' && '));

    const directories = [...new Set(files.map(file => path.posix.dirname(file)).filter(dir => dir !== '.'))];
    await exec(`mkdir -p ${directories.map(dir => quote(`${stagingDir}/${dir}`)).join(' ')}`);
    sftp = await new Promise((resolve, reject) => client.sftp((error, channel) => error ? reject(error) : resolve(channel)));
    for (const file of files) {
      await new Promise((resolve, reject) => sftp.fastPut(
        path.join(root, file),
        `${stagingDir}/${file}`,
        error => error ? reject(error) : resolve(),
      ));
    }

    const jsChecks = files.filter(file => file.endsWith('.js')).map(file => (
      file.startsWith('public/story-ad/')
        ? `node --input-type=module --check < ${quote(`${stagingDir}/${file}`)}`
        : `node --check ${quote(`${stagingDir}/${file}`)}`
    )).join(' && ');
    await exec(jsChecks);

    const publishCommands = files.map(file => {
      const target = `${remoteRoot}/${file}`;
      return `mkdir -p ${quote(path.posix.dirname(target))} && cp ${quote(`${stagingDir}/${file}`)} ${quote(`${target}.${token}.tmp`)} && mv -f ${quote(`${target}.${token}.tmp`)} ${quote(target)}`;
    });
    await exec(publishCommands.join(' && '));
    published = true;

    const publishedHashAudit = await auditRemoteHashes();
    if (publishedHashAudit.mismatches.length) {
      throw new Error(`Production pre-test hash mismatch: ${publishedHashAudit.mismatches.join(', ')}`);
    }

    const testOutput = await exec([
      `cd ${quote(remoteRoot)}`,
      `mkdir -p ${quote(`${backupDir}/test-outputs`)}`,
      `env OUTPUT_DIR=${quote(`${backupDir}/test-outputs`)} DB_ENABLED=0 DB_READ_PRIMARY=0 DB_DUAL_WRITE=0 DB_JSON_FALLBACK=1 npm run platform:upgrade:test`,
    ].join(' && '));

    const testedHashAudit = await auditRemoteHashes();
    if (testedHashAudit.mismatches.length) {
      throw new Error(`Production post-test hash mismatch: ${testedHashAudit.mismatches.join(', ')}`);
    }

    await exec([
      'pm2 reload vido --update-env >/dev/null',
      'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 5; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && curl -fsS https://vido.smsend.cn/api/health >/dev/null && exit 0; done; exit 1',
    ].join(' && '));

    const hashAudit = await auditRemoteHashes();
    if (hashAudit.mismatches.length) throw new Error(`Production post-reload hash mismatch: ${hashAudit.mismatches.join(', ')}`);

    const activeAfter = parseLastJson(await exec([
      `cd ${quote(remoteRoot)}`,
      'node scripts/run-with-pm2-env.js vido node scripts/check-new-story-ad-active-tasks.js',
    ].join(' && ')));
    if (Number(activeAfter.active_count) !== 0) throw new Error('Active generation task appeared during deploy validation');
    const healthAfter = parseLastJson(await exec('curl -fsS http://127.0.0.1:4600/api/health'));
    const publicHealth = parseLastJson(await exec('curl -fsS https://vido.smsend.cn/api/health'));
    const productionRelease = parseLastJson(await exec('curl -fsS http://127.0.0.1:4600/api/story-ad/version'));
    const quickCheckAfter = await exec('echo UFJBR01BIHF1aWNrX2NoZWNrOw== | base64 -d | sqlite3 /data/vido/db/vido.sqlite');
    if (productionRelease.build_id !== release.build_id || productionRelease.contract_version !== release.contract_version) {
      throw new Error(`Production release mismatch: ${JSON.stringify(productionRelease)}`);
    }
    if (healthAfter.status !== 'ok' || publicHealth.status !== 'ok' || healthAfter.database?.status !== 'ok' || quickCheckAfter.trim() !== 'ok') {
      throw new Error('Production post-deploy health or database check failed');
    }

    console.log(String(testOutput).split(/\r?\n/).filter(line => /passed|通过|DEPLOY_OK|real_model_calls/i.test(line)).slice(-40).join('\n'));
    console.log(`RELEASE=${JSON.stringify({
      build_id: productionRelease.build_id,
      contract_version: productionRelease.contract_version,
      files: files.length,
      hashAudit,
      activeBefore: activeBefore.active_count,
      activeAfter: activeAfter.active_count,
      health: healthAfter.status,
      publicHealth: publicHealth.status,
      database: healthAfter.database?.status,
      sqliteQuickCheck: quickCheckAfter.trim(),
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
}).connect(connectionOptions({ host, port: 22, username }));
