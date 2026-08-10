'use strict';

const { cleanText } = require('./contextBuilder');
const shotDesign = require('./shotDesignService');
const visualRealismPolicy = require('./visualRealismPolicyService');
const sceneStructuredContract = require('./sceneStructuredContractService');
const knowledgeRuntime = require('./knowledgePolicyRuntimeService');
const worldSetting = require('./worldSettingContractService');

let runtime = {};
function bind(deps = {}) { runtime = deps; }
function sceneMaterialReferenceImages(...args) { return runtime.sceneMaterialReferenceImages(...args); }
function sceneRequest(...args) { return runtime.sceneRequest(...args); }
function normalizeSceneView(...args) { return runtime.normalizeSceneView(...args); }
function normalizeSceneAssets(...args) { return runtime.normalizeSceneAssets(...args); }
function normalizeSceneAsset(...args) { return runtime.normalizeSceneAsset(...args); }
const mediaAdapter = new Proxy({}, { get: (_target, key) => {
  const value = runtime.mediaAdapter?.[key];
  return typeof value === 'function' ? value.bind(runtime.mediaAdapter) : value;
} });

function buildSceneSheetPrompt({ ctx = {}, sceneConfig = {}, body = {}, outputRole = 'master', knowledgePolicy = {} } = {}) {
  const subject = cleanText(ctx.product_subject || sceneConfig.advertised_subject || body.product_subject || '', 240);
  const sceneSpec = body.scene_spec || body.sceneSpec || ctx.scene_spec || {};
  const custom = cleanText(body.description || body.scene_description || body.prompt || '', 1200);
  const layout = cleanText(sceneSpec.layoutText || sceneSpec.layout_text || sceneSpec.layout || '', 800);
  const materialLight = cleanText(sceneSpec.materialLightText || sceneSpec.material_light_text || sceneSpec.material || sceneSpec.light || '', 800);
  const structuredScene = sceneStructuredContract.compileSpatialAsset(sceneSpec, ctx, body);
  const style = cleanText(ctx.controlled_production?.style_control?.notes || '', 420);
  const negative = cleanText(sceneSpec.negativeText || sceneSpec.negative_text || ctx.controlled_production?.negative_control?.text || body.negative || '', 800);
  const repairFeedback = cleanText(body.repair_feedback || body.repairFeedback || '', 1200);
  const materialReferences = sceneMaterialReferenceImages(ctx, body);
  const visualMedium = worldSetting.primaryVisualMedium(ctx.world_setting);
  const liveActionMedium = visualMedium === 'live_action';
  const surfaceTopology = shotDesign.reconcileSceneSurfaceTopology(
    sceneSpec.surfaceTopology || sceneSpec.surface_topology,
    [layout, materialLight, negative, sceneSpec.surfaceTopology?.notes, sceneSpec.surface_topology?.notes],
  );
  const surfaceTopologyPrompt = surfaceTopology ? shotDesign.surfacePrompt(surfaceTopology, 'environment') : '';
  const materialContract = shotDesign.normalizeMaterialContract(sceneSpec.materialContract || sceneSpec.material_contract, {
    sourceText: materialLight,
    topology: surfaceTopology,
    referenceAvailable: materialReferences.length > 0,
  });
  const materialIdentityContract = [
    `Compiled material contract: ${JSON.stringify(materialContract)}.`,
    'Keep every task-provided proprietary or trade finish name as content authority; never substitute a nearby generic material.',
    'Material identity and surface topology are independent. Prove identity through task-supported observable cues, while obeying the compiled generation_scope and seam policy.',
    'Multiple finish terms do not authorize bands, swatches or catalogue panels unless the contract explicitly uses task_mapped_regions.',
    materialReferences.length
      ? 'The attached task reference image is appearance evidence for material colour, grain, reflectance and micro-relief only. It must not replace scene geometry or be copied as a sample board.'
      : 'No authoritative material sample image is attached. Translate proprietary or trade finish names only through the observable physical cues explicitly written in the task; do not invent segmentation to make an unfamiliar name visible.',
    repairFeedback
      ? 'The correction feedback has higher authority than appearance inherited from previous images. Preserve valid geometry, but replace any rejected appearance instead of imitating it.'
      : '',
  ].filter(Boolean).join(' ');
  const occupancyContract = 'Occupancy contract: capture the task-defined location before cast or action blocking, with every circulation path and interaction zone clear. Furnish the frame only with explicitly defined fixed structures, fixtures and spatial anchors.';
  const photographicRealism = [
    worldSetting.visualMediumPrompt(visualMedium, outputRole === 'layout' ? 'near-vertical whole-space layout' : 'scene master'),
    liveActionMedium && outputRole === 'layout'
      ? 'Visual medium lock: this must be a photoreal spatial-survey image of the task-appropriate physical environment, whether enclosed, semi-open or outdoor. Materials and lighting must remain physically believable, but camera coverage has priority over commercial-photo composition.'
      : liveActionMedium ? 'Visual medium lock: this must be a real on-location photograph of the task-appropriate physical environment, whether enclosed, semi-open or outdoor, captured with a full-frame camera; it must not resemble an architectural visualization, material catalogue render, CGI concept image or virtual showroom.' : 'Render the same task-defined environment in the selected visual medium; geometry, openings, anchors, materials, palette and lighting direction must remain coherent.',
    liveActionMedium && outputRole === 'layout'
      ? 'Use near-orthographic projection with minimal perspective convergence, no visible horizon and no dominant vertical wall face. Keep geometry coherent and material scale realistic.'
      : liveActionMedium ? 'Use plausible lens behaviour, slight optical imperfection, natural exposure roll-off, restrained sensor detail and coherent constructed geometry. Avoid sterile perfection and perfectly mirrored staging.' : 'Use medium-appropriate perspective, line, shading and depth while preserving coherent constructed geometry and readable scale.',
    surfaceTopology?.mode === 'continuous' || surfaceTopology?.seam_policy === 'hidden'
      ? 'Use real-world material scale while preserving one optically uninterrupted primary plane: show subtle scratches, dust and uneven reflections as continuous micro-variation, but show no joint, gap, groove, recess or full-span tonal boundary on that surface.'
      : surfaceTopology?.primary_surface_count === 1
        ? 'Use real-world material scale on exactly one prominent task-material plane. Construction detail may exist within that plane only when task-supported, but must not create projecting returns, repeated bays, niches, columns, secondary display walls or duplicated material planes.'
      : 'Use real-world material scale: visible panel seams, joints, bevels, contact shadows, subtle scratches, fingerprints, dust, uneven reflections and construction details where appropriate.',
    'Lighting must be believable: real fixture placement, soft falloff, mixed practical/ambient light, grounded shadows, no impossible glow, no floating highlights, no overly dramatic bloom.',
    outputRole === 'layout'
      ? 'Use a near-vertical spatial-survey camera over the same location. Preserve the final materials, furniture, openings and lighting identity from the master while making the complete footprint readable. For an enclosed space, remove the ceiling and use low cutaway wall boundaries when necessary; for an open site, use a near-vertical aerial survey.'
      : 'Composition should feel like a still from a real commercial shoot: natural framing, usable negative space, practical foreground/background depth, not a perfect symmetric AI-generated set.',
    liveActionMedium ? visualRealismPolicy.sceneRealismPrompt() : '',
  ].join('\n');
  const photographicEvidenceContract = liveActionMedium
    ? 'Photographic evidence contract: use plausible optical behaviour, grounded contact shadows, physically consistent reflections, natural local variation, realistic wear and coherent constructed geometry throughout the frame.'
    : 'Rendering evidence contract: use medium-appropriate depth, contact, material response and local variation while preserving coherent constructed geometry throughout the frame.';
  const outputInstruction = outputRole === 'layout'
    ? [
      `Create one NEAR-VERTICAL TOP-DOWN WHOLE-SPACE LAYOUT in the selected ${visualMedium} medium, derived from the supplied master of the same location.`,
      'Use an 82 to 90 degree downward camera with near-orthographic perspective. Show the complete usable footprint and every scene boundary or task-defined edge in one frame, together with openings, fixed structures, anchor furniture, circulation and interaction zones.',
      'For an enclosed space, remove the ceiling and let wall tops appear only as low cutaway perimeter boundaries; do not let vertical wall faces dominate. For a semi-open or outdoor site, show the full task-defined site boundary from a near-vertical aerial camera.',
      'Preserve the master image’s final material identity, colour palette, lighting logic, furniture design and construction details. This is a spatial survey in the selected medium, not a labelled CAD plan, schematic diagram or unrelated redesigned location.',
      'Prioritize complete topology and relative positions. Any eye-level view, mild high-angle commercial shot, frontal wall crop, missing perimeter or master reframe is invalid.',
    ]
    : outputRole === 'contract'
      ? ['Use the following task-specific scene contract as the content authority for the requested spatial asset.']
    : [
      `Create one MASTER REFERENCE VIEW in the selected ${visualMedium} medium for a reusable video scene.`,
      'Use a wide eye-level or slightly elevated three-quarter establishing composition derived from the locked spatial blueprint, clearly showing the usable ground/base, task-appropriate boundaries or edges, access points and anchor relations without looking top-down.',
      ];
  const outputCardinalityInstruction = outputRole === 'contract'
    ? 'This is an unoccupied scene content contract for a spatial asset. The outer acquisition instruction controls whether the result is a single view or a multi-panel atlas. Every requested perspective must remain clean and physically coherent.'
    : 'This is an unoccupied scene asset captured as exactly one continuous, clean camera view.';
  return [
    ...outputInstruction,
    outputCardinalityInstruction,
    photographicRealism,
    outputRole === 'layout'
      ? 'Show the entire spatial footprint and all scene boundaries in one near-vertical overhead survey; do not use an eye-level, frontal or mild high-angle commercial-camera composition.'
      : outputRole === 'contract'
        ? 'Across all requested perspectives, make the complete spatial layout, fixed structures, access points and usable action zone physically legible without idealizing the place into a stock-photo set.'
      : 'Use a wide establishing composition that clearly defines the whole spatial layout and the relative position of fixed structures and movable anchors.',
    subject ? `Advertised subject: ${subject}` : '',
    custom ? `User scene requirement: ${custom}` : '',
    layout ? `Scene layout requirement: ${layout}` : '',
    materialLight ? `Scene material and lighting requirement: ${materialLight}` : '',
    structuredScene.has_evidence ? `Empty spatial-use contract (zones and routes only; never render the actors or actions that will use them later):\n${JSON.stringify(structuredScene)}` : '',
    surfaceTopologyPrompt ? `Task-specific surface construction contract:\n${surfaceTopologyPrompt}` : '',
    `Task-specific material identity contract:\n${materialIdentityContract}`,
    style ? `Visual style direction: ${style}` : '',
    knowledgeRuntime.promptBlock(knowledgePolicy),
    occupancyContract,
    photographicEvidenceContract,
    negative ? 'Task-defined scope boundary: include only the location, structures, materials, fixtures and action zones explicitly defined above; exact exclusions remain enforced by local requirement QA.' : '',
    repairFeedback ? `Mandatory correction from the previous rejected attempt: ${repairFeedback}. Create a fresh role-correct image and do not reproduce the rejected composition.` : '',
    outputRole === 'layout'
      ? `Final look target: a clean ${visualMedium} near-vertical top-down spatial survey of the same finished location, with the complete footprint and perimeter visible and free of readable typography, identifying marks or technical annotation.`
      : liveActionMedium ? 'Final look target: real camera photography, authentic commercial location, natural commercial lighting, realistic materials, coherent spatial geometry and consistent perspective.' : `Final look target: one coherent ${visualMedium} environment with stable design, palette, lighting direction, spatial geometry and perspective.`,
  ].filter(Boolean).join('\n\n');
}

