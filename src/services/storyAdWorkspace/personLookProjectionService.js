const personLooks = require('../newStoryAd/personLookProfileService');
const { normalizeAppearanceAgeText } = require('./personTextProjectionService');
const { projectedDossierItems } = require('./dossierItemProjectionService');
const personEvolution = require('../newStoryAd/personStateEvolutionService');

function clean(value = '', max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function mediaUrl(value = {}) {
  if (typeof value === 'string') return clean(value, 1200);
  return clean(value.image_url || value.url || value.preview_url || value.thumbnail_url, 1200);
}

function personProfile(source = {}, index = 0) {
  const evolved = personEvolution.normalizeProfile(source, { index });
  const withLooks = personLooks.normalizeProfileLooks(evolved);
  return {
    id: clean(source.id || source.cast_id || source.castId || `cast_${index + 1}`, 80),
    displayName: clean(source.displayName || source.display_name || source.name, 120),
    identity_name: clean(source.identity_name || source.identityName || source.displayName || source.name, 120),
    identity_continuity: clean(source.identity_continuity || source.identityContinuity, 40),
    era_identity: clean(source.era_identity || source.eraIdentity, 40),
    era_label: clean(source.era_label || source.eraLabel, 40),
    source_identity_id: clean(source.source_identity_id || source.sourceIdentityId || source.id, 120),
    lineage_identity_id: clean(source.lineage_identity_id || source.lineageIdentityId || source.source_identity_id || source.id, 120),
    name_source: clean(source.name_source || source.nameSource, 80),
    roleName: clean(source.roleName || source.role_name || source.role, 120),
    age: clean(source.age || source.ageRange || source.age_range || 'match_brief', 40),
    ethnicity: clean(source.ethnicity || source.ethnic_appearance, 120),
    ethnicity_source: clean(source.ethnicity_source || source.ethnicitySource, 80),
    appearanceText: normalizeAppearanceAgeText(source.appearanceText || source.appearance?.userPrompt || source.appearance?.description || source.description),
    wardrobeText: clean(withLooks.wardrobeText || source.wardrobe?.userPrompt || source.wardrobe?.description || source.outfit, 1200),
    hairMakeupText: clean(withLooks.hairMakeupText || source.hairMakeup?.userPrompt || source.hairMakeup?.description || source.hair_style, 600),
    negativeText: clean(source.negativeText || source.negative, 600),
    look_profiles: withLooks.look_profiles,
    identity_id: evolved.identity_id,
    lineage_identity_id: evolved.lineage_identity_id,
    aging_mode: evolved.aging_mode,
    apparent_age: evolved.apparent_age,
    age_states: evolved.age_states,
  };
}

function lookAssets(source = [], personId = '') {
  return list(source).map(look => ({
    ...personLooks.normalizeLookProfiles({ id: personId, look_profiles: [look] })[0],
    image_url: mediaUrl(look),
    cover_image_url: clean(look.cover_image_url, 1200) || mediaUrl(look.dossier_sheet),
    dossier_sheet: look.dossier_sheet?.image_url ? {
      image_url: mediaUrl(look.dossier_sheet),
      layout: clean(look.dossier_sheet.layout, 100),
      width: Math.max(0, Number(look.dossier_sheet.width || 0) || 0),
      height: Math.max(0, Number(look.dossier_sheet.height || 0) || 0),
    } : null,
    visual_asset_contract_version: Math.max(0, Number(look.visual_asset_contract_version || 0) || 0),
    body_views: projectedDossierItems(look.body_views),
    wardrobe_details: projectedDossierItems(look.wardrobe_details),
    accessory_details: projectedDossierItems(look.accessory_details),
  }));
}

module.exports = { personProfile, lookAssets };
