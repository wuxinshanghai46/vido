export function personAgeDisplay(profile={}) {
  const presets={
    infant_0_1:'0~1岁',toddler_1_3:'1~3岁',child_4_7:'4~7岁',child_8_12:'8~12岁',
    teen_13_17:'13~17岁',young_adult_17_25:'17~25岁',young_adult:'25~32岁',
    adult_30_40:'30~40岁',middle_40_55:'40~55岁',senior_55_plus:'55岁以上',
  };
  return profile.age_contract?.display_text||presets[profile.age]||(profile.age==='match_brief'?'':profile.age)||profile.age_range||''
}
export function personAssetState(item = {}) {
  const expectedMedium = String(item.profile?.visual_medium || 'auto');
  const generatedMedium = String(item.visual_medium || '');
  if (expectedMedium !== 'auto' && generatedMedium !== expectedMedium && item.dossier_sheet?.image_url) return 'medium_upgrade_required';
  const ageValue = profile => String(profile?.age_contract?.value || profile?.age || 'match_brief');
  const lookSnapshot = profile => (Array.isArray(profile?.look_profiles) ? profile.look_profiles : []).map(look => ({
    id: String(look?.id || ''), name: String(look?.name || ''), story_state: String(look?.story_state || ''),
    scene_ids: (Array.isArray(look?.scene_ids) ? look.scene_ids : []).map(String),
    wardrobeText: String(look?.wardrobeText || ''), hairMakeupText: String(look?.hairMakeupText || ''),
    negativeText: String(look?.negativeText || ''), style_richness: String(look?.style_richness || 'auto'),
  }));
  const canonicalContinuity = profile => String(profile?.identity_continuity || 'same_person');
  const visualAgeStates = profile => {
    const states = Array.isArray(profile?.age_states) ? profile.age_states : [];
    const evolving = String(profile?.aging_mode || 'fixed') !== 'fixed'
      || states.length > 1
      || states.some(state => String(state?.story_state || '').trim() || (state?.scene_ids || []).length);
    return evolving ? states.map(state => ({
      id: String(state?.id || ''), apparent_age: String(state?.apparent_age || ''),
      story_state: String(state?.story_state || ''), scene_ids: (state?.scene_ids || []).map(String),
    })) : [];
  };
  const profileSnapshot = profile => JSON.stringify({
    displayName: String(profile?.displayName || ''), roleName: String(profile?.roleName || ''),
    age: ageValue(profile), appearanceText: String(profile?.appearanceText || ''),
    performanceText: String(profile?.performanceText || ''), continuityText: String(profile?.continuityText || ''),
    ethnicity: String(profile?.ethnicity || profile?.ethnic_appearance || ''),
    negativeText: String(profile?.negativeText || ''), looks: lookSnapshot(profile),
    identity_id: String(profile?.identity_id || profile?.id || ''),
    lineage_identity_id: String(profile?.lineage_identity_id || profile?.source_identity_id || profile?.id || ''),
    identity_continuity: canonicalContinuity(profile),
    aging_mode: String(profile?.aging_mode || 'fixed'),
    age_states: visualAgeStates(profile),
  });
  if (item.dossier_sheet?.image_url && item.generated_profile
    && profileSnapshot(item.generated_profile) !== profileSnapshot(item.profile)) return 'profile_upgrade_required';
  if (item.dossier_sheet?.image_url && !item.generated_profile && ageValue(item.profile) !== 'match_brief') return 'profile_upgrade_required';
  const expectedLooks = Array.isArray(item.profile?.look_profiles) ? item.profile.look_profiles : [];
  const generatedLookIds = new Set((Array.isArray(item.look_assets) ? item.look_assets : [])
    .filter(look => look?.dossier_sheet?.image_url || look?.image_url)
    .map(look => String(look.id || look.look_id || '')));
  const missingLooks = expectedLooks.filter(look => !generatedLookIds.has(String(look.id || '')));
  if (item.dossier_sheet?.image_url && Number(item.visual_asset_contract_version || 0) >= 2 && !missingLooks.length) return 'complete_dossier';
  if (item.dossier_sheet?.image_url && missingLooks.length) return 'look_upgrade_required';
  if (item.dossier_sheet?.image_url) return 'upgrade_required';
  if (Array.isArray(item.view_images) && item.view_images.length) return 'legacy_views';
  return 'missing';
}

export function personLookSummary(looks = []) {
  return looks.length
    ? `${looks.length}套造型：${looks.map(look => look.name || look.story_state || look.id).filter(Boolean).join(' / ')}`
    : '';
}

function canonicalText(value = '') {
  return [...new Set(String(value || '').split(/[；;]/u)
    .map(part => part.replace(/\s+/gu, ' ').trim()).filter(Boolean))].join('；');
}

function canonicalPrompt(value = '') {
  return String(value || '').replace(/\r\n?/gu, '\n').split('\n').map(line => line.trimEnd()).join('\n').trim();
}

