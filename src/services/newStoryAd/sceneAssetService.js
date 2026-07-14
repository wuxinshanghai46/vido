const { v4: uuidv4 } = require('uuid');
const storage = require('./storageService');
const mediaAdapter = require('./mediaAdapter');
const { cleanText } = require('./contextBuilder');
const sceneSpace = require('./sceneSpaceContractService');
const cancellation = require('./cancellationContext');
const sceneViewStrategy = require('./sceneViewStrategyService');

const SCENE_VIEW_KEYS = ['master', 'reverse', 'interaction', 'detail'];

function sceneViewLabel(key = '') {
  return {
    master: '主视角',
    reverse: '反向/侧向',
    interaction: '互动位',
    detail: '材质细节',
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
    provider_used: cleanText(asset.provider_used || '', 240),
    prompt: cleanText(asset.prompt || '', 6000),
    created_at: asset.created_at || new Date().toISOString(),
  };
}

function normalizeSceneAssets(input = []) {
  const raw = Array.isArray(input) ? input : [];
  return raw.map(normalizeSceneAsset).filter(Boolean);
}

function buildSceneSheetPrompt({ ctx = {}, sceneConfig = {}, body = {} } = {}) {
  const brief = cleanText(ctx.brief || body.brief || '', 1600);
  const subject = cleanText(ctx.product_subject || sceneConfig.advertised_subject || body.product_subject || '', 240);
  const sceneSpec = body.scene_spec || body.sceneSpec || ctx.scene_spec || {};
  const custom = cleanText(body.description || body.scene_description || body.prompt || '', 1200);
  const layout = cleanText(sceneSpec.layoutText || sceneSpec.layout_text || sceneSpec.layout || '', 800);
  const materialLight = cleanText(sceneSpec.materialLightText || sceneSpec.material_light_text || sceneSpec.material || sceneSpec.light || '', 800);
  const interaction = cleanText(sceneSpec.interactionText || sceneSpec.interaction_text || sceneSpec.interaction || sceneSpec.camera || '', 600);
  const style = cleanText(ctx.controlled_production?.style_control?.notes || '', 600);
  const negative = cleanText(sceneSpec.negativeText || sceneSpec.negative_text || ctx.controlled_production?.negative_control?.text || body.negative || '', 800);
  const noHumanNegative = [
    'Absolutely empty scene only.',
    'No people, no human figure, no actor, no model, no presenter, no customer, no staff.',
    'No back view, no side profile, no face, no head, no hair, no body, no arms, no hands, no legs, no silhouette, no reflection of a person.',
    'Do not use human scale figures or mannequins as spatial references; use furniture, product plinths, counters, empty walking space or neutral props instead.',
  ].join(' ');
  const photographicRealism = [
    'Photographic realism requirements:',
    'Make it look like a real location or production set photographed by a commercial environment photographer, not an AI concept render.',
    'Use physically plausible camera perspective, lens compression and scene geometry; keep fixed structures, ground planes, fixtures, props and products aligned to one coherent spatial system.',
    'Use real-world material scale: visible panel seams, joints, bevels, contact shadows, subtle scratches, fingerprints, dust, uneven reflections and construction details where appropriate.',
    'Lighting must be believable: real fixture placement, soft falloff, mixed practical/ambient light, grounded shadows, no impossible glow, no floating highlights, no overly dramatic bloom.',
    'Composition should feel like a still from a real commercial shoot: natural framing, usable negative space, practical foreground/background depth, not a perfect symmetric AI-generated set.',
  ].join('\n');
  const antiAiNegative = [
    'Strict anti-AI / anti-render negatives:',
    'No CGI render look, no Unreal/Octane/3D render look, no plastic texture, no waxy surface, no over-smoothed material, no fantasy environment.',
    'No generic luxury template, no repeated procedural texture, no melted details, no impossible reflections, no glowing seams, no excessive contrast, no heavy HDR, no fake bokeh.',
    'No decorative text, no poster layout, no floating objects, no warped geometry, no inconsistent material direction between panels.',
  ].join(' ');
  return [
    'Create one photorealistic MASTER REFERENCE VIEW for a reusable commercial video scene.',
    'This is an EMPTY SCENE asset, not a storyboard keyframe and not a collage. It must contain exactly one continuous camera view, no panels, no split screen, no labels, no people or human-like subjects.',
    photographicRealism,
    'Use a wide establishing composition that clearly defines the whole spatial layout and the relative position of fixed structures and movable anchors.',
    brief ? `Campaign brief: ${brief}` : '',
    subject ? `Advertised subject: ${subject}` : '',
    custom ? `User scene requirement: ${custom}` : '',
    layout ? `Scene layout requirement: ${layout}` : '',
    materialLight ? `Scene material and lighting requirement: ${materialLight}` : '',
    interaction ? `Scene interaction and camera position requirement: ${interaction}` : '',
    sceneConfig.business_boundary ? `Business boundary: ${cleanText(sceneConfig.business_boundary, 500)}` : '',
    sceneConfig.story_strategy ? `Scene/story strategy: ${cleanText(JSON.stringify(sceneConfig.story_strategy), 900)}` : '',
    style ? `Visual style direction: ${style}` : '',
    `Hard negative requirements: ${noHumanNegative}`,
    antiAiNegative,
    negative ? `Additional negative requirements: ${negative}` : '',
    'Final look target: real camera photography, authentic commercial location, natural commercial lighting, realistic materials, coherent spatial geometry and consistent perspective.',
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

function buildDerivedViewPrompt(masterPrompt = '', viewKey = '') {
  const instruction = {
    reverse: 'Generate a reverse or side camera view of the exact same physical space. Preserve every fixed structure, opening, anchor object, material, color, light source and relative position. Reveal a geometrically plausible opposite/side relation; do not redesign the room.',
    interaction: 'Generate an interaction-position camera view inside the exact same physical space. Preserve fixed structures and anchor positions. Choose a practical empty standing/display/action zone for later adding the current task subject, but do not add any person or replace the environment.',
    detail: 'Generate a close material and construction-detail view taken inside the exact same physical space. Use only materials, seams, fixtures and colors visibly supported by the master reference. Do not invent a new wall system or decorative composition.',
  }[viewKey] || 'Generate another camera view of the exact same physical space without redesigning it.';
  return [
    instruction,
    'The supplied image is the canonical master scene reference and has highest priority.',
    'Output one continuous photorealistic image only, no collage, no split screen, no labels, no logo and no people.',
    'Scene identity lock is strict: preserve spatial geometry, anchor relations, material family and lighting direction.',
    masterPrompt,
  ].filter(Boolean).join('\n\n');
}

function sceneRequest(ctx = {}, body = {}) {
  const spec = body.scene_spec || body.sceneSpec || ctx.scene_spec || {};
  return {
    layout: cleanText(spec.layoutText || spec.layout_text || spec.layout || body.layout_summary || '', 1000),
    material_light: cleanText(spec.materialLightText || spec.material_light_text || spec.material || spec.light || body.material_summary || '', 1000),
    interaction: cleanText(spec.interactionText || spec.interaction_text || spec.interaction || spec.camera || '', 800),
  };
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

function saveSceneAssetsToTask(taskId, sceneAssets = []) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const normalized = normalizeSceneAssets(sceneAssets);
  storage.saveOutput(taskId, 'scene_assets', normalized);
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const nextCtx = { ...ctx, scene_assets: normalized };
  storage.saveOutput(taskId, 'context', nextCtx);
  storage.updateTask(taskId, { request: nextCtx, updated_at: new Date().toISOString() });
  storage.saveStage(taskId, 'scene_asset', {
    status: 'done',
    output_summary: `${normalized.length} scene asset packages`,
  });
  return normalized;
}

async function generateSceneAsset(taskId, body = {}) {
  cancellation.throwIfCancelled(taskId);
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneConfig = storage.getOutput(taskId, 'scene_config') || {};
  const existing = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  const sceneId = cleanText(body.scene_id || body.sceneId || `scene_${Date.now()}_${uuidv4().slice(0, 6)}`, 120);
  const previous = normalizeSceneAssets(existing).find(item => String(item.scene_id) === String(sceneId));
  const viewAcquisition = sceneViewStrategy.resolveSceneViewStrategy({
    requested: body.view_strategy || body.viewStrategy || 'auto',
    requiredViews: SCENE_VIEW_KEYS,
    uploadedViewCount: Array.isArray(body.view_images) ? body.view_images.length : 0,
    videoAcquisitionEnabled: false,
  });
  const revision = Math.max(1, Number(previous?.scene_revision || 0) + 1);
  const prompt = buildSceneSheetPrompt({ ctx, sceneConfig, body });
  const master = await mediaAdapter.generateImage({
    taskId,
    stage: 'new_story_ad.scene_asset',
    prompt,
    filename: 'scene_asset_' + taskId + '_' + sceneId + '_r' + revision + '_master_' + Date.now(),
    aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
    resolution: body.resolution || '2K',
    imageModel: body.image_model || body.imageModel || 'auto',
  });
  cancellation.throwIfCancelled(taskId);
  const viewImages = [normalizeSceneView({
    key: 'master',
    label: sceneViewLabel('master'),
    url: master.url || master.image_url,
    image_url: master.image_url || master.url,
    provider_used: master.provider_used,
  }, 0)];
  for (const key of SCENE_VIEW_KEYS.slice(1)) {
    cancellation.throwIfCancelled(taskId);
    const generated = await mediaAdapter.generateImage({
      taskId,
      stage: 'new_story_ad.scene_asset',
      prompt: buildDerivedViewPrompt(prompt, key),
      filename: 'scene_asset_' + taskId + '_' + sceneId + '_r' + revision + '_' + key + '_' + Date.now(),
      aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
      resolution: body.resolution || '2K',
      imageModel: body.image_model || body.imageModel || 'auto',
      referenceImages: [master.url || master.image_url],
      requireReferences: true,
      inputFidelity: 'high',
    });
    cancellation.throwIfCancelled(taskId);
    viewImages.push(normalizeSceneView({
      key,
      label: sceneViewLabel(key),
      url: generated.url || generated.image_url,
      image_url: generated.image_url || generated.url,
      provider_used: generated.provider_used,
    }, viewImages.length));
  }
  const requested = sceneRequest(ctx, body);
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
  };
  let sceneContract = null;
  try {
    sceneContract = await sceneSpace.analyzeSceneViews(contractOptions);
  } catch (error) {
    if (!['VISION_QA_UNAVAILABLE', 'VISION_CIRCUIT_OPEN', 'VISION_REFERENCE_UNAVAILABLE', 'VISION_QA_SCHEMA_INVALID'].includes(error?.code)) throw error;
    // Keep the four successfully generated views instead of discarding costly
    // assets because an optional verifier is unavailable. The package remains
    // explicitly unverified and can be rechecked later; it is never mislabeled
    // as having passed commercial visual QA.
    sceneContract = sceneSpace.buildUnverifiedContract(contractOptions, error);
  }
  if (sceneContract.qa_unavailable !== true && !sceneContract.cross_view_qa?.pass) {
    const error = new Error('场景多视图空间一致性未通过：' + (sceneContract.cross_view_qa?.mismatch_reasons || []).join('；'));
    error.code = 'SCENE_CROSS_VIEW_MISMATCH';
    error.retryable = true;
    error.partial = { scene_id: sceneId, scene_revision: revision, scene_contract: sceneContract };
    throw error;
  }
  const localizedViews = await localizeSceneViews(viewImages, { taskId, sceneId, revision });
  sceneContract = relinkContractViews(sceneContract, localizedViews);
  viewImages.splice(0, viewImages.length, ...localizedViews);
  const providerUsed = [...new Set(viewImages.map(v => v.provider_used).filter(Boolean))].join(', ') || master.provider_used || '';
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
    image_url: viewImages[0]?.url || '',
    view_images: viewImages.map(view => ({
      ...view,
      label: sceneViewLabel(view.key),
      provider_used: providerUsed,
    })),
    view_count: viewImages.length,
    view_strategy: viewAcquisition.selected,
    view_acquisition: viewAcquisition,
    provider_used: providerUsed,
    prompt,
    scene_contract: sceneContract,
    cross_view_qa: sceneContract.cross_view_qa,
    verification: sceneContract.verification,
  });
  const sceneAssets = mergeSceneAssets(existing, asset);
  saveSceneAssetsToTask(taskId, sceneAssets);
  return {
    scene_asset: asset,
    scene_assets: sceneAssets,
    provider_used: providerUsed,
  };
}

async function reverifySceneAsset(taskId, sceneId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
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
    },
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
    verification: contract.verification,
  };
  saveSceneAssetsToTask(taskId, assets);
  return { scene_asset: assets[index], scene_assets: assets };
}

module.exports = {
  SCENE_VIEW_KEYS,
  sceneViewLabel,
  normalizeSceneAssets,
  localizeSceneViews,
  localizeSceneAssets,
  saveSceneAssetsToTask,
  generateSceneAsset,
  reverifySceneAsset,
};
