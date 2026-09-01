#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const settingsService = require('../src/services/settingsService');
const pipeline = require('../src/services/pipelineModelService');

const MIGRATION_ID = 'story-ad-szznai-seedance-v368';
const PROVIDER_ID = 'smscrw';
const VIDEO_STAGE = 'new_story_ad.video';
const VIDEO_MODEL = 'doubao-seedance-2.0';
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.resolve(__dirname, '../outputs'));
const BACKUP_PATH = path.join(OUTPUT_DIR, `${MIGRATION_ID}-backup.json`);

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isSmscrw(item = {}) {
  return String(item.provider_id || item.id || item.preset || '').trim().toLowerCase() === PROVIDER_ID;
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

function desiredProvider(current = {}) {
  const preset = settingsService.PROVIDER_PRESETS[PROVIDER_ID];
  const defaults = settingsService.PROVIDER_ADAPTER_DEFAULTS[PROVIDER_ID];
  const currentModels = Array.isArray(current.models) ? current.models : [];
  const exact = preset.defaultModels.find(model => model.id === VIDEO_MODEL);
  const models = currentModels
    .filter(model => model?.id !== VIDEO_MODEL)
    .map(model => ({ ...model, enabled: false }));
  models.push({ ...exact, enabled: true });
  return {
    ...current,
    id: current.id || PROVIDER_ID,
    preset: current.preset || PROVIDER_ID,
    name: preset.name,
    api_url: current.api_url || preset.api_url,
    enabled: true,
    adapter: defaults.adapter,
    adapter_config: {
      ...(current.adapter_config || {}),
      ...defaults.adapter_config,
      chat: { ...(current.adapter_config?.chat || {}), ...defaults.adapter_config.chat },
      image: { ...(current.adapter_config?.image || {}), ...defaults.adapter_config.image },
      video: { ...(current.adapter_config?.video || {}), ...defaults.adapter_config.video },
    },
    models,
  };
}

function desiredStages(config = {}) {
  const stageIds = new Set([...Object.keys(config.stages || {}), VIDEO_STAGE]);
  const stages = {};
  for (const stageId of stageIds) {
    const previous = Array.isArray(config.stages?.[stageId]) ? config.stages[stageId] : pipeline.getStageDefaults(stageId);
    const withoutSmscrw = previous.filter(route => !isSmscrw(route));
    const next = stageId === VIDEO_STAGE
      ? [{ provider_id: PROVIDER_ID, model_id: VIDEO_MODEL, enabled: true }, ...withoutSmscrw]
      : withoutSmscrw;
    stages[stageId] = next.map((route, index) => ({ ...route, priority: index + 1 }));
  }
  return stages;
}

function apply({ write = false } = {}) {
  const settings = settingsService.loadSettings();
  const index = (settings.providers || []).findIndex(isSmscrw);
  if (index < 0) throw new Error(`${MIGRATION_ID}: 未找到已配置的 SZ 供应商`);
  if (!String(settings.providers[index].api_key || '').trim()) throw new Error(`${MIGRATION_ID}: SZ 企业令牌未配置`);
  const currentProvider = settings.providers[index];
  const nextProvider = desiredProvider(currentProvider);
  const config = pipeline.loadConfig();
  const nextStages = desiredStages(config);
  const providerChanged = hash(providerSnapshot(currentProvider)) !== hash(providerSnapshot(nextProvider));
  const changedStages = Object.keys(nextStages).filter(stageId => hash(config.stages?.[stageId] || []) !== hash(nextStages[stageId]));

  if (write && (providerChanged || changedStages.length)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(BACKUP_PATH, JSON.stringify({
      migration_id: MIGRATION_ID,
      provider: providerSnapshot(currentProvider),
      stages: Object.fromEntries(changedStages.map(stageId => [stageId, config.stages?.[stageId] || []])),
      created_at: new Date().toISOString(),
    }, null, 2));
    settings.providers[index] = nextProvider;
    settingsService.saveSettings(settings);
    pipeline.saveConfig({ ...config, stages: { ...(config.stages || {}), ...nextStages } });
    const persistedProvider = settingsService.loadSettings().providers.find(isSmscrw);
    const persistedConfig = pipeline.loadConfig();
    if (hash(providerSnapshot(persistedProvider)) !== hash(providerSnapshot(nextProvider))) throw new Error(`${MIGRATION_ID}: 供应商配置写入后读回不一致`);
    if (Object.keys(nextStages).some(stageId => hash(persistedConfig.stages?.[stageId] || []) !== hash(nextStages[stageId]))) throw new Error(`${MIGRATION_ID}: 视频路由写入后读回不一致`);
  }

  const smscrwRoutes = Object.entries(nextStages).flatMap(([stageId, routes]) => routes
    .filter(isSmscrw).map(route => ({ stage_id: stageId, model_id: route.model_id })));
  return {
    migration_id: MIGRATION_ID,
    applied: write && (providerChanged || changedStages.length > 0),
    provider_changed: providerChanged,
    changed_stage_count: changedStages.length,
    enabled_smscrw_models: nextProvider.models.filter(model => model.enabled !== false).map(model => model.id),
    smscrw_routes: smscrwRoutes,
    non_video_smscrw_routes: smscrwRoutes.filter(route => route.stage_id !== VIDEO_STAGE).length,
  };
}

function commit() {
  const removedBackup = fs.existsSync(BACKUP_PATH);
  if (removedBackup) fs.unlinkSync(BACKUP_PATH);
  return { migration_id: MIGRATION_ID, committed: true, removed_backup: removedBackup };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const result = args.has('--commit') ? commit() : apply({ write: args.has('--apply') });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ success: false, code: error.code || 'SZZNAI_SEEDANCE_MIGRATION_FAILED', error: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { MIGRATION_ID, PROVIDER_ID, VIDEO_STAGE, VIDEO_MODEL, BACKUP_PATH, hash, isSmscrw, providerSnapshot, desiredProvider, desiredStages, apply, commit, main };
