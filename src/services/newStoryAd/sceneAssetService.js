const { v4: uuidv4 } = require('uuid');
const storage = require('./storageService');
const mediaAdapter = require('./mediaAdapter');
const { cleanText } = require('./contextBuilder');
const sceneSpace = require('./sceneSpaceContractService');
const cancellation = require('./cancellationContext');
const sceneViewStrategy = require('./sceneViewStrategyService');
const shotDesign = require('./shotDesignService');

const SCENE_VIEW_KEYS = ['master', 'reverse', 'interaction', 'detail'];
const REQUIRED_SCENE_VIEW_KEYS = ['layout', ...SCENE_VIEW_KEYS];
const SCENE_REPAIR_PLAN_VERSION = 1;

function sceneViewLabel(key = '') {
  return {
    master: '主视角',
    reverse: '反向/侧向',
    interaction: '互动位',
    detail: '材质细节',
    layout: '俯视布局',
  }[key] || key || '场景视角';
}

function normalizeSceneView(view = {}, index = 0) {
  const key = cleanText(view.key || view.view || SCENE_VIEW_KEYS[index] || `view_${index + 1}`, 40);
  const url = cleanText(view.url || view.image_url || view.imageUrl || view.file_url || '', 1000);
  return {
    key,
    label: cleanText(view.label || sceneViewLabel(key), 80),
    url,
    image_url: cleanText(view.image_url || url, 1000),
    source_url: cleanText(view.source_url || view.sourceUrl || '', 1600),
    filename: cleanText(view.filename || '', 160),
    provider_used: cleanText(view.provider_used || '', 160),
    camera_id: cleanText(view.camera_id || 'camera_' + key, 100),
  };
}

function normalizeSceneAsset(asset = {}, index = 0) {
  if (!asset || typeof asset !== 'object') return null;
  const viewImages = Array.isArray(asset.view_images)
    ? asset.view_images.map(normalizeSceneView).filter(view => view.url || view.image_url).slice(0, 8)
    : [];
  const primary = cleanText(asset.image_url || asset.url || viewImages[0]?.url || viewImages[0]?.image_url || '', 1000);
  if (!primary && !viewImages.length && !asset.layout_summary && !asset.material_summary) return null;
  return {
    id: cleanText(asset.id || asset.scene_id || `scene_${index + 1}`, 120),
    scene_id: cleanText(asset.scene_id || asset.id || `scene_${index + 1}`, 120),
    name: cleanText(asset.name || `任务场景 ${index + 1}`, 120),
    source: cleanText(asset.source || 'new_story_ad_scene_asset', 120),
    lock_strength: cleanText(asset.lock_strength || asset.lockStrength || 'standard', 40),
    layout_summary: cleanText(asset.layout_summary || asset.layoutSummary || asset.description || '', 1000),
    material_summary: cleanText(asset.material_summary || asset.materialSummary || '', 1000),
    interaction_summary: cleanText(asset.interaction_summary || asset.interactionSummary || '', 800),
    style_summary: cleanText(asset.style_summary || asset.styleSummary || '', 800),
    negative: cleanText(asset.negative || asset.negative_prompt || '', 800),
    surface_topology: shotDesign.normalizeSurfaceTopology(asset.surface_topology || asset.surfaceTopology),
    image_url: primary,
    url: primary,
    view_images: viewImages,
    view_count: Number(asset.view_count || viewImages.length || (primary ? 1 : 0)) || 0,
    view_strategy: cleanText(asset.view_strategy || asset.viewStrategy || 'image_derived', 40),
    view_acquisition: asset.view_acquisition && typeof asset.view_acquisition === 'object' ? asset.view_acquisition : null,
    scene_revision: Math.max(1, Number(asset.scene_revision || asset.sceneRevision || 1) || 1),
    scene_contract: asset.scene_contract && typeof asset.scene_contract === 'object'
      ? sceneSpace.normalizeContract(asset.scene_contract, {
        sceneId: asset.scene_id || asset.id,
        revision: asset.scene_revision || 1,
        views: viewImages,
      })
      : null,
    cross_view_qa: asset.cross_view_qa || asset.scene_contract?.cross_view_qa || null,
    requirement_qa: asset.requirement_qa || asset.scene_contract?.requirement_qa || null,
    layout_contract: asset.layout_contract || asset.scene_contract?.layout_contract || null,
    provider_used: cleanText(asset.provider_used || '', 240),
    prompt: cleanText(asset.prompt || '', 6000),
    repair_plan: asset.repair_plan && typeof asset.repair_plan === 'object'
      ? asset.repair_plan
      : buildSceneRepairPlan(asset),
    repair_history: Array.isArray(asset.repair_history) ? asset.repair_history.slice(-8) : [],
    created_at: asset.created_at || new Date().toISOString(),
  };
}

function normalizeSceneAssets(input = []) {
  const raw = Array.isArray(input) ? input : [];
  return raw.map(normalizeSceneAsset).filter(Boolean);
}

function normalizeRepairViewKeys(input = []) {
  const source = Array.isArray(input) ? input : [];
  return REQUIRED_SCENE_VIEW_KEYS.filter(key => source.includes(key));
}