function canonicalGenerationSettings(settings = {}) {
  return {
    model: String(settings.model || 'gpt-image-2'),
    aspect_ratio: String(settings.aspect_ratio || '2:1'),
    quality: 'high',
    resolution: String(settings.resolution || '2K'),
    count: Math.max(1, Number(settings.count || 1) || 1),
  };
}

function canonicalServerProfile(profile = {}) {
  const looks = (profile.look_profiles || []).map(look => ({
    id: String(look.id || ''), name: canonicalText(look.name), story_state: canonicalText(look.story_state),
    wardrobeText: canonicalText(look.wardrobeText), hairMakeupText: canonicalText(look.hairMakeupText),
    negativeText: canonicalText(look.negativeText), style_richness: String(look.style_richness || 'auto'),
    scene_ids: (look.scene_ids || []).map(String),
  }));
  return {
    id: String(profile.id || ''), identity_id: String(profile.identity_id || profile.id || ''),
    displayName: canonicalText(profile.displayName), roleName: canonicalText(profile.roleName),
    age: String(profile.age_contract?.value || profile.age || 'match_brief').trim() || 'match_brief',
    ethnicity: canonicalText(profile.ethnicity || profile.ethnic_appearance),
    appearanceText: canonicalText(profile.appearanceText), performanceText: canonicalText(profile.performanceText),
    continuityText: canonicalText(profile.continuityText), negativeText: canonicalText(profile.negativeText),
    generation_prompt: canonicalPrompt(profile.generation_prompt),
    generation_settings: canonicalGenerationSettings(profile.generation_settings),
    owned_props: (profile.owned_props || []).map(prop => ({
      id: String(prop.id || ''), name: canonicalText(prop.name), description: canonicalText(prop.description),
      material: canonicalText(prop.material), scale: canonicalText(prop.scale),
    })),
    aging_mode: String(profile.aging_mode || ''), looks, look_ids: looks.map(look => look.id),
  };
}

export function assertSavedPerson(savedBundle = {}, item = {}, normalizedValues = {}, mutation = {}) {
  const savedProfile = (savedBundle?.assets?.people || [])
    .map(row => row.profile || {})
    .find(profile => String(profile.id || '') === String(item.profile?.id || ''));
  const mutationProfiles = mutation?.context?.cast_profiles;
  const acknowledgedProfile = (Array.isArray(mutationProfiles) ? mutationProfiles : [savedProfile])
    .find(profile => String(profile?.id || '') === String(item.profile?.id || ''));
  const expectedLookIds = (normalizedValues.look_profiles || []).map(look => String(look.id || ''));
  const saved = canonicalServerProfile(savedProfile);
  const acknowledged = canonicalServerProfile(acknowledgedProfile);
  const submitted = canonicalServerProfile({ ...normalizedValues, id: item.profile?.id || normalizedValues.id });
  const expectedIdentity = String(normalizedValues.identity_id || normalizedValues.id || item.profile?.id || '');
  const requestedAge = String(normalizedValues.age || 'match_brief').trim() || 'match_brief';
  const textFields = ['displayName', 'roleName', 'ethnicity', 'appearanceText', 'performanceText', 'continuityText', 'negativeText', 'generation_prompt'];
  const submittedTextMismatch = textFields.some(field => submitted[field] !== acknowledged[field]);
  if (!savedProfile || !acknowledgedProfile
    || saved.id !== acknowledged.id
    || saved.identity_id !== acknowledged.identity_id
    || acknowledged.identity_id !== expectedIdentity
    || saved.age !== acknowledged.age || acknowledged.age !== requestedAge
    || saved.displayName !== acknowledged.displayName
    || saved.roleName !== acknowledged.roleName
    || saved.ethnicity !== acknowledged.ethnicity
    || saved.appearanceText !== acknowledged.appearanceText
    || saved.performanceText !== acknowledged.performanceText
    || saved.continuityText !== acknowledged.continuityText
    || saved.negativeText !== acknowledged.negativeText
    || JSON.stringify(saved.generation_settings) !== JSON.stringify(acknowledged.generation_settings)
    || JSON.stringify(submitted.generation_settings) !== JSON.stringify(acknowledged.generation_settings)
    || JSON.stringify(saved.owned_props) !== JSON.stringify(acknowledged.owned_props)
    || JSON.stringify(submitted.owned_props) !== JSON.stringify(acknowledged.owned_props)
    || saved.aging_mode !== acknowledged.aging_mode
    || JSON.stringify(saved.looks) !== JSON.stringify(acknowledged.looks)
    || JSON.stringify(submitted.looks) !== JSON.stringify(acknowledged.looks)
    || submittedTextMismatch
    || expectedLookIds.some(id => !acknowledged.look_ids.includes(id) || !saved.look_ids.includes(id))) {
    throw new Error('人物信息服务器回读不一致，已停止显示保存成功；请勿继续生成。');
  }
  return savedProfile;
}
