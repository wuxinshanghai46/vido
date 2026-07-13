#!/usr/bin/env node
const { loadSettings, saveSettings } = require('../src/services/settingsService');
const pipeline = require('../src/services/pipelineModelService');

const VIDEO_MODELS = [
  { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128', enabled: true },
  { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-fast-260128', enabled: true },
  { provider_id: 'topview', model_id: 'topview-image2video-pro', enabled: true },
  { provider_id: 'zhipu', model_id: 'cogvideox-flash', enabled: true },
];

function ensureModel(provider, model) {
  provider.models = Array.isArray(provider.models) ? provider.models : [];
  const existing = provider.models.find(item => String(item.id) === String(model.id));
  if (existing) Object.assign(existing, model, { enabled: model.enabled !== false });
  else provider.models.push({ ...model, enabled: model.enabled !== false });
}

function setStage(config, stage, desired) {
  const existing = Array.isArray(config.stages?.[stage]) ? config.stages[stage] : [];
  const desiredKeys = new Set(desired.map(item => `${item.provider_id}/${item.model_id}`));
  const rest = existing
    .filter(item => !desiredKeys.has(`${item.provider_id}/${item.model_id}`))
    .map(item => ({ ...item, enabled: false }));
  config.stages = config.stages || {};
  config.stages[stage] = [...desired, ...rest].map((item, index) => ({
    ...item,
    priority: index + 1,
    enabled: item.enabled !== false,
  }));
}

function configure() {
  const settings = loadSettings();
  const deyunai = (settings.providers || []).find(provider => provider.id === 'deyunai' || provider.preset === 'deyunai');
  if (!deyunai) throw new Error('未找到漫路 deyunai 供应商配置');
  deyunai.enabled = true;
  ensureModel(deyunai, { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro（漫路）', type: 'story', use: 'story', channel: 'overseas' });
  ensureModel(deyunai, { id: 'gpt-4o', name: 'GPT-4o（漫路）', type: 'story', use: 'story', channel: 'overseas' });
  ensureModel(deyunai, { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash（漫路）', type: 'story', use: 'story', channel: 'overseas' });
  ensureModel(deyunai, { id: 'gpt-image-2', name: 'GPT Image 2（漫路）', type: 'image', use: 'image', channel: 'cn' });
  ensureModel(deyunai, { id: 'nano-banana-pro', name: 'Nano Banana Pro（漫路）', type: 'image', use: 'image', channel: 'cn' });
  ensureModel(deyunai, { id: 'nano-banana', name: 'Nano Banana（漫路）', type: 'image', use: 'image', channel: 'cn' });
  ensureModel(deyunai, { id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0（漫路·图生视频）', type: 'video', use: 'video', channel: 'cn' });
  ensureModel(deyunai, { id: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast（漫路·图生视频）', type: 'video', use: 'video', channel: 'cn' });
  saveSettings(settings);

  const config = pipeline.loadConfig();
  const textModels = [
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', enabled: true },
    { provider_id: 'deyunai', model_id: 'gpt-4o', enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', enabled: true },
  ];
  for (const stage of [
    'new_story_ad.scene_config',
    'new_story_ad.blueprint',
    'new_story_ad.storyboard_table',
    'new_story_ad.storyboard_rewrite',
    'new_story_ad.qa',
    'new_story_ad.json_repair',
    'new_story_ad.assist',
  ]) setStage(config, stage, textModels);

  const imageModels = [
    { provider_id: 'deyunai', model_id: 'gpt-image-2', enabled: true },
    { provider_id: 'deyunai', model_id: 'nano-banana-pro', enabled: true },
    { provider_id: 'deyunai', model_id: 'nano-banana', enabled: true },
  ];
  for (const stage of [
    'new_story_ad.person_sheet',
    'new_story_ad.scene_asset',
    'new_story_ad.keyframe',
  ]) setStage(config, stage, imageModels);

  setStage(config, 'new_story_ad.video', VIDEO_MODELS);
  pipeline.saveConfig(config);
  return {
    text: textModels.map(item => `${item.provider_id}/${item.model_id}`),
    image: imageModels.map(item => `${item.provider_id}/${item.model_id}`),
    video: config.stages['new_story_ad.video'].filter(item => item.enabled !== false).map(item => `${item.provider_id}/${item.model_id}`),
  };
}

if (require.main === module) {
  const result = configure();
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { configure, ensureModel, setStage, VIDEO_MODELS };
