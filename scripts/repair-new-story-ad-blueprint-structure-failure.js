#!/usr/bin/env node

const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 2222);
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD || '';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const dbPath = process.env.VIDO_DB_PATH || '/data/vido/db/vido.sqlite';
const taskId = String(process.env.VIDO_REPAIR_TASK_ID || '').trim();
const expectedRevision = Number(process.env.VIDO_EXPECTED_CONTENT_REVISION || 0);
const expectedModelCalls = Number(process.env.VIDO_EXPECTED_MODEL_CALLS || -1);
const sourceRevision = Number(process.env.VIDO_SOURCE_CONTENT_REVISION || 0);
const apply = process.env.VIDO_REPAIR_APPLY === '1';

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
if (!taskId) throw new Error('VIDO_REPAIR_TASK_ID is required');
if (apply && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
  throw new Error('VIDO_EXPECTED_CONTENT_REVISION must be set from dry-run output');
}
if (apply && (!Number.isInteger(expectedModelCalls) || expectedModelCalls < 0)) {
  throw new Error('VIDO_EXPECTED_MODEL_CALLS must be set from dry-run output');
}
if (apply && (!Number.isInteger(sourceRevision) || sourceRevision < 1)) {
  throw new Error('VIDO_SOURCE_CONTENT_REVISION must be set from dry-run output');
}

