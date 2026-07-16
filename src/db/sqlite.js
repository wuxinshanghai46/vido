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

function getNativeSqliteDriver() {
  if (cachedDriver !== null) return cachedDriver;
  if (String(process.env.SQLITE_DRIVER || '').trim().toLowerCase() === 'python') {
    cachedDriver = false;
    return cachedDriver;
  }
  try {
    cachedDriver = { kind: 'better-sqlite3', Database: require('better-sqlite3') };
    return cachedDriver;
  } catch {}
  try {
    const { DatabaseSync } = require('node:sqlite');
    cachedDriver = { kind: 'node:sqlite', Database: DatabaseSync };
    return cachedDriver;
  } catch {}
  cachedDriver = false;
  return cachedDriver;
}

class NodeSqliteDatabase {
  constructor(dbPath, DatabaseSync) {
    this.path = dbPath;
    this.raw = new DatabaseSync(dbPath);
  }

  pragma(sql) {
    this.raw.exec(`PRAGMA ${sql};`);
  }

  exec(sql) {
    return this.raw.exec(sql);
  }

  prepare(sql) {
    return this.raw.prepare(sql);
  }

  transaction(fn) {
    return (...args) => {
      this.raw.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        this.raw.exec('COMMIT');
        return result;
      } catch (error) {
        try { this.raw.exec('ROLLBACK'); } catch {}
        throw error;
      }
    };
  }

  upsertMany(table, columns, _conflictColumns, rows) {
    const placeholders = columns.map(() => '?').join(', ');
    const statement = this.raw.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);
    return this.transaction(() => {
      let changes = 0;
      for (const row of rows) changes += Number(statement.run(...row).changes || 0);
      return { changes };
    })();
  }

  batch(operations = []) {
    return this.transaction(() => {
      const results = operations.map(item => {
        const statement = this.raw.prepare(item.sql);
        const params = item.params || [];
        if (item.mode === 'get') return statement.get(...params);
        if (item.mode === 'all') return statement.all(...params);
        return statement.run(...params);
      });
      return { results };
    })();
  }

  close() {
    this.raw.close();
  }
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
        # Some atomic queue claims use UPDATE ... RETURNING through get().
        # Commit after consuming the returned row so the claim cannot be
        # silently rolled back and submitted to a paid provider twice.
        conn.commit()
        emit(dict(row) if row else None)
    elif op == "all":
        cur = conn.execute(sql, params)
        rows = cur.fetchall()
        conn.commit()
        emit([dict(row) for row in rows])
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
    elif op == "batch":
        operations = req.get("operations") or []
        before = conn.total_changes
        conn.execute("BEGIN IMMEDIATE")
        results = []
        try:
            for item in operations:
                cur = conn.execute(item.get("sql") or "", item.get("params") or [])
                mode = item.get("mode") or "run"
                if mode == "get":
                    row = cur.fetchone()
                    results.append(dict(row) if row else None)
                elif mode == "all":
                    results.append([dict(row) for row in cur.fetchall()])
                else:
                    results.append({"changes": cur.rowcount, "lastInsertRowid": cur.lastrowid})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        emit({"changes": conn.total_changes - before, "results": results})
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

  batch(operations = []) {
    return runPythonSqlite(this.path, 'batch', '', [], { operations });
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
  const driver = getNativeSqliteDriver();
  let db;
  if (driver?.kind === 'better-sqlite3') db = new driver.Database(config.path);
  else if (driver?.kind === 'node:sqlite') db = new NodeSqliteDatabase(config.path, driver.Database);
  else db = new PythonSqliteDatabase(config.path);
  if (driver) configureDatabase(db);
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

function executeBatch(operations = [], options = {}) {
  const db = openDatabase(options);
  if (!db) throw new Error('SQLite is disabled');
  if (typeof db.batch === 'function') return db.batch(operations);
  const apply = db.transaction(() => operations.map(item => {
    const stmt = db.prepare(item.sql);
    if (item.mode === 'get') return stmt.get(...(item.params || []));
    if (item.mode === 'all') return stmt.all(...(item.params || []));
    return stmt.run(...(item.params || []));
  }));
  return { results: apply() };
}

module.exports = {
  closeDatabase,
  executeBatch,
  envBool,
  getDbConfig,
  healthCheck,
  openDatabase,
};
