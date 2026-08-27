'use strict';

function clean(value = '', max = 40) {
  return String(value || '').trim().slice(0, max);
}

function profileInput({ profile = {}, item = {}, contentMode = '' } = {}) {
  const authored = profile.generation_settings || profile.generationSettings
    || item.subject_profile?.generation_settings || item.subject_profile?.generationSettings;
  const defaultType = item.generation_type || (item.dossier_sheet?.image_url
    ? 'global_dossier'
    : (clean(contentMode) === 'narrative_story' ? 'global_dossier' : 'three_view'));
  return {
    ...(item.subject_profile || {}),
    ...profile,
    generation_settings: {
      ...(authored || {}),
      generation_type: authored?.generation_type || defaultType,
    },
  };
}

function runtimeSettings(canonical = {}, item = {}, dossierReady = false) {
  return {
    ...(canonical.generation_settings || {}),
    generation_type: clean(item.generation_type
      || item.subject_profile?.generation_settings?.generation_type
      || (dossierReady ? 'global_dossier' : canonical.generation_settings?.generation_type)),
  };
}

module.exports = { profileInput, runtimeSettings };
