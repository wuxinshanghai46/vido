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
const subjectProfileText = require('./subjectProfileTextService');
const visualRealism = require('./visualRealismPolicyService');
const subjectContinuityPolicy = require('./subjectContinuityPolicyService');
const visualVerification = require('./visualVerificationService');
const personDossierCompiler = require('./personDossierCompiler');
const dossierComposites = require('./dossierCompositeService');
const generationSpecCompletion = require('./generationSpecCompletionService');
const assetGenerationCheckpoint = require('./assetGenerationCheckpointService');
const knowledgePolicyRuntime = require('./knowledgePolicyRuntimeService');
const wearableEvidence = require('./wearableEvidencePolicyService');

const HUMAN_VIEW_KEYS = ['front', 'side', 'back', 'action'];
const activeBundleKinds = new Set();
const activeBundleTasks = new Set();
const activePersonVerificationTasks = new Set();
const PERSON_AGE_LABELS = {
  infant_0_1: '0-1 year old infant',
  toddler_1_3: '1-3 year old toddler',
  child_4_7: '4-7 year old child',
  child_8_12: '8-12 year old child',
  teen_13_17: '13-17 year old teenager',
  young_adult_17_25: '17-25 year old young adult',
  young_adult: '25-32 year old adult',
  adult_30_40: '30-40 year old adult',
  middle_40_55: '40-55 year old adult',
  senior_55_plus: '55 year old or older adult',
};
const PERSON_AGE_LABELS_ZH = {
  infant_0_1: '0-1岁婴儿年龄感', toddler_1_3: '1-3岁幼儿年龄感',
  child_4_7: '4-7岁儿童年龄感', child_8_12: '8-12岁少儿年龄感',
  teen_13_17: '13-17岁青少年年龄感', young_adult_17_25: '17-25岁年轻成人年龄感',
  young_adult: '25-32岁青年年龄感', adult_30_40: '30-40岁成熟青年年龄感',
  middle_40_55: '40-55岁中年年龄感', senior_55_plus: '55岁以上年长者年龄感',
};

function alignMemberAgeText(text = '', age = '') {
  const label = PERSON_AGE_LABELS_ZH[String(age || '')];
  if (!label) return cleanText(text, 800);
  const cleaned = String(text || '')
    .replace(/\d{1,2}\s*(?:-|—|–|至|到|~)\s*\d{1,2}\s*岁?/g, '')
    .replace(/(?:年龄(?:约为|为|约)?|约|大约|看起来)?\s*\d{1,2}\s*(?:岁|周岁)(?:左右|上下)?/g, '')
    .replace(/^[\s，、；:：的]+|[\s，、；]+$/g, '')
    .replace(/[，、；]{2,}/g, '，');
  return cleanText(`${label}，${cleaned || '外貌、体态、肤质和表情符合该年龄阶段'}`, 800);
}

function boundedCount(value, fallback, max) {
  const n = Number(value);
  const resolved = Number.isFinite(n) && n >= 0 ? n : fallback;
  return Math.max(0, Math.min(max, Math.round(resolved)));
}

function firstDeclaredCount(values = [], fallback = 0, max = 12) {
  const declared = values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
  return boundedCount(declared, fallback, max);
}

function resolveCounts(spec = {}, body = {}) {
  const mode = cleanText(spec.castMode || spec.cast_mode || body.cast_mode || body.castMode || 'single', 40).toLowerCase();
  const suppliedPeople = Array.isArray(body.cast_profiles) ? body.cast_profiles.length : 0;
  const suppliedPets = Array.isArray(body.pet_profiles) ? body.pet_profiles.length : 0;
  const peopleFallback = ['no_human', 'animal'].includes(mode)
    ? 0
    : (suppliedPeople || (mode === 'dual' ? 2 : (mode === 'single' ? 1 : 0)));
  const petFallback = ['animal', 'human_pet'].includes(mode) ? (suppliedPets || 0) : 0;
  return {
    mode,
    people: firstDeclaredCount(
      [body.expected_people, body.expectedPeople, spec.expectedPeople, spec.expected_people],
      peopleFallback,
      12,
    ),
    pets: firstDeclaredCount(
      [body.expected_animals, body.expectedAnimals, spec.expectedAnimals, spec.expected_animals],
      petFallback,
      8,
    ),
  };
}

function personGenerationProfile(source = {}) {
  const resolved = subjectProfileText.profileTexts(source);
  return {
    id: cleanText(source.id || source.cast_id || source.castId || '', 80),
    displayName: cleanText(source.displayName || source.name || '', 120),
    roleName: cleanText(source.roleName || source.role || '', 120),
    age: cleanText(source.age || source.ageRange || source.appearance?.ageRange || 'match_brief', 40),
    appearanceText: cleanText(resolved.appearanceText || '', 800),
    wardrobeText: cleanText(resolved.wardrobeText || '', 600),
    hairMakeupText: cleanText(resolved.hairMakeupText || '', 500),
    negativeText: cleanText(resolved.negativeText || '', 600),
  };
}

function petGenerationProfile(source = {}) {
  return {
    id: cleanText(source.id || source.pet_id || source.petId || '', 80),
    name: cleanText(source.name || '', 120),
    type: cleanText(source.type || source.species || '', 120),
    breed: cleanText(source.breed || '', 160),
    appearance: cleanText(source.appearance || source.description || '', 600),
  };
}

function personGenerationSpec(spec = {}) {
  return {
    castMode: cleanText(spec.castMode || spec.cast_mode || 'auto', 40),
    gender: cleanText(spec.gender || 'auto', 40),
    expectedPeople: cleanText(spec.expectedPeople || spec.expected_people || '', 20),
    expectedAnimals: cleanText(spec.expectedAnimals || spec.expected_animals || '', 20),
    age: cleanText(spec.age || 'match_brief', 40),
    origin: cleanText(spec.origin || 'match_brief', 120),
    roleName: cleanText(spec.roleName || '', 120),
    displayName: cleanText(spec.displayName || '', 120),
    appearanceText: cleanText(spec.appearanceText || '', 800),
    wardrobeText: cleanText(spec.wardrobeText || '', 600),
    hairMakeupText: cleanText(spec.hairMakeupText || '', 500),
    negativeText: cleanText(spec.negativeText || '', 600),
  };
}

