const { cleanText } = require('./contextBuilder');

const VIEW_KEYS = ['master', 'reverse', 'interaction', 'detail'];

function normalizeSceneId(asset = {}, index = 0) {
  return cleanText(asset.scene_id || asset.id || `scene_${index + 1}`, 120);
}

function normalizeSceneView(value = '') {
  const raw = cleanText(value, 40);
  if (VIEW_KEYS.includes(raw)) return raw;
  return '';
}

function semanticSceneView(shot = {}, asset = {}) {
  const available = new Set((Array.isArray(asset.view_images) ? asset.view_images : [])
    .map(view => normalizeSceneView(view?.key || view?.view)).filter(Boolean));
  const supports = key => !available.size || available.has(key);
  const text = [
    shot.shot_size, shot.camera, shot.visual, shot.action, shot.purpose, shot.role,
    shot.title, shot.keyframe_notes,
  ].map(value => String(value || '').toLowerCase()).join(' ');
  if (supports('master') && /全景|远景|建立|整体|空间关系|wide|establish|overview/.test(text)) return 'master';
  if (supports('detail') && /特写|近景|细节|纹理|材质|局部|close[- ]?up|detail|macro/.test(text)) return 'detail';
  if (supports('interaction') && /互动|操作|拿起|放置|触碰|使用|展示|行动|interaction|operate|action|demonstrat/.test(text)) return 'interaction';
  if (supports('reverse') && /反打|侧面|侧向|对话|回应|回头|over.?shoulder|reverse|side view|reaction/.test(text)) return 'reverse';
  if (supports('master')) return 'master';
  return [...available][0] || 'master';
}

function textUnits(value = '') {
  const text = cleanText(value, 1200).toLowerCase();
  const words = text.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
  const chars = [...text.replace(/\s+/g, '')];
  for (let i = 0; i < chars.length - 1; i += 1) words.push(chars[i] + chars[i + 1]);
  return new Set(words);
}

function overlapScore(left = '', right = '') {
  const a = textUnits(left);
  const b = textUnits(right);
  let score = 0;
  a.forEach(token => { if (b.has(token)) score += token.length; });
  return score;
}

