const crypto = require('crypto');

const { jsonParse, jsonStringify, nowIso, requireDatabase } = require('./baseRepository');

const DOMAIN_TABLES = new Set(['novels', 'comic_tasks', 'drama_projects', 'drama_episodes']);
const LIST_FILTER_COLUMNS = new Set(['user_id', 'project_id', 'account_id', 'type', 'status']);
const QUERY_CACHE_TTL_MS = Math.max(0, Number(process.env.CONTENT_RECORD_CACHE_TTL_MS) || 2500);
const queryCache = new Map();

function cacheKey(kind, parts) {
  return `${kind}:${parts.map(part => String(part ?? '')).join('|')}`;
}

function cacheGet(key) {
  if (!QUERY_CACHE_TTL_MS) return null;
  const hit = queryCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > QUERY_CACHE_TTL_MS) {
    queryCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (!QUERY_CACHE_TTL_MS) return value;
  queryCache.set(key, { ts: Date.now(), value });
  return value;
}

function invalidateCollection(collection) {
  const getPrefix = `get:${collection}|`;
  const listPrefix = `list:${collection}`;
  const userListPrefix = `list-user:${collection}|`;
  for (const key of queryCache.keys()) {
    if (
      key.startsWith(getPrefix) ||
      key.startsWith(userListPrefix) ||
      key === listPrefix ||
      key.startsWith(`${listPrefix}|`) ||
      key.includes(`|${collection}|`) ||
      key.endsWith(`|${collection}`)
    ) queryCache.delete(key);
  }
}

function stableId(collection, row = {}) {
  if (row.id) return String(row.id);
  const raw = JSON.stringify({
    collection,
    user_id: row.user_id || row.userId || null,
    project_id: row.project_id || row.projectId || null,
    created_at: row.created_at || row.timestamp || null,
    title: row.title || row.name || row.topic || null,
  });
  return `${collection}_${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 24)}`;
}

function domainTitle(row = {}) {
  return row.title || row.name || row.topic || row.theme || null;
}

function upsertDomainTable(db, rec) {
  if (!DOMAIN_TABLES.has(rec.collection)) return;
  const payload = jsonParse(rec.payload_json, {});
  try {
    db.prepare(`
      INSERT OR REPLACE INTO ${rec.collection} (
        id, user_id, project_id, type, status, title, payload_json, created_at, updated_at
      ) VALUES (
        @id, @user_id, @project_id, @type, @status, @title, @payload_json, @created_at, @updated_at
      )
    `).run({
      id: rec.id,
      user_id: rec.user_id,
      project_id: rec.project_id,
      type: rec.type,
      status: rec.status,
      title: domainTitle(payload),
      payload_json: rec.payload_json,
      created_at: rec.created_at,
      updated_at: rec.updated_at,
    });
  } catch (err) {
    if (!/no such table/i.test(String(err.message || ''))) throw err;
  }
}

function removeDomainTable(db, collection, id) {
  if (!DOMAIN_TABLES.has(collection)) return;
  try {
    db.prepare(`DELETE FROM ${collection} WHERE id = ?`).run(String(id));
  } catch (err) {
    if (!/no such table/i.test(String(err.message || ''))) throw err;
  }
}

function normalize(collection, row = {}) {
  const created = row.created_at || row.timestamp || nowIso();
  const updated = row.updated_at || created;
  const id = stableId(collection, row);
  const payload = { ...row, id };
  return {
    id,
    collection,
    user_id: payload.user_id || payload.userId || null,
    project_id: payload.project_id || payload.projectId || payload.task_id || payload.taskId || null,
    account_id: payload.account_id || payload.accountId || null,
    type: payload.type || payload.category || null,
    status: payload.status || payload.state || null,
    payload_json: jsonStringify(payload),
    created_at: created,
    updated_at: updated,
  };
}

function upsert(collection, row) {
  const db = requireDatabase();
  const rec = normalize(collection, row);
  invalidateCollection(collection);
  if (typeof db.upsertMany === 'function') {
    db.upsertMany(
      'content_records',
      ['id', 'collection', 'user_id', 'project_id', 'account_id', 'type', 'status', 'payload_json', 'created_at', 'updated_at'],
      ['collection', 'id'],
      [[
        rec.id,
        rec.collection,
        rec.user_id,
        rec.project_id,
        rec.account_id,
        rec.type,
        rec.status,
        rec.payload_json,
        rec.created_at,
        rec.updated_at,
      ]]
    );
    upsertDomainTable(db, rec);
    return jsonParse(rec.payload_json);
  }
  db.prepare(`
    INSERT INTO content_records (
      id, collection, user_id, project_id, account_id, type, status, payload_json, created_at, updated_at
    ) VALUES (
      @id, @collection, @user_id, @project_id, @account_id, @type, @status, @payload_json, @created_at, @updated_at
    )
    ON CONFLICT(collection, id) DO UPDATE SET
      user_id=excluded.user_id,
      project_id=excluded.project_id,
      account_id=excluded.account_id,
      type=excluded.type,
      status=excluded.status,
      payload_json=excluded.payload_json,
      updated_at=excluded.updated_at
  `).run(rec);
  upsertDomainTable(db, rec);
  return jsonParse(rec.payload_json);
}

