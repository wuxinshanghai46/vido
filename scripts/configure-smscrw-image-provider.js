'use strict';

const { loadSettings, saveSettings, PROVIDER_PRESETS, PROVIDER_ADAPTER_DEFAULTS } = require('../src/services/settingsService');
const seedanceMigration = require('./configure-story-ad-szznai-seedance-v368');

async function readStdin() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  return raw.trim();
}

async function main() {
  const fromStdin = process.argv.includes('--stdin');
  const raw = fromStdin ? await readStdin() : String(process.env.SMSCRW_API_KEY || '').trim();
  let apiKey = raw;
  if (fromStdin && raw.startsWith('{')) apiKey = String(JSON.parse(raw).api_key || '').trim();
  if (!apiKey) throw new Error('SMSCRW_API_KEY is required (or pass {"api_key":"..."} via --stdin)');

  const settings = loadSettings();
  settings.providers = Array.isArray(settings.providers) ? settings.providers : [];
  const preset = PROVIDER_PRESETS.smscrw;
  const adapter = PROVIDER_ADAPTER_DEFAULTS.smscrw;
  const provider = settings.providers.find(item => item?.id === 'smscrw' || item?.preset === 'smscrw');
  const models = Array.isArray(provider?.models) && provider.models.length
    ? provider.models.map(model => ({ ...model }))
    : preset.defaultModels.map(model => ({ ...model, enabled: model.id === seedanceMigration.VIDEO_MODEL }));
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
    // Preserve the catalogue while the v368 migration enforces that only the
    // exact Seedance video model remains executable.
    models,
  };
  if (provider) Object.assign(provider, nextProvider);
  else settings.providers.push(nextProvider);
  saveSettings(settings);

  const migration = seedanceMigration.apply({ write: true });

  console.log(JSON.stringify({
    configured: true,
    provider_id: 'smscrw',
    model_id: seedanceMigration.VIDEO_MODEL,
    preserved_model_count: settings.providers.find(item => item.id === 'smscrw')?.models?.length || models.length,
    api_key_stored: true,
    primary_priority: 1,
    route_stage: seedanceMigration.VIDEO_STAGE,
    non_video_smscrw_routes: migration.non_video_smscrw_routes,
  }));
}

main().catch(error => {
  console.error(JSON.stringify({ configured: false, error: error.message }));
  process.exitCode = 1;
});
