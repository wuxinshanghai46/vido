'use strict';

const crypto = require('crypto');

const ERA_FAMILIES = new Set([
  'auto', 'chinese_historical', 'republican_china', 'xianxia', 'wuxia',
  'modern_china', 'modern_overseas', 'western_historical', 'medieval',
  'future', 'post_apocalyptic', 'cyberpunk', 'mixed', 'custom',
]);
const FIDELITY_MODES = new Set(['historical_realism', 'stylized_history', 'fantasy', 'contemporary_realism', 'custom']);
const VISUAL_MEDIA = new Set(['auto', 'live_action', 'cinematic_3d', 'anime_2d', 'motion_comic', 'mixed_media', 'custom']);

function clean(value = '', max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value, maxItems = 16, maxLength = 120) {
  const rows = Array.isArray(value) ? value : String(value || '').split(/[\n,，;；]/u);
  return [...new Set(rows.map(item => clean(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function evidenceText(evidence = {}) {
  const reference = evidence.reference_video_analysis || evidence.referenceVideoAnalysis || {};
  const understanding = reference.reference_understanding || {};
  return [
    evidence.brief,
    reference.generated_brief,
    reference.summary,
    JSON.stringify(reference.source_facts || {}),
    JSON.stringify(reference.story_outline || {}),
    JSON.stringify(understanding.story_summary || reference.story_summary || {}),
    JSON.stringify(understanding.scenes || reference.scenes || []),
    JSON.stringify(reference.scene_prompts || []),
    JSON.stringify(reference.character_prompts || []),
  ].map(value => clean(value, 12000)).filter(Boolean).join(' ').slice(0, 40000);
}

function inferredEraFamily(text = '') {
  const ancient = /古代|古装|王朝|朝代|前世|江湖|武林|宫廷|皇帝|将军/u.test(text);
  const modern = /现代|当代|现代都市|现代城市|千年后/u.test(text);
  if (ancient && modern) return 'mixed';
  if (/赛博朋克|cyberpunk/iu.test(text)) return 'cyberpunk';
  if (/末日|废土|灾后世界/u.test(text)) return 'post_apocalyptic';
  if (/仙侠|修仙|仙门|灵力/u.test(text)) return 'xianxia';
  if (/武侠|武林|江湖|侠客/u.test(text)) return 'wuxia';
  if (/民国|军阀|租界/u.test(text)) return 'republican_china';
  if (/中世纪|骑士|城堡|领主/u.test(text)) return 'medieval';
  if (/未来感|未来科技|未来城市|未来世界|虚拟数字空间|数字工作室|全息投影|星际空间/u.test(text)) return 'future';
  if (ancient && /中国|江南|中原|皇城|宋|唐|明|清/u.test(text)) return 'chinese_historical';
  if (ancient && /欧洲|西方|维多利亚|罗马/u.test(text)) return 'western_historical';
  if (modern && /中国|国内|上海|北京|深圳|广州|江南/u.test(text)) return 'modern_china';
  if (modern && /海外|欧洲|美国|法国|英国|日本|韩国/u.test(text)) return 'modern_overseas';
  return 'auto';
}

function inferredVisualMedium(text = '', evidence = {}) {
  if (/混合媒介|真人.{0,12}(?:动画|动漫|插画)|(?:动画|动漫|插画).{0,12}真人/u.test(text)) return 'mixed_media';
  if (/动态漫|motion comic|分镜漫画|插画动画/iu.test(text)) return 'motion_comic';
  if (/2D\s*动漫|二维动画|赛璐璐|日式动漫|动画线稿/iu.test(text)) return 'anime_2d';
  if (/3D\s*动画|三维动画|全CG|CGI\s*动画|电影级CG/iu.test(text)) return 'cinematic_3d';
  if (/真人实拍|真人摄影|实景拍摄|实拍画面|真实摄影|真人演员/u.test(text)) return 'live_action';
  const reference = evidence.reference_video_analysis || evidence.referenceVideoAnalysis || {};
  const contentForm = clean(evidence.content_form || evidence.contentForm, 80).toLowerCase();
  const referenceReady = String(reference.status || '').toLowerCase() === 'completed'
    && reference.analysis_quality?.valid === true;
  if (referenceReady && /live_action/.test(contentForm)
    && /人物服装|肤色|面部化妆|面部淡妆|西装|运动鞋|真实可见动作/u.test(text)) return 'live_action';
  return 'auto';
}

function normalizeProfile(input = {}, index = 0) {
  const requestedFamily = clean(input.era_family || input.eraFamily || input.family || 'auto', 40).toLowerCase();
  const eraFamily = ERA_FAMILIES.has(requestedFamily) ? requestedFamily : 'custom';
  const requestedFidelity = clean(input.fidelity_mode || input.fidelityMode || '', 40).toLowerCase();
  const fidelityMode = FIDELITY_MODES.has(requestedFidelity)
    ? requestedFidelity
    : (['xianxia', 'wuxia', 'future', 'post_apocalyptic', 'cyberpunk'].includes(eraFamily) ? 'fantasy' : 'contemporary_realism');
  const requestedMedium = clean(input.visual_medium || input.visualMedium || input.medium || 'auto', 40).toLowerCase();
  return {
    id: clean(input.id || `world_${index + 1}`, 80),
    era_family: eraFamily,
    era_family_source: clean(input.era_family_source || input.eraFamilySource, 80),
    time_period: clean(input.time_period || input.timePeriod || input.period, 160),
    region: clean(input.region?.label || input.region || input.location, 160),
    culture: list(input.culture, 12, 100),
    genre_tags: list(input.genre_tags || input.genreTags, 12, 80),
    fidelity_mode: fidelityMode,
    visual_medium: VISUAL_MEDIA.has(requestedMedium) ? requestedMedium : 'custom',
    visual_medium_source: clean(input.visual_medium_source || input.visualMediumSource, 80),
    world_rules: list(input.world_rules || input.worldRules, 16, 180),
    required_elements: list(input.required_elements || input.requiredElements, 16, 120),
    forbidden_elements: list(input.forbidden_elements || input.forbiddenElements, 16, 120),
    visual_invariants: input.visual_invariants && typeof input.visual_invariants === 'object'
      ? JSON.parse(JSON.stringify(input.visual_invariants))
      : {},
    knowledge_refs: list(input.knowledge_refs || input.knowledgeRefs, 16, 160),
  };
}

function infer(input = null, evidence = {}) {
  const contract = normalize(input);
  const text = evidenceText(evidence);
  if (!text) return contract;
  const profile = contract.profiles[0] || {};
  const reference = evidence.reference_video_analysis || evidence.referenceVideoAnalysis || {};
  const source = String(reference.status || '').toLowerCase() === 'completed'
    && reference.analysis_quality?.valid === true ? 'reference_analysis' : 'content_inference';
  const eraFamily = profile.era_family === 'auto' ? inferredEraFamily(text) : profile.era_family;
  const visualMedium = profile.visual_medium === 'auto' ? inferredVisualMedium(text, evidence) : profile.visual_medium;
  if (eraFamily === profile.era_family && visualMedium === profile.visual_medium) return contract;
  const profiles = contract.profiles.map((item, index) => index ? item : {
    ...item,
    era_family: eraFamily,
    era_family_source: eraFamily !== profile.era_family ? source : (item.era_family_source || 'user'),
    visual_medium: visualMedium,
    visual_medium_source: visualMedium !== profile.visual_medium ? source : (item.visual_medium_source || 'user'),
  });
  return normalize({
    ...contract,
    status: contract.authority?.user_confirmed === true ? contract.status : 'draft',
    profiles,
    authority: {
      ...(contract.authority || {}),
      source,
      user_confirmed: contract.authority?.user_confirmed === true,
    },
  });
}

function normalize(input = null) {
  const source = input && typeof input === 'object' ? input : {};
  const rawProfiles = Array.isArray(source.profiles) && source.profiles.length ? source.profiles : [source];
  const profiles = rawProfiles.slice(0, 8).map(normalizeProfile);
  const primary = profiles[0];
  const needsDetail = ['modern_overseas', 'western_historical', 'medieval', 'custom'].includes(primary.era_family);
  const explicitlyDraft = source.status === 'draft';
  const userConfirmed = source.authority?.user_confirmed === true || source.user_confirmed === true;
  const confirmed = source.status === 'confirmed'
    || userConfirmed
    || (!explicitlyDraft && primary.era_family !== 'auto' && (!needsDetail || Boolean(primary.time_period || primary.region)));
  const canonical = { schema_version: 1, status: confirmed ? 'confirmed' : 'draft', profiles };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return {
    ...canonical,
    revision: Math.max(1, Number(source.revision || 1) || 1),
    authority: {
      source: clean(source.authority?.source || source.source || (confirmed ? 'user' : 'system_default'), 40),
      user_confirmed: userConfirmed,
    },
    bindings: source.bindings && typeof source.bindings === 'object' ? source.bindings : {},
    fingerprint,
  };
}

function promptBlock(input = null) {
  const contract = normalize(input);
  const selected = contract.profiles.map(profile => ({
    id: profile.id, era_family: profile.era_family, time_period: profile.time_period,
    region: profile.region, fidelity_mode: profile.fidelity_mode, visual_medium: profile.visual_medium,
    required: profile.required_elements, forbidden: profile.forbidden_elements,
  }));
  return `World-setting authority (${contract.status}, schema v1): ${JSON.stringify(selected).slice(0, 420)}. Bind each scene/look to one profile; never merge periods or media. Auto/blank values must be inferred only from current brief/script evidence, without invented specificity. historical_realism forbids anachronisms; stylized_history preserves declared facts; fantasy follows explicit rules. visual_medium locks people, scenes, storyboards, keyframes and video QA.`;
}

function primaryVisualMedium(input = null) {
  return normalize(input).profiles[0]?.visual_medium || 'auto';
}

function visualMediumPrompt(value = 'auto', scope = 'frame') {
  const medium = VISUAL_MEDIA.has(String(value)) ? String(value) : 'custom';
  const rules = {
    auto: 'Visual medium: infer once from the confirmed brief/script and existing authoritative assets, then lock the same medium across the project.',
    live_action: 'Visual medium: photoreal live action. Use physically believable real-camera optics, natural skin/material response and real-world lighting; no illustration, anime or CGI appearance.',
    cinematic_3d: 'Visual medium: original cinematic 3D animation. Use coherent modeled geometry, stable topology, physically plausible stylized materials and cinematic CG lighting; do not drift into live-action photography or flat 2D line art.',
    anime_2d: 'Visual medium: original 2D anime/cel animation. Preserve stable character line design, cel-shaded forms, controlled color blocks and drawn backgrounds; do not imitate a named artist, studio or protected title.',
    motion_comic: 'Visual medium: original motion-comic/illustrated drama. Use stable illustration design, layered depth and panel-ready compositions while keeping anatomy, props and scene continuity consistent.',
    mixed_media: 'Visual medium: mixed media only where the script declares the boundary. Identify the medium of each world/scene and never morph a character or location between media inside one continuity segment.',
    custom: 'Visual medium: follow the user-defined rendering description exactly and preserve it across all project assets.',
  };
  return `${rules[medium]} Scope: ${scope}.`;
}

module.exports = { ERA_FAMILIES, FIDELITY_MODES, VISUAL_MEDIA, normalizeProfile, normalize, infer, promptBlock, primaryVisualMedium, visualMediumPrompt };
