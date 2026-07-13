const modelGateway = require('./modelGateway');
const { cleanText } = require('./contextBuilder');

const VIEW_KEYS = ['master', 'reverse', 'interaction', 'detail'];

function safeJson(raw = '') {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch (_) {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error('视觉模型未返回有效 JSON');
}

function stableId(prefix, value, index) {
  const normalized = cleanText(value, 80).toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '').slice(0, 48);
  return prefix + '_' + (normalized || index + 1);
}

function stringList(input, max = 24, itemMax = 240) {
  return (Array.isArray(input) ? input : [])
    .map(value => cleanText(typeof value === 'string' ? value : (value?.text || value?.description || value?.label || ''), itemMax))
    .filter(Boolean).slice(0, max);
}

function normalizeAnchors(input = []) {
  return (Array.isArray(input) ? input : []).map((item, index) => {
    const source = typeof item === 'string' ? { label: item } : (item || {});
    const label = cleanText(source.label || source.name || source.description || 'anchor ' + (index + 1), 120);
    return {
      id: cleanText(source.id || stableId('anchor', label, index), 100),
      label,
      kind: cleanText(source.kind || source.type || 'spatial_feature', 80),
      description: cleanText(source.description || source.visual || label, 300),
      relative_position: cleanText(source.relative_position || source.position || source.relation || '', 240),
      required: source.required !== false,
      visible_in_views: (Array.isArray(source.visible_in_views) ? source.visible_in_views : VIEW_KEYS)
        .map(value => cleanText(value, 40)).filter(value => VIEW_KEYS.includes(value)),
    };
  }).filter(item => item.label).slice(0, 24);
}

function normalizeZones(input = []) {
  return (Array.isArray(input) ? input : []).map((item, index) => {
    const source = typeof item === 'string' ? { label: item } : (item || {});
    const label = cleanText(source.label || source.name || source.purpose || 'zone ' + (index + 1), 120);
    const labelZh = cleanText(source.label_zh || source.labelZh || (/[㐀-鿿]/.test(label) ? label : ''), 120);
    const box = Array.isArray(source.normalized_box) ? source.normalized_box.map(Number).slice(0, 4) : [];
    return {
      id: cleanText(source.id || stableId('zone', label, index), 100),
      label,
      label_zh: labelZh,
      purpose: cleanText(source.purpose || source.description || label, 300),
      tags: stringList(source.tags || source.allowed_actions || [], 12, 80),
      normalized_box: box.length === 4 && box.every(Number.isFinite)
        ? box.map(value => Math.max(0, Math.min(1, value))) : [],
      visible_in_views: (Array.isArray(source.visible_in_views) ? source.visible_in_views : VIEW_KEYS)
        .map(value => cleanText(value, 40)).filter(value => VIEW_KEYS.includes(value)),
    };
  }).filter(item => item.label).slice(0, 24);
}

function normalizeCameras(input = [], views = []) {
  const list = Array.isArray(input) ? input : [];
  return VIEW_KEYS.map((key, index) => {
    const source = list.find(item => cleanText(item?.view_id || item?.key || '', 40) === key) || {};
    const view = (Array.isArray(views) ? views : []).find(item => cleanText(item?.key || item?.view || '', 40) === key) || views[index] || {};
    return {
      id: cleanText(source.id || 'camera_' + key, 100),
      view_id: key,
      label: cleanText(source.label || view.label || key, 100),
      reference_image_url: cleanText(view.url || view.image_url || source.reference_image_url || '', 1000),
      framing: cleanText(source.framing || '', 120),
      lens_class: cleanText(source.lens_class || source.lens || '', 80),
      orientation: cleanText(source.orientation || source.camera_direction || '', 160),
      allowed_zone_ids: stringList(source.allowed_zone_ids || [], 24, 100),
    };
  });
}

function score(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function firstScore(input = {}, keys = []) {
  const containers = [input, input.scores, input.quality_dimensions, input.metrics].filter(Boolean);
  for (const container of containers) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(container, key) && Number.isFinite(Number(container[key]))) {
        return Number(container[key]);
      }
    }
  }
  return 0;
}

