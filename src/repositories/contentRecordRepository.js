const crypto = require('crypto');

const { jsonParse, jsonStringify, nowIso, requireDatabase } = require('./baseRepository');

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

function normalize(collection, row = {}) {
  const created = row.created_at || row.timestamp || nowIso();
  const updated = row.updated_at || created;
  const id = stableId(collection, row);
  const payload = { ...row, id };
  return {
    id,
    collection,
    user_id: payload.user_id || payload.userId || null,
    project_id: payload.project_id || payload.projectId || null,
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
  return jsonParse(rec.payload_json);
}

function get(collection, id) {
  const db = requireDatabase();
  const row = db.prepare('SELECT payload_json FROM content_records WHERE collection = ? AND id = ?').get(collection, String(id));
  return row ? jsonParse(row.payload_json) : null;
}

function list(collection) {
  const db = requireDatabase();
  return db.prepare(`
    SELECT payload_json
    FROM content_records
    WHERE collection = ?
    ORDER BY COALESCE(updated_at, created_at) DESC
  `).all(collection).map(row => jsonParse(row.payload_json));
}

function update(collection, id, fields) {
  const existing = get(collection, id);
  if (!existing) return null;
  return upsert(collection, { ...existing, ...fields, id: String(id), updated_at: nowIso() });
}

function remove(collection, id) {
  const db = requireDatabase();
  db.prepare('DELETE FROM content_records WHERE collection = ? AND id = ?').run(collection, String(id));
}

function replaceCollection(collection, rows) {
  const db = requireDatabase();
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
  get,
  list,
  pruneBefore,
  remove,
  replaceCollection,
  stableId,
  update,
  upsert,
};

