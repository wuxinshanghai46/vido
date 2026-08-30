const crypto = require('crypto');
const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { cleanText } = require('./contextBuilder');
const publicReferences = require('./publicReferenceService');
const verification = require('./visualVerificationService');
const personLooks = require('./personLookProfileService');

const PERSON_VIEW_KEYS = ['front', 'side', 'back', 'action'];
const THRESHOLDS = Object.freeze({ identity: 0.82, age: 0.8, wardrobe: 0.85, body: 0.75, photographic_realism: 0.82 });

function score(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n > 1 && n <= 100 ? n / 100 : n));
}

function requiredPersonViewKeys(asset = {}, spec = {}) {
  const generationType = String(spec.generation_settings?.generation_type
    || spec.generationSettings?.generation_type
    || asset.generation_type
    || asset.generation_summary?.generation_type
    || 'four_view');
  return generationType === 'three_view' ? ['front', 'side', 'back'] : PERSON_VIEW_KEYS;
}

function personViews(asset = {}) {
  const views = Array.isArray(asset.view_images) ? asset.view_images : [];
  const normalized = views.map((view, index) => ({
    key: cleanText(view?.key || view?.view || PERSON_VIEW_KEYS[index] || `view_${index + 1}`, 40),
    url: cleanText(view?.url || view?.image_url || view?.imageUrl || '', 1000),
  })).filter(view => view.url);
  if (!normalized.length && (asset.image_url || asset.url)) {
    normalized.push({ key: 'front', url: cleanText(asset.image_url || asset.url, 1000) });
  }
  return normalized;
}

function normalizeQa(input = {}) {
  const rawReasons = Array.isArray(input.raw_mismatch_reasons || input.mismatch_reasons || input.conflicts)
    ? (input.raw_mismatch_reasons || input.mismatch_reasons || input.conflicts).map(value => cleanText(value, 240)).filter(Boolean)
    : [];
  const reasons = verification.localizeReasonsZh(rawReasons, '人物', input);
  const qa = {
    pass: input.pass === true,
    identity_score: score(input.identity_score),
    age_score: score(input.age_score),
    wardrobe_score: score(input.wardrobe_score),
    body_score: score(input.body_score),
    photographic_realism_score: input.photographic_realism_score == null
      ? 1
      : score(input.photographic_realism_score),
    mismatch_reasons: reasons,
    raw_mismatch_reasons: rawReasons,
    checked_at: input.checked_at || new Date().toISOString(),
    used_model: cleanText(input.used_model || '', 160),
  };
  qa.pass = qa.pass
    && qa.identity_score >= THRESHOLDS.identity
    && qa.age_score >= THRESHOLDS.age
    && qa.wardrobe_score >= THRESHOLDS.wardrobe
    && qa.body_score >= THRESHOLDS.body
    && qa.photographic_realism_score >= THRESHOLDS.photographic_realism
    && qa.mismatch_reasons.length === 0;
  return qa;
}

