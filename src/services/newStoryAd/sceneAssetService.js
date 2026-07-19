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
const SCENE_GENERATION_ORDER = ['master', 'layout', 'reverse', 'interaction', 'detail'];
const SCENE_REPAIR_PLAN_VERSION = 3;
const LAYOUT_APPEARANCE_ROLE = 'master_derived_photographic_overview';
const SCENE_IMAGE_MAX_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.NEW_STORY_AD_SCENE_IMAGE_MAX_ATTEMPTS || 3) || 3));
const SCENE_IMAGE_RETRY_DELAY_MS = Math.max(0, Math.min(5000, Number(process.env.NEW_STORY_AD_SCENE_IMAGE_RETRY_DELAY_MS || 1200) || 0));

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
    material_reference_available: asset.material_reference_available === true || asset.materialReferenceAvailable === true,
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
      && Number(asset.repair_plan.version || 0) >= SCENE_REPAIR_PLAN_VERSION
      ? asset.repair_plan
      : buildSceneRepairPlan(asset),
    repair_history: Array.isArray(asset.repair_history) ? asset.repair_history.slice(-8) : [],
    created_at: asset.created_at || new Date().toISOString(),
  };
}

function sceneMaterialReferenceImages(ctx = {}, body = {}) {
  const spec = body.scene_spec || body.sceneSpec || ctx.scene_spec || {};
  const candidates = [
    spec.material_reference_images,
    spec.materialReferenceImages,
    body.material_reference_images,
    body.materialReferenceImages,
    ctx.material_reference_images,
    ctx.materialReferenceImages,
    ctx.product_contract?.reference_images,
  ].flatMap(value => Array.isArray(value) ? value : (value ? [value] : []));
  return [...new Set(candidates.map(item => cleanText(
    typeof item === 'string' ? item : (item?.url || item?.image_url || item?.imageUrl || ''),
    1600,
  )).filter(value => /^https?:\/\/|^\//i.test(value)))].slice(0, 2);
}

function updateSceneGenerationProgress(taskId, update = {}) {
  const task = storage.getTask(taskId);
  if (!task) return null;
  const previous = task.generation_progress?.stage === 'scene_asset'
    ? task.generation_progress
    : {};
  const keys = normalizeRepairViewKeys(update.viewKeys?.length ? update.viewKeys : previous.view_keys);
  const priorStates = new Map((previous.view_states || []).map(item => [item.key, item]));
  const now = new Date().toISOString();
  const viewStates = keys.map(key => {
    const current = priorStates.get(key) || { key, label: sceneViewLabel(key), status: 'queued' };
    return key === update.viewKey
      ? {
          ...current,
          status: update.viewStatus || current.status,
          error: cleanText(update.error || '', 240),
          attempt: Math.max(1, Number(update.attempt || current.attempt || 1) || 1),
          max_attempts: Math.max(1, Number(update.maxAttempts || current.max_attempts || SCENE_IMAGE_MAX_ATTEMPTS) || SCENE_IMAGE_MAX_ATTEMPTS),
          retrying: update.retrying === true,
          updated_at: now,
        }
      : current;
  });
  const processed = viewStates.filter(item => ['succeeded', 'failed'].includes(item.status)).length;
  const succeeded = viewStates.filter(item => item.status === 'succeeded').length;
  const failed = viewStates.filter(item => item.status === 'failed').length;
  const phase = update.phase || previous.phase || 'preparing';
  const terminal = phase === 'complete';
  const progress = {
    schema_version: 1,
    stage: 'scene_asset',
    generation_id: task.active_generation_id || previous.generation_id || '',
    mode: update.mode || previous.mode || 'generate',
    phase,
    status: terminal ? 'completed' : (phase === 'verification' ? 'verifying' : (failed ? 'failed' : 'running')),
    view_keys: keys,
    target_total: keys.length,
    processed,
    succeeded,
    failed,
    active_view_keys: viewStates.filter(item => item.status === 'running').map(item => item.key),
    completed_view_keys: viewStates.filter(item => item.status === 'succeeded').map(item => item.key),
    view_states: viewStates,
    verification_state: cleanText(update.verificationState || previous.verification_state || '', 40),
    started_at: previous.started_at || task.generation_started_at || task.generation_queued_at || now,
    updated_at: now,
    ...(terminal ? { finished_at: now } : {}),
  };
  storage.updateTask(taskId, { generation_progress: progress });
  return progress;
}

async function generateTrackedSceneView(taskId, key, options = {}, progress = {}) {
  const retryable = error => /(?:\b500\b|internal server error|timeout|timed out|econnreset|econnrefused|socket hang up|\b429\b|rate.?limit|unkxxxo004ifr|temporar(?:y|ily)|service unavailable)/i
    .test(String(error?.message || error || ''));
  for (let attempt = 1; attempt <= SCENE_IMAGE_MAX_ATTEMPTS; attempt += 1) {
    updateSceneGenerationProgress(taskId, {
      ...progress,
      viewKey: key,
      viewStatus: 'running',
      phase: 'generation',
      attempt,
      maxAttempts: SCENE_IMAGE_MAX_ATTEMPTS,
      retrying: attempt > 1,
    });
    try {
      const result = await mediaAdapter.generateImage(options);
      updateSceneGenerationProgress(taskId, {
        ...progress,
        viewKey: key,
        viewStatus: 'succeeded',
        phase: 'generation',
        attempt,
        maxAttempts: SCENE_IMAGE_MAX_ATTEMPTS,
      });
      return result;
    } catch (error) {
      const willRetry = attempt < SCENE_IMAGE_MAX_ATTEMPTS && retryable(error);
      updateSceneGenerationProgress(taskId, {
        ...progress,
        viewKey: key,
        viewStatus: willRetry ? 'running' : 'failed',
        phase: 'generation',
        error: error?.message || error,
        attempt: willRetry ? attempt + 1 : attempt,
        maxAttempts: SCENE_IMAGE_MAX_ATTEMPTS,
        retrying: willRetry,
      });
      if (!willRetry) throw error;
      cancellation.throwIfCancelled(taskId);
      if (SCENE_IMAGE_RETRY_DELAY_MS > 0) {
        await new Promise(resolve => setTimeout(resolve, SCENE_IMAGE_RETRY_DELAY_MS * attempt));
      }
      cancellation.throwIfCancelled(taskId);
    }
  }
  throw new Error(`场景视图 ${sceneViewLabel(key)} 生成失败`);
}

function normalizeSceneAssets(input = []) {
  const raw = Array.isArray(input) ? input : [];
  return raw.map(normalizeSceneAsset).filter(Boolean);
}

function normalizeRepairViewKeys(input = []) {
  const source = Array.isArray(input) ? input : [];
  return SCENE_GENERATION_ORDER.filter(key => source.includes(key));
}

function failedViewKeysFromReasons(reasons = []) {
  const ordinalMap = {
    1: 'master', 2: 'reverse', 3: 'interaction', 4: 'detail', 5: 'layout',
    一: 'master', 二: 'reverse', 三: 'interaction', 四: 'detail', 五: 'layout',
  };
  const keys = new Set();
  const failurePattern = /不一致|完全不同|违反|不符|错误|缺失|不足|重复|副本|未能|失败|漂移|改变|替换|严重|无效|轻微抬高|重构|俯角/;
  for (const reason of reasons) {
    const text = cleanText(reason, 300);
    if (!failurePattern.test(text)) continue;
    const pattern = /第\s*([一二三四五1-5])\s*张(?:图|图片)?|图\s*([1-5])/g;
    for (const match of text.matchAll(pattern)) {
      const key = ordinalMap[match[1] || match[2]];
      if (key) keys.add(key);
    }
  }
  return REQUIRED_SCENE_VIEW_KEYS.filter(key => keys.has(key));
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
  const materialFailed = below(requirement.material_light_match_score, 0.75)
    || /材质|拉丝|蚀刻|纹理|光线|灯光|反射|金属|material|texture|finish|lighting|reflection/i.test(combined);
  const explicitFailedViewKeys = failedViewKeysFromReasons(reasons);
  explicitFailedViewKeys.forEach(key => keys.add(key));
  const hasUnscopedMaterialFailure = reasons.some(reason => (
    /材质|拉丝|蚀刻|纹理|光线|灯光|反射|金属|material|texture|finish|lighting|reflection/i.test(reason)
    && failedViewKeysFromReasons([reason]).length === 0
  ));
  if (explicitFailedViewKeys.length && materialFailed && hasUnscopedMaterialFailure) {
    keys.add('master');
    keys.add('detail');
  }
  if (!explicitFailedViewKeys.length) {
    if (below(requirement.layout_match_score, 0.75)
      || below(spatial.layout_topology_score, 0.8)
      || /俯视|顶视|轴测|布局参考|布局拓扑|第\s*5\s*张|layout/i.test(combined)) keys.add('layout');
    if (materialFailed) {
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
  }
  if (!keys.size) REQUIRED_SCENE_VIEW_KEYS.forEach(key => keys.add(key));

  // 主视角是整套资产唯一根参考；它变化时，空间全貌和全部派生视图必须同步更新。
  // 仅空间全貌角色失败时先只重建 layout 并复验；只有复验明确指出
  // reverse/interaction 也已不一致时才重做对应视图，避免无证据扩大付费生成。
  if (keys.has('master')) SCENE_GENERATION_ORDER.forEach(key => keys.add(key));
  const viewKeys = SCENE_GENERATION_ORDER.filter(key => keys.has(key));
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
  const subject = cleanText(ctx.product_subject || sceneConfig.advertised_subject || body.product_subject || '', 240);
  const sceneSpec = body.scene_spec || body.sceneSpec || ctx.scene_spec || {};
  const custom = cleanText(body.description || body.scene_description || body.prompt || '', 1200);
  const layout = cleanText(sceneSpec.layoutText || sceneSpec.layout_text || sceneSpec.layout || '', 800);
  const materialLight = cleanText(sceneSpec.materialLightText || sceneSpec.material_light_text || sceneSpec.material || sceneSpec.light || '', 800);
  const interaction = cleanText(sceneSpec.interactionText || sceneSpec.interaction_text || sceneSpec.interaction || sceneSpec.camera || '', 600);
  const style = cleanText(ctx.controlled_production?.style_control?.notes || '', 420);
  const negative = cleanText(sceneSpec.negativeText || sceneSpec.negative_text || ctx.controlled_production?.negative_control?.text || body.negative || '', 800);
  const repairFeedback = cleanText(body.repair_feedback || body.repairFeedback || '', 1200);
  const materialReferences = sceneMaterialReferenceImages(ctx, body);
  const surfaceTopology = shotDesign.resolveSurfaceTopology(
    sceneSpec.surfaceTopology || sceneSpec.surface_topology,
    [layout, materialLight, negative, sceneSpec.surfaceTopology?.notes, sceneSpec.surface_topology?.notes],
  );
  const surfaceTopologyPrompt = surfaceTopology ? shotDesign.surfacePrompt(surfaceTopology, 'environment') : '';
  const materialIdentityContract = [
    'Authority order for the primary surface is: explicit topology and seam policy first, attached material appearance evidence second, observable task material cues third, and generic construction priors last.',
    'Material identity and surface topology are independent constraints.',
    'Every material or finish explicitly named by the current task must remain visibly identifiable through its own observable physical cues, such as directionality, reflectance, roughness, grain, pores, weave, translucency, micro-relief, edge behaviour, patina or scale, but only when those cues are supported by the request.',
    'Never replace a requested material with a visually adjacent generic finish merely to satisfy continuity, minimalism or style.',
    'A continuous or hidden-seam surface means visually uninterrupted composition; it does not authorize changing the requested material family or erasing all evidence of its physical identity.',
    'When the task mentions a product portfolio or several finishes, do not turn one hero surface into bands, swatches, sample zones or a catalogue wall merely to display every option. Unless the task explicitly maps finishes to visible regions, render one coherent dominant finish and express only compatible secondary cues as subtle boundary-free variation.',
    surfaceTopology?.mode === 'continuous'
      ? 'For this continuous primary surface, synthesize compatible appearance terms into one finish language. Never visualize product-form words, multiple adjectives or commercial naming as separate boards, panels, bands or vertical material zones.'
      : '',
    materialReferences.length
      ? 'The attached task reference image is appearance evidence for material colour, grain, reflectance and micro-relief only. It must not replace scene geometry or be copied as a sample board.'
      : 'No authoritative material sample image is attached. Translate proprietary or trade finish names only through the observable physical cues explicitly written in the task; do not invent segmentation to make an unfamiliar name visible.',
    repairFeedback
      ? 'The correction feedback has higher authority than appearance inherited from previous images. Preserve valid geometry, but replace any rejected appearance instead of imitating it.'
      : '',
  ].filter(Boolean).join(' ');
  const noHumanNegative = [
    'Absolutely empty scene only.',
    'No people, no human figure, no actor, no model, no presenter, no customer, no staff.',
    'No back view, no side profile, no face, no head, no hair, no body, no arms, no hands, no legs, no silhouette, no reflection of a person.',
    'Do not use human scale figures or mannequins as spatial references; use furniture, product plinths, counters, empty walking space or neutral props instead.',
  ].join(' ');
  const photographicRealism = [
    'Visual medium lock: this must be a real on-location photograph of the task-appropriate physical environment, whether enclosed, semi-open or outdoor, captured with a full-frame camera; it must not resemble an architectural visualization, material catalogue render, CGI concept image or virtual showroom.',
    'Use plausible lens behaviour, slight optical imperfection, natural exposure roll-off, restrained sensor detail and coherent constructed geometry. Avoid sterile perfection and perfectly mirrored staging.',
    surfaceTopology?.mode === 'continuous' || surfaceTopology?.seam_policy === 'hidden'
      ? 'Use real-world material scale while preserving one optically uninterrupted primary plane: show subtle scratches, dust and uneven reflections as continuous micro-variation, but show no joint, gap, groove, recess or full-span tonal boundary on that surface.'
      : 'Use real-world material scale: visible panel seams, joints, bevels, contact shadows, subtle scratches, fingerprints, dust, uneven reflections and construction details where appropriate.',
    'Lighting must be believable: real fixture placement, soft falloff, mixed practical/ambient light, grounded shadows, no impossible glow, no floating highlights, no overly dramatic bloom.',
    outputRole === 'layout'
      ? 'Use a high camera position inside the same built location. Preserve the final materials, furniture, openings and lighting from the master photograph while making the whole-space footprint readable.'
      : 'Composition should feel like a still from a real commercial shoot: natural framing, usable negative space, practical foreground/background depth, not a perfect symmetric AI-generated set.',
  ].join('\n');
  const antiAiNegative = [
    'Strict anti-AI / anti-render negatives:',
    'No CGI render look, no Unreal/Octane/3D render look, no plastic texture, no waxy surface, no over-smoothed material, no fantasy environment.',
    'No generic luxury template, no repeated procedural texture, no melted details, no impossible reflections, no glowing seams, no excessive contrast, no heavy HDR, no fake bokeh.',
    'No decorative text, no poster layout, no floating objects, no warped geometry, no inconsistent physical material cues across one authored finish.',
  ].join(' ');
  const outputInstruction = outputRole === 'layout'
    ? [
      'Create one PHOTOGRAPHIC HIGH-OBLIQUE WHOLE-SPACE OVERVIEW derived from the supplied master photograph of the same real built location.',
      'Use a 55 to 80 degree downward camera from a plausible elevated position and reveal the floor boundary, adjoining wall planes, openings, fixed structures, anchor furniture, circulation route and interaction zone.',
      'Preserve the master photograph’s final material identity, colour palette, lighting logic, furniture design and construction details. This is an alternate real camera view, not a neutral diagram, clay render, dollhouse render or floor-plan illustration.',
      'Prioritize readable topology and relative positions without redesigning the room. An eye-level elevation, frontal wall crop or unrelated overhead room is invalid.',
    ]
    : outputRole === 'contract'
      ? ['Use the following task-specific scene contract as the content authority for the requested spatial asset.']
    : [
      'Create one photorealistic MASTER REFERENCE VIEW for a reusable commercial video scene.',
      'Use a wide eye-level or slightly elevated three-quarter establishing composition derived from the locked spatial blueprint, clearly showing the usable ground/base, task-appropriate boundaries or edges, access points and anchor relations without looking top-down.',
      ];
  return [
    ...outputInstruction,
    'This is an EMPTY SCENE asset, not a storyboard keyframe and not a collage. It must contain exactly one continuous camera view, no multi-panel composition, no split screen, no labels, no people or human-like subjects.',
    photographicRealism,
    outputRole === 'layout'
      ? 'Show the entire spatial footprint in one overhead or axonometric survey; do not use an eye-level or frontal commercial-camera composition.'
      : 'Use a wide establishing composition that clearly defines the whole spatial layout and the relative position of fixed structures and movable anchors.',
    subject ? `Advertised subject: ${subject}` : '',
    custom ? `User scene requirement: ${custom}` : '',
    layout ? `Scene layout requirement: ${layout}` : '',
    materialLight ? `Scene material and lighting requirement: ${materialLight}` : '',
    interaction ? `Scene interaction and camera position requirement: ${interaction}` : '',
    surfaceTopologyPrompt ? `Task-specific surface construction contract:\n${surfaceTopologyPrompt}` : '',
    `Task-specific material identity contract:\n${materialIdentityContract}`,
    style ? `Visual style direction: ${style}` : '',
    `Hard negative requirements: ${noHumanNegative}`,
    antiAiNegative,
    negative ? `Additional negative requirements: ${negative}` : '',
    repairFeedback ? `Mandatory correction from the previous rejected attempt: ${repairFeedback}. Create a fresh role-correct image and do not reproduce the rejected composition.` : '',
    outputRole === 'layout'
      ? 'Final look target: a believable high-angle photograph of the same finished real location, with readable whole-space topology and no dollhouse/CGI appearance.'
      : 'Final look target: real camera photography, authentic commercial location, natural commercial lighting, realistic materials, coherent spatial geometry and consistent perspective.',
  ].filter(Boolean).join('\n\n');
}

function buildLayoutAcquisitionPrompt({ ctx = {}, body = {} } = {}) {
  const requested = sceneRequest(ctx, body);
  const topology = requested.surface_topology
    ? shotDesign.surfacePrompt(requested.surface_topology, 'environment')
    : '';
  return [
    'Create one REAL HIGH-OBLIQUE WHOLE-SPACE PHOTOGRAPHIC ACQUISITION VIEW of the exact task-appropriate physical location in the supplied master photograph, whether enclosed, semi-open or outdoor.',
    'Camera contract: relocate the camera to a genuinely elevated position with a 65 to 80 degree downward pitch. Do not preserve the master crop, eye-level height, frontal wall angle, azimuth or foreground/background arrangement.',
    'Framing pass criteria: the usable ground/base footprint must occupy most of the frame; the perimeter or scene-appropriate edges, access points, fixed structures, anchor objects, circulation route and empty action zone must be readable together. For enclosed locations, the ceiling must not be a prominent visible plane. A frontal elevation, mild high-angle commercial shot, close crop or master reframe is invalid. This is not a neutral diagram, clay render, dollhouse, miniature or plan illustration.',
    'The master reference controls scene identity, material appearance, colours, object design and lighting logic only. It is not the target camera composition. Preserve relative positions without redesigning the location.',
    'Material identity and surface topology are independent constraints: preserve both without turning materials into sample bands, panels or unrelated region boundaries.',
    requested.layout ? `Spatial topology to reveal: ${requested.layout}` : '',
    requested.material_light ? `Appearance identity to preserve from the master: ${requested.material_light}` : '',
    requested.interaction ? 'Reserve and visibly locate the task-required empty action/interaction zone and its access route. Do not import any camera height, lens, tracking, close-up, wall-facing or cinematic movement instruction from the commercial shot description.' : '',
    topology ? `Surface construction identity to preserve: ${topology}` : '',
    requested.negative ? `Task prohibitions that remain applicable to visible content: ${requested.negative}` : '',
    'Output one unoccupied real-location photograph with plausible wide-angle perspective and physically coherent site geometry. No person, text, labels, logo, collage, split screen, neutral diagram, plan illustration, miniature/dollhouse, cutaway, CGI or visualization look.',
  ].filter(Boolean).join('\n\n').slice(0, 3600);
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
    layout: 'Generate a PHOTOGRAPHIC HIGH-OBLIQUE WHOLE-SPACE OVERVIEW of the exact physical location shown in the master reference. Move the camera to a plausible elevated position with a 65 to 80 degree downward pitch. Reveal the usable ground/base footprint, perimeter or scene-appropriate edges, access points, fixed structures, anchors, circulation route and empty action zone while preserving the exact same location. This must look like a real photograph from a high camera position, not a plan, neutral render, miniature/dollhouse, cutaway or unrelated location.',
    master: 'Generate the MASTER ESTABLISHING PHOTOGRAPH from the task-specific scene contract. Use a natural eye-level or slightly elevated three-quarter wide camera, not a top-down view. Show enough usable ground/base, task-appropriate boundaries or edges, access points and anchor relations to establish scale and depth. This master is the root visual identity for every later view, so create one coherent physical location without sample staging, catalogue bands or visualization styling.',
    reverse: 'Generate a TRUE REVERSE OR SIDE VIEW of the exact same physical space, not a small reframing of the master. Move the camera to a geometrically plausible opposite or side sector with at least about 90 degrees of azimuth change from the master camera. Swap the foreground/background relationship and reveal at least one wall, opening, boundary or anchor relation that the master cannot show clearly. Do not mirror the master, reuse its near-identical composition, or keep the camera in the same frontal sector. Preserve every fixed structure, opening, anchor object, material, color, light source and relative position.',
    interaction: 'Generate a DISTINCT INTERACTION-POSITION VIEW inside the exact same physical space. Place the camera at practical human eye/chest height beside the locked interaction zone. Clearly show an empty standing/action clearance, the reachable target surface or product position, and the route into and out of that zone. This must be a usable blocking camera, not another establishing shot and not a duplicate of the master or reverse view. Preserve all blueprint coordinates and do not add any person, mannequin or human reflection.',
    detail: 'Generate a TRUE MATERIAL / CONSTRUCTION DETAIL VIEW captured inside the exact same physical space. Use a close or macro crop that makes real material scale, texture direction, surface transition, contact shadow, fixture edge or permitted assembly detail readable. It must not be another wide room view. Use only materials, finishes, seams and fixtures supported by the blueprint and master. Respect the task-specific surface topology and seam policy; do not invent visible subdivisions, joints or decorative composition.',
  }[viewKey] || 'Generate another camera view of the exact same physical location without redesigning it.';
  const fallbackOrder = options.hasMasterReference === true
    ? (options.hasLayoutReference === false ? ['master'] : ['master', 'layout'])
    : (options.hasLayoutReference === false ? [] : ['layout']);
  const referenceOrder = (Array.isArray(options.referenceOrder) ? options.referenceOrder : fallbackOrder)
    .filter(key => key === 'layout' || key === 'master');
  const hasLayoutReference = referenceOrder.includes('layout');
  const hasMasterReference = referenceOrder.includes('master');
  const referenceDescriptions = referenceOrder.map((key, index) => key === 'layout'
    ? `Reference image ${index + 1} is the master-derived high-oblique spatial overview.`
    : `Reference image ${index + 1} is the master establishing view.`);
  const referenceAuthority = [
    ...referenceDescriptions,
    hasLayoutReference
      ? 'The supplied high-oblique overview is the secondary authority for whole-space geometry, openings, zones and relative coordinates.'
      : '',
    hasLayoutReference
      ? 'It must describe the same finished location as the master and must never override the master with an unrelated layout, furniture set or surface design.'
      : '',
    hasMasterReference
      ? 'The supplied master view is the canonical authority for photographic appearance, material identity, color, lighting direction and object design.'
      : '',
    hasLayoutReference && hasMasterReference
      ? 'Resolve ambiguity with the master as the primary scene/appearance identity and the overview as secondary spatial-coordinate evidence; never redesign either source.'
      : '',
  ].filter(Boolean).join(' ');
  return [
    instruction,
    referenceAuthority,
    viewKey === 'layout'
      ? 'This is a strict camera-relocation acquisition task. The master reference controls appearance and identity only: do not reproduce its crop, wall-facing sector, eye-level elevation, ceiling-heavy framing or foreground/background arrangement.'
      : viewKey === 'reverse' || viewKey === 'interaction'
      ? 'This is a deliberate camera relocation task. Preserve scene identity, but do not reproduce the master image pixel composition, crop, camera sector or foreground/background arrangement.'
      : '',
    'Output one continuous photorealistic image only, no collage, no split screen, no labels, no logo and no people.',
    'Scene identity lock is strict: preserve spatial geometry, anchor relations, material family and lighting direction.',
    cleanText(options.repairFeedback || '', 1200)
      ? `Mandatory correction from the previous rejected attempt: ${cleanText(options.repairFeedback, 1200)}. Do not repeat the rejected composition.`
      : '',
    cleanText(options.repairFeedback || '', 1200)
      ? 'Correction priority: if any reference image conflicts with the textual requirement, preserve only its valid geometry and replace the rejected appearance.'
      : '',
    scenePrompt,
  ].filter(Boolean).join('\n\n');
}

function buildSceneAuditSafePrompt({ ctx = {}, body = {}, viewKey = 'master' } = {}) {
  if (viewKey === 'layout') {
    return buildLayoutAcquisitionPrompt({ ctx, body }).slice(0, 2200);
  }
  const requested = sceneRequest(ctx, body);
  const roleInstruction = {
    layout: 'Create a real high-oblique whole-space photograph derived from the supplied master photograph. Use a 55-80 degree downward camera and reveal the floor boundary, adjoining wall planes, openings, fixed anchors, circulation and interaction zone while preserving the same finished location.',
    master: 'Create the root master establishing photograph from the current task scene contract. Use an eye-level or slightly elevated three-quarter wide camera and define one coherent physical location.',
    reverse: 'Create a true reverse or side camera view of the supplied scene. Relocate the camera by about 90 degrees, exchange foreground and background, and reveal a boundary or opening hidden in the master view while preserving the same space.',
    interaction: 'Create a distinct practical interaction-position camera view inside the supplied scene. Clearly reveal the empty action clearance, reachable target surface and circulation route while preserving the same space.',
    detail: 'Create a close material and construction photograph inside the supplied scene. Make the task-required finish, its supported physical cues, surface transition, fixture edge and realistic material scale clearly readable.',
  }[viewKey] || 'Create a coherent photorealistic real-location reference.';
  const topology = requested.surface_topology
    ? shotDesign.surfacePrompt(requested.surface_topology, 'environment')
    : '';
  const appearanceRule = viewKey === 'layout'
    ? 'This overview must preserve the master photograph’s final material identity, colours, lighting and furniture. It is not a neutral diagram, clay render, dollhouse or floor-plan illustration.'
    : 'The named material identity must be visibly proven by task-supported physical cues. Surface continuity must never substitute or genericize the requested material family.';
  const materialEvidenceRule = requested.material_reference_available
    ? 'Use the attached task material reference only for colour, grain, reflectance and micro-relief; never copy its sample boundaries into the scene.'
    : 'No material sample is attached. Convert trade or proprietary names only into explicitly requested observable cues, without inventing panels, bands or region boundaries.';
  return [
    roleInstruction,
    'Output one real on-location photograph with natural perspective, plausible lens behaviour, physically coherent site geometry, realistic material scale and believable practical lighting; never output a visualization or CGI showroom render.',
    appearanceRule,
    materialEvidenceRule,
    requested.layout ? `Spatial design: ${requested.layout}` : '',
    requested.material_light ? `Materials and lighting: ${requested.material_light}` : '',
    requested.interaction ? `Camera and interaction zone: ${requested.interaction}` : '',
    topology ? `Surface construction: ${topology}` : '',
    requested.style ? `Visual style: ${requested.style}` : '',
    'The frame is an unoccupied architectural reference containing only the designed space and its intended fixtures. Use a single camera view without typography, logos, montage or split panels.',
  ].filter(Boolean).join('\n\n').slice(0, 2200);
}

function sceneVisionThumbnailUrl(value = '', width = 560) {
  const absolute = mediaAdapter.absolutePublicImageUrl(value);
  if (!absolute || !/\/api\/new-story-ad\/assets\//i.test(absolute)) return absolute;
  const separator = absolute.includes('?') ? '&' : '?';
  return `${absolute}${separator}w=${Math.max(240, Math.min(960, Number(width) || 560))}`;
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
    material_reference_available: sceneMaterialReferenceImages(ctx, body).length > 0,
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
  const materialReferences = sceneMaterialReferenceImages(ctx, body);
  const layoutRequired = needsLayoutView(requested, body);
  const legacyLayoutTrigger = legacyNeedsLayoutHeuristic(requested, body);
  const requiredViewKeys = layoutRequired ? SCENE_GENERATION_ORDER : SCENE_VIEW_KEYS;
  const viewAcquisition = sceneViewStrategy.resolveSceneViewStrategy({
    requested: body.view_strategy || body.viewStrategy || 'auto',
    requiredViews: requiredViewKeys,
    uploadedViewCount: Array.isArray(body.view_images) ? body.view_images.length : 0,
    videoAcquisitionEnabled: false,
  });
  const progressViewKeys = repairMode ? repairViewKeys : requiredViewKeys;
  const progressMode = repairMode ? 'repair' : 'generate';
  updateSceneGenerationProgress(taskId, {
    mode: progressMode,
    phase: 'preparing',
    viewKeys: progressViewKeys,
  });
  const revision = Math.max(1, Number(previous?.scene_revision || 0) + 1);
  const scenePrompt = buildSceneSheetPrompt({ ctx, sceneConfig, body: promptBody, outputRole: 'contract' });
  const layoutPrompt = buildLayoutAcquisitionPrompt({ ctx, body: promptBody });
  const prompt = buildDerivedViewPrompt(scenePrompt, 'master', {
    referenceOrder: [],
    repairFeedback,
  });
  const master = shouldGenerate('master')
    ? await generateTrackedSceneView(taskId, 'master', {
      taskId,
      stage: 'new_story_ad.scene_asset',
      prompt,
      filename: 'scene_asset_' + taskId + '_' + sceneId + '_r' + revision + '_master_' + Date.now(),
      aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
      resolution: body.resolution || '2K',
      imageModel: 'gpt-image-2',
      referenceImages: materialReferences,
      requireReferences: materialReferences.length > 0,
      inputFidelity: materialReferences.length > 0 ? 'low' : undefined,
      auditSafePrompt: buildSceneAuditSafePrompt({ ctx, body: promptBody, viewKey: 'master' }),
    }, { mode: progressMode, viewKeys: progressViewKeys })
    : previousViews.get('master');
  cancellation.throwIfCancelled(taskId);
  const viewImages = [normalizeSceneView({
    key: 'master',
    label: sceneViewLabel('master'),
    url: master.url || master.image_url,
    image_url: master.image_url || master.url,
    provider_used: master.provider_used,
  }, 0)];
  let layout = previousViews.get('layout');
  let layoutAcquisition = null;
  if (shouldGenerate('layout')) {
    let layoutCorrection = repairFeedback;
    for (let qualityAttempt = 1; qualityAttempt <= 2; qualityAttempt += 1) {
      layout = await generateTrackedSceneView(taskId, 'layout', {
        taskId,
        stage: 'new_story_ad.scene_asset',
        prompt: buildDerivedViewPrompt(layoutPrompt, 'layout', {
          referenceOrder: ['master'],
          repairFeedback: layoutCorrection,
        }),
        filename: 'scene_asset_' + taskId + '_' + sceneId + '_r' + revision + '_layout_q' + qualityAttempt + '_' + Date.now(),
        aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
        resolution: body.resolution || '2K',
        imageModel: 'gpt-image-2',
        referenceImages: [master.url || master.image_url],
        requireReferences: true,
        inputFidelity: 'low',
        auditSafePrompt: buildSceneAuditSafePrompt({ ctx, body: promptBody, viewKey: 'layout' }),
      }, { mode: progressMode, viewKeys: progressViewKeys });
      try {
        layoutAcquisition = await sceneSpace.validateLayoutAcquisition({
          taskId,
          masterUrl: sceneVisionThumbnailUrl(master.url || master.image_url),
          layoutUrl: sceneVisionThumbnailUrl(layout.url || layout.image_url),
          requested,
        });
      } catch (error) {
        cancellation.throwIfCancelled(taskId);
        console.warn('[new_story_ad:layout_preflight_unavailable]', {
          task_id: taskId,
          scene_id: sceneId,
          revision,
          code: error?.code || 'VISION_QA_UNAVAILABLE',
          message: String(error?.message || error || '').slice(0, 240),
        });
        layoutAcquisition = null;
        break;
      }
      if (layoutAcquisition.pass || qualityAttempt >= 2) break;
      layoutCorrection = [
        repairFeedback,
        'Automated layout-role validation rejected the previous candidate.',
        ...(layoutAcquisition.reasons || []),
        'Relocate to a substantially steeper high-oblique camera and reveal the complete usable footprint; do not imitate the rejected master-like composition.',
      ].filter(Boolean).join(' ');
    }
  }
  cancellation.throwIfCancelled(taskId);
  const layoutView = normalizeSceneView({
    key: 'layout',
    label: sceneViewLabel('layout'),
    url: layout.url || layout.image_url,
    image_url: layout.image_url || layout.url,
    provider_used: layout.provider_used,
  }, REQUIRED_SCENE_VIEW_KEYS.indexOf('layout'));
  cancellation.throwIfCancelled(taskId);
  const derivedViews = await Promise.all(SCENE_VIEW_KEYS.slice(1).map(async (key, index) => {
    if (!shouldGenerate(key)) return normalizeSceneView(previousViews.get(key), index + 1);
    const detailView = key === 'detail';
    const referenceImages = detailView
      ? [master.url || master.image_url]
      : [master.url || master.image_url, layout.url || layout.image_url];
    const generated = await generateTrackedSceneView(taskId, key, {
      taskId,
      stage: 'new_story_ad.scene_asset',
      prompt: buildDerivedViewPrompt(scenePrompt, key, {
        referenceOrder: detailView ? ['master'] : ['master', 'layout'],
        repairFeedback,
      }),
      filename: 'scene_asset_' + taskId + '_' + sceneId + '_r' + revision + '_' + key + '_' + Date.now(),
      aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
      resolution: body.resolution || '2K',
      imageModel: 'gpt-image-2',
      referenceImages,
      requireReferences: true,
      // Reverse and interaction views require a real camera relocation. Detail
      // keeps high fidelity because only crop/scale should change.
      inputFidelity: detailView ? 'high' : 'low',
      auditSafePrompt: buildSceneAuditSafePrompt({ ctx, body: promptBody, viewKey: key }),
    }, { mode: progressMode, viewKeys: progressViewKeys });
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
      url: sceneVisionThumbnailUrl(view.url || view.image_url),
      image_url: sceneVisionThumbnailUrl(view.image_url || view.url),
    })),
    requested,
    layoutRequired,
    layoutAcquisition,
  };
  updateSceneGenerationProgress(taskId, {
    mode: progressMode,
    phase: 'verification',
    viewKeys: progressViewKeys,
  });
  let sceneContract = null;
  try {
    sceneContract = await sceneSpace.analyzeSceneViews(contractOptions);
  } catch (error) {
    // Generated scene images are paid assets. Once all views exist, a verifier
    // failure must never discard them or make the next click regenerate them.
    // Cancellation/deadline still wins through the shared cancellation guard.
    cancellation.throwIfCancelled(taskId);
    console.warn('[new_story_ad:scene_vision_unavailable]', {
      task_id: taskId,
      scene_id: sceneId,
      revision,
      code: error?.code || 'VISION_QA_UNAVAILABLE',
      message: String(error?.message || error || '').slice(0, 300),
    });
    // Keep the five successfully generated views instead of discarding costly
    // assets because the verifier is unavailable or malformed. The package remains
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
    view_acquisition: { layout_appearance_role: LAYOUT_APPEARANCE_ROLE },
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
    material_reference_available: requested.material_reference_available,
    image_url: viewImages[0]?.url || '',
    view_images: viewImages.map(view => ({
      ...view,
      label: sceneViewLabel(view.key),
      provider_used: view.provider_used || providerUsed,
    })),
    view_count: viewImages.length,
    view_strategy: viewAcquisition.selected,
    view_acquisition: {
      ...viewAcquisition,
      layout_policy: 'required_for_all_new_scenes',
      layout_appearance_role: LAYOUT_APPEARANCE_ROLE,
      layout_preflight: layoutAcquisition,
      legacy_layout_trigger: legacyLayoutTrigger,
      generation_order: SCENE_GENERATION_ORDER,
      last_generated_views: repairMode ? repairViewKeys : SCENE_GENERATION_ORDER,
      repair_mode: repairMode,
      reference_graph: {
        master: [],
        layout: ['master'],
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
  const autoRepairPass = Math.max(0, Number(runOptions.autoRepairPass || 0) || 0);
  const autoRepairEligible = !repairMode
    && autoRepairPass < 1
    && sceneContract.qa_unavailable !== true
    && repairPlan.action === 'regenerate_failed_views'
    && repairPlan.view_keys.length > 0
    && repairPlan.view_keys.length <= 3;
  if (autoRepairEligible) {
    storage.saveStage(taskId, 'scene_asset', {
      status: 'running',
      output_summary: `自动验证发现 ${repairPlan.view_keys.length} 张视图需要修复，正在定向重做`,
    });
    return generateSceneAsset(taskId, {
      ...body,
      scene_id: sceneId,
    }, {
      repairViewKeys: repairPlan.view_keys,
      repairFeedback: repairPlan.reasons.join('；'),
      autoRepairPass: autoRepairPass + 1,
    });
  }
  if (sceneContract.full_space_lock !== true) {
    storage.saveStage(taskId, 'scene_asset', {
      status: sceneContract.qa_unavailable === true ? 'warning' : 'review',
      output_summary: sceneContract.qa_unavailable === true
        ? '场景参考已保存，视觉验证服务暂不可用'
        : '场景参考已保存，但需求符合度、跨视图一致性或空间覆盖度尚未全部通过',
    });
  }
  updateSceneGenerationProgress(taskId, {
    mode: progressMode,
    phase: 'complete',
    viewKeys: progressViewKeys,
    verificationState: sceneContract.verification?.state || sceneContract.status || '',
  });
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
    url: sceneVisionThumbnailUrl(view.url || view.image_url),
    image_url: sceneVisionThumbnailUrl(view.image_url || view.url),
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
      material_reference_available: asset.material_reference_available === true,
    },
    layoutRequired: asset.layout_contract?.required === true || views.some(view => view.key === 'layout'),
  };
  let contract;
  try {
    contract = await sceneSpace.analyzeSceneViews(contractOptions);
  } catch (error) {
    cancellation.throwIfCancelled(taskId);
    console.warn('[new_story_ad:scene_reverify_unavailable]', {
      task_id: taskId,
      scene_id: asset.scene_id,
      revision: asset.scene_revision || 1,
      code: error?.code || 'VISION_QA_UNAVAILABLE',
      message: String(error?.message || error || '').slice(0, 300),
    });
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
  SCENE_GENERATION_ORDER,
  SCENE_IMAGE_MAX_ATTEMPTS,
  sceneViewLabel,
  sceneMaterialReferenceImages,
  buildSceneSheetPrompt,
  buildLayoutAcquisitionPrompt,
  buildDerivedViewPrompt,
  buildSceneAuditSafePrompt,
  sceneVisionThumbnailUrl,
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
