const STYLE_KNOWLEDGE_VERSION = '1.0.0';
const BASE_KNOWLEDGE_DOC_ID = 'kb_wardrobe_closed_contract_20260808';

function clean(value = '', max = 2400) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function uniq(values = [], max = 24) {
  return [...new Set(values.map(value => clean(value, 120)).filter(Boolean))].slice(0, max);
}

const STYLE_FAMILIES = Object.freeze([
  Object.freeze({
    id: 'chinese_historical', doc_id: 'kb_wardrobe_chinese_historical_20260808', label: '中国古代写实装束', specificity: 2,
    selectors: ['古代', '古装', '汉服', '唐代', '唐朝', '宋代', '宋朝', '明代', '明朝', '清代', '清朝', '襦裙', '齐胸襦裙', '马面裙', '圆领袍', '长衫', '道袍', '武侠'],
    instruction: '先确定朝代或明确为架空古代，再选同一服制体系。女性可按襦裙、袄裙、褙子、马面裙等完整组合组织；男性可按圆领袍、直裰/道袍、长衫、短打等完整组合组织。必须同时写清内外层次、衣长与袖型、鞋履、发式发冠或明确无饰、主辅色、面料和纹样位置；不得把不同朝代的标志性结构随意拼接。',
  }),
  Object.freeze({
    id: 'xianxia_wuxia', doc_id: 'kb_wardrobe_chinese_historical_20260808', label: '仙侠/武侠风格装束', specificity: 3,
    selectors: ['仙侠', '仙女', '仙君', '剑姬', '灵女', '神女', '修仙', '玄幻', '武侠', '江湖', '妖族', '敦煌', '异域古风', '宫廷古偶'],
    instruction: '仙侠、江湖、宫廷、异域、妖族和敦煌是不同风格，不得只写“飘逸古装”。服装轮廓、发饰、武器/法器、色系和环境气质要形成同一视觉语义；保留可行动结构和真实层次，禁止用随机飘带、满身金饰或跨文化符号堆砌代替角色身份。',
  }),
  Object.freeze({
    id: 'republican_china', doc_id: 'kb_wardrobe_republican_china_20260808', label: '民国时期装束', specificity: 3,
    selectors: ['民国', '旗袍', '长衫马褂', '长衫', '中山装', '学生装', '月份牌', '旧上海', '海派'],
    instruction: '先区分年代、地域、阶层和场合。女性可从旗袍、袄裙、学生装或职业装中选一套完整体系；男性可从长衫、长衫马褂、中山装、西装或工装中选择。明确领型、衣长、开衩/门襟、鞋袜、发型、手袋/眼镜/帽饰或明确无饰，并避免把现代修身礼服、影楼发型和古代冠饰混入。',
  }),
  Object.freeze({
    id: 'modern_contemporary', doc_id: 'kb_wardrobe_modern_contemporary_20260808', label: '现代男女装束',
    selectors: ['现代', '当代', '都市', '职场', '商务', '休闲', '街头', '校园', '运动', '通勤', '礼服', '西装', '衬衫', '连衣裙'],
    instruction: '根据职业、年龄、场合和人物气质选择商务、通勤、休闲、街头、校园、运动或正式礼服体系。男女都要写清上装+下装或完整连体服、鞋袜、配饰方案、主辅色、材质、版型和发型；不使用“时尚穿搭、精致配饰”等不可验证空话。',
  }),
  Object.freeze({
    id: 'international_style', doc_id: 'kb_wardrobe_international_styles_20260808', label: '国外及跨文化装束', specificity: 3,
    selectors: ['国外', '外国', '欧美', '欧洲', '美式', '英伦', '法式', '意式', '韩式', '韩国', '日式', '日本', '南亚', '印度', '中东', '拉丁', '非洲', '维多利亚', '爱德华', '摄政时期', '西部牛仔'],
    instruction: '“国外风格”必须继续落实到地区、年代、场合与人物身份；信息不足时采用当代国际都市基础款，不擅自添加民族、宗教或仪式符号。历史欧洲、现代欧美、日韩校园、南亚或中东等体系必须分别成套，禁止把不同时代与文化的标志性单品拼成泛异域造型。',
  }),
  Object.freeze({
    id: 'pastoral_healing', doc_id: 'kb_scene_pastoral_healing_20260808', label: '田园治愈场景与装束',
    selectors: ['田园', '乡村', '农家', '菜地', '果园', '采摘', '治愈', '牧歌', '庭院', '自然生活'],
    instruction: '以可持续的日常活动组织画面：清晨菜地、午后树荫、采摘收获、傍晚炊烟或邻里用餐。服装以真实劳动和季节为依据，场景写清路径、作物、工具、桌椅、光线时段与动作锚点，避免只有滤镜和空泛“治愈感”。',
  }),
]);

