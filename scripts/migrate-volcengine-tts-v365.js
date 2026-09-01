/**
 * V365 TTS provider migration.
 * - Removes only active Alibaba TTS/CosyVoice provider configuration.
 * - Replaces the obsolete openspeech V1 TTS provider with an isolated volcengine-tts placeholder.
 * - Clears only TTS preview/CosyVoice caches; user recordings and business artifacts are preserved.
 * - Never reads, prints, or writes an API key supplied on the command line.
 */
const fs = require('fs');
const path = require('path');
const { loadSettings, saveSettings, PROVIDER_PRESETS } = require('../src/services/settingsService');

const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../outputs'));

function safeRemoveDirectory(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${outputDir}${path.sep}`) || resolved === outputDir) {
    throw new Error(`Refusing to remove path outside scoped output cache: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  return resolved;
}

const settings = loadSettings();
settings.providers = (settings.providers || []).filter(provider => (
  provider.id !== 'aliyun-tts'
  && provider.preset !== 'aliyun-tts'
  && !(provider.id === 'volcengine' && /openspeech\.bytedance\.com/i.test(String(provider.api_url || '')))
));

let provider = settings.providers.find(item => item.id === 'volcengine-tts');
if (!provider) {
  const preset = PROVIDER_PRESETS['volcengine-tts'];
  provider = {
    id: 'volcengine-tts',
    preset: 'volcengine-tts',
    name: preset.name,
    api_url: preset.api_url,
    api_key: '',
    enabled: false,
    models: preset.defaultModels.map(model => ({ ...model, enabled: true })),
    tts_resource_id: 'seed-tts-2.0',
    clone_resource_id: 'seed-icl-2.0',
    capability_scope: ['tts', 'voice_clone'],
    created_at: new Date().toISOString(),
  };
  settings.providers.push(provider);
}
saveSettings(settings);
const pipelineModels = require('../src/services/pipelineModelService');
pipelineModels.saveConfig(pipelineModels.loadConfig());

const removedCaches = [
  safeRemoveDirectory(path.join(outputDir, '_cosy_cache')),
  safeRemoveDirectory(path.join(outputDir, 'avatar', '__preview_cache')),
];
fs.mkdirSync(path.join(outputDir, 'avatar', '__preview_cache'), { recursive: true });

console.log(JSON.stringify({
  success: true,
  provider_id: provider.id,
  pipeline_tts_routes_migrated: true,
  configured: !!provider.api_key,
  preserved: ['outputs/voices', 'outputs/jimeng-assets', 'business database rows', 'generated media'],
  removed_caches: removedCaches.map(item => path.relative(outputDir, item)),
}, null, 2));
