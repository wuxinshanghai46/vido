const crypto = require('crypto');
const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { cleanText } = require('./contextBuilder');
const publicReferences = require('./publicReferenceService');
const verification = require('./visualVerificationService');

const THRESHOLDS = Object.freeze({ identity: 0.82, shape: 0.8, color: 0.8, material: 0.72 });

function score(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n > 1 && n <= 100 ? n / 100 : n));
}

function normalizedAssetType(asset = {}) {
  return cleanText(asset.type || asset.asset_type || asset.kind || '', 120).toLowerCase().replace(/[\s-]+/g, '_');
}

function isProductAsset(asset = {}) {
  if (!asset || !(asset.url || asset.image_url)) return false;
  const type = normalizedAssetType(asset);
  // The asset type is authoritative. An actor/scene description can legitimately
  // mention the advertised product and must never turn that asset into a product
  // reference that requires a separate visual verification gate.
  if (/(?:^|_)(?:person|people|human|actor|character|cast|portrait|face|scene|environment|location|room|space|background)(?:_|$)/i.test(type)) return false;
  if (/(?:^|_)(?:product|goods|package|packaging|packshot|merchandise|sku|product_material|material_sample)(?:_|$)/i.test(type)) return true;
  if (/(?:商品|产品|包装|货品|样品)/.test(type)) return true;

  // Older uploads sometimes used only a generic type. In that case accept an
  // explicit reference name, but deliberately ignore free-form descriptions.
  if (!type || /^(?:reference|image|asset|upload|uploaded_image)$/.test(type)) {
    const name = cleanText(asset.name || asset.label || '', 160);
    return /(?:产品|商品|包装|货品|样品)(?:参考|素材|图片|图|照)|(?:product|goods|package|packshot)\s*(?:reference|asset|image|photo)/i.test(name);
  }
  return false;
}

function productAssets(ctx = {}) {
  return (Array.isArray(ctx.assets) ? ctx.assets : []).filter(isProductAsset);
}

function normalizeQa(input = {}) {
  const conflicts = Array.isArray(input.conflicts || input.mismatch_reasons)
    ? (input.conflicts || input.mismatch_reasons).map(value => cleanText(value, 240)).filter(Boolean)
    : [];
  const qa = {
    pass: input.pass === true,
    identity_score: score(input.identity_score || input.product_score),
    shape_score: score(input.shape_score),
    color_score: score(input.color_score),
    material_score: score(input.material_score),
    conflicts,
    checked_at: input.checked_at || new Date().toISOString(),
    used_model: cleanText(input.used_model || '', 160),
  };
  qa.pass = qa.pass
    && qa.identity_score >= THRESHOLDS.identity
    && qa.shape_score >= THRESHOLDS.shape
    && qa.color_score >= THRESHOLDS.color
    && qa.material_score >= THRESHOLDS.material
    && !qa.conflicts.length;
  return qa;
}

