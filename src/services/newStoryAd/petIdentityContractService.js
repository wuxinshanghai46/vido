const crypto = require('crypto');
const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const publicReferences = require('./publicReferenceService');
const verification = require('./visualVerificationService');
const { cleanText } = require('./contextBuilder');

const PET_VIEW_KEYS = ['front', 'side', 'back', 'action'];

function expectedAnimalsForShot(ctx = {}, shot = {}) {
  const hasShotValue = Object.prototype.hasOwnProperty.call(shot, 'expected_animals')
    || Object.prototype.hasOwnProperty.call(shot, 'animal_count')
    || Object.prototype.hasOwnProperty.call(shot, 'pet_count');
  const explicit = Number(hasShotValue
    ? (shot.expected_animals ?? shot.animal_count ?? shot.pet_count)
    : (ctx.expected_animals || ctx.pet_contract?.expected_animals || 0));
  if (Number.isFinite(explicit) && explicit >= 0) return Math.min(8, Math.round(explicit));
  return ['animal', 'human_pet'].includes(String(ctx.cast_mode || '').toLowerCase()) ? 1 : 0;
}

function keyframePrompt(ctx = {}, shot = {}) {
  const expectedAnimals = expectedAnimalsForShot(ctx, shot);
  if (!expectedAnimals) return '';
  const contract = ctx.pet_contract || { expected_animals: expectedAnimals, profiles: ctx.pet_profiles || [] };
  return `Pet consistency lock: exactly ${expectedAnimals} animal/pet subject(s) must be visible in this shot. Preserve the declared species/breed, coat color and texture, body size, age impression, facial markings, collar/accessories and unique identifying features across every frame. Do not add, remove, replace, recolor, duplicate or merge a pet. Use the attached pet identity references. Contract: ${cleanText(JSON.stringify(contract), 1600)}`;
}

function preserveAssistedFields(output = {}, source = {}) {
  const value = (camel, snake, max) => cleanText(source[camel] || source[snake] || '', max);
  const expectedAnimals = value('expectedAnimals', 'expected_animals', 8);
  const petType = value('petType', 'pet_type', 100);
  const petDescription = value('petDescription', 'pet_description', 500);
  if (expectedAnimals) output.expectedAnimals = expectedAnimals;
  if (petType) output.petType = petType;
  if (petDescription) output.petDescription = petDescription;
  return output;
}

function assistedResponseFields(spec = {}) {
  return {
    expectedAnimals: Math.max(0, Math.min(8, Number(spec.expectedAnimals || spec.expected_animals || 0) || 0)) || '',
    petType: cleanText(spec.petType || spec.pet_type || '', 100),
    petDescription: cleanText(spec.petDescription || spec.pet_description || '', 500),
  };
}

function score(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n > 1 && n <= 100 ? n / 100 : n));
}

function petViews(asset = {}) {
  const views = Array.isArray(asset.view_images) ? asset.view_images : [];
  return views.map((view, index) => ({
    key: cleanText(view?.key || PET_VIEW_KEYS[index] || `view_${index + 1}`, 40),
    url: cleanText(view?.url || view?.image_url || '', 1000),
  })).filter(view => view.url);
}

function fingerprint(contract = {}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    pet_id: contract.pet_id,
    pet_revision: contract.pet_revision,
    identity: contract.identity,
    reference_views: contract.reference_views,
  })).digest('hex');
}

function normalizeQa(input = {}) {
  const conflicts = (Array.isArray(input.conflicts || input.mismatch_reasons)
    ? (input.conflicts || input.mismatch_reasons) : [])
    .map(value => cleanText(value, 240)).filter(Boolean);
  const qa = {
    pass: input.pass === true,
    species_score: score(input.species_score),
    identity_score: score(input.identity_score),
    coat_score: score(input.coat_score),
    body_score: score(input.body_score),
    conflicts,
    used_model: cleanText(input.used_model || '', 160),
    checked_at: new Date().toISOString(),
  };
  qa.pass = qa.pass && qa.species_score >= 0.9 && qa.identity_score >= 0.82
    && qa.coat_score >= 0.85 && qa.body_score >= 0.75 && conflicts.length === 0;
  return qa;
}