function contractFingerprint(contract = {}) {
  const payload = {
    person_id: contract.person_id,
    person_revision: contract.person_revision,
    identity: contract.identity,
    appearance: contract.appearance,
    wardrobe: contract.wardrobe,
    look_profiles: contract.look_profiles,
    reference_views: contract.reference_views,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function buildPersonContract(asset = {}, spec = {}, options = {}) {
  const views = personViews(asset);
  const requiredViewKeys = requiredPersonViewKeys(asset, spec);
  const revision = Math.max(1, Number(options.revision || asset.person_revision || asset.person_contract?.person_revision || 1) || 1);
  const existing = asset.person_contract && typeof asset.person_contract === 'object' ? asset.person_contract : {};
  const existingQa = existing.cross_view_qa || asset.cross_view_qa || {};
  const qa = normalizeQa(existingQa);
  const activeLook = Array.isArray(spec.look_profiles)
    ? (spec.look_profiles.find(look => look?.id === spec.active_look_id) || spec.look_profiles[0] || {})
    : {};
  const wardrobeContract = spec.wardrobe_contract || activeLook.wardrobe_contract || {};
  const structuredAccessories = (wardrobeContract.accessories?.items || [])
    .map(item => cleanText([item?.type, item?.position, item?.material].filter(Boolean).join(' / '), 180))
    .filter(Boolean);
  const structuredHairMakeup = wardrobeContract.hair_makeup || wardrobeContract.hairMakeup || {};
  const hairMakeupDescription = typeof structuredHairMakeup === 'string'
    ? structuredHairMakeup
    : (structuredHairMakeup.description || structuredHairMakeup.evidence || '');
  const contract = {
    schema_version: 1,
    person_id: cleanText(asset.actor_id || asset.actor_asset_id || asset.id || options.personId || 'person_asset', 120),
    person_revision: revision,
    status: 'unverified',
    identity: {
      age_range: cleanText(spec.age || spec.age_range || asset.age || '', 80),
      gender: cleanText(spec.gender || asset.gender || '', 40),
      origin: cleanText(spec.origin || asset.origin || '', 120),
      face_description: cleanText(spec.appearanceText || spec.appearance || spec.face_description || '', 600),
      body_type: cleanText(spec.bodyType || spec.body_type || '', 120),
      height_impression: cleanText(spec.height || spec.height_impression || '', 120),
    },
    appearance: {
      face_shape: cleanText(spec.faceShape || spec.face_shape || '', 120),
      hair_style: cleanText(spec.hairMakeupText || spec.hairMakeup || spec.hair_style || '', 240),
      hair_color: cleanText(spec.hairColor || spec.hair_color || '', 80),
      skin_tone: cleanText(spec.skinTone || spec.skin_tone || '', 80),
      makeup: cleanText(spec.makeup || structuredHairMakeup.makeup || hairMakeupDescription || '', 240),
      hair_accessories: Array.isArray(structuredHairMakeup.hair_accessories)
        ? structuredHairMakeup.hair_accessories.map(value => cleanText(value, 120)).filter(Boolean).slice(0, 12)
        : [],
    },
    wardrobe: {
      description: cleanText(spec.wardrobeText || spec.wardrobe || spec.outfit || asset.outfit || '', 600),
      top: cleanText(spec.top || '', 160),
      bottom: cleanText(spec.bottom || '', 160),
      shoes: cleanText(spec.shoes || wardrobeContract.footwear?.type || '', 160),
      accessories: (Array.isArray(spec.accessories) && spec.accessories.length
        ? spec.accessories.map(value => cleanText(value, 100)).filter(Boolean)
        : structuredAccessories).slice(0, 12),
      dominant_colors: (Array.isArray(spec.dominant_colors) && spec.dominant_colors.length
        ? spec.dominant_colors.map(value => cleanText(value, 60)).filter(Boolean)
        : (wardrobeContract.palette?.colors || []).map(value => cleanText(value, 60)).filter(Boolean)).slice(0, 8),
    },
    look_profiles: personLooks.normalizeLookProfiles(spec, { ensure: true }),
    generation_type: requiredViewKeys.length === 3 ? 'three_view' : String(spec.generation_settings?.generation_type || asset.generation_type || 'four_view'),
    required_view_keys: requiredViewKeys,
    reference_views: Object.fromEntries(requiredViewKeys.map(key => [key, views.find(view => view.key === key)?.url || ''])),
    cross_view_qa: qa,
    verification: existing.verification || verification.pending(),
    updated_at: new Date().toISOString(),
  };
  contract.reference_fingerprint = contractFingerprint(contract);
  const sameRevision = Number(existing.person_revision || revision) === revision;
  const sameFingerprint = !existing.reference_fingerprint || existing.reference_fingerprint === contract.reference_fingerprint;
  const verified = existing.status === 'verified' && qa.pass && sameRevision && sameFingerprint;
  contract.status = verified ? 'verified' : cleanText(options.status || 'unverified', 40);
  if (verified) contract.verification = existing.verification || verification.verified(qa.used_model);
  return contract;
}

async function verifyPersonAsset({ taskId = '', asset = {}, spec = {}, revision = 1, force = false, gateway = modelGateway, repair = jsonRepair, qaAttempts = 1 } = {}) {
  const contract = buildPersonContract(asset, spec, { revision });
  const views = personViews(asset);
  const requiredViewKeys = requiredPersonViewKeys(asset, spec);
  if (!force && contract.status === 'verified' && contract.cross_view_qa.pass) return contract;
  if (views.length < requiredViewKeys.length || requiredViewKeys.some(key => !views.some(view => view.key === key))) {
    contract.status = 'unverified';
    contract.cross_view_qa = normalizeQa({
      pass: false,
      mismatch_reasons: [`人物参考必须包含 ${requiredViewKeys.join('、')} ${requiredViewKeys.length} 个独立视图`],
    });
    contract.verification = verification.rejected(contract.cross_view_qa.mismatch_reasons, '人物参考视图不完整');
    return contract;
  }
  const orderedViews = requiredViewKeys.map(key => views.find(view => view.key === key)).filter(Boolean);
  const normalizedReferences = publicReferences.normalizeVisionReferences(orderedViews.map(view => view.url), { max: requiredViewKeys.length });
  if (normalizedReferences.urls.length !== requiredViewKeys.length) {
    const error = new Error('人物参考图片地址无法提供给视觉审核');
    error.code = 'VISION_REFERENCE_UNAVAILABLE';
    error.retryable = true;
    error.reference_diagnostics = normalizedReferences;
    contract.status = 'unverified';
    contract.qa_unavailable = true;
    contract.cross_view_qa = normalizeQa({ pass: false, mismatch_reasons: ['人物参考图片无法读取，请检查图片后重新验证'] });
    contract.verification_error_code = error.code;
    contract.verification = verification.unavailable(error);
    return contract;
  }
  const maxAttempts = Math.max(1, Math.min(3, Number(qaAttempts) || 2));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await gateway.generateVision({
      taskId,
      stage: 'new_story_ad.person_consistency_qa',
      imageUrls: normalizedReferences.urls,
      maxCandidates: 3,
      systemPrompt: [
        'You are a strict cross-view identity inspector for a general-purpose commercial video platform.',
        'The images may depict any lawful person, age group, ethnicity, wardrobe, occupation or visual style requested by the current task. Never assume a fixed country, industry, name or character template.',
        'All mismatch_reasons shown to users must be concise, natural Simplified Chinese. Keep JSON keys and numeric fields unchanged.',
        'Compare whether all views show the same intended person and the same locked wardrobe/body attributes. Also reject beauty-filter, plastic/waxy skin, illustration/CGI facial rendering, age-inappropriate styling, flat shadowless faces and implausible light direction. Return strict JSON only.',
      ].join('\n'),
      userPrompt: `Person contract: ${JSON.stringify(contract)}\nReturn {"pass":boolean,"identity_score":0..1,"age_score":0..1,"wardrobe_score":0..1,"body_score":0..1,"photographic_realism_score":0..1,"mismatch_reasons":string[]}. Reject extra people, inconsistent identity/age/hair/skin/wardrobe/body, missing or inconsistent mandatory footwear/accessories/hair accessories/makeup where the corresponding view should visibly show them, beauty-filter or plastic/waxy skin, illustration/CGI facial rendering, flat or physically inconsistent face lighting, watermarks, collage borders or malformed anatomy.`,
      maxTokens: 2200,
    });
      const parsed = await repair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
      contract.cross_view_qa = normalizeQa({ ...parsed, used_model: result.used_model });
      contract.status = contract.cross_view_qa.pass ? 'verified' : 'rejected';
      contract.qa_unavailable = false;
      contract.verification_error_code = '';
      contract.verification_attempts = attempt;
      contract.verification = contract.cross_view_qa.pass
        ? verification.verified(result.used_model)
        : verification.rejected(contract.cross_view_qa.mismatch_reasons, '人物身份、年龄、服装或体态一致性未通过');
      break;
    } catch (error) {
      if (!['VISION_QA_UNAVAILABLE', 'VISION_CIRCUIT_OPEN', 'VISION_REFERENCE_UNAVAILABLE', 'VISION_QA_SCHEMA_INVALID'].includes(error?.code)) throw error;
      if (attempt < maxAttempts) continue;
      contract.status = 'unverified';
      contract.qa_unavailable = true;
      contract.cross_view_qa = normalizeQa({ pass: false, mismatch_reasons: ['人物视觉验证暂不可用，请稍后重新验证'] });
      contract.verification_error_code = error.code;
      contract.verification_attempts = attempt;
      contract.verification = verification.unavailable(error);
    }
  }
  contract.updated_at = new Date().toISOString();
  return contract;
}

