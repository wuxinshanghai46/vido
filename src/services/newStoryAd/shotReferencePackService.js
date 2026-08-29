const crypto = require('crypto');
const storage = require('./storageService');
const references = require('./referenceSelectionService');
const directorScenes = require('../storyAdWorkspace/directorSceneService');
const personIdentity = require('./personIdentityContractService');
const productIdentity = require('./productIdentityContractService');
const mediaAdapter = require('./mediaAdapter');
const panoramaProjection = require('./panoramaProjectionService');
const scenePanorama = require('./scenePanoramaService');
const { completeSpaceLock, layoutSceneReference } = require('./sceneBindingService');

const SHOT_REFERENCE_PACK_VERSION = 2;
const OUTPUT_KIND = 'shot_reference_packs';

function text(value, max = 1000) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function worldIdFor(shot = {}, sceneAsset = {}) {
  return text(shot.scene_world_id || shot.scene_id || shot.scene_asset_id || sceneAsset.id || sceneAsset.scene_id, 120);
}

function directorEntityRevisions(ctx = {}) {
  const rows = [
    ctx.person_asset,
    ...((Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : [])),
    ctx.product_asset,
    ...((Array.isArray(ctx.product_assets) ? ctx.product_assets : [])),
    ...((Array.isArray(ctx.assets) ? ctx.assets : []).filter(item => ['person', 'product'].includes(String(item.kind || item.type || item.role || '').toLowerCase()))),
  ].filter(item => item && typeof item === 'object');
  return rows.reduce((result, item) => {
    const id = text(item.subject_id || item.profile?.id || item.asset_id || item.id, 120);
    const revision = Math.max(0, Number(item.revision || item.person_revision || item.entity_revision || 0) || 0);
    if (id && revision) result[id] = revision;
    return result;
  }, {});
}

function activePanorama(sceneAsset = {}) {
  return scenePanorama.authoritativePanorama(sceneAsset || {});
}

function panoramaCameraReference(sceneAsset = {}, shot = {}, contract = {}) {
  sceneAsset = sceneAsset || {};
  const panorama = activePanorama(sceneAsset);
  if (!panorama) return null;
  const cameraId = text(shot.camera_id || contract.camera_id || contract.scene_lock?.camera_id, 120);
  const sceneView = text(shot.scene_view || shot.view_key || contract.scene_view || contract.scene_lock?.scene_view, 80);
  const selected = panoramaProjection.selectDerivedView(panorama, { camera_id: cameraId, scene_view: sceneView });
  return selected?.image_url ? { ...selected, panorama_sha256: panorama.sha256 } : null;
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
    entity_revisions: directorEntityRevisions(ctx),
  }) : null;
  const panoramaReference = panoramaCameraReference(sceneAsset, shot, contract);
  const candidates = references.keyframeReferenceCandidates(ctx, {
    sceneReference, previousFrame, shot, includePerson, includeProduct, layoutReference,
    directorReference: directorSnapshot?.image_url || panoramaReference?.image_url || '',
    storyboardReference: shot.storyboard_image?.status === 'confirmed' ? shot.storyboard_image.image_url : '',
  });
  const limit = Math.max(1, Math.min(12, Number(providerLimit) || 4));
  const required = candidates.filter(item => item.required === true);
  if (required.length > limit) throw Object.assign(new Error(`第 ${shotIndex + 1} 镜有 ${required.length} 张必需参考图，但所选模型最多接收 ${limit} 张；不能静默丢弃人物、场景或分镜构图参考。`), {
    code: 'REQUIRED_REFERENCE_LIMIT_EXCEEDED', status: 422, retryable: false,
    required_roles: required.map(item => item.role), provider_limit: limit,
  });
  const selected = candidates.slice(0, limit).map((item, order) => ({
    order: order + 1, role: item.role, url: item.url, required: item.required === true,
    reference_hash: fingerprint({ url: item.url, role: item.role }),
  }));
  const source = {
    shot_id: text(shot.id || shot.shot_id || `shot-${shotIndex + 1}`, 120), shot_index: shotIndex,
    person_revision: Number(ctx.person_asset?.revision || ctx.person_asset?.person_revision || 0) || 0,
    scene_revision: Number(sceneAsset.revision || sceneAsset.scene_revision || 0) || 0,
    director_revision: Number(directorSnapshot ? (storage.getOutput(taskId, 'director_scene_states')?.states?.[worldId]?.revision || 0) : 0),
    panorama_sha256: text(panoramaReference?.panorama_sha256, 80),
    panorama_view_sha256: text(panoramaReference?.sha256, 80),
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

module.exports = { SHOT_REFERENCE_PACK_VERSION, OUTPUT_KIND, worldIdFor, directorEntityRevisions, activePanorama, panoramaCameraReference, compile, referenceUrls, fingerprint };
