const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const mediaAdapterDefault = require('./mediaAdapter');
const personIdentityDefault = require('./personIdentityContractService');
const petIdentityDefault = require('./petIdentityContractService');
const cancellationDefault = require('./cancellationContext');
const storageDefault = require('./storageService');
const { cleanText } = require('./contextBuilder');

const HUMAN_VIEW_KEYS = ['front', 'side', 'back', 'action'];
const activeBundleKinds = new Set();

function boundedCount(value, fallback, max) {
  const n = Number(value);
  return Math.max(0, Math.min(max, Math.round(Number.isFinite(n) && n > 0 ? n : fallback)));
}

function resolveCounts(spec = {}, body = {}) {
  const mode = cleanText(spec.castMode || spec.cast_mode || body.cast_mode || body.castMode || 'single', 40).toLowerCase();
  const peopleFallback = mode === 'dual' ? 2 : (['no_human', 'animal'].includes(mode) ? 0 : 1);
  const petFallback = ['animal', 'human_pet'].includes(mode) ? 1 : 0;
  return {
    mode,
    people: boundedCount(spec.expectedPeople || spec.expected_people || body.expected_people, peopleFallback, 12),
    pets: boundedCount(spec.expectedAnimals || spec.expected_animals || body.expected_animals, petFallback, 8),
  };
}

function checkpointKind(taskId, brief, spec, counts, body = {}) {
  const hash = crypto.createHash('sha256').update(JSON.stringify({
    brief,
    spec,
    counts,
    description: cleanText(body.description || '', 2000),
    cast_profiles: Array.isArray(body.cast_profiles) ? body.cast_profiles : [],
    pet_profiles: Array.isArray(body.pet_profiles) ? body.pet_profiles : [],
    image_model: cleanText(body.image_model || body.imageModel || 'auto', 120),
  })).digest('hex').slice(0, 20);
  return `subject_asset_checkpoint:${cleanText(taskId || 'detached', 80)}:${hash}`;
}

function humanMemberSpecs(spec = {}, body = {}, count = 1) {
  const supplied = Array.isArray(body.cast_profiles) ? body.cast_profiles : [];
  return Array.from({ length: count }, (_, index) => {
    const source = supplied[index] || {};
    const role = cleanText(source.roleName || source.role || source.name || (index === 0 ? spec.roleName : '') || `角色${index + 1}`, 120);
    return {
      ...spec,
      ...source,
      member_index: index + 1,
      displayName: cleanText(source.displayName || source.name || (index === 0 ? spec.displayName : '') || `人物${index + 1}`, 120),
      roleName: role,
      appearanceText: cleanText(source.appearance?.userPrompt || source.appearanceText || spec.appearanceText || '', 800),
      wardrobeText: cleanText(source.outfit || source.wardrobe?.userPrompt || source.wardrobeText || spec.wardrobeText || '', 600),
      hairMakeupText: cleanText(source.hairMakeup?.userPrompt || source.hairMakeupText || spec.hairMakeupText || '', 400),
    };
  });
}

function petMemberSpecs(spec = {}, body = {}, count = 1) {
  const supplied = Array.isArray(body.pet_profiles) ? body.pet_profiles : [];
  return Array.from({ length: count }, (_, index) => {
    const source = supplied[index] || {};
    return {
      id: cleanText(source.id || `pet_${index + 1}`, 80),
      name: cleanText(source.name || (count === 1 ? spec.petName : '') || `宠物${index + 1}`, 120),
      type: cleanText(source.type || spec.petType || '按广告需求判断', 120),
      breed: cleanText(source.breed || spec.petBreed || '', 160),
      appearance: cleanText(source.appearance || spec.petAppearance || '', 600),
      member_index: index + 1,
    };
  });
}

