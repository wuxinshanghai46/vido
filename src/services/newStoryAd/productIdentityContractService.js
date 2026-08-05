const crypto = require('crypto');
const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { cleanText } = require('./contextBuilder');
const productAssetResolver = require('./productAssetResolverService');
const publicReferences = require('./publicReferenceService');
const verification = require('./visualVerificationService');

const THRESHOLDS = Object.freeze({ identity: 0.82, shape: 0.8, color: 0.8, material: 0.72 });

function score(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n > 1 && n <= 100 ? n / 100 : n));
}

const {
  isProductAsset,
  normalizedAssetType,
  productAssets,
} = productAssetResolver;

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

function advertisedSubjectContract(ctx = {}) {
  return ctx.advertised_subject_contract && typeof ctx.advertised_subject_contract === 'object'
    ? ctx.advertised_subject_contract
    : (ctx.product_contract?.advertised_subject_contract && typeof ctx.product_contract.advertised_subject_contract === 'object'
      ? ctx.product_contract.advertised_subject_contract
      : {});
}

function projectAdvertisedSubjectContract(ctx = {}, reference = {}) {
  const understanding = reference.reference_understanding && typeof reference.reference_understanding === 'object'
    ? reference.reference_understanding
    : {};
  const brandRole = understanding.brand_role && typeof understanding.brand_role === 'object'
    ? understanding.brand_role
    : {};
  const facts = reference.source_facts && typeof reference.source_facts === 'object'
    ? reference.source_facts
    : {};
  const existing = advertisedSubjectContract(ctx);
  const subject = cleanText(
    brandRole.subject || facts.product_or_service || ctx.product_subject || existing.subject || '',
    240,
  );
  const proofMoments = Array.isArray(brandRole.proof_moments) ? brandRole.proof_moments : [];
  const causalEvents = Array.isArray(understanding.causal_chain) ? understanding.causal_chain : [];
  const proofRequirements = proofMoments.map((moment, index) => {
    const value = moment && typeof moment === 'object' ? moment : {};
    const eventId = cleanText(value.event_id || (typeof moment === 'string' && /^event_[\w-]+$/i.test(moment) ? moment : ''), 100);
    const event = causalEvents.find(item => cleanText(item?.id, 100) === eventId) || {};
    const requirement = cleanText(
      value.requirement || value.description || value.proof || value.claim
        || event.result || event.action || (typeof moment === 'string' ? moment : eventId),
      500,
    );
    if (!requirement) return null;
    return {
      proof_id: cleanText(value.proof_id || value.id || `reference_proof_${index + 1}`, 100),
      requirement,
      event_id: eventId,
      evidence_refs: (Array.isArray(value.evidence_refs) ? value.evidence_refs : [])
        .map(item => cleanText(item, 80)).filter(Boolean).slice(0, 48),
      source: 'reference_brand_role',
    };
  }).filter(Boolean);
  const storyFunction = cleanText(brandRole.story_function || understanding.story_summary?.brand_function || '', 700);
  if (!proofRequirements.length && storyFunction) {
    proofRequirements.push({
      proof_id: 'reference_brand_function',
      requirement: storyFunction,
      event_id: '',
      evidence_refs: (Array.isArray(brandRole.evidence_refs) ? brandRole.evidence_refs : [])
        .map(item => cleanText(item, 80)).filter(Boolean).slice(0, 48),
      source: 'reference_brand_role',
    });
  }
  const presentationMode = cleanText(
    brandRole.presentation_mode
      || brandRole.presentation?.mode
      || ctx.product_presentation?.mode
      || existing.presentation?.mode
      || 'evidence_driven',
    80,
  );
  const visualLockIsRequired = existing.asset_requirement?.visual_lock_required === true
    || ctx.controlled_production?.product_control?.enabled === true
    || Boolean(ctx.product_asset);
  return {
    schema_version: 1,
    subject,
    kind: cleanText(brandRole.kind || facts.subject_kind || existing.kind || 'advertised_subject', 80),
    presentation: {
      mode: presentationMode,
      story_function: storyFunction,
      visible_claims: (Array.isArray(brandRole.visible_claims) ? brandRole.visible_claims : [])
        .map(item => cleanText(item, 500)).filter(Boolean).slice(0, 48),
      cta: cleanText(brandRole.cta || understanding.story_summary?.cta || '', 500),
    },
    asset_requirement: {
      proof_required: proofRequirements.length > 0,
      visual_lock_required: visualLockIsRequired,
      visual_lock_status: visualLockIsRequired ? (ctx.product_asset ? 'provided' : 'pending') : 'optional',
      source_identity_reuse_allowed: false,
    },
    proof_requirements: proofRequirements,
    source: {
      type: 'reference_analysis_projection',
      analysis_id: cleanText(reference.analysis_id || reference.id || '', 120),
      contract_version: cleanText(understanding.contract_version || '', 80),
    },
  };
}

