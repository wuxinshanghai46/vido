const { cleanText } = require('./contextBuilder');
const petIdentity = require('./petIdentityContractService');

function normalizeCastProfiles(parsed = {}, context = {}) {
  const source = Array.isArray(parsed.cast_profiles || parsed.castProfiles)
    ? (parsed.cast_profiles || parsed.castProfiles)
    : (Array.isArray(context.cast_profiles) ? context.cast_profiles : []);
  return source.slice(0, 12).map((profile, index) => ({
    id: cleanText(profile?.id || `cast_${index + 1}`, 80),
    displayName: cleanText(profile?.displayName || profile?.name || '', 120),
    name: cleanText(profile?.displayName || profile?.name || '', 120),
    roleName: cleanText(profile?.roleName || profile?.role || '', 120),
    appearanceText: cleanText(profile?.appearanceText || profile?.appearance?.userPrompt || profile?.appearance || '', 800),
    wardrobeText: cleanText(profile?.wardrobeText || profile?.wardrobe?.userPrompt || profile?.outfit || '', 600),
    hairMakeupText: cleanText(profile?.hairMakeupText || profile?.hairMakeup?.userPrompt || '', 400),
    negativeText: cleanText(profile?.negativeText || profile?.negative || '', 400),
  }));
}

function normalizePetProfiles(parsed = {}, context = {}) {
  const source = Array.isArray(parsed.pet_profiles || parsed.petProfiles)
    ? (parsed.pet_profiles || parsed.petProfiles)
    : (Array.isArray(context.pet_profiles) ? context.pet_profiles : []);
  return source.slice(0, 8).map((profile, index) => ({
    id: cleanText(profile?.id || `pet_${index + 1}`, 80),
    name: cleanText(profile?.name || '', 120),
    type: cleanText(profile?.type || profile?.species || '', 120),
    breed: cleanText(profile?.breed || '', 160),
    appearance: cleanText(profile?.appearance || profile?.description || '', 600),
    reference_images: Array.isArray(profile?.reference_images) ? profile.reference_images : [],
  }));
}

function buildResponse({
  parsed = {},
  context = {},
  mode = 'person_spec',
  modelResult = {},
  enforcePersonSpec,
} = {}) {
  if (typeof enforcePersonSpec !== 'function') {
    throw new TypeError('enforcePersonSpec is required');
  }
  const raw = parsed.person_spec || parsed.personSpec || parsed;
  const spec = enforcePersonSpec(
    raw && typeof raw === 'object' ? raw : {},
    context.person_spec,
    context,
  );
  return {
    person_spec: {
      castMode: cleanText(spec.castMode || spec.cast_mode || 'auto', 40),
      gender: cleanText(spec.gender || 'auto', 40),
      age: cleanText(spec.age || 'match_brief', 40),
      origin: cleanText(spec.origin || 'match_brief', 60),
      roleName: cleanText(spec.roleName || spec.role_name || '', 100),
      displayName: cleanText(spec.displayName || spec.display_name || '', 60),
      expectedPeople: Math.max(0, Math.min(12, Math.round(Number(spec.expectedPeople || spec.expected_people || 0) || 0))),
      appearanceText: cleanText(spec.appearanceText || spec.appearance || spec.description || '', 360),
      wardrobeText: cleanText(spec.wardrobeText || spec.wardrobe || spec.outfit || '', 420),
      hairMakeupText: cleanText(spec.hairMakeupText || spec.hair_makeup || spec.hair || '', 280),
      negativeText: cleanText(spec.negativeText || spec.negative || '', 420),
      ...petIdentity.assistedResponseFields(spec),
    },
    cast_profiles: normalizeCastProfiles(parsed, context),
    pet_profiles: normalizePetProfiles(parsed, context),
    mode,
    model_meta: {
      used_model: modelResult.used_model,
      fallback_used: modelResult.fallback_used,
      failed_models: modelResult.failed_models,
    },
  };
}

module.exports = {
  normalizeCastProfiles,
  normalizePetProfiles,
  buildResponse,
};
