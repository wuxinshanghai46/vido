'use strict';

const ageContract = require('./personAgeContractService');

function clean(value = '', max = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function stableId(value = '', fallback = '') {
  return clean(value || fallback, 100).replace(/[^a-z0-9_-]/gi, '_');
}

function normalizeAgingMode(value = '', continuity = '') {
  const normalized = clean(value, 60).toLowerCase();
  if (['natural_aging', 'ageless', 'reincarnation', 'fixed'].includes(normalized)) return normalized;
  if (continuity === 'reincarnation') return 'reincarnation';
  return 'fixed';
}

function normalizeProfile(profile = {}, options = {}) {
  const personId = stableId(profile.id || profile.cast_id, `cast_${Number(options.index || 0) + 1}`);
  const continuity = clean(profile.identity_continuity || profile.identityContinuity || '', 40);
  const identityId = stableId(profile.identity_id || profile.identityId, personId);
  const lineageId = stableId(
    profile.lineage_identity_id || profile.lineageIdentityId || profile.source_identity_id || profile.sourceIdentityId,
    continuity === 'reincarnation' ? `${identityId}_lineage` : identityId,
  );
  const agingMode = normalizeAgingMode(profile.aging_mode || profile.agingMode, continuity);
  const baseAge = ageContract.normalize(profile.apparent_age || profile.apparentAge || profile.age || 'match_brief');
  const sourceStates = Array.isArray(profile.age_states || profile.ageStates) ? (profile.age_states || profile.ageStates) : [];
  const ageStates = (sourceStates.length ? sourceStates : [{
    id: `${personId}_age_base`, name: agingMode === 'ageless' ? '容颜不老' : '基础年龄状态',
    apparent_age: baseAge.value, story_state: '', scene_ids: [],
  }]).slice(0, 12).map((state, index) => {
    const sceneIds = Array.isArray(state.scene_ids || state.sceneIds) ? (state.scene_ids || state.sceneIds) : [];
    const stateBoundToStory = agingMode !== 'fixed'
      || sourceStates.length > 1
      || Boolean(clean(state.story_state || state.storyState || state.phase, 160))
      || sceneIds.some(Boolean);
    const apparent = ageContract.normalize(!stateBoundToStory && baseAge.value !== 'match_brief'
      ? baseAge.value
      : (state.apparent_age || state.apparentAge || state.age || baseAge.value));
    return {
      id: stableId(state.id || state.age_state_id || state.ageStateId, `${personId}_age_${index + 1}`),
      name: clean(state.name || state.label || `年龄状态 ${index + 1}`, 120),
      apparent_age: apparent.value,
      apparent_age_contract: apparent,
      story_state: clean(state.story_state || state.storyState || state.phase, 160),
      scene_ids: [...new Set(sceneIds
        .map(value => clean(value, 120)).filter(Boolean))].slice(0, 24),
      story_state_id: stableId(state.story_state_id || state.storyStateId, `${personId}_state_${index + 1}`),
      change_notes: clean(state.change_notes || state.changeNotes, 600),
    };
  });
  return {
    ...profile,
    identity_id: identityId,
    lineage_identity_id: lineageId,
    identity_continuity: continuity,
    aging_mode: agingMode,
    apparent_age: baseAge.value,
    apparent_age_contract: baseAge,
    age_states: ageStates,
  };
}

function generationLocks(profile = {}, stateId = '') {
  const normalized = normalizeProfile(profile);
  const state = normalized.age_states.find(item => item.id === stateId) || normalized.age_states[0];
  const agingRule = normalized.aging_mode === 'ageless'
    ? 'Chronological time may pass, but the apparent facial age must not increase.'
    : (normalized.aging_mode === 'natural_aging'
      ? 'Change only age-related traits; preserve identity geometry, facial proportions, body identity and skin-tone family.'
      : (normalized.aging_mode === 'reincarnation'
        ? 'This is a distinct identity in the same narrative lineage; do not clone the previous face.'
        : 'Preserve the same apparent age.'));
  return {
    identity_id: normalized.identity_id,
    lineage_identity_id: normalized.lineage_identity_id,
    age_state_id: state?.id || '',
    story_state_id: state?.story_state_id || '',
    age_prompt: ageContract.promptLock(state?.apparent_age || normalized.apparent_age),
    aging_rule: agingRule,
  };
}

module.exports = { normalizeProfile, normalizeAgingMode, generationLocks };
