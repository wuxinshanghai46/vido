const { cleanText, normalizeSceneSpec } = require('./contextBuilder');

// 这四个键只用于现有“五视图空间锁”的向后兼容，不再作为业务镜位白名单。
const VIEW_KEYS = ['master', 'reverse', 'interaction', 'detail'];
const REQUIRED_SPACE_VIEW_KEYS = [...VIEW_KEYS, 'layout'];

function normalizeSceneId(asset = {}, index = 0) {
  return cleanText(asset.scene_id || asset.id || `scene_${index + 1}`, 120);
}

function normalizeSceneView(value = '') {
  const raw = cleanText(value, 40);
  // layout 是空间证据图，不是商业成片镜位；其余任务自定义镜位 ID 均原样保留。
  return raw && raw !== 'layout' ? raw : '';
}

function sceneViewKey(view = {}, index = 0) {
  const raw = cleanText(view?.key || view?.view || '', 40);
  if (raw) return raw;
  return VIEW_KEYS[index] || '';
}

function primarySceneViews(asset = {}) {
  return (Array.isArray(asset.view_images) ? asset.view_images : [])
    .filter((view, index) => sceneViewKey(view, index) !== 'layout');
}

function layoutSceneReference(asset = {}) {
  if (!asset || typeof asset !== 'object') return null;
  const views = Array.isArray(asset.view_images) ? asset.view_images : [];
  const view = views.find((item, index) => sceneViewKey(item, index) === 'layout');
  if (!view) return null;
  return {
    key: 'layout',
    label: cleanText(view.label || view.name || '俯视布局', 80),
    url: cleanText(view.url || view.image_url || '', 1000),
    image_url: cleanText(view.image_url || view.url || '', 1000),
    role: 'auxiliary_spatial_lock',
  };
}

