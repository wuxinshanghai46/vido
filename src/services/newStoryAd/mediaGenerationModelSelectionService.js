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
  'new_story_ad.storyboard_sketch',
  'new_story_ad.keyframe',
  'new_story_ad.video',
]);

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

function catalog(stageId = '') {
  const normalized = stage(stageId);
  const models = rows(normalized);
  return {
    schema_version: 1,
    stage: normalized,
    media_type: normalized === 'new_story_ad.video' ? 'video' : 'image',
    selection_required: true,
    fallback_after_failure: false,
    models,
  };
}

function selectionFrom(body = {}, stageId = '') {
  const normalized = stage(stageId);
  if (normalized === 'new_story_ad.video') {
    const combined = clean(body.video_model_route || body.videoModelRoute, 220).toLowerCase();
    if (combined.includes('/')) return combined;
    const providerId = clean(body.video_provider || body.videoProvider, 80).toLowerCase();
    const modelId = clean(body.video_model || body.videoModel, 120).toLowerCase();
    return providerId && modelId ? `${providerId}/${modelId}` : '';
  }
  return clean(body.image_model || body.imageModel, 220).toLowerCase();
}

function requireSelection(stageId = '', body = {}) {
  const normalized = stage(stageId);
  const selected = selectionFrom(body, normalized);
  if (!selected || !selected.includes('/')) {
    const error = new Error(`请先选择本次${normalized === 'new_story_ad.video' ? '视频' : '图片'}生成模型。`);
    error.code = 'MEDIA_GENERATION_MODEL_SELECTION_REQUIRED';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  const models = rows(normalized);
  const matched = models.find(model => model.route === selected);
  if (!matched) {
    const error = new Error('所选模型不在当前已配置的生成模型列表中，请重新选择。');
    error.code = 'MEDIA_GENERATION_MODEL_SELECTION_INVALID';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  if (!matched.available) {
    const error = new Error(`所选模型 ${matched.model_name} 当前不可用，请选择其他模型后重新提交。`);
    error.code = 'MEDIA_GENERATION_MODEL_SELECTED_UNAVAILABLE';
    error.status = 409;
    error.retryable = true;
    error.retryAfterMs = matched.retry_after_ms;
    throw error;
  }
  return matched;
}

function applySelection(stageId = '', body = {}) {
  const selected = requireSelection(stageId, body);
  return selected.media_type === 'video'
    ? { ...body, video_provider: selected.provider_id, video_model: selected.model_id, video_model_route: selected.route }
    : { ...body, image_model: selected.route, single_attempt: true, max_scene_retries: 0 };
}

module.exports = { ALLOWED_STAGES, applySelection, catalog, requireSelection, route, rows, selectionFrom, stage };
