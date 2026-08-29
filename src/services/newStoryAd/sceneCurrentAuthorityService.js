'use strict';

function currentSceneProjectionRows(outputs = [], sceneAssetsInvalidation = null) {
  const rows = Array.isArray(outputs) ? outputs : [];
  if (!sceneAssetsInvalidation) return rows;
  const invalidatedAt = Date.parse(sceneAssetsInvalidation.invalidated_at || '');
  return rows.filter(row => {
    const kind = String(row?.kind || '');
    if (kind === 'scene_assets') return false;
    if (!kind.startsWith('scene_asset_checkpoint:')) return true;
    const checkpointTime = Date.parse(row.updated_at || row.payload?.updated_at || row.created_at || '');
    return Number.isFinite(invalidatedAt) && Number.isFinite(checkpointTime) && checkpointTime > invalidatedAt;
  });
}

function currentSceneAssetsFromBundle(bundle = {}, modelCalls = [], deps = {}) {
  const outputs = Array.isArray(bundle.outputs) ? bundle.outputs : [];
  const invalidated = bundle.manifest?.invalidated || {};
  const hasCurrentSceneConfig = outputs.some(row => String(row?.kind || '') === 'scene_config')
    && !Object.prototype.hasOwnProperty.call(invalidated, 'scene_config');
  if (!hasCurrentSceneConfig) return [];
  const sceneAssetsInvalidation = Object.prototype.hasOwnProperty.call(invalidated, 'scene_assets')
    ? invalidated.scene_assets
    : null;
  return deps.normalizeSceneAssets(deps.projectSceneAssets(
    currentSceneProjectionRows(outputs, sceneAssetsInvalidation),
    modelCalls,
  ));
}

module.exports = { currentSceneProjectionRows, currentSceneAssetsFromBundle };
