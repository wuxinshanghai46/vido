const { v4: uuidv4 } = require('uuid');

function cleanText(value = '', max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function inferGenderFromText(text = '') {
  const s = cleanText(text, 500).toLowerCase();
  if (/female|woman|girl|女士|女性|女主|美女|姑娘|女孩|太太|妈妈|姐姐/.test(s)) return 'female';
  if (/male|man|boy|男士|男性|男主|帅哥|先生|爸爸|哥哥/.test(s)) return 'male';
  return '';
}

const DEFAULT_NAMES = {
  female: ['\u6797\u60a6', '\u9648\u5c9a', '\u6c88\u77e5', '\u5468\u53ef', '\u8bb8\u5b81', '\u82cf\u6674'],
  male: ['\u9648\u8fdc', '\u987e\u660e', '\u5468\u8861', '\u6797\u5ddd', '\u8bb8\u821f', '\u6c88\u8d8a'],
  neutral: ['\u5468\u7136', '\u6797\u4e00', '\u9648\u5b89', '\u8bb8\u8bfa', '\u82cf\u8a00', '\u987e\u9752'],
};

function looksLikeDescriptorName(name = '') {
  const s = cleanText(name, 80);
  if (!s) return true;
  const exactDescriptors = [
    '\u89d2\u8272', '\u4eba\u7269', '\u4e3b\u89d2', '\u5973\u4e3b', '\u7537\u4e3b', '\u65c1\u767d',
    '\u8bb2\u89e3\u8005', '\u5c55\u793a\u8005', '\u5f15\u5bfc\u8005', '\u5ba2\u6237', '\u987e\u95ee',
    '\u9500\u552e', '\u7528\u6237', '\u6f14\u5458', '\u6a21\u7279', '\u7f8e\u5973', '\u5e05\u54e5',
  ];
  if (exactDescriptors.some(word => s === word || new RegExp(`^${word}\\d+$`, 'i').test(s))) return true;
  const descriptorWords = [
    '\u6c14\u8d28', '\u7f8e\u5973', '\u5e05\u54e5', '\u9ad8\u8d35', '\u4f18\u96c5',
    '\u957f\u53d1', '\u77ed\u53d1', '\u5ba2\u6237', '\u987e\u95ee', '\u9500\u552e',
    '\u5c55\u793a', '\u5f15\u5bfc', '\u8bb2\u89e3', '\u7528\u6237', '\u8001\u677f',
    '\u7ecf\u7406', '\u8d1f\u8d23\u4eba',
  ];
  if (descriptorWords.some(word => s.includes(word))) return true;
  return s.length > 8;
}

function defaultCharacterName(gender = '', idx = 0) {
  const pool = gender === 'female' ? DEFAULT_NAMES.female : (gender === 'male' ? DEFAULT_NAMES.male : DEFAULT_NAMES.neutral);
  return pool[idx % pool.length];
}

function normalizeCharacter(item, idx = 0) {
  if (typeof item === 'string') {
    const role = cleanText(item, 80);
    const gender = inferGenderFromText(role);
    return {
      name: defaultCharacterName(gender, idx),
      role,
      gender,
      description: role,
    };
  }
  const source = item && typeof item === 'object' ? item : {};
  const role = cleanText(source.role || source.relationship || source.identity || source.job || '', 80);
  const description = cleanText(source.description || source.appearance || source.profile || source.desc || '', 360);
  const gender = cleanText(source.gender || inferGenderFromText(`${source.name || ''} ${role} ${description}`), 30);
  const rawName = cleanText(source.name || source.character_name || source.displayName || source.label || '', 40);
  return {
    name: looksLikeDescriptorName(rawName) ? defaultCharacterName(gender, idx) : rawName,
    role,
    gender,
    description,
  };
}

function normalizeCharacters(input) {
  const raw = Array.isArray(input) ? input : [];
  return raw
    .map((item, idx) => normalizeCharacter(item, idx))
    .filter(x => x.name || x.role || x.description);
}

function inferCastMode({ castMode = '', characters = [], brief = '' } = {}) {
  const explicit = cleanText(castMode, 40);
  if (/multi|多人|三人|群像|团队/i.test(explicit)) return 'multi';
  if (/dual|双人|两人/i.test(explicit)) return 'dual';
  if (/single|单人|一人/i.test(explicit)) return 'single';
  const text = `${brief} ${characters.map(c => `${c.name}${c.role}`).join(' ')}`;
  if (characters.length >= 3 || /多人|三人|四人|团队|群像/.test(text)) return 'multi';
  if (characters.length === 2 || /双人|两人|夫妻|同事|客户.*顾问|主播.*助理/.test(text)) return 'dual';
  return 'auto';
}

function normalizeAssets(input) {
  const raw = Array.isArray(input) ? input : [];
  return raw.map((item, idx) => ({
    id: cleanText(item?.id || `asset_${idx + 1}`, 80),
    type: cleanText(item?.type || item?.kind || 'reference', 40),
    url: cleanText(item?.url || item?.image_url || item?.src || '', 1000),
    name: cleanText(item?.name || item?.filename || '', 120),
    description: cleanText(item?.description || item?.summary || '', 500),
  })).filter(x => x.url || x.description || x.name);
}

function buildContext(body = {}, user = {}) {
  const brief = cleanText(body.brief || body.content || body.requirement || body.prompt, 3000);
  const productSubject = cleanText(body.product_subject || body.productSubject || body.subject || body.product_name || body.productName || '', 200);
  const characters = normalizeCharacters(body.characters || body.cast || body.people);
  const assets = normalizeAssets(body.assets || body.references || body.images);
  const targetDuration = Math.max(10, Math.min(120, Number(body.duration || body.target_duration || body.targetDuration || 30) || 30));
  const rawShotCount = Number(body.shot_count || body.shotCount || 0) || 0;
  const shotCount = rawShotCount > 0 ? Math.max(1, Math.min(18, rawShotCount)) : 0;
  const outputRatio = cleanText(body.output_ratio || body.outputRatio || body.ratio || '9:16', 20);
  const forbidden = Array.isArray(body.forbidden)
    ? body.forbidden.map(x => cleanText(x, 100)).filter(Boolean)
    : cleanText(body.forbidden || body.negative || '', 500).split(/[，,;\n]/).map(x => cleanText(x, 100)).filter(Boolean);
  const castMode = inferCastMode({ castMode: body.cast_mode || body.castMode, characters, brief });
  return {
    request_id: cleanText(body.request_id || body.requestId || uuidv4(), 80),
    brief,
    product_subject: productSubject || inferSubjectFromBrief(brief),
    target_duration: targetDuration,
    shot_count: shotCount,
    output_ratio: outputRatio,
    cast_mode: castMode,
    characters,
    assets,
    forbidden,
    user_id: user?.id || user?.userId || '',
    created_at: new Date().toISOString(),
  };
}

function inferSubjectFromBrief(brief = '') {
  const text = cleanText(brief, 300);
  if (!text) return '当前广告主体';
  const m = text.match(/(?:推广|介绍|展示|宣传|卖点|广告|为|给)([^，。；,.!?！？]{2,30})/);
  return cleanText(m?.[1] || text.slice(0, 24), 80) || '当前广告主体';
}

function contextPrompt(ctx) {
  return [
    `广告需求：${ctx.brief}`,
    `广告主体：${ctx.product_subject}`,
    `目标时长：${ctx.target_duration} 秒`,
    `镜头数量：${ctx.shot_count ? `用户指定 ${ctx.shot_count} 镜` : '由用户剧情内容决定'}`,
    `画面比例：${ctx.output_ratio}`,
    `人物模式：${ctx.cast_mode}`,
    ctx.characters.length ? `角色设定：${JSON.stringify(ctx.characters)}` : '角色设定：未指定，生成时如需要人物，必须先给稳定短名，name 不得写成“气质美女/客户顾问/展示者”这类描述。',
    ctx.assets.length ? `素材：${JSON.stringify(ctx.assets)}` : '素材：无上传素材',
    ctx.forbidden.length ? `禁止项：${ctx.forbidden.join('、')}` : '禁止项：无',
  ].join('\n');
}

module.exports = {
  buildContext,
  contextPrompt,
  cleanText,
  normalizeCharacters,
  normalizeCharacter,
  looksLikeDescriptorName,
};
