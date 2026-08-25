const { cleanText } = require('./contextBuilder');
const petIdentity = require('./petIdentityContractService');
const subjectProfileText = require('./subjectProfileTextService');
const personLooks = require('./personLookProfileService');

function resolveAssistSubjectTarget(body = {}, context = {}) {
  const raw = body.assist_subject_target || body.assistSubjectTarget;
  if (!raw || typeof raw !== 'object') return null;
  const kind = cleanText(raw.kind || raw.type || '', 20).toLowerCase();
  if (!['human', 'cast', 'person'].includes(kind)) return null;
  const profiles = Array.isArray(context.cast_profiles) ? context.cast_profiles : [];
  const index = Number(raw.index);
  if (!Number.isInteger(index) || index < 0 || index >= profiles.length) return null;
  const current = profiles[index] || {};
  const currentId = cleanText(current.id || current.cast_id || current.castId || `cast_${index + 1}`, 80);
  const requestedId = cleanText(raw.id || raw.cast_id || raw.castId || '', 80);
  if (requestedId && requestedId !== currentId) return null;
  return { kind: 'human', index, id: currentId, profile: current };
}

function resolveReplaceableFields(body = {}, target = null) {
  if (!target?.profile) return [];
  const allowed = subjectProfileText.replaceableAssistFields(target.profile, {
    referenceOwned: contextIsReferenceOwned(body),
  });
  const requested = subjectProfileText.stringList(
    body.assist_replaceable_fields || body.assistReplaceableFields,
    subjectProfileText.ASSIST_PROFILE_FIELDS,
  );
  if (requested.length) {
    const allowedSet = new Set(allowed);
    return requested.filter(field => allowedSet.has(field));
  }
  return allowed;
}

function contextIsReferenceOwned(body = {}) {
  const source = body.person_context?.spec_source || body.personContext?.specSource || {};
  return ['reference_video', 'reference_analysis'].includes(cleanText(source.kind || '', 40))
    && source.manualOverride !== true
    && source.manual_override !== true;
}