function checkpointKind(taskId, brief, spec, counts, body = {}) {
  const hash = crypto.createHash('sha256').update(JSON.stringify({
    fingerprint_version: 3,
    brief,
    spec: personGenerationSpec(spec),
    counts,
    description: cleanText(body.description || '', 2000),
    cast_profiles: (Array.isArray(body.cast_profiles) ? body.cast_profiles : []).map(personGenerationProfile),
    pet_profiles: (Array.isArray(body.pet_profiles) ? body.pet_profiles : []).map(petGenerationProfile),
    subject_targets: Array.isArray(body.subject_targets)
      ? body.subject_targets.map(item => ({
          kind: cleanText(item?.kind || '', 20),
          index: Math.max(0, Number(item?.index || 0) || 0),
          id: cleanText(item?.id || '', 80),
        }))
      : (Array.isArray(body.subjectTargets) ? body.subjectTargets.map(item => ({
          kind: cleanText(item?.kind || '', 20),
          index: Math.max(0, Number(item?.index || 0) || 0),
          id: cleanText(item?.id || '', 80),
        })) : []),
    image_model: cleanText(body.image_model || body.imageModel || 'auto', 120),
    regenerate_selected: body.regenerate_selected === true,
    regenerate_request_key: body.regenerate_selected === true ? cleanText(body.request_key || '', 160) : '',
  })).digest('hex').slice(0, 20);
  return `subject_asset_checkpoint:${cleanText(taskId || 'detached', 80)}:${hash}`;
}

function compatibleCheckpoint(storage, taskId, counts, targets, humans, pets) {
  if (!taskId || typeof storage?.listOutputs !== 'function') return null;
  const targetKeys = targets.selected.map(item => item.key).sort();
  const rows = storage.listOutputs(taskId)
    .filter(row => String(row?.kind || '').startsWith('subject_asset_checkpoint:'))
    .filter(row => row?.payload?.status === 'complete')
    .sort((left, right) => Date.parse(right.updated_at || right.payload?.updated_at || '') - Date.parse(left.updated_at || left.payload?.updated_at || ''));
  return rows.map(row => row.payload).find(payload => {
    if (Number(payload?.counts?.people || 0) !== counts.people || Number(payload?.counts?.pets || 0) !== counts.pets) return false;
    if (cleanText(payload?.counts?.mode || '', 40) !== cleanText(counts.mode || '', 40)) return false;
    const previousTargets = (Array.isArray(payload.targets) ? payload.targets : []).map(item => cleanText(item?.key || subjectKey(item?.kind, item?.id, Number(item?.index || 0) + 1), 140)).sort();
    if (JSON.stringify(previousTargets) !== JSON.stringify(targetKeys)) return false;
    const previousHumans = Array.isArray(payload.humans) ? payload.humans : [];
    const previousPets = Array.isArray(payload.pets) ? payload.pets : [];
    if (previousHumans.length !== humans.length || previousPets.length !== pets.length) return false;
    const humansMatch = humans.every((profile, index) => {
      const asset = previousHumans[index];
      return reusableHumanAsset(asset)
        && JSON.stringify(personGenerationProfile(asset.subject_profile || {})) === JSON.stringify(personGenerationProfile(profile));
    });
    const petsMatch = pets.every((profile, index) => {
      const asset = previousPets[index];
      return reusablePetAsset(asset)
        && JSON.stringify(petGenerationProfile(asset)) === JSON.stringify(petGenerationProfile(profile));
    });
    return humansMatch && petsMatch;
  }) || null;
}

function humanMemberSpecs(spec = {}, body = {}, count = 1) {
  const supplied = Array.isArray(body.cast_profiles) ? body.cast_profiles : [];
  return supplied.slice(0, count).map((source, index) => {
    const role = cleanText(source.roleName || source.role || '', 120);
    const resolved = subjectProfileText.profileTexts(source);
    const age = cleanText(
      source.age || source.ageRange || source.appearance?.ageRange || (count === 1 ? spec.age : '') || 'match_brief',
      40,
    );
    return {
      ...source,
      id: cleanText(source.id || source.cast_id || source.castId || '', 80),
      member_index: index + 1,
      displayName: cleanText(source.displayName || source.name || '', 120),
      roleName: role,
      age,
      ...resolved,
      appearanceText: alignMemberAgeText(resolved.appearanceText, age),
    };
  });
}

function petMemberSpecs(spec = {}, body = {}, count = 1) {
  const supplied = Array.isArray(body.pet_profiles) ? body.pet_profiles : [];
  return supplied.slice(0, count).map((source, index) => {
    return {
      id: cleanText(source.id || source.pet_id || source.petId || '', 80),
      name: cleanText(source.name || '', 120),
      type: cleanText(source.type || source.species || '', 120),
      breed: cleanText(source.breed || '', 160),
      appearance: cleanText(source.appearance || source.description || '', 600),
      member_index: index + 1,
    };
  });
}

function subjectKey(kind = '', id = '', index = 0) {
  return `${kind}:${cleanText(id || '', 100) || String(Number(index) || 0)}`;
}

function requestedSubjectTargets(body = {}, humans = [], pets = []) {
  const rawTargets = Array.isArray(body.subject_targets)
    ? body.subject_targets
    : (Array.isArray(body.subjectTargets) ? body.subjectTargets : []);
  const all = [
    ...humans.map((member, index) => ({
      kind: 'human', index, id: member.id, key: subjectKey('human', member.id, index + 1),
    })),
    ...pets.map((profile, index) => ({
      kind: 'pet', index, id: profile.id, key: subjectKey('pet', profile.id, index + 1),
    })),
  ];
  if (!rawTargets.length) return { explicit: false, selected: all, selectedKeys: new Set(all.map(item => item.key)) };
  const selected = [];
  const seen = new Set();
  rawTargets.forEach((raw) => {
    const source = raw && typeof raw === 'object' ? raw : {};
    const kind = cleanText(source.kind || source.type || '', 20).toLowerCase();
    const id = cleanText(source.id || source.subject_id || source.subjectId || '', 100);
    const index = Number(source.index);
    const match = all.find(item => item.kind === kind && (
      id ? item.id === id : (Number.isInteger(index) && item.index === index)
    ));
    if (!match || seen.has(match.key)) return;
    selected.push(match);
    seen.add(match.key);
  });
  if (!selected.length || selected.length !== rawTargets.length) {
    const error = new Error('所选人物或宠物已变化，请刷新后重新选择；本次没有提交图片模型');
    error.code = 'SUBJECT_TARGET_INVALID';
    error.status = 409;
    error.retryable = true;
    throw error;
  }
  return { explicit: true, selected, selectedKeys: seen };
}

