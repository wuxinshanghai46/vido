const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config();

let cachedDb = null;
let cachedDriver = null;

function envBool(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function getDbConfig() {
  const outputDir = process.env.OUTPUT_DIR
    ? path.resolve(process.env.OUTPUT_DIR)
    : path.resolve(__dirname, '../../outputs');
  return {
    type: process.env.DB_TYPE || 'sqlite',
    enabled: envBool('DB_ENABLED', false),
    dualWrite: envBool('DB_DUAL_WRITE', false),
    readPrimary: envBool('DB_READ_PRIMARY', false),
    jsonFallback: envBool('DB_JSON_FALLBACK', true),
    path: path.resolve(process.env.DB_PATH || path.join(outputDir, 'vido-dev.sqlite')),
  };
}

function configureDatabase(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

function getBetterSqliteDriver() {
  if (cachedDriver !== null) return cachedDriver;
  try {
    cachedDriver = require('better-sqlite3');
  } catch {
    cachedDriver = false;
  }
  return cachedDriver;
}

function runPythonSqlite(dbPath, op, sql, params, extra = {}) {
  const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  const script = `
import base64, json, sqlite3, sys
raw = base64.b64decode(sys.stdin.read().encode("ascii")).decode("utf-8", "surrogatepass")
req = json.loads(raw)
def emit(value):
    sys.stdout.buffer.write(json.dumps(value, ensure_ascii=False).encode("utf-8", "surrogatepass"))
conn = sqlite3.connect(req["dbPath"])
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA journal_mode = WAL")
conn.execute("PRAGMA synchronous = NORMAL")
conn.execute("PRAGMA foreign_keys = ON")
conn.execute("PRAGMA busy_timeout = 5000")
try:
    op = req["op"]
    sql = req.get("sql") or ""
    params = req.get("params")
    if params is None:
        params = []
    if op == "exec":
        conn.executescript(sql)
        conn.commit()
        emit({"ok": True})
    elif op == "run":
        cur = conn.execute(sql, params)
        conn.commit()
        emit({"changes": conn.total_changes, "lastInsertRowid": cur.lastrowid})
    elif op == "get":
        cur = conn.execute(sql, params)
        row = cur.fetchone()
        emit(dict(row) if row else None)
    elif op == "all":
        cur = conn.execute(sql, params)
        emit([dict(row) for row in cur.fetchall()])
    elif op == "upsertMany":
        columns = req["columns"]
        conflict_columns = req["conflictColumns"]
        table = req["table"]
        rows = req["rows"]
        placeholders = ", ".join(["?"] * len(columns))
        stmt = "INSERT OR REPLACE INTO " + table + " (" + ", ".join(columns) + ") VALUES (" + placeholders + ")"
        conn.executemany(stmt, rows)
        conn.commit()
        emit({"changes": conn.total_changes})
    else:
        raise RuntimeError("Unsupported sqlite op: " + op)
finally:
    conn.close()
`;
  const child = spawnSync(python, ['-c', script], {
    input: Buffer.from(JSON.stringify({ dbPath, op, sql, params, ...extra }), 'utf8').toString('base64'),
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (child.status !== 0) {
    const detail = (child.stderr || child.stdout || '').trim();
    throw new Error(`sqlite python bridge failed: ${detail}`);
  }
  const output = (child.stdout || '').trim();
  return output ? JSON.parse(output) : null;
}

class PythonSqliteStatement {
  constructor(dbPath, sql) {
    this.dbPath = dbPath;
    this.sql = sql;
  }

  normalizeParams(args) {
    if (!args.length) return [];
    if (args.length === 1 && Array.isArray(args[0])) return args[0];
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) return args[0];
    return args;
  }

  run(...args) {
    return runPythonSqlite(this.dbPath, 'run', this.sql, this.normalizeParams(args));
  }

  get(...args) {
    return runPythonSqlite(this.dbPath, 'get', this.sql, this.normalizeParams(args));
  }

  all(...args) {
    return runPythonSqlite(this.dbPath, 'all', this.sql, this.normalizeParams(args));
  }
}

class PythonSqliteDatabase {
  constructor(dbPath) {
    this.path = dbPath;
  }

  pragma(sql) {
    return runPythonSqlite(this.path, 'exec', `PRAGMA ${sql};`, []);
  }

  exec(sql) {
    return runPythonSqlite(this.path, 'exec', sql, []);
  }

  prepare(sql) {
    return new PythonSqliteStatement(this.path, sql);
  }

  transaction(fn) {
    return (...args) => fn(...args);
  }

  upsertMany(table, columns, conflictColumns, rows) {
    return runPythonSqlite(this.path, 'upsertMany', '', [], {
      table,
      columns,
      conflictColumns,
      rows,
    });
  }

  close() {}
}

function openDatabase(options = {}) {
  const config = getDbConfig();
  if (config.type !== 'sqlite') {
    throw new Error(`Unsupported DB_TYPE: ${config.type}`);
  }
  if (!config.enabled && !options.force) return null;
  if (cachedDb && !options.fresh) return cachedDb;

  fs.mkdirSync(path.dirname(config.path), { recursive: true });
  const Database = getBetterSqliteDriver();
  const db = Database ? new Database(config.path) : new PythonSqliteDatabase(config.path);
  if (Database) configureDatabase(db);
  cachedDb = db;
  return db;
}

function closeDatabase() {
  if (!cachedDb) return;
  cachedDb.close();
  cachedDb = null;
}

function healthCheck() {
  const config = getDbConfig();
  if (!config.enabled) {
    return { enabled: false, status: 'disabled', path: config.path };
  }
  const db = openDatabase();
  const row = db.prepare('SELECT 1 AS ok').get();
  return { enabled: true, status: row?.ok === 1 ? 'ok' : 'unknown', path: config.path };
}

module.exports = {
  closeDatabase,
  envBool,
  getDbConfig,
  healthCheck,
  openDatabase,
};
