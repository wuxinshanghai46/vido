'use strict';

const pipeline = require('../pipelineModelService');
const mediaAdapter = require('./mediaAdapter');
const videoAdapter = require('./videoAdapter');
const modelGateway = require('./modelGateway');

const ALLOWED_STAGES = new Set([
  'new_story_ad.person_sheet',
  'new_story_ad.person_dossier_atlas',
  'new_story_ad.prop_dossier_atlas',
  'new_story_ad.product_asset',
  'new_story_ad.scene_asset',
  'new_story_ad.scene_panorama',
  'new_story_ad.storyboard_image',
  'new_story_ad.keyframe',
  'new_story_ad.video',
]);

const PUBLIC_MEDIA_CHOICES = Object.freeze({
  image: Object.freeze([
    Object.freeze({ id: 'image-sz', public_name: 'Image-2', provider_code: 'SZ', execution_route: 'smscrw/gpt-image-2', default: true }),
    Object.freeze({ id: 'image-wb', public_name: 'Image-2', provider_code: 'WB', execution_route: 'webang-maas/gpt-image-2' }),
    Object.freeze({ id: 'image-dy', public_name: 'Image-2', provider_code: 'DY', execution_route: 'deyunai/gpt-image-2' }),
    Object.freeze({ id: 'nano-sz', public_name: 'Nano Banana', provider_code: 'SZ', execution_route: 'smscrw/gemini-3.1-flash-image-preview' }),
    Object.freeze({ id: 'nano-wb', public_name: 'Nano Banana', provider_code: 'WB', execution_route: 'webang-maas/gemini-2.5-flash-image' }),
    Object.freeze({ id: 'nano-dy', public_name: 'Nano Banana', provider_code: 'DY', execution_route: 'deyunai/gemini-2.5-flash-image' }),
  ]),
  video: Object.freeze([
    Object.freeze({ id: 'seedance-dy', public_name: 'Seedance', provider_code: 'DY', execution_route: 'deyunai/doubao-seedance-2-0-260128', default: true }),
    Object.freeze({ id: 'seedance-sz', public_name: 'Seedance', provider_code: 'SZ', execution_route: 'smscrw/doubao-seedance-2-0-260128' }),
    Object.freeze({ id: 'seedance-wb', public_name: 'Seedance', provider_code: 'WB', execution_route: 'webang-seedance/doubao-seedance-2-0-260128' }),
  ]),
});

function clean(value = '', max = 180) {
  return String(value ?? '').trim().slice(0, max);
}

function route(model = {}) {
  return `${clean(model.provider_id, 80).toLowerCase()}/${clean(model.model_id, 120).toLowerCase()}`;
}

