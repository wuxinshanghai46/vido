const storage = require('./storageService');
const revisionService = require('./revisionService');
const personIdentity = require('./personIdentityContractService');

function contractMatchesInput(contract = null, asset = null, spec = {}) {
  if (!contract || contract.status !== 'verified' || contract.cross_view_qa?.pass !== true || !asset) return false;
  const candidate = personIdentity.buildPersonContract(
    { ...asset, person_contract: contract },
    spec || {},
    { revision: contract.person_revision || asset.person_revision || 1 },
  );
  return candidate.reference_fingerprint === contract.reference_fingerprint;
}

function carryContract(contract = {}, revision = 1) {
  const next = {
    ...contract,
    person_revision: Math.max(1, Number(revision || contract.person_revision || 1) || 1),
    updated_at: new Date().toISOString(),
  };
  next.reference_fingerprint = personIdentity.contractFingerprint(next);
  return next;
}

function commitGeneratedPersonAsset(taskId, asset = {}, spec = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const previousCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const oldRevision = Math.max(1, Number(previousCtx.revisions?.person || previousCtx.person_contract?.person_revision || 1) || 1);
  const previousAssetId = String(previousCtx.person_asset?.actor_id || previousCtx.person_asset?.id || '');
  const nextAssetId = String(asset.actor_id || asset.id || '');
  const personRevision = previousAssetId && previousAssetId === nextAssetId ? oldRevision : oldRevision + 1;
  const sourceContract = asset.person_contract && typeof asset.person_contract === 'object'
    ? asset.person_contract
    : personIdentity.buildPersonContract(asset, spec, { revision: personRevision });
  const personContract = carryContract(sourceContract, personRevision);
  const committedAsset = {
    ...asset,
    person_revision: personRevision,
    person_contract: personContract,
    production_usable_actor: personContract.status === 'verified',
  };
  const next = {
    ...previousCtx,
    cast_mode: committedAsset.cast_mode || previousCtx.cast_mode,
    expected_people: committedAsset.expected_people || previousCtx.expected_people,
    person_spec: spec && typeof spec === 'object' ? spec : (previousCtx.person_spec || {}),
    person_asset: committedAsset,
    person_contract: personContract,
    revisions: { ...(previousCtx.revisions || {}), person: personRevision },
  };
  const invalidated = revisionService.invalidateOutputs(storage, taskId, 'person');
  storage.saveOutput(taskId, 'context', next);
  storage.saveOutput(taskId, 'person_contract', personContract);
  storage.updateTask(taskId, { request: next, updated_at: new Date().toISOString() });
  storage.saveStage(taskId, 'person_asset', {
    status: personContract.status === 'verified' ? 'done' : 'review',
    output_summary: personContract.status === 'verified' ? '人物资产已生成并自动验证' : '人物资产已生成，等待处理验证结果',
  });
  return { person_asset: committedAsset, person_contract: personContract, invalidated_outputs: invalidated };
}

function commitGeneratedSubjectAssets(taskId, bundle = {}, spec = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const previousCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const oldRevision = Math.max(1, Number(previousCtx.revisions?.person || 1) || 1);
  const castAssets = Array.isArray(bundle.cast_assets) ? bundle.cast_assets : [];
  const petProfiles = Array.isArray(bundle.pet_profiles) ? bundle.pet_profiles : [];
  const personRevision = oldRevision + 1;
  const personContract = bundle.person_contract ? carryContract(bundle.person_contract, personRevision) : null;
  const personAsset = castAssets.length ? {
    id: `cast_bundle_${taskId}_${personRevision}`,
    actor_asset_id: `cast_bundle_${taskId}_${personRevision}`,
    actor_id: `cast_bundle_${taskId}_${personRevision}`,
    name: castAssets.length === 1 ? (castAssets[0].name || '剧情广告人物') : `剧情广告人物组（${castAssets.length}人）`,
    source: 'new_story_ad_cast_bundle',
    reference_kind: 'synthetic_realistic_actor',
    cast_mode: bundle.counts?.mode || (castAssets.length > 2 ? 'group' : (castAssets.length === 2 ? 'dual' : 'single')),
    expected_people: castAssets.length,
    person_count: castAssets.length,
    image_url: castAssets[0]?.image_url || '',
    view_images: castAssets[0]?.view_images || [],
    cast_assets: castAssets,
    person_revision: personRevision,
    person_contract: personContract,
    subject_board_url: bundle.subject_board_url || '',
    production_usable_actor: personContract?.status === 'verified',
  } : null;
  const castProfiles = castAssets.map((asset, index) => ({
    ...(asset.subject_profile && typeof asset.subject_profile === 'object' ? asset.subject_profile : {}),
    id: asset.actor_id || asset.id || `cast_${index + 1}`,
    name: asset.subject_profile?.displayName || asset.name || `人物${index + 1}`,
    displayName: asset.subject_profile?.displayName || asset.name || `人物${index + 1}`,
    roleName: asset.subject_profile?.roleName || asset.cast_role || `角色${index + 1}`,
    assetId: asset.actor_asset_id || asset.id || '',
    actor_asset_id: asset.actor_asset_id || asset.id || '',
    actor_id: asset.actor_id || '',
    sourceType: asset.reference_kind || 'synthetic_realistic_actor',
    referenceImageUrl: asset.image_url || '',
    image_url: asset.image_url || '',
    extra_image_urls: asset.extra_image_urls || [],
    view_images: asset.view_images || [],
    person_contract: asset.person_contract || null,
    identityLock: { face: true, outfit: true, body: true },
  }));
  const next = {
    ...previousCtx,
    cast_mode: bundle.counts?.mode || previousCtx.cast_mode,
    expected_people: castAssets.length,
    expected_animals: petProfiles.length,
    person_spec: spec && typeof spec === 'object' ? spec : (previousCtx.person_spec || {}),
    person_asset: personAsset,
    person_contract: personContract,
    cast_profiles: castProfiles,
    pet_profiles: petProfiles,
    pet_contract: bundle.pet_contract || null,
    subject_board_url: bundle.subject_board_url || '',
    revisions: { ...(previousCtx.revisions || {}), person: personRevision },
  };
  const invalidated = revisionService.invalidateOutputs(storage, taskId, 'person');
  storage.saveOutput(taskId, 'context', next);
  if (personContract) storage.saveOutput(taskId, 'person_contract', personContract);
  if (bundle.pet_contract) storage.saveOutput(taskId, 'pet_contract', bundle.pet_contract);
  storage.updateTask(taskId, { request: next, updated_at: new Date().toISOString() });
  storage.saveStage(taskId, 'person_asset', {
    status: (!personContract || personContract.status === 'verified') && (!bundle.pet_contract || bundle.pet_contract.status === 'verified') ? 'done' : 'review',
    output_summary: `主体资产已建立：${castAssets.length}个人物、${petProfiles.length}个宠物`,
  });
  return {
    person_asset: personAsset, person_contract: personContract, cast_profiles: castProfiles,
    pet_profiles: petProfiles, pet_contract: bundle.pet_contract || null,
    subject_board_url: bundle.subject_board_url || '', invalidated_outputs: invalidated,
  };
}

module.exports = { contractMatchesInput, carryContract, commitGeneratedPersonAsset, commitGeneratedSubjectAssets };
