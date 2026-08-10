function text(value, max = 800) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (!normalized || normalized === '[object Object]') return '';
  return normalized.slice(0, max);
}

const personAgeContract = require('./personAgeContractService');

function firstText(values = [], max = 800) {
  for (const value of values) {
    const normalized = text(value, max);
    if (normalized) return normalized;
  }
  return '';
}

const AGE_LABELS = {
  infant_0_1: '0-1岁婴儿年龄感',
  toddler_1_3: '1-3岁幼儿年龄感',
  child_4_7: '4-7岁儿童年龄感',
  child_8_12: '8-12岁少儿年龄感',
  teen_13_17: '13-17岁青少年年龄感',
  young_adult_17_25: '17-25岁年轻成人年龄感',
  young_adult: '25-32岁青年年龄感',
  adult_30_40: '30-40岁成熟青年年龄感',
  middle_40_55: '40-55岁中年年龄感',
  senior_55_plus: '55岁以上年长者年龄感',
};

const AGE_DESCRIPTOR_PATTERN = /(?:(?:0\s*[-—–至到~]\s*1)\s*岁?婴儿|(?:1\s*[-—–至到~]\s*3)\s*岁?幼儿|(?:4\s*[-—–至到~]\s*7)\s*岁?儿童|(?:8\s*[-—–至到~]\s*12)\s*岁?少儿|(?:13\s*[-—–至到~]\s*17)\s*岁?青少年|(?:17\s*[-—–至到~]\s*25)\s*岁?年轻成人|(?:25\s*[-—–至到~]\s*32)\s*岁?青年|(?:30\s*[-—–至到~]\s*40)\s*岁?成熟青年|(?:40\s*[-—–至到~]\s*55)\s*岁?中年|55\s*岁以上\s*年长者|婴儿|幼儿|儿童|少儿|青少年|年轻成人|成熟青年|中年|年长者)年龄感/gu;
const ASSIST_PROFILE_FIELDS = [
  'displayName', 'roleName', 'appearanceText', 'wardrobeText', 'hairMakeupText', 'negativeText',
];
const ASSIST_DETAIL_FIELDS = ['appearanceText', 'wardrobeText', 'hairMakeupText', 'negativeText'];
const REPLACEABLE_AUTHORITIES = new Set(['reference_direction', 'reference_safety', 'system_default']);

function stringList(value, allowed = null, limit = 24) {
  const items = Array.isArray(value) ? value : [];
  const allow = allowed ? new Set(allowed) : null;
  return [...new Set(items.map(item => text(item, 80)).filter(item => item && (!allow || allow.has(item))))].slice(0, limit);
}

function profileFieldAuthority(profile = {}) {
  const source = profile.field_authority || profile.fieldAuthority;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => ASSIST_PROFILE_FIELDS.includes(key))
    .map(([key, value]) => [key, text(value, 40)]));
}

function userEditedFields(profile = {}) {
  return stringList(
    profile.user_edited_fields || profile.userEditedFields || profile._userEditedFields,
    ASSIST_PROFILE_FIELDS,
  );
}

function replaceableAssistFields(profile = {}, options = {}) {
  const authority = profileFieldAuthority(profile);
  const edited = new Set(userEditedFields(profile));
  const referenceOwned = options.referenceOwned === true;
  return ASSIST_PROFILE_FIELDS.filter(key => {
    if (edited.has(key) || authority[key] === 'user') return false;
    if (!text(profile[key], 1000)) return true;
    if (REPLACEABLE_AUTHORITIES.has(authority[key])) return true;
    return referenceOwned && ASSIST_DETAIL_FIELDS.includes(key) && !authority[key];
  });
}

function categoryCount(value = '', patterns = []) {
  return patterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
}

function assistedFieldQuality(field = '', value = '') {
  const normalized = text(value, 1200);
  const rules = {
    appearanceText: {
      min: 55,
      patterns: [
        /脸型|五官|眉|眼|鼻|唇|面部/u,
        /身形|体型|身高|肩|体态|比例/u,
        /肤色|肤质|皮肤/u,
        /气质|神态|表情|目光/u,
      ],
      required: 3,
    },
    wardrobeText: {
      min: 60,
      patterns: [
        /上衣|衬衫|外套|夹克|针织|T恤|西装/u,
        /下装|长裤|短裤|半裙|连衣裙|裙装/u,
        /鞋|靴|运动鞋|皮鞋|高跟/u,
        /颜色|色调|米色|白色|黑色|蓝色|灰色|棕色|绿色|红色/u,
        /材质|棉|麻|羊毛|丝|皮革|牛仔|针织/u,
        /配饰|眼镜|首饰|耳饰|项链|手表|无配饰/u,
      ],
      required: 5,
    },
    hairMakeupText: {
      min: 42,
      patterns: [
        /发型|短发|长发|卷发|直发|马尾|盘发|分缝|发色/u,
        /妆|肤质|眉|唇色|胡须|素颜/u,
        /眼镜|耳饰|发饰|帽|首饰|不佩戴/u,
      ],
      required: 3,
    },
    negativeText: {
      min: 45,
      patterns: [
        /年龄|性别|脸型|五官|身份/u,
        /发型|发色|妆容|眼镜|胡须/u,
        /服装|上衣|下装|鞋|配饰|颜色/u,
        /网红脸|塑料皮肤|磨皮|畸形|多余人物/u,
      ],
      required: 3,
    },
  };
  const rule = rules[field];
  if (!rule) return { valid: !!normalized, length: normalized.length, category_count: normalized ? 1 : 0 };
  const count = categoryCount(normalized, rule.patterns);
  return {
    valid: normalized.length >= rule.min && count >= rule.required,
    length: normalized.length,
    category_count: count,
    minimum_length: rule.min,
    minimum_categories: rule.required,
  };
}

