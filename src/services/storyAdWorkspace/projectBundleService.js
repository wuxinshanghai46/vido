const storyAd = require('../newStoryAd'), productAssetResolver = require('../newStoryAd/productAssetResolverService');
const referenceDrafts = require('./referenceDraftProjectionService'), countProjection = require('./projectCountProjectionService');
const timingProjection = require('./projectTimingProjectionService'), workflowNavigation = require('./workflowNavigationService');
const { projectSceneCamera, projectShootingRules } = require('./sceneCameraProjectionService');
const semantic = require('./productionSemanticLocalizationService'), benchmarkStrategy = require('../newStoryAd/benchmarkStrategyService');
const storyboardSketchGate = require('./storyboardSketchGateService'), referenceUnderstandingProjection = require('./referenceUnderstandingProjectionService');
const { projectedDossierItems } = require('./dossierItemProjectionService'), { normalizeAppearanceAgeText } = require('./personTextProjectionService');
const MAX_MEDIA_ITEMS = 120;
/** 把任意值整理为安全短文本，避免把大型提示词带入工作区首包。 */
function clean(value = '', max = 240) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }

/** 只返回真实数组，避免各页面重复编写兼容判断。 */
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

/** 提取现有媒体对象中的当前展示地址。 */
function mediaUrl(value = {}) {
  if (typeof value === 'string') return clean(value, 1200);
  return clean(
    value.thumbnail_url
      || value.thumb_url
      || value.image_url
      || value.imageUrl
      || value.video_url
      || value.videoUrl
      || value.url
      || value.file_path
      || '',
    1200,
  );
}

/** 将持久化人物档案压缩成生成服务可直接复用的标准结构。 */
function personProfile(source = {}, index = 0) {
  return {
    id: clean(source.id || source.cast_id || source.castId || `cast_${index + 1}`, 80),
    displayName: clean(source.displayName || source.display_name || source.name, 120),
    roleName: clean(source.roleName || source.role_name || source.role, 120),
    age: clean(source.age || source.ageRange || source.age_range || 'match_brief', 40),
    appearanceText: normalizeAppearanceAgeText(source.appearanceText || source.appearance?.userPrompt || source.appearance?.description || source.description),
    wardrobeText: clean(source.wardrobeText || source.wardrobe?.userPrompt || source.wardrobe?.description || source.outfit, 600),
    hairMakeupText: clean(source.hairMakeupText || source.hairMakeup?.userPrompt || source.hairMakeup?.description || source.hair_style, 500),
    negativeText: clean(source.negativeText || source.negative, 600),
  };
}

/** 将宠物档案压缩成生成服务可直接复用的标准结构。 */
function petProfile(source = {}, index = 0) {
  return {
    id: clean(source.id || source.pet_id || source.petId || `pet_${index + 1}`, 80),
    name: clean(source.name || source.displayName, 120),
    type: clean(source.type || source.species, 120),
    breed: clean(source.breed, 160),
    appearance: clean(source.appearance || source.description, 600),
  };
}

function projectedViews(source = {}, fallback = []) {
  const raw = list(source.view_images).length ? list(source.view_images) : list(fallback);
  const labels = { front: '正面', side: '侧面', back: '背面', action: '动作' };
  return raw.slice(0, 16).map((view, index) => {
    const key = clean(view?.key || view?.id || view?.label || ['front', 'side', 'back', 'action'][index] || `view_${index + 1}`, 80);
    return {
      key,
      label: clean(view?.label || view?.name || labels[key] || `视图 ${index + 1}`, 100),
      image_url: mediaUrl(view),
    };
  }).filter(view => view.image_url);
}

/** 将单个场景机位与对应视图稳定关联；layout 只由独立布局合同投影。 */
/** 压缩人物档案的分类图集和原子素材，供详情抽屉按原型分区展示。 */
/** 生成稳定可读的任务编号，不修改现有任务主键。 */
function displayId(task = {}) {
  const date = new Date(task.created_at || task.updated_at || Date.now());
  const stamp = Number.isNaN(date.getTime())
    ? '00000000'
    : date.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = clean(task.id || '', 12).replace(/[^a-z0-9]/ig, '').slice(0, 6).toUpperCase() || 'TASK';
  return `SA-${stamp}-${suffix}`;
}