function buildLayoutAcquisitionPrompt({ ctx = {}, body = {}, knowledgePolicy = {} } = {}) {
  const requested = sceneRequest(ctx, body);
  const visualMedium = worldSetting.primaryVisualMedium(ctx.world_setting);
  const topology = requested.surface_topology
    ? shotDesign.surfacePrompt(requested.surface_topology, 'environment')
    : '';
  return [
    worldSetting.visualMediumPrompt(visualMedium, 'near-vertical whole-space layout'),
    `Create one NEAR-VERTICAL TOP-DOWN WHOLE-SPACE LAYOUT in the selected ${visualMedium} medium of the exact task-appropriate location in the supplied master, whether enclosed, semi-open or outdoor.`,
    'Camera contract: relocate to an 82 to 90 degree downward camera with near-orthographic perspective. Do not preserve the master crop, eye-level height, frontal wall angle, azimuth or foreground/background arrangement.',
    'Framing pass criteria: the complete usable ground/base footprint and every scene boundary or task-defined edge must fit inside the frame; access points, fixed structures, anchor objects, circulation route and empty action zone must be readable together. For enclosed locations, remove the ceiling and show walls only as low cutaway perimeter boundaries. A visible horizon, dominant vertical wall face, frontal elevation, mild high-angle commercial shot, close crop, missing perimeter or master reframe is invalid.',
    'The master reference controls scene identity, material appearance, colours, object design and lighting logic only. It is not the target camera composition. Preserve relative positions without redesigning the location.',
    'Material identity and surface topology are independent constraints: preserve both without turning materials into sample bands, panels or unrelated region boundaries.',
    requested.layout ? `Spatial topology to reveal: ${requested.layout}` : '',
    requested.material_light ? `Appearance identity to preserve from the master: ${requested.material_light}` : '',
    requested.interaction ? 'Reserve and visibly locate the task-required empty action/interaction zone and its access route. Do not import any camera height, lens, tracking, close-up, wall-facing or cinematic movement instruction from the commercial shot description.' : '', requested.structured_scene_contract?.has_evidence ? `Map every declared empty interaction zone, circulation route and fixed prop placement into the same footprint: ${JSON.stringify(requested.structured_scene_contract)}` : '',
    topology ? `Surface construction identity to preserve: ${topology}` : '',
    knowledgeRuntime.promptBlock(knowledgePolicy),
    requested.negative ? 'Task-defined scope boundary: include only the location, structures, materials, fixtures and action zones explicitly defined above; exact exclusions remain enforced by local requirement QA.' : '',
    `Output one unoccupied ${visualMedium} spatial-survey image with coherent geometry, near-parallel vertical projection and medium-appropriate task materials. Keep the frame clean, free of readable typography, identifying marks, technical annotations and multi-panel presentation.`,
  ].filter(Boolean).join('\n\n').slice(0, 3600);
}

