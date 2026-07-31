const storyAd = require('../newStoryAd');

const MAX_MEDIA_ITEMS = 120;

/** 把任意值整理为安全短文本，避免把大型提示词带入工作区首包。 */
function clean(value = '', max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 只返回真实数组，避免各页面重复编写兼容判断。 */
function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

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
    appearanceText: clean(source.appearanceText || source.appearance?.userPrompt || source.appearance?.description || source.description, 800),
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
function peopleAssets(context = {}) {
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
    const canonical = personProfile({ ...profile, ...(item.subject_profile || {}) }, index);
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
        width: Math.max(0, Number(item.dossier_sheet?.width || 0) || 0),
        height: Math.max(0, Number(item.dossier_sheet?.height || 0) || 0),
      } : null,
      view_images: views,
      profile: canonical,
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
  const product = context.product_asset && typeof context.product_asset === 'object'
    ? context.product_asset
    : null;
  if (!product && !clean(context.product_subject)) return [];
  return [{
    id: clean(product?.id || product?.asset_id || 'product-primary', 120),
    kind: 'product',
    name: clean(product?.name || context.product_subject || '商品主体', 120),
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

/** 将现有场景产物整理为场景与机位资产。 */
function sceneAssets(outputs = {}, context = {}) {
  const source = list(outputs.scene_assets).length ? list(outputs.scene_assets) : list(context.scene_assets);
  return source.slice(0, MAX_MEDIA_ITEMS).map((item, index) => ({
    id: clean(item.scene_id || item.id || `scene-${index + 1}`, 120),
    kind: 'scene',
    name: clean(item.name || item.scene_name || `场景 ${index + 1}`, 120),
    image_url: mediaUrl(item),
    view_images: list(item.view_images).slice(0, 20).map(view => ({
      key: clean(view.key || view.id || view.label, 80),
      label: clean(view.label || view.name || view.key, 100),
      image_url: mediaUrl(view),
    })),
    status: clean(item.scene_contract?.status || item.status || 'draft', 50),
    zones: list(item.scene_contract?.zones).slice(0, 30).map(zone => ({
      id: clean(zone.id, 100),
      label: clean(zone.label_zh || zone.label || zone.name, 120),
    })),
    cameras: list(item.scene_contract?.camera_positions || item.camera_positions).slice(0, 30).map(camera => ({
      id: clean(camera.id || camera.key, 100),
      label: clean(camera.label || camera.name || camera.id, 120),
    })),
  }));
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
    workspace: workspaceStage(raw.task, outputs),
    saved_progress: raw.task.saved_progress === true,
    active_stage: clean(raw.task.active_stage, 80),
  };
  const bundle = {
    schema_version: 'story-ad-project-bundle-v1',
    project,
    navigation: {
      current: project.workspace,
      counts: {
        assets: peopleAssets(context).length
          + animalAssets(context).length
          + productAssets(context).length
          + logoAssets(context).length
          + sceneAssets(outputs, context).length
          + propAssets(outputs, context).length,
        scenes: sceneAssets(outputs, context).length,
        shots: list(outputs.storyboard_table).length,
        keyframes: list(outputs.keyframes).length,
        clips: list(outputs.video_clips).length,
      },
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
        human_actions: list(analysis.source_facts?.human_actions).slice(0, 12).map(item => clean(item, 220)),
      },
      analysis_valid: analysis.analysis_quality?.valid === true,
    };
    bundle.brief = {
      text: clean(context.brief || raw.task.brief, 3000),
      product_subject: clean(context.product_subject, 200),
      target_duration: Number(context.target_duration || context.duration || 0) || 0,
      output_ratio: clean(context.output_ratio || '9:16', 20),
      output_size: clean(context.output_size || 'standard', 30),
      video_resolution: clean(context.video_resolution || '720p', 30),
      cast_mode: clean(context.cast_mode || context.person_spec?.castMode || 'auto', 40),
      expected_people: Math.max(0, Number(context.expected_people || 0) || 0),
      expected_animals: Math.max(0, Number(context.expected_animals || 0) || 0),
      creative_direction: context.creative_direction || null,
    };
  }

  if (include('assets')) {
    bundle.assets = {
      people: peopleAssets(context),
      animals: animalAssets(context),
      products: productAssets(context),
      logos: logoAssets(context),
      props: propAssets(outputs, context),
      scenes: sceneAssets(outputs, context),
      relations: list(context.subject_relations || context.asset_relations).slice(0, 200),
    };
  }

  if (include('story')) {
    bundle.story = {
      setup: context.story_setup || null,
      blueprint: outputs.blueprint || null,
      status: outputs.blueprint ? 'ready' : 'empty',
    };
  }

  if (include('shots')) {
    bundle.storyboard = {
      shots: list(outputs.storyboard_table).slice(0, 200),
      sketches: list(outputs.storyboard_sketches).slice(0, 200),
      status: raw.storyboard_status || null,
      continuity: list(outputs.continuity_contracts || outputs.keyframe_contracts).slice(0, 200),
    };
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

module.exports = {
  buildProjectBundle,
  displayId,
  listProjects,
  projectStats,
  projectSummary,
  workspaceStage,
};
