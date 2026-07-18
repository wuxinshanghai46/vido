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

module.exports = { contractMatchesInput, carryContract, commitGeneratedPersonAsset };
