#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const { getDbConfig, openDatabase } = require('../../src/db/sqlite');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force');

const migrationsDir = path.resolve(__dirname, '../../src/db/migrations');
const files = fs.readdirSync(migrationsDir)
  .filter(file => /^\d+_.+\.sql$/.test(file))
  .sort();

function splitMigrationName(file) {
  const version = file.replace(/\.sql$/, '');
  const name = version.replace(/^\d+_/, '');
  return { version, name };
}

function main() {
  const config = getDbConfig();
  if (dryRun) {
    console.log(`SQLite path: ${config.path}`);
    console.log('Pending migrations are checked only when DB is enabled.');
    for (const file of files) console.log(`- ${file}`);
    return;
  }

  if (!config.enabled && !force) {
    console.log('DB_ENABLED is false. Set DB_ENABLED=true or pass --force to run migrations.');
    return;
  }

  const db = openDatabase({ force });
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all();
  const applied = new Set(appliedRows.map(row => row.version));
  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)'
  );

  for (const file of files) {
    const { version, name } = splitMigrationName(file);
    if (applied.has(version)) {
      console.log(`skip ${version}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      insertMigration.run(version, name, new Date().toISOString());
    });
    apply();
    console.log(`applied ${version}`);
  }
}

main();