function proofRequired(ctx = {}) {
  const contract = advertisedSubjectContract(ctx);
  return contract.asset_requirement?.proof_required === true
    || (Array.isArray(contract.proof_requirements) && contract.proof_requirements.length > 0)
    || ctx.controlled_production?.product_control?.enabled === true;
}

function visualLockRequired(ctx = {}) {
  const contract = advertisedSubjectContract(ctx);
  return contract.asset_requirement?.visual_lock_required === true
    || ctx.controlled_production?.product_control?.enabled === true
    || productAssets(ctx).length > 0;
}

function buildProductContract(ctx = {}, options = {}) {
  const assets = productAssets(ctx);
  const existing = ctx.product_contract && typeof ctx.product_contract === 'object' ? ctx.product_contract : {};
  const revision = Math.max(1, Number(options.revision || ctx.revisions?.product || existing.product_revision || 1) || 1);
  const qa = normalizeQa(existing.reference_qa || {});
  const subjectContract = advertisedSubjectContract(ctx);
  const proofIsRequired = proofRequired(ctx);
  const lockIsRequired = visualLockRequired(ctx);
  const contract = {
    schema_version: 1,
    product_id: cleanText(existing.product_id || assets[0]?.id || 'advertised_subject', 120),
    product_revision: revision,
    status: !proofIsRequired && !lockIsRequired
      ? 'not_applicable'
      : (!lockIsRequired ? 'proof_required' : (existing.status === 'verified' && qa.pass ? 'verified' : 'unverified')),
    advertised_subject: cleanText(subjectContract.subject || ctx.product_subject || '', 240),
    advertised_subject_contract: subjectContract,
    proof_required: proofIsRequired,
    visual_lock_required: lockIsRequired,
    proof_requirements: (Array.isArray(subjectContract.proof_requirements) ? subjectContract.proof_requirements : []).slice(0, 48),
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
    advertised_subject_contract: contract.advertised_subject_contract,
    proof_required: contract.proof_required,
    visual_lock_required: contract.visual_lock_required,
    proof_requirements: contract.proof_requirements,
    reference_images: contract.reference_images,
    identity: contract.identity,
  })).digest('hex');
  const sameRevision = Number(existing.product_revision || revision) === revision;
  const sameFingerprint = !!existing.reference_fingerprint && existing.reference_fingerprint === contract.reference_fingerprint;
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
  if (contract.status === 'not_applicable' || (contract.proof_required && !contract.visual_lock_required)) return contract;
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
    let parsed;
    try {
      // 商品验证已经消耗一次视觉模型调用；JSON 异常只能本地修复/失败，禁止再调用文本模型造成隐性二次付费。
      parsed = await repair.parseOrRepair({
        raw: result.text,
        expected: 'object',
        modelGateway: null,
        taskId,
        stage: 'new_story_ad.json_repair',
      });
    } catch (parseError) {
      parseError.code = 'VISION_QA_SCHEMA_INVALID';
      throw parseError;
    }
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
  return visualLockRequired(ctx);
}