function completeSceneViewEvidence(asset = {}) {
  if (!asset || typeof asset !== 'object') return false;
  const views = Array.isArray(asset.view_images) ? asset.view_images : [];
  const identities = REQUIRED_SPACE_VIEW_KEYS.map(key => {
    const view = views.find((item, index) => sceneViewKey(item, index) === key);
    const url = cleanText(view?.url || view?.image_url || '', 1000);
    return url ? url.split(/[?#]/, 1)[0] : '';
  });
  return identities.every(Boolean) && new Set(identities).size === REQUIRED_SPACE_VIEW_KEYS.length;
}

function completeSpaceLock(asset = {}) {
  if (!asset || typeof asset !== 'object') return false;
  const contract = asset.scene_contract || {};
  const requirementQa = contract.requirement_qa || asset.requirement_qa || {};
  const photographicRealismQa = contract.photographic_realism_qa || asset.photographic_realism_qa || {};
  const cameraDesignQa = contract.camera_design_qa || asset.camera_design_qa || {};
  const crossViewQa = contract.cross_view_qa || asset.cross_view_qa || {};
  const spatialQa = contract.spatial_coverage_qa || asset.spatial_coverage_qa || {};
  const layoutContract = contract.layout_contract || asset.layout_contract || {};
  const schemaVersion = Number(contract.schema_version || asset.schema_version || 0) || 0;
  const layoutReference = layoutSceneReference(asset);
  return schemaVersion >= 6
    && contract.status === 'verified'
    && requirementQa.pass === true
    && photographicRealismQa.pass === true
    && cameraDesignQa.pass === true
    && crossViewQa.pass === true
    && spatialQa.pass === true
    && layoutContract.status === 'available'
    && !!layoutReference?.url
    && completeSceneViewEvidence(asset);
}

function legacySpaceLock(asset = {}) {
  const contract = asset.scene_contract || {};
  const spatialQa = contract.spatial_coverage_qa || asset.spatial_coverage_qa || null;
  return Number(contract.source_schema_version || contract.schema_version || asset.schema_version || 0) < 3
    || !spatialQa
    || spatialQa.legacy === true
    || spatialQa.coverage_status === 'legacy_partial'
    || contract.compatibility_status === 'legacy_partial';
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

function resolveSceneView(shot = {}, asset = {}) {
  const requested = normalizeSceneView(shot.scene_view || shot.sceneView);
  const available = new Set(primarySceneViews(asset).map((view, index) => sceneViewKey(view, index)).filter(Boolean));
  // 已声明视图时只允许绑定当前任务资产真实存在的键；没有视图清单时兼容旧任务的开放值。
  if (requested && (!available.size || available.has(requested))) return requested;
  return semanticSceneView(shot, asset);
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

function hasChinese(value = '') {
  return /[㐀-鿿]/.test(String(value || ''));
}

function spatialBindingForShot(shot = {}, asset = {}, sceneView = 'master') {
  const contract = asset.scene_contract || {};
  const zones = Array.isArray(contract.zones) ? contract.zones : [];
  const shotText = [shot.visual, shot.action, shot.purpose, shot.role, shot.title, shot.scene_zone_label_zh, shot.scene_zone].filter(Boolean).join(' ');
  const eligibleZones = zones.filter(zone => !Array.isArray(zone.visible_in_views)
    || !zone.visible_in_views.length || zone.visible_in_views.includes(sceneView));
  const requestedZoneId = cleanText(shot.scene_zone_id || shot.zone_id || (Array.isArray(shot.zone_ids) ? shot.zone_ids[0] : ''), 100);
  const lockedZone = requestedZoneId
    ? eligibleZones.find(zone => cleanText(zone.id || '', 100) === requestedZoneId)
    : null;
  const rankedZones = eligibleZones
    .map(zone => ({
      zone,
      score: overlapScore(shotText, [zone.label, zone.purpose, ...(zone.tags || [])].join(' ')),
    }))
    .sort((a, b) => b.score - a.score);
  // 机器 ID 是场景绑定的唯一事实来源；中文展示名称不能反向改变生成区域。
  const selectedZone = lockedZone || rankedZones[0]?.zone || eligibleZones[0] || null;
  const eligibleAnchors = (Array.isArray(contract.anchors) ? contract.anchors : [])
    .filter(anchor => anchor.required !== false
      && (!Array.isArray(anchor.visible_in_views) || !anchor.visible_in_views.length || anchor.visible_in_views.includes(sceneView)));
  // 锚点数量由镜头景别决定，不再把某个固定镜位名称等同于某类行业画面。
  const shotSize = cleanText(shot.shot_size || shot.shotSize || '', 40);
  const anchorLimit = /close|macro|特写|近景/i.test(shotSize)
    ? 1
    : (/wide|full|establish|全景|远景/i.test(shotSize) ? 4 : 2);
  const anchors = eligibleAnchors
    .map(anchor => ({
      anchor,
      score: overlapScore(shotText, [anchor.label, anchor.description, anchor.relative_position, anchor.kind].join(' ')),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, anchorLimit)
    .map(item => item.anchor.id)
    .filter(Boolean);
  const camera = (Array.isArray(contract.cameras) ? contract.cameras : [])
    .find(item => item.view_id === sceneView) || null;
  return {
    camera_id: camera?.id || 'camera_' + sceneView,
    zone_id: selectedZone?.id || cleanText(shot.scene_zone_id || shot.zone_id || (Array.isArray(shot.zone_ids) ? shot.zone_ids[0] : ''), 100),
    zone_ids: selectedZone?.id ? [selectedZone.id] : [],
    anchor_ids: anchors,
    zone_label: selectedZone?.label_zh || selectedZone?.label || cleanText(shot.scene_zone_label_zh || shot.scene_zone || shot.sceneZone || shot.zone || shot.purpose || shot.title || '', 160),
  };
}

function sceneAssetDigest(sceneAssets = []) {
  return (Array.isArray(sceneAssets) ? sceneAssets : []).map((asset, index) => {
    const views = primarySceneViews(asset);
    const layoutReference = layoutSceneReference(asset);
    const contract = asset.scene_contract || {};
    return {
      scene_id: normalizeSceneId(asset, index),
      name: cleanText(asset.name || `任务场景 ${index + 1}`, 120),
      lock_strength: cleanText(asset.lock_strength || 'standard', 40),
      layout_summary: cleanText(asset.layout_summary || '', 500),
      material_summary: cleanText(asset.material_summary || '', 500),
      style_summary: cleanText(asset.style_summary || '', 300),
      scene_revision: Math.max(1, Number(asset.scene_revision || asset.scene_contract?.scene_revision || 1) || 1),
      space_lock_status: completeSpaceLock(asset)
        ? 'complete'
        : (contract.space_lock_status || (legacySpaceLock(asset) ? 'upgrade_required' : 'appearance_only')),
      layout_reference: layoutReference ? { available: true, role: layoutReference.role, label: layoutReference.label } : { available: false, role: 'auxiliary_spatial_lock' },
      layout_contract: contract.layout_contract || asset.layout_contract || null,
      spatial_coverage_qa: contract.spatial_coverage_qa || asset.spatial_coverage_qa || null,
      camera_design_qa: contract.camera_design_qa || asset.camera_design_qa || null,
      cameras: (Array.isArray(contract.cameras) ? contract.cameras : []).map(camera => ({
        id: cleanText(camera.id || '', 100),
        view_id: cleanText(camera.view_id || '', 40),
        role: cleanText(camera.role || '', 160),
        framing: cleanText(camera.framing || '', 120),
        lens_class: cleanText(camera.lens_class || '', 80),
        height_class: cleanText(camera.height_class || '', 80),
        orientation: cleanText(camera.orientation || '', 160),
        target_description: cleanText(camera.target_description || '', 220),
        requirement_refs: Array.isArray(camera.requirement_refs) ? camera.requirement_refs : [],
        pass: camera.pass === true,
      })),
      anchors: (Array.isArray(asset.scene_contract?.anchors) ? asset.scene_contract.anchors : [])
        .map(anchor => ({ id: cleanText(anchor.id || '', 100), label: cleanText(anchor.label || '', 120) })).slice(0, 16),
      zones: (Array.isArray(asset.scene_contract?.zones) ? asset.scene_contract.zones : [])
        .map(zone => ({
          id: cleanText(zone.id || '', 100),
          label: cleanText(zone.label || '', 120),
          label_zh: cleanText(zone.label_zh || zone.labelZh || (hasChinese(zone.label) ? zone.label : ''), 120),
          purpose: cleanText(zone.purpose || '', 180),
        })).slice(0, 16),
      available_views: views.length
        ? views.map((view, viewIndex) => ({
          key: sceneViewKey(view, viewIndex) || `view_${viewIndex + 1}`,
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
  if (completeSpaceLock(asset)) return 'verified';
  if (legacySpaceLock(asset)) return 'legacy_partial';
  if (contract.space_lock_status && contract.space_lock_status !== 'complete') {
    return cleanText(contract.space_lock_status, 40);
  }
  if (contract.status === 'rejected' || qa.pass === false && contract.qa_unavailable !== true) return 'rejected';
  return contract.status === 'verified' ? 'partial' : (cleanText(contract.status || 'unverified', 40) || 'unverified');
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

function normalizeScenePlan(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const spaces = (Array.isArray(source.spaces) ? source.spaces : [])
    .map((space, index) => {
      const id = cleanText(space?.id || space?.space_id || space?.scene_id || space?.space_key || `space_${index + 1}`, 100);
      const rawSceneSpec = space?.scene_spec || space?.sceneSpec;
      return {
        id,
        space_id: id,
        scene_id: id,
        name: cleanText(space?.name || space?.label || `独立空间 ${index + 1}`, 120),
        description: cleanText(space?.description || space?.layout || '', 500),
        story_purpose: cleanText(space?.story_purpose || space?.purpose || '', 300),
        scene_spec: rawSceneSpec && typeof rawSceneSpec === 'object'
          ? normalizeSceneSpec(rawSceneSpec)
          : null,
      };
    })
    .filter(space => space.name || space.description)
    .slice(0, 120);
  const declaredMode = cleanText(source.scene_mode || source.sceneMode || '', 20).toLowerCase();
  const sceneMode = spaces.length > 1 ? 'multi' : (['single', 'multi'].includes(declaredMode) ? declaredMode : (spaces.length === 1 ? 'single' : 'auto'));
  return { ...source, scene_mode: sceneMode, spaces };
}

function sceneSpecMissingFields(spec = null) {
  if (!spec || typeof spec !== 'object') {
    return ['layoutText', 'materialLightText', 'interactionText', 'negativeText'];
  }
  return ['layoutText', 'materialLightText', 'interactionText', 'negativeText']
    .filter(key => !cleanText(spec[key] || '', 1000));
}

function assertScenePlanContract(sceneConfig = {}) {
  const duplicateSpaceIds = sceneConfig.spaces
    .map(space => space.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  const incompleteSpaces = sceneConfig.spaces
    .map(space => ({ space_id: space.id, missing_fields: sceneSpecMissingFields(space.scene_spec) }))
    .filter(item => item.missing_fields.length);
  if ((sceneConfig.scene_mode === 'multi' && sceneConfig.spaces.length < 2)
    || !sceneConfig.spaces.length
    || duplicateSpaceIds.length
    || incompleteSpaces.length) {
    const error = new Error('场景配置未形成逐空间独立合同，已停止保存；每个物理空间必须有唯一稳定 ID 和完整 scene_spec');
    error.code = 'SCENE_CONFIG_SPACE_CONTRACT_INVALID';
    error.status = 422;
    error.retryable = true;
    error.details = {
      scene_mode: sceneConfig.scene_mode,
      space_count: sceneConfig.spaces.length,
      duplicate_space_ids: [...new Set(duplicateSpaceIds)],
      incomplete_spaces: incompleteSpaces,
    };
    throw error;
  }
  return sceneConfig;
}

function generationTargetError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 422;
  error.retryable = false;
  Object.assign(error, details);
  return error;
}

function resolveSceneGenerationTarget({ sceneConfig = {}, context = {}, body = {} } = {}) {
  const scenePlan = normalizeScenePlan(sceneConfig);
  const spaces = scenePlan.spaces;
  if (!spaces.length) {
    throw generationTargetError(
      '当前任务没有持久化逐空间场景计划，已在图片模型调用前停止；请先恢复或保存 scene_config.spaces',
      'SCENE_PLAN_REQUIRED_FOR_GENERATION',
      { current_scene_count: 0 },
    );
  }
  const requestedSpaceId = cleanText(body.space_id || body.spaceId || '', 100);
  const requestedSceneId = cleanText(body.scene_id || body.sceneId || '', 100);
  if (requestedSpaceId && requestedSceneId && requestedSpaceId !== requestedSceneId) {
    throw generationTargetError(
      `space_id(${requestedSpaceId}) 与 scene_id(${requestedSceneId}) 不一致，已在图片调用前停止`,
      'SCENE_TARGET_ID_CONFLICT',
      { requested_space_id: requestedSpaceId, requested_scene_id: requestedSceneId },
    );
  }
  const requestedId = requestedSpaceId || requestedSceneId;
  const contextMode = cleanText(context.scene_mode || context.sceneMode || '', 20).toLowerCase();
  const multiScene = scenePlan.scene_mode === 'multi' || contextMode === 'multi' || spaces.length > 1;
  const ids = spaces.map(space => space.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicateIds.length) {
    throw generationTargetError(
      `多场景计划存在重复稳定空间 ID：${duplicateIds.join('、')}`,
      'SCENE_PLAN_DUPLICATE_SPACE_ID',
      { duplicate_space_ids: duplicateIds },
    );
  }
  if (multiScene && spaces.length < 2) {
    throw generationTargetError(
      '任务声明为多场景，但 scene_config.spaces 未提供至少两个独立物理空间',
      'MULTI_SCENE_PLAN_REQUIRED',
      { required_scene_count: 2, current_scene_count: spaces.length },
    );
  }
  if (multiScene) {
    const incomplete = spaces
      .map(space => ({ space_id: space.id, missing_fields: sceneSpecMissingFields(space.scene_spec) }))
      .filter(item => item.missing_fields.length);
    if (incomplete.length) {
      throw generationTargetError(
        `多场景计划缺少逐空间 scene_spec：${incomplete.map(item => item.space_id).join('、')}`,
        'MULTI_SCENE_SPEC_REQUIRED',
        { incomplete_spaces: incomplete },
      );
    }
    if (!requestedId) {
      throw generationTargetError(
        '多场景任务必须明确指定本次只生成哪一个 space_id/scene_id',
        'SCENE_GENERATION_TARGET_REQUIRED',
        { available_space_ids: ids },
      );
    }
  }
  let space = null;
  if (spaces.length) {
    space = requestedId
      ? spaces.find(item => item.id === requestedId)
      : spaces[0];
    if (!space) {
      throw generationTargetError(
        `目标空间 ${requestedId} 不在当前 scene_config.spaces 中`,
        'SCENE_GENERATION_TARGET_INVALID',
        { requested_space_id: requestedId, available_space_ids: ids },
      );
    }
  }
  const sceneId = cleanText(space?.id || requestedId || 'scene_1', 100);
  const submittedRawSpec = body.scene_spec || body.sceneSpec;
  const submittedSceneSpec = submittedRawSpec && typeof submittedRawSpec === 'object'
    ? normalizeSceneSpec(submittedRawSpec)
    : null;
  const sceneSpec = submittedSceneSpec
    || space?.scene_spec
    || normalizeSceneSpec(context.scene_spec || context.sceneSpec || {});
  const missingFields = sceneSpecMissingFields(sceneSpec);
  if (spaces.length && missingFields.length) {
    throw generationTargetError(
      `目标空间 ${sceneId} 的 scene_spec 不完整：${missingFields.join('、')}`,
      'SCENE_SPEC_REQUIRED_FOR_SPACE',
      { space_id: sceneId, missing_fields: missingFields },
    );
  }
  if (space && submittedSceneSpec) {
    space = { ...space, scene_spec: submittedSceneSpec };
    scenePlan.spaces = scenePlan.spaces.map(item => item.id === space.id ? space : item);
  }
  return {
    scene_id: sceneId,
    space_id: sceneId,
    space,
    scene_spec: sceneSpec,
    scene_plan: scenePlan,
    submitted_scene_spec_used: !!submittedSceneSpec,
    multi_scene: multiScene,
    isolated_scene_config: {
      ...scenePlan,
      scene_mode: 'single',
      spaces: space ? [space] : [],
    },
  };
}

function resolveSceneMode(requestedMode = 'auto', scenePlan = {}) {
  const requested = cleanText(requestedMode || 'auto', 20).toLowerCase();
  if (['single', 'multi'].includes(requested)) return requested;
  return normalizeScenePlan(scenePlan).scene_mode === 'multi' ? 'multi' : 'auto';
}

function assertSceneModeAssets(sceneMode = 'auto', sceneAssets = [], requiredSpaces = []) {
  const mode = cleanText(sceneMode || 'auto', 20).toLowerCase();
  const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
  const requiredCount = mode === 'multi'
    ? Math.max(2, Array.isArray(requiredSpaces) ? requiredSpaces.length : 0)
    : 0;
  if (mode === 'multi' && assets.length < requiredCount) {
    const error = new Error(`当前任务需要 ${requiredCount} 套独立场景资产，现有 ${assets.length} 套；请为每个空间分别生成并验证后再生成分镜`);
    error.code = 'MULTI_SCENE_ASSETS_REQUIRED';
    error.status = 422;
    error.retryable = false;
    error.required_scene_count = requiredCount;
    error.current_scene_count = assets.length;
    throw error;
  }
  if (mode === 'single' && assets.length !== 1) {
    const error = new Error('当前选择了单场景锁定，请保留并验证 1 套场景资产后再生成分镜');
    error.code = 'SINGLE_SCENE_ASSET_REQUIRED';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  if (assets.length) assertVerifiedSceneAssets(assets);
  return true;
}

function bindShotToScene(shot = {}, sceneAssets = [], index = 0, previousShot = null) {
  const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
  if (!assets.length) {
    return {
      ...shot,
      scene_id: cleanText(shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId || '', 120) || undefined,
      scene_view: cleanText(shot.scene_view || shot.sceneView || '', 40) || undefined,
      scene_zone: cleanText(shot.scene_zone || shot.sceneZone || shot.zone || '', 160) || undefined,
      scene_zone_id: cleanText(shot.scene_zone_id || shot.zone_id || (Array.isArray(shot.zone_ids) ? shot.zone_ids[0] : ''), 100) || undefined,
      scene_zone_label_zh: cleanText(shot.scene_zone_label_zh || shot.zone_label_zh || shot.scene_zone || shot.sceneZone || shot.zone || '', 160) || undefined,
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
  const sceneView = resolveSceneView(shot, matched);
  const spatial = spatialBindingForShot(shot, matched, sceneView);
  const requestedLabel = cleanText(shot.scene_zone_label_zh || shot.zone_label_zh || '', 160);
  const displayLabelZh = hasChinese(requestedLabel) ? requestedLabel : cleanText(spatial.zone_label || requestedLabel, 160);

  return {
    ...shot,
    scene_id: sceneId,
    scene_asset_id: sceneId,
    scene_name: cleanText(shot.scene_name || shot.sceneName || matched.name || `任务场景 ${matchedIndex + 1}`, 120),
    scene_revision: actualRevision,
    scene_view: sceneView,
    camera_id: spatial.camera_id,
    scene_zone: spatial.zone_label,
    scene_zone_id: spatial.zone_id || spatial.zone_ids[0] || undefined,
    scene_zone_label_zh: displayLabelZh || undefined,
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
    'For each shot, also output scene_revision, scene_view, camera_id, scene_zone, scene_zone_id, scene_zone_label_zh, zone_ids, anchor_ids, transition_from and transition_reason.',
    'scene_view must use one open view ID listed in available_views for that selected task scene. Never invent a fixed industry view template. The layout reference is auxiliary spatial evidence only and must never be selected as scene_view.',
    'scene_zone_id and zone_ids are stable machine bindings copied from the selected scene contract. Never translate or rename them.',
    'scene_zone_label_zh is presentation-only and must be a concise Simplified Chinese zone name. Translation must never alter scene_zone_id or zone_ids.',
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
  const sceneView = resolveSceneView(shot, asset);
  const spatial = spatialBindingForShot(shot, asset, sceneView);
  const contract = asset.scene_contract || {};
  const layoutReference = layoutSceneReference(asset);
  return {
    scene_id: sceneId,
    scene_name: cleanText(shot.scene_name || asset.name || `任务场景 ${assetIndex + 1}`, 120),
    scene_revision: Math.max(1, Number(asset.scene_revision || asset.scene_contract?.scene_revision || 1) || 1),
    scene_view: sceneView,
    camera_id: cleanText(shot.camera_id || spatial.camera_id, 100),
    scene_zone_id: cleanText(shot.scene_zone_id || shot.zone_id || (Array.isArray(shot.zone_ids) ? shot.zone_ids[0] : '') || spatial.zone_id || '', 100),
    scene_zone_label_zh: cleanText(shot.scene_zone_label_zh || shot.zone_label_zh || shot.scene_zone || spatial.zone_label || '', 160),
    zone_ids: Array.isArray(shot.zone_ids) && shot.zone_ids.length ? shot.zone_ids : spatial.zone_ids,
    anchor_ids: Array.isArray(shot.anchor_ids) && shot.anchor_ids.length ? shot.anchor_ids : spatial.anchor_ids,
    scene_zone: cleanText(shot.scene_zone || '', 160),
    transition_from: cleanText(shot.transition_from || '', 120),
    transition_reason: cleanText(shot.transition_reason || '', 240),
    lock_strength: cleanText(asset.lock_strength || 'standard', 40),
    layout_summary: cleanText(asset.layout_summary || '', 800),
    material_summary: cleanText(asset.material_summary || '', 800),
    style_summary: cleanText(asset.style_summary || '', 500),
    negative: cleanText(asset.negative || '', 800),
    view_images: primarySceneViews(asset),
    layout_reference: layoutReference,
    layout_contract: contract.layout_contract || asset.layout_contract || null,
    spatial_coverage_qa: contract.spatial_coverage_qa || asset.spatial_coverage_qa || null,
    camera_design_qa: contract.camera_design_qa || asset.camera_design_qa || null,
    space_lock_status: completeSpaceLock(asset)
      ? 'complete'
      : (contract.space_lock_status || (legacySpaceLock(asset) ? 'upgrade_required' : 'appearance_only')),
    spatial_contract: {
      schema_version: Number(contract.schema_version || 0) || 0,
      anchors: Array.isArray(contract.anchors) ? contract.anchors : [],
      zones: Array.isArray(contract.zones) ? contract.zones : [],
      cameras: Array.isArray(contract.cameras) ? contract.cameras : [],
      camera_design_qa: contract.camera_design_qa || asset.camera_design_qa || null,
      surface_topology: contract.surface_topology || asset.surface_topology || null,
      layout_contract: contract.layout_contract || asset.layout_contract || null,
      spatial_coverage_qa: contract.spatial_coverage_qa || asset.spatial_coverage_qa || null,
    },
    scene_contract: contract || null,
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
  assertSceneModeAssets,
  normalizeScenePlan,
  resolveSceneGenerationTarget,
  sceneSpecMissingFields,
  assertScenePlanContract,
  resolveSceneMode,
  selectSceneAsset,
  semanticSceneView,
  resolveSceneView,
  spatialBindingForShot,
  completeSpaceLock,
  completeSceneViewEvidence,
  legacySpaceLock,
  layoutSceneReference,
  primarySceneViews,
};