/** 把底层阶段转换成用户可理解的工作区状态。 */
function workspaceStage(task = {}, outputs = {}) {
  const stage = clean(task.active_stage || task.stage || '', 100).toLowerCase();
  if (outputs.final_video || /compose|final/.test(stage)) return 'final';
  if (outputs.video_clips || /video|tts|media/.test(stage)) return 'final';
  if (outputs.keyframes || /keyframe/.test(stage)) return 'shot';
  if (outputs.storyboard_table || /storyboard/.test(stage)) return 'storyboard';
  if (outputs.blueprint || /blueprint|script/.test(stage)) return 'plot';
  if (outputs.scene_assets || outputs.person_contract || outputs.asset_plan || /scene|person|asset/.test(stage)) return 'assets';
  return 'brief';
}

/** 输出任务中心需要的轻量项目摘要。 */
function projectSummary(task = {}) {
  return {
    id: clean(task.id, 100),
    display_id: displayId(task),
    title: clean(task.title || task.brief || '未命名剧情广告', 120),
    brief: clean(task.brief, 220),
    status: clean(task.status || 'draft', 40),
    stage: clean(task.active_stage || task.stage || 'draft', 80),
    workspace: workspaceStage(task, {}),
    content_revision: Math.max(1, Number(task.content_revision || 1) || 1),
    shot_count: Math.max(0, Number(task.shot_count || 0) || 0),
    keyframe_count: Math.max(0, Number(task.keyframe_count || 0) || 0),
    thumbnail_url: mediaUrl(task.thumbnail_url),
    final_video_url: mediaUrl(task.final_video_url),
    active_generation_id: clean(task.active_generation_id, 100),
    error: clean(task.error, 260),
    error_code: clean(task.error_code, 80),
    created_at: task.created_at || '',
    updated_at: task.updated_at || '',
  };
}

/** 生成任务中心统计，复用同一次任务列表读取。 */
function projectStats(tasks = []) {
  const rows = list(tasks);
  const completed = rows.filter(item => ['done', 'completed', 'succeeded'].includes(clean(item.status).toLowerCase()) || !!item.final_video_url);
  const completedIds = new Set(completed.map(item => item.id));
  const waiting = rows.filter(item => !completedIds.has(item.id)
    && (!!item.error || ['failed', 'blocked', 'waiting'].includes(clean(item.status).toLowerCase())));
  const waitingIds = new Set(waiting.map(item => item.id));
  return {
    total: rows.length,
    running: rows.filter(item => !completedIds.has(item.id) && !waitingIds.has(item.id)).length,
    waiting: waiting.length,
    completed: completed.length,
    shots: rows.reduce((sum, item) => sum + Math.max(0, Number(item.shot_count || 0) || 0), 0),
  };
}

/** 读取当前用户的真实任务列表与统计，不读取大型产物。 */
function listProjects({ limit = 50, page = 1, status = '', userId = '' } = {}) {
  const result = storyAd.listTaskSummaries({ limit, page, status, userId });
  const projects = list(result.tasks).map(projectSummary);
  const stats = projectStats(projects);
  stats.total = result.total;
  return {
    total: result.total,
    page: result.page,
    page_size: result.page_size,
    projects,
    stats,
  };
}