function personRequired(ctx = {}) {
  const mode = String(ctx.cast_mode || ctx.person_asset?.cast_mode || '').toLowerCase();
  if (['no_human', 'animal'].includes(mode)) return false;
  return !!(
    ctx.person_asset
    || ctx.person_contract
    || ['single', 'dual', 'multi', 'group', 'human_pet'].includes(mode)
    || (Array.isArray(ctx.characters) && ctx.characters.length)
    || (Array.isArray(ctx.cast_profiles) && ctx.cast_profiles.length)
  );
}

function shotPersonPresence(shot = {}, contract = {}) {
  const shotCharacters = Array.isArray(shot.characters) ? shot.characters.filter(Boolean) : [];
  const lockedCharacters = Array.isArray(contract?.cast_lock?.shot_characters)
    ? contract.cast_lock.shot_characters.filter(Boolean)
    : [];
  const visualLayers = Array.isArray(shot.visual_layers)
    ? shot.visual_layers.map(layer => typeof layer === 'string' ? layer : (layer?.content || layer?.text || ''))
    : [];
  const rawText = [
    shot.subject_type,
    shot.shot_type,
    shot.visual,
    shot.visual_description,
    shot.story_visual,
    shot.promo_visual,
    shot.action,
    shot.visual_action,
    shot.content_prompt,
    shot.keyframe_notes,
    shot.material_usage,
    shot.title,
    ...visualLayers,
  ].filter(Boolean).join(' ');
  // Negative constraints such as “禁止出现人物” describe what must not be
  // visible. They must never be interpreted as positive person evidence.
  const text = rawText.split(/[。；;\n]/u).filter(clause => !(
    /(?:禁止|不得|不要|不出现|不可出现|无人|无人物|no\s+person|without\s+(?:a\s+)?person)/iu.test(clause)
    && /人物|真人|演员|主角|模特|顾客|人手|人脸|person|human|actor|model|hand|face/iu.test(clause)
  )).join(' ');
  const handVisible = /手部|手指|指尖|手掌|手腕|手臂|\b(?:hand|finger|fingertip|palm|wrist|arm)\b/i.test(text);
  const wardrobeVisible = /袖口|衣袖|服装|衣服|外套|连衣裙|衬衫|裤装|鞋|配饰|\b(?:sleeve|wardrobe|outfit|dress|shirt|jacket|trouser|shoe|accessor)\w*\b/i.test(text);
  const facePartial = /侧脸|半张脸|\b(?:side\s+profile|partial\s+face)\b/i.test(text);
  const reflection = /人物倒影|人物反射|\b(?:human\s+reflection|person\s+reflection)\b/i.test(text);
  const obscured = /背影|人形剪影|\b(?:silhouette|back\s+view)\b/i.test(text);
  const full = /人物|真人|演员|主角|主持人|模特|顾客|客户|老师|顾问|工程师|开发者|人脸|全身|半身|眼神|发型|妆容|服装|连衣裙|衬衫|人物身份|human_scene|\b(?:person|actor|presenter|model|customer|teacher|consultant|engineer|developer|face|full[- ]body|half[- ]body|wardrobe|hairstyle)\b/i.test(text);
  const faceVisible = facePartial || /人脸|正脸|面部|\b(?:face|facial)\b/i.test(text);
  const bodyVisible = /全身|半身|人物站|人物坐|人物行走|演员站|演员坐|模特站|模特走|\b(?:full[- ]body|half[- ]body|standing person|seated person|walking person)\b/i.test(text);
  const fullBodyVisible = faceVisible || bodyVisible;
  const castDeclared = shotCharacters.length > 0 || lockedCharacters.length > 0;
  const explicitPersonPartial = /身体局部|局部身体|手部特写|手指特写|指尖特写|袖口特写|人物特写|人像特写|脸部特写|\b(?:hand[- ]only|partial\s+(?:body|figure)|person\s+close[- ]?up|portrait\s+close[- ]?up)\b/i.test(text);
  const genericTightFraming = /微距|特写|macro|extreme_close_up|close[-_ ]?up/i.test(text);
  // A generic macro/close-up describes framing, not its subject. It becomes
  // a partial-person requirement only when the shot independently declares a
  // person or a visible body/wardrobe dimension.
  const partialPersonFraming = explicitPersonPartial
    || (genericTightFraming && (castDeclared || handVisible || wardrobeVisible || faceVisible || bodyVisible || reflection || obscured || full));
  const partial = partialPersonFraming || handVisible || wardrobeVisible;
  const noPerson = shot.no_person === true || shot.noHuman === true
    || /^(?:product_only|scene_only|brand_endcard|object_only|no_human|environment)$/i.test(String(shot.subject_type || '').trim());
  if (shotCharacters.length || lockedCharacters.length || partial || facePartial || reflection || obscured || full) {
    return {
      required: true,
      mode: facePartial ? 'face_partial' : (reflection && !faceVisible ? 'reflection' : (obscured && !faceVisible ? 'obscured' : ((partialPersonFraming || (!castDeclared && partial)) && !fullBodyVisible ? 'partial' : 'person'))),
      visible_parts: [handVisible ? 'hand' : '', wardrobeVisible ? 'wardrobe' : '', faceVisible ? 'face' : '', bodyVisible ? 'body' : '', reflection ? 'reflection' : '', obscured ? 'obscured' : ''].filter(Boolean),
      reasons: [
        shotCharacters.length || lockedCharacters.length ? 'cast' : '',
        partial ? 'partial_body' : '',
        reflection ? 'reflection_person' : '',
        obscured ? 'obscured_person' : '',
        full ? 'person_visual' : '',
      ].filter(Boolean),
    };
  }
  return { required: !noPerson && !Object.prototype.hasOwnProperty.call(shot, 'characters'), mode: noPerson ? 'none' : 'unspecified', reasons: [] };
}

