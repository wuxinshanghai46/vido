'use strict';

const settingsService = require('../src/services/settingsService');
const pipeline = require('../src/services/pipelineModelService');

const ROUTE = Object.freeze([
  { provider_id: 'smscrw', model_id: 'gpt-image-2', enabled: true },
  { provider_id: 'webang-maas', model_id: 'gpt-image-2', enabled: true },
  { provider_id: 'deyunai', model_id: 'gpt-image-2', enabled: true },
]);
const MANAGED_STAGES = Object.freeze([...pipeline.NEW_STORY_AD_IMAGE_STAGE_IDS]
  .filter(stage => stage !== 'new_story_ad.scene_panorama'));

function providerReadiness(settings, providerId) {
  const provider = (settings.providers || []).find(item => item && (item.id === providerId || item.preset === providerId));
  const model = (provider?.models || []).find(item => item && item.id === 'gpt-image-2');
  return {
    provider_id: providerId,
    provider_present: Boolean(provider),
    provider_enabled: provider?.enabled !== false,
    api_key_present: Boolean(String(provider?.api_key || '').trim()),
    model_present: Boolean(model),
    model_enabled: model?.enabled !== false,
  };
}

function assertReady(settings) {
  const readiness = ROUTE.map(item => providerReadiness(settings, item.provider_id));
  const blocked = readiness.filter(item => !item.provider_present || !item.provider_enabled
    || !item.api_key_present || !item.model_present || !item.model_enabled);
  if (blocked.length) {
    const error = new Error(`IMAGE_ROUTING_PROVIDER_NOT_READY:${blocked.map(item => item.provider_id).join(',')}`);
    error.code = 'IMAGE_ROUTING_PROVIDER_NOT_READY';
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}

function configureStages(config = {}, stages = MANAGED_STAGES) {
  const next = { stages: { ...(config.stages || {}) } };
  for (const stage of stages) {
    const existing = Array.isArray(next.stages[stage]) ? next.stages[stage] : [];
    const managedKeys = new Set(ROUTE.map(item => `${item.provider_id}/${item.model_id}`));
    const disabledRest = existing.filter(item => !managedKeys.has(`${item.provider_id}/${item.model_id}`))
      .map(item => ({ ...item, enabled: false }));
    next.stages[stage] = [...ROUTE, ...disabledRest].map((item, index) => ({
      ...item,
      priority: index + 1,
      enabled: index < ROUTE.length,
    }));
  }
  return next;
}

function main(args = process.argv.slice(2)) {
  const apply = args.includes('--apply');
  const settings = settingsService.loadSettings();
  const readiness = assertReady(settings);
  const config = configureStages(pipeline.loadConfig());
  if (apply) pipeline.saveConfig(config);
  console.log(JSON.stringify({
    applied: apply,
    readiness,
    stage_count: MANAGED_STAGES.length,
    route: ROUTE.map(item => `${item.provider_id}/${item.model_id}`),
  }));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({ code: error.code || 'IMAGE_ROUTING_CONFIG_FAILED', message: error.message, readiness: error.readiness || [] }));
    process.exitCode = 1;
  }
}

module.exports = { ROUTE, MANAGED_STAGES, providerReadiness, assertReady, configureStages, main };
