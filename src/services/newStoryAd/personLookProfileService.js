function clean(value = '', max = 800) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

const STYLE_RICHNESS = new Set(['auto', 'restrained', 'refined', 'ornate_luxurious']);

function normalizeStyleRichness(value = '') {
  const normalized = clean(value, 40).toLowerCase();
  return STYLE_RICHNESS.has(normalized) ? normalized : 'auto';
}

function stableLookId(profileId = 'cast', value = '', index = 0) {
  const explicit = clean(value, 100).replace(/[^a-z0-9_-]/gi, '_');
  return explicit || `${clean(profileId, 70) || 'cast'}_look_${index + 1}`;
}

function rawLooks(profile = {}) {
  return list(profile.look_profiles || profile.lookProfiles || profile.looks || profile.outfit_variants);
}

function normalizeLookProfiles(profile = {}, options = {}) {
  const profileId = clean(profile.id || profile.cast_id || profile.castId || 'cast', 80);
  const rows = rawLooks(profile);
  const fallbackWardrobe = clean(profile.wardrobeText || profile.wardrobe?.userPrompt || profile.wardrobe || profile.outfit, 1200);
  const fallbackHair = clean(profile.hairMakeupText || profile.hairMakeup?.userPrompt || profile.hair_makeup, 600);
  const fallbackNegative = clean(profile.negativeText || profile.negative || '', 800);
  const source = rows.length ? rows : ((fallbackWardrobe || options.ensure === true) ? [{
    id: `${profileId || 'cast'}_look_1`,
    name: options.defaultName || '默认造型',
    scene_ids: list(options.sceneIds),
    wardrobeText: fallbackWardrobe,
    hairMakeupText: fallbackHair,
    negativeText: fallbackNegative,
    source: 'legacy_scalar_projection',
  }] : []);
  const seen = new Set();
  return source.slice(0, 12).map((look, index) => {
    const id = stableLookId(profileId, look.id || look.look_id || look.lookId, index);
    if (seen.has(id)) {
      const error = new Error(`人物造型 ID 重复：${id}`);
      error.code = 'PERSON_LOOK_ID_DUPLICATE';
      error.status = 400;
      throw error;
    }
    seen.add(id);
    const sceneIds = list(look.scene_ids || look.sceneIds || look.linked_scene_ids)
      .map(value => clean(value?.id || value?.scene_id || value, 120)).filter(Boolean);
    return {
      id,
      name: clean(look.name || look.label || look.story_state || `造型 ${index + 1}`, 120),
      story_state: clean(look.story_state || look.storyState || look.era || '', 160),
      scene_ids: [...new Set(sceneIds)].slice(0, 24),
      scene_names: list(look.scene_names || look.sceneNames)
        .map(value => clean(value, 160)).filter(Boolean).slice(0, 24),
      wardrobeText: clean(look.wardrobeText || look.wardrobe_text || look.wardrobe || look.outfit || fallbackWardrobe, 1200),
      hairMakeupText: clean(look.hairMakeupText || look.hair_makeup_text || look.hairMakeup || fallbackHair, 600),
      negativeText: clean(look.negativeText || look.negative_text || look.negative || fallbackNegative, 800),
      continuityText: clean(look.continuityText || look.continuity_text || look.continuity || '', 600),
      style_family: clean(look.style_family || look.styleFamily || '', 80),
      world_profile_id: clean(look.world_profile_id || look.worldProfileId || '', 80),
      world_revision: Math.max(0, Number(look.world_revision || look.worldRevision || 0) || 0),
      style_richness: normalizeStyleRichness(look.style_richness || look.styleRichness || profile.style_richness || profile.styleRichness),
      wardrobe_contract: look.wardrobe_contract && typeof look.wardrobe_contract === 'object'
        ? JSON.parse(JSON.stringify(look.wardrobe_contract))
        : (look.wardrobeContract && typeof look.wardrobeContract === 'object'
          ? JSON.parse(JSON.stringify(look.wardrobeContract))
          : null),
      knowledge_refs: list(look.knowledge_refs || look.knowledgeRefs)
        .map(value => clean(value, 160)).filter(Boolean).slice(0, 16),
      source: clean(look.source || (rows.length ? 'structured' : 'legacy_scalar_projection'), 80),
    };
  });
}

function primaryLook(profile = {}, options = {}) {
  return normalizeLookProfiles(profile, options)[0] || null;
}

