'use strict';

const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 2222);
const username = process.env.VIDO_DEPLOY_USER || 'root';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/current';

function source({ apply = false } = {}) {
  return String.raw`
const settings = require('./src/services/settingsService').loadSettings();
const pipeline = require('./src/services/pipelineModelService');
const apply = ${apply ? 'true' : 'false'};
const providerIds = ['smscrw', 'webang-maas', 'deyunai'];
const readiness = providerIds.map(providerId => {
  const provider = (settings.providers || []).find(item => item && (item.id === providerId || item.preset === providerId));
  const model = (provider?.models || []).find(item => item && item.id === 'gpt-image-2');
  return {
    provider_id: providerId,
    provider_present: Boolean(provider),
    provider_enabled: provider?.enabled !== false,
    api_key_present: Boolean(String(provider?.api_key || '').trim()),
    model_present: Boolean(model),
    model_enabled: model?.enabled !== false,
    adapter: String(provider?.adapter || ''),
  };
});
const stages = [
  'new_story_ad.person_sheet', 'new_story_ad.person_dossier_atlas', 'new_story_ad.person_dossier_expression',
  'new_story_ad.person_dossier_action', 'new_story_ad.person_dossier_native_master',
  'new_story_ad.person_dossier_wearable_accessory', 'new_story_ad.person_dossier_wardrobe_detail',
  'new_story_ad.scene_asset', 'new_story_ad.scene_extension_atlas', 'new_story_ad.scene_extension_master',
  'new_story_ad.scene_extension_layout', 'new_story_ad.scene_extension_reverse',
  'new_story_ad.scene_extension_interaction', 'new_story_ad.scene_extension_detail',
  'new_story_ad.product_asset', 'new_story_ad.prop_dossier_atlas', 'new_story_ad.keyframe',
];
const managedStages = [...pipeline.NEW_STORY_AD_IMAGE_STAGE_IDS].filter(stage => stage !== 'new_story_ad.scene_panorama');
const desired = providerIds.map((provider_id, index) => ({ provider_id, model_id: 'gpt-image-2', priority: index + 1, enabled: true }));
const blocked = readiness.filter(item => !item.provider_present || !item.provider_enabled || !item.api_key_present || !item.model_present || !item.model_enabled);
if (apply) {
  if (blocked.length) throw new Error('IMAGE_ROUTING_PROVIDER_NOT_READY:' + blocked.map(item => item.provider_id).join(','));
  const config = pipeline.loadConfig(); config.stages = config.stages || {};
  for (const stage of managedStages) {
    const existing = Array.isArray(config.stages[stage]) ? config.stages[stage] : [];
    const keys = new Set(desired.map(item => item.provider_id + '/' + item.model_id));
    const rest = existing.filter(item => !keys.has(item.provider_id + '/' + item.model_id)).map(item => ({ ...item, enabled: false }));
    config.stages[stage] = [...desired, ...rest].map((item, index) => ({ ...item, priority: index + 1, enabled: index < desired.length }));
  }
  pipeline.saveConfig(config);
}
console.log(JSON.stringify({
  read_only: !apply,
  applied: apply,
  providers: readiness,
  stages: Object.fromEntries(stages.map(stage => [stage, pipeline.pickAllEnabled(stage).map(item => item.provider_id + '/' + item.model_id)])),
}));`;
}

function quote(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }

function command({ apply = false } = {}) {
  const encoded = Buffer.from(source({ apply }), 'utf8').toString('base64');
  const evaluation = `eval(Buffer.from('${encoded}','base64').toString('utf8'))`;
  return `cd ${quote(remoteRoot)} && node scripts/run-with-pm2-env.js vido node -e ${quote(evaluation)}`;
}

function main() {
  const apply = process.argv.slice(2).includes('--apply');
  const client = new Client();
  client.on('ready', () => client.exec(command({ apply }), (error, stream) => {
    if (error) throw error;
    let stdout = '', stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => {
      client.end();
      if (code) { console.error(stderr.trim() || `remote audit exited ${code}`); process.exitCode = 1; return; }
      const report = JSON.parse(stdout.trim());
      if (report.read_only !== !apply || report.applied !== apply || !Array.isArray(report.providers) || report.providers.length !== 3) throw new Error('INVALID_IMAGE_ROUTING_AUDIT');
      console.log(JSON.stringify(report));
    });
  })).on('error', error => { console.error(error.message || error); process.exitCode = 1; })
    .connect(connectionOptions({ host, port, username }));
}

if (require.main === module) main();
module.exports = { source, command };
