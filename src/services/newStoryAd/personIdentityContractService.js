const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { cleanText } = require('./contextBuilder');

const PERSON_VIEW_KEYS = ['front', 'side', 'back', 'action'];
const THRESHOLDS = Object.freeze({ identity: 0.82, age: 0.8, wardrobe: 0.85, body: 0.75 });

function score(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n > 1 && n <= 100 ? n / 100 : n));
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
  const reasons = Array.isArray(input.mismatch_reasons || input.conflicts)
    ? (input.mismatch_reasons || input.conflicts).map(value => cleanText(value, 240)).filter(Boolean)
    : [];
  const qa = {
    pass: input.pass === true,
    identity_score: score(input.identity_score),
    age_score: score(input.age_score),
    wardrobe_score: score(input.wardrobe_score),
    body_score: score(input.body_score),
    mismatch_reasons: reasons,
    checked_at: input.checked_at || new Date().toISOString(),
    used_model: cleanText(input.used_model || '', 160),
  };
  qa.pass = qa.pass
    && qa.identity_score >= THRESHOLDS.identity
    && qa.age_score >= THRESHOLDS.age
    && qa.wardrobe_score >= THRESHOLDS.wardrobe
    && qa.body_score >= THRESHOLDS.body
    && qa.mismatch_reasons.length === 0;
  return qa;
}

function buildPersonContract(asset = {}, spec = {}, options = {}) {
  const views = personViews(asset);
  const revision = Math.max(1, Number(options.revision || asset.person_revision || asset.person_contract?.person_revision || 1) || 1);
  const existingQa = asset.person_contract?.cross_view_qa || asset.cross_view_qa || {};
  const qa = normalizeQa(existingQa);
  const verified = asset.person_contract?.status === 'verified' && qa.pass;
  return {
    schema_version: 1,
    person_id: cleanText(asset.actor_id || asset.actor_asset_id || asset.id || options.personId || 'person_asset', 120),
    person_revision: revision,
    status: verified ? 'verified' : cleanText(asset.person_contract?.status || options.status || 'unverified', 40),
    identity: {
      age_range: cleanText(spec.age || spec.age_range || asset.age || '', 80),
      gender: cleanText(spec.gender || asset.gender || '', 40),
      origin: cleanText(spec.origin || asset.origin || '', 120),
      face_description: cleanText(spec.appearance || spec.face_description || asset.description || '', 600),
      body_type: cleanText(spec.bodyType || spec.body_type || '', 120),
      height_impression: cleanText(spec.height || spec.height_impression || '', 120),
    },
    appearance: {
      face_shape: cleanText(spec.faceShape || spec.face_shape || '', 120),
      hair_style: cleanText(spec.hairMakeup || spec.hair_style || '', 240),
      hair_color: cleanText(spec.hairColor || spec.hair_color || '', 80),
      skin_tone: cleanText(spec.skinTone || spec.skin_tone || '', 80),
      makeup: cleanText(spec.makeup || '', 160),
    },
    wardrobe: {
      description: cleanText(spec.wardrobe || spec.outfit || asset.outfit || '', 600),
      top: cleanText(spec.top || '', 160),
      bottom: cleanText(spec.bottom || '', 160),
      shoes: cleanText(spec.shoes || '', 160),
      accessories: Array.isArray(spec.accessories) ? spec.accessories.map(value => cleanText(value, 100)).filter(Boolean).slice(0, 12) : [],
      dominant_colors: Array.isArray(spec.dominant_colors) ? spec.dominant_colors.map(value => cleanText(value, 60)).filter(Boolean).slice(0, 8) : [],
    },
    reference_views: Object.fromEntries(PERSON_VIEW_KEYS.map(key => [key, views.find(view => view.key === key)?.url || ''])),
    cross_view_qa: qa,
    updated_at: new Date().toISOString(),
  };
}