function humanPrompt(brief, description, member, count) {
  return [
    'Generate one production-ready photorealistic commercial actor identity sheet as an exact 2x2 grid.',
    'The same single person appears in all four cells: front full-body, side full-body, back full-body, and natural action full-body.',
    'Neutral seamless studio, even soft light, no text, no watermark, no other person, no collage border inside cells.',
    'Preserve real skin pores, fine facial texture, subtle asymmetry, natural hair strands, realistic eyes and hands. Avoid plastic skin, beauty-filter smoothing, waxy face and generic AI-model appearance.',
    count > 1 ? `This is cast member ${member.member_index} of ${count}. Create a clearly unique identity; never clone or resemble another cast member.` : '',
    `Name/role: ${member.displayName}; ${member.roleName}.`,
    member.appearanceText ? `Appearance: ${member.appearanceText}.` : '',
    member.wardrobeText ? `Locked wardrobe: ${member.wardrobeText}.` : '',
    member.hairMakeupText ? `Locked hair/makeup: ${member.hairMakeupText}.` : '',
    description || brief,
  ].filter(Boolean).join('\n');
}

function petPrompt(brief, profile, count) {
  return [
    'Generate one production-ready photorealistic animal identity sheet as an exact 2x2 grid.',
    'The same single animal appears in all four cells: front full-body, side full-body, back full-body, and natural action full-body.',
    'Neutral seamless studio, even soft light, no human, no other animal, no text, no watermark.',
    'Preserve the exact species, breed traits, coat color and pattern, face markings, eye color, body proportions, tail, ears and collar/accessories across all views.',
    count > 1 ? `This is animal ${profile.member_index} of ${count}; it must have a distinct stable identity.` : '',
    `Pet: ${profile.name}; type ${profile.type}; breed ${profile.breed || 'as required by brief'}; appearance ${profile.appearance || 'as required by brief'}.`,
    brief,
  ].filter(Boolean).join('\n');
}

function aggregatePersonContract(members, revision = 1) {
  const verified = members.length > 0 && members.every(member => member.person_contract?.status === 'verified'
    && member.person_contract?.cross_view_qa?.pass === true);
  return {
    schema_version: 2,
    contract_type: 'cast_bundle',
    person_revision: revision,
    status: verified ? 'verified' : 'rejected',
    expected_people: members.length,
    member_contracts: members.map(member => member.person_contract),
    reference_views: members[0]?.person_contract?.reference_views || {},
    cross_view_qa: {
      pass: verified,
      member_count_pass: members.length > 0,
      verified_members: members.filter(member => member.person_contract?.status === 'verified').length,
      expected_members: members.length,
      mismatch_reasons: verified ? [] : ['并非所有人物资产都通过了各自的跨视图身份验证'],
    },
    updated_at: new Date().toISOString(),
  };
}

function aggregatePetContract(profiles, revision = 1) {
  const verified = profiles.length > 0 && profiles.every(profile => profile.pet_contract?.status === 'verified'
    && profile.pet_contract?.cross_view_qa?.pass === true);
  return {
    schema_version: 2,
    contract_type: 'pet_bundle',
    pet_revision: revision,
    status: verified ? 'verified' : 'rejected',
    expected_animals: profiles.length,
    profiles,
    cross_view_qa: {
      pass: verified,
      member_count_pass: profiles.length > 0,
      verified_members: profiles.filter(profile => profile.pet_contract?.status === 'verified').length,
      expected_members: profiles.length,
      mismatch_reasons: verified ? [] : ['并非所有宠物资产都通过了各自的跨视图身份验证'],
    },
    updated_at: new Date().toISOString(),
  };
}

