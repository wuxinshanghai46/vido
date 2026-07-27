const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const repoRoot = path.resolve(__dirname, '..');
const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD || '';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const targetTaskId = process.env.VIDO_REPAIR_TASK_ID || '';
const cacheVersion = '20260728-story-setup-cta-v38';
const runtimeFiles = [
  'public/css/digital-human-wizard.css',
  'public/digital-human.html',
  'public/js/new-story-ad/bootstrap.js',
  'public/js/new-story-ad/bootstrap-media-loader.js',
  'public/js/new-story-ad/scene-assets.js',
  'public/js/new-story-ad/storyboard.js',
  'public/js/new-story-ad/transition-review.js',
  'public/js/new-story-ad/video-review.js',
  'public/js/new-story-ad-legacy-ui.js',
  'src/routes/newStoryAd.js',
  'src/services/newStoryAd/composeService.js',
  'src/services/newStoryAd/continuityService.js',
  'src/services/newStoryAd/finalVideoQaService.js',
  'src/services/newStoryAd/jobService.js',
  'src/services/newStoryAd/keyframeContractService.js',
  'src/services/newStoryAd/keyframeFailureService.js',
  'src/services/newStoryAd/mediaAdapter.js',
  'src/services/newStoryAd/sceneAssetService.js',
  'src/services/newStoryAd/sceneAtlasService.js',
  'src/services/newStoryAd/sceneCheckpointProjectionService.js',
  'src/services/newStoryAd/sceneGenerationCheckpointService.js',
  'src/services/newStoryAd/sceneSpaceContractService.js',
  'src/services/newStoryAd/storyAdService.js',
  'src/services/newStoryAd/storyboardContinuityGateService.js',
  'src/services/newStoryAd/storyboardTableService.js',
  'src/services/newStoryAd/videoFrameQaService.js',
];

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');

const expectedHashes = Object.fromEntries(runtimeFiles.map(file => [
  file,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, file))).digest('hex'),
]));

function quote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function exec(client, command) {
  return new Promise((resolve, reject) => client.exec(command, (error, stream) => {
    if (error) return reject(error);
    let stdout = '';
    let stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => code === 0
      ? resolve(stdout)
      : reject(new Error(stderr || stdout || `remote audit failed (${code})`)));
  }));
}