function shotProductPresence(ctx = {}, shot = {}, contract = {}) {
  const layers = Array.isArray(shot.visual_layers) ? shot.visual_layers : [];
  const advertisedSubject = cleanText(
    ctx.advertised_subject_contract?.subject
      || ctx.product_contract?.advertised_subject
      || ctx.product_subject
      || contract?.subject_lock?.advertised_subject
      || '',
    240,
  ).toLowerCase();
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
  const proofRequirements = advertisedSubjectContract(ctx).proof_requirements
    || ctx.product_contract?.proof_requirements
    || [];
  const declaredProofIds = [
    ...(Array.isArray(shot.product_proof_ids) ? shot.product_proof_ids : []),
    ...(Array.isArray(shot.proof_ids) ? shot.proof_ids : []),
    shot.product_proof_id,
    shot.proof_id,
  ].map(item => cleanText(item, 100)).filter(Boolean);
  const shotOrder = Math.max(0, Number(shot.order || shot.shot_index || shot.index || 0) || 0);
  const mappedProofs = proofRequirements.filter(item => {
    const proofId = cleanText(item?.proof_id, 100);
    const eventMatch = /^event_(\d+)$/u.exec(cleanText(item?.event_id, 100));
    return (proofId && declaredProofIds.includes(proofId))
      || (eventMatch && shotOrder > 0 && Number(eventMatch[1]) === shotOrder);
  });
  const required = layerEvidence || subjectMentioned || explicitProduct || mappedProofs.length > 0;
  const declaredNonProduct = /^(?:scene_only|environment|human_scene|brand_endcard)$/i.test(String(shot.subject_type || '').trim());
  return {
    required,
    mode: required ? (/手持|拿起|触摸|局部|细节|特写|\b(?:hold|touch|detail|close[- ]?up|partial)\b/i.test(text) ? 'partial' : 'full') : (declaredNonProduct ? 'not_present' : 'optional'),
    proof_ids: mappedProofs.map(item => item.proof_id).filter(Boolean),
    reasons: [layerEvidence ? 'visual_layer' : '', subjectMentioned ? 'advertised_subject' : '', explicitProduct ? 'shot_text' : '', mappedProofs.length ? 'proof_mapping' : ''].filter(Boolean),
  };
}

function shotProductRequired(ctx = {}, shot = {}, contract = {}) {
  return productRequired(ctx) && shotProductPresence(ctx, shot, contract).required;
}

function shotProductProofRequired(ctx = {}, shot = {}, contract = {}) {
  return proofRequired(ctx) && shotProductPresence(ctx, shot, contract).required;
}

function shotProductVisualLockRequired(ctx = {}, shot = {}, contract = {}) {
  return visualLockRequired(ctx) && shotProductPresence(ctx, shot, contract).required;
}

