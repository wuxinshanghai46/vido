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
  const profileSnapshot = profile => JSON.stringify({
    displayName: String(profile?.displayName || ''), roleName: String(profile?.roleName || ''),
    age: ageValue(profile), appearanceText: String(profile?.appearanceText || ''),
    ethnicity: String(profile?.ethnicity || profile?.ethnic_appearance || ''),
    negativeText: String(profile?.negativeText || ''), looks: lookSnapshot(profile),
    identity_id: String(profile?.identity_id || profile?.id || ''),
    lineage_identity_id: String(profile?.lineage_identity_id || profile?.source_identity_id || profile?.id || ''),
    identity_continuity: String(profile?.identity_continuity || ''),
    aging_mode: String(profile?.aging_mode || ''),
    age_states: (Array.isArray(profile?.age_states) ? profile.age_states : []).map(state => ({
      id: String(state?.id || ''), apparent_age: String(state?.apparent_age || ''),
      story_state: String(state?.story_state || ''), scene_ids: (state?.scene_ids || []).map(String),
    })),
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

export function assertSavedPerson(savedBundle = {}, item = {}, normalizedValues = {}) {
  const savedProfile = (savedBundle?.assets?.people || [])
    .map(row => row.profile || {})
    .find(profile => String(profile.id || '') === String(item.profile?.id || ''));
  const expectedLookIds = (normalizedValues.look_profiles || []).map(look => String(look.id || ''));
  const savedLookIds = (savedProfile?.look_profiles || []).map(look => String(look.id || ''));
  const canonicalAge = value => String(value || '').trim() || 'match_brief';
  if (!savedProfile
    || canonicalAge(savedProfile.age) !== canonicalAge(normalizedValues.age)
    || String(savedProfile.displayName || '') !== String(normalizedValues.displayName || '')
    || String(savedProfile.roleName || '') !== String(normalizedValues.roleName || '')
    || String(savedProfile.ethnicity || '') !== String(normalizedValues.ethnicity || '')
    || String(savedProfile.appearanceText || '') !== String(normalizedValues.appearanceText || '')
    || expectedLookIds.some(id => !savedLookIds.includes(id))
    || String(savedProfile.identity_id || savedProfile.id || '') !== String(normalizedValues.identity_id || normalizedValues.id || item.profile?.id || '')
    || String(savedProfile.aging_mode || '') !== String(normalizedValues.aging_mode || '')) {
    throw new Error('人物信息服务器回读不一致，已停止显示保存成功；请勿继续生成。');
  }
  return savedProfile;
}
