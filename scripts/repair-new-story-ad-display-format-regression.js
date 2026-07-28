#!/usr/bin/env node

const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 2222);
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const dbPath = process.env.VIDO_DB_PATH || '/data/vido/db/vido.sqlite';
const taskId = String(process.env.VIDO_REPAIR_TASK_ID || '').trim();
const expectedCurrentRevision = Number(process.env.VIDO_EXPECTED_CONTENT_REVISION || 0);
const sourceRevision = Number(process.env.VIDO_RECOVERY_SOURCE_REVISION || 0);
const expectedModelCallsText = String(process.env.VIDO_EXPECTED_MODEL_CALLS || '').trim();
const expectedModelCalls = expectedModelCallsText ? Number(expectedModelCallsText) : null;
const apply = process.env.VIDO_REPAIR_APPLY === '1';
const client = new Client();

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
if (!taskId) throw new Error('VIDO_REPAIR_TASK_ID is required');
if (apply && (!Number.isInteger(expectedCurrentRevision) || expectedCurrentRevision < 1)) {
  throw new Error('VIDO_EXPECTED_CONTENT_REVISION must be set before apply');
}
if (apply && (!Number.isInteger(sourceRevision) || sourceRevision < 1 || sourceRevision >= expectedCurrentRevision)) {
  throw new Error('VIDO_RECOVERY_SOURCE_REVISION must identify an earlier revision');
}
if (apply && (!Number.isInteger(expectedModelCalls) || expectedModelCalls < 0)) {
  throw new Error('VIDO_EXPECTED_MODEL_CALLS must match the dry-run result before apply');
}

