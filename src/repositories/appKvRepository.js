const { jsonParse, jsonStringify, nowIso, requireDatabase } = require('./baseRepository');

function set(key, value) {
  const db = requireDatabase();
  const row = { key, value_json: jsonStringify(value), updated_at: nowIso() };
  if (typeof db.upsertMany === 'function') {
    db.upsertMany('app_kv', ['key', 'value_json', 'updated_at'], ['key'], [[row.key, row.value_json, row.updated_at]]);
    return value;
  }
  db.prepare(`
    INSERT INTO app_kv (key, value_json, updated_at)
    VALUES (@key, @value_json, @updated_at)
    ON CONFLICT(key) DO UPDATE SET
      value_json=excluded.value_json,
      updated_at=excluded.updated_at
  `).run(row);
  return value;
}

function get(key, fallback = null) {
  const db = requireDatabase();
  const row = db.prepare('SELECT value_json FROM app_kv WHERE key = ?').get(key);
  return row ? jsonParse(row.value_json, fallback) : fallback;
}

module.exports = { get, set };