function hasRequiredScores(input = {}, fields = []) {
  const containers = [input, input.scores, input.quality_dimensions, input.metrics].filter(Boolean);
  return fields.every(aliases => containers.some(container => aliases.some(key =>
    Object.prototype.hasOwnProperty.call(container, key) && Number.isFinite(Number(container[key]))
  )));
}

function normalizeContract(input = {}, options = {}) {
  const requested = options.requested || {};
  const views = options.views || [];
  const sourceQa = input.cross_view_qa && typeof input.cross_view_qa === 'object' ? input.cross_view_qa : input;
  const contract = {
    schema_version: 1,
    scene_id: cleanText(options.sceneId || input.scene_id, 120),
    scene_revision: Math.max(1, Number(options.revision || input.scene_revision || 1) || 1),
    status: cleanText(input.status || 'verified', 40),
    requested_layout: cleanText(requested.layout || input.requested_layout || '', 1000),
    requested_material_light: cleanText(requested.material_light || input.requested_material_light || '', 1000),
    requested_interaction: cleanText(requested.interaction || input.requested_interaction || '', 800),
    observed_summary: cleanText(input.observed_summary || input.summary || '', 1200),
    anchors: normalizeAnchors(input.anchors || input.spatial_anchors || []),
    zones: normalizeZones(input.zones || input.spatial_zones || []),
    geometry_facts: stringList(input.geometry_facts || input.geometry || [], 30, 320),
    materials: stringList(input.materials || input.material_palette || [], 24, 220),
    lighting: input.lighting && typeof input.lighting === 'object' ? {
      direction: cleanText(input.lighting.direction || '', 180),
      color_temperature: cleanText(input.lighting.color_temperature || input.lighting.temperature || '', 100),
      fixtures: stringList(input.lighting.fixtures || [], 16, 160),
      notes: cleanText(input.lighting.notes || '', 300),
    } : {},
    cameras: normalizeCameras(input.cameras || [], views),
    cross_view_qa: {
      pass: sourceQa.pass === true,
      scene_consistency_score: score(firstScore(sourceQa, ['scene_consistency_score', 'scene_continuity', 'scene_consistency'])),
      geometry_consistency_score: score(firstScore(sourceQa, ['geometry_consistency_score', 'anchor_consistency_score', 'spatial_consistency', 'geometry_consistency'])),
      material_consistency_score: score(firstScore(sourceQa, ['material_consistency_score', 'material_match_score', 'material_fidelity', 'material_consistency'])),
      mismatch_reasons: stringList(sourceQa.mismatch_reasons || [], 20, 300),
    },
    verified_at: new Date().toISOString(),
  };
  const qa = contract.cross_view_qa;
  qa.pass = sourceQa.pass === true && qa.scene_consistency_score >= 0.72
    && qa.geometry_consistency_score >= 0.68 && qa.material_consistency_score >= 0.72;
  contract.status = qa.pass ? 'verified' : 'rejected';
  return contract;
}

function buildUnverifiedContract(options = {}, error = null) {
  const contract = normalizeContract({ status: 'unverified' }, options);
  contract.status = 'unverified';
  contract.qa_unavailable = true;
  contract.qa_error_code = cleanText(error?.code || 'VISION_QA_UNAVAILABLE', 80);
  contract.qa_error = cleanText(error?.message || '视觉验收暂不可用', 500);
  contract.vision_model = '';
  contract.cross_view_qa = {
    pass: null,
    scene_consistency_score: null,
    geometry_consistency_score: null,
    material_consistency_score: null,
    mismatch_reasons: [],
  };
  return contract;
}

