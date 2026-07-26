#!/usr/bin/env node

const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const taskId = String(process.env.VIDO_REPAIR_TASK_ID || '').trim();
const sourceDb = String(process.env.VIDO_SCENE_PLAN_SOURCE_DB || '').trim();
const currentDb = process.env.VIDO_DB_PATH || '/data/vido/db/vido.sqlite';
const apply = process.env.VIDO_REPAIR_APPLY === '1';
const expectedModelCalls = Number(process.env.VIDO_EXPECTED_MODEL_CALLS || 30);
const expectedSceneIds = String(process.env.VIDO_EXPECTED_SCENE_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const expectedCurrentSceneIds = String(process.env.VIDO_EXPECTED_CURRENT_SCENE_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const expectedCurrentStatus = String(process.env.VIDO_EXPECTED_CURRENT_STATUS || 'done').trim();
const expectedCurrentStage = String(process.env.VIDO_EXPECTED_CURRENT_STAGE || 'scene_asset_done').trim();
const expectedCurrentMode = String(process.env.VIDO_EXPECTED_CURRENT_MODE || 'single').trim();
const client = new Client();

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
if (!taskId) throw new Error('VIDO_REPAIR_TASK_ID is required');
if (!sourceDb) throw new Error('VIDO_SCENE_PLAN_SOURCE_DB is required');
if (!Number.isInteger(expectedModelCalls) || expectedModelCalls < 0) {
  throw new Error('VIDO_EXPECTED_MODEL_CALLS must be a non-negative integer');
}

const remoteScript = `
const fs = require('fs');
const sqlite = require('./src/db/sqlite');

const taskId = ${JSON.stringify(taskId)};
const sourceDbPath = ${JSON.stringify(sourceDb)};
const currentDbPath = ${JSON.stringify(currentDb)};
const shouldApply = ${JSON.stringify(apply)};
const expectedModelCalls = ${JSON.stringify(expectedModelCalls)};
const expectedSceneIds = ${JSON.stringify(expectedSceneIds)};
const expectedCurrentSceneIds = ${JSON.stringify(expectedCurrentSceneIds)};
const expectedCurrentStatus = ${JSON.stringify(expectedCurrentStatus)};
const expectedCurrentStage = ${JSON.stringify(expectedCurrentStage)};
const expectedCurrentMode = ${JSON.stringify(expectedCurrentMode)};

if (!fs.existsSync(sourceDbPath)) throw new Error('SOURCE_BACKUP_NOT_FOUND');
if (!fs.existsSync(currentDbPath)) throw new Error('CURRENT_DB_NOT_FOUND');

process.env.DB_ENABLED = 'true';
const openDb = dbPath => {
  sqlite.closeDatabase();
  process.env.DB_PATH = dbPath;
  return sqlite.openDatabase({ force: true, fresh: true });
};

const readRecord = (db, collection, id) => {
  const row = db.prepare(
    'SELECT id, collection, user_id, project_id, account_id, type, status, payload_json, created_at, updated_at '
    + 'FROM content_records WHERE collection = ? AND id = ?'
  ).get(collection, id);
  return row ? { ...row, payload: JSON.parse(row.payload_json) } : null;
};
const modelCallCount = db => Number(db.prepare(
  'SELECT COUNT(*) AS count FROM content_records WHERE collection = ? AND project_id = ?'
).get('new_story_ad_model_calls', taskId)?.count || 0);
const sceneOutputId = taskId + ':scene_config';
const contextOutputId = taskId + ':context';
const sceneAssetsOutputId = taskId + ':scene_assets';
const sourceDb = openDb(sourceDbPath);
const sourceScene = readRecord(sourceDb, 'new_story_ad_outputs', sceneOutputId);
sqlite.closeDatabase();
const currentDb = openDb(currentDbPath);
const currentScene = readRecord(currentDb, 'new_story_ad_outputs', sceneOutputId);
const currentContext = readRecord(currentDb, 'new_story_ad_outputs', contextOutputId);
const currentSceneAssets = readRecord(currentDb, 'new_story_ad_outputs', sceneAssetsOutputId);
const currentTask = readRecord(currentDb, 'new_story_ad_tasks', taskId);
const sourcePlan = sourceScene?.payload?.payload || null;
const spaces = Array.isArray(sourcePlan?.spaces) ? sourcePlan.spaces : [];
const sourceIds = spaces.map(space => String(space?.id || space?.space_id || '').trim());
const currentSpaces = Array.isArray(currentScene?.payload?.payload?.spaces)
  ? currentScene.payload.payload.spaces : [];
const currentIds = currentSpaces.map(space => String(space?.id || space?.space_id || '').trim());
const beforeModelCalls = modelCallCount(currentDb);
const stableJson = value => JSON.stringify(value || null);
const beforeSceneAssets = stableJson(currentSceneAssets?.payload);
const beforePersonAsset = stableJson(currentContext?.payload?.payload?.person_asset);

if (!currentTask) throw new Error('CURRENT_TASK_NOT_FOUND');
if (!currentContext) throw new Error('CURRENT_CONTEXT_NOT_FOUND');
if (!sourcePlan || spaces.length !== 2 || sourcePlan.scene_mode !== 'multi') {
  throw new Error('SOURCE_SCENE_PLAN_NOT_EXACTLY_TWO_SCENES');
}
if (expectedSceneIds.length && (
  expectedSceneIds.length !== sourceIds.length
  || expectedSceneIds.some((id, index) => id !== sourceIds[index])
)) throw new Error('SOURCE_SCENE_IDS_DO_NOT_MATCH_EXPECTATION');
if (beforeModelCalls !== expectedModelCalls) {
  throw new Error('MODEL_CALL_COUNT_PRECONDITION_FAILED:' + beforeModelCalls);
}
if (expectedCurrentSceneIds.length && (
  expectedCurrentSceneIds.length !== currentIds.length
  || expectedCurrentSceneIds.some((id, index) => id !== currentIds[index])
)) throw new Error('CURRENT_SCENE_IDS_PRECONDITION_FAILED:' + currentIds.join(','));

const summary = {
  mode: shouldApply ? 'apply' : 'dry_run',
  task_id: taskId,
  source_db: sourceDbPath,
  current_status: currentTask.payload.status || '',
  current_stage: currentTask.payload.stage || '',
  current_scene_mode: currentContext.payload?.payload?.scene_mode
    || currentTask.payload?.request?.scene_mode || '',
  current_space_count: currentSpaces.length,
  current_space_ids: currentIds,
  source_scene_mode: sourcePlan.scene_mode,
  source_spaces: spaces.map(space => ({
    id: space.id || space.space_id || '',
    name: space.name || '',
    description: space.description || '',
    story_purpose: space.story_purpose || '',
    scene_spec: space.scene_spec || null,
  })),
  model_call_count_before: beforeModelCalls,
};

if (!shouldApply) {
  console.log(JSON.stringify(summary));
  sqlite.closeDatabase();
  process.exit(0);
}

if (currentTask.payload.status !== expectedCurrentStatus || currentTask.payload.stage !== expectedCurrentStage) {
  throw new Error('CURRENT_TASK_STATE_CHANGED:' + currentTask.payload.status + '/' + currentTask.payload.stage);
}
const currentMode = currentContext.payload?.payload?.scene_mode
  || currentTask.payload?.request?.scene_mode || '';
if (currentMode !== expectedCurrentMode) throw new Error('CURRENT_SCENE_MODE_PRECONDITION_FAILED:' + currentMode);

const now = new Date().toISOString();
const deepClone = value => JSON.parse(JSON.stringify(value));
const contextRow = deepClone(currentContext.payload);
const taskRow = deepClone(currentTask.payload);
const restoredSceneRow = {
  ...sourceScene.payload,
  id: sceneOutputId,
  task_id: taskId,
  kind: 'scene_config',
  payload: sourcePlan,
  created_at: sourceScene.payload.created_at || now,
  updated_at: now,
};
contextRow.payload = {
  ...(contextRow.payload || {}),
  scene_mode: 'multi',
  scene_plan: sourcePlan,
  scene_config: sourcePlan,
  scene_spec: spaces[0].scene_spec || contextRow.payload?.scene_spec || {},
};
contextRow.updated_at = now;
taskRow.request = {
  ...(taskRow.request || {}),
  scene_mode: 'multi',
  scene_plan: sourcePlan,
  scene_config: sourcePlan,
  scene_spec: spaces[0].scene_spec || taskRow.request?.scene_spec || {},
};
Object.assign(taskRow, {
  status: 'working',
  stage: 'scene_config_done',
  saved_progress: true,
  error: '',
  error_code: '',
  support_id: '',
  retryable: false,
  active_stage: '',
  active_generation_id: '',
  generation_progress: null,
  updated_at: now,
});

const upsertSql = (
  'INSERT OR REPLACE INTO content_records '
  + '(id, collection, user_id, project_id, account_id, type, status, payload_json, created_at, updated_at) '
  + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

currentDb.batch([
  {
    sql: upsertSql,
    params: [
      sceneOutputId, 'new_story_ad_outputs', sourceScene.user_id, taskId,
      sourceScene.account_id, sourceScene.type, sourceScene.status,
      JSON.stringify(restoredSceneRow), sourceScene.created_at || now, now,
    ],
  },
  {
    sql: upsertSql,
    params: [
      contextOutputId, 'new_story_ad_outputs', currentContext.user_id, taskId,
      currentContext.account_id, currentContext.type, currentContext.status,
      JSON.stringify(contextRow), currentContext.created_at || now, now,
    ],
  },
  {
    sql: upsertSql,
    params: [
      taskId, 'new_story_ad_tasks', currentTask.user_id, currentTask.project_id,
      currentTask.account_id, currentTask.type, 'working',
      JSON.stringify(taskRow), currentTask.created_at || now, now,
    ],
  },
]);

const repairedScene = readRecord(currentDb, 'new_story_ad_outputs', sceneOutputId);
const repairedContext = readRecord(currentDb, 'new_story_ad_outputs', contextOutputId);
const repairedTask = readRecord(currentDb, 'new_story_ad_tasks', taskId);
const repairedSceneAssets = readRecord(currentDb, 'new_story_ad_outputs', sceneAssetsOutputId);
const afterModelCalls = modelCallCount(currentDb);
const repairedSpaces = repairedScene?.payload?.payload?.spaces || [];
if (
  repairedSpaces.length !== 2
  || repairedScene.payload.payload.scene_mode !== 'multi'
  || repairedContext.payload.payload.scene_mode !== 'multi'
  || repairedTask.payload.request.scene_mode !== 'multi'
  || repairedTask.payload.status !== 'working'
  || repairedTask.payload.stage !== 'scene_config_done'
  || afterModelCalls !== beforeModelCalls
  || stableJson(repairedSceneAssets?.payload) !== beforeSceneAssets
  || stableJson(repairedContext?.payload?.payload?.person_asset) !== beforePersonAsset
) throw new Error('POST_REPAIR_INVARIANT_FAILED');

console.log(JSON.stringify({
  ...summary,
  repaired_status: repairedTask.payload.status,
  repaired_stage: repairedTask.payload.stage,
  repaired_scene_mode: repairedContext.payload.payload.scene_mode,
  repaired_space_count: repairedSpaces.length,
  repaired_space_ids: repairedSpaces.map(space => space.id || space.space_id || ''),
  scene_assets_preserved: true,
  person_asset_preserved: true,
  model_call_count_after: afterModelCalls,
}));
sqlite.closeDatabase();
`;

const encoded = Buffer.from(remoteScript, 'utf8').toString('base64');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const safetyBackup = `/opt/vido/backups/scene-plan-authority-repair-${stamp}.sqlite`;
const commands = [
  ...(apply ? [`cp -a '${currentDb}' '${safetyBackup}'`] : []),
  `cd '/opt/vido/app'`,
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