function subjectReferenceUrls(asset = null) {
  if (!asset || typeof asset !== 'object') return [];
  const values = [
    ...(Array.isArray(asset.view_images) ? asset.view_images : []),
    ...(Array.isArray(asset.reference_images) ? asset.reference_images : []),
  ];
  return [...new Set(values.map(value => cleanText(
    typeof value === 'string' ? value : (value?.url || value?.image_url || value?.imageUrl || ''),
    1000,
  )).filter(Boolean))];
}

function reusableHumanAsset(asset = null) {
  return !!(asset && (asset.actor_id || asset.id)
    && subjectReferenceUrls(asset).length >= HUMAN_VIEW_KEYS.length);
}

function reusablePetAsset(asset = null) {
  return !!(asset && (asset.pet_id || asset.id)
    && subjectReferenceUrls(asset).length >= HUMAN_VIEW_KEYS.length);
}

function existingSubjectAssets(storage, taskId = '', humans = [], pets = []) {
  if (!taskId || typeof storage?.getOutput !== 'function') return { humans: [], pets: [] };
  const context = storage.getOutput(taskId, 'context') || {};
  const personAsset = context.person_asset && typeof context.person_asset === 'object' ? context.person_asset : {};
  const castAssets = Array.isArray(personAsset.cast_assets) ? personAsset.cast_assets : [];
  const petProfiles = Array.isArray(context.pet_profiles) ? context.pet_profiles : [];
  return {
    humans: humans.map((member, index) => {
      const matched = castAssets.find(asset => [asset.actor_id, asset.id, asset.actor_asset_id]
        .map(value => cleanText(value || '', 100)).includes(member.id)) || castAssets[index] || null;
      return reusableHumanAsset(matched) ? { ...matched, subject_profile: member } : null;
    }),
    pets: pets.map((profile, index) => {
      const matched = petProfiles.find(asset => [asset.pet_id, asset.id, asset.pet_asset_id]
        .map(value => cleanText(value || '', 100)).includes(profile.id)) || petProfiles[index] || null;
      return reusablePetAsset(matched)
        ? { ...matched, ...profile, reference_images: matched.reference_images || matched.view_images.map(view => view.url || view.image_url).filter(Boolean) }
        : null;
    }),
  };
}

function subjectProfilesError(message, details = {}) {
  const error = new Error(message);
  error.code = 'SUBJECT_PROFILES_REQUIRED';
  error.status = 400;
  error.retryable = false;
  Object.assign(error, details);
  return error;
}

function assertCompleteSubjectProfiles(counts = {}, humans = [], pets = []) {
  if (counts.mode === 'single' && counts.people !== 1) {
    throw subjectProfilesError('单人模式必须且只能提供 1 份人物档案', {
      subject_type: 'human',
      expected_count: 1,
      actual_count: counts.people,
    });
  }
  if (counts.mode === 'dual' && counts.people !== 2) {
    throw subjectProfilesError('双人模式必须且只能提供 2 份独立人物档案', {
      subject_type: 'human',
      expected_count: 2,
      actual_count: counts.people,
    });
  }
  if (counts.mode === 'multi' && counts.people < 3) {
    throw subjectProfilesError('多人模式必须填写 3-12 的精确人数并提供对应独立档案', {
      subject_type: 'human',
      expected_min: 3,
      actual_count: counts.people,
    });
  }
  if (['no_human', 'animal'].includes(counts.mode) && counts.people !== 0) {
    throw subjectProfilesError('无人物或纯宠物模式不能提交人物数量或人物档案', {
      subject_type: 'human',
      expected_count: 0,
      actual_count: counts.people,
    });
  }
  if (!['animal', 'human_pet'].includes(counts.mode) && counts.pets !== 0) {
    throw subjectProfilesError('当前主体模式不能提交宠物数量或宠物档案', {
      subject_type: 'pet',
      expected_count: 0,
      actual_count: counts.pets,
    });
  }
  if (counts.mode === 'animal' && counts.pets < 1) {
    throw subjectProfilesError('纯宠物模式必须填写精确宠物数量并提供逐宠物档案', {
      subject_type: 'pet',
      expected_count: counts.pets,
    });
  }
  if (counts.mode === 'human_pet' && (counts.people < 1 || counts.pets < 1)) {
    throw subjectProfilesError('人物 + 宠物模式必须分别填写精确人物数、宠物数和对应独立档案', {
      subject_type: 'mixed',
      expected_people: counts.people,
      expected_animals: counts.pets,
    });
  }
  if (!['no_human', 'animal'].includes(counts.mode) && counts.people < 1) {
    throw subjectProfilesError('当前人物模式必须填写 1-12 的精确人数并提供逐人物档案', {
      subject_type: 'human',
      expected_count: counts.people,
    });
  }
  if (humans.length !== counts.people) {
    throw subjectProfilesError(`人物档案数量与精确人数不一致：需要 ${counts.people} 份，当前 ${humans.length} 份`, {
      subject_type: 'human',
      expected_count: counts.people,
      actual_count: humans.length,
    });
  }
  if (pets.length !== counts.pets) {
    throw subjectProfilesError(`宠物档案数量与精确数量不一致：需要 ${counts.pets} 份，当前 ${pets.length} 份`, {
      subject_type: 'pet',
      expected_count: counts.pets,
      actual_count: pets.length,
    });
  }
  const subjectIds = [...humans, ...pets].map(item => item.id);
  const duplicateIds = subjectIds.filter((id, index, ids) => id && ids.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw subjectProfilesError('每个人物和宠物必须使用互不重复的稳定 ID', {
      duplicate_ids: [...new Set(duplicateIds)],
    });
  }
  humans.forEach((member, index) => {
    const missing = [
      ['id', member.id],
      ['displayName', member.displayName],
      ['roleName', member.roleName],
      ['appearanceText', member.appearanceText],
      ['wardrobeText', member.wardrobeText],
      ['hairMakeupText', member.hairMakeupText],
    ].filter(([, value]) => !cleanText(value || '', 20)).map(([field]) => field);
    if (missing.length) {
      throw subjectProfilesError(`第 ${index + 1} 个人物档案不完整：缺少 ${missing.join('、')}`, {
        subject_type: 'human',
        member_index: index + 1,
        missing_fields: missing,
      });
    }
    const text = [member.roleName, member.appearanceText, member.wardrobeText, member.hairMakeupText, member.negativeText].join('\n');
    const otherNames = humans
      .filter((_, otherIndex) => otherIndex !== index)
      .map(item => cleanText(item.displayName || '', 120))
      .filter(name => name.length >= 2 && text.includes(name));
    if (otherNames.length) {
      throw subjectProfilesError(`第 ${index + 1} 个人物档案混入了其他成员：${otherNames.join('、')}`, {
        subject_type: 'human',
        member_index: index + 1,
        mixed_member_names: otherNames,
      });
    }
  });
  pets.forEach((profile, index) => {
    const missing = [
      ['id', profile.id],
      ['type', profile.type],
      ['appearance', profile.appearance],
    ].filter(([, value]) => !cleanText(value || '', 20)).map(([field]) => field);
    if (missing.length) {
      throw subjectProfilesError(`第 ${index + 1} 个宠物档案不完整：缺少 ${missing.join('、')}`, {
        subject_type: 'pet',
        member_index: index + 1,
        missing_fields: missing,
      });
    }
    const text = [profile.type, profile.breed, profile.appearance].join('\n');
    const otherNames = pets
      .filter((_, otherIndex) => otherIndex !== index)
      .map(item => cleanText(item.name || '', 120))
      .filter(name => name.length >= 2 && text.includes(name));
    if (otherNames.length) {
      throw subjectProfilesError(`第 ${index + 1} 个宠物档案混入了其他宠物：${otherNames.join('、')}`, {
        subject_type: 'pet',
        member_index: index + 1,
        mixed_member_names: otherNames,
      });
    }
  });
  return true;
}

