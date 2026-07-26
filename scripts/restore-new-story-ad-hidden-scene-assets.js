#!/usr/bin/env node

const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const taskId = String(process.env.VIDO_REPAIR_TASK_ID || '').trim();
const sourceDb = String(process.env.VIDO_SCENE_ASSET_SOURCE_DB || '').trim();
const currentDb = process.env.VIDO_DB_PATH || '/data/vido/db/vido.sqlite';
const apply = process.env.VIDO_REPAIR_APPLY === '1';
const expectedModelCalls = Number(process.env.VIDO_EXPECTED_MODEL_CALLS || 0);
const restoreIds = String(process.env.VIDO_RESTORE_SCENE_ASSET_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const expectedCurrentAssetIds = String(process.env.VIDO_EXPECTED_CURRENT_SCENE_ASSET_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const expectedPlanIds = String(process.env.VIDO_EXPECTED_SCENE_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const client = new Client();

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
if (!taskId) throw new Error('VIDO_REPAIR_TASK_ID is required');
if (!sourceDb) throw new Error('VIDO_SCENE_ASSET_SOURCE_DB is required');
if (!restoreIds.length) throw new Error('VIDO_RESTORE_SCENE_ASSET_IDS is required');
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
const restoreIds = ${JSON.stringify(restoreIds)};
const expectedCurrentAssetIds = ${JSON.stringify(expectedCurrentAssetIds)};
const expectedPlanIds = ${JSON.stringify(expectedPlanIds)};

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
const stableId = asset => String(asset?.space_id || asset?.scene_id || asset?.id || '').trim();
const ids = assets => (Array.isArray(assets) ? assets : []).map(stableId);
const sameOrderedIds = (actual, expected) => (
  !expected.length
  || (actual.length === expected.length && expected.every((id, index) => id === actual[index]))
);
const deepClone = value => JSON.parse(JSON.stringify(value));
const stableJson = value => JSON.stringify(value || null);
const outputId = kind => taskId + ':' + kind;

const source = openDb(sourceDbPath);
const sourceAssetsRecord = readRecord(source, 'new_story_ad_outputs', outputId('scene_assets'));
sqlite.closeDatabase();
const sourceAssets = sourceAssetsRecord?.payload?.payload;
if (!Array.isArray(sourceAssets)) throw new Error('SOURCE_SCENE_ASSETS_NOT_FOUND');
const sourceById = new Map(sourceAssets.map(asset => [stableId(asset), asset]).filter(([id]) => id));
const missingSourceIds = restoreIds.filter(id => !sourceById.has(id));
if (missingSourceIds.length) throw new Error('RESTORE_ASSET_NOT_FOUND_IN_SOURCE:' + missingSourceIds.join(','));

const current = openDb(currentDbPath);
const taskRecord = readRecord(current, 'new_story_ad_tasks', taskId);
const contextRecord = readRecord(current, 'new_story_ad_outputs', outputId('context'));
const sceneConfigRecord = readRecord(current, 'new_story_ad_outputs', outputId('scene_config'));
const sceneAssetsRecord = readRecord(current, 'new_story_ad_outputs', outputId('scene_assets'));
if (!taskRecord || !contextRecord || !sceneConfigRecord) {
  throw new Error('CURRENT_TASK_RECORDS_INCOMPLETE:' + JSON.stringify({
    task: !!taskRecord,
    context: !!contextRecord,
    scene_config: !!sceneConfigRecord,
    scene_assets: !!sceneAssetsRecord,
  }));
}
const currentAssets = Array.isArray(sceneAssetsRecord?.payload?.payload)
  ? sceneAssetsRecord.payload.payload
  : (Array.isArray(contextRecord.payload?.payload?.scene_assets)
    ? contextRecord.payload.payload.scene_assets
    : (Array.isArray(taskRecord.payload?.request?.scene_assets) ? taskRecord.payload.request.scene_assets : []));
const currentAssetIds = ids(currentAssets);
const planSpaces = Array.isArray(sceneConfigRecord.payload?.payload?.spaces)
  ? sceneConfigRecord.payload.payload.spaces : [];
const planIds = planSpaces.map(space => String(space?.id || space?.space_id || '').trim());
const beforeModelCalls = modelCallCount(current);
const beforePlan = stableJson(sceneConfigRecord.payload);
const beforePerson = stableJson(contextRecord.payload?.payload?.person_asset);
const beforeTaskState = {
  status: taskRecord.payload?.status || '',
  stage: taskRecord.payload?.stage || '',
  active_generation_id: taskRecord.payload?.active_generation_id || '',
  generation_progress: taskRecord.payload?.generation_progress || null,
};

if (beforeTaskState.active_generation_id || beforeTaskState.generation_progress) {
  throw new Error('ACTIVE_GENERATION_PRECONDITION_FAILED');
}
if (beforeModelCalls !== expectedModelCalls) {
  throw new Error('MODEL_CALL_COUNT_PRECONDITION_FAILED:' + beforeModelCalls);
}
if (!sameOrderedIds(currentAssetIds, expectedCurrentAssetIds)) {
  throw new Error('CURRENT_ASSET_IDS_PRECONDITION_FAILED:' + currentAssetIds.join(','));
}
if (!sameOrderedIds(planIds, expectedPlanIds)) {
  throw new Error('CURRENT_PLAN_IDS_PRECONDITION_FAILED:' + planIds.join(','));
}
const alreadyPresent = restoreIds.filter(id => currentAssetIds.includes(id));
if (alreadyPresent.length) throw new Error('RESTORE_ASSET_ALREADY_PRESENT:' + alreadyPresent.join(','));

const restoredAssets = [
  ...currentAssets,
  ...restoreIds.map(id => deepClone(sourceById.get(id))),
];
const summary = {
  mode: shouldApply ? 'apply' : 'dry_run',
  task_id: taskId,
  source_db: sourceDbPath,
  current_task_state: beforeTaskState,
  current_plan_ids: planIds,
  current_asset_ids: currentAssetIds,
  restore_asset_ids: restoreIds,
  restored_asset_ids: ids(restoredAssets),
  restored_view_counts: restoreIds.map(id => ({
    id,
    view_count: Array.isArray(sourceById.get(id)?.view_images)
      ? sourceById.get(id).view_images.length : 0,
  })),
  model_call_count_before: beforeModelCalls,
};
if (!shouldApply) {
  console.log(JSON.stringify(summary));
  sqlite.closeDatabase();
  process.exit(0);
}

const now = new Date().toISOString();
const sceneAssetsPayload = deepClone(sceneAssetsRecord?.payload || sourceAssetsRecord.payload);
const contextPayload = deepClone(contextRecord.payload);
const taskPayload = deepClone(taskRecord.payload);
sceneAssetsPayload.id = outputId('scene_assets');
sceneAssetsPayload.task_id = taskId;
sceneAssetsPayload.kind = 'scene_assets';
sceneAssetsPayload.payload = restoredAssets;
sceneAssetsPayload.updated_at = now;
contextPayload.payload = { ...(contextPayload.payload || {}), scene_assets: restoredAssets };
contextPayload.updated_at = now;
taskPayload.request = { ...(taskPayload.request || {}), scene_assets: restoredAssets };
taskPayload.updated_at = now;

const upsertSql = (
  'INSERT OR REPLACE INTO content_records '
  + '(id, collection, user_id, project_id, account_id, type, status, payload_json, created_at, updated_at) '
  + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const upsert = (record, payload) => ({
  sql: upsertSql,
  params: [
    record.id, record.collection, record.user_id, record.project_id,
    record.account_id, record.type, record.status, JSON.stringify(payload),
    record.created_at || now, now,
  ],
});
current.batch([
  upsert(sceneAssetsRecord || {
    ...sourceAssetsRecord,
    id: outputId('scene_assets'),
    project_id: taskId,
    user_id: taskRecord.user_id,
    account_id: taskRecord.account_id,
  }, sceneAssetsPayload),
  upsert(contextRecord, contextPayload),
  upsert(taskRecord, taskPayload),
]);

const afterTask = readRecord(current, 'new_story_ad_tasks', taskId);
const afterContext = readRecord(current, 'new_story_ad_outputs', outputId('context'));
const afterSceneConfig = readRecord(current, 'new_story_ad_outputs', outputId('scene_config'));
const afterSceneAssets = readRecord(current, 'new_story_ad_outputs', outputId('scene_assets'));
const afterAssets = afterSceneAssets?.payload?.payload || [];
const afterModelCalls = modelCallCount(current);
const afterTaskState = {
  status: afterTask?.payload?.status || '',
  stage: afterTask?.payload?.stage || '',
  active_generation_id: afterTask?.payload?.active_generation_id || '',
  generation_progress: afterTask?.payload?.generation_progress || null,
};
if (
  !sameOrderedIds(ids(afterAssets), ids(restoredAssets))
  || !sameOrderedIds(ids(afterContext?.payload?.payload?.scene_assets), ids(restoredAssets))
  || !sameOrderedIds(ids(afterTask?.payload?.request?.scene_assets), ids(restoredAssets))
  || stableJson(afterSceneConfig?.payload) !== beforePlan
  || stableJson(afterContext?.payload?.payload?.person_asset) !== beforePerson
  || stableJson(afterTaskState) !== stableJson(beforeTaskState)
  || afterModelCalls !== beforeModelCalls
) throw new Error('POST_RESTORE_INVARIANT_FAILED');

console.log(JSON.stringify({
  ...summary,
  final_asset_ids: ids(afterAssets),
  task_state_preserved: true,
  scene_plan_preserved: true,
  person_asset_preserved: true,
  context_mirror_repaired: true,
  task_request_mirror_repaired: true,
  model_call_count_after: afterModelCalls,
}));
sqlite.closeDatabase();
`;

const encoded = Buffer.from(remoteScript, 'utf8').toString('base64');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const safetyBackup = `/opt/vido/backups/hidden-scene-asset-restore-${stamp}.sqlite`;
const commands = [
  ...(apply ? [`cp -a '${currentDb}' '${safetyBackup}'`] : []),
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
