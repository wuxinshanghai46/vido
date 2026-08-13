/** 侧栏只统计已经形成图片、视图或档案的真实资产，不把文本规划当成生成结果。 */
function assetHasResult(item = {}, mediaUrl, list) {
  return Boolean(
    mediaUrl(item)
    || mediaUrl(item.dossier_sheet || {})
    || list(item.view_images).some(view => mediaUrl(view))
    || list(item.dossier_items).some(view => mediaUrl(view))
    || mediaUrl(item.layout || {}),
  );
}

function projectCounts(projectedAssets = {}, mediaUrl, list) {
  const groups = Object.values(projectedAssets).map(items => list(items));
  const subjectGroups = ['people', 'animals', 'products', 'logos']
    .map(key => list(projectedAssets[key]));
  const ready = item => assetHasResult(item, mediaUrl, list);
  return {
    assets: groups.flat().filter(ready).length,
    subject_assets: subjectGroups.reduce((sum, items) => sum + items.length, 0),
    ready_subject_assets: subjectGroups.flat().filter(ready).length,
    planned_assets: groups.reduce((sum, items) => sum + items.length, 0),
    scenes: list(projectedAssets.scenes).filter(ready).length,
  };
}

module.exports = { assetHasResult, projectCounts };