async function buildSubjectBoard(humans = [], pets = [], mediaAdapter = mediaAdapterDefault) {
  const subjects = [...humans, ...pets];
  if (subjects.length < 2 || !mediaAdapter?.ASSET_DIR || typeof mediaAdapter.publicAssetUrl !== 'function') return '';
  const files = subjects.map(subject => {
    const url = subject.image_url || subject.reference_images?.[0] || '';
    const filename = path.basename(String(url).split('?')[0]);
    const candidate = path.join(mediaAdapter.ASSET_DIR, filename);
    return filename && fs.existsSync(candidate) ? candidate : '';
  }).filter(Boolean);
  if (files.length !== subjects.length) return '';
  const columns = Math.ceil(Math.sqrt(files.length));
  const rows = Math.ceil(files.length / columns);
  const tileWidth = 360;
  const tileHeight = 480;
  const composites = [];
  for (let index = 0; index < files.length; index += 1) {
    const input = await sharp(files[index]).resize(tileWidth, tileHeight, {
      fit: 'contain', background: { r: 238, g: 238, b: 236, alpha: 1 },
    }).jpeg({ quality: 92 }).toBuffer();
    composites.push({ input, left: (index % columns) * tileWidth, top: Math.floor(index / columns) * tileHeight });
  }
  const filename = `subject_board_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
  fs.mkdirSync(mediaAdapter.ASSET_DIR, { recursive: true });
  const output = path.join(mediaAdapter.ASSET_DIR, filename);
  await sharp({
    create: { width: columns * tileWidth, height: rows * tileHeight, channels: 3, background: { r: 238, g: 238, b: 236 } },
  }).composite(composites).jpeg({ quality: 92 }).toFile(output);
  return mediaAdapter.publicAssetUrl(filename);
}

function hasLocalSubjectBoard(url = '', mediaAdapter = mediaAdapterDefault) {
  if (!url || !mediaAdapter?.ASSET_DIR) return false;
  const filename = path.basename(String(url).split('?')[0]);
  return !!filename && fs.existsSync(path.join(mediaAdapter.ASSET_DIR, filename));
}

async function generateSubjectBundle(options = {}, deps = {}) {
  const mediaAdapter = deps.mediaAdapter || mediaAdapterDefault;
  const personIdentity = deps.personIdentity || personIdentityDefault;
  const petIdentity = deps.petIdentity || petIdentityDefault;
  const cancellation = deps.cancellation || cancellationDefault;
  const storage = deps.storage || storageDefault;
  const body = options.body || {};
  const spec = body.person_spec && typeof body.person_spec === 'object' ? body.person_spec : {};
  const brief = cleanText(body.brief || body.content || '', 4000);
  const description = cleanText(body.description || '', 2000);
  const taskId = cleanText(options.taskId || body.task_id || '', 120);
  const counts = resolveCounts(spec, body);
  const humans = humanMemberSpecs(spec, body, counts.people);
  const pets = petMemberSpecs(spec, body, counts.pets);
  const kind = checkpointKind(taskId, brief, spec, counts, body);
  if (activeBundleKinds.has(kind)) {
    const error = new Error('相同主体资产批次正在生成，请等待当前批次完成');
    error.code = 'SUBJECT_ASSET_GENERATION_IN_PROGRESS';
    error.status = 409;
    error.retryable = true;
    throw error;
  }
  activeBundleKinds.add(kind);
  try {
  const previous = taskId ? (storage.getOutput(taskId, kind) || {}) : {};
  const checkpoint = {
    schema_version: 1,
    status: 'running',
    counts,
    humans: Array.isArray(previous.humans) ? previous.humans : [],
    pets: Array.isArray(previous.pets) ? previous.pets : [],
    subject_board_url: cleanText(previous.subject_board_url || '', 1000),
    updated_at: new Date().toISOString(),
  };
  const save = () => {
    checkpoint.updated_at = new Date().toISOString();
    if (taskId) storage.saveOutput(taskId, kind, checkpoint);
  };
  save();
  for (let index = checkpoint.humans.length; index < humans.length; index += 1) {
    cancellation.throwIfCancelled();
    const member = humans[index];
    const actorId = `new_story_actor_${Date.now()}_${index + 1}_${Math.random().toString(36).slice(2, 7)}`;
    const sheet = await mediaAdapter.generateActorReference({
      filename: `actor_${actorId}_sheet`,
      prompt: humanPrompt(brief, description, member, humans.length),
      aspectRatio: '3:4',
      imageModel: body.image_model || body.imageModel || 'auto',
    });
    const views = await mediaAdapter.splitActorSheet({ source: sheet, filenamePrefix: `actor_${actorId}`, viewKeys: HUMAN_VIEW_KEYS });
    cancellation.throwIfCancelled();
    const asset = {
      id: `actor_asset_${actorId}`, actor_asset_id: `actor_asset_${actorId}`, actor_id: actorId,
      name: member.displayName, cast_role: member.roleName, cast_member_index: index + 1,
      source: 'new_story_ad_actor_sheet', reference_kind: 'synthetic_realistic_actor', is_ai_generated: true,
      image_url: views[0]?.url || '', extra_image_urls: views.slice(1).map(view => view.url).filter(Boolean),
      view_images: views, view_count: views.length, description: humanPrompt(brief, description, member, humans.length),
    };
    asset.person_contract = await personIdentity.verifyPersonAsset({ taskId: taskId || options.generationId, asset, spec: member, revision: 1 });
    asset.person_contract.display_name = member.displayName;
    asset.person_contract.role_name = member.roleName;
    asset.person_revision = asset.person_contract.person_revision;
    asset.production_usable_actor = asset.person_contract.status === 'verified';
    checkpoint.humans.push(asset);
    save();
  }
  for (let index = checkpoint.pets.length; index < pets.length; index += 1) {
    cancellation.throwIfCancelled();
    const profile = pets[index];
    const petId = `new_story_pet_${Date.now()}_${index + 1}_${Math.random().toString(36).slice(2, 7)}`;
    const sheet = await mediaAdapter.generateActorReference({
      filename: `pet_${petId}_sheet`,
      prompt: petPrompt(brief, profile, pets.length),
      aspectRatio: '3:4',
      imageModel: body.image_model || body.imageModel || 'auto',
    });
    const views = await mediaAdapter.splitActorSheet({ source: sheet, filenamePrefix: `pet_${petId}`, viewKeys: HUMAN_VIEW_KEYS });
    cancellation.throwIfCancelled();
    const asset = {
      id: `pet_asset_${petId}`, pet_asset_id: `pet_asset_${petId}`, pet_id: petId, name: profile.name,
      type: profile.type, breed: profile.breed, source: 'new_story_ad_pet_sheet',
      image_url: views[0]?.url || '', extra_image_urls: views.slice(1).map(view => view.url).filter(Boolean),
      view_images: views, view_count: views.length, description: profile.appearance,
    };
    asset.pet_contract = await petIdentity.verifyPetAsset({ taskId: taskId || options.generationId, asset, profile, revision: 1 });
    checkpoint.pets.push({ ...profile, ...asset, reference_images: views.map(view => view.url).filter(Boolean) });
    save();
  }
  const personContract = checkpoint.humans.length ? aggregatePersonContract(checkpoint.humans) : null;
  const petContract = checkpoint.pets.length ? aggregatePetContract(checkpoint.pets) : null;
  let subjectBoardUrl = checkpoint.subject_board_url;
  if (!hasLocalSubjectBoard(subjectBoardUrl, mediaAdapter)) {
    subjectBoardUrl = await buildSubjectBoard(checkpoint.humans, checkpoint.pets, mediaAdapter);
    checkpoint.subject_board_url = subjectBoardUrl;
  }
  checkpoint.status = 'complete';
  save();
  if (personContract) personContract.subject_board_url = subjectBoardUrl;
  if (petContract) petContract.subject_board_url = subjectBoardUrl;
  return {
    counts, cast_assets: checkpoint.humans, pet_profiles: checkpoint.pets,
    person_contract: personContract, pet_contract: petContract,
    subject_board_url: subjectBoardUrl, checkpoint_kind: kind,
  };
  } finally {
    activeBundleKinds.delete(kind);
  }
}

module.exports = {
  resolveCounts, checkpointKind, humanMemberSpecs, petMemberSpecs,
  aggregatePersonContract, aggregatePetContract, buildSubjectBoard, hasLocalSubjectBoard, generateSubjectBundle,
};