function buildSceneRepairPlan(asset = {}) {
  const contract = asset.scene_contract && typeof asset.scene_contract === 'object'
    ? asset.scene_contract
    : asset;
  const requirement = contract.requirement_qa || asset.requirement_qa || {};
  const crossView = contract.cross_view_qa || asset.cross_view_qa || {};
  const spatial = contract.spatial_coverage_qa || asset.spatial_coverage_qa || {};
  const verificationState = cleanText(contract.verification?.state || asset.verification?.state || '', 40);
  const reasons = [...new Set([
    ...(Array.isArray(contract.verification?.reasons) ? contract.verification.reasons : []),
    ...(Array.isArray(requirement.mismatch_reasons) ? requirement.mismatch_reasons : []),
    ...(Array.isArray(crossView.mismatch_reasons) ? crossView.mismatch_reasons : []),
    ...(Array.isArray(spatial.reasons) ? spatial.reasons : []),
    ...(Array.isArray(spatial.mismatch_reasons) ? spatial.mismatch_reasons : []),
  ].map(value => cleanText(value, 300)).filter(Boolean))].slice(0, 12);
  if (contract.full_space_lock === true) {
    return { version: SCENE_REPAIR_PLAN_VERSION, action: 'none', view_keys: [], view_labels: [], count: 0, reasons: [], message: '完整空间已经锁定，无需修复。' };
  }
  if (contract.qa_unavailable === true || verificationState === 'unavailable') {
    return { version: SCENE_REPAIR_PLAN_VERSION, action: 'reverify', view_keys: [], view_labels: [], count: 0, reasons, message: '图片无需重新生成，请稍后再次验证。' };
  }

  const keys = new Set();
  const combined = reasons.join('；');
  const below = (value, threshold) => Number.isFinite(Number(value)) && Number(value) < threshold;
  if (below(requirement.layout_match_score, 0.75)
    || below(spatial.layout_topology_score, 0.8)
    || /俯视|顶视|轴测|布局参考|布局拓扑|第\s*5\s*张|layout/i.test(combined)) keys.add('layout');
  if (below(requirement.material_light_match_score, 0.75)
    || /材质|拉丝|蚀刻|纹理|光线|灯光|反射|金属/i.test(combined)) {
    keys.add('master');
    keys.add('detail');
  }
  if (below(requirement.interaction_match_score, 0.7)
    || below(spatial.interaction_zone_score, 0.7)
    || /互动|交互|行动区|活动区域|动线|站位/i.test(combined)) keys.add('interaction');
  if (below(requirement.surface_topology_match_score, 0.8)
    || below(requirement.negative_compliance_score, 0.9)
    || /拼缝|接缝|板块|模块|禁止项|违禁/i.test(combined)) keys.add('master');
  if (below(spatial.reverse_coverage_score, 0.75)
    || /反向|侧向|背向空间/i.test(combined)) keys.add('reverse');
  if (below(spatial.camera_diversity_score, 0.75)
    || /机位差异|视图多样|多视图[^。；]{0,24}重复|参考图[^。；]{0,24}重复/i.test(combined)) {
    keys.add('reverse');
    keys.add('interaction');
  }
  if (crossView.pass === false) {
    keys.add('reverse');
    keys.add('interaction');
    keys.add('detail');
  }
  if (!keys.size) REQUIRED_SCENE_VIEW_KEYS.forEach(key => keys.add(key));

  // 蓝图或主视角一旦变化，所有依赖它的派生视图也必须同步更新。
  if (keys.has('layout')) REQUIRED_SCENE_VIEW_KEYS.forEach(key => keys.add(key));
  else if (keys.has('master')) SCENE_VIEW_KEYS.forEach(key => keys.add(key));
  const viewKeys = REQUIRED_SCENE_VIEW_KEYS.filter(key => keys.has(key));
  return {
    version: SCENE_REPAIR_PLAN_VERSION,
    action: 'regenerate_failed_views',
    view_keys: viewKeys,
    view_labels: viewKeys.map(sceneViewLabel),
    count: viewKeys.length,
    reasons: reasons.slice(0, 6),
    message: `系统将保留通过项，并按依赖关系重新生成 ${viewKeys.length} 张：${viewKeys.map(sceneViewLabel).join('、')}。`,
  };
}

