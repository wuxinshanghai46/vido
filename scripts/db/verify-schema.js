#!/usr/bin/env node
const { openDatabase } = require('../../src/db/sqlite');

const REQUIRED_TABLES = [
  'schema_migrations',
  'app_kv',
  'users',
  'user_sessions',
  'projects',
  'project_steps',
  'project_versions',
  'generation_tasks',
  'task_events',
  'artifacts',
  'luxury_ad_projects',
  'luxury_ad_briefs',
  'luxury_ad_characters',
  'luxury_ad_scenes',
  'luxury_ad_script_segments',
  'luxury_ad_keyframes',
  'luxury_ad_videos',
  'assets',
  'actor_assets',
  'voices',
  'model_providers',
  'provider_models',
  'pipeline_routes',
  'knowledge_collections',
  'knowledge_documents',
  'knowledge_chunks',
  'usage_records',
  'audit_logs',
  'content_records',
];

function main() {
  const db = openDatabase({ force: true });
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const existing = new Set(rows.map(row => row.name));
  const missing = REQUIRED_TABLES.filter(table => !existing.has(table));
  if (missing.length) {
    console.error(`Missing tables: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const migrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  console.log(`Schema OK. tables=${REQUIRED_TABLES.length} migrations=${migrations.map(row => row.version).join(',')}`);
}

main();