const GARMENT_SYSTEMS = Object.freeze([
  { mode: 'layered', slots: ['ensemble'], pattern: /齐胸襦裙|齐腰襦裙|交领襦裙|对襟襦裙|袄裙|褙子|马面裙|汉服|襦裙|长衫马褂|学生装|中山装|西装套装|三件套|套装|礼服套装|宫廷装|骑士甲|板甲|链甲/iu },
  { mode: 'one_piece', slots: ['one_piece'], pattern: /连衣裙|旗袍|长衫|长袍|圆领袍|道袍|直裰|深衣|曲裾|礼袍|斗篷袍|连体衣|dress|qipao|cheongsam|robe|jumpsuit/iu },
  { mode: 'top_bottom', slots: ['upper', 'lower'], pattern: /(?:上衣|衬衫|T恤|卫衣|毛衣|针织衫|夹克|外套|背心|短打|袄|衫|shirt|jacket|sweater|top)[^。；\n]{0,120}(?:长裤|短裤|裤装|半裙|裙摆|下裙|下装|牛仔裤|马面裙|trousers|pants|shorts|skirt)/iu },
]);

const EVIDENCE_PATTERNS = Object.freeze({
  footwear: /鞋|靴|履|屐|袜|高跟|运动鞋|皮鞋|布鞋|绣花鞋|皂靴|云头履|赤脚|光脚|shoes?|sneakers?|boots?|heels?|sandals?|barefoot/iu,
  accessories: /配饰|首饰|耳环|耳饰|耳钉|耳坠|项链|颈链|吊坠|胸针|手表|腕表|手链|手镯|戒指|眼镜|发饰|发冠|发簪|玉簪|步摇|钗|冠|帽|腰带|革带|玉佩|香囊|领带|丝巾|手袋|无配饰|不佩戴任何配饰|accessor|earring|necklace|watch|bracelet|ring|glasses|hat|tie|scarf/iu,
  colour: /颜色|色调|配色|白|黑|灰|米色|象牙|蓝|青|绿|红|朱|绛|粉|桃|紫|黄|棕|褐|金|银|藏青|卡其|靛|黛|玄色|月白|藕荷|松石|color|colour|white|black|blue|green|red|pink|purple|brown|navy|khaki/iu,
  material: /材质|面料|棉|麻|羊毛|呢料|丝绸|真丝|罗|纱|绫|缎|锦|绢|绒|皮革|牛仔|针织|雪纺|亚麻|金属|珍珠|玉|翡翠|宝石|刺绣|织锦|cotton|linen|wool|silk|leather|denim|knit|chiffon|satin|metal|pearl/iu,
});

function contextParts(input = {}) {
  const look = input.look || {};
  const profile = input.profile || {};
  return {
    local: clean([look.name, look.story_state, look.wardrobeText, look.hairMakeupText, ...(look.scene_names || [])].filter(Boolean).join(' '), 2800),
    person: clean([profile.displayName, profile.roleName, profile.gender, profile.age, profile.appearanceText].filter(Boolean).join(' '), 1600),
    task: clean([input.brief, input.productSubject, input.sceneName, input.extra].filter(Boolean).join(' '), 5000),
  };
}