async function verifyPersonAsset({ taskId = '', asset = {}, spec = {}, revision = 1, gateway = modelGateway, repair = jsonRepair } = {}) {
  const contract = buildPersonContract(asset, spec, { revision });
  const views = personViews(asset);
  if (views.length < 4 || PERSON_VIEW_KEYS.some(key => !views.some(view => view.key === key))) {
    contract.status = 'unverified';
    contract.cross_view_qa = normalizeQa({
      pass: false,
      mismatch_reasons: ['人物参考必须包含 front、side、back、action 四个独立视图'],
    });
    return contract;
  }
  try {
    const result = await gateway.generateVision({
      taskId,
      stage: 'new_story_ad.person_consistency_qa',
      imageUrls: views.map(view => view.url),
      systemPrompt: [
        'You are a strict cross-view identity inspector for a general-purpose commercial video platform.',
        'The images may depict any lawful person, age group, ethnicity, wardrobe, occupation or visual style requested by the current task. Never assume a fixed country, industry, name or character template.',
        'Compare whether all views show the same intended person and the same locked wardrobe/body attributes. Return strict JSON only.',
      ].join('\n'),
      userPrompt: `Person contract: ${JSON.stringify(contract)}\nReturn {"pass":boolean,"identity_score":0..1,"age_score":0..1,"wardrobe_score":0..1,"body_score":0..1,"mismatch_reasons":string[]}. Reject extra people, inconsistent identity/age/hair/skin/wardrobe/body, watermarks, collage borders or malformed anatomy.`,
      maxTokens: 2200,
    });
    const parsed = await repair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
    contract.cross_view_qa = normalizeQa({ ...parsed, used_model: result.used_model });
    contract.status = contract.cross_view_qa.pass ? 'verified' : 'rejected';
  } catch (error) {
    if (!['VISION_QA_UNAVAILABLE', 'VISION_CIRCUIT_OPEN', 'VISION_REFERENCE_UNAVAILABLE', 'VISION_QA_SCHEMA_INVALID'].includes(error?.code)) throw error;
    contract.status = 'unverified';
    contract.qa_unavailable = true;
    contract.cross_view_qa = normalizeQa({ pass: false, mismatch_reasons: ['人物视觉验证暂不可用，请稍后重新验证'] });
    contract.verification_error_code = error.code;
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
    || ['single', 'dual', 'multi', 'group'].includes(mode)
    || (Array.isArray(ctx.characters) && ctx.characters.length)
    || (Array.isArray(ctx.cast_profiles) && ctx.cast_profiles.length)
  );
}

function shotPersonRequired(ctx = {}, shot = {}, contract = {}) {
  if (!personRequired(ctx)) return false;
  if (shot.no_person === true || shot.noHuman === true) return false;
  if (Object.prototype.hasOwnProperty.call(shot, 'characters') && Array.isArray(shot.characters)) {
    return shot.characters.filter(Boolean).length > 0;
  }
  const lockedCharacters = contract?.cast_lock?.shot_characters;
  if (Array.isArray(lockedCharacters)) return lockedCharacters.filter(Boolean).length > 0;
  if (Array.isArray(shot.dialogue_lines) && shot.dialogue_lines.length > 0) return true;
  const text = [shot.visual, shot.visual_description, shot.action, shot.content_prompt, shot.title].filter(Boolean).join(' ');
  if (/(?:人物|真人|演员|主角|主持人|模特|顾客|客户|用户|老师|顾问|工程师|开发者|手部|人脸|全身|半身|person|actor|presenter|customer|developer|engineer|face|hand)/i.test(text)) return true;
  return true;
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
  if (contract?.status === 'verified' && normalizeQa(contract.cross_view_qa).pass) return contract;
  const error = new Error('人物参考尚未通过身份、年龄、服装和体态一致性验证，请先重新验证人物资产');
  error.code = 'PERSON_VERIFICATION_REQUIRED';
  error.status = 422;
  error.retryable = true;
  throw error;
}

module.exports = { PERSON_VIEW_KEYS, THRESHOLDS, personViews, normalizeQa, buildPersonContract, verifyPersonAsset, personRequired, shotPersonRequired, assertVerifiedPerson };
