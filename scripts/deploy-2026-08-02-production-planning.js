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
const files = [
  'public/js/new-story-ad/person-dossier-ui.js',
  'public/js/new-story-ad/real-person-dossier.js',
  'public/story-ad/index.html',
  'public/story-ad/api.js',
  'public/story-ad/app.js',
  'public/story-ad/components/ui.js',
  'public/story-ad/store/projectStore.js',
  'public/story-ad/store/referenceReplacementState.js',
  'public/story-ad/views/assetCenterView.js',
  'public/story-ad/views/assetCenterPersonSources.js',
  'public/story-ad/views/assetCenterPlanningDetails.js',
  'public/story-ad/views/personDossierShowcase.js',
  'public/story-ad/views/briefView.js',
  'public/story-ad/views/plotRoomView.js',
  'public/story-ad/views/storyboardView.js',
  'public/story-ad/views/shotDesignerView.js',
  'public/story-ad/views/finalView.js',
  'public/story-ad/views/workflowInlineEditor.js',
  'public/story-ad/views/workflowView.js',
  'public/story-ad/workspace.css',
  'package.json',
  'src/routes/newStoryAd.js',
  'src/routes/newStoryAd/personDossierApprovalRoute.js',
  'src/routes/storyAdWorkspace.js',
  'src/services/pipelineModelService.js',
  'src/services/newStoryAd/blueprintService.js',
  'src/services/newStoryAd/assetPlanService.js',
  'src/services/newStoryAd/blueprintLifecycleService.js',
  'src/services/newStoryAd/benchmarkStrategyService.js',
  'src/services/newStoryAd/briefGoalAssistService.js',
  'src/services/newStoryAd/contextBuilder.js',
  'src/services/newStoryAd/deyunaiPersonAssetService.js',
  'src/services/newStoryAd/dossierCompositeService.js',
  'src/services/newStoryAd/generationSpecCompletionService.js',
  'src/services/newStoryAd/modelGateway.js',
  'src/services/newStoryAd/personDossierCompiler.js',
  'src/services/newStoryAd/personDossierService.js',
  'src/services/newStoryAd/personProviderAssetLifecycleService.js',
  'src/services/newStoryAd/productAssetGenerationService.js',
  'src/services/newStoryAd/productAssetResolverService.js',
  'src/services/newStoryAd/propAssetService.js',
  'src/services/newStoryAd/qualityReviewService.js',
  'src/services/newStoryAd/referenceDetachService.js',
  'src/services/newStoryAd/referenceEvidenceTextService.js',
  'src/services/newStoryAd/referenceVideoAnalysisService.js',
  'src/services/newStoryAd/revisionService.js',
  'src/services/newStoryAd/sceneAssetService.js',
  'src/services/newStoryAd/sceneBindingService.js',
  'src/services/newStoryAd/shotDesignService.js',
  'src/services/newStoryAd/storyAdService.js',
  'src/services/newStoryAd/storyboardTableService.js',
  'src/services/newStoryAd/subjectAssetBundleService.js',
  'src/services/newStoryAd/videoAdapter.js',
  'src/services/newStoryAd/workflowTransitionContractService.js',
  'src/services/storyAdWorkspace/storyboardSketchService.js',
  'src/services/storyAdWorkspace/storyboardSketchGateService.js',
  'src/services/storyAdWorkspace/dossierItemProjectionService.js',
  'src/services/storyAdWorkspace/projectBundleService.js',
  'src/services/storyAdWorkspace/projectCountProjectionService.js',
  'src/services/storyAdWorkspace/projectTimingProjectionService.js',
  'src/services/storyAdWorkspace/productionSemanticLocalizationService.js',
  'src/services/storyAdWorkspace/referenceDraftProjectionService.js',
  'src/services/storyAdWorkspace/sceneCameraProjectionService.js',
  'src/services/storyAdWorkspace/workflowNavigationService.js',
  'scripts/repair-story-ad-wearable-details.js',
  'scripts/repair-story-ad-storyboard-contracts.js',
  'scripts/repair-reference-video-semantic-contract-v2.js',
  'scripts/run-production-storyboard-contract-repair.js',
  'scripts/run-production-wardrobe-repair.js',
  'scripts/deploy-2026-08-01-reference-intake.js',
  'scripts/deploy-2026-08-02-production-planning.js',
  'scripts/inspect-deyunai-prod-routing.js',
  'scripts/inspect-prod-story-ad-task-state.js',
  'scripts/inspect-prod-story-ad-asset-ux.js',
  'scripts/check-story-ad-workspace-v6-boundaries.js',
  'scripts/check-new-story-ad-dossier-boundaries.js',
  'scripts/test-new-story-ad-asset-contracts.js',
  'scripts/test-new-story-ad-person-dossier.js',
  'scripts/test-new-story-ad-blueprint-lifecycle.js',
  'scripts/test-new-story-ad-generation-spec-completion.js',
  'scripts/test-new-story-ad-multi-space-cast-recovery.js',
  'scripts/test-new-story-ad-reference-video-analysis.js',
  'scripts/test-new-story-ad-scene-atlas-v7.js',
  'scripts/test-new-story-ad-scene-repair.js',
  'scripts/test-new-story-ad-story-setup-flow.js',
  'scripts/test-new-story-ad-storyboard-guards.js',
  'scripts/test-new-story-ad-subject-assets.js',
  'scripts/test-new-story-ad-spatial-generation-order.js',
  'scripts/test-story-ad-asset-center-person-provider.js',
  'scripts/test-story-ad-detail-sketch-batch.js',
  'scripts/test-story-ad-production-planning-upgrade.js',
  'scripts/test-pipeline-capability-audit.js',
  'scripts/test-story-ad-workspace-backend-projection.js',
  'scripts/test-story-ad-workspace-reference-intake.js',
  'scripts/test-story-ad-workspace-v6-ui-regressions.js',
  'scripts/test-story-ad-workspace-v6.js',
];

