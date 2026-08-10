#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadSettings } = require('../src/services/settingsService');
const pipeline = require('../src/services/pipelineModelService');

const STAGE = 'new_story_ad.assist';
const MIGRATION_ID = 'new-story-ad-assist-provider-resilience-v127';
const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? path.resolve(process.env.OUTPUT_DIR)
  : path.join(__dirname, '../outputs');
const BACKUP_PATH = path.join(OUTPUT_DIR, `${MIGRATION_ID}-backup.json`);
const DESIRED = [
  { provider_id: 'apismile', model_id: 'gpt-5.5', enabled: true },
  { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', enabled: true },
  { provider_id: 'apismile', model_id: 'gemini-2.5-pro', enabled: true },
  { provider_id: 'deyunai', model_id: 'gpt-4o', enabled: true },
  { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', enabled: true },
];

function routeHash(route = []) {
  return crypto.createHash('sha256').update(JSON.stringify(route)).digest('hex');
}

function configuredRoute() {
  const settings = loadSettings();
  const providers = new Map((settings.providers || []).map(provider => [String(provider.id), provider]));
  return DESIRED.filter(candidate => {
    const provider = providers.get(candidate.provider_id);
    if (!provider || provider.enabled === false || !String(provider.api_key || '').trim()) return false;
    return (provider.models || []).some(model => String(model.id) === candidate.model_id && model.enabled !== false);
  });
}

function normalizedRoute(route = []) {
  return route.map((item, index) => ({
    provider_id: String(item.provider_id),
    model_id: String(item.model_id),
    enabled: item.enabled !== false,
    priority: index + 1,
  }));
}

function applyMigration({ dryRun = true } = {}) {
  const desired = normalizedRoute(configuredRoute());
  const providerCount = new Set(desired.map(item => item.provider_id)).size;
  if (providerCount < 2) {
    throw new Error(`${MIGRATION_ID}: 至少需要两个已配置文本模型提供商，当前只有 ${providerCount} 个`);
  }
  const config = pipeline.loadConfig();
  const before = Array.isArray(config.stages?.[STAGE]) ? config.stages[STAGE] : [];
  const beforeHash = routeHash(before);
  const desiredHash = routeHash(desired);
  if (!dryRun && beforeHash !== desiredHash) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(BACKUP_PATH, JSON.stringify({
      migration_id: MIGRATION_ID,
      stage: STAGE,
      route: before,
      route_hash: beforeHash,
      created_at: new Date().toISOString(),
    }, null, 2));
    config.stages = config.stages || {};
    config.stages[STAGE] = desired;
    pipeline.saveConfig(config);
    const persisted = pipeline.loadConfig();
    const persistedRoute = Array.isArray(persisted.stages?.[STAGE]) ? persisted.stages[STAGE] : [];
    if (routeHash(persistedRoute) !== desiredHash) {
      throw new Error(`${MIGRATION_ID}: 路由写入后读回校验失败`);
    }
  }
  return {
    migration_id: MIGRATION_ID,
    stage: STAGE,
    dry_run: dryRun,
    changed: beforeHash !== desiredHash,
    before_hash: beforeHash,
    after_hash: desiredHash,
    provider_count: providerCount,
    route: desired.map(item => `${item.provider_id}/${item.model_id}`),
  };
}

function commit() {
  const removedBackup = fs.existsSync(BACKUP_PATH);
  if (removedBackup) fs.unlinkSync(BACKUP_PATH);
  return { migration_id: MIGRATION_ID, stage: STAGE, committed: true, removed_backup: removedBackup };
}

function rollback() {
  if (!fs.existsSync(BACKUP_PATH)) {
    return { migration_id: MIGRATION_ID, stage: STAGE, rolled_back: false, reason: 'backup_not_found' };
  }
  const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
  if (backup.migration_id !== MIGRATION_ID || backup.stage !== STAGE || !Array.isArray(backup.route)) {
    throw new Error(`${MIGRATION_ID}: 备份文件无效，拒绝回滚`);
  }
  const config = pipeline.loadConfig();
  config.stages = config.stages || {};
  config.stages[STAGE] = backup.route;
  pipeline.saveConfig(config);
  fs.unlinkSync(BACKUP_PATH);
  return {
    migration_id: MIGRATION_ID,
    stage: STAGE,
    rolled_back: true,
    restored_hash: routeHash(backup.route),
  };
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const result = args.has('--rollback')
    ? rollback()
    : args.has('--commit')
      ? commit()
    : applyMigration({ dryRun: !args.has('--apply') });
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { STAGE, MIGRATION_ID, DESIRED, configuredRoute, normalizedRoute, applyMigration, rollback, commit, routeHash };
