const { openDatabase } = require('../db/sqlite');

function nowIso() {
  return new Date().toISOString();
}

function jsonStringify(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

function jsonParse(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON payload from database: ${error.message}`);
  }
}

function requireDatabase() {
  const db = openDatabase();
  if (!db) {
    throw new Error('SQLite is disabled. Set DB_ENABLED=true before using repositories.');
  }
  return db;
}

function runTransaction(fn) {
  const db = requireDatabase();
  return db.transaction(() => fn(db))();
}

module.exports = {
  jsonParse,
  jsonStringify,
  nowIso,
  requireDatabase,
  runTransaction,
};