function outputSchema() {
  return JSON.stringify({
    person_spec: {
      castMode: 'auto/single/dual/group/no_human/animal/human_pet',
      gender: 'auto/male/female/mixed/all_male/all_female',
      age: 'match_brief/young_adult_17_25/young_adult/adult_30_40/middle_40_55/senior_55_plus',
      origin: 'match_brief/east_asian_cn/southeast_asian/white_european/black_african/middle_eastern/south_asian/latino/mixed_global',
      roleName: '人物身份或职业', displayName: '正式人物姓名，可留空',
      expectedPeople: '需要人物时填写 1-12 的精确整数；无人物或纯宠物模式填写 0',
      appearanceText: '脸型、体型、年龄感、商业真实感、气质、表情可信度，80-160 字',
      wardrobeText: '首个造型的兼容字段，只描述一套固定服装', hairMakeupText: '发型与妆容，50-120 字',
      negativeText: '人物、服装、肤质与表情禁止项，分号分隔',
      expectedAnimals: '动物/宠物主体或人物+宠物模式填写 1-8 的整数，其它模式留空',
      petType: '宠物类型或品种', petDescription: '跨镜头稳定的宠物识别特征',
    },
    cast_profiles: [{
      id: '稳定且唯一的 cast ID', subject_kind: 'human/robot', displayName: '主体姓名或关系称呼', roleName: '独立身份、关系或职责',
      appearanceText: '人类写年龄、脸型、体型、气质和识别特征；机器人写尺寸比例、壳体结构、材质、传感器和稳定识别特征', wardrobeText: '人类写穿搭配饰；机器人写外壳护板、关节驱动、挂载配件、配色与材质',
      performanceText: '人物在画面中的动作和表演要求；不得写入 appearanceText',
      look_profiles: [{
        id: '稳定且唯一的造型ID', name: '用户可理解的造型名称', story_state: '时代或剧情状态',
        scene_ids: ['适用场景ID'], scene_names: ['适用场景名称'], wardrobeText: '60-160 字；该造型固定上装、下装或连衣裙、鞋履、颜色、材质、配饰及佩戴位置',
        hairMakeupText: '50-120 字；该造型固定发型发色、分缝或盘发方式、妆面肤质、眼镜、发饰与首饰', negativeText: '至少 45 字；该造型禁止改变身份年龄、发型妆造、服装鞋履配饰及常见 AI 瑕疵', continuityText: '该造型内部与同状态镜头的一致性',
        style_family: 'chinese_historical/xianxia_wuxia/republican_china/modern_contemporary/international_style/task_defined',
        style_richness: 'auto/restrained/refined/ornate_luxurious；选择 ornate_luxurious 时必须具体落实为符合时代和身份的分层服装、面料工艺、鞋履、发饰和首饰，不得只输出抽象的华丽二字',
        wardrobe_contract: {
          garment_system: { mode: 'one_piece/top_bottom/layered', items: [{ slot: 'upper/lower/one_piece/ensemble/outerwear', type: '具体单品', evidence: '自然语言证据' }] },
          footwear: { type: '鞋履类型', color: '颜色', material: '材质', evidence: '证据' },
          accessories: { mode: 'specified/none', items: [{ type: '配饰', position: '佩戴位置', material: '材质', evidence: '证据' }], evidence: '证据' },
          palette: { colors: ['主色', '辅色'], evidence: '证据' }, materials: [{ name: '面料或材质', used_for: '使用位置', evidence: '证据' }],
          negative_constraints: ['当前造型禁止项'], knowledge_doc_ids: ['实际使用的知识条目ID'],
        },
      }],
      hairMakeupText: '人类写发型妆造和佩戴物；机器人写头部面板、镜头/传感器阵列、指示灯和交互表情显示',
      negativeText: '人物全局禁止项；禁止四视图之间增减、更换、变色或移动服装、鞋、帽子、眼镜、发饰和首饰',
    }],
    pet_profiles: [{ id: '稳定且唯一的 pet ID', name: '宠物名字', type: '物种或品种', breed: '细分品种', appearance: '稳定识别特征' }],
  }, null, 2);
}

function preferDetailedField(field = '', preferred = '', alternative = '') {
  const preferredText = cleanText(preferred || '', 1200);
  const alternativeText = cleanText(alternative || '', 1200);
  const preferredQuality = subjectProfileText.assistedFieldQuality(field, preferredText);
  const alternativeQuality = subjectProfileText.assistedFieldQuality(field, alternativeText);
  if (preferredQuality.valid) return preferredText;
  if (alternativeQuality.valid) return alternativeText;
  if (alternativeQuality.category_count > preferredQuality.category_count) return alternativeText;
  if (alternativeQuality.category_count === preferredQuality.category_count && alternativeText.length > preferredText.length) return alternativeText;
  return preferredText || alternativeText;
}

const HISTORICAL_CONTEXT_PATTERN = /(?:古代|古装|汉服|襦裙|朝代|宫廷|发髻|玉簪|武侠|仙侠|前世|古今)/u;
const MODERN_CONTEXT_PATTERN = /(?:现代|当代|现今|办公室|西装|运动鞋|手机|机器人|LED|现代城市)/iu;

