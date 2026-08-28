#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pipeline = require('../src/services/pipelineModelService');
const { loadSettings } = require('../src/services/settingsService');

const MIGRATION_ID = 'story-ad-consistency-vision-routing-v240';
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.resolve(__dirname, '../outputs'));
const BACKUP_PATH = path.join(OUTPUT_DIR, `${MIGRATION_ID}-backup.json`);
const STAGES = Object.freeze([
  'new_story_ad.person_consistency_qa',
  'new_story_ad.person_dossier_qa',
  'new_story_ad.product_consistency_qa',
  'new_story_ad.scene_vision',
  'new_story_ad.scene_consistency_qa',
  'new_story_ad.scene_panorama_qa',
  'new_story_ad.scene_spatial_qa',
  'new_story_ad.person_keyframe_qa',
  'new_story_ad.pet_consistency_qa',
  'new_story_ad.product_keyframe_qa',
  'new_story_ad.scene_camera_qa',
  'new_story_ad.video_frame_qa',
  'new_story_ad.cross_shot_visual_qa',
]);
const DESIRED = Object.freeze([
  { provider_id: 'smscrw', model_id: 'claude-sonnet-4-6', enabled: true },
  { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6', enabled: true },
  { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash', enabled: true },
  { provider_id: 'zhipu', model_id: 'glm-4.6v-flash', enabled: true },
]);

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function configuredRoute(settings = loadSettings()) {
  const providers = new Map();
  for (const provider of settings.providers || []) {
    for (const key of [provider?.id, provider?.preset].filter(Boolean)) providers.set(String(key), provider);
  }
  return DESIRED.filter(candidate => {
    const provider = providers.get(candidate.provider_id);
    if (!provider || provider.enabled === false || !String(provider.api_key || '').trim()) return false;
    return (provider.models || []).some(model => String(model.id || '') === candidate.model_id && model.enabled !== false);
  }).map((candidate, index) => ({ ...candidate, priority: index + 1 }));
}

function apply({ write = false } = {}) {
  const route = configuredRoute();
  if (route.length !== DESIRED.length) {
    throw new Error(`${MIGRATION_ID}: SZZNAI、漫路、微众或智谱候选未完整配置，拒绝形成虚假后备顺序`);
  }
  const config = pipeline.loadConfig();
  const before = Object.fromEntries(STAGES.map(stage => [stage, config.stages?.[stage] || []]));
  const changedStages = STAGES.filter(stage => hash(before[stage]) !== hash(route));
  if (write && changedStages.length) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(BACKUP_PATH, JSON.stringify({ migration_id: MIGRATION_ID, stages: before }, null, 2));
    pipeline.saveConfig({
      ...config,
      stages: {
        ...(config.stages || {}),
        ...Object.fromEntries(STAGES.map(stage => [stage, route])),
      },
    });
    const persisted = pipeline.loadConfig();
    if (STAGES.some(stage => hash(persisted.stages?.[stage] || []) !== hash(route))) {
      throw new Error(`${MIGRATION_ID}: 路由写入后读回校验失败`);
    }
  }
  return {
    migration_id: MIGRATION_ID,
    applied: write && changedStages.length > 0,
    changed_stage_count: changedStages.length,
    stage_count: STAGES.length,
    route: route.map(item => `${item.provider_id}/${item.model_id}`),
  };
}

function rollback() {
  if (!fs.existsSync(BACKUP_PATH)) return { migration_id: MIGRATION_ID, rolled_back: false, reason: 'backup_not_found' };
  const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
  if (backup.migration_id !== MIGRATION_ID || !backup.stages || typeof backup.stages !== 'object') {
    throw new Error(`${MIGRATION_ID}: 备份无效，拒绝回滚`);
  }
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

module.exports = { MIGRATION_ID, STAGES, DESIRED, configuredRoute, apply, rollback, commit, hash };
