const { cleanText } = require('./contextBuilder');

const VIEW_KEYS = ['master', 'reverse', 'interaction', 'detail'];

function normalizeSceneId(asset = {}, index = 0) {
  return cleanText(asset.scene_id || asset.id || `scene_${index + 1}`, 120);
}

function normalizeSceneView(value = '', index = 0) {
  const raw = cleanText(value, 40);
  if (VIEW_KEYS.includes(raw)) return raw;
  return VIEW_KEYS[index % VIEW_KEYS.length] || 'master';
}

function sceneAssetDigest(sceneAssets = []) {
  return (Array.isArray(sceneAssets) ? sceneAssets : []).map((asset, index) => {
    const views = Array.isArray(asset.view_images) ? asset.view_images : [];
    return {
      scene_id: normalizeSceneId(asset, index),
      name: cleanText(asset.name || `任务场景 ${index + 1}`, 120),
      lock_strength: cleanText(asset.lock_strength || 'standard', 40),
      layout_summary: cleanText(asset.layout_summary || '', 500),
      material_summary: cleanText(asset.material_summary || '', 500),
      style_summary: cleanText(asset.style_summary || '', 300),
      available_views: views.length
        ? views.map((view, viewIndex) => ({
          key: normalizeSceneView(view.key || view.view, viewIndex),
          label: cleanText(view.label || view.name || '', 80),
        }))
        : VIEW_KEYS.map(key => ({ key, label: key })),
    };
  });
}

function selectSceneAsset(sceneAssets = [], sceneId = '', index = 0) {
  const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
  if (!assets.length) return null;
  const wanted = cleanText(sceneId, 120);
  if (wanted) {
    const matched = assets.find((asset, assetIndex) => normalizeSceneId(asset, assetIndex) === wanted);
    if (matched) return matched;
  }
  return assets[Math.min(Math.max(0, Number(index) || 0), assets.length - 1)] || assets[0] || null;
}

function bindShotToScene(shot = {}, sceneAssets = [], index = 0, previousShot = null) {
  const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
  if (!assets.length) {
    return {
      ...shot,
      scene_id: cleanText(shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId || '', 120) || undefined,
      scene_view: cleanText(shot.scene_view || shot.sceneView || '', 40) || undefined,
      scene_zone: cleanText(shot.scene_zone || shot.sceneZone || shot.zone || '', 160) || undefined,
      transition_from: cleanText(shot.transition_from || shot.transitionFrom || '', 120) || undefined,
      transition_reason: cleanText(shot.transition_reason || shot.transitionReason || '', 240) || undefined,
    };
  }

  const matched = selectSceneAsset(assets, shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId, index);
  const matchedIndex = Math.max(0, assets.indexOf(matched));
  const sceneId = normalizeSceneId(matched, matchedIndex);
  const previousSceneId = cleanText(previousShot?.scene_id || previousShot?.sceneId || '', 120);
  const changedScene = !!previousSceneId && previousSceneId !== sceneId;
  const rawReason = cleanText(shot.transition_reason || shot.transitionReason || '', 240);

  return {
    ...shot,
    scene_id: sceneId,
    scene_asset_id: sceneId,
    scene_name: cleanText(shot.scene_name || shot.sceneName || matched.name || `任务场景 ${matchedIndex + 1}`, 120),
    scene_view: normalizeSceneView(shot.scene_view || shot.sceneView || '', index),
    scene_zone: cleanText(shot.scene_zone || shot.sceneZone || shot.zone || shot.purpose || shot.title || '', 160),
    transition_from: changedScene ? previousSceneId : cleanText(shot.transition_from || shot.transitionFrom || '', 120) || undefined,
    transition_reason: changedScene
      ? (rawReason || '剧情进入当前任务已生成的另一个空间资产，需要按镜头目的切换场景。')
      : (rawReason || undefined),
  };
}

function bindShotsToScenes(shots = [], sceneAssets = []) {
  const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
  let previous = null;
  return (Array.isArray(shots) ? shots : []).map((shot, index) => {
    // 只绑定当前任务已有的场景资产，避免模型凭空切换到其他行业或无关空间。
    const bound = bindShotToScene(shot, assets, index, previous);
    previous = bound;
    return bound;
  });
}

function sceneBindingPrompt(sceneAssets = []) {
  const digest = sceneAssetDigest(sceneAssets);
  if (!digest.length) {
    return [
      'Scene asset lock: none.',
      'If the task needs a space, infer it only from the current brief and user controls. Do not use fixed industry scenes or previous task scenes.',
    ].join('\n');
  }
  const ids = digest.map(scene => scene.scene_id).join(', ');
  return [
    'Scene asset lock: enabled.',
    `Available task scene assets: ${JSON.stringify(digest)}`,
    `Every storyboard shot must choose one scene_id from: ${ids}.`,
    'For each shot, also output scene_view, scene_zone, transition_from and transition_reason.',
    'Single-scene task: keep all shots on the same scene_id and vary only scene_view or scene_zone.',
    'Multi-scene task: changing scene_id is allowed only when the story/commercial purpose requires it; transition_reason must explain the change.',
    'Do not invent any specific space, industry environment or location that is not represented by the current task scene assets.',
  ].join('\n');
}

function sceneContractForShot(ctx = {}, shot = {}, index = 0) {
  const assets = Array.isArray(ctx.scene_assets) ? ctx.scene_assets : [];
  const asset = selectSceneAsset(assets, shot.scene_id || shot.scene_asset_id, index);
  if (!asset) return null;
  const assetIndex = Math.max(0, assets.indexOf(asset));
  const sceneId = normalizeSceneId(asset, assetIndex);
  return {
    scene_id: sceneId,
    scene_name: cleanText(shot.scene_name || asset.name || `任务场景 ${assetIndex + 1}`, 120),
    scene_view: normalizeSceneView(shot.scene_view || '', index),
    scene_zone: cleanText(shot.scene_zone || '', 160),
    transition_from: cleanText(shot.transition_from || '', 120),
    transition_reason: cleanText(shot.transition_reason || '', 240),
    lock_strength: cleanText(asset.lock_strength || 'standard', 40),
    layout_summary: cleanText(asset.layout_summary || '', 800),
    material_summary: cleanText(asset.material_summary || '', 800),
    style_summary: cleanText(asset.style_summary || '', 500),
    negative: cleanText(asset.negative || '', 800),
    view_images: Array.isArray(asset.view_images) ? asset.view_images : [],
  };
}

module.exports = {
  VIEW_KEYS,
  bindShotToScene,
  bindShotsToScenes,
  sceneAssetDigest,
  sceneBindingPrompt,
  sceneContractForShot,
  selectSceneAsset,
};