function legacyScenePromptFingerprintText(scenePrompt = '', layoutPrompt = '', negative = '') {
  const currentCardinality = 'This is an unoccupied scene content contract for a spatial asset. The outer acquisition instruction controls whether the result is a single view or a multi-panel atlas. Every requested perspective must remain clean and physically coherent.';
  const legacyCardinality = 'This is an EMPTY SCENE content contract for a spatial asset. The outer acquisition instruction controls whether the result is a single view or a multi-panel atlas. Every requested perspective must remain unoccupied, unlabeled and physically coherent.';
  const currentOccupancy = 'Occupancy contract: capture the task-defined location before cast or action blocking, with every circulation path and interaction zone clear. Furnish the frame only with explicitly defined fixed structures, fixtures and spatial anchors.';
  const legacyOccupancy = 'Hard negative requirements: Absolutely empty scene only. No people, no human figure, no actor, no model, no presenter, no customer, no staff. No back view, no side profile, no face, no head, no hair, no body, no arms, no hands, no legs, no silhouette, no reflection of a person. Do not use human scale figures or mannequins as spatial references; use furniture, product plinths, counters, empty walking space or neutral props instead.';
  const currentEvidence = 'Photographic evidence contract: use plausible optical behaviour, grounded contact shadows, physically consistent reflections, natural local variation, realistic wear and coherent constructed geometry throughout the frame.';
  const legacyEvidence = 'Strict anti-AI / anti-render negatives: No CGI render look, no Unreal/Octane/3D render look, no plastic texture, no waxy surface, no over-smoothed material, no fantasy environment. No generic luxury template, no repeated procedural texture, no melted details, no impossible reflections, no glowing seams, no excessive contrast, no heavy HDR, no fake bokeh. No decorative text, no poster layout, no floating objects, no warped geometry, no inconsistent physical material cues across one authored finish.';
  const currentScope = 'Task-defined scope boundary: include only the location, structures, materials, fixtures and action zones explicitly defined above; exact exclusions remain enforced by local requirement QA.';
  const currentLayoutOutput = 'Output one unoccupied photoreal spatial-survey image with physically coherent geometry, near-parallel vertical projection and realistic task materials. Keep the frame clean, free of readable typography, identifying marks, technical annotations and multi-panel presentation.';
  const legacyLayoutOutput = 'Output one unoccupied photoreal spatial-survey image with physically coherent geometry, near-parallel vertical projection and realistic task materials. No person, text, labels, watermark, logo, collage, split screen, CAD linework, dimension marks or schematic annotation.';
  const legacyNegative = cleanText(negative || '', 800);
  const legacyLayoutNegative = cleanText(negative || '', 1000);
  return {
    scenePrompt: String(scenePrompt || '')
      .replace(currentCardinality, legacyCardinality)
      .replace(currentOccupancy, legacyOccupancy)
      .replace(currentEvidence, legacyEvidence)
      .replace(
        currentScope,
        legacyNegative ? `Additional negative requirements: ${legacyNegative}` : '',
      ),
    layoutPrompt: String(layoutPrompt || '')
      .replace(
        currentScope,
        legacyLayoutNegative
          ? `Task prohibitions that remain applicable to visible content: ${legacyLayoutNegative}`
          : '',
      )
      .replace(currentLayoutOutput, legacyLayoutOutput),
  };
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
  const visualMedium = String(options.visualMedium || 'auto');
  const instruction = {
    layout: 'Generate a NEAR-VERTICAL TOP-DOWN WHOLE-SPACE LAYOUT in the selected visual medium of the exact location shown in the master reference. Move the camera to an 82 to 90 degree downward pitch with near-orthographic perspective. Fit the complete usable footprint and every perimeter or task-defined edge inside the frame, together with access points, fixed structures, anchors, circulation route and empty action zone. For an enclosed space, remove the ceiling and show walls only as low cutaway perimeter boundaries. A visible horizon, dominant vertical wall face, mild high-angle commercial view, missing boundary, master reframe or unrelated location is invalid.',
    master: 'Generate the MASTER ESTABLISHING VIEW from the task-specific scene contract in the selected visual medium. Use a natural eye-level or slightly elevated three-quarter wide camera, not a top-down view. Show enough usable ground/base, task-appropriate boundaries or edges, access points and anchor relations to establish scale and depth. This master is the root visual identity for every later view, so create one coherent location without sample staging or catalogue bands.',
    reverse: 'Generate a TRUE REVERSE OR SIDE VIEW of the exact same physical space, not a small reframing of the master. Move the camera to a geometrically plausible opposite or side sector with at least about 90 degrees of azimuth change from the master camera. Swap the foreground/background relationship and reveal at least one wall, opening, boundary or anchor relation that the master cannot show clearly. Do not mirror the master, reuse its near-identical composition, or keep the camera in the same frontal sector. Preserve every fixed structure, opening, anchor object, material, color, light source and relative position.',
    interaction: 'Generate a DISTINCT INTERACTION-POSITION VIEW inside the exact same physical space. Place the camera at practical human eye/chest height beside the locked interaction zone. Clearly show an empty standing/action clearance, the reachable target surface or product position, and the route into and out of that zone. This must be a usable blocking camera, not another establishing shot and not a duplicate of the master or reverse view. Preserve all blueprint coordinates and do not add any person, mannequin or human reflection.',
    detail: 'Generate a TRUE MATERIAL / CONSTRUCTION DETAIL VIEW captured inside the exact same physical space. Use a close or macro crop that makes real material scale, texture direction, surface transition, contact shadow, fixture edge or permitted assembly detail readable. It must not be another wide room view. Use only materials, finishes, seams and fixtures supported by the blueprint and master. Respect the task-specific surface topology and seam policy; do not invent visible subdivisions, joints or decorative composition.',
  }[viewKey] || 'Generate another camera view of the exact same physical location without redesigning it.';
  const fallbackOrder = options.hasMasterReference === true
    ? (options.hasLayoutReference === false ? ['master'] : ['master', 'layout'])
    : (options.hasLayoutReference === false ? [] : ['layout']);
  const referenceOrder = (Array.isArray(options.referenceOrder) ? options.referenceOrder : fallbackOrder)
    .filter(key => key === 'layout' || key === 'master' || key === 'atlas');
  const hasAtlasReference = referenceOrder.includes('atlas');
  const hasLayoutReference = referenceOrder.includes('layout');
  const hasMasterReference = referenceOrder.includes('master');
  const referenceDescriptions = referenceOrder.map((key, index) => key === 'layout'
    ? `Reference image ${index + 1} is the master-derived near-vertical top-down spatial layout.`
    : key === 'atlas'
      ? `Reference image ${index + 1} is the canonical 2-by-2 perspective atlas of this one physical space.`
      : `Reference image ${index + 1} is the master establishing view.`);
  const referenceAuthority = [
    ...referenceDescriptions,
    hasLayoutReference
      ? 'The supplied near-vertical layout is the secondary authority for whole-space geometry, openings, zones and relative coordinates.'
      : '',
    hasLayoutReference
      ? 'It must describe the same finished location as the master and must never override the master with an unrelated layout, furniture set or surface design.'
      : '',
    hasMasterReference
      ? 'The supplied master view is the canonical authority for visual appearance, material identity, color, lighting direction and object design.'
      : '',
    hasAtlasReference
      ? 'The supplied atlas is the canonical authority for cross-perspective geometry, fixed anchors, openings, material identity and lighting direction across the whole physical space.'
      : '',
    hasLayoutReference && hasMasterReference
      ? 'Resolve ambiguity with the master as the primary scene/appearance identity and the overview as secondary spatial-coordinate evidence; never redesign either source.'
      : '',
  ].filter(Boolean).join(' ');
  return [
    worldSetting.visualMediumPrompt(visualMedium, `${viewKey} scene view`),
    instruction,
    referenceAuthority,
    viewKey === 'layout'
      ? hasMasterReference
        ? 'This is a strict camera-relocation acquisition task. The master reference controls appearance and identity only: relocate away from its crop, wall-facing sector, eye-level elevation, ceiling-heavy framing and foreground/background arrangement.'
        : 'This is a strict camera-relocation acquisition task. The atlas controls appearance, identity and spatial relations; derive one new overhead survey rather than reproducing its panel arrangement or any source camera crop.'
      : viewKey === 'reverse' || viewKey === 'interaction'
      ? 'This is a deliberate camera relocation task. Preserve scene identity, but do not reproduce the master image pixel composition, crop, camera sector or foreground/background arrangement.'
      : '',
    `Output one continuous, unoccupied ${visualMedium} camera view with clean framing, free of readable typography, identifying marks and multi-panel presentation.`,
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

function buildSceneAuditSafePrompt({ ctx = {}, body = {}, viewKey = 'master', knowledgePolicy = {} } = {}) {
  if (viewKey === 'layout') {
    return buildLayoutAcquisitionPrompt({ ctx, body, knowledgePolicy }).slice(0, 2200);
  }
  const requested = sceneRequest(ctx, body);
  const visualMedium = worldSetting.primaryVisualMedium(ctx.world_setting);
  const liveActionMedium = visualMedium === 'live_action';
  const roleInstruction = {
    layout: 'Create a near-vertical top-down whole-space layout in the selected visual medium derived from the supplied master. Use an 82-90 degree downward camera, fit the complete footprint and all boundaries in frame, and reveal openings, fixed anchors, circulation and interaction zones while preserving the same finished location. For an enclosed space, remove the ceiling and show only low cutaway wall boundaries.',
    master: 'Create the root master establishing view in the selected visual medium from the current task scene contract. Use an eye-level or slightly elevated three-quarter wide camera and define one coherent location.',
    reverse: 'Create a true reverse or side camera view of the supplied scene. Relocate the camera by about 90 degrees, exchange foreground and background, and reveal a boundary or opening hidden in the master view while preserving the same space.',
    interaction: 'Create a distinct practical interaction-position camera view inside the supplied scene. Clearly reveal the empty action clearance, reachable target surface and circulation route while preserving the same space.',
    detail: 'Create a close material and construction view inside the supplied scene. Make the task-required finish, its supported cues, surface transition, fixture edge and material scale clearly readable.',
  }[viewKey] || 'Create a coherent scene reference in the selected visual medium.';
  const topology = requested.surface_topology
    ? shotDesign.surfacePrompt(requested.surface_topology, 'environment')
    : '';
  const appearanceRule = viewKey === 'layout'
    ? 'This overview must preserve the master image’s final material identity, colours, lighting and furniture. It is not a neutral diagram or unrelated floor-plan redesign.'
    : 'The named material identity must be visibly proven by task-supported cues. Surface continuity must never substitute or genericize the requested material family.';
  const materialEvidenceRule = requested.material_reference_available
    ? 'Use the attached task material reference only for colour, grain, reflectance and micro-relief; never copy its sample boundaries into the scene.'
    : 'No material sample is attached. Convert trade or proprietary names only into explicitly requested observable cues, without inventing panels, bands or region boundaries.';
  return [
    worldSetting.visualMediumPrompt(visualMedium, `audit-safe ${viewKey} scene view`),
    roleInstruction,
    liveActionMedium
      ? 'Output one real on-location photograph with natural perspective, plausible lens behaviour, physically coherent site geometry, realistic material scale and believable practical lighting; never output a visualization or CGI showroom render.'
      : `Output one ${visualMedium} scene view with coherent perspective, site geometry, scale, material/line treatment and lighting; never drift into another medium.`,
    appearanceRule,
    materialEvidenceRule,
    requested.layout ? `Spatial design: ${requested.layout}` : '',
    requested.material_light ? `Materials and lighting: ${requested.material_light}` : '',
    requested.structured_scene_contract?.has_evidence
      ? `Empty spatial-use contract (zones and routes only; do not render cast or performances): ${JSON.stringify(requested.structured_scene_contract)}`
      : '',
    topology ? `Surface construction: ${topology}` : '',
    requested.style ? `Visual style: ${requested.style}` : '',
    knowledgeRuntime.promptBlock(knowledgePolicy),
    'The frame is an unoccupied spatial reference containing only the designed location and its intended fixtures. Use one clean camera view free of readable typography, identifying marks and multi-panel presentation.',
  ].filter(Boolean).join('\n\n').slice(0, 2200);
}

module.exports = {
  bind,
  buildSceneSheetPrompt,
  buildLayoutAcquisitionPrompt,
  legacyScenePromptFingerprintText,
  localizeSceneViews,
  relinkContractViews,
  localizeSceneAssets,
  buildDerivedViewPrompt,
  buildSceneAuditSafePrompt,
};