function buildProductContract(ctx = {}, options = {}) {
  const assets = productAssets(ctx);
  const existing = ctx.product_contract && typeof ctx.product_contract === 'object' ? ctx.product_contract : {};
  const revision = Math.max(1, Number(options.revision || ctx.revisions?.product || existing.product_revision || 1) || 1);
  const qa = normalizeQa(existing.reference_qa || {});
  const required = ctx.controlled_production?.product_control?.enabled === true || assets.length > 0;
  const contract = {
    schema_version: 1,
    product_id: cleanText(existing.product_id || assets[0]?.id || 'advertised_subject', 120),
    product_revision: revision,
    status: !required ? 'not_applicable' : (existing.status === 'verified' && qa.pass ? 'verified' : 'unverified'),
    advertised_subject: cleanText(ctx.product_subject || '', 240),
    reference_images: assets.map(asset => cleanText(asset.url || asset.image_url || '', 1000)).filter(Boolean).slice(0, 8),
    identity: {
      description: cleanText(existing.identity?.description || assets.map(asset => asset.description).filter(Boolean).join('；') || ctx.product_subject || '', 800),
      shape: cleanText(existing.identity?.shape || '', 240),
      dominant_colors: Array.isArray(existing.identity?.dominant_colors) ? existing.identity.dominant_colors.slice(0, 8) : [],
      material: cleanText(existing.identity?.material || '', 240),
      logo_region: cleanText(existing.identity?.logo_region || '', 240),
      package_count: Number(existing.identity?.package_count || 0) || 0,
    },
    lock_strength: cleanText(ctx.controlled_production?.product_control?.lock_strength || 'standard', 40),
    reference_qa: qa,
    verification: existing.verification || verification.pending(),
    updated_at: new Date().toISOString(),
  };
  contract.reference_fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    product_id: contract.product_id,
    product_revision: contract.product_revision,
    advertised_subject: contract.advertised_subject,
    reference_images: contract.reference_images,
    identity: contract.identity,
  })).digest('hex');
  const sameRevision = Number(existing.product_revision || revision) === revision;
  const sameFingerprint = !existing.reference_fingerprint || existing.reference_fingerprint === contract.reference_fingerprint;
  if (contract.status === 'verified' && sameRevision && sameFingerprint) {
    contract.verification = existing.verification || verification.verified(qa.used_model);
  } else if (contract.status === 'verified') {
    contract.status = 'unverified';
    contract.verification = verification.pending('产品参考或版本已变化，需要重新验证');
  }
  return contract;
}

async function verifyProductContract({ taskId = '', ctx = {}, gateway = modelGateway, repair = jsonRepair } = {}) {
  const contract = buildProductContract(ctx);
  if (contract.status === 'not_applicable') return contract;
  if (!contract.reference_images.length) {
    contract.status = 'unverified';
    contract.reference_qa = normalizeQa({ pass: false, conflicts: ['当前任务要求锁定产品，但没有产品参考图'] });
    contract.verification = verification.rejected(contract.reference_qa.conflicts, '产品参考图缺失');
    return contract;
  }
  const normalizedReferences = publicReferences.normalizeVisionReferences(contract.reference_images, { max: 8 });
  if (!normalizedReferences.urls.length) {
    const error = new Error('产品参考图片地址无法提供给视觉审核');
    error.code = 'VISION_REFERENCE_UNAVAILABLE';
    error.retryable = true;
    error.reference_diagnostics = normalizedReferences;
    contract.status = 'unverified';
    contract.qa_unavailable = true;
    contract.reference_qa = normalizeQa({ pass: false, conflicts: ['产品参考图片无法读取，请检查图片后重新验证'] });
    contract.verification_error_code = error.code;
    contract.verification = verification.unavailable(error);
    return contract;
  }
  try {
    const result = await gateway.generateVision({
      taskId,
      stage: 'new_story_ad.product_consistency_qa',
      imageUrls: normalizedReferences.urls,
      systemPrompt: [
        'You are a strict product identity inspector for a general-purpose commercial video platform.',
        'The product may belong to any lawful industry and may be a physical product, package, material sample, device or other visual subject. Never assume a fixed category, brand, shape or scene.',
        'Return strict JSON only and judge only from the current task references.',
      ].join('\n'),
      userPrompt: `Product contract: ${JSON.stringify(contract)}\nReturn {"pass":boolean,"identity_score":0..1,"shape_score":0..1,"color_score":0..1,"material_score":0..1,"conflicts":string[]}.`,
      maxTokens: 2200,
    });
    const parsed = await repair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
    contract.reference_qa = normalizeQa({ ...parsed, used_model: result.used_model });
    contract.status = contract.reference_qa.pass ? 'verified' : 'rejected';
    contract.qa_unavailable = false;
    contract.verification_error_code = '';
    contract.verification = contract.reference_qa.pass
      ? verification.verified(result.used_model)
      : verification.rejected(contract.reference_qa.conflicts, '产品外观、形状、颜色或材质一致性未通过');
  } catch (error) {
    if (!['VISION_QA_UNAVAILABLE', 'VISION_CIRCUIT_OPEN', 'VISION_REFERENCE_UNAVAILABLE', 'VISION_QA_SCHEMA_INVALID'].includes(error?.code)) throw error;
    contract.status = 'unverified';
    contract.qa_unavailable = true;
    contract.reference_qa = normalizeQa({ pass: false, conflicts: ['产品视觉验证暂不可用，请稍后重新验证'] });
    contract.verification_error_code = error.code;
    contract.verification = verification.unavailable(error);
  }
  contract.updated_at = new Date().toISOString();
  return contract;
}

