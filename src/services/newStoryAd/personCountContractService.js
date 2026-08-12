'use strict';

const briefAuthority = require('./briefAuthorityService');
const personLooks = require('./personLookProfileService');

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value = '', max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function positive(value) {
  const parsed = Math.round(Number(value || 0) || 0);
  return parsed > 0 ? parsed : 0;
}

function mergeProfiles(rows = []) {
  const first = rows[0] || {};
  const looks = rows.flatMap(item => personLooks.normalizeLookProfiles(item));
  const uniqueLooks = looks.filter((item, index, source) => (
    source.findIndex(other => clean(other.id || other.story_state || other.name, 160)
      === clean(item.id || item.story_state || item.name, 160)) === index
  ));
  return personLooks.normalizeProfileLooks({
    ...first,
    id: clean(first.lineage_identity_id || first.source_identity_id || first.id, 100),
    name: clean(first.identity_name || first.name || first.displayName, 120),
    displayName: clean(first.identity_name || first.displayName || first.name, 120),
    look_profiles: uniqueLooks,
  });
}

/**
 * Convert either planner profiles or era-separated visual cards into narrative
 * identities. The same living/time-travelling person is grouped across eras;
 * reincarnations remain separate identities.
 */
function narrativeProfiles(profiles = [], options = {}) {
  const source = list(profiles);
  if (!source.length) return [];
  const visual = personLooks.splitCrossEraProfiles(source, { brief: options.brief || '' });
  const groups = new Map();
  visual.forEach((profile, index) => {
    const continuity = clean(profile.identity_continuity, 40).toLowerCase();
    const key = continuity === 'same_person'
      ? `same:${clean(profile.lineage_identity_id || profile.source_identity_id || profile.id, 120)}`
      : `distinct:${clean(profile.source_identity_id || profile.id, 120) || index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(profile);
  });
  return [...groups.values()].map(mergeProfiles);
}

function contract(ctx = {}) {
  const castMode = clean(ctx.cast_mode, 40).toLowerCase();
  if (['no_human', 'animal'].includes(castMode)) {
    return { narrative_identity_count: 0, planning_cast_count: 0, visual_asset_count: 0, narrative_profiles: [], visual_profiles: [] };
  }
  const supplied = list(ctx.narrative_cast_profiles).length
    ? list(ctx.narrative_cast_profiles)
    : list(ctx.cast_profiles);
  const narrative = narrativeProfiles(supplied, { brief: ctx.brief || '' });
  const eraContract = briefAuthority.eraCastContract(ctx.brief || '');
  const visual = narrative.length === 1 && supplied.length === 1 && !eraContract
    ? narrative
    : personLooks.splitCrossEraProfiles(narrative, { brief: ctx.brief || '' });
  const explicitNarrative = positive(ctx.planning_cast_count || ctx.narrative_identity_count);
  const suppliedAsVisualCards = list(ctx.cast_profiles).some(profile => (
    clean(profile.era_identity || profile.eraIdentity, 40)
  ));
  const legacyExpected = positive(ctx.expected_people);
  const narrativeCount = explicitNarrative
    || positive(eraContract?.count)
    || (suppliedAsVisualCards ? narrative.length : Math.max(legacyExpected, narrative.length));
  const visualCount = positive(ctx.visual_asset_count) || visual.length || legacyExpected;
  return {
    narrative_identity_count: narrativeCount,
    planning_cast_count: narrativeCount,
    visual_asset_count: visualCount,
    narrative_profiles: narrative,
    visual_profiles: visual,
  };
}

function fields(ctx = {}) {
  const resolved = contract(ctx);
  return {
    narrative_cast_profiles: resolved.narrative_profiles,
    narrative_identity_count: resolved.narrative_identity_count,
    planning_cast_count: resolved.planning_cast_count,
    visual_asset_count: resolved.visual_asset_count,
  };
}

module.exports = { contract, fields, narrativeProfiles };