function assistedProfileQuality(profile = {}, fields = ASSIST_DETAIL_FIELDS) {
  const checked = stringList(fields, ASSIST_DETAIL_FIELDS);
  const details = Object.fromEntries(checked.map(field => [field, assistedFieldQuality(field, profile[field])]));
  const issues = Object.entries(details).filter(([, result]) => !result.valid).map(([field]) => field);
  return { valid: issues.length === 0, issues, details };
}

function dedupeClauses(value = '', max = 800) {
  const normalized = text(value, Math.max(max * 2, 1200));
  if (!normalized) return '';
  const seen = new Set();
  return normalized
    .split(/([，；。])/u)
    .reduce((rows, part, index, all) => {
      if (!part || /^[，；。]$/u.test(part)) return rows;
      const key = part.replace(/[\s、,，;；。]+/gu, '').toLowerCase();
      if (!key || seen.has(key)) return rows;
      seen.add(key);
      const punctuation = /^[，；。]$/u.test(all[index + 1] || '') ? all[index + 1] : '，';
      rows.push(`${part.trim()}${punctuation}`);
      return rows;
    }, [])
    .join('')
    .replace(/[，；。]+$/u, '')
    .slice(0, max);
}

function alignAgeDescription(value = '', age = '', max = 800) {
  const label = AGE_LABELS[String(age || '')] || '';
  const normalized = text(value, Math.max(max * 2, 1200));
  let cleaned = normalized.replace(AGE_DESCRIPTOR_PATTERN, '');
  // A concrete age typed by the user is source truth. Never run the legacy
  // 1-2 digit cleanup against 100/1000-year-old roles before persistence.
  if (personAgeContract.containsAgeExpression(cleaned)) return dedupeClauses(cleaned, max);
  cleaned = cleaned
    .replace(/(?:年龄(?:约为|为|约)?|约|大约|看起来)?\s*\d{1,2}\s*(?:岁|周岁)(?:左右|上下)?/gu, '')
    .replace(/^[\s，、；:：的]+|[\s，、；]+$/gu, '')
    .replace(/[，、；]{2,}/gu, '，');
  cleaned = dedupeClauses(cleaned, max);
  if (!label) return cleaned;
  return text(`${label}，${cleaned || '外貌、体态、肤质和表情应符合该年龄阶段的真实商业人物特征'}`, max);
}

function profileTexts(profile = {}, options = {}) {
  const contract = profile.person_contract && typeof profile.person_contract === 'object'
    ? profile.person_contract
    : {};
  const rawAppearance = firstText([
    profile.appearanceText,
    profile.appearance?.userPrompt,
    profile.appearance?.description,
    contract.identity?.face_description,
    profile.face_description,
    profile.description,
  ], 800);
  return {
    appearanceText: alignAgeDescription(rawAppearance, options.age || profile.age || '', 800),
    wardrobeText: dedupeClauses(firstText([
      profile.wardrobeText,
      profile.wardrobe?.userPrompt,
      profile.wardrobe?.description,
      profile.outfit,
      contract.wardrobe?.description,
    ], 600), 600),
    hairMakeupText: dedupeClauses(firstText([
      profile.hairMakeupText,
      profile.hairMakeup?.userPrompt,
      profile.hairMakeup?.description,
      contract.appearance?.hair_style,
      profile.hair_style,
    ], 400), 400),
    negativeText: dedupeClauses(firstText([
      profile.negativeText,
      profile.negative,
    ], 500), 500),
  };
}

function canonicalProfile(profile = {}, options = {}) {
  const resolved = profileTexts(profile, options);
  return {
    ...profile,
    ...resolved,
    appearance: {
      ...(profile.appearance && typeof profile.appearance === 'object' ? profile.appearance : {}),
      userPrompt: resolved.appearanceText,
    },
    wardrobe: {
      ...(profile.wardrobe && typeof profile.wardrobe === 'object' ? profile.wardrobe : {}),
      userPrompt: resolved.wardrobeText,
    },
    hairMakeup: {
      ...(profile.hairMakeup && typeof profile.hairMakeup === 'object' ? profile.hairMakeup : {}),
      userPrompt: resolved.hairMakeupText,
    },
    outfit: resolved.wardrobeText,
  };
}

module.exports = {
  AGE_LABELS,
  ASSIST_PROFILE_FIELDS,
  ASSIST_DETAIL_FIELDS,
  text,
  firstText,
  stringList,
  profileFieldAuthority,
  userEditedFields,
  replaceableAssistFields,
  assistedFieldQuality,
  assistedProfileQuality,
  dedupeClauses,
  alignAgeDescription,
  profileTexts,
  canonicalProfile,
};
