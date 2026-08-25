const { cleanText } = require('./contextBuilder');

function projectCharacters(context = {}, blueprint = {}) {
  const current = Array.isArray(context.cast_profiles) ? context.cast_profiles : [];
  const byId = new Map(current.map(item => [cleanText(item.source_character_id || item.id, 80), item]));
  const byName = new Map(current.map(item => [cleanText(item.name || item.displayName, 120), item]));
  const characters = Array.isArray(blueprint.characters) ? blueprint.characters : [];
  const castProfiles = characters.map((character, index) => {
    const id = cleanText(character.id || `character_${index + 1}`, 80);
    const name = cleanText(character.name || `角色${index + 1}`, 120);
    const prior = byId.get(id) || byName.get(name) || {};
    const projectedAge = cleanText(character.age_range || character.age || prior.age || '', 60);
    const declaredAgeSource = cleanText(character.age_source || character.age_contract?.source || '', 40);
    const ageSource = projectedAge
      ? (declaredAgeSource || (prior.age_source && projectedAge === cleanText(prior.age || prior.age_range || '', 60)
        ? prior.age_source : 'blueprint_inference'))
      : (prior.age_source || '');
    return {
      ...prior,
      id, source_character_id: id, name, displayName: name,
      gender: cleanText(character.gender || prior.gender || 'unspecified', 24),
      age: projectedAge,
      age_range: cleanText(character.age_range || character.age || prior.age_range || prior.age || '', 60),
      age_source: ageSource,
      role: cleanText(character.role || prior.role || '', 120),
      roleName: cleanText(character.role || prior.roleName || prior.role || '', 120),
      relationship: cleanText(character.relationship || prior.relationship || '', 240),
      description: cleanText(character.description || prior.description || '', 1000),
      voice_id: cleanText(character.voice?.voice_id || character.voice_id || prior.voice_id || '', 160),
      voice_tone: cleanText(character.voice?.direction || character.voice_tone || prior.voice_tone || '', 300),
    };
  });
  const speakers = { ...(context.voice_assignments?.speakers || {}) };
  castProfiles.forEach(profile => { if (profile.voice_id) { speakers[profile.id] = profile.voice_id; speakers[profile.name] = profile.voice_id; } });
  return { ...context, cast_profiles: castProfiles, voice_assignments: { ...(context.voice_assignments || {}), speakers } };
}

module.exports = { projectCharacters };
