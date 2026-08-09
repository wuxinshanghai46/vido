const { cleanText } = require('./contextBuilder');

const MODES = new Set(['photo_views', 'panorama_360', 'director_3d', 'spatial_3d']);
const SOURCES = new Set(['existing_assets', 'ai_concept', 'real_capture']);

function outputSchema() {
  return `{
  "experience_plan": {
    "requested_mode": "photo_views/panorama_360/director_3d/spatial_3d",
    "source_mode": "existing_assets/ai_concept/real_capture",
    "observation_point_target": 1,
    "route_brief": "与当前剧情和场景区域一致的观察路线、镜头方向、人物或摄像机移动要求，80-220字",
    "required_zones": ["必须看到的当前场景区域"],
    "camera_path": ["按故事顺序排列的镜头路径"],
    "actor_path": ["人物在当前场景中的行动路线"],
    "constraints": ["不能偏离的故事、空间和连续性约束"],
    "capability_boundary": "明确3DoF、结构化3D导演预演或真实6DoF的能力边界"
  }
}`;
}

function normalizeList(value, max = 12) {
  return (Array.isArray(value) ? value : []).map(item => cleanText(item, 260)).filter(Boolean).slice(0, max);
}

function buildResponse({ parsed = {}, current = {}, mode = 'scene_experience', modelResult = {}, knowledgePolicy = null } = {}) {
  const source = parsed.experience_plan || parsed.experiencePlan || parsed;
  const requested = cleanText(source.requested_mode || source.requestedMode || current.requested_mode || 'photo_views', 40);
  const sourceMode = cleanText(source.source_mode || source.sourceMode || current.source_mode || 'existing_assets', 40);
  const plan = {
    requested_mode: MODES.has(requested) ? requested : 'photo_views',
    source_mode: SOURCES.has(sourceMode) ? sourceMode : 'existing_assets',
    observation_point_target: Math.max(1, Math.min(30, Math.round(Number(source.observation_point_target || source.observationPointTarget || current.observation_point_target || 1) || 1))),
    route_brief: cleanText(source.route_brief || source.routeBrief || current.route_brief || '', 1200),
    required_zones: normalizeList(source.required_zones || source.requiredZones),
    camera_path: normalizeList(source.camera_path || source.cameraPath),
    actor_path: normalizeList(source.actor_path || source.actorPath),
    constraints: normalizeList(source.constraints),
    capability_boundary: cleanText(source.capability_boundary || source.capabilityBoundary || '', 500),
  };
  return {
    experience_plan: plan,
    mode,
    knowledge_policy: knowledgePolicy,
    model_meta: {
      used_model: modelResult.used_model,
      fallback_used: modelResult.fallback_used,
      failed_models: modelResult.failed_models,
    },
  };
}

module.exports = { outputSchema, buildResponse };
