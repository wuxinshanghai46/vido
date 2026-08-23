const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sqlite = require('../../db/sqlite');
const contentRecords = require('../../repositories/contentRecordRepository');
const cancellation = require('./cancellationContext');
const releaseBundle = require('../storyAdReleaseBundleService');

const DB_PATH = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'), 'new_story_ad_db.json');
const HEALTH_PATH = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'), 'new_story_ad_model_health.json');

const COLLECTIONS = {
  tasks: 'new_story_ad_tasks',
  assets: 'new_story_ad_assets',
  stages: 'new_story_ad_stages',
  outputs: 'new_story_ad_outputs',
  model_calls: 'new_story_ad_model_calls',
  reviews: 'new_story_ad_reviews',
  snapshots: 'new_story_ad_snapshots',
  artifacts: 'new_story_ad_artifacts',
  manifests: 'new_story_ad_manifests',
  generation_runs: 'new_story_ad_generation_runs',
  provider_circuits: 'new_story_ad_provider_circuits',
  works: 'new_story_ad_works',
  work_events: 'new_story_ad_work_events',
};

let dbSeedChecked = false;
let jsonBatchDepth = 0;
let jsonBatchDb = null;
let jsonBatchDirty = false;
let sqliteBatchDepth = 0;
let sqliteBatchDb = null;

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function defaultDb() {
  return {
    tasks: [],
    assets: [],
    stages: [],
    outputs: [],
    model_calls: [],
    reviews: [],
    snapshots: [],
    artifacts: [],
    manifests: [],
    generation_runs: [],
    provider_circuits: [],
    works: [],
    work_events: [],
  };
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(filePath);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(err.code)) {
      try { fs.unlinkSync(tmp); } catch {}
      throw err;
    }
    fs.copyFileSync(tmp, filePath);
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function normalizedJsonDb() {
  if (jsonBatchDb) return jsonBatchDb;
  const db = readJson(DB_PATH, defaultDb());
  const base = defaultDb();
  return Object.fromEntries(Object.keys(base).map(key => [key, Array.isArray(db[key]) ? db[key] : []]));
}

function cloneDb(db = {}) {
  const base = defaultDb();
  return Object.fromEntries(Object.keys(base).map(key => [
    key,
    JSON.parse(JSON.stringify(Array.isArray(db[key]) ? db[key] : [])),
  ]));
}

function atomicSqliteChanges(before = {}, after = {}) {
  return Object.entries(COLLECTIONS).map(([key, collection]) => {
    const previous = new Map((before[key] || []).map(row => [String(row.id || ''), row]));
    const next = new Map((after[key] || []).map(row => [String(row.id || ''), row]));
    const removeIds = [...previous.keys()].filter(id => id && !next.has(id));
    const upserts = [...next.entries()].filter(([id, row]) => {
      if (!id || !previous.has(id)) return true;
      return JSON.stringify(previous.get(id)) !== JSON.stringify(row);
    }).map(([, row]) => row);
    return { collection, removeIds, upserts };
  }).filter(change => change.removeIds.length || change.upserts.length);
}

function withWriteBatch(callback) {
  if (jsonBatchDepth > 0 || sqliteBatchDepth > 0) return callback();
  if (useSqlite()) {
    ensureDbSeeded();
    const before = readDb();
    sqliteBatchDb = cloneDb(before);
    sqliteBatchDepth = 1;
    try {
      const result = callback();
      if (result && typeof result.then === 'function') {
        throw new Error('SQLITE_WRITE_BATCH_REQUIRES_SYNCHRONOUS_CALLBACK');
      }
      const changes = atomicSqliteChanges(before, sqliteBatchDb);
      if (changes.length) contentRecords.applyAtomicChanges(changes);
      if (dbConfig().dualWrite) writeJson(DB_PATH, sqliteBatchDb);
      return result;
    } finally {
      sqliteBatchDepth = 0;
      sqliteBatchDb = null;
    }
  }
  jsonBatchDb = normalizedJsonDb();
  jsonBatchDepth = 1;
  jsonBatchDirty = false;
  try {
    const result = callback();
    if (result && typeof result.then === 'function') {
      throw new Error('JSON_WRITE_BATCH_REQUIRES_SYNCHRONOUS_CALLBACK');
    }
    if (jsonBatchDirty) writeJson(DB_PATH, jsonBatchDb);
    return result;
  } finally {
    jsonBatchDepth = 0;
    jsonBatchDb = null;
    jsonBatchDirty = false;
  }
}

function dbConfig() {
  return sqlite.getDbConfig();
}

function useSqlite() {
  return dbConfig().enabled;
}

function ensureDbSeeded() {
  if (!useSqlite() || dbSeedChecked) return;
  const legacy = normalizedJsonDb();
  for (const [key, collection] of Object.entries(COLLECTIONS)) {
    if (contentRecords.hasAny(collection) || !legacy[key].length) continue;
    contentRecords.upsertMany(collection, legacy[key]);
  }
  dbSeedChecked = true;
}

