const storageDefault = require('./storageService');
const deyunaiDefault = require('../deyunaiService');
const personIdentityDefault = require('./personIdentityContractService');
const cancellation = require('./cancellationContext');

function groupType(ctx = {}) {
  return ctx.person_asset?.real_person_reference === true || ctx.person_context?.real_person_locked === true ? 'LivenessFace' : 'AIGC';
}

function referenceUrl(ctx = {}) {
  const contract = ctx.person_contract || ctx.person_asset?.person_contract || {};
  const refs = contract.reference_views || {};
  return [refs.front, ...Object.values(refs), ctx.person_asset?.image_url, ctx.person_asset?.url].find(Boolean) || '';
}

async function prepare({ taskId = '', ctx = {}, options = {}, toAbsolute, deps = {} } = {}) {
  const storage = deps.storage || storageDefault;
  const deyunaiService = deps.deyunaiService || deyunaiDefault;
  const personIdentity = deps.personIdentity || personIdentityDefault;
  if (!personIdentity.personRequired(ctx)) return null;
  personIdentity.assertVerifiedPerson(ctx);
  const master = ctx.person_asset || {};
  const cast = Array.isArray(master.cast_assets) && master.cast_assets.length ? master.cast_assets : [master];
  const saved = storage.getOutput(taskId, 'deyunai_person_asset') || {};
  const savedRows = Array.isArray(saved.assets) ? saved.assets : (saved.asset_id ? [saved] : []);
  const personRevision = ctx.person_contract?.person_revision || master.person_revision || 1;
  const assets = [];
  for (let index = 0; index < cast.length; index += 1) {
    const member = cast[index] || {};
    const sourceUrl = toAbsolute(referenceUrl({ ...ctx, person_asset: member }), options);
    if (!sourceUrl) {
      const error = new Error(`人物 ${index + 1} 没有可上传到 Seedance 人物资产库的正面参考图`);
      error.code = 'DEYUNAI_PERSON_REFERENCE_REQUIRED'; error.status = 422;
      throw error;
    }
    const personKey = String(member.actor_id || member.actor_asset_id || member.id || ctx.person_contract?.person_id || `${taskId}_person_${index + 1}`).replace(/[^a-z0-9_.-]+/ig, '_').slice(0, 42);
    const selectedAssetId = String(member.deyunai_asset_id || (cast.length === 1 ? master.deyunai_asset_id : '') || '').trim();
    const selectedStatus = String(member.deyunai_asset_status || (cast.length === 1 ? master.deyunai_asset_status : '') || '').trim();
    const persisted = savedRows.find(row => String(row.person_key || '') === personKey || String(row.source_url || '') === sourceUrl) || null;
    const resolvedGroupType = member.real_person_reference === true || master.real_person_reference === true ? 'LivenessFace' : 'AIGC';
    const existing = selectedAssetId && /^active$/i.test(selectedStatus)
      ? { asset_id: selectedAssetId, status: 'Active', source_url: sourceUrl, group_id: member.deyunai_asset_group_id || master.deyunai_asset_group_id || '', group_type: member.deyunai_asset_group_type || master.deyunai_asset_group_type || resolvedGroupType }
      : persisted;
    const uploaded = await deyunaiService.ensurePersonImageAsset({
      sourceUrl, name: `vido_${personKey}_v${personRevision}`, groupName: `vido_person_${personKey}_v${personRevision}`,
      groupType: resolvedGroupType, groupId: member.deyunai_asset_group_id || master.deyunai_asset_group_id || '',
      projectName: options.deyunai_project_name || options.deyunaiProjectName || 'default', existing, signal: cancellation.signal(),
    });
    assets.push({ ...uploaded, person_key: personKey, actor_asset_id: member.actor_asset_id || member.id || '' });
  }
  const providerBundle = {
    status: assets.every(asset => /^active$/i.test(String(asset.status || ''))) ? 'Active' : 'Pending',
    asset_id: assets[0]?.asset_id || '', asset_url: assets[0]?.asset_url || '',
    asset_ids: assets.map(asset => asset.asset_id).filter(Boolean), asset_urls: assets.map(asset => asset.asset_url).filter(Boolean),
    assets, person_revision: personRevision, updated_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, 'deyunai_person_asset', providerBundle);
  const latestCtx = storage.getOutput(taskId, 'context') || ctx;
  const latestMaster = latestCtx.person_asset || master;
  const nextCast = Array.isArray(latestMaster.cast_assets) && latestMaster.cast_assets.length ? latestMaster.cast_assets.map((member, index) => ({
    ...member,
    deyunai_asset_id: assets[index]?.asset_id || member.deyunai_asset_id || '', deyunai_asset_status: assets[index]?.status || member.deyunai_asset_status || '',
    deyunai_asset_group_id: assets[index]?.group_id || member.deyunai_asset_group_id || '', deyunai_asset_group_type: assets[index]?.group_type || member.deyunai_asset_group_type || '',
  })) : latestMaster.cast_assets;
  const nextPersonAsset = {
    ...latestMaster,
    deyunai_asset_id: assets[0]?.asset_id || latestMaster.deyunai_asset_id || '', deyunai_asset_status: assets[0]?.status || latestMaster.deyunai_asset_status || '',
    deyunai_asset_group_id: assets[0]?.group_id || latestMaster.deyunai_asset_group_id || '', deyunai_asset_group_type: assets[0]?.group_type || latestMaster.deyunai_asset_group_type || '',
    ...(nextCast ? { cast_assets: nextCast } : {}),
  };
  const nextCtx = { ...latestCtx, person_asset: nextPersonAsset };
  storage.saveOutput(taskId, 'context', nextCtx);
  storage.updateTask(taskId, { request: nextCtx, updated_at: new Date().toISOString() });
  return providerBundle;
}

module.exports = { groupType, referenceUrl, prepare };
