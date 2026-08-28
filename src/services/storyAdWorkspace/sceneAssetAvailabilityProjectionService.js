'use strict';

const sceneAssetService = require('../newStoryAd/sceneAssetService');
const sceneAssetFiles = require('../newStoryAd/sceneAssetFileIntegrityService');

function project(asset = {}, { list, clean, mediaUrl } = {}) {
  const integrity = sceneAssetFiles.partitionViews(list(asset.view_images));
  const missingFileViewKeys = integrity.missing
    .map(item => clean(item.view?.key || item.view?.view || `view_${item.index + 1}`, 40));
  if (!missingFileViewKeys.length) return asset;
  const availableViews = integrity.available.map(item => item.view);
  const failedViewKeys = [...new Set([...(asset.failed_view_keys || []), ...missingFileViewKeys])];
  const primary = sceneAssetFiles.inspect(asset.image_url || asset.url).available
    ? mediaUrl(asset)
    : mediaUrl(availableViews[0] || {});
  return {
    ...asset,
    image_url: primary,
    url: primary,
    view_images: availableViews,
    view_count: availableViews.length,
    failed_view_keys: failedViewKeys,
    missing_file_view_keys: missingFileViewKeys,
    repair_plan: sceneAssetService.buildSceneRepairPlan({
      ...asset, view_images: availableViews, failed_view_keys: failedViewKeys,
    }),
  };
}

module.exports = { project };
