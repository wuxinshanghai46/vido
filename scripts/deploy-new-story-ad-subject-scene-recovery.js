const path = require('path');
const { Client } = require('ssh2');

const root = path.resolve(__dirname, '..');
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const files = [
  'package.json',
  'public/css/digital-human-wizard.css',
  'public/digital-human.html',
  'public/js/new-story-ad-legacy-ui.js',
  'public/js/new-story-ad/bootstrap.js',
  'public/js/new-story-ad/bootstrap-media-loader.js',
  'public/js/new-story-ad/scene-assets.js',
  'public/js/new-story-ad/state-sync.js',
  'public/js/new-story-ad/storyboard.js',
  'public/js/new-story-ad/transition-review.js',
  'public/js/new-story-ad/video-review.js',
  'public/js/new-story-ad/verification-language.js',
  'public/js/new-story-ad/subject-profile-assist.js',
  'public/js/new-story-ad/subject-assets-ui.js',
  'public/js/new-story-ad/task-persistence.js',
  'src/routes/newStoryAd.js',
  'src/services/newStoryAd/assistScenePlanService.js',
  'src/services/newStoryAd/assistSubjectProfileService.js',
  'src/services/newStoryAd/blueprintQualityService.js',
  'src/services/newStoryAd/contextBuilder.js',
  'src/services/newStoryAd/composeService.js',
  'src/services/newStoryAd/continuityService.js',
  'src/services/newStoryAd/finalVideoQaService.js',
  'src/services/newStoryAd/jobService.js',
  'src/services/newStoryAd/keyframeContractService.js',
  'src/services/newStoryAd/keyframeFailureService.js',
  'src/services/newStoryAd/mediaAdapter.js',
  'src/services/newStoryAd/personAssetLifecycleService.js',
  'src/services/newStoryAd/personIdentityContractService.js',
  'src/services/newStoryAd/sceneAssetService.js',
  'src/services/newStoryAd/sceneAtlasService.js',
  'src/services/newStoryAd/sceneBindingService.js',
  'src/services/newStoryAd/sceneCheckpointProjectionService.js',
  'src/services/newStoryAd/sceneGenerationCheckpointService.js',
  'src/services/newStoryAd/sceneSpaceContractService.js',
  'src/services/newStoryAd/sceneViewStrategyService.js',
  'src/services/newStoryAd/storyboardContinuityGateService.js',
  'src/services/newStoryAd/storyboardTableService.js',
  'src/services/newStoryAd/storyAdService.js',
  'src/services/newStoryAd/subjectAssetBundleService.js',
  'src/services/newStoryAd/subjectContinuityPolicyService.js',
  'src/services/newStoryAd/subjectProfileTextService.js',
  'src/services/newStoryAd/taskProgressSaveService.js',
  'src/services/newStoryAd/visualRealismPolicyService.js',
  'src/services/newStoryAd/visualVerificationService.js',
  'src/services/newStoryAd/videoFrameQaService.js',
  'scripts/test-new-story-ad-image2-realism.js',
  'scripts/test-new-story-ad-blueprint-quality.js',
  'scripts/test-new-story-ad-human-pet-contract.js',
  'scripts/test-new-story-ad-compose-gate-autosave.js',
  'scripts/test-new-story-ad-compose-transitions.js',
  'scripts/test-new-story-ad-keyframe-parallel.js',
  'scripts/test-new-story-ad-keyframe-submission.js',
  'scripts/test-new-story-ad-multi-space-cast-recovery.js',
  'scripts/test-new-story-ad-person-assist-completeness.js',
  'scripts/test-new-story-ad-reliability.js',
  'scripts/test-new-story-ad-scene-lock-ui-binding.js',
  'scripts/test-new-story-ad-direct-scene-generation.js',
  'scripts/test-new-story-ad-scene-atlas-v7.js',
  'scripts/test-new-story-ad-scene-repair.js',
  'scripts/test-new-story-ad-shot-assist.js',
  'scripts/test-new-story-ad-spatial-generation-order.js',
  'scripts/test-new-story-ad-spatial-coverage-contract.js',
  'scripts/test-new-story-ad-storyboard-continuity-gate.js',
  'scripts/test-new-story-ad-storyboard-ui.js',
  'scripts/test-new-story-ad-subject-assets.js',
  'scripts/test-new-story-ad-subject-gallery-scene-plan.js',
  'scripts/test-new-story-ad-verification-lifecycle.js',
  'scripts/test-new-story-ad-video-frame-qa.js',
];
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupDir = `/opt/vido/backups/new-story-ad-subject-scene-recovery-${stamp}`;
const client = new Client();

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
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
    const fileArgs = files.map(quote).join(' ');
    await exec([
      `mkdir -p ${quote(backupDir)}`,
      `cd ${quote(remoteRoot)}`,
      `for file in ${fileArgs}; do test ! -f "$file" || echo "$file"; done > ${quote(`${backupDir}/existed.txt`)}`,
      `tar -czf ${quote(`${backupDir}/files.tar.gz`)} -T ${quote(`${backupDir}/existed.txt`)}`,
      `cp -a /data/vido/db/vido.sqlite ${quote(`${backupDir}/vido.sqlite.before-deploy`)}`,
    ].join(' && '));
    sftp = await new Promise((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)));
    for (const file of files) {
      await new Promise((resolve, reject) => sftp.fastPut(
        path.join(root, file),
        `${remoteRoot}/${file}`,
        error => error ? reject(error) : resolve(),
      ));
    }
    const checks = files.filter(file => file.endsWith('.js'))
      .map(file => `node --check ${quote(file)}`)
      .join(' && ');
    const output = await exec([
      `cd ${quote(remoteRoot)}`,
      checks,
      'node scripts/test-new-story-ad-subject-gallery-scene-plan.js',
      'node scripts/test-new-story-ad-person-assist-completeness.js',
      'node scripts/test-new-story-ad-image2-realism.js',
      'node scripts/test-new-story-ad-multi-space-cast-recovery.js',
      'node scripts/test-new-story-ad-subject-assets.js',
      'node scripts/test-new-story-ad-spatial-generation-order.js',
      'npm run story-ad:v3:test',
      'pm2 reload vido --update-env >/dev/null',
      'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 5; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && echo DEPLOY_OK && exit 0; done; exit 1',
    ].join(' && '));
    const outputLines = String(output || '').split(/\r?\n/).filter(Boolean);
    const summaryLines = outputLines.filter(line => (
      /PASS|passed|通过|DEPLOY_OK|没有提交视频模型|tests? passed/i.test(line)
    )).slice(-40);
    console.log([
      ...summaryLines,
      `REMOTE_OUTPUT_LINES=${outputLines.length}`,
      `BACKUP=${backupDir}`,
    ].join('\n'));
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
    console.error(error.message || error);
    client.end();
    process.exitCode = 1;
  }
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({ host, port: 22, username, password, readyTimeout: 25000 });
