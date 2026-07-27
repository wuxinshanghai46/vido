#!/usr/bin/env node

const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const dbPath = process.env.VIDO_DB_PATH || '/data/vido/db/vido.sqlite';
const taskId = String(process.env.VIDO_REPAIR_TASK_ID || '').trim();
const expectedRevision = Number(process.env.VIDO_EXPECTED_CONTENT_REVISION || 0);
const expectedModelCallsText = String(process.env.VIDO_EXPECTED_MODEL_CALLS || '').trim();
const expectedModelCalls = expectedModelCallsText ? Number(expectedModelCallsText) : null;
const expectedStatus = String(process.env.VIDO_EXPECTED_CURRENT_STATUS || 'working').trim();
const expectedStage = String(process.env.VIDO_EXPECTED_CURRENT_STAGE || 'draft').trim();
const expectedSceneIds = String(process.env.VIDO_EXPECTED_SCENE_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const apply = process.env.VIDO_REPAIR_APPLY === '1';
const client = new Client();

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
if (!taskId) throw new Error('VIDO_REPAIR_TASK_ID is required');
if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
  throw new Error('VIDO_EXPECTED_CONTENT_REVISION must be a positive integer');
}
if (apply && (!Number.isInteger(expectedModelCalls) || expectedModelCalls < 0)) {
  throw new Error('VIDO_EXPECTED_MODEL_CALLS must be set to the dry-run count before apply');
}
if (expectedModelCalls !== null && (!Number.isInteger(expectedModelCalls) || expectedModelCalls < 0)) {
  throw new Error('VIDO_EXPECTED_MODEL_CALLS must be a non-negative integer');
}
if (expectedSceneIds.length < 1) throw new Error('VIDO_EXPECTED_SCENE_IDS is required');

