#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const { openDatabase } = require('../../src/db/sqlite');

const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../outputs'));

function readJson(fileName, defaultValue = {}) {
  const filePath = path.join(outputDir, fileName);
  if (!fs.existsSync(filePath)) return defaultValue;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonlCount(fileName) {
  const filePath = path.join(outputDir, fileName);
  if (!fs.existsSync(filePath)) return 0;
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  return raw ? raw.split(/\r?\n/).filter(Boolean).length : 0;
}

function count(db, table, where = '', params = []) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get(params).c;
}

function assertAtLeast(results, label, actual, expected) {
  const ok = actual >= expected;
  results.push({ label, actual, expected, ok });
}

function main() {
  const db = openDatabase({ force: true });
  const results = [];

  const auth = readJson('auth_db.json');
  const project = readJson('project_db.json');
  const drama = readJson('drama_db.json');
  const workflow = readJson('workflow_db.json');
  const i2v = readJson('i2v_db.json');
  const avatar = readJson('avatar_db.json');
  const comic = readJson('comic_db.json');
  const novel = readJson('novel_db.json');
  const asset = readJson('asset_db.json');
  const portrait = readJson('portrait_db.json');
  const voice = readJson('voice_db.json');
  const kb = readJson('knowledge_base.json');
  const usage = readJson('token_usage.json');
  const settings = readJson('settings.json');

  assertAtLeast(results, 'users', count(db, 'users'), (auth.users || []).length);
  assertAtLeast(results, 'projects', count(db, 'projects'), (project.projects || []).length + (drama.drama_projects || []).length + (workflow.workflows || []).length);
  assertAtLeast(results, 'project_steps', count(db, 'project_steps'), (project.stories || []).length);
  assertAtLeast(results, 'generation_tasks', count(db, 'generation_tasks'), (drama.drama_episodes || []).length + (i2v.i2v_tasks || []).length + (avatar.avatar_tasks || []).length + (comic.comic_tasks || []).length + (novel.novels || []).length);
  assertAtLeast(results, 'assets', count(db, 'assets'), (asset.assets || []).length + (portrait.portraits || []).length);
  assertAtLeast(results, 'voices', count(db, 'voices'), (voice.voices || []).length);
  assertAtLeast(results, 'knowledge_documents', count(db, 'knowledge_documents'), (kb.documents || []).length);
  assertAtLeast(results, 'usage_records', count(db, 'usage_records'), (usage.calls || []).length + readJsonlCount('usage_log.jsonl'));
  assertAtLeast(results, 'model_providers', count(db, 'model_providers'), (settings.providers || []).length);
  assertAtLeast(results, 'provider_models', count(db, 'provider_models'), (settings.providers || []).reduce((sum, provider) => sum + (provider.models || []).length, 0));
  assertAtLeast(results, 'content_records.projects', count(db, 'content_records', 'WHERE collection = ?', ['projects']), (project.projects || []).length);
  assertAtLeast(results, 'content_records.tasks', count(db, 'content_records', "WHERE collection IN ('i2v_tasks','avatar_tasks','comic_tasks','novels','drama_episodes')"), (drama.drama_episodes || []).length + (i2v.i2v_tasks || []).length + (avatar.avatar_tasks || []).length + (comic.comic_tasks || []).length + (novel.novels || []).length);
  assertAtLeast(results, 'content_records.workflows', count(db, 'content_records', 'WHERE collection = ?', ['workflows']), (workflow.workflows || []).length);
  assertAtLeast(results, 'content_records.usage_log', count(db, 'content_records', 'WHERE collection = ?', ['usage_log']), readJsonlCount('usage_log.jsonl'));
  assertAtLeast(results, 'app_kv.settings.full', count(db, 'app_kv', 'WHERE key = ?', ['settings.full']), settings.providers ? 1 : 0);
  assertAtLeast(results, 'app_kv.pipeline_model_config.full', count(db, 'app_kv', 'WHERE key = ?', ['pipeline_model_config.full']), readJson('pipeline_model_config.json').stages ? 1 : 0);
  assertAtLeast(results, 'app_kv.auth.full', count(db, 'app_kv', 'WHERE key = ?', ['auth.full']), auth.users ? 1 : 0);

  const failed = results.filter(row => !row.ok);
  for (const row of results) {
    console.log(`${row.ok ? 'OK' : 'FAIL'} ${row.label}: db=${row.actual} expected>=${row.expected}`);
  }
  if (failed.length) {
    process.exitCode = 1;
    console.error(`Verification failed: ${failed.map(row => row.label).join(', ')}`);
  }
}

main();