function auditProofCoverage(ctx = {}, shots = [], artifacts = []) {
  const requirements = advertisedSubjectContract(ctx).proof_requirements
    || ctx.product_contract?.proof_requirements
    || [];
  if (!proofRequired(ctx)) return { pass: true, required: 0, covered: 0, proofs: [], missing_proof_ids: [] };
  const proofRows = requirements.map((requirement, proofIndex) => {
    const mappedShots = (Array.isArray(shots) ? shots : []).map((shot, index) => ({ shot, index }))
      .filter(({ shot }) => {
        const presence = shotProductPresence(ctx, {
          ...shot,
          order: shot.order || shot.shot_index || index + 1,
        }, {});
        return presence.proof_ids?.includes(requirement.proof_id)
          || (requirements.length === 1 && presence.required);
      });
    const passedShots = mappedShots.filter(({ index }) => {
      const artifact = artifacts[index] || {};
      const qa = artifact.qa || artifact.video_qa || artifact.review || {};
      return qa.pass === true && qa.product_pass !== false;
    });
    return {
      proof_id: cleanText(requirement.proof_id || `proof_${proofIndex + 1}`, 100),
      requirement: cleanText(requirement.requirement, 500),
      mapped_shot_indexes: mappedShots.map(item => item.index + 1),
      passed_shot_indexes: passedShots.map(item => item.index + 1),
      pass: passedShots.length > 0,
    };
  });
  // A reference may only state a general story function. It still needs at least one authored
  // product-proof shot and a passing clip QA before final composition.
  if (!proofRows.length) {
    const mapped = (shots || []).map((shot, index) => ({ index, required: shotProductPresence(ctx, shot, {}).required }))
      .filter(item => item.required);
    const passed = mapped.filter(item => {
      const qa = artifacts[item.index]?.qa || artifacts[item.index]?.video_qa || {};
      return qa.pass === true && qa.product_pass !== false;
    });
    proofRows.push({ proof_id: 'advertised_subject_presence', requirement: advertisedSubjectContract(ctx).subject || ctx.product_subject || '', mapped_shot_indexes: mapped.map(item => item.index + 1), passed_shot_indexes: passed.map(item => item.index + 1), pass: passed.length > 0 });
  }
  const missing = proofRows.filter(item => !item.pass).map(item => item.proof_id);
  return { pass: missing.length === 0, required: proofRows.length, covered: proofRows.length - missing.length, proofs: proofRows, missing_proof_ids: missing };
}

function keyframePromptContract(ctx = {}, shot = {}, shotContract = {}) {
  const contract = ctx.product_contract || {};
  const proofIsRequired = shotProductProofRequired(ctx, shot, shotContract);
  const lockIsRequired = shotProductVisualLockRequired(ctx, shot, shotContract);
  const referenceText = lockIsRequired ? [
    contract.identity?.description ? `Product identity lock: ${cleanText(contract.identity.description, 360)}${contract.reference_images?.length ? `; ${contract.reference_images.length} reference images attached` : ''}` : '',
    contract.identity?.shape ? `Product shape lock: ${cleanText(contract.identity.shape, 180)}` : '',
    contract.identity?.material ? `Product material lock: ${cleanText(contract.identity.material, 180)}` : '',
    contract.identity?.dominant_colors?.length ? `Product color lock: ${cleanText(contract.identity.dominant_colors.join(', '), 140)}` : '',
    !contract.identity?.description && contract.reference_images?.length ? `Product reference images attached: ${contract.reference_images.length}` : '',
  ].filter(Boolean).join('\n') : '';
  const proofText = proofIsRequired && Array.isArray(contract.proof_requirements)
    ? contract.proof_requirements.map(item => `${item.proof_id || 'proof'}: ${item.requirement || ''}`).filter(Boolean).join('；')
    : '';
  return {
    proof_required: proofIsRequired,
    visual_lock_required: lockIsRequired,
    identity_locked: lockIsRequired && Boolean(contract.identity?.description || contract.reference_images?.length),
    reference_text: referenceText,
    proof_text: proofText,
  };
}

function assertProofCoverage(ctx = {}, shots = [], artifacts = []) {
  const coverage = auditProofCoverage(ctx, shots, artifacts);
  if (coverage.pass) return coverage;
  const error = new Error(`最终合成前广告主体证明不完整：${coverage.missing_proof_ids.join('、')}`);
  error.code = 'ADVERTISED_SUBJECT_PROOF_INCOMPLETE';
  error.status = 422;
  error.retryable = true;
  error.proof_coverage = coverage;
  throw error;
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

module.exports = {
  THRESHOLDS, normalizedAssetType, isProductAsset, productAssets, normalizeQa,
  advertisedSubjectContract, projectAdvertisedSubjectContract, proofRequired, visualLockRequired,
  buildProductContract, verifyProductContract, productRequired, shotProductPresence,
  shotProductRequired, shotProductProofRequired, shotProductVisualLockRequired, auditProofCoverage,
  keyframePromptContract, assertProofCoverage, assertVerifiedProduct,
};