function get(collection, id) {
  const key = cacheKey('get', [collection, id]);
  const cached = cacheGet(key);
  if (cached) return cached;
  const db = requireDatabase();
  const row = db.prepare('SELECT payload_json FROM content_records WHERE collection = ? AND id = ?').get(collection, String(id));
  return cacheSet(key, row ? jsonParse(row.payload_json) : null);
}

function upsertMany(collection, rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const db = requireDatabase();
  const records = list.map(row => normalize(collection, row));
  invalidateCollection(collection);
  if (typeof db.upsertMany === 'function') {
    db.upsertMany(
      'content_records',
      ['id', 'collection', 'user_id', 'project_id', 'account_id', 'type', 'status', 'payload_json', 'created_at', 'updated_at'],
      ['collection', 'id'],
      records.map(rec => [
        rec.id,
        rec.collection,
        rec.user_id,
        rec.project_id,
        rec.account_id,
        rec.type,
        rec.status,
        rec.payload_json,
        rec.created_at,
        rec.updated_at,
      ]),
    );
  } else {
    const apply = db.transaction(() => {
      for (const rec of records) {
        db.prepare(`
          INSERT INTO content_records (
            id, collection, user_id, project_id, account_id, type, status, payload_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(collection, id) DO UPDATE SET
            user_id=excluded.user_id,
            project_id=excluded.project_id,
            account_id=excluded.account_id,
            type=excluded.type,
            status=excluded.status,
            payload_json=excluded.payload_json,
            updated_at=excluded.updated_at
        `).run(
          rec.id, rec.collection, rec.user_id, rec.project_id, rec.account_id,
          rec.type, rec.status, rec.payload_json, rec.created_at, rec.updated_at,
        );
      }
    });
    apply();
  }
  return records.map(rec => jsonParse(rec.payload_json));
}

