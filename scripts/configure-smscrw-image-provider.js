'use strict';

const { loadSettings, saveSettings, PROVIDER_PRESETS, PROVIDER_ADAPTER_DEFAULTS } = require('../src/services/settingsService');
const pipeline = require('../src/services/pipelineModelService');

async function readStdin() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  return raw.trim();
}

async function main() {
  const fromStdin = process.argv.includes('--stdin');
  const providerOnly = process.argv.includes('--provider-only');
  const raw = fromStdin ? await readStdin() : String(process.env.SMSCRW_API_KEY || '').trim();
  let apiKey = raw;
  if (fromStdin && raw.startsWith('{')) apiKey = String(JSON.parse(raw).api_key || '').trim();
  if (!apiKey) throw new Error('SMSCRW_API_KEY is required (or pass {"api_key":"..."} via --stdin)');

  const settings = loadSettings();
  settings.providers = Array.isArray(settings.providers) ? settings.providers : [];
  const preset = PROVIDER_PRESETS.smscrw;
  const adapter = PROVIDER_ADAPTER_DEFAULTS.smscrw;
  const provider = settings.providers.find(item => item?.id === 'smscrw' || item?.preset === 'smscrw');
  const nextProvider = {
    ...(provider || {}),
    id: 'smscrw',
    preset: 'smscrw',
    name: preset.name,
    api_url: preset.api_url,
    api_key: apiKey,
    enabled: true,
    adapter: adapter.adapter,
    adapter_config: adapter.adapter_config,
    models: [{ ...preset.defaultModels[0], enabled: true }],
  };
  if (provider) Object.assign(provider, nextProvider);
  else settings.providers.push(nextProvider);
  saveSettings(settings);

  const configuredStages = [];
  if (!providerOnly) {
    for (const stageId of pipeline.NEW_STORY_AD_IMAGE_STAGE_IDS) {
      if (!pipeline.getStageDefaults(stageId).length) continue;
      const result = pipeline.setStageConfig(stageId, [
        { provider_id: 'smscrw', model_id: 'gpt-image-2', priority: 1, enabled: true },
        { provider_id: 'webang-maas', model_id: 'gpt-image-2', priority: 2, enabled: true },
        { provider_id: 'deyunai', model_id: 'gpt-image-2', priority: 3, enabled: true },
      ]);
      if (result.rejected.length) throw new Error(`${stageId} configuration rejected: ${JSON.stringify(result.rejected)}`);
      configuredStages.push(stageId);
    }
  }

  console.log(JSON.stringify({
    configured: true,
    provider_id: 'smscrw',
    model_id: 'gpt-image-2',
    api_key_stored: true,
    primary_priority: 1,
    fallback_provider_ids: ['webang-maas', 'deyunai'],
    route_update_skipped: providerOnly,
    configured_stage_count: configuredStages.length,
  }));
}

main().catch(error => {
  console.error(JSON.stringify({ configured: false, error: error.message }));
  process.exitCode = 1;
});
