'use strict';

const CONTRACT_VERSION = 1;
const TIGHT_SHOT = /^(?:extreme[_ -]?close[_ -]?up|close[_ -]?up|macro|detail|特写|大特写|近景)$/i;
const DETAIL_VIEW = /^(?:detail|macro|close[_ -]?up)$/i;

function clean(value = '', max = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sceneId(value = {}) {
  return clean(value.scene_id || value.scene_asset_id || value.id, 160);
}

function viewKey(value = {}, index = 0) {
  return clean(value.key || value.view || value.view_id || (index === 0 ? 'master' : ''), 80);
}

function identityView(asset = {}) {
  const views = Array.isArray(asset.view_images) ? asset.view_images : [];
  return views.find((view, index) => viewKey(view, index) === 'master')
    || views.find((view, index) => !DETAIL_VIEW.test(viewKey(view, index)) && viewKey(view, index) !== 'layout')
    || views.find((view, index) => viewKey(view, index) !== 'layout')
    || null;
}

function isReadableContextShot(shot = {}, asset = {}) {
  const identity = identityView(asset);
  const wantedView = clean(shot.scene_view || shot.sceneView, 80);
  const size = clean(shot.shot_size || shot.shotSize, 80);
  const identityKey = identity ? viewKey(identity, 0) : 'master';
  return !TIGHT_SHOT.test(size) && !DETAIL_VIEW.test(wantedView) && (!identity || wantedView === identityKey);
}

function groups(shots = [], sceneAssets = []) {
  const assets = new Map((Array.isArray(sceneAssets) ? sceneAssets : []).map(asset => [sceneId(asset), asset]));
  const rows = new Map();
  (Array.isArray(shots) ? shots : []).forEach((shot, index) => {
    const id = sceneId(shot);
    if (!id) return;
    if (!rows.has(id)) rows.set(id, { scene_id: id, asset: assets.get(id) || {}, shots: [] });
    rows.get(id).shots.push({ shot, index });
  });
  return [...rows.values()];
}

function inspect(shots = [], sceneAssets = []) {
  const scenes = groups(shots, sceneAssets).map(group => {
    const readable = group.shots.filter(item => isReadableContextShot(item.shot, group.asset)).map(item => item.index + 1);
    return {
      scene_id: group.scene_id,
      scene_name: clean(group.asset.name || group.shots[0]?.shot.scene_name || group.scene_id, 160),
      shot_indexes: group.shots.map(item => item.index + 1),
      readable_indexes: readable,
      ready: readable.length > 0,
    };
  });
  const missing = scenes.filter(scene => !scene.ready);
  return {
    contract_version: CONTRACT_VERSION,
    ready: scenes.length > 0 && missing.length === 0,
    scenes,
    missing_scene_ids: missing.map(scene => scene.scene_id),
    issues: missing.map(scene => `${scene.scene_name}缺少能识别完整空间的建立镜头`),
  };
}

function ensureReadableCoverage(shots = [], sceneAssets = []) {
  const source = Array.isArray(shots) ? shots.map(shot => ({ ...shot })) : [];
  groups(source, sceneAssets).forEach(group => {
    if (group.shots.some(item => isReadableContextShot(item.shot, group.asset))) return;
    const selected = [...group.shots].reverse().find(item => !TIGHT_SHOT.test(clean(item.shot.shot_size || item.shot.shotSize, 80)))
      || group.shots[0];
    if (!selected) return;
    const identity = identityView(group.asset);
    const identityKey = identity ? viewKey(identity, 0) : 'master';
    const sceneName = clean(group.asset.name || selected.shot.scene_name || group.scene_id, 160);
    const originalVisual = clean(selected.shot.visual || selected.shot.visual_description, 1400);
    const contextPrefix = `空间建立：清楚呈现${sceneName}的整体布局与主要空间关系。`;
    selected.shot.scene_view = identityKey;
    selected.shot.scene_context_role = 'establishing';
    selected.shot.scene_readability_contract = {
      version: CONTRACT_VERSION,
      scene_id: group.scene_id,
      identity_view: identityKey,
    };
    selected.shot.visual = originalVisual.startsWith(contextPrefix)
      ? originalVisual
      : `${contextPrefix}${originalVisual ? ` ${originalVisual}` : ''}`;
    if (TIGHT_SHOT.test(clean(selected.shot.shot_size || selected.shot.shotSize, 80))) {
      selected.shot.shot_size = 'wide';
      if (!Number(selected.shot.lens_mm) || Number(selected.shot.lens_mm) > 40) selected.shot.lens_mm = 35;
    }
  });
  return source;
}

module.exports = {
  CONTRACT_VERSION,
  identityView,
  inspect,
  isReadableContextShot,
  ensureReadableCoverage,
};