function buildPetContract(asset = {}, profile = {}, options = {}) {
  const views = petViews(asset);
  const contract = {
    schema_version: 1,
    pet_id: cleanText(asset.pet_id || asset.id || options.petId || 'pet_asset', 120),
    pet_revision: Math.max(1, Number(options.revision || asset.pet_revision || 1) || 1),
    status: 'unverified',
    identity: {
      name: cleanText(profile.name || asset.name || '', 120),
      type: cleanText(profile.type || asset.type || '', 120),
      breed: cleanText(profile.breed || asset.breed || '', 160),
      appearance: cleanText(profile.appearance || asset.description || '', 600),
    },
    reference_views: Object.fromEntries(PET_VIEW_KEYS.map(key => [key, views.find(view => view.key === key)?.url || ''])),
    cross_view_qa: normalizeQa(asset.pet_contract?.cross_view_qa || {}),
    verification: asset.pet_contract?.verification || verification.pending(),
    updated_at: new Date().toISOString(),
  };
  contract.reference_fingerprint = fingerprint(contract);
  return contract;
}

async function verifyPetAsset({
  taskId = '', asset = {}, profile = {}, revision = 1,
  gateway = modelGateway, repair = jsonRepair,
} = {}) {
  const contract = buildPetContract(asset, profile, { revision });
  const views = petViews(asset);
  if (views.length !== PET_VIEW_KEYS.length || PET_VIEW_KEYS.some(key => !views.some(view => view.key === key))) {
    contract.cross_view_qa = normalizeQa({ pass: false, conflicts: ['宠物参考必须包含正面、侧面、背面、自然动作四个独立视图'] });
    contract.verification = verification.rejected(contract.cross_view_qa.conflicts, '宠物参考视图不完整');
    return contract;
  }
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    contract.cross_view_qa = normalizeQa({
      pass: true, species_score: 0.99, identity_score: 0.96, coat_score: 0.96, body_score: 0.94,
      used_model: 'mock/new-story-ad-pet-qa',
    });
    contract.status = 'verified';
    contract.verification = verification.verified(contract.cross_view_qa.used_model);
    return contract;
  }
  const refs = publicReferences.normalizeVisionReferences(views.map(view => view.url), { max: 4 });
  if (refs.urls.length !== 4) {
    contract.qa_unavailable = true;
    contract.cross_view_qa = normalizeQa({ pass: false, conflicts: ['宠物参考图片无法读取，不能完成身份验证'] });
    contract.verification = verification.unavailable({ code: 'VISION_REFERENCE_UNAVAILABLE', message: '宠物参考图片无法读取' });
    return contract;
  }
  try {
    const result = await gateway.generateVision({
      taskId,
      stage: 'new_story_ad.pet_consistency_qa',
      imageUrls: refs.urls,
      systemPrompt: 'You are a strict cross-view animal identity inspector. Return strict JSON only.',
      userPrompt: `Pet profile: ${JSON.stringify(profile)}\nVerify all four views depict exactly the same animal: same species, breed traits, coat color/pattern, face markings, body proportions and collar/accessories. Reject extra animals, cloned animals, changed markings, malformed anatomy, collage borders and watermarks. Return {"pass":boolean,"species_score":0..1,"identity_score":0..1,"coat_score":0..1,"body_score":0..1,"conflicts":string[]}.`,
      maxTokens: 1600,
    });
    const parsed = await repair.parseOrRepair({
      raw: result.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair',
    });
    contract.cross_view_qa = normalizeQa({ ...parsed, used_model: result.used_model });
    contract.status = contract.cross_view_qa.pass ? 'verified' : 'rejected';
    contract.verification = contract.cross_view_qa.pass
      ? verification.verified(result.used_model)
      : verification.rejected(contract.cross_view_qa.conflicts, '宠物身份或外观一致性未通过');
  } catch (error) {
    contract.qa_unavailable = true;
    contract.cross_view_qa = normalizeQa({ pass: false, conflicts: ['宠物视觉验证暂不可用'] });
    contract.verification = verification.unavailable(error);
  }
  contract.updated_at = new Date().toISOString();
  return contract;
}

module.exports = {
  PET_VIEW_KEYS, expectedAnimalsForShot, keyframePrompt, preserveAssistedFields, assistedResponseFields,
  petViews, buildPetContract, verifyPetAsset, normalizeQa,
};