function humanPrompt(member, count) {
  return [
    'Create one production-ready photorealistic actor identity for a complete 20-item dossier.',
    'This identity will be rendered into separate body, face, expression and action contact sheets.',
    subjectContinuityPolicy.generationRuleEn(),
    'Use a real neutral casting studio with even soft light, subtle floor contact and natural tonal falloff; no text, watermark, other person or collage border inside cells.',
    visualRealism.identitySheetRealismPrompt(),
    count > 1 ? `This is cast member ${member.member_index} of ${count}. Create a clearly unique identity; never clone or resemble another cast member.` : '',
    `Name/role: ${member.displayName}; ${member.roleName}.`,
    member.age && member.age !== 'match_brief'
      ? `Age lock: ${PERSON_AGE_LABELS[member.age] || member.age}. This is a hard constraint; ignore any stale conflicting age phrase.`
      : 'Age lock: use only the age explicitly supported by this member profile and campaign relationship.',
    member.appearanceText ? `Appearance: ${member.appearanceText}.` : '',
    member.wardrobeText ? `Locked wardrobe: ${member.wardrobeText}.` : '',
    member.hairMakeupText ? `Locked hair/makeup: ${member.hairMakeupText}.` : '',
    member.negativeText ? `Negative continuity rules: ${member.negativeText}.` : '',
  ].filter(Boolean).join('\n');
}

function petPrompt(profile, count) {
  return [
    'Generate one production-ready photorealistic animal identity sheet as an exact 2x2 grid.',
    'The same single animal appears in all four cells: front full-body, side full-body, back full-body, and natural action full-body.',
    'Neutral seamless studio, even soft light, no human, no other animal, no text, no watermark.',
    'Preserve the exact species, breed traits, coat color and pattern, face markings, eye color, body proportions, tail, ears and collar/accessories across all views.',
    count > 1 ? `This is animal ${profile.member_index} of ${count}; it must have a distinct stable identity.` : '',
    `Pet: ${profile.name}; type ${profile.type}; breed ${profile.breed || 'as required by brief'}; appearance ${profile.appearance || 'as required by brief'}.`,
  ].filter(Boolean).join('\n');
}

function aggregatePersonContract(members, revision = 1) {
  const contracts = members.map(member => member.person_contract || {});
  const verified = members.length > 0 && contracts.every(contract => contract.status === 'verified'
    && contract.cross_view_qa?.pass === true);
  const rejectedContracts = contracts.filter(contract => contract.status === 'rejected'
    || contract.verification?.state === 'rejected');
  const unavailableContracts = contracts.filter(contract => contract.verification?.state === 'unavailable'
    || contract.qa_unavailable === true);
  const mismatchReasons = rejectedContracts.flatMap(contract => [
    ...(Array.isArray(contract.cross_view_qa?.mismatch_reasons) ? contract.cross_view_qa.mismatch_reasons : []),
    ...(Array.isArray(contract.verification?.reasons) ? contract.verification.reasons : []),
  ]).map(value => cleanText(value, 240)).filter(Boolean);
  const verification = verified
    ? visualVerification.verified('')
    : (rejectedContracts.length
      ? visualVerification.rejected(mismatchReasons, '部分人物资产未通过各自的跨视图身份验证')
      : (unavailableContracts.length
        ? visualVerification.unavailable({
            code: unavailableContracts[0].verification?.code || 'VISION_QA_UNAVAILABLE',
            retryable: true,
          }, `${unavailableContracts.length} 个人物的视觉审核暂时不可用，可直接再次验证，无需重新生成图片`)
        : visualVerification.pending('部分人物仍在等待各自的跨视图身份验证')));
  return {
    schema_version: 2,
    contract_type: 'cast_bundle',
    person_revision: revision,
    status: verified ? 'verified' : (rejectedContracts.length ? 'rejected' : 'unverified'),
    expected_people: members.length,
    member_contracts: contracts,
    reference_views: members[0]?.person_contract?.reference_views || {},
    verification,
    cross_view_qa: {
      pass: verified,
      member_count_pass: members.length > 0,
      verified_members: members.filter(member => member.person_contract?.status === 'verified'
        && member.person_contract?.cross_view_qa?.pass === true).length,
      expected_members: members.length,
      mismatch_reasons: verified ? [] : (mismatchReasons.length
        ? [...new Set(mismatchReasons)].slice(0, 12)
        : ['并非所有人物资产都通过了各自的跨视图身份验证']),
    },
    updated_at: new Date().toISOString(),
  };
}