function familyScore(family, parts) {
  const matched = family.selectors.reduce((score, term) => {
    const needle = term.toLowerCase();
    return score + (parts.local.toLowerCase().includes(needle) ? 5 : 0)
      + (parts.person.toLowerCase().includes(needle) ? 2 : 0)
      + (parts.task.toLowerCase().includes(needle) ? 1 : 0);
  }, 0);
  return matched ? matched + Number(family.specificity || 0) : 0;
}

function resolve(input = {}, options = {}) {
  const parts = contextParts(input);
  const limit = Math.max(1, Math.min(4, Number(options.limit || 3) || 3));
  const families = STYLE_FAMILIES.map(family => ({ ...family, score: familyScore(family, parts) }))
    .filter(family => family.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
  return {
    schema_version: STYLE_KNOWLEDGE_VERSION,
    families,
    knowledge_doc_ids: [BASE_KNOWLEDGE_DOC_ID, ...families.map(family => family.doc_id)],
  };
}

function promptBlock(input = {}, options = {}) {
  const selected = resolve(input, options);
  const lines = [
    '人物造型知识合同：先判断每个 look 的时代、地域、身份、性别呈现和场合，再选择同一套装束体系；用户事实始终优先。',
    '每个造型必须形成可检查闭环：服装制式（完整连体，或上装+下装，或成套分层体系）、鞋袜、配饰/明确无配饰、主辅色、材质纹样、发型妆容、禁止项。',
    '同一时代内换装必须拆成独立 look_profiles；不得把古代与现代、前世与今生等跨时代状态揉在一起，必须进一步拆成独立人物档案并显示为“人名（时代）”。',
    ...selected.families.map(family => `${family.label}：${family.instruction}`),
  ];
  return lines.join('\n');
}

function semanticClauses(text = '') {
  return clean(text, 2000).split(/[。；;，,\n]+/u).map(value => clean(value, 320)).filter(Boolean);
}

function matchingClauses(text = '', pattern, max = 8) {
  return semanticClauses(text).filter(value => pattern.test(value)).slice(0, max);
}

function garmentEvidence(text = '') {
  const source = clean(text, 2000);
  const matched = GARMENT_SYSTEMS.find(item => item.pattern.test(source));
  if (matched) {
    const evidence = matchingClauses(source, matched.pattern, 3).join('；') || source;
    return { mode: matched.mode, items: matched.slots.map(slot => ({ slot, type: evidence, evidence })) };
  }
  const upper = /上衣|衬衫|T恤|卫衣|毛衣|针织衫|夹克|外套|背心|短打|袄|衫|shirt|jacket|sweater|top/iu.test(source);
  const lower = /下装|长裤|短裤|裤装|半裙|裙摆|下裙|牛仔裤|trousers|pants|shorts|skirt/iu.test(source);
  if (upper || lower) return {
    mode: 'top_bottom',
    items: [upper ? { slot: 'upper', type: source, evidence: source } : null, lower ? { slot: 'lower', type: source, evidence: source } : null].filter(Boolean),
  };
  return { mode: '', items: [] };
}

function explicitNoAccessories(text = '') {
  return /(?:无|不佩戴|不戴)(?:任何|全部|所有)?(?:配饰|首饰)|(?:no|without)\s+(?:any\s+)?accessor(?:y|ies)/iu.test(clean(text, 2000));
}

function positiveEvidenceText(text = '') {
  return clean(text, 2000).replace(
    /(?:不要|禁止|避免|不穿|不戴|不佩戴|do\s+not\s+wear|don't\s+wear|avoid)[^，。；,;\n]{0,60}/giu,
    '',
  );
}

function buildEvidenceContract(text = '', input = {}) {
  const source = clean(text, 2000);
  const positive = positiveEvidenceText(source);
  const selected = resolve(input, { limit: 2 });
  const garmentSystem = garmentEvidence(positive);
  const noAccessories = explicitNoAccessories(source);
  const footwearEvidence = matchingClauses(positive, EVIDENCE_PATTERNS.footwear, 2).join('；');
  const accessoryEvidence = matchingClauses(positive, EVIDENCE_PATTERNS.accessories, 8);
  const colourEvidence = matchingClauses(positive, EVIDENCE_PATTERNS.colour, 6);
  const materialEvidence = matchingClauses(positive, EVIDENCE_PATTERNS.material, 8);
  const look = input.look || {};
  const profile = input.profile || {};
  const hairMakeupText = clean(look.hairMakeupText || profile.hairMakeupText || '', 800);
  return {
    schema_version: 1,
    style_family: selected.families[0]?.id || 'task_defined',
    garment_system: garmentSystem,
    footwear: footwearEvidence ? { type: footwearEvidence, evidence: footwearEvidence } : {},
    accessories: noAccessories
      ? { mode: 'none', items: [], evidence: source }
      : (accessoryEvidence.length ? { mode: 'specified', items: accessoryEvidence.map(value => ({ type: value, evidence: value })), evidence: accessoryEvidence.join('；') } : {}),
    palette: colourEvidence.length ? { colors: colourEvidence, evidence: colourEvidence.join('；') } : {},
    materials: materialEvidence.map(value => ({ name: value, evidence: value })),
    hair_makeup: hairMakeupText ? {
      description: hairMakeupText,
      evidence: hairMakeupText,
      source: 'user_or_planner_profile',
    } : {},
    knowledge_doc_ids: selected.knowledge_doc_ids,
    evidence_source: 'deterministic_text_projection',
  };
}

function normalizeContract(raw = {}, text = '', input = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return buildEvidenceContract(text, input);
  const garment = raw.garment_system || raw.garmentSystem || {};
  const accessories = raw.accessories || {};
  const palette = raw.palette || raw.colour || raw.color || {};
  const materials = Array.isArray(raw.materials) ? raw.materials : (raw.material ? [raw.material] : []);
  const look = input.look || {};
  const profile = input.profile || {};
  const fallbackHairMakeup = clean(look.hairMakeupText || profile.hairMakeupText || '', 800);
  const rawHairMakeup = raw.hair_makeup || raw.hairMakeup || {};
  const hairMakeup = typeof rawHairMakeup === 'string'
    ? { description: clean(rawHairMakeup, 800), evidence: clean(rawHairMakeup, 800) }
    : {
      description: clean(rawHairMakeup.description || rawHairMakeup.summary || fallbackHairMakeup, 800),
      hairstyle: clean(rawHairMakeup.hairstyle || rawHairMakeup.hair_style || '', 240),
      hair_accessories: uniq(rawHairMakeup.hair_accessories || rawHairMakeup.hairAccessories || [], 12),
      makeup: clean(rawHairMakeup.makeup || rawHairMakeup.makeup_style || '', 240),
      evidence: clean(rawHairMakeup.evidence || rawHairMakeup.description || fallbackHairMakeup, 800),
      source: clean(rawHairMakeup.source || (fallbackHairMakeup ? 'user_or_planner_profile' : ''), 80),
    };
  return {
    schema_version: 1,
    style_family: clean(raw.style_family || raw.styleFamily || 'task_defined', 80),
    era_label: clean(raw.era_label || raw.eraLabel || '', 120),
    garment_system: {
      mode: clean(garment.mode || garment.type || '', 40),
      items: (Array.isArray(garment.items) ? garment.items : []).slice(0, 12).map(item => ({
        slot: clean(item?.slot || item?.position || 'ensemble', 40),
        type: clean(item?.type || item?.name || item?.description || '', 240),
        evidence: clean(item?.evidence || item?.description || item?.type || item?.name || '', 360),
      })).filter(item => item.type),
    },
    footwear: {
      type: clean(raw.footwear?.type || raw.footwear?.name || raw.footwear?.description || '', 240),
      color: clean(raw.footwear?.color || raw.footwear?.colour || '', 120),
      material: clean(raw.footwear?.material || '', 120),
      evidence: clean(raw.footwear?.evidence || raw.footwear?.description || raw.footwear?.type || '', 360),
    },
    accessories: {
      mode: clean(accessories.mode || (accessories.none === true ? 'none' : ''), 40),
      items: (Array.isArray(accessories.items) ? accessories.items : []).slice(0, 16).map(item => ({
        type: clean(item?.type || item?.name || item?.description || '', 200),
        position: clean(item?.position || item?.wear_position || '', 120),
        material: clean(item?.material || '', 120),
        evidence: clean(item?.evidence || item?.description || item?.type || item?.name || '', 300),
      })).filter(item => item.type),
      evidence: clean(accessories.evidence || '', 360),
    },
    palette: {
      colors: uniq(Array.isArray(palette.colors) ? palette.colors : [palette.primary, palette.secondary, palette.accent], 12),
      evidence: clean(palette.evidence || '', 360),
    },
    materials: materials.slice(0, 16).map(item => typeof item === 'string'
      ? { name: clean(item, 160), evidence: clean(item, 240) }
      : { name: clean(item?.name || item?.type || '', 160), used_for: clean(item?.used_for || item?.usedFor || '', 160), evidence: clean(item?.evidence || item?.name || item?.type || '', 300) }).filter(item => item.name),
    hair_makeup: hairMakeup,
    negative_constraints: uniq(raw.negative_constraints || raw.negativeConstraints || [], 20),
    knowledge_doc_ids: uniq([...(raw.knowledge_doc_ids || raw.knowledgeDocIds || []), ...resolve(input, { limit: 2 }).knowledge_doc_ids], 12),
    evidence_source: clean(raw.evidence_source || raw.evidenceSource || 'model_structured_contract', 80),
  };
}

function contractSemanticValues(contract = {}) {
  const garmentValues = (contract.garment_system?.items || []).map(item => item?.type);
  const accessoryValues = (contract.accessories?.items || []).map(item => item?.type);
  return [
    ...garmentValues,
    contract.footwear?.type,
    ...accessoryValues,
    ...(contract.palette?.colors || []),
    ...(contract.materials || []).map(item => item?.name),
  ].map(value => clean(value, 500)).filter(Boolean);
}

function hasCrossFieldSentenceReuse(contract = {}) {
  const counts = new Map();
  contractSemanticValues(contract).forEach(value => {
    if (value.length < 48) return;
    const normalized = value.replace(/[，。；、,;\s]/g, '').toLowerCase();
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  });
  return [...counts.values()].some(count => count >= 3);
}

function missingComponents(contract = {}) {
  const missing = [];
  const garment = contract.garment_system || {};
  const items = Array.isArray(garment.items) ? garment.items : [];
  if (!clean(garment.mode, 40) || !items.some(item => clean(item?.type || '', 240))) missing.push('garment');
  if (garment.mode === 'top_bottom') {
    const slots = new Set(items.map(item => clean(item?.slot || '', 40)));
    if (!slots.has('upper') || !slots.has('lower')) missing.push('lower');
  }
  if (!clean(contract.footwear?.type || '', 240)) missing.push('shoes');
  const accessoryMode = clean(contract.accessories?.mode || '', 40);
  if (accessoryMode !== 'none' && !(accessoryMode === 'specified' && contract.accessories?.items?.length)) missing.push('accessories');
  if (!Array.isArray(contract.palette?.colors) || !contract.palette.colors.length) missing.push('colour');
  if (!Array.isArray(contract.materials) || !contract.materials.length) missing.push('material');
  if (hasCrossFieldSentenceReuse(contract)) missing.push('structured_inventory');
  return uniq(missing, 10);
}

function wardrobeMissingComponents(text = '', rawContract = null, input = {}) {
  const contract = rawContract && typeof rawContract === 'object'
    ? normalizeContract(rawContract, text, input)
    : buildEvidenceContract(text, input);
  return missingComponents(contract);
}

module.exports = {
  STYLE_KNOWLEDGE_VERSION,
  BASE_KNOWLEDGE_DOC_ID,
  STYLE_FAMILIES,
  EVIDENCE_PATTERNS,
  resolve,
  promptBlock,
  buildEvidenceContract,
  normalizeContract,
  hasCrossFieldSentenceReuse,
  missingComponents,
  wardrobeMissingComponents,
};
