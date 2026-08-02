const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');
const client = new Client();
const script = String.raw`
  const crypto = require('crypto');
  const { loadSettings } = require('./src/services/settingsService');
  const pipeline = require('./src/services/pipelineModelService');
  const mediaAdapter = require('./src/services/newStoryAd/mediaAdapter');
  const settings = loadSettings();
  const provider = (settings.providers || []).find(item => item.id === 'deyunai' || item.preset === 'deyunai') || {};
  const key = String(provider.api_key || '');
  const models = (provider.models || []).filter(model => ['gpt-image-2','nano-banana-pro','nano-banana'].includes(String(model.id)));
  console.log(JSON.stringify({
    provider_id: provider.id || '', enabled: provider.enabled !== false,
    configured_api_url: provider.api_url || '',
    key_present: !!key, key_length: key.length,
    key_fingerprint: key ? crypto.createHash('sha256').update(key).digest('hex').slice(0, 12) : '',
    image_models: models.map(model => ({ id: model.id, enabled: model.enabled !== false, channel: model.channel || '', type: model.type || '', use: model.use || '' })),
    storyboard_sketch_route: {
      configured: pipeline.getStageConfig('new_story_ad.storyboard_sketch'),
      defaults: pipeline.getStageDefaults('new_story_ad.storyboard_sketch'),
      enabled_with_default: pipeline.pickAllEnabledWithDefault('new_story_ad.storyboard_sketch'),
      available_candidates: mediaAdapter.availableImageCandidates('new_story_ad.storyboard_sketch').map(model => ({ provider_id: model.provider_id, model_id: model.model_id })),
    },
    effective_gpt_image_2_endpoint: 'https://api.deyunai.com/ent/v1/images/generations',
    effective_headers: ['Authorization: Bearer <provider api_key>', 'Content-Type: application/json'],
  }, null, 2));
`;
const encoded = Buffer.from(script).toString('base64');
client.on('ready', () => client.exec(`cd /opt/vido/app && node -e "eval(Buffer.from('${encoded}','base64').toString())"`, (error, stream) => {
  if (error) throw error;
  stream.on('data', chunk => process.stdout.write(chunk));
  stream.stderr.on('data', chunk => process.stderr.write(chunk));
  stream.on('close', code => { client.end(); process.exitCode = code || 0; });
})).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect(connectionOptions());