function contextEraIssues(candidate = {}, context = {}, target = null) {
  const authority = JSON.stringify({
    brief: context.brief || '', world_setting: context.world_setting || context.worldSetting || {},
    target: target?.profile || {}, content_mode: context.content_mode || '',
  });
  const generated = JSON.stringify({
    roleName: candidate.roleName, appearanceText: candidate.appearanceText, wardrobeText: candidate.wardrobeText,
    hairMakeupText: candidate.hairMakeupText, negativeText: candidate.negativeText, look_profiles: candidate.look_profiles,
  });
  const historicalAuthority = HISTORICAL_CONTEXT_PATTERN.test(authority);
  const modernAuthority = MODERN_CONTEXT_PATTERN.test(authority) || subjectProfileText.subjectKind(target?.profile || candidate) === 'robot';
  const issues = [];
  if (modernAuthority && !historicalAuthority && HISTORICAL_CONTEXT_PATTERN.test(generated)) issues.push('unsupported_historical_context');
  if (historicalAuthority && !modernAuthority && MODERN_CONTEXT_PATTERN.test(generated)) issues.push('unsupported_modern_context');
  return issues;
}

function modelDraftQuality(parsed = {}, target = null, replaceableFields = [], context = {}) {
  if (!target?.kind) return { valid: true, issues: [], details: {} };
  const profiles = Array.isArray(parsed.cast_profiles || parsed.castProfiles)
    ? (parsed.cast_profiles || parsed.castProfiles)
    : [];
  const candidate = normalizeCastProfiles(parsed, context, target)[0]
    || profiles.find(profile => cleanText(profile?.id || '', 80) === target.id)
    || profiles[0]
    || {};
  const detailed = replaceableFields.filter(field => subjectProfileText.ASSIST_DETAIL_FIELDS.includes(field));
  const quality = subjectProfileText.assistedProfileQuality(candidate, detailed);
  const missing = replaceableFields.filter(field => !cleanText(candidate[field] || '', 1200));
  const contextIssues = contextEraIssues(candidate, context, target);
  return {
    valid: missing.length === 0 && quality.valid && contextIssues.length === 0,
    issues: [...new Set([...missing, ...quality.issues, ...contextIssues])],
    details: quality.details,
  };
}

function normalizeCastProfiles(parsed = {}, context = {}, target = null) {
  let source = Array.isArray(parsed.cast_profiles || parsed.castProfiles)
    ? (parsed.cast_profiles || parsed.castProfiles)
    : (Array.isArray(context.cast_profiles) ? context.cast_profiles : []);
  if (target?.kind === 'human') {
    const candidate = source.find(profile => cleanText(profile?.id || profile?.cast_id || profile?.castId || '', 80) === target.id)
      || source[0]
      || target.profile
      || {};
    source = [{ ...candidate, id: target.id }];
  }
  return source.slice(0, 12).map((profile, index) => {
    const profileAge = cleanText(
      profile?.age
      || profile?.ageRange
      || context.person_spec?.age
      || context.personSpec?.age
      || '',
      40,
    );
    const canonical = subjectProfileText.canonicalProfile(profile || {}, { age: profileAge });
    const withLooks = personLooks.normalizeProfileLooks({ ...profile, ...canonical });
    const firstLook = withLooks.look_profiles?.[0] || {};
    const wardrobeText = preferDetailedField('wardrobeText', canonical.wardrobeText, withLooks.wardrobeText || firstLook.wardrobeText);
    const hairMakeupText = preferDetailedField('hairMakeupText', canonical.hairMakeupText, withLooks.hairMakeupText || firstLook.hairMakeupText);
    const negativeText = preferDetailedField('negativeText', canonical.negativeText, withLooks.negativeText || firstLook.negativeText);
    const lookProfiles = (withLooks.look_profiles || []).map((look, lookIndex) => lookIndex ? look : ({
      ...look,
      wardrobeText: preferDetailedField('wardrobeText', look.wardrobeText, wardrobeText),
      hairMakeupText: preferDetailedField('hairMakeupText', look.hairMakeupText, hairMakeupText),
      negativeText: preferDetailedField('negativeText', look.negativeText, negativeText),
    }));
    return {
    ...withLooks,
    subject_kind: subjectProfileText.subjectKind({ ...profile, ...withLooks }),
    wardrobeText,
    hairMakeupText,
    negativeText,
    look_profiles: lookProfiles,
    id: cleanText(profile?.id || `cast_${index + 1}`, 80),
    displayName: cleanText(profile?.displayName || profile?.name || '', 120),
    name: cleanText(profile?.displayName || profile?.name || '', 120),
    roleName: cleanText(profile?.roleName || profile?.role || '', 120),
    age: profileAge || 'match_brief',
  };
  });
}

