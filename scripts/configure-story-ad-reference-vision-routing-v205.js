#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pipeline = require('../src/services/pipelineModelService');
const { loadSettings } = require('../src/services/settingsService');

const STAGE = 'new_story_ad.reference_video_vision';
const MIGRATION_ID = 'story-ad-reference-vision-resilience-v205';
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.resolve(__dirname, '../outputs'));
const BACKUP_PATH = path.join(OUTPUT_DIR, `${MIGRATION_ID}-backup.json`);
const DESIRED = Object.freeze([
  { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', enabled: true },
  { provider_id: 'zhipu', model_id: 'glm-4.6v-flash', enabled: true },
  { provider_id: 'apismile', model_id: 'gemini-2.5-pro', enabled: true },
  { provider_id: 'apismile', model_id: 'gemini-2.5-flash', enabled: true },
  { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash', enabled: true },
]);

function routeHash(route = []) {
  return crypto.createHash('sha256').update(JSON.stringify(route)).digest('hex');
}

function providerIndex(settings = loadSettings()) {
  const index = new Map();
  for (const provider of settings.providers || []) {
    for (const key of [provider?.id, provider?.preset].filter(Boolean)) index.set(String(key), provider);
  }
  return index;
}

function configuredRoute(settings = loadSettings()) {
  const providers = providerIndex(settings);
  return DESIRED.filter(candidate => {
    const provider = providers.get(candidate.provider_id);
    if (!provider || provider.enabled === false || !String(provider.api_key || '').trim()) return false;
    return (provider.models || []).some(model => (
      String(model.id || '') === candidate.model_id && model.enabled !== false
    ));
  }).map((candidate, index) => ({ ...candidate, priority: index + 1 }));
}

function apply({ write = false } = {}) {
  const desired = configuredRoute();
  if (new Set(desired.map(item => item.provider_id)).size < 2) {
    throw new Error(`${MIGRATION_ID}: 至少需要两个已配置的独立视觉供应商`);
  }
  const config = pipeline.loadConfig();
  const before = Array.isArray(config.stages?.[STAGE]) ? config.stages[STAGE] : [];
  const changed = routeHash(before) !== routeHash(desired);
  if (write && changed) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(BACKUP_PATH, JSON.stringify({ migration_id: MIGRATION_ID, stage: STAGE, route: before }, null, 2));
    pipeline.saveConfig({ ...config, stages: { ...(config.stages || {}), [STAGE]: desired } });
    if (routeHash(pipeline.loadConfig().stages?.[STAGE] || []) !== routeHash(desired)) {
      throw new Error(`${MIGRATION_ID}: 路由写入后读回校验失败`);
    }
  }
  return {
    migration_id: MIGRATION_ID,
    stage: STAGE,
    applied: write && changed,
    changed,
    provider_count: new Set(desired.map(item => item.provider_id)).size,
    route: desired.map(item => `${item.provider_id}/${item.model_id}`),
  };
}

function rollback() {
  if (!fs.existsSync(BACKUP_PATH)) return { migration_id: MIGRATION_ID, rolled_back: false, reason: 'backup_not_found' };
  const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
  if (backup.migration_id !== MIGRATION_ID || backup.stage !== STAGE || !Array.isArray(backup.route)) {
    throw new Error(`${MIGRATION_ID}: 备份无效，拒绝回滚`);
  }
  const config = pipeline.loadConfig();
  pipeline.saveConfig({ ...config, stages: { ...(config.stages || {}), [STAGE]: backup.route } });
  fs.unlinkSync(BACKUP_PATH);
  return { migration_id: MIGRATION_ID, rolled_back: true };
}

function commit() {
  const removedBackup = fs.existsSync(BACKUP_PATH);
  if (removedBackup) fs.unlinkSync(BACKUP_PATH);
  return { migration_id: MIGRATION_ID, committed: true, removed_backup: removedBackup };
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const result = args.has('--rollback') ? rollback() : args.has('--commit') ? commit() : apply({ write: args.has('--apply') });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { STAGE, MIGRATION_ID, DESIRED, configuredRoute, apply, rollback, commit, routeHash };