function profileWithLook(profile = {}, look = null) {
  if (!look) return { ...profile };
  return {
    ...profile,
    wardrobeText: look.wardrobeText || '',
    hairMakeupText: look.hairMakeupText || profile.hairMakeupText || '',
    negativeText: [profile.negativeText, look.negativeText].map(value => clean(value, 800)).filter(Boolean).join('；'),
    active_look_id: look.id,
    active_look_name: look.name,
    style_richness: normalizeStyleRichness(look.style_richness || look.styleRichness),
  };
}

function lookForScene(profile = {}, sceneId = '') {
  const looks = normalizeLookProfiles(profile);
  const target = clean(sceneId, 120);
  return looks.find(look => target && look.scene_ids.includes(target))
    || (looks.length === 1 ? looks[0] : null);
}

function lookForShot(profile = {}, shot = {}) {
  const looks = normalizeLookProfiles(profile);
  const explicit = clean(shot.look_id || shot.lookId || '', 100);
  return looks.find(look => explicit && look.id === explicit)
    || lookForScene(profile, shot.scene_id || shot.scene_asset_id || '');
}

function normalizeProfileLooks(profile = {}, options = {}) {
  const looks = normalizeLookProfiles(profile, options);
  const primary = looks[0] || null;
  return {
    ...profile,
    look_profiles: looks,
    wardrobeText: primary?.wardrobeText || clean(profile.wardrobeText || profile.wardrobe || profile.outfit, 1200),
    hairMakeupText: primary?.hairMakeupText || clean(profile.hairMakeupText || profile.hair_makeup, 600),
  };
}

function eraIdentity(look = {}) {
  const value = clean([
    look.story_state, look.storyState, look.era, look.name,
    look.world_profile_id, look.worldProfileId,
  ].filter(Boolean).join(' '), 500);
  if (/(?:现代|当代|今世|今生|都市|modern|contemporary)/i.test(value)) return { key: 'modern', label: '现代' };
  if (/(?:古代|古时|古装|前世|上古|远古|古风|秦|汉|唐|宋|元|明|清|ancient|historical)/i.test(value)) return { key: 'ancient', label: '古代' };
  return null;
}

function stripEraSuffix(value = '') {
  return clean(value, 120).replace(/[（(](?:古代|现代|当代|今世|今生|前世|古时|古装)[）)]$/u, '').trim();
}

function splitCrossEraProfiles(profiles = []) {
  return list(profiles).flatMap((profile, profileIndex) => {
    const looks = normalizeLookProfiles(profile);
    const classified = looks.map(look => ({ look, era: eraIdentity(look) }));
    const eraKeys = new Set(classified.map(item => item.era?.key).filter(Boolean));
    if (looks.length < 2 || eraKeys.size < 2 || classified.some(item => !item.era)) {
      return [{ ...normalizeProfileLooks(profile), source_identity_id: clean(profile.source_identity_id || profile.id || `cast_${profileIndex + 1}`, 100) }];
    }
    const sourceId = clean(profile.source_identity_id || profile.id || `cast_${profileIndex + 1}`, 80);
    const baseName = stripEraSuffix(profile.displayName || profile.name || `人物${profileIndex + 1}`);
    const groups = new Map();
    classified.forEach(({ look, era }) => {
      if (!groups.has(era.key)) groups.set(era.key, { era, looks: [] });
      groups.get(era.key).looks.push(look);
    });
    return [...groups.values()].map(({ era, looks: eraLooks }) => {
      const id = `${sourceId}_${era.key}`.slice(0, 100);
      const name = `${baseName}（${era.label}）`;
      const normalized = normalizeProfileLooks({
        ...profile,
        id,
        name,
        displayName: name,
        look_profiles: eraLooks.map((look, index) => ({ ...look, id: stableLookId(id, look.id, index) })),
      });
      return {
        ...normalized,
        id,
        name,
        displayName: name,
        source_identity_id: sourceId,
        era_identity: era.key,
        era_label: era.label,
      };
    });
  });
}

module.exports = {
  normalizeLookProfiles,
  normalizeProfileLooks,
  primaryLook,
  profileWithLook,
  lookForScene,
  lookForShot,
  stableLookId,
  normalizeStyleRichness,
  eraIdentity,
  splitCrossEraProfiles,
};
