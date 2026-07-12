const fs = require('fs');
const path = require('path');

require('dotenv').config();

const sqlite = require('../src/db/sqlite');
const appKv = require('../src/repositories/appKvRepository');
const contentRecords = require('../src/repositories/contentRecordRepository');

const outputRoot = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../outputs'));

function readJson(name, fallback = null) {
  const file = path.join(outputRoot, name);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function upsert(collection, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length) contentRecords.upsertMany(collection, list);
  return { source: list.length, database: contentRecords.list(collection).length };
}

function main() {
  const config = sqlite.getDbConfig();
  if (!config.enabled) throw new Error('生产 SQLite 未启用，停止恢复');
  const db = sqlite.openDatabase();
  const integrity = db.prepare('PRAGMA integrity_check').get();
  const integrityValue = integrity?.integrity_check || integrity?.['integrity_check'] || Object.values(integrity || {})[0];
  if (integrityValue !== 'ok') throw new Error(`SQLite 完整性检查失败: ${integrityValue || 'unknown'}`);

  const auth = readJson('auth_db.json');
  const settings = readJson('settings.json');
  const pipeline = readJson('pipeline_model_config.json');
  if (auth?.users?.length) appKv.set('auth.full', auth);
  if (settings && typeof settings === 'object') appKv.set('settings.full', settings);
  if (pipeline && typeof pipeline === 'object') appKv.set('pipeline_model_config.full', pipeline);

  const story = readJson('new_story_ad_db.json', {});
  const storyMap = {
    tasks: 'new_story_ad_tasks',
    assets: 'new_story_ad_assets',
    stages: 'new_story_ad_stages',
    outputs: 'new_story_ad_outputs',
    model_calls: 'new_story_ad_model_calls',
    reviews: 'new_story_ad_reviews',
  };
  const restored = {};
  Object.entries(storyMap).forEach(([key, collection]) => {
    restored[collection] = upsert(collection, story[key]);
  });

  const luxury = readJson('luxury_ad_projects.json', {});
  restored.luxury_ad_projects = upsert('luxury_ad_projects', luxury.projects);
  const workflows = readJson('workflow_db.json', {});
  restored.workflows = upsert('workflows', workflows.workflows);
  const archives = readJson('platform_task_archives.json', {});
  if (Array.isArray(archives.tasks) && archives.tasks.length) restored.platform_task_archives = upsert('platform_task_archives', archives.tasks);
  const actors = readJson('platform_actor_assets.json', {});
  const actorRows = Array.isArray(actors) ? actors : (actors.assets || actors.actors || []);
  if (actorRows.length) restored.platform_actor_assets = upsert('platform_actor_assets', actorRows);

  console.log(JSON.stringify({
    integrity: integrityValue,
    db_path: config.path,
    auth_users: auth?.users?.length || 0,
    app_kv_restored: ['auth.full', 'settings.full', 'pipeline_model_config.full'],
    collections: restored,
  }, null, 2));
}

main();