function buildSceneSheetPrompt({ ctx = {}, sceneConfig = {}, body = {}, outputRole = 'master' } = {}) {
  const brief = cleanText(ctx.brief || body.brief || '', 1600);
  const subject = cleanText(ctx.product_subject || sceneConfig.advertised_subject || body.product_subject || '', 240);
  const sceneSpec = body.scene_spec || body.sceneSpec || ctx.scene_spec || {};
  const custom = cleanText(body.description || body.scene_description || body.prompt || '', 1200);
  const layout = cleanText(sceneSpec.layoutText || sceneSpec.layout_text || sceneSpec.layout || '', 800);
  const materialLight = cleanText(sceneSpec.materialLightText || sceneSpec.material_light_text || sceneSpec.material || sceneSpec.light || '', 800);
  const interaction = cleanText(sceneSpec.interactionText || sceneSpec.interaction_text || sceneSpec.interaction || sceneSpec.camera || '', 600);
  const style = cleanText(ctx.controlled_production?.style_control?.notes || '', 600);
  const negative = cleanText(sceneSpec.negativeText || sceneSpec.negative_text || ctx.controlled_production?.negative_control?.text || body.negative || '', 800);
  const repairFeedback = cleanText(body.repair_feedback || body.repairFeedback || '', 1200);
  const surfaceTopology = shotDesign.resolveSurfaceTopology(
    sceneSpec.surfaceTopology || sceneSpec.surface_topology,
    [layout, materialLight, negative, sceneSpec.surfaceTopology?.notes, sceneSpec.surface_topology?.notes],
  );
  const surfaceTopologyPrompt = surfaceTopology ? shotDesign.surfacePrompt(surfaceTopology, 'environment') : '';
  const noHumanNegative = [
    'Absolutely empty scene only.',
    'No people, no human figure, no actor, no model, no presenter, no customer, no staff.',
    'No back view, no side profile, no face, no head, no hair, no body, no arms, no hands, no legs, no silhouette, no reflection of a person.',
    'Do not use human scale figures or mannequins as spatial references; use furniture, product plinths, counters, empty walking space or neutral props instead.',
  ].join(' ');
  const photographicRealism = [
    'Photographic realism requirements:',
    outputRole === 'layout'
      ? 'Make it look like a real location documented by an architectural survey camera from overhead, not an eye-level commercial still and not an AI concept render.'
      : 'Make it look like a real location or production set photographed by a commercial environment photographer, not an AI concept render.',
    'Use physically plausible camera perspective, lens compression and scene geometry; keep fixed structures, ground planes, fixtures, props and products aligned to one coherent spatial system.',
    surfaceTopology?.mode === 'continuous' || surfaceTopology?.seam_policy === 'hidden'
      ? 'Use real-world material scale: preserve the explicitly continuous surface topology while showing plausible contact shadows, subtle scratches, fingerprints, dust, uneven reflections and only construction details permitted by the task-specific seam policy.'
      : 'Use real-world material scale: visible panel seams, joints, bevels, contact shadows, subtle scratches, fingerprints, dust, uneven reflections and construction details where appropriate.',
    'Lighting must be believable: real fixture placement, soft falloff, mixed practical/ambient light, grounded shadows, no impossible glow, no floating highlights, no overly dramatic bloom.',
    outputRole === 'layout'
      ? 'Composition must prioritize the readable whole-space footprint, topology and relative coordinates over cinematic foreground/background depth.'
      : 'Composition should feel like a still from a real commercial shoot: natural framing, usable negative space, practical foreground/background depth, not a perfect symmetric AI-generated set.',
  ].join('\n');
  const antiAiNegative = [
    'Strict anti-AI / anti-render negatives:',
    'No CGI render look, no Unreal/Octane/3D render look, no plastic texture, no waxy surface, no over-smoothed material, no fantasy environment.',
    'No generic luxury template, no repeated procedural texture, no melted details, no impossible reflections, no glowing seams, no excessive contrast, no heavy HDR, no fake bokeh.',
    'No decorative text, no poster layout, no floating objects, no warped geometry, no inconsistent material direction between panels.',
  ].join(' ');
  const outputInstruction = outputRole === 'layout'
    ? [
      'Create one unmistakable photorealistic SPATIAL BLUEPRINT for a reusable commercial video scene before any cinematic camera view is designed.',
      'The camera pitch must be 55 to 90 degrees downward: use a high oblique axonometric or true top-down whole-space composition that exposes the complete floor boundary, at least three wall planes, openings, fixed structures, anchor furniture/props, circulation path and interaction zone in one coherent coordinate system.',
      'This blueprint is the authoritative geometry source for all later camera views. Prioritize spatial legibility and relative positions over dramatic composition; do not hide essential topology behind foreground objects.',
      'An eye-level room photo, frontal wall elevation, close crop, or composition that resembles a cinematic master view is INVALID for this output.',
    ]
    : outputRole === 'contract'
      ? ['Use the following task-specific scene contract as the content authority for the requested spatial asset.']
      : [
      'Create one photorealistic MASTER REFERENCE VIEW for a reusable commercial video scene.',
      'Use a wide eye-level or slightly elevated three-quarter establishing composition derived from the locked spatial blueprint, clearly showing the main scene identity and anchor relations without looking top-down.',
      ];
  return [
    ...outputInstruction,
    'This is an EMPTY SCENE asset, not a storyboard keyframe and not a collage. It must contain exactly one continuous camera view, no panels, no split screen, no labels, no people or human-like subjects.',
    photographicRealism,
    outputRole === 'layout'
      ? 'Show the entire spatial footprint in one overhead or axonometric survey; do not use an eye-level or frontal commercial-camera composition.'
      : 'Use a wide establishing composition that clearly defines the whole spatial layout and the relative position of fixed structures and movable anchors.',
    brief ? `Campaign brief: ${brief}` : '',
    subject ? `Advertised subject: ${subject}` : '',
    custom ? `User scene requirement: ${custom}` : '',
    layout ? `Scene layout requirement: ${layout}` : '',
    materialLight ? `Scene material and lighting requirement: ${materialLight}` : '',
    interaction ? `Scene interaction and camera position requirement: ${interaction}` : '',
    surfaceTopologyPrompt ? `Task-specific surface construction contract:\n${surfaceTopologyPrompt}` : '',
    sceneConfig.business_boundary ? `Business boundary: ${cleanText(sceneConfig.business_boundary, 500)}` : '',
    sceneConfig.story_strategy ? `Scene/story strategy: ${cleanText(JSON.stringify(sceneConfig.story_strategy), 900)}` : '',
    style ? `Visual style direction: ${style}` : '',
    `Hard negative requirements: ${noHumanNegative}`,
    antiAiNegative,
    negative ? `Additional negative requirements: ${negative}` : '',
    repairFeedback ? `Mandatory correction from the previous rejected attempt: ${repairFeedback}. Create a fresh role-correct image and do not reproduce the rejected composition.` : '',
    outputRole === 'layout'
      ? 'Final look target: a clearly overhead or axonometric photorealistic architectural survey with readable topology and realistic materials.'
      : 'Final look target: real camera photography, authentic commercial location, natural commercial lighting, realistic materials, coherent spatial geometry and consistent perspective.',
  ].filter(Boolean).join('\n\n');
}