files.forEach(file => {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing release file: ${file}`);
});

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupDir = `/opt/vido/backups/production-planning-${stamp}`;
const client = new Client();
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const localHashes = Object.fromEntries(files.map(file => [
  file,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
]));

function exec(command) {
  return new Promise((resolve, reject) => client.exec(command, (error, stream) => {
    if (error) return reject(error);
    let stdout = '';
    let stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(stderr.trim() || stdout.trim() || `Remote exit ${code}`)));
  }));
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
  let sftp;
  try {
    const activeText = await exec(`cd ${quote(remoteRoot)} && node scripts/run-with-pm2-env.js vido node scripts/check-new-story-ad-active-tasks.js`);
    console.log(activeText);
    const activeJson = activeText.split(/\r?\n/).reverse().find(line => line.trim().startsWith('{'));
    if (activeJson) {
      const active = JSON.parse(activeJson);
      if (Number(active.active_count || active.active_tasks?.length || 0) > 0) throw new Error('Production has active generation tasks; deploy stopped.');
    }

    const fileArgs = files.map(quote).join(' ');
    await exec([
      `mkdir -p ${quote(backupDir)}`,
      `cd ${quote(remoteRoot)}`,
      `for file in ${fileArgs}; do test ! -f "$file" || echo "$file"; done > ${quote(`${backupDir}/existed.txt`)}`,
      `tar -czf ${quote(`${backupDir}/files.tar.gz`)} -T ${quote(`${backupDir}/existed.txt`)}`,
      `mkdir -p ${[...new Set(files.map(file => path.posix.dirname(file)).filter(dir => dir !== '.'))].map(quote).join(' ')}`,
    ].join(' && '));

    sftp = await new Promise((resolve, reject) => client.sftp((error, channel) => error ? reject(error) : resolve(channel)));
    for (const file of files) {
      await new Promise((resolve, reject) => sftp.fastPut(path.join(root, file), `${remoteRoot}/${file}`, error => error ? reject(error) : resolve()));
      console.log(`uploaded ${file}`);
    }

    const jsChecks = files.filter(file => file.endsWith('.js')).map(file => (
      file.startsWith('public/story-ad/')
        ? `node --input-type=module --check < ${quote(file)}`
        : `node --check ${quote(file)}`
    )).join(' && ');
    const validation = await exec([
      `cd ${quote(remoteRoot)}`,
      jsChecks,
      'node scripts/test-new-story-ad-person-dossier.js',
      'node scripts/test-new-story-ad-blueprint-lifecycle.js',
      'node scripts/test-new-story-ad-generation-spec-completion.js',
      'node scripts/test-new-story-ad-storyboard-guards.js',
      'node scripts/test-new-story-ad-subject-assets.js',
      'node scripts/test-story-ad-detail-sketch-batch.js',
      'node scripts/test-story-ad-production-planning-upgrade.js',
      'node scripts/test-story-ad-asset-center-person-provider.js',
      'node scripts/test-story-ad-workspace-interactions.js',
      'node scripts/test-story-ad-workspace-backend-projection.js',
      'node scripts/test-story-ad-workspace-v6-ui-regressions.js',
      'node scripts/check-story-ad-workspace-v6-boundaries.js',
      'pm2 reload vido --update-env >/dev/null',
      'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 5; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && curl -fsS https://vido.smsend.cn/api/health >/dev/null && echo DEPLOY_OK && exit 0; done; exit 1',
    ].join(' && '));
    console.log(validation);

    const encoded = Buffer.from(JSON.stringify({ files, localHashes }), 'utf8').toString('base64');
    const hashText = await exec(`cd ${quote(remoteRoot)} && node -e ${quote(`
      const crypto = require('crypto');
      const fs = require('fs');
      const spec = JSON.parse(Buffer.from('${encoded}', 'base64').toString('utf8'));
      const mismatches = spec.files.filter(file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== spec.localHashes[file]);
      console.log(JSON.stringify({ checked: spec.files.length, mismatches }));
    `)}`);
    const hashAudit = JSON.parse(hashText.split(/\r?\n/).filter(Boolean).pop());
    if (hashAudit.mismatches.length) throw new Error(`Remote hash mismatch: ${hashAudit.mismatches.join(', ')}`);
    console.log(`HASH_AUDIT=${JSON.stringify(hashAudit)}`);
    console.log(`BACKUP=${backupDir}`);
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
}).connect(connectionOptions({ host, port: 22, username }));