const remoteScript = `
process.env.DB_ENABLED = 'true';
process.env.DB_PATH = ${JSON.stringify(dbPath)};
const storage = require('./src/services/newStoryAd/storageService');
const records = require('./src/repositories/contentRecordRepository');
const sceneBinding = require('./src/services/newStoryAd/sceneBindingService');
const service = require('./src/services/newStoryAd/storyAdService');

const taskId = ${JSON.stringify(taskId)};
const shouldApply = ${JSON.stringify(apply)};
const expectedRevision = ${JSON.stringify(expectedRevision)};
const expectedModelCalls = ${JSON.stringify(expectedModelCalls)};
const expectedStatus = ${JSON.stringify(expectedStatus)};
const expectedStage = ${JSON.stringify(expectedStage)};
const expectedSceneIds = ${JSON.stringify(expectedSceneIds)};
const stableId = value => String(value?.scene_id || value?.space_id || value?.id || '').trim();
const planIds = plan => (Array.isArray(plan?.spaces) ? plan.spaces : [])
  .map(space => String(space?.id || space?.space_id || space?.scene_id || '').trim());
const assetIds = assets => (Array.isArray(assets) ? assets : []).map(stableId);
const sameIds = (actual, expected) => actual.length === expected.length
  && expected.every((id, index) => actual[index] === id);
const sameIdSet = (actual, expected) => actual.length === expected.length
  && expected.every(id => actual.includes(id));
const artifacts = records.list('new_story_ad_artifacts', { project_id: taskId });
const calls = () => records.list('new_story_ad_model_calls', { project_id: taskId }).length;
const activeRuns = records.list('new_story_ad_generation_runs', { project_id: taskId })
  .filter(run => ['queued', 'running'].includes(String(run.status || '').toLowerCase()));
const latestMatching = (kind, predicate) => artifacts
  .filter(row => row.kind === kind && predicate(row.payload))
  .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))[0] || null;

const task = storage.getTask(taskId);
if (!task) throw new Error('TASK_NOT_FOUND');
const manifest = storage.getManifest(taskId);
const context = storage.getOutput(taskId, 'context') || task.request || {};
const currentConfig = storage.getOutput(taskId, 'scene_config');
const currentAssets = storage.getOutput(taskId, 'scene_assets');
const beforeCalls = calls();
if (Number(task.content_revision || 0) !== expectedRevision) throw new Error('CONTENT_REVISION_PRECONDITION_FAILED:' + task.content_revision);
if (String(task.status || '') !== expectedStatus || String(task.stage || '') !== expectedStage) {
  throw new Error('TASK_STATE_PRECONDITION_FAILED:' + task.status + '/' + task.stage);
}
if (task.active_generation_id || activeRuns.length) throw new Error('ACTIVE_GENERATION_PRECONDITION_FAILED');
if (currentConfig || currentAssets) throw new Error('CURRENT_SCENE_AUTHORITY_ALREADY_PRESENT');
if (!Object.prototype.hasOwnProperty.call(manifest.invalidated || {}, 'scene_config')
  || !Object.prototype.hasOwnProperty.call(manifest.invalidated || {}, 'scene_assets')) {
  throw new Error('SCENE_INVALIDATION_EVIDENCE_MISSING');
}
if (expectedModelCalls !== null && beforeCalls !== expectedModelCalls) {
  throw new Error('MODEL_CALL_COUNT_PRECONDITION_FAILED:' + beforeCalls);
}

const planArtifact = latestMatching('scene_config', plan => sameIds(planIds(plan), expectedSceneIds));
const assetsArtifact = latestMatching('scene_assets', assets => (
  sameIdSet(assetIds(assets), expectedSceneIds)
  && assets.every(asset => sceneBinding.completeSpaceLock(asset))
));
if (!planArtifact) throw new Error('HISTORICAL_SCENE_PLAN_NOT_FOUND:' + JSON.stringify(
  artifacts.filter(row => row.kind === 'scene_config').map(row => ({
    id: row.id,
    revision: row.source_content_revision,
    scene_ids: planIds(row.payload),
  })),
));
if (!assetsArtifact) throw new Error('HISTORICAL_COMPLETE_SCENE_ASSETS_NOT_FOUND:' + JSON.stringify(
  artifacts.filter(row => row.kind === 'scene_assets').map(row => ({
    id: row.id,
    revision: row.source_content_revision,
    scene_ids: assetIds(row.payload),
    complete: Array.isArray(row.payload) && row.payload.map(asset => sceneBinding.completeSpaceLock(asset)),
  })),
));
const plan = sceneBinding.assertScenePlanContract(sceneBinding.normalizeScenePlan(planArtifact.payload));
const assetsById = new Map(assetsArtifact.payload.map(asset => [stableId(asset), asset]));
const assets = expectedSceneIds.map(id => assetsById.get(id));
const summary = {
  mode: shouldApply ? 'apply' : 'dry_run',
  task_id: taskId,
  content_revision: Number(task.content_revision || 0),
  task_state_before: { status: task.status, stage: task.stage },
  source_plan_artifact_id: planArtifact.id,
  source_plan_revision: planArtifact.source_content_revision,
  source_assets_artifact_id: assetsArtifact.id,
  source_assets_revision: assetsArtifact.source_content_revision,
  scene_ids: planIds(plan),
  complete_space_locks: assets.map(asset => sceneBinding.completeSpaceLock(asset)),
  model_call_count_before: beforeCalls,
  active_generation_count: activeRuns.length,
};
if (!shouldApply) {
  console.log(JSON.stringify(summary));
  process.exit(0);
}

const repairedContext = {
  ...context,
  scene_mode: plan.scene_mode,
  scene_plan: plan,
  scene_config: plan,
  scene_spec: plan.spaces[0]?.scene_spec || context.scene_spec || {},
  scene_assets: assets,
};
const snapshot = storage.saveSnapshot(taskId, {
  content_revision: expectedRevision,
  status: 'scene_authority_repaired',
  payload: repairedContext,
});
storage.saveOutput(taskId, 'context', repairedContext, {
  content_revision: expectedRevision,
  snapshot_id: snapshot.id,
  input_fingerprint: snapshot.input_fingerprint,
});
storage.saveOutput(taskId, 'scene_config', plan, {
  content_revision: expectedRevision,
  snapshot_id: snapshot.id,
});
storage.saveOutput(taskId, 'scene_assets', assets, {
  content_revision: expectedRevision,
  snapshot_id: snapshot.id,
});
storage.updateTask(taskId, {
  request: { ...(task.request || {}), ...repairedContext },
  status: 'working',
  stage: 'scene_config_done',
  saved_progress: true,
  error: '',
  error_code: '',
  retryable: false,
  active_stage: '',
  active_generation_id: '',
  generation_progress: null,
});
storage.saveStage(taskId, 'scene_authority_repair', {
  status: 'done',
  output_summary: '零模型调用恢复当前版本完整场景计划与已验证场景资产',
}, { systemFinalization: true });

const finalTask = storage.getTask(taskId);
const finalManifest = storage.getManifest(taskId);
const finalPlan = storage.getOutput(taskId, 'scene_config');
const finalAssets = storage.getOutput(taskId, 'scene_assets');
const publicBundle = service.publicTaskBundle(taskId);
const afterCalls = calls();
if (
  finalTask.status !== 'working'
  || finalTask.stage !== 'scene_config_done'
  || finalTask.active_generation_id
  || !sameIds(planIds(finalPlan), expectedSceneIds)
  || !sameIds(assetIds(finalAssets), expectedSceneIds)
  || finalAssets.some(asset => !sceneBinding.completeSpaceLock(asset))
  || !sameIds(assetIds(publicBundle.outputs.scene_assets), expectedSceneIds)
  || Object.prototype.hasOwnProperty.call(finalManifest.invalidated || {}, 'scene_config')
  || Object.prototype.hasOwnProperty.call(finalManifest.invalidated || {}, 'scene_assets')
  || afterCalls !== beforeCalls
) throw new Error('POST_REPAIR_INVARIANT_FAILED');

console.log(JSON.stringify({
  ...summary,
  task_state_after: { status: finalTask.status, stage: finalTask.stage },
  public_scene_ids: assetIds(publicBundle.outputs.scene_assets),
  scene_config_current: true,
  scene_assets_current: true,
  invalidation_cleared: true,
  model_call_count_after: afterCalls,
  model_call_delta: afterCalls - beforeCalls,
}));
`;

const encoded = Buffer.from(remoteScript, 'utf8').toString('base64');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const safetyBackup = `/opt/vido/backups/scene-authority-lineage-repair-${stamp}.sqlite`;
const commands = [
  ...(apply ? [`cp -a '${dbPath}' '${safetyBackup}'`] : []),
  `cd '${remoteRoot}'`,
  `node --no-warnings -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`,
  ...(apply ? [`echo SAFETY_BACKUP=${safetyBackup}`] : []),
];

client.on('ready', () => {
  client.exec(commands.join(' && '), (error, stream) => {
    if (error) throw error;
    stream.pipe(process.stdout);
    stream.stderr.pipe(process.stderr);
    stream.on('close', code => {
      client.end();
      process.exitCode = code || 0;
    });
  });
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({ host, port: 22, username, password, readyTimeout: 25000 });