function spatialBindingForShot(shot = {}, asset = {}, sceneView = 'master') {
  const contract = asset.scene_contract || {};
  const zones = Array.isArray(contract.zones) ? contract.zones : [];
  const shotText = [shot.visual, shot.action, shot.purpose, shot.role, shot.title, shot.scene_zone].filter(Boolean).join(' ');
  const eligibleZones = zones.filter(zone => !Array.isArray(zone.visible_in_views)
    || !zone.visible_in_views.length || zone.visible_in_views.includes(sceneView));
  const rankedZones = eligibleZones
    .map(zone => ({
      zone,
      score: overlapScore(shotText, [zone.label, zone.purpose, ...(zone.tags || [])].join(' ')),
    }))
    .sort((a, b) => b.score - a.score);
  const selectedZone = rankedZones[0]?.zone || eligibleZones[0] || null;
  const anchors = (Array.isArray(contract.anchors) ? contract.anchors : [])
    .filter(anchor => anchor.required !== false
      && (!Array.isArray(anchor.visible_in_views) || !anchor.visible_in_views.length || anchor.visible_in_views.includes(sceneView)))
    .map(anchor => anchor.id).filter(Boolean);
  const camera = (Array.isArray(contract.cameras) ? contract.cameras : [])
    .find(item => item.view_id === sceneView) || null;
  return {
    camera_id: camera?.id || 'camera_' + sceneView,
    zone_ids: selectedZone?.id ? [selectedZone.id] : [],
    anchor_ids: anchors,
    zone_label: selectedZone?.label || cleanText(shot.scene_zone || shot.sceneZone || shot.zone || shot.purpose || shot.title || '', 160),
  };
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
      scene_revision: Math.max(1, Number(asset.scene_revision || asset.scene_contract?.scene_revision || 1) || 1),
      anchors: (Array.isArray(asset.scene_contract?.anchors) ? asset.scene_contract.anchors : [])
        .map(anchor => ({ id: cleanText(anchor.id || '', 100), label: cleanText(anchor.label || '', 120) })).slice(0, 16),
      zones: (Array.isArray(asset.scene_contract?.zones) ? asset.scene_contract.zones : [])
        .map(zone => ({ id: cleanText(zone.id || '', 100), label: cleanText(zone.label || '', 120), purpose: cleanText(zone.purpose || '', 180) })).slice(0, 16),
      available_views: views.length
        ? views.map((view, viewIndex) => ({
          key: normalizeSceneView(view.key || view.view) || VIEW_KEYS[viewIndex] || 'master',
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
    if (assets.length > 1) {
      const error = new Error(`多场景任务中的 scene_id 无效：${wanted}`);
      error.code = 'SCENE_BINDING_INVALID';
      error.status = 422;
      error.retryable = true;
      throw error;
    }
  }
  if (assets.length === 1) return assets[0];
  const error = new Error(`第 ${Number(index) + 1} 镜未指定多场景任务所需的 scene_id`);
  error.code = 'SCENE_BINDING_REQUIRED';
  error.status = 422;
  error.retryable = true;
  throw error;
}

function sceneVerificationState(asset = {}) {
  const contract = asset.scene_contract || {};
  const qa = contract.cross_view_qa || asset.cross_view_qa || {};
  if (contract.status === 'verified' && qa.pass === true) return 'verified';
  if (contract.status === 'rejected' || qa.pass === false && contract.qa_unavailable !== true) return 'rejected';
  return cleanText(contract.status || 'unverified', 40) || 'unverified';
}

function assertVerifiedSceneAssets(sceneAssets = []) {
  const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
  const invalid = assets.map((asset, index) => ({
    scene_id: normalizeSceneId(asset, index),
    status: sceneVerificationState(asset),
  })).filter(item => item.status !== 'verified');
  if (!invalid.length) return true;
  const error = new Error(`场景资产尚未完成一致性验证：${invalid.map(item => `${item.scene_id}(${item.status})`).join('、')}`);
  error.code = 'SCENE_VERIFICATION_REQUIRED';
  error.status = 422;
  error.retryable = true;
  error.invalid_scenes = invalid;
  throw error;
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
  const requestedRevision = Number(shot.scene_revision || shot.sceneRevision || 0) || 0;
  const actualRevision = Math.max(1, Number(matched.scene_revision || matched.scene_contract?.scene_revision || 1) || 1);
  if (requestedRevision && requestedRevision !== actualRevision) {
    const error = new Error(`镜头绑定的场景版本已失效：${sceneId} 请求 r${requestedRevision}，当前 r${actualRevision}`);
    error.code = 'SCENE_REVISION_MISMATCH';
    error.status = 422;
    error.retryable = true;
    throw error;
  }
  const previousSceneId = cleanText(previousShot?.scene_id || previousShot?.sceneId || '', 120);
  const changedScene = !!previousSceneId && previousSceneId !== sceneId;
  const rawReason = cleanText(shot.transition_reason || shot.transitionReason || '', 240);
  if (changedScene && !rawReason) {
    const error = new Error(`第 ${Number(index) + 1} 镜从 ${previousSceneId} 切换到 ${sceneId}，但缺少与当前剧情相关的转场理由`);
    error.code = 'SCENE_TRANSITION_REASON_REQUIRED';
    error.status = 422;
    error.retryable = true;
    throw error;
  }
  const sceneView = normalizeSceneView(shot.scene_view || shot.sceneView) || semanticSceneView(shot, matched);
  const spatial = spatialBindingForShot(shot, matched, sceneView);

  return {
    ...shot,
    scene_id: sceneId,
    scene_asset_id: sceneId,
    scene_name: cleanText(shot.scene_name || shot.sceneName || matched.name || `任务场景 ${matchedIndex + 1}`, 120),
    scene_revision: actualRevision,
    scene_view: sceneView,
    camera_id: spatial.camera_id,
    scene_zone: spatial.zone_label,
    zone_ids: spatial.zone_ids,
    anchor_ids: spatial.anchor_ids,
    transition_from: changedScene ? previousSceneId : cleanText(shot.transition_from || shot.transitionFrom || '', 120) || undefined,
    transition_reason: rawReason || undefined,
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
    'For each shot, also output scene_revision, scene_view, camera_id, scene_zone, zone_ids, anchor_ids, transition_from and transition_reason.',
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
    scene_revision: Math.max(1, Number(asset.scene_revision || asset.scene_contract?.scene_revision || 1) || 1),
    scene_view: normalizeSceneView(shot.scene_view || '') || semanticSceneView(shot, asset),
    camera_id: cleanText(shot.camera_id || spatialBindingForShot(shot, asset, normalizeSceneView(shot.scene_view || '') || semanticSceneView(shot, asset)).camera_id, 100),
    zone_ids: Array.isArray(shot.zone_ids) ? shot.zone_ids : spatialBindingForShot(shot, asset, normalizeSceneView(shot.scene_view || '') || semanticSceneView(shot, asset)).zone_ids,
    anchor_ids: Array.isArray(shot.anchor_ids) ? shot.anchor_ids : spatialBindingForShot(shot, asset, normalizeSceneView(shot.scene_view || '') || semanticSceneView(shot, asset)).anchor_ids,
    scene_zone: cleanText(shot.scene_zone || '', 160),
    transition_from: cleanText(shot.transition_from || '', 120),
    transition_reason: cleanText(shot.transition_reason || '', 240),
    lock_strength: cleanText(asset.lock_strength || 'standard', 40),
    layout_summary: cleanText(asset.layout_summary || '', 800),
    material_summary: cleanText(asset.material_summary || '', 800),
    style_summary: cleanText(asset.style_summary || '', 500),
    negative: cleanText(asset.negative || '', 800),
    view_images: Array.isArray(asset.view_images) ? asset.view_images : [],
    scene_contract: asset.scene_contract || null,
  };
}

module.exports = {
  VIEW_KEYS,
  bindShotToScene,
  bindShotsToScenes,
  sceneAssetDigest,
  sceneBindingPrompt,
  sceneContractForShot,
  sceneVerificationState,
  assertVerifiedSceneAssets,
  selectSceneAsset,
  semanticSceneView,
  spatialBindingForShot,
};
