#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const settingsService = require('../src/services/settingsService');
const pipeline = require('../src/services/pipelineModelService');

const MIGRATION_ID = 'story-ad-szznai-routing-v243';
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.resolve(__dirname, '../outputs'));
const BACKUP_PATH = path.join(OUTPUT_DIR, `${MIGRATION_ID}-backup.json`);
const PROVIDER_ID = 'smscrw';
const PRIMARY_BY_TYPE = Object.freeze({
  story: { provider_id: PROVIDER_ID, model_id: 'claude-sonnet-4-6', enabled: true },
  vlm: { provider_id: PROVIDER_ID, model_id: 'claude-sonnet-4-6', enabled: true },
  image: { provider_id: PROVIDER_ID, model_id: 'gpt-image-2', enabled: true },
});
const VIDEO_PRIMARY = Object.freeze({ provider_id: PROVIDER_ID, model_id: 'doubao-seedance-2-0-260128', enabled: true });
const VIDEO_STAGES = new Set(['new_story_ad.video', 'new_story_ad.sound_generation']);

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function targetStages() {
  return Object.keys(pipeline.STAGE_DEFAULTS).filter(stageId => {
    if (!stageId.startsWith('new_story_ad.')) return false;
    if (VIDEO_STAGES.has(stageId)) return true;
    const type = String(pipeline.getStageMeta(stageId)?.type || '').toLowerCase();
    if (!PRIMARY_BY_TYPE[type]) return false;
    return pipeline.getStageDefaults(stageId).length > 0;
  });
}

function normalizedRoute(primary, previous = [], fallback = []) {
  const seed = Array.isArray(previous) && previous.length ? previous : fallback;
  const seen = new Set();
  return [primary, ...seed].filter(item => item?.provider_id && item?.model_id).filter(item => {
    const key = `${String(item.provider_id).toLowerCase()}/${String(item.model_id).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((item, index) => ({ ...item, priority: index + 1, enabled: item.enabled !== false }));
}

function desiredProvider(current = {}) {
  const preset = settingsService.PROVIDER_PRESETS[PROVIDER_ID];
  const adapter = settingsService.PROVIDER_ADAPTER_DEFAULTS[PROVIDER_ID];
  return {
    ...current,
    id: current.id || PROVIDER_ID,
    preset: current.preset || PROVIDER_ID,
    name: preset.name,
    api_url: preset.api_url,
    enabled: true,
    adapter: adapter.adapter,
    adapter_config: adapter.adapter_config,
    models: preset.defaultModels.map(model => ({ ...model, enabled: true })),
  };
}

function providerSnapshot(provider = {}) {
  return {
    id: provider.id,
    preset: provider.preset,
    name: provider.name,
    api_url: provider.api_url,
    enabled: provider.enabled,
    adapter: provider.adapter,
    adapter_config: provider.adapter_config,
    models: provider.models,
  };
}

function apply({ write = false } = {}) {
  const settings = settingsService.loadSettings();
  const index = (settings.providers || []).findIndex(provider => [provider?.id, provider?.preset]
    .filter(Boolean).some(value => String(value).toLowerCase() === PROVIDER_ID));
  if (index < 0) throw new Error(`${MIGRATION_ID}: 未找到已配置的 SZZNAI（smscrw）供应商`);
  const currentProvider = settings.providers[index];
  if (!String(currentProvider.api_key || '').trim()) throw new Error(`${MIGRATION_ID}: SZZNAI API Key 未配置`);
  const nextProvider = desiredProvider(currentProvider);

  const config = pipeline.loadConfig();
  const stages = targetStages();
  const beforeStages = Object.fromEntries(stages.map(stageId => [stageId, config.stages?.[stageId] || []]));
  const afterStages = {};
  for (const stageId of stages) {
    const type = String(pipeline.getStageMeta(stageId)?.type || '').toLowerCase();
    const primary = VIDEO_STAGES.has(stageId) ? VIDEO_PRIMARY : PRIMARY_BY_TYPE[type];
    afterStages[stageId] = normalizedRoute(primary, beforeStages[stageId], pipeline.getStageDefaults(stageId));
  }
  const providerChanged = hash(providerSnapshot(currentProvider)) !== hash(providerSnapshot(nextProvider));
  const changedStages = stages.filter(stageId => hash(beforeStages[stageId]) !== hash(afterStages[stageId]));

  if (write && (providerChanged || changedStages.length)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(BACKUP_PATH, JSON.stringify({
      migration_id: MIGRATION_ID,
      provider: providerSnapshot(currentProvider),
      stages: beforeStages,
      created_at: new Date().toISOString(),
    }, null, 2));
    settings.providers[index] = nextProvider;
    settingsService.saveSettings(settings);
    pipeline.saveConfig({ ...config, stages: { ...(config.stages || {}), ...afterStages } });

    const persistedSettings = settingsService.loadSettings();
    const persistedProvider = (persistedSettings.providers || []).find(provider => provider.id === currentProvider.id);
    const persistedConfig = pipeline.loadConfig();
    if (hash(providerSnapshot(persistedProvider)) !== hash(providerSnapshot(nextProvider))) {
      throw new Error(`${MIGRATION_ID}: 供应商目录写入后读回校验失败`);
    }
    if (stages.some(stageId => hash(persistedConfig.stages?.[stageId] || []) !== hash(afterStages[stageId]))) {
      throw new Error(`${MIGRATION_ID}: 模型路由写入后读回校验失败`);
    }
  }

  return {
    migration_id: MIGRATION_ID,
    applied: write && (providerChanged || changedStages.length > 0),
    provider_changed: providerChanged,
    model_count: nextProvider.models.length,
    changed_stage_count: changedStages.length,
    stage_count: stages.length,
    first_routes: Object.fromEntries(stages.map(stageId => [stageId, `${afterStages[stageId][0].provider_id}/${afterStages[stageId][0].model_id}`])),
  };
}

function rollback() {
  if (!fs.existsSync(BACKUP_PATH)) return { migration_id: MIGRATION_ID, rolled_back: false, reason: 'backup_not_found' };
  const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
  if (backup.migration_id !== MIGRATION_ID || !backup.provider || !backup.stages) throw new Error(`${MIGRATION_ID}: 备份无效，拒绝回滚`);
  const settings = settingsService.loadSettings();
  const index = (settings.providers || []).findIndex(provider => provider?.id === backup.provider.id);
  if (index < 0) throw new Error(`${MIGRATION_ID}: 回滚目标供应商不存在`);
  settings.providers[index] = { ...settings.providers[index], ...backup.provider, api_key: settings.providers[index].api_key };
  settingsService.saveSettings(settings);
  const config = pipeline.loadConfig();
  pipeline.saveConfig({ ...config, stages: { ...(config.stages || {}), ...backup.stages } });
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

module.exports = { MIGRATION_ID, PROVIDER_ID, PRIMARY_BY_TYPE, VIDEO_PRIMARY, VIDEO_STAGES, targetStages, normalizedRoute, desiredProvider, providerSnapshot, apply, rollback, commit, hash };
