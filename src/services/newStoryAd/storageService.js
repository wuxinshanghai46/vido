const fs = require('fs');
const path = require('path');

const sqlite = require('../../db/sqlite');
const contentRecords = require('../../repositories/contentRecordRepository');
const cancellation = require('./cancellationContext');

const DB_PATH = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'), 'new_story_ad_db.json');
const HEALTH_PATH = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'), 'new_story_ad_model_health.json');

const COLLECTIONS = {
  tasks: 'new_story_ad_tasks',
  assets: 'new_story_ad_assets',
  stages: 'new_story_ad_stages',
  outputs: 'new_story_ad_outputs',
  model_calls: 'new_story_ad_model_calls',
  reviews: 'new_story_ad_reviews',
};

let dbSeedChecked = false;

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
  const db = readJson(DB_PATH, defaultDb());
  const base = defaultDb();
  return Object.fromEntries(Object.keys(base).map(key => [key, Array.isArray(db[key]) ? db[key] : []]));
}

function dbConfig() {
  return sqlite.getDbConfig();
}

function useSqlite() {
  return dbConfig().enabled;
}

function ensureDbSeeded() {
  if (!useSqlite() || dbSeedChecked) return;
  dbSeedChecked = true;
  const legacy = normalizedJsonDb();
  for (const [key, collection] of Object.entries(COLLECTIONS)) {
    const existing = contentRecords.list(collection);
    if (existing.length || !legacy[key].length) continue;
    contentRecords.upsertMany(collection, legacy[key]);
  }
}

function listRows(key, filters = {}) {
  if (!useSqlite()) return normalizedJsonDb()[key].slice();
  ensureDbSeeded();
  return contentRecords.list(COLLECTIONS[key], filters);
}

function getRow(key, id) {
  if (!useSqlite()) return normalizedJsonDb()[key].find(row => String(row.id) === String(id)) || null;
  ensureDbSeeded();
  return contentRecords.get(COLLECTIONS[key], String(id));
}

function mutateJson(key, updater) {
  const db = normalizedJsonDb();
  const result = updater(db[key], db);
  writeJson(DB_PATH, db);
  return result;
}

function writeRow(key, row) {
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
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  if (getTask(row.id)) throw new Error('任务已存在');
  return writeRow('tasks', row);
}

function updateTask(id, patch) {
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
  const duration = Number(request.duration_sec || request.duration || 30) || 30;
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

function listTasks({ limit = 50, status = '', userId = '' } = {}) {
  let rows = listRows('tasks');
  if (status && status !== 'all') rows = rows.filter(row => String(row.status || '') === String(status));
  if (userId) rows = rows.filter(row => !row.user_id || String(row.user_id) === String(userId));
  return dedupeLatestTasks(rows)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

function listTaskRows({ status = '', userId = '' } = {}) {
  let rows = listRows('tasks');
  if (status && status !== 'all') rows = rows.filter(row => String(row.status || '') === String(status));
  if (userId) rows = rows.filter(row => !row.user_id || String(row.user_id) === String(userId));
  return dedupeLatestTasks(rows)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
}

function deleteTask(taskId) {
  const id = String(taskId || '');
  if (!id || !getTask(id)) return false;
  for (const key of ['stages', 'outputs', 'model_calls', 'reviews']) {
    const related = listRows(key).filter(row => String(row.task_id || '') === id);
    related.forEach(row => removeRow(key, row.id));
  }
  removeRow('tasks', id);
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

function saveOutput(taskId, kind, payload) {
  cancellation.throwIfCancelled(taskId);
  const id = `${taskId}:${kind}`;
  return writeRow('outputs', mergedRow('outputs', id, { task_id: taskId, kind, payload }));
}

function getOutput(taskId, kind) {
  return getRow('outputs', `${taskId}:${kind}`)?.payload ?? null;
}

function deleteOutput(taskId, kind) {
  removeRow('outputs', `${taskId}:${kind}`);
}

function listOutputs(taskId) {
  return listRows('outputs', { project_id: String(taskId) }).filter(row => String(row.task_id) === String(taskId));
}

function saveReview(taskId, stage, review) {
  cancellation.throwIfCancelled(taskId);
  const id = `${taskId}:${stage}`;
  return writeRow('reviews', mergedRow('reviews', id, { task_id: taskId, stage, review }));
}

function saveModelCall(call) {
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
    latency_ms: call.latency_ms || 0,
    fallback_rank: call.fallback_rank || 0,
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
  listTaskRows,
  dedupeLatestTasks,
  taskFingerprint,
  deleteTask,
  saveStage,
  saveOutput,
  getOutput,
  deleteOutput,
  listOutputs,
  saveReview,
  saveModelCall,
  getTaskBundle,
  readHealth,
  writeHealth,
};