async function analyzeSceneViews(options = {}) {
  const requested = options.requested || {};
  const views = options.views || [];
  const request = {
    taskId: options.taskId || '',
    stage: 'new_story_ad.scene_vision',
    systemPrompt: [
      'You are a strict scene continuity and spatial-geometry inspector for a general-purpose commercial video system.',
      'Analyze only the supplied images and current request. Never assume a fixed industry, location, person or object.',
      'Return JSON only. Images are ordered master, reverse/side, interaction position and detail.',
    ].join('\n'),
    userPrompt: 'Requested scene constraints: ' + JSON.stringify(requested) + '\n'
      + 'Extract the actual generated space and verify all views belong to one physically coherent scene. '
      + 'Return one JSON object with: pass boolean; status string; observed_summary string; '
      + 'scene_consistency_score, geometry_consistency_score and material_consistency_score as REQUIRED EVALUATED numbers from 0 to 1; '
      + 'mismatch_reasons string array; anchors object array with id, label, kind, description, relative_position, required and visible_in_views; '
      + 'zones object array with id, label, label_zh, purpose, tags, normalized_box and visible_in_views; '
      + 'Every zone label_zh is required and must be a concise Simplified Chinese display name. Keep id stable and language-neutral; never derive or replace id during translation. '
      + 'geometry_facts string array; materials string array; lighting object; cameras object array. '
      + 'Never copy placeholder scores. Calculate every score from the supplied images. pass=true cannot have a zero score. '
      + 'Fail when fixed architecture, anchor placement, dominant material family or lighting logic changes. '
      + 'Do not fail merely because camera perspective changes.',
    imageUrls: views.map(view => view.url || view.image_url).filter(Boolean),
    maxTokens: 5000,
  };
  let result = await modelGateway.generateVision(request);
  let parsed = safeJson(result.text);
  const sceneScoreFields = [
    ['scene_consistency_score', 'scene_continuity', 'scene_consistency'],
    ['geometry_consistency_score', 'anchor_consistency_score', 'spatial_consistency', 'geometry_consistency'],
    ['material_consistency_score', 'material_match_score', 'material_fidelity', 'material_consistency'],
  ];
  if (!hasRequiredScores(parsed, sceneScoreFields)) {
    result = await modelGateway.generateVision({
      ...request,
      userPrompt: request.userPrompt + '\nYour previous response omitted required numeric score fields. Return the exact schema with all three numeric scores from 0 to 1.',
    });
    parsed = safeJson(result.text);
  }
  if (!hasRequiredScores(parsed, sceneScoreFields)) {
    const error = new Error('场景视觉 QA 返回结构缺少必需评分字段');
    error.code = 'VISION_QA_SCHEMA_INVALID';
    error.retryable = true;
    throw error;
  }
  const contract = normalizeContract(parsed, {
    sceneId: options.sceneId,
    revision: options.revision,
    views,
    requested,
  });
  contract.vision_model = result.used_model || '';
  return contract;
}

function normalizeKeyframeQa(input = {}) {
  const qa = {
    pass: input.pass === true,
    status: cleanText(input.status || '', 40),
    scene_consistency_score: score(firstScore(input, ['scene_consistency_score', 'scene_continuity', 'scene_consistency'])),
    anchor_consistency_score: score(firstScore(input, ['anchor_consistency_score', 'spatial_anchor_consistency', 'anchor_consistency'])),
    camera_match_score: score(firstScore(input, ['camera_match_score', 'camera_match', 'view_match'])),
    material_match_score: score(firstScore(input, ['material_match_score', 'material_fidelity', 'material_match'])),
    mismatch_reasons: stringList(input.mismatch_reasons || [], 16, 300),
    forbidden_new_elements: stringList(input.forbidden_new_elements || [], 16, 220),
  };
  qa.pass = qa.pass && qa.scene_consistency_score >= 0.72
    && qa.anchor_consistency_score >= 0.65 && qa.camera_match_score >= 0.65
    && qa.material_match_score >= 0.7 && qa.forbidden_new_elements.length === 0;
  qa.status = qa.pass ? 'passed' : 'failed';
  return qa;
}