const remoteScript = `
process.env.DB_ENABLED = 'true';
process.env.DB_PATH = ${JSON.stringify(dbPath)};
const crypto = require('crypto');
const storage = require('./src/services/newStoryAd/storageService');
const records = require('./src/repositories/contentRecordRepository');
const sceneBinding = require('./src/services/newStoryAd/sceneBindingService');

const taskId = ${JSON.stringify(taskId)};
const shouldApply = ${JSON.stringify(apply)};
const expectedCurrentRevision = ${JSON.stringify(expectedCurrentRevision)};
const sourceRevision = ${JSON.stringify(sourceRevision)};
const expectedModelCalls = ${JSON.stringify(expectedModelCalls)};
const calls = () => records.list('new_story_ad_model_calls', { project_id: taskId }).length;
const activeRuns = () => records.list('new_story_ad_generation_runs', { project_id: taskId })
  .filter(run => ['queued', 'running'].includes(String(run.status || '').toLowerCase()));
const rows = collection => records.list(collection, { project_id: taskId });
const stableId = value => String(value?.scene_id || value?.space_id || value?.id || '').trim();
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const semanticText = value => String(value || '').replace(/\\s+/g, '');
const byRevision = (rowsInput, revision) => rowsInput
  .filter(row => Number(row.source_content_revision || row.content_revision || 0) === revision)
  .sort((left, right) => (Date.parse(right.updated_at || right.created_at || '') || 0)
    - (Date.parse(left.updated_at || left.created_at || '') || 0));

const task = storage.getTask(taskId);
if (!task) throw new Error('TASK_NOT_FOUND');
const currentRevision = Number(task.content_revision || 0);
const currentContext = storage.getOutput(taskId, 'context') || task.request || {};
const snapshots = rows('new_story_ad_snapshots');
const artifacts = rows('new_story_ad_artifacts');
const sourceSnapshot = byRevision(snapshots, sourceRevision)[0] || null;
const sceneConfigArtifact = byRevision(
  artifacts.filter(row => row.kind === 'scene_config'),
  sourceRevision,
)[0] || null;
const sceneAssetsArtifact = byRevision(
  artifacts.filter(row => row.kind === 'scene_assets'),
  sourceRevision,
)[0] || null;
const recoveredContext = sourceSnapshot?.payload || null;
const recoveredPlan = sceneConfigArtifact?.payload || null;
const recoveredAssets = Array.isArray(sceneAssetsArtifact?.payload) ? sceneAssetsArtifact.payload : [];
const spaces = Array.isArray(recoveredPlan?.spaces) ? recoveredPlan.spaces : [];
const beforeCalls = calls();
const running = activeRuns();
const summary = {
  mode: shouldApply ? 'apply' : 'dry_run',
  task_id: taskId,
  current_revision: currentRevision,
  source_revision: sourceRevision || null,
  current_state: {
    status: String(task.status || ''),
    stage: String(task.stage || ''),
    active_generation_id: String(task.active_generation_id || ''),
  },
  current_outputs: {
    scene_config: Boolean(storage.getOutput(taskId, 'scene_config')),
    scene_assets: Boolean(storage.getOutput(taskId, 'scene_assets')),
  },
  candidates: {
    snapshot_revisions: [...new Set(snapshots.map(row => Number(row.content_revision || 0)))].sort((a, b) => a - b),
    scene_config_revisions: [...new Set(artifacts.filter(row => row.kind === 'scene_config').map(row => Number(row.source_content_revision || 0)))].sort((a, b) => a - b),
    scene_assets_revisions: [...new Set(artifacts.filter(row => row.kind === 'scene_assets').map(row => Number(row.source_content_revision || 0)))].sort((a, b) => a - b),
  },
  recovered_scene_ids: spaces.map(stableId),
  recovered_asset_ids: recoveredAssets.map(stableId),
  recovered_complete_locks: recoveredAssets.map(asset => sceneBinding.completeSpaceLock(asset)),
  semantic_brief_equal: recoveredContext
    ? semanticText(currentContext.brief) === semanticText(recoveredContext.brief)
    : false,
  semantic_creative_equal: recoveredContext
    ? semanticText(currentContext.creative_direction?.raw) === semanticText(recoveredContext.creative_direction?.raw)
    : false,
  model_call_count: beforeCalls,
  active_generation_count: running.length,
};

if (!shouldApply) {
  console.log(JSON.stringify(summary));
  process.exit(0);
}
if (currentRevision !== expectedCurrentRevision) throw new Error('CONTENT_REVISION_PRECONDITION_FAILED:' + currentRevision);
if (task.active_generation_id || running.length) throw new Error('ACTIVE_GENERATION_PRECONDITION_FAILED');
if (beforeCalls !== expectedModelCalls) throw new Error('MODEL_CALL_COUNT_PRECONDITION_FAILED:' + beforeCalls);
if (!recoveredContext || !recoveredPlan || !recoveredAssets.length) throw new Error('RECOVERY_ARTIFACT_PRECONDITION_FAILED');
if (!summary.semantic_brief_equal || !summary.semantic_creative_equal) throw new Error('NON_FORMAT_CONTENT_DIFFERENCE_PRECONDITION_FAILED');
if (spaces.length < 1 || spaces.length !== recoveredAssets.length) throw new Error('SCENE_COUNT_PRECONDITION_FAILED');
if (!spaces.every((space, index) => stableId(space) === stableId(recoveredAssets[index]))) throw new Error('SCENE_ID_PRECONDITION_FAILED');
if (summary.recovered_complete_locks.some(value => value !== true)) throw new Error('SCENE_LOCK_PRECONDITION_FAILED');
if (storage.getOutput(taskId, 'scene_config') || storage.getOutput(taskId, 'scene_assets')) {
  throw new Error('CURRENT_SCENE_OUTPUT_ALREADY_PRESENT');
}

storage.updateTask(taskId, {
  brief: recoveredContext.brief,
  request: recoveredContext,
  status: 'working',
  stage: 'scene_config_done',
  error: '',
  error_code: '',
  retryable: false,
  active_stage: '',
  active_generation_id: '',
  generation_progress: null,
});
const snapshot = storage.saveSnapshot(taskId, {
  content_revision: currentRevision,
  status: 'recovered_display_format_regression',
  payload: recoveredContext,
});
storage.saveOutput(taskId, 'context', recoveredContext, {
  content_revision: currentRevision,
  snapshot_id: snapshot.id,
  upstream_artifact_ids: [sourceSnapshot.id],
  qa_status: 'recovered_display_format_regression',
});
storage.saveOutput(taskId, 'scene_config', recoveredPlan, {
  content_revision: currentRevision,
  snapshot_id: snapshot.id,
  upstream_artifact_ids: [sceneConfigArtifact.id],
  qa_status: 'recovered_display_format_regression',
});
storage.saveOutput(taskId, 'scene_assets', recoveredAssets, {
  content_revision: currentRevision,
  snapshot_id: snapshot.id,
  upstream_artifact_ids: [sceneAssetsArtifact.id],
  qa_status: 'recovered_display_format_regression',
});
storage.saveStage(taskId, 'display_format_regression_recovery', {
  status: 'done',
  output_summary: 'Restored authoritative revision and scene prerequisites after display-only formatting was persisted',
  diagnostics: {
    source_revision: sourceRevision,
    current_revision: currentRevision,
    zero_model_recovery: true,
    scene_ids: spaces.map(stableId),
  },
}, { systemFinalization: true });

const finalTask = storage.getTask(taskId);
const finalContext = storage.getOutput(taskId, 'context');
const finalPlan = storage.getOutput(taskId, 'scene_config');
const finalAssets = storage.getOutput(taskId, 'scene_assets');
const afterCalls = calls();
const finalRuns = activeRuns();
if (
  Number(finalTask.content_revision || 0) !== currentRevision
  || finalTask.status !== 'working'
  || finalTask.stage !== 'scene_config_done'
  || finalTask.error
  || finalTask.error_code
  || finalTask.active_generation_id
  || finalRuns.length
  || afterCalls !== beforeCalls
  || digest(finalContext) !== digest(recoveredContext)
  || digest(finalPlan) !== digest(recoveredPlan)
  || digest(finalAssets) !== digest(recoveredAssets)
) throw new Error('POST_RECOVERY_INVARIANT_FAILED');

console.log(JSON.stringify({
  ...summary,
  final_state: {
    status: finalTask.status,
    stage: finalTask.stage,
    content_revision: Number(finalTask.content_revision || 0),
    snapshot_id: finalTask.current_snapshot_id,
  },
  final_outputs: {
    scene_config: Boolean(finalPlan),
    scene_asset_count: finalAssets.length,
  },
  model_call_count_after: afterCalls,
  model_call_delta: afterCalls - beforeCalls,
  active_generation_count_after: finalRuns.length,
}));
`;

const encoded = Buffer.from(remoteScript, 'utf8').toString('base64');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const safetyBackup = `/opt/vido/backups/display-format-regression-recovery-${stamp}.sqlite`;
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
}).connect({ host, port, username, password, readyTimeout: 25000 });
