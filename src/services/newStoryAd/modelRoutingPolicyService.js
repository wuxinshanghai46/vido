'use strict';

const SUPPLIER_ORDER = Object.freeze(['webang-maas', 'apismile', 'deyunai', 'aiapi']);

const PROFILES = Object.freeze({
  creative_reasoning: Object.freeze([
    ['webang-maas', 'gpt-5.6-sol'],
    ['apismile', 'claude-opus-4-8'],
    ['deyunai', 'claude-opus-4-7'],
    ['aiapi', 'deepseek-chat'],
  ]),
  structured_reasoning: Object.freeze([
    ['webang-maas', 'gpt-5.6-terra'],
    ['apismile', 'gpt-5.5'],
    ['deyunai', 'claude-opus-4-7'],
    ['aiapi', 'deepseek-chat'],
  ]),
  fast_language: Object.freeze([
    ['webang-maas', 'gpt-5.6-luna'],
    ['apismile', 'gemini-2.5-flash'],
    ['deyunai', 'claude-sonnet-4-6'],
    ['aiapi', 'deepseek-chat'],
  ]),
  vision_quality: Object.freeze([
    ['webang-maas', 'gemini-2.5-pro'],
    ['apismile', 'gemini-3.1-pro-preview'],
    ['deyunai', 'claude-opus-4-7'],
  ]),
});

const STAGE_PROFILE = Object.freeze({
  reference_video_vision: 'vision_quality',
  reference_video_synthesis: 'creative_reasoning',
  story_facts: 'structured_reasoning',
  story_facts_compact_retry: 'fast_language',
  story_facts_repair: 'structured_reasoning',
  person_consistency_qa: 'vision_quality',
  person_dossier_qa: 'vision_quality',
  product_consistency_qa: 'vision_quality',
  storyboard_subject_qa: 'vision_quality',
  scene_vision: 'vision_quality',
  scene_consistency_qa: 'vision_quality',
  scene_panorama_qa: 'vision_quality',
  scene_spatial_qa: 'vision_quality',
  asset_plan: 'creative_reasoning',
  person_plan_character: 'creative_reasoning',
  asset_plan_missing_sections_recovery: 'structured_reasoning',
  asset_plan_section_patch: 'structured_reasoning',
  asset_plan_scene_recovery: 'structured_reasoning',
  asset_plan_story_development: 'creative_reasoning',
  scene_config: 'structured_reasoning',
  scene_config_language_repair: 'fast_language',
  blueprint: 'creative_reasoning',
  blueprint_structure_repair: 'structured_reasoning',
  blueprint_language_repair: 'fast_language',
  blueprint_polish: 'creative_reasoning',
  story_flow_planning: 'structured_reasoning',
  storyboard_table: 'creative_reasoning',
  storyboard_fill_missing: 'structured_reasoning',
  storyboard_rewrite: 'creative_reasoning',
  storyboard_language_repair: 'fast_language',
  qa: 'structured_reasoning',
  json_repair: 'fast_language',
  assist: 'structured_reasoning',
  brief_dialogue: 'fast_language',
  person_keyframe_qa: 'vision_quality',
  pet_consistency_qa: 'vision_quality',
  product_keyframe_qa: 'vision_quality',
  scene_camera_qa: 'vision_quality',
  video_frame_qa: 'vision_quality',
  cross_shot_visual_qa: 'vision_quality',
});

function routeForProfile(profile) {
  const source = PROFILES[profile] || [];
  return source.map(([provider_id, model_id], index) => ({
    provider_id, model_id, priority: index + 1, enabled: true,
  }));
}

function routeForStage(stageId = '') {
  const shortId = String(stageId).replace(/^new_story_ad\./, '');
  return routeForProfile(STAGE_PROFILE[shortId]);
}

function managedStageRoutes() {
  return Object.fromEntries(Object.keys(STAGE_PROFILE).map(shortId => {
    const stageId = `new_story_ad.${shortId}`;
    return [stageId, routeForStage(stageId)];
  }));
}

function audit() {
  return Object.entries(STAGE_PROFILE).map(([shortId, profile]) => ({
    stage_id: `new_story_ad.${shortId}`,
    profile,
    route: routeForProfile(profile).map(item => `${item.provider_id}/${item.model_id}`),
  }));
}

module.exports = { SUPPLIER_ORDER, PROFILES, STAGE_PROFILE, routeForProfile, routeForStage, managedStageRoutes, audit };