/** 将人物主档和多人子资产整理为统一卡片。 */
function peopleAssets(context = {}, projectedProps = []) {
  const master = context.person_asset && typeof context.person_asset === 'object' ? context.person_asset : null;
  const castAssets = list(master?.cast_assets);
  const profiles = list(context.cast_profiles);
  const generated = castAssets.length ? castAssets : (master ? [master] : []);
  const used = new Set();
  const rows = profiles.length ? profiles.map((profile, index) => {
    const profileId = clean(profile.id || profile.cast_id || profile.castId, 80);
    const exactIndex = generated.findIndex((item, candidateIndex) => !used.has(candidateIndex)
      && [item.actor_id, item.subject_profile?.id, item.id].map(value => clean(value, 120)).includes(profileId));
    const assetIndex = exactIndex >= 0 ? exactIndex : (generated[index] ? index : -1);
    if (assetIndex >= 0) used.add(assetIndex);
    return { profile, asset: assetIndex >= 0 ? generated[assetIndex] : {}, index };
  }) : generated.map((asset, index) => ({ profile: asset.subject_profile || {}, asset, index }));
  generated.forEach((asset, index) => {
    if (!used.has(index) && profiles.length) rows.push({ profile: asset.subject_profile || {}, asset, index: rows.length });
  });
  return rows.slice(0, MAX_MEDIA_ITEMS).map(({ profile, asset: item, index }) => {
    // 当前任务人物档案是用户可编辑的权威输入；生成资产里的 subject_profile 只能补缺，不能覆盖后续编辑。
    const canonical = personProfile({ ...(item.subject_profile || {}), ...profile }, index);
    const views = projectedViews(item);
    const dossierUrl = mediaUrl(item.dossier_sheet || {});
    const coverUrl = clean(item.cover_image_url, 1200) || dossierUrl || mediaUrl(item) || views[0]?.image_url || '';
    const assetId = clean(item.id || item.actor_asset_id || item.person_id || canonical.id || `person-${index + 1}`, 120);
    return {
      id: assetId,
      asset_id: assetId,
      subject_id: clean(item.actor_id || item.subject_profile?.id || canonical.id, 80),
      kind: 'person',
      name: clean(item.name || canonical.displayName || canonical.roleName || `人物 ${index + 1}`, 120),
      role: clean(item.role || item.cast_role || canonical.roleName, 120),
      image_url: coverUrl,
      cover_image_url: coverUrl,
      dossier_sheet: dossierUrl ? {
        image_url: dossierUrl,
        width: Math.max(0, Number(item.dossier_sheet?.width || 0) || 0), height: Math.max(0, Number(item.dossier_sheet?.height || 0) || 0),
        layout: clean(item.dossier_sheet?.layout, 100), sections: list(item.dossier_sheet?.sections).map(value => clean(value, 80)).filter(Boolean),
      } : null,
      quality_status: clean(item.quality_status || (item.native_masters?.face?.image_url && item.native_masters?.body?.image_url ? 'native_masters_ready' : 'legacy_view_only'), 50),
      native_masters: Object.fromEntries(['face', 'body'].map(key => [key, item.native_masters?.[key]])
        .filter(([, value]) => mediaUrl(value))
        .map(([key, value]) => [key, { ...value, image_url: mediaUrl(value) }])),
      view_images: views,
      category_atlases: projectedDossierItems(item.category_atlases),
      atomic_assets: projectedDossierItems(item.atomic_assets),
      identity_views: projectedDossierItems(item.identity_views),
      expressions: projectedDossierItems(item.expressions),
      base_actions: projectedDossierItems(item.base_actions),
      accessory_details: projectedDossierItems(item.accessory_details || item.dossier?.accessory_details),
      wardrobe_details: projectedDossierItems(item.wardrobe_detail_items || item.wardrobe_details?.items || item.dossier?.wardrobe_details?.items),
      profile: canonical,
      provider_asset_id: clean(item.deyunai_asset_id || item.provider_asset_id, 160),
      provider_asset_status: clean(item.deyunai_asset_status || item.provider_asset_status, 40),
      provider_asset_group_id: clean(item.deyunai_asset_group_id || '', 160),
      owned_props: list(projectedProps).filter((prop) => {
        const owner = clean(prop.owner_id, 120), identities = [canonical.id, item.actor_id, item.actor_asset_id, item.id].map(value => clean(value, 120)).filter(Boolean);
        return owner ? identities.includes(owner) : index === 0;
      }),
      status: clean(item.person_contract?.status || item.verification_status || context.person_contract?.status || 'draft', 50),
      revision: Number(item.person_revision || item.revision || context.person_contract?.person_revision || 0) || 0,
      source: clean(item.source || master?.source, 100),
    };
  });
}

/** 将宠物或动物档案整理为独立资产。 */
function animalAssets(context = {}) {
  return list(context.pet_profiles).slice(0, MAX_MEDIA_ITEMS).map((item, index) => {
    const profile = petProfile(item, index);
    const views = projectedViews(item, item.reference_images);
    const assetId = clean(item.asset_id || item.id || item.pet_id || `animal-${index + 1}`, 120);
    return {
      id: assetId,
      asset_id: assetId,
      subject_id: profile.id,
      kind: 'animal',
      name: clean(item.name || item.displayName || item.species || item.breed || `动物 ${index + 1}`, 120),
      role: clean(item.role || item.species || item.breed, 120),
      image_url: mediaUrl(item) || views[0]?.image_url || '',
      view_images: views,
      profile,
      status: clean(item.status || context.pet_contract?.status || 'draft', 50),
      revision: Number(item.revision || context.pet_contract?.revision || 0) || 0,
    };
  });
}

