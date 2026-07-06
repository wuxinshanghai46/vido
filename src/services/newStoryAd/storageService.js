const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'), 'new_story_ad_db.json');
const HEALTH_PATH = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'), 'new_story_ad_model_health.json');

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
  fs.renameSync(tmp, filePath);
}

function readDb() {
  const db = readJson(DB_PATH, defaultDb());
  const base = defaultDb();
  return {
    ...base,
    ...db,
    tasks: Array.isArray(db.tasks) ? db.tasks : [],
    assets: Array.isArray(db.assets) ? db.assets : [],
    stages: Array.isArray(db.stages) ? db.stages : [],
    outputs: Array.isArray(db.outputs) ? db.outputs : [],
    model_calls: Array.isArray(db.model_calls) ? db.model_calls : [],
    reviews: Array.isArray(db.reviews) ? db.reviews : [],
  };
}

function saveDb(db) {
  writeJson(DB_PATH, db);
}

function nowIso() {
  return new Date().toISOString();
}

function upsertById(list, row) {
  const idx = list.findIndex(x => String(x.id) === String(row.id));
  if (idx >= 0) list[idx] = { ...list[idx], ...row, updated_at: nowIso() };
  else list.push({ ...row, created_at: row.created_at || nowIso(), updated_at: row.updated_at || nowIso() });
}

function createTask(task) {
  const db = readDb();
  const row = {
    id: task.id,
    type: 'new_story_ad',
    status: task.status || 'draft',
    stage: task.stage || 'draft',
    title: task.title || '新剧情广告任务',
    brief: task.brief || '',
    user_id: task.user_id || '',
    request: task.request || {},
    diagnostics: task.diagnostics || {},
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  db.tasks.push(row);
  saveDb(db);
  return row;
}

function updateTask(id, patch) {
  const db = readDb();
  const idx = db.tasks.findIndex(x => String(x.id) === String(id));
  if (idx < 0) return null;
  db.tasks[idx] = { ...db.tasks[idx], ...patch, updated_at: nowIso() };
  saveDb(db);
  return db.tasks[idx];
}

function getTask(id) {
  return readDb().tasks.find(x => String(x.id) === String(id)) || null;
}

function listTasks({ limit = 50, status = '', userId = '' } = {}) {
  let rows = readDb().tasks.slice();
  if (status && status !== 'all') rows = rows.filter(x => String(x.status || '') === String(status));
  if (userId) rows = rows.filter(x => !x.user_id || String(x.user_id) === String(userId));
  return rows
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

function saveStage(taskId, stage, data = {}) {
  const db = readDb();
  const id = `${taskId}:${stage}`;
  upsertById(db.stages, {
    id,
    task_id: taskId,
    stage,
    status: data.status || 'done',
    input_summary: data.input_summary || '',
    output_summary: data.output_summary || '',
    started_at: data.started_at || nowIso(),
    finished_at: data.finished_at || nowIso(),
    error: data.error || '',
    diagnostics: data.diagnostics || {},
  });
  saveDb(db);
  return db.stages.find(x => x.id === id);
}

function saveOutput(taskId, kind, payload) {
  const db = readDb();
  const id = `${taskId}:${kind}`;
  upsertById(db.outputs, {
    id,
    task_id: taskId,
    kind,
    payload,
  });
  saveDb(db);
  return db.outputs.find(x => x.id === id);
}

function getOutput(taskId, kind) {
  return readDb().outputs.find(x => String(x.task_id) === String(taskId) && String(x.kind) === String(kind))?.payload || null;
}

function listOutputs(taskId) {
  return readDb().outputs.filter(x => String(x.task_id) === String(taskId));
}

function saveReview(taskId, stage, review) {
  const db = readDb();
  const id = `${taskId}:${stage}`;
  upsertById(db.reviews, {
    id,
    task_id: taskId,
    stage,
    review,
  });
  saveDb(db);
  return db.reviews.find(x => x.id === id);
}

function saveModelCall(call) {
  const db = readDb();
  const row = {
    id: call.id || `${call.task_id || 'task'}:${call.stage || 'stage'}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    task_id: call.task_id || '',
    stage: call.stage || '',
    provider_id: call.provider_id || '',
    model_id: call.model_id || '',
    status: call.status || 'unknown',
    error_code: call.error_code || '',
    error_message: call.error_message || '',
    latency_ms: call.latency_ms || 0,
    fallback_rank: call.fallback_rank || 0,
    created_at: nowIso(),
  };
  db.model_calls.push(row);
  if (db.model_calls.length > 2000) db.model_calls = db.model_calls.slice(-2000);
  saveDb(db);
  return row;
}

function getTaskBundle(taskId) {
  const db = readDb();
  return {
    task: db.tasks.find(x => String(x.id) === String(taskId)) || null,
    stages: db.stages.filter(x => String(x.task_id) === String(taskId)),
    outputs: db.outputs.filter(x => String(x.task_id) === String(taskId)),
    model_calls: db.model_calls.filter(x => String(x.task_id) === String(taskId)),
    reviews: db.reviews.filter(x => String(x.task_id) === String(taskId)),
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
  readDb,
  createTask,
  updateTask,
  getTask,
  listTasks,
  saveStage,
  saveOutput,
  getOutput,
  listOutputs,
  saveReview,
  saveModelCall,
  getTaskBundle,
  readHealth,
  writeHealth,
};