const remoteScript = `
process.env.DB_ENABLED = 'true';
process.env.DB_PATH = ${JSON.stringify(dbPath)};
const storage = require('./src/services/newStoryAd/storageService');
const records = require('./src/repositories/contentRecordRepository');
const revision = require('./src/services/newStoryAd/revisionService');
const brandEnding = require('./src/services/newStoryAd/brandEndingService');

const taskId = ${JSON.stringify(taskId)};
const shouldApply = ${JSON.stringify(apply)};
const expectedRevision = ${JSON.stringify(expectedRevision)};
const expectedModelCalls = ${JSON.stringify(expectedModelCalls)};
const requestedSourceRevision = ${JSON.stringify(sourceRevision)};
const requiredKinds = [
  'blueprint',
  'storyboard_table',
  'storyboard_meta',
  'sound_journey',
  'quality_review',
  'keyframe_contracts',
  'temporal_evidence_graph',
];
const bundle = () => storage.getTaskBundle(taskId, { diagnostics: true });
const calls = () => (bundle().model_calls || []).length;
const activeTasks = () => storage.listTasks({ limit: 1000 }).filter(task =>
  task.active_generation_id || ['queued', 'running'].includes(String(task.status || '').toLowerCase()));
const task = storage.getTask(taskId);
if (!task) throw new Error('TASK_NOT_FOUND');
const ctx = storage.getOutput(taskId, 'context') || task.request || {};
const checkpoint = storage.getOutput(taskId, 'blueprint_draft_checkpoint');
const rejection = storage.getOutput(taskId, 'blueprint_rejection_diagnostic');
const artifacts = records.list('new_story_ad_artifacts', { project_id: taskId })
  .filter(row => String(row.task_id || '') === taskId);
const snapshots = records.list('new_story_ad_snapshots', { project_id: taskId })
  .filter(row => String(row.task_id || '') === taskId);
const successfulRevisions = [...new Set(artifacts
  .filter(row => row.kind === 'blueprint' && Array.isArray(row.payload?.beats) && row.payload.beats.length === 9)
  .map(row => Number(row.source_content_revision || 0))
  .filter(value => value > 0))]
  .sort((a, b) => b - a);
const sourceRev = requestedSourceRevision || successfulRevisions.find(value => value < Number(task.content_revision || 0)) || 0;
const latestSourceByKind = Object.fromEntries(requiredKinds.map(kind => {
  const rows = artifacts
    .filter(row => row.kind === kind && Number(row.source_content_revision || 0) === sourceRev)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return [kind, rows.at(-1) || null];
}));
const sourceSnapshot = snapshots
  .filter(row => Number(row.content_revision || 0) === sourceRev)
  .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  .at(-1);
const currentSnapshot = snapshots
  .filter(row => Number(row.content_revision || 0) === Number(task.content_revision || 0))
  .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  .at(-1);
const changedDomains = revision.changeDomains(sourceSnapshot?.payload || {}, currentSnapshot?.payload || {});
const beforeCalls = calls();
const active = activeTasks();
const sourceBlueprint = latestSourceByKind.blueprint?.payload;
const sourceShots = latestSourceByKind.storyboard_table?.payload;
const sourceContracts = latestSourceByKind.keyframe_contracts?.payload;
const sourceReview = latestSourceByKind.quality_review?.payload;
const sourceGraph = latestSourceByKind.temporal_evidence_graph?.payload;
const summary = {
  mode: shouldApply ? 'apply' : 'dry_run',
  task_id: taskId,
  content_revision: Number(task.content_revision || 0),
  source_revision: sourceRev,
  status: task.status || '',
  stage: task.stage || '',
  error_code: task.error_code || '',
  active_generation_id: task.active_generation_id || '',
  active_task_count: active.length,
  model_call_count_before: beforeCalls,
  source_to_current_changed_domains: changedDomains,
  source_artifact_kinds: Object.entries(latestSourceByKind).filter(([, row]) => Boolean(row)).map(([kind]) => kind),
  source_blueprint_count: Array.isArray(sourceBlueprint?.beats) ? sourceBlueprint.beats.length : 0,
  source_storyboard_count: Array.isArray(sourceShots) ? sourceShots.length : 0,
  source_contract_count: Array.isArray(sourceContracts) ? sourceContracts.length : 0,
  source_review_pass: sourceReview?.pass === true,
  source_graph_shot_count: Array.isArray(sourceGraph?.shots) ? sourceGraph.shots.length : 0,
  checkpoint_expected_count: Number(checkpoint?.expected_beat_count || 0),
  checkpoint_actual_count: Number(checkpoint?.actual_beat_count || 0),
  rejection_actual_count: Number(rejection?.structure_diagnostics?.actual_beat_count || 0),
  brand_ending_enabled: brandEnding.enabled(ctx),
};
if (!shouldApply) {
  console.log(JSON.stringify(summary));
  process.exit(0);
}
if (Number(task.content_revision || 0) !== expectedRevision) throw new Error('CONTENT_REVISION_PRECONDITION_FAILED');
if (beforeCalls !== expectedModelCalls) throw new Error('MODEL_CALL_COUNT_PRECONDITION_FAILED:' + beforeCalls);
if (sourceRev !== requestedSourceRevision) throw new Error('SOURCE_REVISION_PRECONDITION_FAILED');
if (task.status !== 'failed' || task.stage !== 'script_package_failed' || task.error_code !== 'BLUEPRINT_EXPLICIT_STRUCTURE_INCOMPLETE') {
  throw new Error('TASK_STATE_PRECONDITION_FAILED:' + task.status + '/' + task.stage + '/' + task.error_code);
}
if (task.active_generation_id || active.length) throw new Error('ACTIVE_GENERATION_PRECONDITION_FAILED');
if (changedDomains.length) throw new Error('SOURCE_CONTENT_CHANGED:' + changedDomains.join(','));
if (
  Number(checkpoint?.expected_beat_count || 0) !== 9
  || Number(checkpoint?.actual_beat_count || 0) !== 6
  || Number(rejection?.structure_diagnostics?.actual_beat_count || 0) !== 4
) throw new Error('FAILURE_EVIDENCE_PRECONDITION_FAILED');
if (Object.values(latestSourceByKind).some(row => !row)) throw new Error('SOURCE_ARTIFACT_PRECONDITION_FAILED');
if (
  !Array.isArray(sourceBlueprint?.beats) || sourceBlueprint.beats.length !== 9
  || !Array.isArray(sourceShots) || sourceShots.length !== 9
  || !Array.isArray(sourceContracts) || sourceContracts.length !== 9
  || sourceReview?.pass !== true
) throw new Error('SOURCE_QA_PRECONDITION_FAILED');

const restored = {
  blueprint: brandEnding.applyToBlueprint(sourceBlueprint, ctx),
  storyboard_table: brandEnding.applyToShots(sourceShots, ctx),
  storyboard_meta: {
    ...(latestSourceByKind.storyboard_meta.payload || {}),
    status: 'ready',
    source: 'zero_model_recovery_from_unchanged_revision',
    recovered_from_content_revision: sourceRev,
    completed_at: new Date().toISOString(),
  },
  sound_journey: latestSourceByKind.sound_journey.payload,
  quality_review: sourceReview,
  keyframe_contracts: sourceContracts,
  temporal_evidence_graph: sourceGraph,
};
for (const [kind, payload] of Object.entries(restored)) {
  storage.saveOutput(taskId, kind, payload, {
    content_revision: expectedRevision,
    snapshot_id: currentSnapshot.id,
    upstream_artifact_ids: [latestSourceByKind[kind].id],
    qa_status: 'recovered_unchanged_input',
  });
}
storage.deleteOutput(taskId, 'blueprint_draft_checkpoint');
storage.deleteOutput(taskId, 'blueprint_rejection_diagnostic');
storage.saveStage(taskId, 'blueprint', {
  status: 'done',
  output_summary: '9 个剧情 beat（从内容完全一致的已验收版本恢复）',
  diagnostics: { zero_model_recovery: true, recovered_from_content_revision: sourceRev },
}, { systemFinalization: true });
storage.saveStage(taskId, 'storyboard', {
  status: 'done',
  output_summary: '9 个分镜（从内容完全一致的已验收版本恢复）',
  diagnostics: { zero_model_recovery: true, recovered_from_content_revision: sourceRev },
}, { systemFinalization: true });
storage.saveStage(taskId, 'keyframe_contract', {
  status: 'done',
  output_summary: '9 个关键帧合同',
  diagnostics: { zero_model_recovery: true, recovered_from_content_revision: sourceRev },
}, { systemFinalization: true });
storage.saveStage(taskId, 'script_package', {
  status: 'done',
  output_summary: '剧本、分镜和关键帧合同已从内容完全一致的已验收版本恢复',
  diagnostics: { zero_model_recovery: true, recovered_from_content_revision: sourceRev },
}, { systemFinalization: true });
storage.updateTask(taskId, {
  status: 'done',
  stage: 'keyframe_contract_ready',
  error: '',
  error_code: '',
  retryable: false,
  active_stage: '',
  active_generation_id: '',
  generation_progress: {
    stage: 'storyboard',
    status: 'done',
    phase: 'persisted',
    completed: 9,
    total: 9,
    processed: 9,
    current_index: 9,
    percent: 100,
    message: '9 个剧本与分镜已恢复并保存',
  },
});
const finalTask = storage.getTask(taskId);
const finalBlueprint = storage.getOutput(taskId, 'blueprint');
const finalShots = storage.getOutput(taskId, 'storyboard_table');
const finalContracts = storage.getOutput(taskId, 'keyframe_contracts');
const finalCheckpoint = storage.getOutput(taskId, 'blueprint_draft_checkpoint');
const finalRejection = storage.getOutput(taskId, 'blueprint_rejection_diagnostic');
const afterCalls = calls();
if (
  finalTask.status !== 'done'
  || finalTask.stage !== 'keyframe_contract_ready'
  || finalTask.error || finalTask.error_code || finalTask.active_generation_id
  || !Array.isArray(finalBlueprint?.beats) || finalBlueprint.beats.length !== 9
  || !Array.isArray(finalShots) || finalShots.length !== 9
  || !Array.isArray(finalContracts) || finalContracts.length !== 9
  || finalCheckpoint || finalRejection
  || afterCalls !== beforeCalls
) throw new Error('POST_REPAIR_INVARIANT_FAILED');
console.log(JSON.stringify({
  ...summary,
  status_after: finalTask.status,
  stage_after: finalTask.stage,
  blueprint_count_after: finalBlueprint.beats.length,
  storyboard_count_after: finalShots.length,
  contract_count_after: finalContracts.length,
  checkpoint_present_after: Boolean(finalCheckpoint),
  rejection_present_after: Boolean(finalRejection),
  model_call_count_after: afterCalls,
  model_call_delta: afterCalls - beforeCalls,
}));
`;

const encoded = Buffer.from(remoteScript, 'utf8').toString('base64');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backup = `/opt/vido/backups/blueprint-structure-recovery-${stamp}.sqlite`;
const commands = [
  ...(apply ? [`cp -a '${dbPath}' '${backup}'`] : []),
  `cd '${remoteRoot}'`,
  `node --no-warnings -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`,
  ...(apply ? [`echo SAFETY_BACKUP=${backup}`] : []),
];
const client = new Client();
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
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).connect({ host, port, username, password, readyTimeout: 25000 });
