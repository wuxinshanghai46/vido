function text(value, max = 800) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (!normalized || normalized === '[object Object]') return '';
  return normalized.slice(0, max);
}

function firstText(values = [], max = 800) {
  for (const value of values) {
    const normalized = text(value, max);
    if (normalized) return normalized;
  }
  return '';
}

function profileTexts(profile = {}) {
  const contract = profile.person_contract && typeof profile.person_contract === 'object'
    ? profile.person_contract
    : {};
  return {
    appearanceText: firstText([
      profile.appearanceText,
      profile.appearance?.userPrompt,
      profile.appearance?.description,
      contract.identity?.face_description,
      profile.face_description,
      profile.description,
    ], 800),
    wardrobeText: firstText([
      profile.wardrobeText,
      profile.wardrobe?.userPrompt,
      profile.wardrobe?.description,
      profile.outfit,
      contract.wardrobe?.description,
    ], 600),
    hairMakeupText: firstText([
      profile.hairMakeupText,
      profile.hairMakeup?.userPrompt,
      profile.hairMakeup?.description,
      contract.appearance?.hair_style,
      profile.hair_style,
    ], 400),
    negativeText: firstText([
      profile.negativeText,
      profile.negative,
    ], 500),
  };
}

function canonicalProfile(profile = {}) {
  const resolved = profileTexts(profile);
  return {
    ...profile,
    ...resolved,
    appearance: {
      ...(profile.appearance && typeof profile.appearance === 'object' ? profile.appearance : {}),
      userPrompt: resolved.appearanceText,
    },
    wardrobe: {
      ...(profile.wardrobe && typeof profile.wardrobe === 'object' ? profile.wardrobe : {}),
      userPrompt: resolved.wardrobeText,
    },
    hairMakeup: {
      ...(profile.hairMakeup && typeof profile.hairMakeup === 'object' ? profile.hairMakeup : {}),
      userPrompt: resolved.hairMakeupText,
    },
    outfit: resolved.wardrobeText,
  };
}

module.exports = {
  text,
  firstText,
  profileTexts,
  canonicalProfile,
};
