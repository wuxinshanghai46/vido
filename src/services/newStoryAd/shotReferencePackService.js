const crypto = require('crypto');
const storage = require('./storageService');
const references = require('./referenceSelectionService');
const directorScenes = require('../storyAdWorkspace/directorSceneService');
const personIdentity = require('./personIdentityContractService');
const productIdentity = require('./productIdentityContractService');
const mediaAdapter = require('./mediaAdapter');
const { completeSpaceLock, layoutSceneReference } = require('./sceneBindingService');

const SHOT_REFERENCE_PACK_VERSION = 1;
const OUTPUT_KIND = 'shot_reference_packs';

function text(value, max = 1000) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function worldIdFor(shot = {}, sceneAsset = {}) {
  return text(shot.scene_world_id || shot.scene_id || shot.scene_asset_id || sceneAsset.id || sceneAsset.scene_id, 120);
}

function compile({ taskId = '', shotIndex = 0, ctx = {}, shot = {}, contract = {}, sceneAsset = {}, sceneReference = '', previousFrame = null, includePerson = false, includeProduct = false, layoutReference = '', providerLimit = 4 } = {}) {
  sceneAsset = sceneAsset || {};
  shot = shot || {};
  contract = contract || {};
  const worldId = worldIdFor(shot, sceneAsset);
  const requestedCamera = text(shot.camera_id || contract.camera_id || contract.scene_lock?.camera_id, 120);
  const directorSnapshot = worldId ? directorScenes.activeSnapshot(taskId, worldId, {
    source_revision: Number(sceneAsset.revision || sceneAsset.scene_revision || 0) || 0,
    camera_id: requestedCamera,
  }) : null;
  const candidates = references.keyframeReferenceCandidates(ctx, {
    sceneReference, previousFrame, shot, includePerson, includeProduct, layoutReference,
    directorReference: directorSnapshot?.image_url || '',
  });
  const limit = Math.max(1, Math.min(12, Number(providerLimit) || 4));
  const selected = candidates.slice(0, limit).map((item, order) => ({
    order: order + 1, role: item.role, url: item.url, required: item.required === true,
    reference_hash: fingerprint({ url: item.url, role: item.role }),
  }));
  const source = {
    shot_id: text(shot.id || shot.shot_id || `shot-${shotIndex + 1}`, 120), shot_index: shotIndex,
    person_revision: Number(ctx.person_asset?.revision || ctx.person_asset?.person_revision || 0) || 0,
    scene_revision: Number(sceneAsset.revision || sceneAsset.scene_revision || 0) || 0,
    director_revision: Number(directorSnapshot ? (storage.getOutput(taskId, 'director_scene_states')?.states?.[worldId]?.revision || 0) : 0),
    contract_fingerprint: text(contract.fingerprint || contract.contract_fingerprint, 120), provider_limit: limit,
    references: selected,
  };
  const pack = {
    schema_version: SHOT_REFERENCE_PACK_VERSION, status: 'active_verified', ...source,
    fingerprint: fingerprint(source), compiled_at: new Date().toISOString(),
  };
  const packs = storage.getOutput(taskId, OUTPUT_KIND) || [];
  const prior = packs[shotIndex];
  if (prior?.fingerprint === pack.fingerprint) return prior;
  packs[shotIndex] = pack;
  storage.saveOutput(taskId, OUTPUT_KIND, packs);
  return pack;
}

function referenceUrls(taskId = '', shotIndex = 0, ctx = {}, sceneReference = '', previousFrame = null, shot = {}, contract = {}, sceneAsset = {}) {
  const legacy = taskId && typeof taskId === 'object';
  if (legacy) {
    const legacyValues = { ctx: taskId, sceneReference: typeof shotIndex === 'string' ? shotIndex : '', previousFrame: ctx || null, shot: sceneReference || {}, contract: previousFrame || {}, sceneAsset: shot || {} };
    ({ ctx, sceneReference, previousFrame, shot, contract, sceneAsset } = legacyValues);
  }
  const includePerson = personIdentity.shotPersonRequired(ctx, shot, contract) && !personIdentity.shotForbidsPerson(ctx, shot);
  const includeProduct = productIdentity.shotProductRequired(ctx, shot, contract);
  const layoutReference = completeSpaceLock(sceneAsset) ? layoutSceneReference(sceneAsset)?.url : '';
  const rows = legacy
    ? references.keyframeReferenceUrls(ctx, { sceneReference, previousFrame, shot, includePerson, includeProduct, layoutReference, providerLimit: 4 })
    : compile({ taskId, shotIndex, ctx, sceneReference, previousFrame, shot, contract, sceneAsset, includePerson, includeProduct, layoutReference, providerLimit: 4 }).references.map(item => item.url);
  const seen = new Set();
  return rows.map(mediaAdapter.absolutePublicImageUrl).filter(url => url && !seen.has(url) && !!seen.add(url));
}

module.exports = { SHOT_REFERENCE_PACK_VERSION, OUTPUT_KIND, worldIdFor, compile, referenceUrls, fingerprint };