function productRequired(ctx = {}) {
  return ctx.controlled_production?.product_control?.enabled === true || productAssets(ctx).length > 0;
}

function shotProductPresence(ctx = {}, shot = {}, contract = {}) {
  const layers = Array.isArray(shot.visual_layers) ? shot.visual_layers : [];
  const advertisedSubject = cleanText(ctx.product_subject || contract?.subject_lock?.advertised_subject || '', 240).toLowerCase();
  const layerEvidence = layers.some(layer => {
    const value = typeof layer === 'string' ? layer : [layer?.type, layer?.content, layer?.text].filter(Boolean).join(' ');
    const type = typeof layer === 'string' ? layer : String(layer?.type || '');
    const subjectInLayer = advertisedSubject.length >= 2 && value.toLowerCase().includes(advertisedSubject);
    return /product|proof|package|packshot|商品|产品|包装|主体/i.test(type) || subjectInLayer;
  });
  const text = [
    shot.subject_type, shot.shot_type, shot.title, shot.visual, shot.visual_description, shot.story_visual,
    shot.promo_visual, shot.action, shot.content_prompt, shot.keyframe_notes, shot.material_usage,
  ].filter(Boolean).join(' ');
  const subjectMentioned = advertisedSubject.length >= 2 && text.toLowerCase().includes(advertisedSubject);
  const explicitProduct = /product_only|proof_scene|packshot|商品|产品|货品|包装|样品|设备|器件|主体特写|\b(?:product|goods|package|packshot|sample|device)\b/i.test(text);
  const required = layerEvidence || subjectMentioned || explicitProduct;
  const declaredNonProduct = /^(?:scene_only|environment|human_scene|brand_endcard)$/i.test(String(shot.subject_type || '').trim());
  return {
    required,
    mode: required ? (/手持|拿起|触摸|局部|细节|特写|\b(?:hold|touch|detail|close[- ]?up|partial)\b/i.test(text) ? 'partial' : 'full') : (declaredNonProduct ? 'not_present' : 'optional'),
    reasons: [layerEvidence ? 'visual_layer' : '', subjectMentioned ? 'advertised_subject' : '', explicitProduct ? 'shot_text' : ''].filter(Boolean),
  };
}

function shotProductRequired(ctx = {}, shot = {}, contract = {}) {
  return productRequired(ctx) && shotProductPresence(ctx, shot, contract).required;
}

function assertVerifiedProduct(ctx = {}) {
  if (!productRequired(ctx)) return null;
  const contract = ctx.product_contract;
  if (contract?.status === 'verified' && normalizeQa(contract.reference_qa).pass) return contract;
  const error = new Error('产品参考尚未通过外观、形状、颜色和材质一致性验证，请先重新验证产品资产');
  error.code = 'PRODUCT_VERIFICATION_REQUIRED';
  error.status = 422;
  error.retryable = true;
  throw error;
}

module.exports = { THRESHOLDS, normalizedAssetType, isProductAsset, productAssets, normalizeQa, buildProductContract, verifyProductContract, productRequired, shotProductPresence, shotProductRequired, assertVerifiedProduct };
