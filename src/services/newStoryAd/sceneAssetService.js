const { v4: uuidv4 } = require('uuid');
const storage = require('./storageService');
const mediaAdapter = require('./mediaAdapter');
const { cleanText } = require('./contextBuilder');

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
    filename: cleanText(view.filename || '', 160),
    provider_used: cleanText(view.provider_used || '', 160),
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
    style_summary: cleanText(asset.style_summary || asset.styleSummary || '', 800),
    negative: cleanText(asset.negative || asset.negative_prompt || '', 800),
    image_url: primary,
    url: primary,
    view_images: viewImages,
    view_count: Number(asset.view_count || viewImages.length || (primary ? 1 : 0)) || 0,
    created_at: asset.created_at || new Date().toISOString(),
  };
}

function normalizeSceneAssets(input = []) {
  const raw = Array.isArray(input) ? input : [];
  return raw.map(normalizeSceneAsset).filter(Boolean);
}

function compactField(value = '', max = 360) {
  const text = cleanText(value, Math.max(max * 2, max + 80)).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${Array.from(text).slice(0, Math.max(0, max - 1)).join('')}…`;
}

function buildSceneSheetPrompt({ ctx = {}, sceneConfig = {}, body = {} } = {}) {
  const brief = compactField(ctx.brief || body.brief || '', 220);
  const subject = compactField(ctx.product_subject || sceneConfig.advertised_subject || body.product_subject || '', 160);
  const sceneSpec = body.scene_spec || body.sceneSpec || ctx.scene_spec || {};
  const custom = compactField(body.description || body.scene_description || body.prompt || '', 180);
  const layout = compactField(sceneSpec.layoutText || sceneSpec.layout_text || sceneSpec.layout || '', 340);
  const materialLight = compactField(sceneSpec.materialLightText || sceneSpec.material_light_text || sceneSpec.material || sceneSpec.light || '', 340);
  const interaction = compactField(sceneSpec.interactionText || sceneSpec.interaction_text || sceneSpec.interaction || sceneSpec.camera || '', 180);
  const style = compactField(ctx.controlled_production?.style_control?.notes || '', 160);
  const negative = compactField(sceneSpec.negativeText || sceneSpec.negative_text || ctx.controlled_production?.negative_control?.text || body.negative || '', 260);
  const business = compactField(sceneConfig.business_boundary || '', 120);
  const strategy = compactField(sceneConfig.story_strategy ? JSON.stringify(sceneConfig.story_strategy) : '', 120);
  return [
    'Generate ONE 2x2 photorealistic EMPTY commercial scene reference sheet; reusable scene lock asset, not a storyboard keyframe.',
    'Highest priority scene identity: premium stainless-steel material showroom / aesthetic exhibition space; same space in all panels.',
    brief ? `Campaign brief: ${brief}` : '',
    subject ? `Advertised subject: ${subject}` : '',
    custom ? `User scene requirement: ${custom}` : '',
    layout ? `Spatial lock: ${layout}` : '',
    materialLight ? `Material and lighting lock: ${materialLight}` : '',
    interaction ? `Future actor/camera path only, keep the scene empty: ${interaction}` : '',
    business ? `Business boundary: ${business}` : '',
    strategy ? `Scene strategy: ${strategy}` : '',
    style ? `Visual style: ${style}` : '',
    'Panel contract: top-left master wide view; top-right reverse/side view same layout; bottom-left empty interaction/camera position; bottom-right close material detail. Preserve walls, floor, display zones, stainless-steel textures, palette and lighting across panels.',
    'Hard negatives: no people, human figure, actor, model, silhouette, mannequin, body parts, or reflection of a person. No text labels, logo, watermark or readable signage.',
    'Do not replace with generic luxury interior, classical room, marble palace, wood showroom, plaster columns, sculptures, hotel lobby, home living room or unrelated exhibition hall.',
    negative ? `Additional negatives: ${negative}` : '',
    'Real camera photography, coherent perspective, premium modern minimalist aesthetics, refined metal texture, commercial production quality.',
  ].filter(Boolean).join('\n\n');
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
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneConfig = storage.getOutput(taskId, 'scene_config') || {};
  const existing = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  const sceneId = cleanText(body.scene_id || body.sceneId || `scene_${Date.now()}_${uuidv4().slice(0, 6)}`, 120);
  const prompt = buildSceneSheetPrompt({ ctx, sceneConfig, body });
  const sheet = await mediaAdapter.generateImage({
    stage: 'new_story_ad.scene_asset',
    prompt,
    filename: `scene_asset_${taskId}_${sceneId}_sheet_${Date.now()}`,
    aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
    resolution: body.resolution || '2K',
    imageModel: body.image_model || body.imageModel || 'auto',
  });
  const viewImages = await mediaAdapter.splitReferenceSheet({
    source: sheet,
    filenamePrefix: `scene_asset_${taskId}_${sceneId}`,
    viewKeys: SCENE_VIEW_KEYS,
    outputWidth: 1024,
    outputHeight: 576,
    fit: 'cover',
  });
  const providerUsed = [...new Set(viewImages.map(v => v.provider_used).filter(Boolean))].join(', ') || sheet.provider_used || '';
  const asset = normalizeSceneAsset({
    id: sceneId,
    scene_id: sceneId,
    name: body.name || sceneConfig.advertised_subject || '新剧情广告任务场景',
    source: 'new_story_ad_scene_sheet',
    lock_strength: body.lock_strength || body.lockStrength || 'standard',
    layout_summary: body.layout_summary || body.layoutSummary || (body.scene_spec || body.sceneSpec || ctx.scene_spec || {}).layoutText || sceneConfig.business_boundary || ctx.brief || '',
    material_summary: body.material_summary || body.materialSummary || (body.scene_spec || body.sceneSpec || ctx.scene_spec || {}).materialLightText || '',
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
    provider_used: providerUsed,
    prompt,
  });
  const sceneAssets = mergeSceneAssets(existing, asset);
  saveSceneAssetsToTask(taskId, sceneAssets);
  return {
    scene_asset: asset,
    scene_assets: sceneAssets,
    provider_used: providerUsed,
  };
}

module.exports = {
  SCENE_VIEW_KEYS,
  sceneViewLabel,
  normalizeSceneAssets,
  saveSceneAssetsToTask,
  generateSceneAsset,
  _buildSceneSheetPrompt: buildSceneSheetPrompt,
};
