import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { initSchema } from "./schema.js";
import { runMigrations } from "./migrations.js";

let _db: Database.Database | null = null;

export function initDb(dbPath: string): Database.Database {
  const fullPath = resolve(dbPath);
  mkdirSync(dirname(fullPath), { recursive: true });

  _db = new Database(fullPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("foreign_keys = ON");

  initSchema(_db);
  runMigrations(_db);
  return _db;
}

export function getDb(): Database.Database {
  if (!_db) throw new Error("Database not initialized");
  return _db;
}