function listActiveTaskStates(limit = 1000) {
  if (!useSqlite()) {
    return listTasks({ limit }).filter(task => task.active_generation_id).map(task => ({
      id: task.id,
      active_generation_id: task.active_generation_id,
      stage: task.active_stage || task.stage || '',
    }));
  }
  ensureDbSeeded();
  return contentRecords.listActiveTaskStates(COLLECTIONS.tasks, limit);
}

function listUnknownBillingStates(limit = 2000) {
  if (!useSqlite()) return normalizedJsonDb().model_calls.filter(call => (
    String(call.billing_state || '').toLowerCase() === 'unknown'
      && ['submitted', 'submitted_unknown', 'accepted', 'polling', 'running']
        .includes(String(call.provider_submission_state || '').toLowerCase())
  )).slice(0, limit);
  ensureDbSeeded();
  return contentRecords.listUnknownBillingStates(COLLECTIONS.model_calls, limit);
}

function listRows(key, filters = {}) {
  if (sqliteBatchDb) {
    const rows = (sqliteBatchDb[key] || []).slice();
    const entries = Object.entries(filters || {}).filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 'all');
    const fieldValue = (row, field) => {
      if (field === 'project_id') return row?.project_id ?? row?.projectId ?? row?.task_id ?? row?.taskId ?? row?.work_id ?? '';
      if (field === 'user_id') return row?.user_id ?? row?.userId ?? '';
      if (field === 'account_id') return row?.account_id ?? row?.accountId ?? '';
      if (field === 'type') return row?.type ?? row?.category ?? '';
      if (field === 'status') return row?.status ?? row?.state ?? '';
      return row?.[field] ?? '';
    };
    return entries.length
      ? rows.filter(row => entries.every(([field, value]) => String(fieldValue(row, field)) === String(value)))
      : rows;
  }
  if (!useSqlite()) return normalizedJsonDb()[key].slice();
  ensureDbSeeded();
  return contentRecords.list(COLLECTIONS[key], filters);
}

function getRow(key, id) {
  if (sqliteBatchDb) return (sqliteBatchDb[key] || []).find(row => String(row.id) === String(id)) || null;
  if (!useSqlite()) return normalizedJsonDb()[key].find(row => String(row.id) === String(id)) || null;
  ensureDbSeeded();
  return contentRecords.get(COLLECTIONS[key], String(id));
}

function listRowsForUser(key, userId) {
  const owner = String(userId || '');
  if (!owner || sqliteBatchDb || !useSqlite()) return listRows(key);
  ensureDbSeeded();
  return contentRecords.listForUser(COLLECTIONS[key], owner);
}

function mutateJson(key, updater) {
  const db = normalizedJsonDb();
  const result = updater(db[key], db);
  if (jsonBatchDepth > 0) jsonBatchDirty = true;
  else writeJson(DB_PATH, db);
  return result;
}

function writeRow(key, row) {
  if (sqliteBatchDb) {
    const list = sqliteBatchDb[key];
    const idx = list.findIndex(item => String(item.id) === String(row.id));
    if (idx >= 0) list[idx] = row;
    else list.push(row);
    return row;
  }
  if (useSqlite()) {
    ensureDbSeeded();
    const saved = contentRecords.upsert(COLLECTIONS[key], row);
    if (dbConfig().dualWrite) {
      mutateJson(key, list => {
        const idx = list.findIndex(item => String(item.id) === String(row.id));
        if (idx >= 0) list[idx] = row;
        else list.push(row);
        return row;
      });
    }
    return saved;
  }
  return mutateJson(key, list => {
    const idx = list.findIndex(item => String(item.id) === String(row.id));
    if (idx >= 0) list[idx] = row;
    else list.push(row);
    return row;
  });
}

function removeRow(key, id) {
  if (sqliteBatchDb) {
    const list = sqliteBatchDb[key];
    const idx = list.findIndex(item => String(item.id) === String(id));
    if (idx >= 0) list.splice(idx, 1);
    return;
  }
  if (useSqlite()) {
    ensureDbSeeded();
    contentRecords.remove(COLLECTIONS[key], String(id));
    if (dbConfig().dualWrite) {
      mutateJson(key, list => {
        const idx = list.findIndex(item => String(item.id) === String(id));
        if (idx >= 0) list.splice(idx, 1);
      });
    }
    return;
  }
  mutateJson(key, list => {
    const idx = list.findIndex(item => String(item.id) === String(id));
    if (idx >= 0) list.splice(idx, 1);
  });
}

function readDb() {
  return Object.fromEntries(Object.keys(COLLECTIONS).map(key => [key, listRows(key)]));
}

function nowIso() {
  return new Date().toISOString();
}

function mergedRow(key, id, patch, defaults = {}) {
  const existing = getRow(key, id);
  const created = existing?.created_at || defaults.created_at || nowIso();
  return {
    ...defaults,
    ...(existing || {}),
    ...(patch || {}),
    id: String(id),
    created_at: created,
    updated_at: nowIso(),
  };
}

