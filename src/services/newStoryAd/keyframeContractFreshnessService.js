const crypto = require('crypto');
const storage = require('./storageService');
const { buildKeyframeContracts, contractCompilerSignature } = require('./keyframeContractService');
const { bindShotsToScenes } = require('./sceneBindingService');

function imageUrl(frame = {}) {
  return frame.image_url || frame.imageUrl || frame.url || '';
}

function signatureOf(contract = {}) {
  // Always recalculate with the current canonicalizer. Persisted signatures may
  // have been produced by an older compiler that included audit timestamps.
  return String(contractCompilerSignature(contract));
}

function contractMatches(stored = {}, current = {}) {
  return !!stored && !!current
    && String(stored.contract_fingerprint || '') === String(current.contract_fingerprint || '')
    && signatureOf(stored) === signatureOf(current);
}

function persist(taskId, contracts = [], { clearDownstream = false, changedIndexes = [] } = {}) {
  const list = Array.isArray(contracts) ? contracts : [];
  const changed = new Set((Array.isArray(changedIndexes) ? changedIndexes : []).map(Number));
  storage.saveOutput(taskId, 'keyframe_contracts', list);
  const existing = storage.getOutput(taskId, 'keyframes');
  const frames = Array.isArray(existing) ? existing : [];
  let invalidated = 0;
  let metadataUpgraded = 0;
  const refreshed = frames.map((frame, index) => {
    if (!frame || typeof frame !== 'object' || !imageUrl(frame)) return frame;
    const current = list[index] || {};
    const currentFingerprint = String(current.contract_fingerprint || '');
    const currentSignature = signatureOf(current);
    const frameFingerprint = String(frame.contract_fingerprint || frame.contract?.contract_fingerprint || '');
    const embeddedSignature = frame.contract ? signatureOf(frame.contract) : String(frame.contract_compiler_signature || '');
    const semanticsMatch = !embeddedSignature || embeddedSignature === currentSignature;
    if (!changed.has(index) && currentFingerprint && frameFingerprint === currentFingerprint && semanticsMatch) {
      if (frame.contract_compiler_signature === currentSignature) return frame;
      metadataUpgraded += 1;
      return { ...frame, contract_compiler_signature: currentSignature };
    }
    invalidated += 1;
    return {
      ...frame,
      contract_outdated: true,
      contract_outdated_reason: '当前代码重新编译的镜头合同已变化，需按新合同重新生成并验证',
      current_generation_status: 'outdated',
    };
  });
  if (invalidated || metadataUpgraded) storage.saveOutput(taskId, 'keyframes', refreshed);
  if (clearDownstream || invalidated) {
    storage.deleteOutput(taskId, 'video_clips');
    storage.deleteOutput(taskId, 'final_video');
  }
  return { contracts: list, invalidated, metadata_upgraded: metadataUpgraded };
}

/** Compile and compare contracts without changing task state or deleting media. */
function inspect(taskId, { ctx = {}, shots = [] } = {}) {
  const current = buildKeyframeContracts(ctx, shots);
  const stored = storage.getOutput(taskId, 'keyframe_contracts');
  const previous = Array.isArray(stored) ? stored : [];
  const changedIndexes = current
    .map((contract, index) => contractMatches(previous[index], contract) ? -1 : index)
    .filter(index => index >= 0);
  const needsMetadataUpgrade = previous.length === current.length
    && current.some((contract, index) => contractMatches(previous[index], contract)
      && !previous[index]?.contract_compiler_signature);
  return {
    contracts: current,
    previous_contracts: previous,
    changed_indexes: changedIndexes,
    needs_metadata_upgrade: needsMetadataUpgrade,
    needs_refresh: previous.length !== current.length || changedIndexes.length > 0 || needsMetadataUpgrade,
  };
}

function refresh(taskId, { ctx = {}, shots = [], clearDownstream = false } = {}) {
  const inspection = inspect(taskId, { ctx, shots });
  if (inspection.needs_refresh) {
    const result = persist(taskId, inspection.contracts, {
      clearDownstream,
      changedIndexes: inspection.changed_indexes,
    });
    return { ...result, changed_indexes: inspection.changed_indexes, refreshed: true };
  }
  return { contracts: inspection.contracts, invalidated: 0, metadata_upgraded: 0, changed_indexes: [], refreshed: false };
}

function compileCurrentTask(taskId) {
  const task = storage.getTask(taskId);
  if (!task) return { contracts: [], shots: [], ctx: {} };
  const baseCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  const ctx = { ...baseCtx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  const storedShots = storage.getOutput(taskId, 'storyboard_table');
  const shots = bindShotsToScenes(Array.isArray(storedShots) ? storedShots : [], ctx.scene_assets);
  return { ctx, shots, contracts: buildKeyframeContracts(ctx, shots) };
}

function assertCurrent(taskId, index, expectedContract = {}) {
  const current = compileCurrentTask(taskId).contracts[index];
  if (contractMatches(expectedContract, current)) return current;
  const error = new Error(`第 ${index + 1} 镜合同在生成期间发生变化，本次没有继续使用旧合同`);
  error.code = 'KEYFRAME_CONTRACT_CHANGED_DURING_GENERATION';
  error.status = 409;
  error.retryable = true;
  error.details = { shot_number: index + 1, expected_signature: signatureOf(expectedContract), current_signature: signatureOf(current) };
  throw error;
}

function recordProviderAudit(taskId, { generationId = '', index = 0, contract = {}, prompt = '' } = {}) {
  const stored = storage.getOutput(taskId, 'keyframe_provider_audit');
  const audit = stored && typeof stored === 'object' ? stored : { entries: [] };
  const entry = {
    generation_id: String(generationId || ''),
    shot_number: Number(index) + 1,
    contract_fingerprint: String(contract.contract_fingerprint || ''),
    contract_compiler_signature: signatureOf(contract),
    prompt_fingerprint: crypto.createHash('sha256').update(String(prompt || '')).digest('hex'),
    checked_at: new Date().toISOString(),
    status: 'verified_before_provider',
  };
  const entries = [...(Array.isArray(audit.entries) ? audit.entries : []), entry].slice(-200);
  storage.saveOutput(taskId, 'keyframe_provider_audit', { entries, updated_at: entry.checked_at });
  return entry;
}

module.exports = {
  signatureOf,
  contractMatches,
  inspect,
  persist,
  refresh,
  compileCurrentTask,
  assertCurrent,
  recordProviderAudit,
};