function stage(stageId = '') {
  const normalized = clean(stageId, 120);
  if (!ALLOWED_STAGES.has(normalized)) {
    const error = new Error('该阶段不是可由用户选择模型的图片或视频生成阶段。');
    error.code = 'MEDIA_GENERATION_MODEL_STAGE_INVALID';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  return normalized;
}

function namesFor(stageId) {
  return new Map(pipeline.listAvailableModelsForStage(stageId).map(model => [route(model), model]));
}

function rows(stageId = '') {
  const normalized = stage(stageId);
  const names = namesFor(normalized);
  const source = normalized === 'new_story_ad.video'
    ? videoAdapter.videoCandidates({}, { includeCircuitOpen: true })
    : mediaAdapter.selectableImageModels(normalized, { includeCircuitOpen: true });
  return source.map((model, index) => {
    const metadata = names.get(route(model)) || model;
    const health = model.health || modelGateway.healthState(model);
    return {
      route: route(model),
      provider_id: clean(model.provider_id, 80),
      provider_name: clean(metadata.provider_name || metadata.provider_id || model.provider_id, 120),
      model_id: clean(model.model_id, 120),
      model_name: clean(metadata.model_name || metadata.model_id || model.model_id, 160),
      media_type: normalized === 'new_story_ad.video' ? 'video' : 'image',
      priority: Math.max(1, Number(model.priority || index + 1) || index + 1),
      available: health.circuit_open !== true,
      retry_after_ms: Math.max(0, Number(health.cooldown_remaining_ms || 0) || 0),
    };
  }).sort((a, b) => Number(b.available) - Number(a.available)
    || a.priority - b.priority
    || a.model_name.localeCompare(b.model_name, 'zh-CN'));
}

function publicRows(stageId = '', source = []) {
  const normalized = stage(stageId);
  const mediaType = normalized === 'new_story_ad.video' ? 'video' : 'image';
  const byRoute = new Map(source.map(model => [model.route, model]));
  return PUBLIC_MEDIA_CHOICES[mediaType].map(choice => {
    const configured = byRoute.get(choice.execution_route);
    return {
      route: choice.id,
      public_name: choice.public_name,
      provider_code: choice.provider_code,
      media_type: mediaType,
      available: configured?.available === true,
      retry_after_ms: Math.max(0, Number(configured?.retry_after_ms || 0) || 0),
    };
  });
}

function selectableRows(stageId = '') {
  const normalized = stage(stageId);
  return publicRows(normalized, rows(normalized));
}

function publicCatalog(stageId = '', configured = []) {
  const normalized = stage(stageId);
  const models = publicRows(normalized, configured);
  const mediaType = normalized === 'new_story_ad.video' ? 'video' : 'image';
  const preferred = PUBLIC_MEDIA_CHOICES[mediaType].find(choice => choice.default === true);
  return {
    schema_version: 3,
    stage: normalized,
    media_type: mediaType,
    selection_required: true,
    fallback_after_failure: false,
    default_selection: models.some(model => model.route === preferred?.id && model.available) ? preferred.id : '',
    models,
  };
}

function catalog(stageId = '') {
  const normalized = stage(stageId);
  return publicCatalog(normalized, rows(normalized));
}

function selectionFrom(body = {}, stageId = '') {
  const normalized = stage(stageId);
  if (normalized === 'new_story_ad.video') {
    const combined = clean(body.video_model_route || body.videoModelRoute, 220).toLowerCase();
    if (combined) return combined;
    const providerId = clean(body.video_provider || body.videoProvider, 80).toLowerCase();
    const modelId = clean(body.video_model || body.videoModel, 120).toLowerCase();
    return providerId && modelId ? `${providerId}/${modelId}` : '';
  }
  return clean(body.image_model || body.imageModel, 220).toLowerCase();
}

function requireSelection(stageId = '', body = {}) {
  const normalized = stage(stageId);
  const selected = selectionFrom(body, normalized);
  if (!selected) {
    const error = new Error(`请先选择本次${normalized === 'new_story_ad.video' ? '视频' : '图片'}生成模型。`);
    error.code = 'MEDIA_GENERATION_MODEL_SELECTION_REQUIRED';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  return resolveSelection(normalized, selected, rows(normalized));
}

function resolveSelection(stageId = '', selectedId = '', configured = []) {
  const normalized = stage(stageId);
  const selected = clean(selectedId, 220).toLowerCase();
  const models = publicRows(normalized, configured);
  const matched = models.find(model => model.route === selected);
  if (!matched) {
    const error = new Error('所选模型不在当前已配置的生成模型列表中，请重新选择。');
    error.code = 'MEDIA_GENERATION_MODEL_SELECTION_INVALID';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  if (!matched.available) {
    const publicLabel = [matched.public_name || matched.model_name, matched.provider_code].filter(Boolean).join(' · ');
    const error = new Error(`所选模型 ${publicLabel} 当前不可用，请选择其他模型后重新提交。`);
    error.code = 'MEDIA_GENERATION_MODEL_SELECTED_UNAVAILABLE';
    error.status = 409;
    error.retryable = true;
    error.retryAfterMs = matched.retry_after_ms;
    throw error;
  }
  const mediaType = normalized === 'new_story_ad.video' ? 'video' : 'image';
  const choice = PUBLIC_MEDIA_CHOICES[mediaType].find(item => item.id === selected);
  const resolved = configured.find(model => model.route === choice.execution_route);
  return { ...resolved, selection_id: selected, public_name: matched.public_name, provider_code: matched.provider_code };
}

function applyResolvedSelection(body = {}, selected = {}) {
  return selected.media_type === 'video'
    ? { ...body, video_provider: selected.provider_id, video_model: selected.model_id, video_model_route: selected.route }
    : { ...body, image_model: selected.route, single_attempt: true, max_scene_retries: 0 };
}

function applySelection(stageId = '', body = {}) {
  return applyResolvedSelection(body, requireSelection(stageId, body));
}

module.exports = {
  ALLOWED_STAGES, PUBLIC_MEDIA_CHOICES, applyResolvedSelection, applySelection, catalog, publicCatalog, publicRows,
  requireSelection, resolveSelection, route, rows, selectableRows, selectionFrom, stage,
};