function createTask(task) {
  const row = {
    id: task.id,
    type: 'new_story_ad',
    status: task.status || 'draft',
    stage: task.stage || 'draft',
    title: task.title || '剧情广告任务',
    brief: task.brief || '',
    user_id: task.user_id || '',
    request: task.request || {},
    diagnostics: task.diagnostics || {},
    content_revision: Math.max(1, Number(task.content_revision || 1) || 1),
    latest_client_edit_seq: Math.max(0, Number(task.latest_client_edit_seq || 0) || 0),
    current_snapshot_id: String(task.current_snapshot_id || ''),
    lineage_enforced: task.lineage_enforced === true,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  if (getTask(row.id)) throw new Error('任务已存在');
  return writeRow('tasks', row);
}

function updateTask(id, patch, options = {}) {
  if (options.systemFinalization !== true) cancellation.throwIfCancelled(id);
  if (!getTask(id)) return null;
  return writeRow('tasks', mergedRow('tasks', id, patch));
}

function getTask(id) {
  return getRow('tasks', id);
}

function taskFingerprint(task = {}) {
  const request = task.request || {};
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const brief = clean(task.brief || request.brief || request.content || '');
  if (!brief) return `id:${String(task.id || '')}`;
  const user = clean(task.user_id || request.user_id || 'legacy');
  const duration = Number(request.target_duration || request.targetDuration || request.duration_sec || request.durationSec || request.duration || 30) || 30;
  const ratio = clean(request.output_ratio || request.outputRatio || '9:16');
  return JSON.stringify([user, brief, duration, ratio]);
}

function dedupeLatestTasks(rows = []) {
  const latest = new Map();
  const timestamp = task => Date.parse(task.updated_at || task.created_at || '') || 0;
  for (const task of rows) {
    const key = taskFingerprint(task);
    const current = latest.get(key);
    if (!current || timestamp(task) > timestamp(current) || (timestamp(task) === timestamp(current) && String(task.id).localeCompare(String(current.id)) > 0)) {
      latest.set(key, task);
    }
  }
  return [...latest.values()];
}

function latestTaskRowsById(rows = []) {
  const latest = new Map();
  const timestamp = task => Date.parse(task.updated_at || task.created_at || '') || 0;
  for (const task of rows) {
    const id = String(task?.id || '');
    if (!id) continue;
    const current = latest.get(id);
    if (!current || timestamp(task) >= timestamp(current)) latest.set(id, task);
  }
  return [...latest.values()];
}

function listTasks({ limit = 50, status = '', userId = '' } = {}) {
  let rows = userId ? listRowsForUser('tasks', userId) : listRows('tasks');
  if (status && status !== 'all') rows = rows.filter(row => String(row.status || '') === String(status));
  if (userId) rows = rows.filter(row => String(row.user_id || row.request?.user_id || row.request?.userId || '') === String(userId));
  return latestTaskRowsById(rows)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
    .slice(0, Math.max(1, Math.min(5000, Number(limit) || 50)));
}

function listTaskRows({ status = '', userId = '' } = {}) {
  let rows = userId ? listRowsForUser('tasks', userId) : listRows('tasks');
  if (status && status !== 'all') rows = rows.filter(row => String(row.status || '') === String(status));
  if (userId) rows = rows.filter(row => String(row.user_id || row.request?.user_id || row.request?.userId || '') === String(userId));
  return latestTaskRowsById(rows)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
}

function withoutTaskRows(db = {}, taskId = '') {
  const id = String(taskId || '');
  return Object.fromEntries(Object.keys(defaultDb()).map(key => {
    const rows = Array.isArray(db[key]) ? db[key] : [];
    if (key === 'tasks' || key === 'manifests') return [key, rows.filter(row => String(row.id || '') !== id)];
    return [key, rows.filter(row => String(row.task_id || '') !== id)];
  }));
}

function deleteTask(taskId, options = {}) {
  const id = String(taskId || '');
  const snapshot = options.snapshot && typeof options.snapshot === 'object' ? options.snapshot : readDb();
  if (!id || !(snapshot.tasks || []).some(row => String(row.id || '') === id)) return false;
  const next = withoutTaskRows(snapshot, id);
  if (!useSqlite()) {
    writeJson(DB_PATH, next);
    return true;
  }
  for (const key of Object.keys(COLLECTIONS)) {
    const previousIds = new Set((snapshot[key] || []).map(row => String(row.id || '')));
    const nextIds = new Set((next[key] || []).map(row => String(row.id || '')));
    contentRecords.removeMany(COLLECTIONS[key], [...previousIds].filter(rowId => !nextIds.has(rowId)));
  }
  if (dbConfig().dualWrite) {
    writeJson(DB_PATH, withoutTaskRows(normalizedJsonDb(), id));
  }
  return true;
}

function saveStage(taskId, stage, data = {}, options = {}) {
  if (options.systemFinalization !== true) cancellation.throwIfCancelled(taskId);
  const id = `${taskId}:${stage}`;
  const previous = getRow('stages', id) || {};
  const status = data.status || 'done';
  return writeRow('stages', mergedRow('stages', id, {
    task_id: taskId,
    stage,
    status,
    input_summary: data.input_summary ?? previous.input_summary ?? '',
    output_summary: data.output_summary ?? previous.output_summary ?? '',
    started_at: data.started_at || previous.started_at || nowIso(),
    finished_at: data.finished_at || (['queued', 'running'].includes(status) ? '' : nowIso()),
    error: data.error || '',
    diagnostics: data.diagnostics || {},
  }));
}

function staleGenerationError(taskId, expectedRevision, actualRevision) {
  const error = new Error(`当前任务已更新为版本 ${actualRevision}，版本 ${expectedRevision} 的旧生成结果已作废，不会覆盖最新内容`);
  error.code = 'STALE_GENERATION_REVISION';
  error.status = 409;
  error.retryable = false;
  error.task_id = String(taskId || '');
  error.expected_content_revision = Number(expectedRevision || 0);
  error.actual_content_revision = Number(actualRevision || 0);
  return error;
}

function canonicalFingerprint(value) {
  const canonical = input => {
    if (Array.isArray(input)) return input.map(canonical);
    if (!input || typeof input !== 'object') return input ?? null;
    return Object.fromEntries(Object.keys(input).sort()
      .filter(key => input[key] !== undefined && !['created_at', 'updated_at', 'previewUrl', 'uploading', 'progress'].includes(key))
      .map(key => [key, canonical(input[key])]));
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function manifestId(taskId) {
  return String(taskId || '');
}

function getManifest(taskId) {
  const row = getRow('manifests', manifestId(taskId));
  return row || {
    id: manifestId(taskId),
    task_id: String(taskId || ''),
    content_revision: Number(getTask(taskId)?.content_revision || 1) || 1,
    artifacts: {},
    invalidated: {},
  };
}

function saveManifest(taskId, patch = {}) {
  const previous = getManifest(taskId);
  return writeRow('manifests', mergedRow('manifests', manifestId(taskId), {
    task_id: String(taskId || ''),
    content_revision: Number(patch.content_revision || previous.content_revision || getTask(taskId)?.content_revision || 1) || 1,
    artifacts: patch.artifacts && typeof patch.artifacts === 'object' ? patch.artifacts : (previous.artifacts || {}),
    invalidated: patch.invalidated && typeof patch.invalidated === 'object' ? patch.invalidated : (previous.invalidated || {}),
  }));
}

function saveSnapshot(taskId, snapshot = {}) {
  const task = getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const revision = Math.max(1, Number(snapshot.content_revision || task.content_revision || 1) || 1);
  if (revision !== Math.max(1, Number(task.content_revision || 1) || 1)) {
    throw staleGenerationError(taskId, revision, task.content_revision);
  }
  const payload = snapshot.payload && typeof snapshot.payload === 'object'
    ? snapshot.payload
    : (snapshot.context && typeof snapshot.context === 'object' ? snapshot.context : {});
  const fingerprint = String(snapshot.input_fingerprint || canonicalFingerprint(payload));
  const id = String(snapshot.id || `${taskId}:r${revision}:${fingerprint.slice(0, 16)}`);
  const row = writeRow('snapshots', mergedRow('snapshots', id, {
    task_id: String(taskId),
    content_revision: revision,
    input_fingerprint: fingerprint,
    status: String(snapshot.status || 'sealed'),
    payload,
  }));
  updateTask(taskId, { current_snapshot_id: id });
  return row;
}

function getSnapshot(snapshotId) {
  return getRow('snapshots', String(snapshotId || ''));
}

function saveArtifact(taskId, kind, payload, meta = {}) {
  const task = getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const revision = Math.max(1, Number(meta.content_revision || task.content_revision || 1) || 1);
  const snapshotId = String(meta.snapshot_id || task.current_snapshot_id || `manual:${taskId}:r${revision}`);
  const generation = cancellation.current();
  const authorityId = String(meta.authority_id || generation?.authorityId || task.active_authority_id || '');
  const executionIdentity = String(meta.execution_identity || generation?.executionIdentity || task.active_execution_identity || '');
  const id = String(meta.id || `${taskId}:${snapshotId}:${authorityId ? `${authorityId}:` : ''}${kind}`);
  return writeRow('artifacts', mergedRow('artifacts', id, {
    task_id: String(taskId),
    kind: String(kind),
    snapshot_id: snapshotId,
    source_content_revision: revision,
    input_fingerprint: String(meta.input_fingerprint || canonicalFingerprint(payload)),
    upstream_artifact_ids: Array.isArray(meta.upstream_artifact_ids) ? meta.upstream_artifact_ids : [],
    qa_status: String(meta.qa_status || 'published'),
    authority_id: authorityId,
    execution_identity: executionIdentity,
    execution_disabled: false,
    cache_readonly: false,
    payload,
  }));
}

function getArtifact(artifactId) {
  return getRow('artifacts', String(artifactId || ''));
}

function updateArtifact(artifactId, patch = {}) {
  const current = getArtifact(artifactId);
  if (!current) return null;
  return writeRow('artifacts', mergedRow('artifacts', String(artifactId), patch));
}

function listArtifacts(taskId, kind = '') {
  return listArtifactIds(taskId).map(getArtifact).filter(Boolean)
    .filter(row => String(row.task_id) === String(taskId)
      && (!kind || String(row.kind) === String(kind)))
    .sort((left, right) => Date.parse(right.updated_at || right.created_at || 0)
      - Date.parse(left.updated_at || left.created_at || 0));
}

function listArtifactIds(taskId) {
  const owner = String(taskId || '');
  if (!owner || sqliteBatchDb || !useSqlite()) {
    return listRows('artifacts', { project_id: owner }).map(row => String(row.id));
  }
  ensureDbSeeded();
  return contentRecords.listIds(COLLECTIONS.artifacts, { project_id: owner });
}

function enableLineage(taskId) {
  const task = getTask(taskId);
  if (!task) throw new Error('任务不存在');
  if (task.lineage_enforced === true) return task;
  const revision = Math.max(1, Number(task.content_revision || 1) || 1);
  const context = getRow('outputs', `${taskId}:context`)?.payload || task.request || {};
  const snapshot = saveSnapshot(taskId, {
    id: `${taskId}:legacy:r${revision}`,
    content_revision: revision,
    status: 'legacy_unverified',
    payload: context,
  });
  const artifacts = {};
  listOutputs(taskId).forEach(row => {
    const artifact = saveArtifact(taskId, row.kind, row.payload, {
      content_revision: revision,
      snapshot_id: snapshot.id,
      qa_status: 'legacy_unverified',
    });
    artifacts[row.kind] = artifact.id;
  });
  saveManifest(taskId, { content_revision: revision, artifacts, invalidated: {} });
  return updateTask(taskId, {
    lineage_enforced: true,
    current_snapshot_id: snapshot.id,
    content_revision: revision,
  });
}

function publishArtifact(taskId, kind, artifact, options = {}) {
  const task = getTask(taskId);
  const revision = Math.max(1, Number(options.content_revision || artifact?.source_content_revision || task?.content_revision || 1) || 1);
  const currentRevision = Math.max(1, Number(task?.content_revision || 1) || 1);
  if (revision !== currentRevision) throw staleGenerationError(taskId, revision, currentRevision);
  const manifest = getManifest(taskId);
  const artifacts = { ...(manifest.artifacts || {}), [kind]: artifact.id };
  const invalidated = { ...(manifest.invalidated || {}) };
  delete invalidated[kind];
  saveManifest(taskId, { content_revision: currentRevision, artifacts, invalidated });
  return artifact;
}

function carryManifestRevision(taskId, contentRevision) {
  const task = getTask(taskId);
  const revision = Math.max(1, Number(contentRevision || task?.content_revision || 1) || 1);
  const manifest = getManifest(taskId);
  const carried = {};
  Object.entries(manifest.artifacts || {}).forEach(([kind, artifactId]) => {
    const previous = getArtifact(artifactId);
    if (!previous) return;
    const artifact = saveArtifact(taskId, kind, previous.payload, {
      content_revision: revision,
      snapshot_id: `carry:${taskId}:r${revision}`,
      upstream_artifact_ids: [previous.id],
      qa_status: previous.qa_status === 'legacy_unverified' ? 'legacy_unverified' : 'carried_forward',
      input_fingerprint: previous.input_fingerprint,
    });
    carried[kind] = artifact.id;
  });
  saveManifest(taskId, {
    content_revision: revision,
    artifacts: carried,
    invalidated: manifest.invalidated || {},
  });
  return carried;
}

function saveOutputInternal(taskId, kind, payload, options = {}) {
  cancellation.throwIfCancelled(taskId);
  const task = getTask(taskId);
  const generation = cancellation.current();
  const expectedRevision = Math.max(0, Number(
    options.content_revision
      || generation?.expectedContentRevision
      || generation?.expected_content_revision
      || 0,
  ) || 0);
  const currentRevision = Math.max(1, Number(task?.content_revision || 1) || 1);
  if (expectedRevision && expectedRevision !== currentRevision) {
    throw staleGenerationError(taskId, expectedRevision, currentRevision);
  }
  if (task?.authority_enforced === true && generation?.authorityId) {
    require('./authorityLifecycleService').assertCurrent(taskId, {
      authority_id: generation.authorityId,
      authority_token: generation.authorityToken,
      execution_identity: generation.executionIdentity,
      content_revision: expectedRevision || currentRevision,
    });
  }
  const works = require('./workAggregateService');
  const currentWork = getWork(taskId);
  const authoritativeMapped = currentWork?.mode === 'authoritative' && works.outputDomain(kind);
  if (authoritativeMapped) {
    works.writeAuthoritativeOutput(taskId, kind, payload, {
      commandId: `output:${String(kind)}:${canonicalFingerprint(payload).slice(0, 20)}`,
    });
  }
  const id = `${taskId}:${kind}`;
  const saved = authoritativeMapped
    ? { id, task_id: taskId, kind, payload, authority: 'work', updated_at: nowIso() }
    : writeRow('outputs', mergedRow('outputs', id, { task_id: taskId, kind, payload }));
  if (task?.lineage_enforced === true) {
    const snapshotId = String(
      options.snapshot_id
        || generation?.snapshotId
        || generation?.snapshot_id
        || task.current_snapshot_id
        || `manual:${taskId}:r${currentRevision}`,
    );
    const artifact = saveArtifact(taskId, kind, payload, {
      content_revision: expectedRevision || currentRevision,
      snapshot_id: snapshotId,
      input_fingerprint: options.input_fingerprint || generation?.inputFingerprint || generation?.input_fingerprint || '',
      upstream_artifact_ids: options.upstream_artifact_ids || [],
      qa_status: options.qa_status || 'published',
    });
    publishArtifact(taskId, kind, artifact, { content_revision: expectedRevision || currentRevision });
  }
  if (options.skip_work_sync !== true && !authoritativeMapped) {
    const domain = works.outputDomain(kind)?.[0];
    if (domain) {
      // Lazy import avoids storage -> aggregate -> storage initialization cycles.
      works.syncShadowSafely(taskId, {
        domains: [domain],
        commandId: `output:${String(kind)}:${canonicalFingerprint(payload).slice(0, 20)}`,
      });
    }
  }
  return saved;
}

function saveOutput(taskId, kind, payload, options = {}) {
  return withWriteBatch(() => saveOutputInternal(taskId, kind, payload, options));
}

function getOutput(taskId, kind) {
  const authoritative = require('./workAggregateService').authoritativeOutput(taskId, kind);
  if (authoritative.authoritative) return authoritative.value;
  const task = getTask(taskId);
  if (task?.lineage_enforced === true) {
    const generation = cancellation.current();
    if (kind === 'context' && generation?.snapshotId) {
      const snapshot = getSnapshot(generation.snapshotId);
      if (snapshot
        && String(snapshot.task_id) === String(taskId)
        && Number(snapshot.content_revision || 0) === Number(generation.expectedContentRevision || task.content_revision || 0)) {
        return snapshot.payload ?? null;
      }
    }
    const manifest = getManifest(taskId);
    const artifactId = manifest.artifacts?.[kind];
    const artifact = artifactId ? getArtifact(artifactId) : null;
    const currentRevision = Math.max(1, Number(task.content_revision || 1) || 1);
    if (artifact && Number(artifact.source_content_revision || 0) === currentRevision) return artifact.payload ?? null;
    return null;
  }
  return getRow('outputs', `${taskId}:${kind}`)?.payload ?? null;
}

function deleteOutputsInternal(taskId, kinds = []) {
  const uniqueKinds = [...new Set((Array.isArray(kinds) ? kinds : [kinds]).map(String).filter(Boolean))];
  if (!uniqueKinds.length) return [];
  const works = require('./workAggregateService');
  const authoritativeDeletion = works.deleteAuthoritativeOutputs(taskId, uniqueKinds, {
    commandId: `outputs:delete:${canonicalFingerprint(uniqueKinds).slice(0, 20)}`,
  });
  const ids = uniqueKinds.map(kind => `${taskId}:${kind}`);
  ids.forEach(id => removeRow('outputs', id));
  const task = getTask(taskId);
  if (task?.lineage_enforced === true) {
    const manifest = getManifest(taskId);
    const artifacts = { ...(manifest.artifacts || {}) };
    const invalidated = { ...(manifest.invalidated || {}) };
    uniqueKinds.forEach(kind => {
      delete artifacts[kind];
      invalidated[kind] = {
        content_revision: Number(task.content_revision || 1) || 1,
        invalidated_at: nowIso(),
      };
    });
    saveManifest(taskId, { content_revision: Number(task.content_revision || 1) || 1, artifacts, invalidated });
  }
  return authoritativeDeletion.authoritative
    ? [...new Set([...uniqueKinds, ...authoritativeDeletion.deleted])]
    : uniqueKinds;
}

function deleteOutputs(taskId, kinds = []) {
  return withWriteBatch(() => deleteOutputsInternal(taskId, kinds));
}

function deleteOutput(taskId, kind) {
  deleteOutputs(taskId, [kind]);
}

function pruneLegacyOutputRows(taskId, kinds = []) {
  const uniqueKinds = new Set((Array.isArray(kinds) ? kinds : [kinds]).map(String).filter(Boolean));
  if (!uniqueKinds.size) return 0;
  const ids = [...uniqueKinds].map(kind => `${taskId}:${kind}`);
  let removed = 0;
  ids.forEach(id => {
    if (!getRow('outputs', id)) return;
    removeRow('outputs', id);
    removed += 1;
  });
  return removed;
}

function listOutputs(taskId) {
  const legacy = listRows('outputs', { project_id: String(taskId) }).filter(row => String(row.task_id) === String(taskId));
  const work = getWork(taskId);
  if (!work || work.mode !== 'authoritative') return legacy;
  const works = require('./workAggregateService');
  const mappedKinds = Object.keys(works.OUTPUT_DOMAIN_MAP);
  const projected = mappedKinds.map(kind => {
    const value = works.outputFromWork(work, kind);
    if (value === undefined || value === null) return null;
    return {
      id: `${taskId}:${kind}`,
      task_id: String(taskId),
      kind,
      payload: value,
      authority: 'work',
      created_at: work.created_at || '',
      updated_at: work.updated_at || '',
    };
  }).filter(Boolean);
  const mapped = new Set(mappedKinds);
  return [...legacy.filter(row => !mapped.has(String(row.kind || ''))), ...projected];
}

function createWork(work = {}) {
  const id = String(work.id || work.task_id || '');
  if (!id) throw new Error('Work ID 不能为空');
  if (getRow('works', id)) throw new Error('Work 已存在');
  return writeRow('works', mergedRow('works', id, {
    ...work,
    id,
    task_id: String(work.task_id || id),
  }));
}

function getWork(id) {
  return getRow('works', String(id || ''));
}

function updateWork(id, patch = {}, options = {}) {
  const current = getWork(id);
  if (!current) return null;
  const expected = options.expected_version;
  if (expected !== undefined && Number(expected) !== Number(current.aggregate_version || 0)) {
    const error = new Error(`Work 已更新为版本 ${Number(current.aggregate_version || 0)}，版本 ${Number(expected || 0)} 不能覆盖最新状态`);
    error.code = 'WORK_VERSION_CONFLICT';
    error.status = 409;
    error.retryable = false;
    error.expected_version = Number(expected || 0);
    error.actual_version = Number(current.aggregate_version || 0);
    throw error;
  }
  return writeRow('works', mergedRow('works', String(id), patch));
}

function appendWorkEvent(workId, event = {}) {
  const aggregateVersion = Math.max(1, Number(event.aggregate_version || 1) || 1);
  const commandId = String(event.command_id || event.commandId || '').trim();
  const id = String(event.id || `${workId}:v${aggregateVersion}:${commandId || canonicalFingerprint(event).slice(0, 16)}`);
  const existing = getRow('work_events', id);
  if (existing) return existing;
  return writeRow('work_events', mergedRow('work_events', id, {
    ...event,
    id,
    work_id: String(workId),
    task_id: String(event.task_id || workId),
    aggregate_version: aggregateVersion,
  }));
}

function listWorkEvents(workId) {
  return listRows('work_events', { project_id: String(workId) })
    .filter(row => String(row.work_id || row.task_id) === String(workId))
    .sort((left, right) => Number(left.aggregate_version || 0) - Number(right.aggregate_version || 0));
}

function createGenerationRun(run = {}) {
  const id = String(run.id || '').trim();
  if (!id) throw new Error('Generation run ID 不能为空');
  if (getRow('generation_runs', id)) {
    const error = new Error(`Generation run ${id} 已存在`);
    error.code = 'GENERATION_UNIT_EXISTS';
    error.status = 409;
    throw error;
  }
  return writeRow('generation_runs', mergedRow('generation_runs', id, {
    ...run,
    id,
    task_id: String(run.task_id || run.work_id || ''),
    work_id: String(run.work_id || run.task_id || ''),
  }));
}

function getGenerationRun(id) {
  return getRow('generation_runs', String(id || ''));
}

function listGenerationRuns(filters = {}) {
  const workId = String(filters.work_id || filters.task_id || '').trim();
  return listRows('generation_runs', workId ? { project_id: workId } : {})
    .filter(row => !workId || String(row.work_id || row.task_id) === workId)
    .filter(row => !filters.state || String(row.state) === String(filters.state))
    .filter(row => !filters.target_permanent_id
      || String(row.target_permanent_id) === String(filters.target_permanent_id));
}

function updateGenerationRun(id, patch = {}, options = {}) {
  const current = getGenerationRun(id);
  if (!current) return null;
  const expected = options.expected_version;
  if (expected !== undefined && Number(expected) !== Number(current.unit_version || 0)) {
    const error = new Error(`Generation unit 已更新为版本 ${Number(current.unit_version || 0)}，版本 ${Number(expected || 0)} 不能覆盖最新状态`);
    error.code = 'GENERATION_UNIT_VERSION_CONFLICT';
    error.status = 409;
    error.retryable = false;
    error.expected_version = Number(expected || 0);
    error.actual_version = Number(current.unit_version || 0);
    throw error;
  }
  return writeRow('generation_runs', mergedRow('generation_runs', String(id), patch));
}

function getProviderCircuit(id) {
  return getRow('provider_circuits', String(id || ''));
}

function saveProviderCircuit(id, patch = {}) {
  return writeRow('provider_circuits', mergedRow('provider_circuits', String(id), patch));
}

function listProviderCircuits() {
  return listRows('provider_circuits');
}

function saveReview(taskId, stage, review) {
  cancellation.throwIfCancelled(taskId);
  const id = `${taskId}:${stage}`;
  return writeRow('reviews', mergedRow('reviews', id, { task_id: taskId, stage, review }));
}

function saveModelCall(call) {
  const task = call.task_id ? getTask(call.task_id) : null;
  const envelope = releaseBundle.envelope({
    content_revision: Number(call.content_revision || task?.content_revision || 0) || 0,
    generation_id: call.generation_id || task?.active_generation_id || '',
  });
  const row = {
    id: call.id || `${call.task_id || 'task'}:${call.stage || 'stage'}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    task_id: call.task_id || '',
    stage: call.stage || '',
    provider_id: call.provider_id || '',
    model_id: call.model_id || '',
    adapter: call.adapter || '',
    family: call.family || '',
    status: call.status || 'unknown',
    error_code: call.error_code || '',
    error_message: call.error_message || '',
    provider_status: call.provider_status || '',
    provider_reason: call.provider_reason || '',
    provider_request_id: call.provider_request_id || '',
    failure_domain_id: call.failure_domain_id || '',
    provider_task_id: call.provider_task_id || '',
    provider_submission_state: call.provider_submission_state || '',
    billing_state: call.billing_state || '',
    submission_id: call.submission_id || '',
    generation_id: call.generation_id || '',
    shot_index: call.shot_index !== null && call.shot_index !== undefined && call.shot_index !== ''
      && Number.isInteger(Number(call.shot_index)) ? Number(call.shot_index) : null,
    provider_error_code: call.provider_error_code || '',
    latency_ms: call.latency_ms || 0,
    fallback_rank: call.fallback_rank || 0,
    producer_bundle_id: call.producer_bundle_id || envelope.producer_bundle_id,
    build_id: call.build_id || envelope.build_id,
    contract_version: call.contract_version || envelope.contract_version,
    runtime_hash: call.runtime_hash || envelope.runtime_hash,
    normalizer_version: call.normalizer_version || envelope.normalizer_version,
    topology_compiler_version: call.topology_compiler_version || envelope.topology_compiler_version,
    content_revision: Number(call.content_revision || envelope.content_revision || 0) || 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  writeRow('model_calls', row);
  const rows = listRows('model_calls')
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  for (const stale of rows.slice(0, Math.max(0, rows.length - 2000))) removeRow('model_calls', stale.id);
  return row;
}

function getTaskBundle(taskId, { diagnostics = true } = {}) {
  return {
    task: getTask(taskId),
    stages: listRows('stages', { project_id: String(taskId) }).filter(row => String(row.task_id) === String(taskId)),
    outputs: listOutputs(taskId),
    model_calls: diagnostics ? listRows('model_calls', { project_id: String(taskId) }).filter(row => String(row.task_id) === String(taskId)) : [],
    reviews: diagnostics ? listRows('reviews', { project_id: String(taskId) }).filter(row => String(row.task_id) === String(taskId)) : [],
    manifest: getTask(taskId)?.lineage_enforced === true ? getManifest(taskId) : null,
  };
}

function readHealth() {
  return readJson(HEALTH_PATH, {});
}

function writeHealth(data) {
  writeJson(HEALTH_PATH, data || {});
}

module.exports = {
  DB_PATH,
  HEALTH_PATH,
  COLLECTIONS,
  readDb,
  createTask,
  updateTask,
  getTask,
  listTasks,
  listActiveTaskStates,
  listUnknownBillingStates,
  listTaskRows,
  dedupeLatestTasks,
  latestTaskRowsById,
  taskFingerprint,
  deleteTask,
  saveStage,
  saveOutput,
  getOutput,
  deleteOutput,
  deleteOutputs,
  pruneLegacyOutputRows,
  listOutputs,
  createWork,
  getWork,
  updateWork,
  appendWorkEvent,
  listWorkEvents,
  createGenerationRun,
  getGenerationRun,
  listGenerationRuns,
  updateGenerationRun,
  getProviderCircuit,
  saveProviderCircuit,
  listProviderCircuits,
  canonicalFingerprint,
  getManifest,
  saveManifest,
  saveSnapshot,
  getSnapshot,
  saveArtifact,
  getArtifact,
  updateArtifact,
  listArtifacts,
  listArtifactIds,
  enableLineage,
  publishArtifact,
  carryManifestRevision,
  saveReview,
  saveModelCall,
  withWriteBatch,
  getTaskBundle,
  readHealth,
  writeHealth,
};