/** 将商品与品牌主体整理为独立资产。 */
function productAssets(context = {}) {
  const product = productAssetResolver.primaryProductAsset(context);
  const presentation = productAssetResolver.productPresentation(context);
  if (!product && !clean(presentation.subject)) return [];
  return [{
    id: clean(product?.id || product?.asset_id || 'product-primary', 120),
    kind: presentation.scene_linked ? 'showcase_subject' : 'product',
    name: clean(product?.name || presentation.subject || '展示主体', 120),
    presentation,
    description: clean(presentation.description, 500),
    linked_scene_ids: list(context.scene_plan?.spaces).map(space => clean(space.id || space.scene_id, 120)).filter(Boolean),
    image_url: mediaUrl(product || {}),
    view_images: list(product?.view_images).slice(0, 16).map(view => ({
      key: clean(view.key || view.id || view.label, 80),
      label: clean(view.label || view.name || view.key, 100),
      image_url: mediaUrl(view),
    })),
    status: clean(product?.product_contract?.status || context.product_contract?.status || 'draft', 50),
    revision: Number(product?.revision || context.product_contract?.product_revision || 0) || 0,
  }];
}

/** 将授权 LOGO 配置整理为独立资产。 */
function logoAssets(context = {}) {
  const overlay = context.brand_overlay && typeof context.brand_overlay === 'object'
    ? context.brand_overlay
    : {};
  const asset = overlay.logo_asset || overlay.asset || {};
  const url = mediaUrl(asset) || clean(overlay.logo_url || overlay.image_url, 1200);
  if (!url && !clean(overlay.brand_name || context.brand_name)) return [];
  return [{
    id: clean(asset.id || overlay.id || 'brand-logo', 120),
    kind: 'logo',
    name: clean(overlay.brand_name || context.brand_name || asset.name || '品牌标识', 120),
    image_url: url,
    status: overlay.authorized === false ? 'unauthorized' : 'authorized',
    source: clean(asset.source || overlay.source, 100),
  }];
}