async function reverifyPersonBundle({
  taskId = '',
  personAsset = null,
  castProfiles = [],
  subjectTargets = [],
  personSpec = {},
} = {}, dependencies = {}) {
  const personIdentity = dependencies.personIdentity || personIdentityDefault;
  const lockKey = cleanText(taskId || personAsset?.actor_id || personAsset?.id || 'detached', 120);
  if (activePersonVerificationTasks.has(lockKey)) {
    const error = new Error('当前人物验证仍在进行中，请等待本轮完成；没有重复提交视觉审核');
    error.code = 'PERSON_VERIFICATION_IN_PROGRESS';
    error.status = 409;
    error.retryable = true;
    throw error;
  }
  const bundled = Array.isArray(personAsset?.cast_assets) && personAsset.cast_assets.length > 0;
  const assets = bundled ? personAsset.cast_assets : (personAsset ? [personAsset] : []);
  if (!assets.length) {
    const error = new Error('当前任务没有可验证的人物资产');
    error.code = 'PERSON_ASSET_REQUIRED';
    error.status = 422;
    throw error;
  }
  const profiles = assets.map((asset, index) => ({
    ...(assets.length === 1 && personSpec && typeof personSpec === 'object' ? personSpec : {}),
    ...(castProfiles[index] && typeof castProfiles[index] === 'object' ? castProfiles[index] : {}),
    ...(asset.subject_profile && typeof asset.subject_profile === 'object' ? asset.subject_profile : {}),
    id: cleanText(asset.subject_profile?.id || castProfiles[index]?.id || asset.actor_id || asset.id || `cast_${index + 1}`, 100),
  }));
  const rawTargets = Array.isArray(subjectTargets) ? subjectTargets : [];
  const resolvedTargets = requestedSubjectTargets(
    { subject_targets: rawTargets },
    profiles,
    [],
  );
  const selectedIndexes = rawTargets.length
    ? new Set(resolvedTargets.selected.map(target => target.index))
    : new Set(assets.map((asset, index) => (
      asset.person_contract?.status === 'verified' && asset.person_contract?.cross_view_qa?.pass === true
        ? -1
        : index
    )).filter(index => index >= 0));
  activePersonVerificationTasks.add(lockKey);
  try {
    const nextAssets = [...assets];
    for (const index of selectedIndexes) {
      const asset = assets[index];
      const profile = profiles[index] || personSpec || {};
      const contract = await personIdentity.verifyPersonAsset({
        taskId,
        asset,
        spec: profile,
        revision: asset.person_revision || asset.person_contract?.person_revision || personAsset.person_revision || 1,
        force: true,
      });
      nextAssets[index] = {
        ...asset,
        person_revision: contract.person_revision,
        person_contract: {
          ...contract,
          display_name: profile.displayName || profile.name || asset.name || '',
          role_name: profile.roleName || profile.role || asset.cast_role || '',
        },
        production_usable_actor: contract.status === 'verified',
      };
    }
    const revision = Math.max(1, Number(personAsset.person_revision || nextAssets[0]?.person_revision || 1) || 1);
    const personContract = bundled
      ? aggregatePersonContract(nextAssets, revision)
      : nextAssets[0].person_contract;
    const nextPersonAsset = bundled
      ? {
          ...personAsset,
          cast_assets: nextAssets,
          person_contract: personContract,
          production_usable_actor: personContract.status === 'verified',
        }
      : {
          ...nextAssets[0],
          person_contract: personContract,
          production_usable_actor: personContract.status === 'verified',
        };
    const nextProfiles = profiles.map((profile, index) => ({
      ...profile,
      person_contract: nextAssets[index].person_contract,
      referenceImageUrl: profile.referenceImageUrl || nextAssets[index].image_url || '',
      image_url: profile.image_url || nextAssets[index].image_url || '',
      view_images: nextAssets[index].view_images || profile.view_images || [],
    }));
    return {
      person_asset: nextPersonAsset,
      person_contract: personContract,
      cast_profiles: nextProfiles,
      verified_targets: [...selectedIndexes].map(index => ({
        kind: 'human',
        index,
        id: profiles[index]?.id || '',
      })),
    };
  } finally {
    activePersonVerificationTasks.delete(lockKey);
  }
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
  let body = options.body || {};
  const brief = cleanText(body.brief || body.content || '', 4000);
  const taskId = cleanText(options.taskId || body.task_id || '', 120);
  const completion = await generationSpecCompletion.completePersonProfiles({
    taskId,
    brief,
    castProfiles: body.cast_profiles,
  }, {
    storage,
    ...(deps.modelGateway ? { modelGateway: deps.modelGateway } : {}),
    ...(deps.jsonRepair ? { jsonRepair: deps.jsonRepair } : {}),
    ...(deps.forceCompletionModel === true ? { forceModel: true } : {}),
    ...(deps.mediaAdapter && deps.mediaAdapter !== mediaAdapterDefault ? { deterministic: true } : {}),
  });
  if (completion.changed) {
    body = { ...body, cast_profiles: completion.cast_profiles };
    if (options.deferContextCommit !== true && taskId && typeof storage.getOutput === 'function' && typeof storage.saveOutput === 'function') {
      const current = storage.getOutput(taskId, 'context') || {};
      storage.saveOutput(taskId, 'context', {
        ...current,
        cast_profiles: completion.cast_profiles,
        generation_input_completion: {
          ...(current.generation_input_completion || {}),
          person: { checkpoint_kind: completion.checkpoint_kind, updated_at: new Date().toISOString() },
        },
      });
    }
  }
  const spec = body.person_spec && typeof body.person_spec === 'object' ? body.person_spec : {};
  const counts = resolveCounts(spec, body);
  const humans = humanMemberSpecs(spec, body, counts.people);
  const pets = petMemberSpecs(spec, body, counts.pets);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const totalUnits = Math.max(1, humans.length * 5 + pets.length * 2 + 1);
  let processedUnits = 0;
  const report = async (phase, message, detail = {}) => {
    if (!onProgress) return;
    await onProgress({ phase, message, processed: processedUnits, completed: processedUnits, total: totalUnits, ...detail });
  };
  await report('preparing', '正在核对人物、动物档案与可复用检查点');
  assertCompleteSubjectProfiles(counts, humans, pets);
  const targets = requestedSubjectTargets(body, humans, pets);
  const reusable = existingSubjectAssets(storage, taskId, humans, pets);
  if (targets.explicit) {
    const missingReused = [
      ...humans.map((member, index) => ({
        kind: 'human', index, id: member.id, asset: reusable.humans[index],
      })),
      ...pets.map((profile, index) => ({
        kind: 'pet', index, id: profile.id, asset: reusable.pets[index],
      })),
    ].filter(item => !targets.selectedKeys.has(subjectKey(item.kind, item.id, item.index + 1)) && !item.asset);
    if (missingReused.length) {
      const error = new Error('未选择的主体缺少可复用四视图，请勾选它一并生成；本次没有提交图片模型');
      error.code = 'SUBJECT_REUSE_ASSET_MISSING';
      error.status = 409;
      error.retryable = true;
      error.details = {
        missing_subjects: missingReused.map(item => ({
          kind: item.kind,
          index: item.index,
          id: item.id,
        })),
      };
      throw error;
    }
  }
  const kind = checkpointKind(taskId, brief, spec, counts, body);
  const taskLockKey = cleanText(taskId || options.generationId || kind, 160);
  if (activeBundleKinds.has(kind) || activeBundleTasks.has(taskLockKey)) {
    const error = new Error('相同主体资产批次正在生成，请等待当前批次完成');
    error.code = 'SUBJECT_ASSET_GENERATION_IN_PROGRESS';
    error.status = 409;
    error.retryable = true;
    throw error;
  }
  activeBundleKinds.add(kind);
  activeBundleTasks.add(taskLockKey);
  let checkpoint = null;
  let save = () => {};
  try {
  const forceRegenerate = body.regenerate_selected === true;
  const previous = taskId
    ? (storage.getOutput(taskId, kind) || (!forceRegenerate ? compatibleCheckpoint(storage, taskId, counts, targets, humans, pets) : null) || {})
    : {};
  const previousHumans = Array.isArray(previous.humans) ? previous.humans : [];
  const previousPets = Array.isArray(previous.pets) ? previous.pets : [];
  checkpoint = {
    schema_version: 2,
    status: 'running',
    counts,
    targets: targets.selected.map(item => ({ kind: item.kind, index: item.index, id: item.id, key: item.key })),
    generated_counts: { people: 0, pets: 0 },
    humans: humans.map((member, index) => {
      const selected = targets.selectedKeys.has(subjectKey('human', member.id, index + 1));
      if (!selected) return reusable.humans[index];
      return reusableHumanAsset(previousHumans[index]) ? previousHumans[index] : null;
    }),
    pets: pets.map((profile, index) => {
      const selected = targets.selectedKeys.has(subjectKey('pet', profile.id, index + 1));
      if (!selected) return reusable.pets[index];
      return reusablePetAsset(previousPets[index]) ? previousPets[index] : null;
    }),
    subject_board_url: cleanText(previous.subject_board_url || '', 1000),
    person_dossier_checkpoints: previous.person_dossier_checkpoints && typeof previous.person_dossier_checkpoints === 'object'
      ? previous.person_dossier_checkpoints
      : {},
    updated_at: new Date().toISOString(),
  };
  save = () => {
    checkpoint.updated_at = new Date().toISOString();
    if (taskId) storage.saveOutput(taskId, kind, checkpoint);
  };
  save();
  const personKnowledgePolicy = taskId
    ? knowledgePolicyRuntime.resolveTaskMany({ storage, taskId, selectors: [{ stage: 'person_dossier', assetType: 'person' }] })
    : knowledgePolicyRuntime.resolveMany([{ stage: 'person_dossier', assetType: 'person' }]);
  const subjectFailures = [];
  for (let index = 0; index < humans.length; index += 1) {
    if (reusableHumanAsset(checkpoint.humans[index])) {
      processedUnits += 5;
      await report('checkpoint_reused', `已复用人物 ${index + 1} 的完整档案`, { subject_index: index + 1, subject_kind: 'human' });
      continue;
    }
    try {
    cancellation.throwIfCancelled();
    const member = humans[index];
    const actorId = `new_story_actor_${crypto.createHash('sha256').update(`${kind}:${member.id}:${index}`).digest('hex').slice(0, 16)}`;
    const compiled = await personDossierCompiler.compilePersonDossier({
      taskId: taskId || options.generationId,
      assetId: actorId,
      revision: 1,
      personPrompt: humanPrompt(member, humans.length),
      requireReferences: false,
      loadCheckpoint: async key => checkpoint.person_dossier_checkpoints[key] || null,
      saveCheckpoint: async (key, value) => {
        checkpoint.person_dossier_checkpoints[key] = value;
        save();
      },
      onProgress: async ({ completed, total, kind, reused }) => {
        processedUnits += 1;
        await report('person_dossier', `${reused ? '复用' : '生成'}人物 ${index + 1} 的${kind}档案 ${completed}/${total}`, {
          subject_index: index + 1,
          subject_kind: 'human',
          unit_kind: kind,
        });
      },
      concurrency: Math.max(0, Number(options.personDossierConcurrency || 0)) || undefined,
      knowledgePolicy: personKnowledgePolicy,
    }, {
      mediaAdapter,
    });
    const bodyFront = compiled.atomic_assets.find(item => item.kind === 'body' && item.key === 'front');
    const bodySide = compiled.atomic_assets.find(item => item.kind === 'body' && item.key === 'side');
    const bodyBack = compiled.atomic_assets.find(item => item.kind === 'body' && item.key === 'back');
    const baseAction = compiled.atomic_assets.find(item => item.kind === 'action' && item.key === 'neutral_stand');
    const views = [
      { ...bodyFront, key: 'front', url: bodyFront?.image_url },
      { ...bodySide, key: 'side', url: bodySide?.image_url },
      { ...bodyBack, key: 'back', url: bodyBack?.image_url },
      { ...baseAction, key: 'action', url: baseAction?.image_url },
    ].filter(view => view.url);
    const detailCheckpoint = async key => checkpoint.person_dossier_checkpoints[key] || null;
    const saveDetailCheckpoint = async (key, value) => {
      checkpoint.person_dossier_checkpoints[key] = value;
      save();
    };
    const accessoryEvidence = await wearableEvidence.resolve({
      taskId: taskId || options.generationId,
      assetId: actorId,
      atomicAssets: compiled.atomic_assets,
      revision: 1,
      profile: member,
      loadCheckpoint: detailCheckpoint,
      saveCheckpoint: saveDetailCheckpoint,
    }, { mediaAdapter });
    const accessoryDetails = accessoryEvidence.items;
    const wardrobeDetails = await dossierComposites.generateWardrobeDetails({
      taskId: taskId || options.generationId,
      assetId: actorId,
      atomicAssets: compiled.atomic_assets,
      revision: 1,
      profile: member,
      loadCheckpoint: detailCheckpoint,
      saveCheckpoint: saveDetailCheckpoint,
    }, { mediaAdapter });
    const dossierSheet = await dossierComposites.composePersonDossier({
      taskId: taskId || options.generationId,
      assetId: actorId,
      atomicAssets: compiled.atomic_assets,
      revision: 1,
      title: member.displayName || '完整人物制作档案',
      profile: member,
      wardrobeDetails,
      accessoryDetails,
    }, { mediaAdapter });
    cancellation.throwIfCancelled();
    const asset = {
      id: `actor_asset_${actorId}`, actor_asset_id: `actor_asset_${actorId}`, actor_id: actorId,
      name: member.displayName, cast_role: member.roleName, cast_member_index: index + 1,
      source: 'new_story_ad_person_dossier', reference_kind: 'synthetic_realistic_actor', is_ai_generated: true,
      image_url: compiled.native_masters?.body?.image_url || views[0]?.url || '', extra_image_urls: views.slice(1).map(view => view.url).filter(Boolean),
      view_images: views, view_count: views.length, description: humanPrompt(member, humans.length),
      cover_image_url: dossierSheet.image_url,
      dossier_sheet: dossierSheet,
      dossier_schema_version: compiled.schema_version,
      quality_status: compiled.quality_status,
      native_masters: compiled.native_masters,
      category_atlases: compiled.category_atlases,
      atomic_assets: compiled.atomic_assets,
      body_views: compiled.body_views,
      identity_views: compiled.identity_views,
      expressions: compiled.expressions,
      base_actions: compiled.base_actions,
      accessory_details: accessoryDetails,
      accessory_evidence_trace: accessoryEvidence.trace,
      knowledge_policy: knowledgePolicyRuntime.trace(personKnowledgePolicy),
      wardrobe_details: {
        source: 'gpt_image_2_high_resolution_details',
        description: member.wardrobeText || '',
        items: wardrobeDetails,
        model_call_count: wardrobeDetails.reduce((sum, item) => sum + Number(item.model_call_count || 0), 0),
      },
      generation_summary: compiled.generation_summary,
      subject_profile: member,
    };
    asset.person_contract = await personIdentity.verifyPersonAsset({ taskId: taskId || options.generationId, asset, spec: member, revision: 1 });
    processedUnits += 1;
    await report('person_verification', `人物 ${index + 1} 档案已完成一致性验证`, { subject_index: index + 1, subject_kind: 'human' });
    asset.person_contract.display_name = member.displayName;
    asset.person_contract.role_name = member.roleName;
    asset.person_revision = asset.person_contract.person_revision;
    asset.production_usable_actor = asset.person_contract.status === 'verified';
    checkpoint.humans[index] = asset;
    checkpoint.generated_counts.people += 1;
    save();
    } catch (error) {
      if (error?.code === 'USER_CANCELLED' || error?.cancelled === true) throw error;
      subjectFailures.push({ kind: 'human', index, id: humans[index]?.id || '', error });
      save();
      await report('subject_failed', `人物 ${index + 1} 生成中断，继续处理其它独立主体`, {
        subject_index: index + 1,
        subject_kind: 'human',
        error_code: error?.code || 'SUBJECT_ASSET_GENERATION_FAILED',
      });
    }
  }
  for (let index = 0; index < pets.length; index += 1) {
    if (reusablePetAsset(checkpoint.pets[index])) {
      processedUnits += 2;
      await report('checkpoint_reused', `已复用动物 ${index + 1} 的身份档案`, { subject_index: index + 1, subject_kind: 'pet' });
      continue;
    }
    try {
    cancellation.throwIfCancelled();
    const profile = pets[index];
    const petId = `new_story_pet_${Date.now()}_${index + 1}_${Math.random().toString(36).slice(2, 7)}`;
    const petCheckpointKey = `pet_dossier:${profile.id || index + 1}:1`;
    const checkpointedPet = await assetGenerationCheckpoint.runCheckpointedUnit({
      identity: {
        key: petCheckpointKey,
        taskId: taskId || options.generationId,
        assetType: 'pet_dossier',
        assetId: profile.id || `pet_${index + 1}`,
        unit: 'reference_sheet',
        revision: 1,
        input: petGenerationProfile(profile),
      },
      load: async key => checkpoint.person_dossier_checkpoints[key] || null,
      save: async (key, value) => {
        checkpoint.person_dossier_checkpoints[key] = value;
        save();
      },
      execute: async controls => {
        const sheet = controls.providerResult || await mediaAdapter.generateActorReference({
          taskId: taskId || options.generationId,
          stage: 'new_story_ad.pet_dossier',
          filename: `pet_${petId}_sheet`,
          prompt: petPrompt(profile, pets.length),
          aspectRatio: '3:4',
          imageModel: body.image_model || body.imageModel || 'auto',
          clientRequestId: petCheckpointKey,
          onSubmitting: controls.onSubmitting,
          onSubmitted: controls.onSubmitted,
        });
        if (!controls.providerResult) await controls.onProviderResult(sheet);
        const views = await mediaAdapter.splitActorSheet({ source: sheet, filenamePrefix: `pet_${petId}`, viewKeys: HUMAN_VIEW_KEYS });
        return { sheet, views };
      },
    });
    const { views } = checkpointedPet.result;
    processedUnits += 1;
    await report('pet_dossier', `动物 ${index + 1} 多视图已生成`, { subject_index: index + 1, subject_kind: 'pet' });
    cancellation.throwIfCancelled();
    const asset = {
      id: `pet_asset_${petId}`, pet_asset_id: `pet_asset_${petId}`, pet_id: petId, name: profile.name,
      type: profile.type, breed: profile.breed, source: 'new_story_ad_pet_sheet',
      image_url: views[0]?.url || '', extra_image_urls: views.slice(1).map(view => view.url).filter(Boolean),
      view_images: views, view_count: views.length, description: profile.appearance,
    };
    asset.pet_contract = await petIdentity.verifyPetAsset({ taskId: taskId || options.generationId, asset, profile, revision: 1 });
    processedUnits += 1;
    await report('pet_verification', `动物 ${index + 1} 已完成一致性验证`, { subject_index: index + 1, subject_kind: 'pet' });
    checkpoint.pets[index] = { ...profile, ...asset, reference_images: views.map(view => view.url).filter(Boolean) };
    checkpoint.generated_counts.pets += 1;
    save();
    } catch (error) {
      if (error?.code === 'USER_CANCELLED' || error?.cancelled === true) throw error;
      subjectFailures.push({ kind: 'pet', index, id: pets[index]?.id || '', error });
      save();
      await report('subject_failed', `动物 ${index + 1} 生成中断，已保留其它独立主体`, {
        subject_index: index + 1,
        subject_kind: 'pet',
        error_code: error?.code || 'SUBJECT_ASSET_GENERATION_FAILED',
      });
    }
  }
  if (checkpoint.humans.some(asset => !reusableHumanAsset(asset))
    || checkpoint.pets.some(asset => !reusablePetAsset(asset))) {
    const firstFailure = subjectFailures[0]?.error;
    const error = firstFailure instanceof Error ? firstFailure : new Error('主体批次没有形成完整可复用资产，已停止提交');
    error.code = error.code || 'SUBJECT_BUNDLE_INCOMPLETE';
    error.status = error.status || 500;
    error.retryable = error.retryable !== false;
    error.subject_failures = subjectFailures.map(item => ({
      kind: item.kind,
      index: item.index,
      id: item.id,
      error_code: item.error?.code || 'SUBJECT_ASSET_GENERATION_FAILED',
      billing_state: item.error?.billingState || item.error?.billing_state || '',
    }));
    throw error;
  }
  const personContract = checkpoint.humans.length ? aggregatePersonContract(checkpoint.humans) : null;
  const petContract = checkpoint.pets.length ? aggregatePetContract(checkpoint.pets) : null;
  let subjectBoardUrl = checkpoint.subject_board_url;
  if (!hasLocalSubjectBoard(subjectBoardUrl, mediaAdapter)) {
    subjectBoardUrl = await buildSubjectBoard(checkpoint.humans, checkpoint.pets, mediaAdapter);
    checkpoint.subject_board_url = subjectBoardUrl;
  }
  checkpoint.status = 'complete';
  processedUnits = totalUnits;
  await report('complete', '主体档案已完成并写入当前项目');
  save();
  if (personContract) personContract.subject_board_url = subjectBoardUrl;
  if (petContract) petContract.subject_board_url = subjectBoardUrl;
  return {
    counts, cast_assets: checkpoint.humans, pet_profiles: checkpoint.pets,
    person_contract: personContract, pet_contract: petContract,
    subject_board_url: subjectBoardUrl, checkpoint_kind: kind,
    generated_counts: checkpoint.generated_counts,
    subject_targets: checkpoint.targets,
  };
  } catch (error) {
    if (checkpoint) {
      const completedPeople = Array.isArray(checkpoint.humans) ? checkpoint.humans.filter(reusableHumanAsset).length : 0;
      const completedPets = Array.isArray(checkpoint.pets) ? checkpoint.pets.filter(reusablePetAsset).length : 0;
      checkpoint.status = completedPeople + completedPets > 0 ? 'partial' : 'failed';
      checkpoint.error_code = cleanText(error?.code || 'SUBJECT_ASSET_GENERATION_FAILED', 120);
      save();
      const checkpointDetails = {
        status: checkpoint.status,
        checkpoint_kind: kind,
        counts: checkpoint.counts,
        completed_people: completedPeople,
        completed_pets: completedPets,
        error_code: checkpoint.error_code,
      };
      error.partial_subject_checkpoint = true;
      error.partial = checkpointDetails;
      error.details = {
        ...(error.details && typeof error.details === 'object' ? error.details : {}),
        subject_checkpoint: checkpointDetails,
      };
    }
    throw error;
  } finally {
    activeBundleKinds.delete(kind);
    activeBundleTasks.delete(taskLockKey);
  }
}

module.exports = {
  resolveCounts, checkpointKind, humanMemberSpecs, petMemberSpecs,
  alignMemberAgeText,
  subjectKey, requestedSubjectTargets, existingSubjectAssets,
  assertCompleteSubjectProfiles, humanPrompt, petPrompt,
  aggregatePersonContract, aggregatePetContract, reverifyPersonBundle,
  buildSubjectBoard, hasLocalSubjectBoard, generateSubjectBundle,
};
