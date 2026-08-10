'use strict';

const crypto = require('crypto');

const ERA_FAMILIES = new Set([
  'auto', 'chinese_historical', 'republican_china', 'xianxia', 'wuxia',
  'modern_china', 'modern_overseas', 'western_historical', 'medieval',
  'future', 'post_apocalyptic', 'cyberpunk', 'mixed', 'custom',
]);
const FIDELITY_MODES = new Set(['historical_realism', 'stylized_history', 'fantasy', 'contemporary_realism', 'custom']);

function clean(value = '', max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value, maxItems = 16, maxLength = 120) {
  const rows = Array.isArray(value) ? value : String(value || '').split(/[\n,，;；]/u);
  return [...new Set(rows.map(item => clean(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function normalizeProfile(input = {}, index = 0) {
  const requestedFamily = clean(input.era_family || input.eraFamily || input.family || 'auto', 40).toLowerCase();
  const eraFamily = ERA_FAMILIES.has(requestedFamily) ? requestedFamily : 'custom';
  const requestedFidelity = clean(input.fidelity_mode || input.fidelityMode || '', 40).toLowerCase();
  const fidelityMode = FIDELITY_MODES.has(requestedFidelity)
    ? requestedFidelity
    : (['xianxia', 'wuxia', 'future', 'post_apocalyptic', 'cyberpunk'].includes(eraFamily) ? 'fantasy' : 'contemporary_realism');
  return {
    id: clean(input.id || `world_${index + 1}`, 80),
    era_family: eraFamily,
    time_period: clean(input.time_period || input.timePeriod || input.period, 160),
    region: clean(input.region?.label || input.region || input.location, 160),
    culture: list(input.culture, 12, 100),
    genre_tags: list(input.genre_tags || input.genreTags, 12, 80),
    fidelity_mode: fidelityMode,
    world_rules: list(input.world_rules || input.worldRules, 16, 180),
    required_elements: list(input.required_elements || input.requiredElements, 16, 120),
    forbidden_elements: list(input.forbidden_elements || input.forbiddenElements, 16, 120),
    visual_invariants: input.visual_invariants && typeof input.visual_invariants === 'object'
      ? JSON.parse(JSON.stringify(input.visual_invariants))
      : {},
    knowledge_refs: list(input.knowledge_refs || input.knowledgeRefs, 16, 160),
  };
}

function normalize(input = null) {
  const source = input && typeof input === 'object' ? input : {};
  const rawProfiles = Array.isArray(source.profiles) && source.profiles.length ? source.profiles : [source];
  const profiles = rawProfiles.slice(0, 8).map(normalizeProfile);
  const primary = profiles[0];
  const needsDetail = ['modern_overseas', 'western_historical', 'medieval', 'custom'].includes(primary.era_family);
  const confirmed = source.status === 'confirmed'
    || source.user_confirmed === true
    || (primary.era_family !== 'auto' && (!needsDetail || Boolean(primary.time_period || primary.region)));
  const canonical = { schema_version: 1, status: confirmed ? 'confirmed' : 'draft', profiles };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return {
    ...canonical,
    revision: Math.max(1, Number(source.revision || 1) || 1),
    authority: {
      source: clean(source.authority?.source || source.source || (confirmed ? 'user' : 'system_default'), 40),
      user_confirmed: confirmed,
    },
    bindings: source.bindings && typeof source.bindings === 'object' ? source.bindings : {},
    fingerprint,
  };
}

function promptBlock(input = null) {
  const contract = normalize(input);
  const selected = contract.profiles.map(profile => ({
    id: profile.id, era_family: profile.era_family, time_period: profile.time_period,
    region: profile.region, fidelity_mode: profile.fidelity_mode,
    required: profile.required_elements, forbidden: profile.forbidden_elements,
  }));
  return `World-setting authority (${contract.status}, schema v1): ${JSON.stringify(selected).slice(0, 520)}. Bind every scene and character look to one world profile; never merge different periods into one look. historical_realism forbids invented anachronisms; stylized_history may stylize but must preserve declared facts; fantasy follows explicit world rules.`;
}

module.exports = { ERA_FAMILIES, FIDELITY_MODES, normalizeProfile, normalize, promptBlock };