/** 将场景规划、生成资产和未绑定参考合并成同一组稳定场景卡，避免规划已存在却显示为 0。 */
function sceneAssets(outputs = {}, context = {}) {
  const plan = outputs.scene_config && typeof outputs.scene_config === 'object'
    ? outputs.scene_config
    : (context.scene_plan && typeof context.scene_plan === 'object' ? context.scene_plan : {});
  const planned = list(plan.spaces);
  const generated = list(outputs.scene_assets).length ? list(outputs.scene_assets) : list(context.scene_assets);
  const references = list(context.assets).filter(item => clean(item.role || item.asset_role, 80) === 'scene_reference');
  const consumedAssets = new Set();
  const consumedReferences = new Set();
  const rawKeyOf = (item = {}) => clean(item.scene_id || item.space_id || item.id, 120);
  const keyOf = (item = {}, index = 0) => rawKeyOf(item) || `scene-${index + 1}`;
  const findById = (rows, id, consumed) => rows.findIndex((item, index) => !consumed.has(index) && keyOf(item, index) === id);
  const shots = list(outputs.storyboard_table);
  const routes = list(plan.routes || plan.scene_routes || plan.transitions);

  const projectScene = (space = {}, asset = {}, reference = {}, index = 0, options = {}) => {
    const id = rawKeyOf(space) || rawKeyOf(asset) || rawKeyOf(reference) || `scene-${index + 1}`;
    const contract = asset.scene_contract && typeof asset.scene_contract === 'object' ? asset.scene_contract : {};
    const spec = space.scene_spec && typeof space.scene_spec === 'object'
      ? space.scene_spec
      : (asset.scene_spec && typeof asset.scene_spec === 'object' ? asset.scene_spec : {});
    const rawCameras = list(contract.cameras || contract.camera_positions || asset.camera_positions);
    const rawViews = list(asset.view_images);
    const views = rawViews.slice(0, 24).map((view, viewIndex) => semantic.sceneView({
      ...(() => {
        const key = clean(view.key || view.view_id || view.id || `view_${viewIndex + 1}`, 80);
        const camera = rawCameras.find(item => clean(item.view_id || item.view || item.key, 100) === key) || {};
        return {
          key,
          framing: clean(view.framing || view.shot_size || camera.framing || camera.shot_size, 100),
          lens: clean(view.lens_class || view.lens || view.focal_length || camera.lens_class || camera.lens || camera.focal_length, 100),
          orientation: clean(view.orientation || view.direction || camera.orientation || camera.direction, 160),
          intent: clean(view.role || view.target_description || view.intent || camera.role || camera.target_description, 220),
        };
      })(),
      label: clean(view.label || view.name || view.key || `视角 ${viewIndex + 1}`, 100),
      image_url: mediaUrl(view),
    }, viewIndex)).filter(view => view.image_url);
    const cameras = rawCameras.slice(0, 30).map((camera, cameraIndex) => semantic.sceneCamera(projectSceneCamera(camera, views, cameraIndex), cameraIndex));
    const zones = list(contract.zones || spec.zones || space.zones).slice(0, 30).map((zone, zoneIndex) => ({
      id: clean(zone.id || zone.zone_id || `zone_${zoneIndex + 1}`, 100),
      label: clean(zone.label_zh || zone.label || zone.name || `区域 ${zoneIndex + 1}`, 120),
      purpose: clean(zone.purpose || zone.description, 220),
    }));
    const layout = contract.layout_contract && typeof contract.layout_contract === 'object' ? contract.layout_contract : {};
    const shotRefs = shots.filter(shot => clean(shot.scene_id || shot.scene_asset_id, 120) === id)
      .map((shot, shotIndex) => clean(shot.shot_id || shot.id || `SH${shotIndex + 1}`, 80)).slice(0, 60);
    const relevantRoutes = routes.filter(route => [route.from_scene_id, route.to_scene_id, route.scene_id, route.from, route.to]
      .some(value => clean(value, 120) === id)).slice(0, 12).map(route => ({
      from: clean(route.from_scene_id || route.from, 120),
      to: clean(route.to_scene_id || route.to, 120),
      time: clean(route.time || route.time_continuity, 120),
      weather: clean(route.weather || route.weather_continuity, 120),
      light: clean(route.light || route.light_continuity, 120),
      movement: clean(route.movement || route.transition_reason, 180),
    }));
    const imageUrl = mediaUrl(asset) || views[0]?.image_url || mediaUrl(reference);
    const candidateCount = list(asset.candidates || space.candidates || space.options).length;
    return {
      id,
      kind: 'scene',
      name: clean(space.display_name || space.name || asset.display_name || asset.name || asset.scene_name || reference.display_name || reference.name || `场景 ${index + 1}`, 120),
      name_source: clean(space.name_source || asset.name_source || (space.name ? 'plan' : (asset.name || asset.scene_name ? 'asset' : (reference.name ? 'upload' : 'fallback'))), 40),
      description: clean(space.description || asset.description || spec.description || spec.layoutText, 900),
      story_purpose: clean(space.story_purpose || space.purpose || asset.story_purpose, 500),
      image_url: imageUrl,
      reference_image_url: mediaUrl(reference),
      view_images: views,
      status: clean(contract.status || asset.status || (candidateCount ? 'selecting' : (imageUrl ? 'generated' : 'planned')), 50),
      revision: Number(asset.scene_revision || asset.revision || contract.scene_revision || 0) || 0,
      planned: options.planned === true,
      reference_only: options.referenceOnly === true,
      candidate_count: candidateCount,
      selected_candidate_id: clean(asset.selected_candidate_id || space.selected_candidate_id, 120),
      scene_spec: {
        layout: clean(spec.layoutText || spec.layout || spec.spatialLayout, 800),
        materials: clean(spec.materialText || spec.materials || spec.material, 600),
        weather: clean(spec.weather || spec.weatherText, 200),
        time: clean(spec.time || spec.timeOfDay || spec.timeText, 200),
        light: clean(spec.lightText || spec.lighting || spec.keyLightDirection, 500),
        interaction: clean(spec.interactionText || spec.interaction || spec.actionZone, 500),
        negative: clean(spec.negativeText || spec.negative, 500),
      },
      camera_plan: list(spec.cameraPlan || spec.camera_plan || space.camera_plan).slice(0, 24).map((camera, cameraIndex) => ({
        id: clean(camera.id || camera.camera_id || `camera_${cameraIndex + 1}`, 100),
        label: clean(camera.label || camera.name || `机位 ${cameraIndex + 1}`, 120),
        zone: clean(camera.zone || camera.zone_id, 120),
        framing: clean(camera.framing || camera.shot_size, 100),
        lens: clean(camera.lens || camera.lens_class || camera.focal_length, 100),
        height: clean(camera.height || camera.height_class, 80),
        movement: clean(camera.movement || camera.camera_movement || camera.move, 260),
        movement_type: clean(camera.movement_type || camera.move_type || camera.rig || camera.support, 100), route: clean(camera.route || camera.camera_path || camera.path, 260), speed: clean(camera.speed || camera.movement_speed || camera.pace, 80),
        start_state: clean(camera.start_state || camera.start, 220),
        end_state: clean(camera.end_state || camera.end, 220),
        duration: Math.max(0, Number(camera.duration || camera.duration_sec || 0) || 0),
        subject_action: clean(camera.subject_action || camera.action || camera.performance, 260), focus: clean(camera.focus || camera.focus_target || camera.focus_plan, 220),
        continuity: clean(camera.continuity || camera.transition || camera.axis_rule, 260), stabilization: clean(camera.stabilization || camera.stabilizer || camera.rig_note, 180),
        notes: clean(camera.notes || camera.purpose, 260),
        ...projectShootingRules(camera, cameraIndex, list(spec.cameraPlan || spec.camera_plan || space.camera_plan)[cameraIndex - 1] || {}),
      })),
      layout: {
        status: clean(layout.status || (layout.reference_image_url ? 'available' : ''), 60),
        image_url: mediaUrl(layout.reference_image_url || layout),
      },
      zones,
      cameras,
      routes: relevantRoutes,
      shot_refs: shotRefs,
      qa: {
        full_space_lock: contract.full_space_lock === true,
        space_lock_status: clean(contract.space_lock_status, 80),
        requirement_pass: contract.requirement_qa?.pass,
        cross_view_pass: contract.cross_view_qa?.pass,
        spatial_pass: contract.spatial_coverage_qa?.pass,
        camera_pass: contract.camera_design_qa?.pass,
        realism_pass: contract.photographic_realism_qa?.pass,
        reasons: [
          ...list(contract.verification?.reasons),
          ...list(contract.requirement_qa?.mismatch_reasons),
          ...list(contract.cross_view_qa?.mismatch_reasons),
          ...list(contract.spatial_coverage_qa?.reasons || contract.spatial_coverage_qa?.mismatch_reasons),
        ].slice(0, 20).map(reason => clean(reason, 220)),
      },
    };
  };

  const result = planned.map((space, index) => {
    const id = keyOf(space, index);
    const assetIndex = findById(generated, id, consumedAssets);
    const referenceIndex = findById(references, id, consumedReferences);
    if (assetIndex >= 0) consumedAssets.add(assetIndex);
    if (referenceIndex >= 0) consumedReferences.add(referenceIndex);
    return projectScene(space, assetIndex >= 0 ? generated[assetIndex] : {}, referenceIndex >= 0 ? references[referenceIndex] : {}, index, { planned: true });
  });
  generated.forEach((asset, index) => {
    if (!consumedAssets.has(index)) result.push(projectScene({}, asset, {}, result.length, { planned: false }));
  });
  references.forEach((reference, index) => {
    if (!consumedReferences.has(index)) result.push(projectScene({}, {}, reference, result.length, { referenceOnly: true }));
  });
  return result.slice(0, MAX_MEDIA_ITEMS);
}

