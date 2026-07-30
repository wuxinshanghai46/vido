function text(value, max = 800) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (!normalized || normalized === '[object Object]') return '';
  return normalized.slice(0, max);
}

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
  let cleaned = text(value, Math.max(max * 2, 1200))
    .replace(AGE_DESCRIPTOR_PATTERN, '')
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
  text,
  firstText,
  dedupeClauses,
  alignAgeDescription,
  profileTexts,
  canonicalProfile,
};
