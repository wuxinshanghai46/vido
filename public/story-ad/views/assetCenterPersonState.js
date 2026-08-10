export function personAssetState(item = {}) {
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
  if (!savedProfile
    || String(savedProfile.appearanceText || '') !== String(normalizedValues.appearanceText || '')
    || expectedLookIds.some(id => !savedLookIds.includes(id))) {
    throw new Error('人物信息服务器回读不一致，已停止显示保存成功；请勿继续生成。');
  }
  return savedProfile;
}