/** 将现有道具产物整理为独立资产。 */
function propAssets(outputs = {}, context = {}) {
  const source = list(outputs.prop_assets).length ? list(outputs.prop_assets) : list(context.prop_assets);
  return source.slice(0, MAX_MEDIA_ITEMS).map((item, index) => ({
    id: clean(item.id || item.prop_id || `prop-${index + 1}`, 120),
    kind: 'prop',
    name: clean(item.name || item.label || `道具 ${index + 1}`, 120),
    image_url: mediaUrl(item),
    status: clean(item.status || item.contract?.status || 'draft', 50),
    owner_id: clean(item.owner_id || item.person_id, 120),
  }));
}

/** 生成前端唯一消费的轻量项目视图。 */
function buildProjectBundle(taskId, { sections = '', user = {} } = {}) {
  const raw = storyAd.publicTaskBundle(taskId);
  if (!raw?.task) {
    const error = new Error('项目不存在');
    error.status = 404;
    error.code = 'TASK_NOT_FOUND';
    throw error;
  }
  const requested = new Set(clean(sections, 300).split(',').map(item => item.trim()).filter(Boolean));
  const include = name => !requested.size || requested.has(name) || requested.has('all');
  const outputs = raw.outputs && typeof raw.outputs === 'object' ? raw.outputs : {};
  const context = outputs.context && typeof outputs.context === 'object'
    ? outputs.context
    : (raw.context && typeof raw.context === 'object' ? raw.context : (raw.task.request || {}));
  const project = {
    ...projectSummary({ ...storyAd.taskSummary(raw.task), ...raw.task }),
    name_source: clean(context.project_name ? 'user' : 'legacy_inferred', 40),
    workspace: workspaceStage(raw.task, outputs),
    saved_progress: raw.task.saved_progress === true,
    active_stage: clean(raw.task.active_stage, 80),
    ...timingProjection.generationTiming(raw.task, clean),
  };
  const projectedProps = propAssets(outputs, context);
  const projectedAssets = {
    people: peopleAssets(context, projectedProps),
    animals: animalAssets(context),
    products: productAssets(context),
    logos: logoAssets(context),
    props: projectedProps,
    scenes: sceneAssets(outputs, context),
  };
  const projectedCounts = countProjection.projectCounts(projectedAssets, mediaUrl, list);
  const navigation = workflowNavigation.build({ task: raw.task, context, outputs, counts: projectedCounts, clean, list });
  const bundle = {
    schema_version: 'story-ad-project-bundle-v1',
    project,
    navigation: {
      current: project.workspace,
      ...navigation,
    },
    permissions: {
      can_view: true,
      can_edit: true,
      can_generate: true,
      can_view_workflow: true,
      is_admin: clean(user.role).toLowerCase() === 'admin',
    },
    revisions: {
      content: Math.max(1, Number(raw.task.content_revision || 1) || 1),
      client_edit_seq: Math.max(0, Number(raw.task.latest_client_edit_seq || 0) || 0),
      snapshot_id: clean(raw.task.current_snapshot_id, 120),
    },
  };
  const uploadedMaterials = list(context.assets).slice(0, MAX_MEDIA_ITEMS).map((item, index) => ({
    id: clean(item.id || item.asset_id || `material-${index + 1}`, 120),
    role: clean(item.role || item.asset_role || 'reference', 80),
    name: clean(item.name || item.original_name || item.filename || `材料 ${index + 1}`, 160),
    url: mediaUrl(item),
  }));
  bundle.materials = {
    uploads: uploadedMaterials,
    roles: [...new Set(uploadedMaterials.map(item => item.role).filter(Boolean))],
  };

  if (include('summary') || include('reference')) {
    const analysis = context.reference_video_analysis && typeof context.reference_video_analysis === 'object'
      ? context.reference_video_analysis
      : {};
    bundle.reference = {
      required: context.reference_required === true,
      analysis_id: clean(analysis.id || analysis.analysis_id || context.reference_video_analysis_id, 120),
      status: clean(analysis.status || context.reference_video_status, 60),
      ...timingProjection.referenceTiming(analysis, clean, list),
      filename: clean(analysis.filename || analysis.original_name || analysis.source?.original_name || context.reference_video_name, 180),
      url: mediaUrl(analysis),
      duration: Number(analysis.duration || analysis.duration_sec || analysis.source?.metadata?.duration_seconds || 0) || 0,
      width: Number(analysis.width || analysis.source?.metadata?.width || 0) || 0,
      height: Number(analysis.height || analysis.source?.metadata?.height || 0) || 0,
      error: clean(analysis.error?.message || analysis.error?.code || analysis.error || analysis.error_message, 260),
      generated_brief: clean(analysis.generated_brief, 2200),
      source_facts: {
        product_or_service: clean(analysis.source_facts?.product_or_service, 300),
        environment: clean(analysis.source_facts?.environment, 500),
        human_presence: analysis.source_facts?.human_presence,
        human_count: Math.max(0, Number(analysis.source_facts?.human_count || 0) || 0),
        human_actions: list(analysis.source_facts?.human_actions).slice(0, 12).map(item => clean(item, 220)),
        animal_presence: analysis.source_facts?.animal_presence,
        narrative_animal_presence: analysis.source_facts?.narrative_animal_presence,
        ambient_animals: list(analysis.source_facts?.ambient_animals).slice(0, 12).map(item => clean(item, 220)),
        animal_actions: list(analysis.source_facts?.animal_actions).slice(0, 12).map(item => clean(item, 220)),
      },
      analysis_valid: analysis.analysis_quality?.valid === true,
      story_outline: analysis.story_outline && typeof analysis.story_outline === 'object'
        ? analysis.story_outline
        : {},
      plot_beats: list(analysis.plot_beats).slice(0, 24),
      character_prompts: list(analysis.character_prompts).slice(0, 12),
      animal_prompts: list(analysis.animal_prompts).slice(0, 12),
      scene_prompts: list(analysis.scene_prompts).slice(0, 120),
      shot_breakdown: list(analysis.shot_breakdown).slice(0, 120),
      camera_intents: list(analysis.camera_intents).slice(0, 24),
      character_actions: list(analysis.character_actions).slice(0, 24),
      ...referenceUnderstandingProjection.project(taskId, context, analysis),
    };
    bundle.brief = {
      project_name: clean(context.project_name || raw.task.title, 120),
      text: clean(context.brief || raw.task.brief, 3000),
      product_subject: clean(context.product_subject, 200),
      product_presentation: productAssetResolver.productPresentation(context),
      target_duration: Number(context.target_duration || context.duration || 0) || 0,
      output_ratio: clean(context.output_ratio || '9:16', 20),
      output_size: clean(context.output_size || 'standard', 30),
      video_resolution: clean(context.video_resolution || '1080p', 30),
      video_quality: clean(context.video_quality || 'final', 30),
      cast_mode: clean(context.cast_mode || context.person_spec?.castMode || 'auto', 40),
      expected_people: Math.max(0, Number(context.expected_people || 0) || 0),
      expected_animals: Math.max(0, Number(context.expected_animals || 0) || 0),
      brief_source: clean(context.brief_source, 40),
      asset_setup_confirmed: context.asset_setup_confirmed === true,
      shot_design_confirmed: context.shot_design_confirmed === true,
      creative_direction: context.creative_direction || null,
      benchmark_strategy: benchmarkStrategy.resolve({ ...context, product_presentation: productAssetResolver.productPresentation(context) }),
    };
  }

  if (include('assets')) {
    bundle.assets = {
      ...projectedAssets,
      relations: list(context.subject_relations || context.asset_relations).slice(0, 200),
    };
    bundle.asset_editor = {
      scene_plan: outputs.scene_config && typeof outputs.scene_config === 'object'
        ? outputs.scene_config
        : (context.scene_plan && typeof context.scene_plan === 'object' ? context.scene_plan : { scene_mode: 'auto', spaces: [] }),
    };
  }

  if (include('story')) {
    bundle.story = referenceDrafts.storySection(context, outputs);
  }

  if (include('shots')) {
    bundle.storyboard = referenceDrafts.storyboardSection(context, outputs, raw);
    bundle.storyboard.sketch_gate = storyboardSketchGate.inspect(taskId);
    bundle.storyboard.reference_packs = list(outputs.shot_reference_packs).slice(0, 200);
    if (!bundle.navigation.counts.shots) bundle.navigation.counts.shots = bundle.storyboard.shots.length;
  }

  if (include('media')) {
    bundle.generation = {
      keyframes: list(outputs.keyframes).slice(0, 200),
      clips: list(outputs.video_clips).slice(0, 200),
      final_video: outputs.final_video || null,
      media_result: raw.media_result || outputs.media_result || null,
      keyframe_status: raw.keyframe_status || null,
      video_shot_statuses: list(raw.video_shot_statuses).slice(0, 200),
      progress: raw.task.generation_progress || null,
    };
  }

  bundle.payload_bytes = Buffer.byteLength(JSON.stringify(bundle), 'utf8');
  return bundle;
}

module.exports = { buildProjectBundle, displayId, listProjects, projectSceneCamera, projectStats, projectSummary, workspaceStage };