function shotPersonRequired(ctx = {}, shot = {}, contract = {}) {
  if (!personRequired(ctx)) return false;
  return shotPersonPresence(shot, contract).required;
}

function shotForbidsPerson(ctx = {}, shot = {}) {
  const castMode = String(ctx.cast_mode || ctx.person_asset?.cast_mode || '').toLowerCase();
  const subjectType = String(shot.subject_type || '').trim();
  const declaredNonHuman = /^(?:product_only|scene_only|brand_endcard|object_only|no_human|environment)$/i.test(subjectType);
  return ['no_human', 'animal'].includes(castMode) || shot.no_person === true || shot.noHuman === true
    || /^(?:no_human)$/i.test(subjectType)
    || (declaredNonHuman && !shotPersonPresence(shot, {}).required);
}

function assertVerifiedPerson(ctx = {}) {
  if (!personRequired(ctx)) return null;
  const contract = ctx.person_contract || ctx.person_asset?.person_contract;
  if (!ctx.person_asset && !contract) {
    const error = new Error('当前任务要求人物出镜，但还没有已确认的人物资产，请先选择或创建人物并完成一致性验证');
    error.code = 'PERSON_ASSET_REQUIRED';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  if (contract?.contract_type === 'cast_bundle') {
    const members = Array.isArray(contract.member_contracts) ? contract.member_contracts : [];
    const expected = Math.max(1, Number(contract.expected_people || ctx.expected_people || members.length) || 1);
    const verified = members.length === expected && members.every(member => (
      member?.status === 'verified' && normalizeQa(member.cross_view_qa).pass
    ));
    if (contract.status === 'verified' && contract.cross_view_qa?.pass === true
      && contract.cross_view_qa?.member_count_pass === true && verified) return contract;
  } else if (contract?.status === 'verified' && normalizeQa(contract.cross_view_qa).pass) return contract;
  const error = new Error('人物参考尚未通过身份、年龄、服装和体态一致性验证，请先重新验证人物资产');
  error.code = 'PERSON_VERIFICATION_REQUIRED';
  error.status = 422;
  error.retryable = true;
  throw error;
}

module.exports = { PERSON_VIEW_KEYS, THRESHOLDS, requiredPersonViewKeys, personViews, normalizeQa, contractFingerprint, buildPersonContract, verifyPersonAsset, personRequired, shotPersonPresence, shotPersonRequired, shotForbidsPerson, assertVerifiedPerson };
