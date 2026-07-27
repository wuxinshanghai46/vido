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
const expectedStatus = String(process.env.VIDO_EXPECTED_CURRENT_STATUS || '').trim();
const expectedStage = String(process.env.VIDO_EXPECTED_CURRENT_STAGE || '').trim();
const expectedErrorCode = String(process.env.VIDO_EXPECTED_ERROR_CODE || '').trim();
const apply = process.env.VIDO_REPAIR_APPLY === '1';
const client = new Client();

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
if (!taskId) throw new Error('VIDO_REPAIR_TASK_ID is required');
if (apply && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
  throw new Error('VIDO_EXPECTED_CONTENT_REVISION must be a positive integer before apply');
}
if (apply && (!Number.isInteger(expectedModelCalls) || expectedModelCalls < 0)) {
  throw new Error('VIDO_EXPECTED_MODEL_CALLS must be set to the dry-run count before apply');
}
if (apply && (!expectedStatus || !expectedStage || !expectedErrorCode)) {
  throw new Error('Expected status, stage, and error code must be set from the dry run before apply');
}

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
const expectedErrorCode = ${JSON.stringify(expectedErrorCode)};
const calls = () => records.list('new_story_ad_model_calls', { project_id: taskId }).length;
const activeRuns = () => records.list('new_story_ad_generation_runs', { project_id: taskId })
  .filter(run => ['queued', 'running'].includes(String(run.status || '').toLowerCase()));
const stableId = value => String(value?.scene_id || value?.space_id || value?.id || '').trim();

const task = storage.getTask(taskId);
if (!task) throw new Error('TASK_NOT_FOUND');
const sceneConfig = storage.getOutput(taskId, 'scene_config');
const sceneAssets = storage.getOutput(taskId, 'scene_assets');
const blueprint = storage.getOutput(taskId, 'blueprint');
const draftCheckpoint = storage.getOutput(taskId, 'blueprint_draft_checkpoint');
const beforeCalls = calls();
const running = activeRuns();
const spaces = Array.isArray(sceneConfig?.spaces) ? sceneConfig.spaces : [];
const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
const sceneIds = spaces.map(space => stableId(space));
const assetIds = assets.map(asset => stableId(asset));
const completeLocks = assets.map(asset => sceneBinding.completeSpaceLock(asset));
const publicAssets = service.publicTaskBundle(taskId).outputs?.scene_assets || [];
const summary = {
  mode: shouldApply ? 'apply' : 'dry_run',
  task_id: taskId,
  content_revision: Number(task.content_revision || 0),
  task_state_before: {
    status: String(task.status || ''),
    stage: String(task.stage || ''),
    error_code: String(task.error_code || ''),
    has_error: Boolean(task.error),
    active_stage: String(task.active_stage || ''),
    active_generation_id: String(task.active_generation_id || ''),
  },
  scene_ids: sceneIds,
  asset_ids: assetIds,
  complete_space_locks: completeLocks,
  public_asset_count: Array.isArray(publicAssets) ? publicAssets.length : 0,
  final_blueprint_present: Boolean(blueprint),
  draft_checkpoint_present: Boolean(draftCheckpoint),
  model_call_count_before: beforeCalls,
  active_generation_count: running.length,
};

if (!shouldApply) {
  console.log(JSON.stringify(summary));
  process.exit(0);
}

if (Number(task.content_revision || 0) !== expectedRevision) {
  throw new Error('CONTENT_REVISION_PRECONDITION_FAILED:' + task.content_revision);
}
if (
  String(task.status || '') !== expectedStatus
  || String(task.stage || '') !== expectedStage
  || String(task.error_code || '') !== expectedErrorCode
) {
  throw new Error('TASK_STATE_PRECONDITION_FAILED:' + task.status + '/' + task.stage + '/' + task.error_code);
}
if (task.active_generation_id || running.length) throw new Error('ACTIVE_GENERATION_PRECONDITION_FAILED');
if (beforeCalls !== expectedModelCalls) throw new Error('MODEL_CALL_COUNT_PRECONDITION_FAILED:' + beforeCalls);
if (sceneIds.length < 1 || sceneIds.length !== assetIds.length) throw new Error('SCENE_AUTHORITY_COUNT_PRECONDITION_FAILED');
if (!sceneIds.every((id, index) => id && id === assetIds[index])) throw new Error('SCENE_AUTHORITY_ID_PRECONDITION_FAILED');
if (completeLocks.some(value => value !== true)) throw new Error('SCENE_LOCK_PRECONDITION_FAILED');
if (!Array.isArray(publicAssets) || publicAssets.length !== assets.length) throw new Error('PUBLIC_SCENE_PROJECTION_PRECONDITION_FAILED');
if (blueprint) throw new Error('FINAL_BLUEPRINT_ALREADY_PRESENT');

storage.updateTask(taskId, {
  status: 'working',
  stage: 'scene_config_done',
  error: '',
  error_code: '',
  retryable: false,
  active_stage: '',
  active_generation_id: '',
  generation_progress: null,
});
storage.saveStage(taskId, 'script_package_recovery', {
  status: 'done',
  output_summary: 'Historical script-package failure cleared after production v35 recovery deployment',
  diagnostics: {
    recovery_version: 'production-recovery-v35',
    zero_model_recovery: true,
    preserved_scene_ids: sceneIds,
    previous_status: expectedStatus,
    previous_stage: expectedStage,
    previous_error_code: expectedErrorCode,
  },
}, { systemFinalization: true });

const finalTask = storage.getTask(taskId);
const afterCalls = calls();
const finalActiveRuns = activeRuns();
const finalAssets = storage.getOutput(taskId, 'scene_assets');
if (
  finalTask.status !== 'working'
  || finalTask.stage !== 'scene_config_done'
  || finalTask.error
  || finalTask.error_code
  || finalTask.active_generation_id
  || finalTask.generation_progress
  || finalActiveRuns.length
  || afterCalls !== beforeCalls
  || !Array.isArray(finalAssets)
  || finalAssets.length !== assets.length
  || finalAssets.some((asset, index) => stableId(asset) !== assetIds[index] || !sceneBinding.completeSpaceLock(asset))
) throw new Error('POST_REPAIR_INVARIANT_FAILED');

console.log(JSON.stringify({
  ...summary,
  task_state_after: {
    status: finalTask.status,
    stage: finalTask.stage,
    error_code: finalTask.error_code || '',
    has_error: Boolean(finalTask.error),
  },
  preserved_scene_ids: finalAssets.map(asset => stableId(asset)),
  model_call_count_after: afterCalls,
  model_call_delta: afterCalls - beforeCalls,
  active_generation_count_after: finalActiveRuns.length,
}));
`;

const encoded = Buffer.from(remoteScript, 'utf8').toString('base64');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const safetyBackup = `/opt/vido/backups/script-package-state-recovery-${stamp}.sqlite`;
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