async function reviewKeyframe(options = {}) {
  const request = {
    taskId: options.taskId || '',
    stage: 'new_story_ad.scene_consistency_qa',
    systemPrompt: [
      'You are a strict scene-continuity visual QA inspector for general-purpose commercial storyboards.',
      'Image 1 is the required empty scene/camera reference. Image 2 is the generated keyframe.',
      'Judge spatial identity, fixed anchors, camera intent, material family and newly invented architecture.',
      'People and the advertised subject may be added when required by the shot.',
      'A person named or described in the shot contract is authorized even though the empty scene reference contains no person. Never reject that required actor merely for being absent from the empty reference.',
      'When the shot requires pointing, touching, operating, holding or gaze interaction, verify that the intended target is visibly present, physically reachable and aligned with the hand/finger/eyeline. Reject unexplained empty-air gestures.',
      'Return JSON only. Never use fixed industry expectations.',
      'All mismatch_reasons and forbidden_new_elements entries must be concise Simplified Chinese written for ordinary product users.',
    ].join('\n'),
    userPrompt: 'Scene contract: ' + JSON.stringify(options.contract || {}).slice(0, 10000)
      + '\nShot contract: ' + JSON.stringify(options.shot || {}).slice(0, 5000)
      + '\nReturn one JSON object with pass boolean, status string, '
      + 'scene_consistency_score, anchor_consistency_score, camera_match_score and material_match_score '
      + 'as REQUIRED EVALUATED numbers from 0 to 1, plus mismatch_reasons and forbidden_new_elements string arrays. '
      + 'Never copy placeholder scores. Calculate every score from the supplied images. pass=true cannot have a zero score. '
      + 'Fail for another space, incompatible required-anchor movement, changed dominant material structure, '
      + 'selected-camera contradiction, or unsupported new architecture.'
      + '\nUse Simplified Chinese for every reason string. Do not return English reason text.',
    imageUrls: [options.sceneReferenceUrl, options.generatedUrl],
    maxTokens: 3000,
  };
  let result = await modelGateway.generateVision(request);
  let parsed = safeJson(result.text);
  const keyframeScoreFields = [
    ['scene_consistency_score', 'scene_continuity', 'scene_consistency'],
    ['anchor_consistency_score', 'spatial_anchor_consistency', 'anchor_consistency'],
    ['camera_match_score', 'camera_match', 'view_match'],
    ['material_match_score', 'material_fidelity', 'material_match'],
  ];
  if (!hasRequiredScores(parsed, keyframeScoreFields)) {
    result = await modelGateway.generateVision({
      ...request,
      userPrompt: request.userPrompt + '\nYour previous response omitted required numeric score fields. Return the exact schema with all four numeric scores from 0 to 1.',
    });
    parsed = safeJson(result.text);
  }
  if (!hasRequiredScores(parsed, keyframeScoreFields)) {
    const error = new Error('关键帧视觉 QA 返回结构缺少必需评分字段');
    error.code = 'VISION_QA_SCHEMA_INVALID';
    error.retryable = true;
    throw error;
  }
  const normalized = normalizeKeyframeQa(parsed);
  const allZero = [
    normalized.scene_consistency_score,
    normalized.anchor_consistency_score,
    normalized.camera_match_score,
    normalized.material_match_score,
  ].every(value => value === 0);
  if (allZero && !normalized.mismatch_reasons.length && !normalized.forbidden_new_elements.length) {
    const error = new Error('关键帧视觉 QA 未能读取或评估参考图片，供应商返回全零评分且没有原因');
    error.code = 'VISION_QA_IMAGE_UNREADABLE';
    error.retryable = true;
    error.qa_response_excerpt = cleanText(result.text, 1200);
    throw error;
  }
  return {
    ...normalized,
    vision_model: result.used_model || '',
    checked_at: new Date().toISOString(),
    ...(process.env.NEW_STORY_AD_QA_DEBUG === '1'
      ? { provider_response_excerpt: cleanText(result.text, 1200) }
      : {}),
  };
}

module.exports = {
  VIEW_KEYS,
  analyzeSceneViews,
  buildUnverifiedContract,
  normalizeContract,
  normalizeAnchors,
  normalizeZones,
  reviewKeyframe,
};