async function localizeSceneViews(views = [], { taskId = '', sceneId = '', revision = 1 } = {}) {
  const normalized = (Array.isArray(views) ? views : []).map(normalizeSceneView);
  return Promise.all(normalized.map(async (view, index) => {
    const sourceUrl = view.url || view.image_url || '';
    if (!/^https?:\/\//i.test(sourceUrl)) return view;
    const persisted = await mediaAdapter.persistImageResult({
      result: { image_url: sourceUrl, url: sourceUrl },
      filename: `scene_asset_${taskId || 'task'}_${sceneId || 'scene'}_r${Math.max(1, Number(revision) || 1)}_${view.key || index}_${Date.now()}_${index}`,
      thumbnailWidths: [360, 560],
    });
    return normalizeSceneView({
      ...view,
      filename: persisted.filename,
      source_url: sourceUrl,
      url: persisted.url,
      image_url: persisted.image_url,
    }, index);
  }));
}

function relinkContractViews(contract = null, views = []) {
  if (!contract || typeof contract !== 'object') return contract;
  const viewMap = new Map((views || []).map(view => [String(view.key || ''), view.url || view.image_url || '']));
  return {
    ...contract,
    cameras: Array.isArray(contract.cameras) ? contract.cameras.map(camera => ({
      ...camera,
      reference_image_url: viewMap.get(String(camera.view_id || '')) || camera.reference_image_url || '',
    })) : contract.cameras,
    layout_contract: contract.layout_contract && typeof contract.layout_contract === 'object'
      ? {
        ...contract.layout_contract,
        reference_image_url: viewMap.get('layout') || contract.layout_contract.reference_image_url || '',
      }
      : contract.layout_contract,
  };
}

async function localizeSceneAssets(sceneAssets = [], { taskId = '' } = {}) {
  const normalized = normalizeSceneAssets(sceneAssets);
  const localized = [];
  for (const asset of normalized) {
    const views = await localizeSceneViews(asset.view_images || [], {
      taskId,
      sceneId: asset.scene_id || asset.id,
      revision: asset.scene_revision || 1,
    });
    const contract = relinkContractViews(asset.scene_contract, views);
    localized.push(normalizeSceneAsset({
      ...asset,
      image_url: views[0]?.url || asset.image_url || '',
      url: views[0]?.url || asset.url || '',
      view_images: views,
      scene_contract: contract,
      cross_view_qa: contract?.cross_view_qa || asset.cross_view_qa,
    }));
  }
  return localized;
}

function buildDerivedViewPrompt(scenePrompt = '', viewKey = '', options = {}) {
  const instruction = {
    master: 'Generate the MASTER ESTABLISHING VIEW of the exact space defined by the supplied spatial blueprint. Use a natural eye-level or slightly elevated three-quarter wide camera, not a top-down view. Show enough floor, ceiling and at least two adjoining spatial planes to establish scale, depth, entrances and anchor relations. Translate the blueprint into a believable commercial photograph without moving, deleting or inventing any opening, fixed structure, anchor object, circulation route or interaction zone.',
    reverse: 'Generate a TRUE REVERSE OR SIDE VIEW of the exact same physical space, not a small reframing of the master. Move the camera to a geometrically plausible opposite or side sector with at least about 90 degrees of azimuth change from the master camera. Swap the foreground/background relationship and reveal at least one wall, opening, boundary or anchor relation that the master cannot show clearly. Do not mirror the master, reuse its near-identical composition, or keep the camera in the same frontal sector. Preserve every fixed structure, opening, anchor object, material, color, light source and relative position.',
    interaction: 'Generate a DISTINCT INTERACTION-POSITION VIEW inside the exact same physical space. Place the camera at practical human eye/chest height beside the locked interaction zone. Clearly show an empty standing/action clearance, the reachable target surface or product position, and the route into and out of that zone. This must be a usable blocking camera, not another establishing shot and not a duplicate of the master or reverse view. Preserve all blueprint coordinates and do not add any person, mannequin or human reflection.',
    detail: 'Generate a TRUE MATERIAL / CONSTRUCTION DETAIL VIEW captured inside the exact same physical space. Use a close or macro crop that makes real material scale, texture direction, surface transition, contact shadow, fixture edge or permitted assembly detail readable. It must not be another wide room view. Use only materials, finishes, seams and fixtures supported by the blueprint and master. Respect the task-specific surface topology and seam policy; do not invent panels, joints or decorative composition.',
  }[viewKey] || 'Generate another camera view of the exact same physical space without redesigning it.';
  const fallbackOrder = options.hasMasterReference === true
    ? (options.hasLayoutReference === false ? ['master'] : ['layout', 'master'])
    : (options.hasLayoutReference === false ? [] : ['layout']);
  const referenceOrder = (Array.isArray(options.referenceOrder) ? options.referenceOrder : fallbackOrder)
    .filter(key => key === 'layout' || key === 'master');
  const hasLayoutReference = referenceOrder.includes('layout');
  const hasMasterReference = referenceOrder.includes('master');
  const referenceDescriptions = referenceOrder.map((key, index) => key === 'layout'
    ? `Reference image ${index + 1} is the spatial blueprint.`
    : `Reference image ${index + 1} is the master establishing view.`);
  const referenceAuthority = [
    ...referenceDescriptions,
    hasLayoutReference
      ? 'The supplied spatial blueprint is the canonical authority for geometry, topology, openings, zones and relative coordinates.'
      : '',
    hasMasterReference
      ? 'The supplied master view is the canonical authority for photographic appearance, material identity, color, lighting direction and object design.'
      : '',
    hasLayoutReference && hasMasterReference
      ? 'Resolve any ambiguity by preserving blueprint geometry first and master-view appearance second; never redesign either source.'
      : '',
  ].filter(Boolean).join(' ');
  return [
    instruction,
    referenceAuthority,
    viewKey === 'reverse' || viewKey === 'interaction'
      ? 'This is a deliberate camera relocation task. Preserve scene identity, but do not reproduce the master image pixel composition, crop, camera sector or foreground/background arrangement.'
      : '',
    'Output one continuous photorealistic image only, no collage, no split screen, no labels, no logo and no people.',
    'Scene identity lock is strict: preserve spatial geometry, anchor relations, material family and lighting direction.',
    cleanText(options.repairFeedback || '', 1200)
      ? `Mandatory correction from the previous rejected attempt: ${cleanText(options.repairFeedback, 1200)}. Do not repeat the rejected composition.`
      : '',
    scenePrompt,
  ].filter(Boolean).join('\n\n');
}

function buildSceneAuditSafePrompt({ ctx = {}, body = {}, viewKey = 'master' } = {}) {
  const requested = sceneRequest(ctx, body);
  const roleInstruction = {
    layout: 'Create a high-oblique architectural survey of one coherent commercial interior. Use a 55-90 degree downward camera and show the complete floor boundary, at least three wall planes, openings, fixed anchors, circulation and the interaction zone.',
    master: 'Create the master establishing photograph of the supplied spatial blueprint. Use an eye-level or slightly elevated three-quarter wide camera and preserve all blueprint coordinates, openings and anchors.',
    reverse: 'Create a true reverse or side camera view of the supplied scene. Relocate the camera by about 90 degrees, exchange foreground and background, and reveal a boundary or opening hidden in the master view while preserving the same space.',
    interaction: 'Create a distinct practical interaction-position camera view inside the supplied scene. Clearly reveal the empty action clearance, reachable target surface and circulation route while preserving the same space.',
    detail: 'Create a close material and construction photograph inside the supplied scene. Make the required metal finish, texture direction, surface transition, fixture edge and realistic material scale clearly readable.',
  }[viewKey] || 'Create a coherent photorealistic architectural interior reference.';
  const topology = requested.surface_topology
    ? shotDesign.surfacePrompt(requested.surface_topology, 'environment')
    : '';
  return [
    roleInstruction,
    'Output one continuous photorealistic architectural image with natural perspective, physically plausible geometry, realistic material scale and believable commercial lighting.',
    requested.layout ? `Spatial design: ${requested.layout}` : '',
    requested.material_light ? `Materials and lighting: ${requested.material_light}` : '',
    requested.interaction ? `Camera and interaction zone: ${requested.interaction}` : '',
    topology ? `Surface construction: ${topology}` : '',
    requested.style ? `Visual style: ${requested.style}` : '',
    'The frame is an unoccupied architectural reference containing only the designed space and its intended fixtures. Use a single camera view without typography, logos, montage or split panels.',
  ].filter(Boolean).join('\n\n').slice(0, 2200);
}

function needsLayoutView(requested = {}, body = {}) {
  // Every new scene defines its topology before cinematic views are derived.
  // Parameters remain accepted so historical callers do not need migration.
  void requested;
  void body;
  return true;
}

function legacyNeedsLayoutHeuristic(requested = {}, body = {}) {
  if (body.include_layout_view === true || body.includeLayoutView === true) return true;
  const text = [
    requested.layout,
    requested.interaction,
    requested.surface_topology?.notes,
    body.description,
  ].filter(Boolean).join(' ');
  if (/俯视|俯拍|鸟瞰|顶视|平面图|轴测|空间全貌|top.?down|bird.?s.?eye|floor.?plan|axonometric/i.test(text)) return true;
  if (/多区域|多个区域|跨区域|多入口|多个入口|双入口|多空间|多个空间|长运镜|连续穿行|跨区走位/i.test(text)) return true;
  const zoneHints = text.match(/主展示区|展示区|互动区|行动区|操作区|接待区|入口区|出口区|通道|走廊|前厅|后场|工作区|休息区|厨房|客厅/g) || [];
  const movement = /动线|路径|走位|穿行|进入|离开|绕行|连续摄影机/i.test(text);
  return new Set(zoneHints).size >= 3 && movement;
}

function sceneRequest(ctx = {}, body = {}) {
  const spec = body.scene_spec || body.sceneSpec || ctx.scene_spec || {};
  const layout = cleanText(spec.layoutText || spec.layout_text || spec.layout || body.layout_summary || '', 1000);
  const materialLight = cleanText(spec.materialLightText || spec.material_light_text || spec.material || spec.light || body.material_summary || '', 1000);
  const interaction = cleanText(spec.interactionText || spec.interaction_text || spec.interaction || spec.camera || '', 800);
  const negative = cleanText(spec.negativeText || spec.negative_text || body.negative || ctx.controlled_production?.negative_control?.text || '', 1000);
  return {
    layout,
    material_light: materialLight,
    interaction,
    surface_topology: shotDesign.resolveSurfaceTopology(
      spec.surfaceTopology || spec.surface_topology,
      [layout, materialLight, negative, spec.surfaceTopology?.notes, spec.surface_topology?.notes],
    ),
    style: cleanText(ctx.controlled_production?.style_control?.notes || body.style_summary || '', 800),
    negative,
  };
}

function resolvedSceneSpec(spec = {}, requested = {}) {
  const source = spec && typeof spec === 'object' ? spec : {};
  const { surface_topology: ignoredSurfaceTopology, ...rest } = source;
  return { ...rest, surfaceTopology: requested.surface_topology };
}

function mergeSceneAssets(existing = [], asset = {}) {
  const list = normalizeSceneAssets(existing);
  const row = normalizeSceneAsset(asset, list.length);
  if (!row) return list;
  const idx = list.findIndex(item => String(item.scene_id || item.id) === String(row.scene_id || row.id));
  if (idx >= 0) list[idx] = { ...list[idx], ...row, updated_at: new Date().toISOString() };
  else list.push(row);
  return list;
}

function saveSceneAssetsToTask(taskId, sceneAssets = [], options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const normalized = normalizeSceneAssets(sceneAssets);
  storage.saveOutput(taskId, 'scene_assets', normalized);
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const nextCtx = {
    ...ctx,
    ...(options.sceneSpec ? { scene_spec: options.sceneSpec } : {}),
    scene_assets: normalized,
  };
  storage.saveOutput(taskId, 'context', nextCtx);
  storage.updateTask(taskId, { request: nextCtx, updated_at: new Date().toISOString() });
  storage.saveStage(taskId, 'scene_asset', {
    status: 'done',
    output_summary: `${normalized.length} scene asset packages`,
  });
  return normalized;
}

async function generateSceneAsset(taskId, body = {}, runOptions = {}) {
  cancellation.throwIfCancelled(taskId);
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneConfig = storage.getOutput(taskId, 'scene_config') || {};
  const existing = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  const sceneId = cleanText(body.scene_id || body.sceneId || `scene_${Date.now()}_${uuidv4().slice(0, 6)}`, 120);
  const previous = normalizeSceneAssets(existing).find(item => String(item.scene_id) === String(sceneId));
  const repairViewKeys = previous ? normalizeRepairViewKeys(runOptions.repairViewKeys) : [];
  const repairMode = !!previous && repairViewKeys.length > 0;
  const previousViews = new Map((previous?.view_images || []).map((view, index) => {
    const normalized = normalizeSceneView(view, index);
    return [normalized.key, normalized];
  }));
  const shouldGenerate = key => !repairMode || repairViewKeys.includes(key) || !previousViews.has(key);
  const repairFeedback = cleanText(runOptions.repairFeedback || '', 1200);
  const promptBody = repairFeedback ? { ...body, repair_feedback: repairFeedback } : body;
  const requested = sceneRequest(ctx, body);
  const layoutRequired = needsLayoutView(requested, body);
  const legacyLayoutTrigger = legacyNeedsLayoutHeuristic(requested, body);
  const requiredViewKeys = layoutRequired ? REQUIRED_SCENE_VIEW_KEYS : SCENE_VIEW_KEYS;
  const viewAcquisition = sceneViewStrategy.resolveSceneViewStrategy({
    requested: body.view_strategy || body.viewStrategy || 'auto',
    requiredViews: requiredViewKeys,
    uploadedViewCount: Array.isArray(body.view_images) ? body.view_images.length : 0,
    videoAcquisitionEnabled: false,
  });
  const revision = Math.max(1, Number(previous?.scene_revision || 0) + 1);
  const scenePrompt = buildSceneSheetPrompt({ ctx, sceneConfig, body: promptBody, outputRole: 'contract' });
  const layoutPrompt = buildSceneSheetPrompt({ ctx, sceneConfig, body: promptBody, outputRole: 'layout' });
  const layout = shouldGenerate('layout')
    ? await mediaAdapter.generateImage({
      taskId,
      stage: 'new_story_ad.scene_asset',
      prompt: layoutPrompt,
      filename: 'scene_asset_' + taskId + '_' + sceneId + '_r' + revision + '_layout_' + Date.now(),
      aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
      resolution: body.resolution || '2K',
      imageModel: body.image_model || body.imageModel || 'auto',
      auditSafePrompt: buildSceneAuditSafePrompt({ ctx, body: promptBody, viewKey: 'layout' }),
    })
    : previousViews.get('layout');
  cancellation.throwIfCancelled(taskId);
  const layoutView = normalizeSceneView({
    key: 'layout',
    label: sceneViewLabel('layout'),
    url: layout.url || layout.image_url,
    image_url: layout.image_url || layout.url,
    provider_used: layout.provider_used,
  }, REQUIRED_SCENE_VIEW_KEYS.indexOf('layout'));
  const prompt = buildDerivedViewPrompt(scenePrompt, 'master', {
    referenceOrder: ['layout'],
    repairFeedback,
  });
  const master = shouldGenerate('master')
    ? await mediaAdapter.generateImage({
      taskId,
      stage: 'new_story_ad.scene_asset',
      prompt,
      filename: 'scene_asset_' + taskId + '_' + sceneId + '_r' + revision + '_master_' + Date.now(),
      aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
      resolution: body.resolution || '2K',
      imageModel: body.image_model || body.imageModel || 'auto',
      referenceImages: [layout.url || layout.image_url],
      requireReferences: true,
      // Camera role changes must be allowed to move away from the blueprint pixels.
      inputFidelity: 'low',
      auditSafePrompt: buildSceneAuditSafePrompt({ ctx, body: promptBody, viewKey: 'master' }),
    })
    : previousViews.get('master');
  cancellation.throwIfCancelled(taskId);
  const viewImages = [normalizeSceneView({
    key: 'master',
    label: sceneViewLabel('master'),
    url: master.url || master.image_url,
    image_url: master.image_url || master.url,
    provider_used: master.provider_used,
  }, 0)];
  cancellation.throwIfCancelled(taskId);
  const derivedViews = await Promise.all(SCENE_VIEW_KEYS.slice(1).map(async (key, index) => {
    if (!shouldGenerate(key)) return normalizeSceneView(previousViews.get(key), index + 1);
    const detailView = key === 'detail';
    const referenceImages = detailView
      ? [master.url || master.image_url]
      : [master.url || master.image_url, layout.url || layout.image_url];
    const generated = await mediaAdapter.generateImage({
      taskId,
      stage: 'new_story_ad.scene_asset',
      prompt: buildDerivedViewPrompt(scenePrompt, key, {
        referenceOrder: detailView ? ['master'] : ['master', 'layout'],
        repairFeedback,
      }),
      filename: 'scene_asset_' + taskId + '_' + sceneId + '_r' + revision + '_' + key + '_' + Date.now(),
      aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
      resolution: body.resolution || '2K',
      imageModel: body.image_model || body.imageModel || 'auto',
      referenceImages,
      requireReferences: true,
      // Reverse and interaction views require a real camera relocation. Detail
      // keeps high fidelity because only crop/scale should change.
      inputFidelity: detailView ? 'high' : 'low',
      auditSafePrompt: buildSceneAuditSafePrompt({ ctx, body: promptBody, viewKey: key }),
    });
    return normalizeSceneView({
      key,
      label: sceneViewLabel(key),
      url: generated.url || generated.image_url,
      image_url: generated.image_url || generated.url,
      provider_used: generated.provider_used,
    }, index + 1);
  }));
  cancellation.throwIfCancelled(taskId);
  viewImages.push(...derivedViews);
  viewImages.push(layoutView);
  const contractOptions = {
    taskId,
    sceneId,
    revision,
    views: viewImages.map(view => ({
      ...view,
      url: mediaAdapter.absolutePublicImageUrl(view.url || view.image_url),
      image_url: mediaAdapter.absolutePublicImageUrl(view.image_url || view.url),
    })),
    requested,
    layoutRequired,
  };
  let sceneContract = null;
  try {
    sceneContract = await sceneSpace.analyzeSceneViews(contractOptions);
  } catch (error) {
    if (!['VISION_QA_UNAVAILABLE', 'VISION_CIRCUIT_OPEN', 'VISION_REFERENCE_UNAVAILABLE', 'VISION_QA_SCHEMA_INVALID'].includes(error?.code)) throw error;
    // Keep the five successfully generated views instead of discarding costly
    // assets because an optional verifier is unavailable. The package remains
    // explicitly unverified and can be rechecked later; it is never mislabeled
    // as having passed commercial visual QA.
    sceneContract = sceneSpace.buildUnverifiedContract(contractOptions, error);
  }
  const localizedViews = await localizeSceneViews(viewImages, { taskId, sceneId, revision });
  sceneContract = relinkContractViews(sceneContract, localizedViews);
  viewImages.splice(0, viewImages.length, ...localizedViews);
  const providerUsed = [...new Set(viewImages.map(v => v.provider_used).filter(Boolean))].join(', ') || master.provider_used || layout.provider_used || '';
  const repairPlan = buildSceneRepairPlan({
    scene_contract: sceneContract,
    view_images: viewImages,
  });
  const repairHistory = [
    ...(Array.isArray(previous?.repair_history) ? previous.repair_history : []),
    ...(repairMode ? [{
      plan_version: SCENE_REPAIR_PLAN_VERSION,
      source_revision: previous.scene_revision || 1,
      revision,
      regenerated_view_keys: repairViewKeys,
      result: sceneContract.full_space_lock === true ? 'verified' : (sceneContract.qa_unavailable === true ? 'unavailable' : 'rejected'),
      created_at: new Date().toISOString(),
    }] : []),
  ].slice(-8);
  const asset = normalizeSceneAsset({
    id: sceneId,
    scene_id: sceneId,
    name: body.name || sceneConfig.advertised_subject || '剧情广告任务场景',
    source: 'new_story_ad_scene_sheet',
    scene_revision: revision,
    lock_strength: body.lock_strength || body.lockStrength || 'standard',
    layout_summary: body.layout_summary || body.layoutSummary || (body.scene_spec || body.sceneSpec || ctx.scene_spec || {}).layoutText || sceneConfig.business_boundary || ctx.brief || '',
    material_summary: body.material_summary || body.materialSummary || (body.scene_spec || body.sceneSpec || ctx.scene_spec || {}).materialLightText || '',
    interaction_summary: body.interaction_summary || body.interactionSummary || (body.scene_spec || body.sceneSpec || ctx.scene_spec || {}).interactionText || '',
    style_summary: ctx.controlled_production?.style_control?.notes || '',
    negative: [
      '空场景资产，不要出现真人、背影、侧脸、手、身体局部、模特、人形剪影或人物倒影。',
      body.negative || (body.scene_spec || body.sceneSpec || ctx.scene_spec || {}).negativeText || ctx.controlled_production?.negative_control?.text || '',
    ].filter(Boolean).join('；'),
    surface_topology: requested.surface_topology,
    image_url: viewImages[0]?.url || '',
    view_images: viewImages.map(view => ({
      ...view,
      label: sceneViewLabel(view.key),
      provider_used: providerUsed,
    })),
    view_count: viewImages.length,
    view_strategy: viewAcquisition.selected,
    view_acquisition: {
      ...viewAcquisition,
      layout_policy: 'required_for_all_new_scenes',
      legacy_layout_trigger: legacyLayoutTrigger,
      generation_order: REQUIRED_SCENE_VIEW_KEYS,
      last_generated_views: repairMode ? repairViewKeys : REQUIRED_SCENE_VIEW_KEYS,
      repair_mode: repairMode,
      reference_graph: {
        layout: [],
        master: ['layout'],
        reverse: ['master', 'layout'],
        interaction: ['master', 'layout'],
        detail: ['master'],
      },
    },
    provider_used: providerUsed,
    prompt,
    scene_contract: sceneContract,
    cross_view_qa: sceneContract.cross_view_qa,
    requirement_qa: sceneContract.requirement_qa,
    layout_contract: sceneContract.layout_contract,
    verification: sceneContract.verification,
    repair_plan: repairPlan,
    repair_history: repairHistory,
  });
  const sceneAssets = mergeSceneAssets(existing, asset);
  saveSceneAssetsToTask(taskId, sceneAssets, {
    sceneSpec: resolvedSceneSpec(body.scene_spec || body.sceneSpec || ctx.scene_spec || {}, requested),
  });
  if (sceneContract.full_space_lock !== true) {
    storage.saveStage(taskId, 'scene_asset', {
      status: sceneContract.qa_unavailable === true ? 'warning' : 'review',
      output_summary: sceneContract.qa_unavailable === true
        ? '场景参考已保存，视觉验证服务暂不可用'
        : '场景参考已保存，但需求符合度、跨视图一致性或空间覆盖度尚未全部通过',
    });
  }
  return {
    scene_asset: asset,
    scene_assets: sceneAssets,
    provider_used: providerUsed,
    verification_status: sceneContract.status,
    space_lock_status: sceneContract.space_lock_status,
    full_space_lock: sceneContract.full_space_lock === true,
    repair_plan: repairPlan,
  };
}

async function repairSceneAsset(taskId, sceneId, body = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const assets = normalizeSceneAssets(storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || []);
  const asset = assets.find(item => String(item.scene_id || item.id) === String(sceneId || ''));
  if (!asset) {
    const error = new Error('要修复的场景不存在');
    error.code = 'SCENE_ASSET_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const plan = buildSceneRepairPlan(asset);
  if (plan.action === 'none') {
    const error = new Error('当前场景已经通过完整空间验证，无需重新生成');
    error.code = 'SCENE_ALREADY_VERIFIED';
    error.status = 409;
    throw error;
  }
  if (plan.action === 'reverify') {
    const error = new Error('当前图片没有内容缺陷，只需点击“再次验证”，无需付费重新生成');
    error.code = 'SCENE_REVERIFY_ONLY';
    error.status = 409;
    throw error;
  }
  const sceneSpec = body.scene_spec || body.sceneSpec || ctx.scene_spec || {
    layoutText: asset.layout_summary || '',
    materialLightText: asset.material_summary || '',
    interactionText: asset.interaction_summary || '',
    negativeText: asset.negative || '',
    surfaceTopology: asset.surface_topology || {},
  };
  return generateSceneAsset(taskId, {
    ...body,
    scene_id: asset.scene_id,
    scene_spec: sceneSpec,
    name: asset.name,
    lock_strength: asset.lock_strength,
  }, {
    repairViewKeys: plan.view_keys,
    repairFeedback: plan.reasons.join('；'),
  });
}

async function reverifySceneAsset(taskId, sceneId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const assets = normalizeSceneAssets(storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || []);
  const index = assets.findIndex(asset => String(asset.scene_id || asset.id) === String(sceneId || ''));
  if (index < 0) {
    const error = new Error('要重新验证的场景不存在');
    error.code = 'SCENE_ASSET_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const asset = assets[index];
  const views = (asset.view_images || []).map(view => ({
    ...view,
    url: mediaAdapter.absolutePublicImageUrl(view.url || view.image_url),
    image_url: mediaAdapter.absolutePublicImageUrl(view.image_url || view.url),
  }));
  if (views.length < 4) {
    const error = new Error('场景资产缺少完整四视图，需先重新生成当前场景');
    error.code = 'SCENE_VIEWS_INCOMPLETE';
    error.status = 422;
    throw error;
  }
  const contractOptions = {
    taskId,
    sceneId: asset.scene_id,
    revision: asset.scene_revision || 1,
    views,
    requested: {
      layout: asset.layout_summary || '',
      material_light: asset.material_summary || '',
      interaction: asset.interaction_summary || '',
      style: asset.style_summary || '',
      negative: asset.negative || '',
      surface_topology: asset.surface_topology || {},
    },
    layoutRequired: asset.layout_contract?.required === true || views.some(view => view.key === 'layout'),
  };
  let contract;
  try {
    contract = await sceneSpace.analyzeSceneViews(contractOptions);
  } catch (error) {
    if (!['VISION_QA_UNAVAILABLE', 'VISION_CIRCUIT_OPEN', 'VISION_REFERENCE_UNAVAILABLE', 'VISION_QA_SCHEMA_INVALID'].includes(error?.code)) throw error;
    contract = sceneSpace.buildUnverifiedContract(contractOptions, error);
  }
  assets[index] = {
    ...asset,
    scene_contract: contract,
    cross_view_qa: contract.cross_view_qa,
    requirement_qa: contract.requirement_qa,
    layout_contract: contract.layout_contract,
    verification: contract.verification,
    repair_plan: buildSceneRepairPlan({ scene_contract: contract, view_images: asset.view_images || [] }),
  };
  saveSceneAssetsToTask(taskId, assets);
  return { scene_asset: assets[index], scene_assets: assets };
}

module.exports = {
  SCENE_VIEW_KEYS,
  REQUIRED_SCENE_VIEW_KEYS,
  sceneViewLabel,
  buildSceneSheetPrompt,
  buildDerivedViewPrompt,
  buildSceneAuditSafePrompt,
  needsLayoutView,
  buildSceneRepairPlan,
  normalizeSceneAssets,
  localizeSceneViews,
  localizeSceneAssets,
  saveSceneAssetsToTask,
  generateSceneAsset,
  repairSceneAsset,
  reverifySceneAsset,
};