async function publicHealth() {
  const response = await fetch('https://vido.smsend.cn/api/health', {
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() };
}

(async () => {
  const client = new Client();
  await new Promise((resolve, reject) => {
    client.on('ready', resolve).on('error', reject);
    client.connect({ host, port: 22, username, password, readyTimeout: 25000 });
  });
  try {
    const probe = Buffer.from(`
      const crypto = require('crypto');
      const fs = require('fs');
      const storage = require('./src/services/newStoryAd/storageService');
      const { assertContextConsistent } = require('./src/services/newStoryAd/contextBuilder');
      const sceneAssets = require('./src/services/newStoryAd/sceneAssetService');
      const sceneBinding = require('./src/services/newStoryAd/sceneBindingService');
      const sceneCheckpoint = require('./src/services/newStoryAd/sceneGenerationCheckpointService');
      const sceneViewStrategy = require('./src/services/newStoryAd/sceneViewStrategyService');
      const files = ${JSON.stringify(runtimeFiles)};
      const targetTaskId = ${JSON.stringify(targetTaskId)};
      const tasks = storage.listTasks({ limit: 500 });
      const active = tasks.filter(task => task.active_generation_id || ['queued', 'running'].includes(String(task.status || '')));
      const hashes = Object.fromEntries(files.map(file => [
        file,
        crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      ]));
      let targetCheckpointCompatibility = null;
      if (targetTaskId) {
        const task = storage.getTask(targetTaskId);
        const baseCtx = assertContextConsistent(storage.getOutput(targetTaskId, 'context') || task?.request || {});
        const storedSceneConfig = storage.getOutput(targetTaskId, 'scene_config') || {};
        const targetSpace = (storedSceneConfig.spaces || []).find(space => String(space.space_id || space.id || '').includes('space_home'))
          || (storedSceneConfig.spaces || [])[0];
        const rawBody = { space_id: targetSpace?.space_id || targetSpace?.id || '' };
        const target = sceneBinding.resolveSceneGenerationTarget({
          sceneConfig: storedSceneConfig,
          context: baseCtx,
          body: rawBody,
        });
        const ctx = { ...baseCtx, scene_spec: target.scene_spec };
        const body = {
          ...rawBody,
          scene_id: target.scene_id,
          space_id: target.space_id,
          scene_spec: target.scene_spec,
          ...(target.space ? {
            name: target.space.name,
            description: target.space.description,
            scene_description: target.space.description,
            prompt: target.space.description,
          } : {}),
        };
        const existing = sceneAssets.normalizeSceneAssets(storage.getOutput(targetTaskId, 'scene_assets') || baseCtx.scene_assets || []);
        const previous = existing.find(item => String(item.scene_id) === String(target.scene_id));
        const requested = sceneAssets.sceneRequest(ctx, body);
        const materialReferences = sceneAssets.sceneMaterialReferenceImages(ctx, body);
        const viewAcquisition = sceneViewStrategy.resolveSceneViewStrategy({
          requested: body.view_strategy || body.viewStrategy || 'auto',
          requiredViews: sceneAssets.SCENE_GENERATION_ORDER,
          uploadedViewCount: 0,
          videoAcquisitionEnabled: false,
        });
        const scenePrompt = sceneAssets.buildSceneSheetPrompt({
          ctx,
          sceneConfig: target.isolated_scene_config,
          body,
          outputRole: 'contract',
        });
        const layoutPrompt = sceneAssets.buildLayoutAcquisitionPrompt({ ctx, body });
        const payload = {
          generation_contract_version: sceneAssets.SCENE_GENERATION_CONTRACT_VERSION,
          scene_id: target.scene_id,
          requested,
          scene_prompt: scenePrompt,
          layout_prompt: layoutPrompt,
          repair_view_keys: [],
          repair_feedback: '',
          material_references: materialReferences,
          aspect_ratio: '16:9',
          resolution: '2K',
          image_model: 'gpt-image-2',
          generation_order: sceneAssets.SCENE_GENERATION_ORDER,
          view_strategy: viewAcquisition.selected,
          previous_revision: Number(previous?.scene_revision || 0) || 0,
        };
        const currentFingerprint = sceneCheckpoint.inputFingerprint(payload);
        const legacyText = sceneAssets.legacyScenePromptFingerprintText(scenePrompt, layoutPrompt, requested.negative);
        const legacyFingerprint = sceneCheckpoint.inputFingerprint({
          ...payload,
          scene_prompt: legacyText.scenePrompt,
          layout_prompt: legacyText.layoutPrompt,
        });
        const checkpoint = storage.getOutput(targetTaskId, sceneCheckpoint.outputKind(target.scene_id));
        const checkpointPreviousRevision = Math.max(0, Number(checkpoint?.candidate_revision || 1) - 1);
        const checkpointBaseFingerprint = sceneCheckpoint.inputFingerprint({
          ...payload,
          previous_revision: checkpointPreviousRevision,
        });
        const checkpointBaseLegacyFingerprint = sceneCheckpoint.inputFingerprint({
          ...payload,
          previous_revision: checkpointPreviousRevision,
          scene_prompt: legacyText.scenePrompt,
          layout_prompt: legacyText.layoutPrompt,
        });
        targetCheckpointCompatibility = {
          task_id: targetTaskId,
          scene_id: target.scene_id,
          previous_scene_revision: Number(previous?.scene_revision || 0),
          checkpoint_candidate_revision: Number(checkpoint?.candidate_revision || 0),
          checkpoint_status: checkpoint?.status || '',
          checkpoint_fingerprint: checkpoint?.input_fingerprint || '',
          current_fingerprint: currentFingerprint,
          compatible_legacy_fingerprint: legacyFingerprint,
          checkpoint_base_fingerprint: checkpointBaseFingerprint,
          checkpoint_base_legacy_fingerprint: checkpointBaseLegacyFingerprint,
          matches_current: checkpoint?.input_fingerprint === currentFingerprint,
          matches_compatible_legacy: checkpoint?.input_fingerprint === legacyFingerprint,
          matches_checkpoint_base: checkpoint?.input_fingerprint === checkpointBaseFingerprint,
          matches_checkpoint_base_legacy: checkpoint?.input_fingerprint === checkpointBaseLegacyFingerprint,
          succeeded_view_keys: Object.entries(checkpoint?.views || {})
            .filter(([, view]) => view?.status === 'succeeded')
            .map(([key]) => key),
          failed_view_keys: Object.entries(checkpoint?.views || {})
            .filter(([, view]) => view?.status === 'failed')
            .map(([key]) => key),
          layout_attempts: Number(checkpoint?.views?.layout?.attempts || 0),
          billing_state: checkpoint?.views?.layout?.billing_state || '',
        };
      }
      console.log('AUDIT=' + JSON.stringify({
        hashes,
        task_count_checked: tasks.length,
        active_task_count: active.length,
        active_tasks: active.slice(0, 20).map(task => ({
          id: task.id,
          status: task.status,
          stage: task.stage || task.active_stage || '',
          active_generation_id: task.active_generation_id || '',
        })),
        target_checkpoint_compatibility: targetCheckpointCompatibility,
      }));
    `, 'utf8').toString('base64');
    const syntaxChecks = runtimeFiles
      .filter(file => file.endsWith('.js'))
      .map(file => `node --check ${quote(file)}`);
    const command = [
      `cd ${quote(remoteRoot)}`,
      ...syntaxChecks,
      `node -e "eval(Buffer.from('${probe}','base64').toString('utf8'))"`,
      "pm2 jlist | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='vido');console.log('PM2='+JSON.stringify({status:p?.pm2_env?.status,restarts:p?.pm2_env?.restart_time,uptime_seconds:Math.floor((Date.now()-(p?.pm2_env?.pm_uptime||Date.now()))/1000)}))})\"",
      "printf 'PRIVATE_HEALTH='; curl -fsS -w '|HTTP:%{http_code}\\n' http://127.0.0.1:4600/api/health",
      "printf 'LATEST_BACKUP='; ls -1dt /opt/vido/backups/new-story-ad-subject-scene-recovery-* 2>/dev/null | head -n 1",
      `printf 'CACHE_VERSION='; curl -fsS http://127.0.0.1:4600/js/new-story-ad/bootstrap.js | grep -o ${quote(cacheVersion)} | head -n 1`,
      "printf 'TRANSITION_MODULE='; curl -fsS http://127.0.0.1:4600/js/new-story-ad/transition-review.js | grep -o 'NewStoryAdTransitionReview' | head -n 1",
      "printf 'TRANSITION_DURATION='; curl -fsS http://127.0.0.1:4600/js/new-story-ad/storyboard.js | grep -o 'transition_duration_sec' | head -n 1",
      "printf 'AUDIO_BRIDGE='; grep -o 'j_cut_crossfade' src/services/newStoryAd/composeService.js | head -n 1",
      "printf 'SPLIT_CAMERA_QA='; grep -o 'split_scene_and_camera' src/services/newStoryAd/sceneSpaceContractService.js | head -n 1",
      "printf 'BILLING_GUARD='; grep -o 'SCENE_ASSET_BILLING_UNKNOWN' src/services/newStoryAd/sceneGenerationCheckpointService.js | head -n 1",
      "printf 'NEUTRAL_ORIGINALITY='; grep -o 'Originality requirement' src/services/newStoryAd/mediaAdapter.js | head -n 1",
      "printf 'SINGLE_LAYOUT_REFERENCE='; grep -o \"referenceOrder: atlasMode ? \\['atlas'\\] : \\['master'\\]\" src/services/newStoryAd/sceneAssetService.js | head -n 1",
      "printf 'SCENE_GENERATION_TRACKING='; grep -o 'generation_id: job.generationId' src/routes/newStoryAd.js | head -n 1",
    ].join(' && ');
    const output = await exec(client, command);
    const auditLine = output.split(/\r?\n/).find(line => line.startsWith('AUDIT='));
    const pm2Line = output.split(/\r?\n/).find(line => line.startsWith('PM2='));
    if (!auditLine || !pm2Line) throw new Error(`remote output incomplete: ${output}`);
    const audit = JSON.parse(auditLine.slice('AUDIT='.length));
    const pm2 = JSON.parse(pm2Line.slice('PM2='.length));
    const mismatches = runtimeFiles.filter(file => audit.hashes?.[file] !== expectedHashes[file]);
    if (mismatches.length) throw new Error(`remote hash mismatch: ${mismatches.join(', ')}`);
    if (targetTaskId) {
      const compatibility = audit.target_checkpoint_compatibility || {};
      if (compatibility.checkpoint_status !== 'partial'
        || !(
          compatibility.matches_current === true
          || compatibility.matches_compatible_legacy === true
          || compatibility.matches_checkpoint_base === true
          || compatibility.matches_checkpoint_base_legacy === true
        )
        || compatibility.failed_view_keys?.length !== 1
        || compatibility.failed_view_keys?.[0] !== 'layout') {
        throw new Error(`target checkpoint cannot safely resume under the new prompt policy: ${JSON.stringify(compatibility)}`);
      }
    }
    if (pm2.status !== 'online') throw new Error(`PM2 not online: ${JSON.stringify(pm2)}`);
    const requiredMarkers = [
      /PRIVATE_HEALTH=.*HTTP:200/,
      new RegExp(`CACHE_VERSION=${cacheVersion}`),
      /TRANSITION_MODULE=NewStoryAdTransitionReview/,
      /TRANSITION_DURATION=transition_duration_sec/,
      /AUDIO_BRIDGE=j_cut_crossfade/,
      /SPLIT_CAMERA_QA=split_scene_and_camera/,
      /BILLING_GUARD=SCENE_ASSET_BILLING_UNKNOWN/,
      /NEUTRAL_ORIGINALITY=Originality requirement/,
      /SINGLE_LAYOUT_REFERENCE=referenceOrder: atlasMode \? \['atlas'\] : \['master'\]/,
      /SCENE_GENERATION_TRACKING=generation_id: job.generationId/,
    ];
    if (requiredMarkers.some(pattern => !pattern.test(output))) {
      throw new Error(`production markers missing: ${output}`);
    }
    const publicResult = await publicHealth();
    if (publicResult.status !== 200 || publicResult.body?.status !== 'ok') {
      throw new Error(`public health failed: ${JSON.stringify(publicResult)}`);
    }
    console.log(JSON.stringify({
      status: 'PASS',
      runtime_hashes_matched: runtimeFiles.length,
      remote_node_checks_passed: syntaxChecks.length,
      frontend_cache_version: cacheVersion,
      latest_backup: output.split(/\r?\n/)
        .find(line => line.startsWith('LATEST_BACKUP='))
        ?.slice('LATEST_BACKUP='.length) || '',
      pm2,
      private_health_http: 200,
      public_health: publicResult,
      read_only_task_audit: {
        task_count_checked: audit.task_count_checked,
        active_task_count: audit.active_task_count,
        active_tasks: audit.active_tasks,
        target_checkpoint_compatibility: audit.target_checkpoint_compatibility,
      },
      model_or_media_calls_triggered: 0,
      task_writes: 0,
    }, null, 2));
  } finally {
    client.end();
  }
})().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