function normalizePetProfiles(parsed = {}, context = {}) {
  const source = Array.isArray(parsed.pet_profiles || parsed.petProfiles)
    ? (parsed.pet_profiles || parsed.petProfiles)
    : (Array.isArray(context.pet_profiles) ? context.pet_profiles : []);
  return source.slice(0, 8).map((profile, index) => ({
    id: cleanText(profile?.id || `pet_${index + 1}`, 80),
    name: cleanText(profile?.name || '', 120),
    type: cleanText(profile?.type || profile?.species || '', 120),
    breed: cleanText(profile?.breed || '', 160),
    appearance: cleanText(profile?.appearance || profile?.description || '', 600),
    reference_images: Array.isArray(profile?.reference_images) ? profile.reference_images : [],
  }));
}

function buildResponse({
  parsed = {},
  context = {},
  mode = 'person_spec',
  modelResult = {},
  enforcePersonSpec,
  target = null,
  replaceableFields = [],
} = {}) {
  if (typeof enforcePersonSpec !== 'function') {
    throw new TypeError('enforcePersonSpec is required');
  }
  const raw = parsed.person_spec || parsed.personSpec || parsed;
  const spec = enforcePersonSpec(
    raw && typeof raw === 'object' ? raw : {},
    context.person_spec,
    context,
  );
  const castProfiles = normalizeCastProfiles(parsed, context, target);
  const quality = modelDraftQuality({ cast_profiles: castProfiles }, target, replaceableFields, context);
  if (target?.kind && !quality.valid) {
    const error = new Error(`人物详细设定未达到可生成标准：${quality.issues.join('、')}`);
    error.code = 'ASSIST_PERSON_PROFILE_INCOMPLETE';
    error.status = 502;
    error.retryable = true;
    error.details = quality.details;
    throw error;
  }
  return {
    person_spec: {
      castMode: cleanText(spec.castMode || spec.cast_mode || 'auto', 40),
      gender: cleanText(spec.gender || 'auto', 40),
      age: cleanText(spec.age || 'match_brief', 40),
      origin: cleanText(spec.origin || 'match_brief', 60),
      roleName: cleanText(spec.roleName || spec.role_name || '', 100),
      displayName: cleanText(spec.displayName || spec.display_name || '', 60),
      expectedPeople: Math.max(0, Math.min(12, Math.round(Number(spec.expectedPeople || spec.expected_people || 0) || 0))),
      appearanceText: cleanText(spec.appearanceText || spec.appearance || '', 360),
      wardrobeText: cleanText(spec.wardrobeText || spec.wardrobe || spec.outfit || '', 420),
      hairMakeupText: cleanText(spec.hairMakeupText || spec.hair_makeup || spec.hair || '', 280),
      negativeText: cleanText(spec.negativeText || spec.negative || '', 420),
      ...petIdentity.assistedResponseFields(spec),
    },
    cast_profiles: castProfiles,
    pet_profiles: target?.kind === 'human' ? [] : normalizePetProfiles(parsed, context),
    assist_subject_target: target ? { kind: target.kind, index: target.index, id: target.id } : null,
    assist_replaceable_fields: replaceableFields,
    mode,
    model_meta: {
      used_model: modelResult.used_model,
      fallback_used: modelResult.fallback_used,
      failed_models: modelResult.failed_models,
    },
  };
}

module.exports = {
  outputSchema,
  normalizeCastProfiles,
  normalizePetProfiles,
  resolveAssistSubjectTarget,
  resolveReplaceableFields,
  modelDraftQuality,
  contextEraIssues,
  buildResponse,
};
