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
const apply = process.env.VIDO_REPAIR_APPLY === '1';
const client = new Client();

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
if (!taskId) throw new Error('VIDO_REPAIR_TASK_ID is required');
if (apply && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
  throw new Error('VIDO_EXPECTED_CONTENT_REVISION must be set from dry-run output');
}
if (apply && (!Number.isInteger(expectedModelCalls) || expectedModelCalls < 0)) {
  throw new Error('VIDO_EXPECTED_MODEL_CALLS must be set from dry-run output');
}

const remoteScript = `
process.env.DB_ENABLED = 'true';
process.env.DB_PATH = ${JSON.stringify(dbPath)};
const storage = require('./src/services/newStoryAd/storageService');
const brandEnding = require('./src/services/newStoryAd/brandEndingService');
const temporalEvidence = require('./src/services/newStoryAd/temporalEvidenceLifecycleService');
const { buildKeyframeContracts } = require('./src/services/newStoryAd/keyframeContractService');
const keyframeContracts = require('./src/services/newStoryAd/keyframeContractFreshnessService');
const { buildSoundJourney } = require('./src/services/newStoryAd/soundJourneyService');

const taskId = ${JSON.stringify(taskId)};
const shouldApply = ${JSON.stringify(apply)};
const expectedRevision = ${JSON.stringify(expectedRevision)};
const expectedModelCalls = ${JSON.stringify(expectedModelCalls)};
const bundle = () => storage.getTaskBundle(taskId, { diagnostics: true });
const calls = () => (bundle().model_calls || []).length;
const activeTasks = () => storage.listTasks({ limit: 1000 }).filter(task =>
  task.active_generation_id || ['queued', 'running'].includes(String(task.status || '').toLowerCase()));

const task = storage.getTask(taskId);
if (!task) throw new Error('TASK_NOT_FOUND');
const ctx = storage.getOutput(taskId, 'context') || task.request || {};
const blueprint = storage.getOutput(taskId, 'blueprint');
const checkpoint = storage.getOutput(taskId, 'storyboard_checkpoint');
const taskBundle = bundle();
const reviews = Array.isArray(taskBundle.reviews) ? taskBundle.reviews : [];
const finalReviewRow = [...reviews].reverse().find(row => row.stage === 'storyboard.rewrite.2');
const finalReview = finalReviewRow?.review || null;
const beforeCalls = calls();
const active = activeTasks();
const rawShots = Array.isArray(checkpoint?.shots) ? checkpoint.shots : [];
const sanitizedShots = brandEnding.applyToShots(rawShots, ctx);
let compiled = null;
let compileError = '';
try {
  compiled = temporalEvidence.compile({ ctx, blueprint, shots: sanitizedShots });
} catch (error) {
  compileError = error.code + ':' + error.message;
}
const entityNames = compiled?.graph?.entities?.map(entity => entity.name).filter(Boolean) || [];
const summary = {
  mode: shouldApply ? 'apply' : 'dry_run',
  task_id: taskId,
  content_revision: Number(task.content_revision || 0),
  status: task.status || '',
  stage: task.stage || '',
  error_code: task.error_code || '',
  active_generation_id: task.active_generation_id || '',
  active_task_count: active.length,
  checkpoint_phase: checkpoint?.phase || '',
  checkpoint_shot_count: rawShots.length,
  final_review_stage: finalReviewRow?.stage || '',
  final_review_pass: finalReview?.pass === true,
  final_review_blocking_count: Array.isArray(finalReview?.blocking_issues) ? finalReview.blocking_issues.length : -1,
  compile_pass: Boolean(compiled),
  compile_error: compileError,
  compiled_shot_count: compiled?.shots?.length || 0,
  evidence_entity_names: entityNames,
  model_call_count_before: beforeCalls,
  brand_ending_enabled: brandEnding.enabled(ctx),
};

if (!shouldApply) {
  console.log(JSON.stringify(summary));
  process.exit(0);
}

if (Number(task.content_revision || 0) !== expectedRevision) throw new Error('CONTENT_REVISION_PRECONDITION_FAILED');
if (beforeCalls !== expectedModelCalls) throw new Error('MODEL_CALL_COUNT_PRECONDITION_FAILED:' + beforeCalls);
if (task.status !== 'failed' || task.stage !== 'script_package_failed' || task.error_code !== 'TEMPORAL_EVIDENCE_GRAPH_INVALID') {
  throw new Error('TASK_STATE_PRECONDITION_FAILED:' + task.status + '/' + task.stage + '/' + task.error_code);
}
if (task.active_generation_id || active.length) throw new Error('ACTIVE_GENERATION_PRECONDITION_FAILED');
if (!blueprint || !checkpoint || checkpoint.phase !== 'rewrite_2_reviewing' || rawShots.length < 1) {
  throw new Error('CHECKPOINT_PRECONDITION_FAILED');
}
if (!finalReview || finalReview.pass !== true || (finalReview.blocking_issues || []).length) {
  throw new Error('FINAL_REVIEW_PRECONDITION_FAILED');
}
if (!compiled || compiled.shots.length !== rawShots.length) throw new Error('COMPILE_PRECONDITION_FAILED:' + compileError);

const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
const contractCtx = {
  ...ctx,
  scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [],
  temporal_evidence_graph: compiled.graph,
};
const contracts = buildKeyframeContracts(contractCtx, compiled.shots);
if (contracts.length !== compiled.shots.length) throw new Error('CONTRACT_COUNT_PRECONDITION_FAILED');

storage.saveOutput(taskId, 'temporal_evidence_graph', compiled.graph);
storage.saveOutput(taskId, 'storyboard_table', compiled.shots);
storage.saveOutput(taskId, 'storyboard_meta', {
  status: 'ready',
  source: 'recovered_from_reviewed_checkpoint',
  blueprint_revision: Number(blueprint.revision || 0),
  blueprint_fingerprint: blueprint.fingerprint || '',
  completed_at: new Date().toISOString(),
});
storage.deleteOutput(taskId, 'storyboard_checkpoint');
storage.saveOutput(taskId, 'sound_journey', buildSoundJourney(compiled.shots));
storage.saveOutput(taskId, 'quality_review', finalReview);
keyframeContracts.persist(taskId, contracts);
storage.saveStage(taskId, 'storyboard', {
  status: 'done',
  output_summary: compiled.shots.length + ' 个已评审镜头从检查点恢复',
  diagnostics: { ...finalReview, recovery_version: 'temporal-evidence-open-vocabulary-v1', zero_model_recovery: true },
}, { systemFinalization: true });
storage.saveStage(taskId, 'keyframe_contract', {
  status: 'done',
  output_summary: contracts.length + ' 个关键帧合同',
  diagnostics: { recovery_version: 'temporal-evidence-open-vocabulary-v1', zero_model_recovery: true },
}, { systemFinalization: true });
storage.saveStage(taskId, 'script_package', {
  status: 'done',
  output_summary: '剧本、分镜和关键帧合同已从通过评审的检查点恢复',
  diagnostics: { recovery_version: 'temporal-evidence-open-vocabulary-v1', zero_model_recovery: true },
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
    completed: compiled.shots.length,
    total: compiled.shots.length,
    processed: compiled.shots.length,
    current_index: compiled.shots.length,
    percent: 100,
    message: '分镜表与关键帧合同已恢复并保存',
  },
});

const finalTask = storage.getTask(taskId);
const afterCalls = calls();
const finalCheckpoint = storage.getOutput(taskId, 'storyboard_checkpoint');
const finalShots = storage.getOutput(taskId, 'storyboard_table');
const finalContracts = storage.getOutput(taskId, 'keyframe_contracts');
if (
  finalTask.status !== 'done'
  || finalTask.stage !== 'keyframe_contract_ready'
  || finalTask.error
  || finalTask.error_code
  || finalTask.active_generation_id
  || finalCheckpoint
  || !Array.isArray(finalShots)
  || finalShots.length !== rawShots.length
  || !Array.isArray(finalContracts)
  || finalContracts.length !== rawShots.length
  || afterCalls !== beforeCalls
) throw new Error('POST_REPAIR_INVARIANT_FAILED');

console.log(JSON.stringify({
  ...summary,
  status_after: finalTask.status,
  stage_after: finalTask.stage,
  checkpoint_present_after: Boolean(finalCheckpoint),
  storyboard_count_after: finalShots.length,
  keyframe_contract_count_after: finalContracts.length,
  model_call_count_after: afterCalls,
  model_call_delta: afterCalls - beforeCalls,
}));
`;

const encoded = Buffer.from(remoteScript, 'utf8').toString('base64');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backup = `/opt/vido/backups/temporal-evidence-recovery-${stamp}.sqlite`;
const commands = [
  ...(apply ? [`cp -a '${dbPath}' '${backup}'`] : []),
  `cd '${remoteRoot}'`,
  `node --no-warnings -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`,
  ...(apply ? [`echo SAFETY_BACKUP=${backup}`] : []),
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
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).connect({ host, port, username, password, readyTimeout: 25000 });
