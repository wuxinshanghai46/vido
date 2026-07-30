const { cleanText } = require('./contextBuilder');
const petIdentity = require('./petIdentityContractService');
const subjectProfileText = require('./subjectProfileTextService');

function resolveAssistSubjectTarget(body = {}, context = {}) {
  const raw = body.assist_subject_target || body.assistSubjectTarget;
  if (!raw || typeof raw !== 'object') return null;
  const kind = cleanText(raw.kind || raw.type || '', 20).toLowerCase();
  if (!['human', 'cast', 'person'].includes(kind)) return null;
  const profiles = Array.isArray(context.cast_profiles) ? context.cast_profiles : [];
  const index = Number(raw.index);
  if (!Number.isInteger(index) || index < 0 || index >= profiles.length) return null;
  const current = profiles[index] || {};
  const currentId = cleanText(current.id || current.cast_id || current.castId || `cast_${index + 1}`, 80);
  const requestedId = cleanText(raw.id || raw.cast_id || raw.castId || '', 80);
  if (requestedId && requestedId !== currentId) return null;
  return { kind: 'human', index, id: currentId, profile: current };
}

function normalizeCastProfiles(parsed = {}, context = {}, target = null) {
  let source = Array.isArray(parsed.cast_profiles || parsed.castProfiles)
    ? (parsed.cast_profiles || parsed.castProfiles)
    : (Array.isArray(context.cast_profiles) ? context.cast_profiles : []);
  if (target?.kind === 'human') {
    const candidate = source.find(profile => cleanText(profile?.id || profile?.cast_id || profile?.castId || '', 80) === target.id)
      || source[0]
      || target.profile
      || {};
    source = [{ ...candidate, id: target.id }];
  }
  return source.slice(0, 12).map((profile, index) => {
    const profileAge = cleanText(
      profile?.age
      || profile?.ageRange
      || context.person_spec?.age
      || context.personSpec?.age
      || '',
      40,
    );
    return {
    ...subjectProfileText.canonicalProfile(profile || {}, { age: profileAge }),
    id: cleanText(profile?.id || `cast_${index + 1}`, 80),
    displayName: cleanText(profile?.displayName || profile?.name || '', 120),
    name: cleanText(profile?.displayName || profile?.name || '', 120),
    roleName: cleanText(profile?.roleName || profile?.role || '', 120),
    age: profileAge || 'match_brief',
  };
  });
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
  target = null,
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
    cast_profiles: normalizeCastProfiles(parsed, context, target),
    pet_profiles: target?.kind === 'human' ? [] : normalizePetProfiles(parsed, context),
    assist_subject_target: target ? { kind: target.kind, index: target.index, id: target.id } : null,
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
  resolveAssistSubjectTarget,
  buildResponse,
};