function applyAtomicChanges(changes = []) {
  const normalizedChanges = (Array.isArray(changes) ? changes : [])
    .map(change => ({
      collection: String(change?.collection || '').trim(),
      upserts: Array.isArray(change?.upserts) ? change.upserts : [],
      removeIds: [...new Set((Array.isArray(change?.removeIds) ? change.removeIds : []).map(String).filter(Boolean))],
    }))
    .filter(change => change.collection && (change.upserts.length || change.removeIds.length));
  if (!normalizedChanges.length) return { upserted: 0, removed: 0, changed_collections: [] };
  const db = requireDatabase();
  const operations = [];
  let upserted = 0;
  let removed = 0;
  for (const change of normalizedChanges) {
    invalidateCollection(change.collection);
    for (const id of change.removeIds) {
      operations.push({
        sql: 'DELETE FROM content_records WHERE collection = ? AND id = ?',
        params: [change.collection, id],
      });
      removed += 1;
    }
    for (const row of change.upserts) {
      const rec = normalize(change.collection, row);
      operations.push({
        sql: `
          INSERT OR REPLACE INTO content_records (
            id, collection, user_id, project_id, account_id, type, status, payload_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        params: [
          rec.id, rec.collection, rec.user_id, rec.project_id, rec.account_id,
          rec.type, rec.status, rec.payload_json, rec.created_at, rec.updated_at,
        ],
      });
      upserted += 1;
    }
  }
  if (typeof db.batch === 'function') db.batch(operations);
  else {
    const apply = db.transaction(() => {
      for (const operation of operations) db.prepare(operation.sql).run(...operation.params);
    });
    apply();
  }
  return {
    upserted,
    removed,
    changed_collections: normalizedChanges.map(change => change.collection),
  };
}

function normaliseFilters(filters = {}) {
  return Object.entries(filters || {})
    .filter(([key, value]) => LIST_FILTER_COLUMNS.has(key) && value !== undefined && value !== null && value !== '' && value !== 'all')
    .sort(([a], [b]) => a.localeCompare(b));
}

function list(collection, filters = {}) {
  const entries = normaliseFilters(filters);
  const key = cacheKey('list', [collection, ...entries.flat()]);
  const cached = cacheGet(key);
  if (cached) return cached;
  const db = requireDatabase();
  const where = ['collection = ?'];
  const params = [collection];
  for (const [field, value] of entries) {
    where.push(`${field} = ?`);
    params.push(String(value));
  }
  const rows = db.prepare(`
    SELECT payload_json
    FROM content_records
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(updated_at, created_at) DESC
  `).all(params).map(row => jsonParse(row.payload_json));
  return cacheSet(key, rows);
}

function listIds(collection, filters = {}) {
  const entries = normaliseFilters(filters);
  const db = requireDatabase();
  const where = ['collection = ?'];
  const params = [collection];
  for (const [field, value] of entries) {
    where.push(`${field} = ?`);
    params.push(String(value));
  }
  return db.prepare(`
    SELECT id
    FROM content_records
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(updated_at, created_at) DESC
  `).all(params).map(row => String(row.id));
}

function hasAny(collection) {
  const db = requireDatabase();
  return Boolean(db.prepare(`
    SELECT 1 AS present
    FROM content_records
    WHERE collection = ?
    LIMIT 1
  `).get(collection));
}

function listActiveTaskStates(collection, limit = 1000) {
  const db = requireDatabase();
  return db.prepare(`
    SELECT id, payload_json
    FROM content_records
    WHERE collection = ?
      AND payload_json LIKE '%"active_generation_id"%'
      AND payload_json NOT LIKE '%"active_generation_id":""%'
      AND payload_json NOT LIKE '%"active_generation_id":null%'
    ORDER BY COALESCE(updated_at, created_at) DESC
    LIMIT ?
  `).all(collection, Math.max(1, Math.min(5000, Number(limit) || 1000)))
    .map(row => ({ id: row.id, ...jsonParse(row.payload_json, {}) }))
    .filter(row => row.active_generation_id)
    .map(row => ({
      id: row.id,
      active_generation_id: row.active_generation_id,
      stage: row.active_stage || row.stage || '',
    }));
}

function listUnknownBillingStates(collection, limit = 2000) {
  const db = requireDatabase();
  return db.prepare(`
    SELECT id, project_id, payload_json
    FROM content_records
    WHERE collection = ?
      AND payload_json LIKE '%"billing_state":"unknown"%'
      AND (
        payload_json LIKE '%"provider_submission_state":"submitted"%'
        OR payload_json LIKE '%"provider_submission_state":"submitted_unknown"%'
        OR payload_json LIKE '%"provider_submission_state":"accepted"%'
        OR payload_json LIKE '%"provider_submission_state":"polling"%'
        OR payload_json LIKE '%"provider_submission_state":"running"%'
      )
    ORDER BY COALESCE(updated_at, created_at) DESC
    LIMIT ?
  `).all(collection, Math.max(1, Math.min(5000, Number(limit) || 2000)))
    .map(row => ({ project_id: row.project_id || '', ...jsonParse(row.payload_json, {}), id: row.id }));
}

function listForUser(collection, userId) {
  const owner = String(userId || '');
  if (!owner) return list(collection);
  const key = cacheKey('list-user', [collection, owner]);
  const cached = cacheGet(key);
  if (cached) return cached;
  const db = requireDatabase();
  const rows = db.prepare(`
    SELECT payload_json
    FROM content_records
    WHERE collection = ? AND (user_id = ? OR user_id IS NULL OR user_id = '')
    ORDER BY COALESCE(updated_at, created_at) DESC
  `).all(collection, owner).map(row => jsonParse(row.payload_json));
  return cacheSet(key, rows);
}

function update(collection, id, fields) {
  const existing = get(collection, id);
  if (!existing) return null;
  return upsert(collection, { ...existing, ...fields, id: String(id), updated_at: nowIso() });
}

function remove(collection, id) {
  const db = requireDatabase();
  invalidateCollection(collection);
  db.prepare('DELETE FROM content_records WHERE collection = ? AND id = ?').run(collection, String(id));
  removeDomainTable(db, collection, id);
}

function removeMany(collection, ids = []) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
  if (!unique.length) return 0;
  const db = requireDatabase();
  invalidateCollection(collection);
  const operations = unique.map(id => ({
    sql: 'DELETE FROM content_records WHERE collection = ? AND id = ?',
    params: [collection, id],
  }));
  if (typeof db.batch === 'function') db.batch(operations);
  else {
    const apply = db.transaction(() => {
      const statement = db.prepare('DELETE FROM content_records WHERE collection = ? AND id = ?');
      unique.forEach(id => statement.run(collection, id));
    });
    apply();
  }
  if (DOMAIN_TABLES.has(collection)) unique.forEach(id => removeDomainTable(db, collection, id));
  return unique.length;
}

function replaceCollection(collection, rows) {
  const db = requireDatabase();
  invalidateCollection(collection);
  const apply = db.transaction(() => {
    db.prepare('DELETE FROM content_records WHERE collection = ?').run(collection);
    for (const row of rows) upsert(collection, row);
  });
  apply();
}

function pruneBefore(collection, field, ts) {
  const rows = list(collection);
  const keep = rows.filter(row => !row[field] || row[field] >= ts);
  const removed = rows.length - keep.length;
  replaceCollection(collection, keep);
  return removed;
}

module.exports = {
  applyAtomicChanges,
  get,
  hasAny,
  list,
  listActiveTaskStates,
  listIds,
  listUnknownBillingStates,
  listForUser,
  pruneBefore,
  remove,
  removeMany,
  replaceCollection,
  stableId,
  update,
  upsert,
  upsertMany,
};
