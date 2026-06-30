/**
 * Model capability inference for production pipelines.
 *
 * This layer keeps business gates capability-based instead of binding them to
 * one vendor name. Provider-specific execution still lives in each route/service.
 */

const CAPABILITY_LABELS = {
  image_generation: '文生图',
  image_edit: '图像编辑',
  reference_preserving: '保参考',
  multi_reference: '多参考',
  character_consistency: '人物一致',
  realistic_photo: '写实照片',
  image_to_video: '图生视频',
  video_motion_control: '运镜控制',
  seedance2_compatible: 'Seedance2',
  actor_sheet_full_body: 'Actor sheet full body',
  portrait_aspect_lock: 'Portrait aspect lock',
};

function normalizeModel(model = {}) {
  const providerId = String(model.provider_id || model.provider || '').trim().toLowerCase();
  const modelId = String(model.model_id || model.model || model.id || '').trim().toLowerCase();
  return {
    provider_id: providerId,
    model_id: modelId,
    label: [providerId, modelId].filter(Boolean).join('/') || 'unknown',
  };
}

function _baseCapabilities() {
  return {
    image_generation: false,
    image_edit: false,
    reference_preserving: false,
    multi_reference: false,
    character_consistency: false,
    realistic_photo: false,
    image_to_video: false,
    video_motion_control: false,
    seedance2_compatible: false,
    actor_sheet_full_body: false,
    portrait_aspect_lock: false,
  };
}

function applyExplicitCapabilityOverrides(caps, model = {}) {
  const explicit = model.capabilities || model.capability_flags || {};
  if (Array.isArray(explicit)) {
    explicit.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(caps, key)) caps[key] = true;
    });
    return caps;
  }
  if (explicit && typeof explicit === 'object') {
    Object.keys(explicit).forEach(key => {
      if (Object.prototype.hasOwnProperty.call(caps, key)) caps[key] = explicit[key] === true;
    });
  }
  ['actor_sheet_full_body', 'portrait_aspect_lock'].forEach(key => {
    if (model[key] === true) caps[key] = true;
    if (model[key] === false) caps[key] = false;
  });
  return caps;
}

function inferModelCapabilities(model = {}) {
  const normalized = normalizeModel(model);
  const provider = normalized.provider_id;
  const modelId = normalized.model_id;
  const text = `${provider}/${modelId}`;
  const caps = _baseCapabilities();

  if (/image|img|seedream|imagen|flux|banana|gpt-image|qwen-image|jimeng-t2i|t2i/.test(text)) {
    caps.image_generation = true;
    caps.realistic_photo = /gpt-image|seedream|imagen|flux|banana|qwen-image|topview/.test(text);
  }

  if (/edit|gpt-image|banana|flux-kontext|kontext|topview-(gpt-image|nano|seedream)/.test(text)) {
    caps.image_edit = true;
  }

  if (/gpt-image-2/.test(modelId) || /^gemini-[\w.-]+-image(?:-|$)/.test(modelId) || /(^|-)nano-banana-2$/.test(modelId) || /topview-(gpt-image-2|nano-banana-pro|nano-banana-2|seedream-5)/.test(modelId)) {
    caps.reference_preserving = true;
    caps.multi_reference = true;
    caps.character_consistency = true;
    caps.image_edit = true;
    caps.image_generation = true;
    caps.realistic_photo = true;
  }

  if (/gpt-image-2/.test(modelId) || /topview-gpt-image-2/.test(modelId)) {
    caps.actor_sheet_full_body = true;
    caps.portrait_aspect_lock = true;
  }

  if (/nano-banana|qwen-image-edit|flux-kontext|kontext/.test(text)) {
    caps.multi_reference = true;
  }

  if (/seedance|image2video|image-to-video|i2v|kling|hailuo|可灵|海螺|jimeng_i2v|t2v/.test(text)) {
    caps.image_to_video = true;
    caps.video_motion_control = true;
    caps.realistic_photo = true;
  }

  if (/seedance.*2|doubao-seedance-2/.test(text)) {
    caps.seedance2_compatible = true;
  }

  return applyExplicitCapabilityOverrides(caps, model);
}

function hasCapability(model, capability) {
  const caps = inferModelCapabilities(model);
  return caps[capability] === true;
}

function canGenerateReferencePreservingKeyframe(model) {
  const caps = inferModelCapabilities(model);
  return caps.image_edit === true
    && caps.reference_preserving === true
    && caps.character_consistency === true
    && caps.realistic_photo === true;
}

function canGenerateImageToVideo(model) {
  const caps = inferModelCapabilities(model);
  return caps.image_to_video === true;
}

function canGenerateActorPersonSheet(model) {
  const caps = inferModelCapabilities(model);
  return caps.image_generation === true
    && caps.realistic_photo === true
    && caps.actor_sheet_full_body === true
    && caps.portrait_aspect_lock === true;
}

function capabilityLabels(caps = {}) {
  return Object.keys(CAPABILITY_LABELS)
    .filter(key => caps[key] === true)
    .map(key => CAPABILITY_LABELS[key]);
}

function modelCapabilityReport(model = {}, required = []) {
  const caps = inferModelCapabilities(model);
  const requiredList = Array.isArray(required) ? required : [required].filter(Boolean);
  const missing = requiredList.filter(key => caps[key] !== true);
  const normalized = normalizeModel(model);
  return {
    provider_id: normalized.provider_id,
    model_id: normalized.model_id,
    label: normalized.label,
    capabilities: caps,
    capability_labels: capabilityLabels(caps),
    required: requiredList,
    missing,
    supported: missing.length === 0,
  };
}

module.exports = {
  CAPABILITY_LABELS,
  normalizeModel,
  inferModelCapabilities,
  hasCapability,
  canGenerateReferencePreservingKeyframe,
  canGenerateImageToVideo,
  canGenerateActorPersonSheet,
  capabilityLabels,
  modelCapabilityReport,
};
