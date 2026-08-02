const FRAME_MARKER = /(?:以下是)?逐帧(?:分析(?:及总结)?|说明)|(?:时间点\s*)?\d+(?:\.\d+)?\s*秒/iu;

const LABELS = [
  '产品或服务', '广告主体', '产品', '可见文字', '真实环境', '环境', '空间', '场景',
  '材质', '颜色', '色彩', '色调', '空间布局', '布局', '构图', '光线', '照明', '灯光',
  '人物动作', '人物', '动作', '景别', '机位', '运镜变化', '运镜',
  '动物是否出现', '动物动作', '动物', '宠物动作', '宠物',
  'animal_presence', 'animal_actions',
];

function clean(value = '', max = 1200) {
  return String(value || '')
    .replace(/```(?:json)?/giu, ' ')
    .replace(/\*\*/gu, '')
    .replace(/\\[nrt]/gu, ' ')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s#*•\-—:：;,，；。]+|[\s#*•\-—:：;,，；。]+$/gu, '')
    .trim()
    .slice(0, max);
}

function labelMatches(value = '') {
  const source = String(value || '').replace(/\*\*/gu, '');
  const pattern = new RegExp(`(?:^|[\\s\\-—•,{，,;；。])(${LABELS.join('|')})\\s*[:：]\\s*`, 'gu');
  return [...source.matchAll(pattern)].map(match => ({
    label: match[1],
    index: Number(match.index || 0),
    start: Number(match.index || 0) + match[0].length,
  }));
}

function field(value = '', labels = [], fallback = '') {
  const source = String(value || '').replace(/\*\*/gu, '');
  const matches = labelMatches(source);
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (!labels.includes(match.label)) continue;
    const nextLabel = matches[index + 1]?.index ?? source.length;
    const tail = source.slice(match.start, nextLabel);
    const nextFrame = /(?:^|[\s#*•\-—])(?:\d+\.\s*)?(?:时间点\s*)?\d+(?:\.\d+)?\s*秒/iu.exec(tail);
    const nextSummary = /(?:本组|画面|剧情)?总结\s*[:：]/u.exec(tail);
    const end = [tail.length, nextFrame?.index, nextSummary?.index]
      .filter(Number.isFinite)
      .reduce((minimum, current) => Math.min(minimum, current), tail.length);
    const candidate = clean(tail.slice(0, end), 500);
    if (candidate && !FRAME_MARKER.test(candidate)) return candidate;
  }
  return clean(fallback, 500);
}

function facts(value = '') {
  const animalDescription = field(value, ['动物是否出现', '动物', '宠物', 'animal_presence']);
  const animalAction = field(value, ['动物动作', '宠物动作', 'animal_actions']);
  const animalPresence = animalDescription
    ? !/^(?:false|无|没有|未出现|未见|不确定|无法确认|none|no)$/iu.test(clean(animalDescription, 80))
    : undefined;
  return {
    product: field(value, ['产品或服务', '广告主体', '产品']),
    visibleText: field(value, ['可见文字']),
    environment: field(value, ['真实环境', '环境', '空间', '场景']),
    materials: field(value, ['材质']),
    colors: field(value, ['颜色', '色彩', '色调']),
    layout: field(value, ['空间布局', '布局', '构图']),
    lighting: field(value, ['光线', '照明', '灯光']),
    action: field(value, ['人物动作', '动作', '人物']),
    animalPresence,
    animalDescription: animalPresence === true ? clean(animalDescription, 500) : '',
    animalAction: animalPresence === true ? clean(animalAction, 500) : '',
  };
}

const ENVIRONMENT_TERMS = /(?:住宅|建筑|客厅|卧室|室内|室外|环境|空间|场景|城市|街道|道路|展厅|办公室|厨房|庭院|阳台|山脉|天际线)/u;
const PRODUCT_TERMS = /(?:门|窗|幕墙|墙板|汽车|车辆|跑车|轿车|车型|手机|电脑|家电|家具|服装|鞋|食品|饮料|药品|服务|软件|设备|机器|工具|材料|品牌|型号)/u;

function environmentProductConflated(value = '') {
  const text = clean(value, 500);
  if (!text) return false;
  return ENVIRONMENT_TERMS.test(text)
    && /(?:配备|带有|安装|拥有|采用|背景|位于|建筑有|环境为)/u.test(text);
}

function visibleTextCandidates(values = []) {
  return unique((Array.isArray(values) ? values : [values]).flatMap(value => clean(value, 500)
    .replace(/[“”"'【】]/gu, '')
    .split(/[|｜、；;，,\n]+/u)
    .map(item => item.replace(/^(?:可见文字|字幕|品牌|型号)\s*[:：]\s*/u, '').trim())
    .filter(item => item.length >= 2 && item.length <= 80)));
}

function productCandidateScore(value = '', { position = 0, visibleText = false } = {}) {
  const text = clean(value, 500);
  if (!text) return Number.NEGATIVE_INFINITY;
  let score = Math.min(5, Math.max(0, Number(position) || 0));
  if (PRODUCT_TERMS.test(text)) score += 6;
  if (!visibleText) score += 9;
  if (visibleText) score += 8;
  if (/^[\p{Script=Han}A-Za-z0-9]{2,8}(?:门窗|科技|集团|品牌)$/u.test(text)) score -= 6;
  if (/(?:品牌|型号|系列|产品|广告主体)/u.test(text)) score += 2;
  if (ENVIRONMENT_TERMS.test(text)) score -= 4;
  if (environmentProductConflated(text)) score -= 12;
  if (text.length > 100) score -= 3;
  return score;
}

function chooseProductCandidate(candidates = [], visibleTexts = []) {
  const rows = (Array.isArray(candidates) ? candidates : [candidates])
    .map((candidate, index) => typeof candidate === 'object'
      ? { value: candidate.value, position: candidate.position ?? index, visibleText: candidate.visibleText === true }
      : { value: candidate, position: index, visibleText: false });
  visibleTextCandidates(visibleTexts).forEach((value, index, all) => {
    rows.push({ value, position: rows.length + index + all.length, visibleText: true });
  });
  return rows
    .map(row => ({ ...row, value: clean(row.value, 500), score: productCandidateScore(row.value, row) }))
    .filter(row => row.value)
    .sort((left, right) => right.score - left.score || right.position - left.position)[0]?.value || '';
}

function unique(values = [], maxItems = 16) {
  const seen = new Set();
  return values
    .map(item => clean(item, 500))
    .filter(Boolean)
    .filter(item => {
      const key = item.replace(/[\s，,；;。]+/gu, '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems);
}

function normalizeRange(value) {
  if (!Array.isArray(value) || value.length < 2) return [];
  const start = Number(value[0]);
  const end = Number(value[1]);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [start, end] : [];
}

function normalizeAnimalActions(input = []) {
  return (Array.isArray(input) ? input : []).slice(0, 48).map((item, index) => ({
    ...item,
    animal_id: clean(item?.animal_id || item?.animalId || `animal_${index + 1}`, 100),
    action: clean(item?.action || item?.key_action || '', 700),
    range: normalizeRange(item?.range || item?.time_range),
    scene_id: clean(item?.scene_id || item?.sceneId || '', 100),
  })).filter(item => item.action);
}

function normalizeAnimalPrompts(input = []) {
  return (Array.isArray(input) ? input : []).slice(0, 24).map((item, index) => ({
    ...item,
    id: clean(item?.id || item?.animal_id || `animal_${index + 1}`, 100),
    species: clean(item?.species || item?.type || '', 120),
    appearance_direction: clean(item?.appearance_direction || item?.appearance || '', 800),
    continuity_rules: clean(item?.continuity_rules || item?.continuity || '', 800),
  })).filter(item => item.species || item.appearance_direction);
}

function normalizeShotBreakdown(input = []) {
  return (Array.isArray(input) ? input : []).slice(0, 120).map((item, index) => {
    const range = normalizeRange(item?.range || item?.time_range);
    const duration = Number(item?.duration_seconds);
    return {
      ...item,
      order: Math.max(1, Number(item?.order) || index + 1),
      range,
      visual: clean(item?.visual || item?.visual_description || '', 1000),
      action: clean(item?.action || item?.action_description || '', 800),
      scene_id: clean(item?.scene_id || item?.sceneId || '', 100),
      subject_ids: unique(Array.isArray(item?.subject_ids) ? item.subject_ids : [], 24),
      shot_size: clean(item?.shot_size || '', 80),
      angle: clean(item?.angle || '', 80),
      movement: clean(item?.movement || '', 120),
      duration_seconds: Number.isFinite(duration) && duration >= 0
        ? duration
        : (range.length === 2 ? Number((range[1] - range[0]).toFixed(3)) : 0),
    };
  }).filter(item => item.visual || item.action);
}

function summary(input = {}, fallback = '') {
  const row = typeof input === 'string' ? facts(input) : (input || {});
  const parts = [
    row.product ? `广告主体：${row.product}` : '',
    row.environment ? `环境：${row.environment}` : '',
    row.materials ? `材质：${row.materials}` : '',
    row.colors ? `色彩：${row.colors}` : '',
    row.layout ? `布局：${row.layout}` : '',
    row.lighting ? `光线：${row.lighting}` : '',
    row.action ? `动作：${row.action}` : '',
  ].filter(Boolean);
  return clean(parts.join('；') || fallback, 900);
}

function kindValue(value = '', kind = 'summary', fallback = '') {
  const source = clean(value, 5000);
  if (!FRAME_MARKER.test(source) && !labelMatches(value).length) return clean(source || fallback, 1000);
  const row = facts(value);
  if (kind === 'product') return row.product || clean(fallback, 500);
  if (kind === 'environment') return row.environment || clean(fallback, 500);
  if (kind === 'material') {
    return clean([
      row.materials ? `材质：${row.materials}` : '',
      row.colors ? `色彩：${row.colors}` : '',
      row.lighting ? `光线：${row.lighting}` : '',
    ].filter(Boolean).join('；') || fallback, 800);
  }
  if (kind === 'interaction') return row.action || clean(fallback, 500);
  if (kind === 'layout') {
    return clean([
      row.environment ? `环境：${row.environment}` : '',
      row.layout ? `布局：${row.layout}` : '',
      row.product ? `广告主体：${row.product}` : '',
    ].filter(Boolean).join('；') || fallback, 800);
  }
  return summary(row, fallback);
}

function chronologyPrefix(value = '') {
  const source = String(value || '');
  return clean(source.match(/^\s*((?:\d+(?:\.\d+)?\s*[—–~-]\s*)?\d+(?:\.\d+)?\s*秒)/u)?.[1] || '', 80);
}

function chronologyItem(value = '', fallback = '') {
  const source = String(value || '');
  const prefix = chronologyPrefix(source);
  const concise = kindValue(source, 'summary', fallback);
  return clean([prefix, concise].filter(Boolean).join('：'), 900);
}

function buildBrief(analysis = {}) {
  const factsRow = analysis.source_facts || {};
  const outline = analysis.story_outline || {};
  const characters = Array.isArray(analysis.character_prompts) ? analysis.character_prompts : [];
  const animals = Array.isArray(analysis.animal_prompts) ? analysis.animal_prompts : [];
  const scenes = Array.isArray(analysis.scene_prompts) ? analysis.scene_prompts : [];
  const characterText = characters.length
    ? characters.map((item, index) => [
      `${index + 1}. ${clean(item.role || item.name || `人物 ${index + 1}`, 100)}`,
      clean(item.narrative_function || item.appearance_direction || '', 240),
    ].filter(Boolean).join('；')).join('；')
    : (factsRow.human_presence === false ? '不需要人物出镜。' : '人物按剧情需要设置原创外观与服装。');
  const sceneText = scenes.length
    ? scenes.map((item, index) => `${index + 1}. ${clean(item.location_type || `场景 ${index + 1}`, 120)}；${clean(item.layout_prompt || '', 360)}`).join('；')
    : clean(factsRow.environment || factsRow.layout || '', 500);
  const narrativeAnimalPresence = typeof factsRow.narrative_animal_presence === 'boolean'
    ? factsRow.narrative_animal_presence
    : factsRow.animal_presence === true;
  const ambientAnimalText = !narrativeAnimalPresence && Array.isArray(factsRow.ambient_animals) && factsRow.ambient_animals.length
    ? `画面包含环境动物（${factsRow.ambient_animals.map(item => clean(item, 120)).join('、')}），仅作为场景元素，不创建宠物/动物角色资产。`
    : '';
  const animalText = narrativeAnimalPresence
    ? (animals.length
      ? animals.map((item, index) => `${index + 1}. ${clean(item.species || `动物 ${index + 1}`, 120)}；${clean(item.appearance_direction || '', 360)}；${clean(item.continuity_rules || '', 360)}`).join('；')
      : '画面明确存在动物，但缺少可用动物提示词，必须重新识别，不得猜测物种或外观。')
    : (ambientAnimalText || '参考证据未确认叙事动物角色，不得自行添加宠物/动物资产。');
  return [
    `【参考内容事实】广告主体：${clean(factsRow.product_or_service || '待确认主体', 240)}；实际空间：${clean(factsRow.environment || '待确认空间', 500)}；材质与光线：${clean([...(factsRow.materials || []), factsRow.lighting].filter(Boolean).join('、'), 600)}`,
    `【完整剧情】${clean(outline.logline || analysis.summary || '按参考内容的真实事件顺序组织开场、发展和结尾。', 700)}`,
    `【人物提示词】${characterText}`,
    `【动物提示词】${animalText}`,
    `【场景提示词】${sceneText}`,
  ].join('\n').slice(0, 3800);
}

function sanitizeAnalysis(input = {}) {
  if (!input || typeof input !== 'object') return input;
  const source = { ...input };
  const prompts = Array.isArray(source.scene_prompts) ? source.scene_prompts : [];
  const parsedPrompts = prompts.map(item => {
    const layoutFacts = facts(item?.layout_prompt || '');
    const materialFacts = facts(item?.material_light_prompt || '');
    const interactionFacts = facts(item?.interaction_prompt ? `动作：${item.interaction_prompt}` : '');
    return {
      product: layoutFacts.product || materialFacts.product,
      environment: layoutFacts.environment || materialFacts.environment,
      materials: materialFacts.materials || layoutFacts.materials,
      colors: materialFacts.colors || layoutFacts.colors,
      layout: layoutFacts.layout,
      lighting: materialFacts.lighting || layoutFacts.lighting,
      action: interactionFacts.action || layoutFacts.action,
    };
  });
  const existing = source.source_facts && typeof source.source_facts === 'object' ? source.source_facts : {};
  const existingFact = (value, key, aliases) => {
    const parsed = facts(value || '');
    return parsed[key] || field(value, aliases) || clean(value, 500)
      .replace(new RegExp(`^(?:${aliases.join('|')})\\s*[:：]\\s*`, 'u'), '');
  };
  const first = (key, fallback = '', aliases = []) => parsedPrompts.map(item => item[key]).find(Boolean)
    || existingFact(fallback, key, aliases);
  const product = chooseProductCandidate([
    { value: existingFact(existing.product_or_service, 'product', ['产品或服务', '广告主体', '产品']), position: parsedPrompts.length + 1 },
    ...parsedPrompts.map((item, index) => ({ value: item.product, position: index })),
  ], existing.visible_text);
  const environment = first('environment', existing.environment, ['真实环境', '环境', '空间', '场景']);
  const promptMaterials = unique(parsedPrompts.map(item => item.materials));
  const materials = promptMaterials.length ? promptMaterials : unique(
    (Array.isArray(existing.materials) ? existing.materials : [existing.materials])
      .map(item => existingFact(item, 'materials', ['材质'])),
  );
  const promptColors = unique(parsedPrompts.map(item => item.colors));
  const colors = promptColors.length ? promptColors : unique(
    (Array.isArray(existing.colors) ? existing.colors : [existing.colors])
      .map(item => existingFact(item, 'colors', ['颜色', '色彩', '色调'])),
  );
  const layout = first('layout', existing.layout, ['空间布局', '布局', '构图']);
  const lighting = first('lighting', existing.lighting, ['光线', '照明', '灯光']);
  const promptActions = unique(parsedPrompts.map(item => item.action));
  const humanActions = promptActions.length ? promptActions : unique(
    (Array.isArray(existing.human_actions) ? existing.human_actions : [existing.human_actions])
      .map(item => existingFact(item, 'action', ['人物动作', '动作', '人物'])),
  );
  const sourceFacts = {
    ...existing,
    product_or_service: product,
    environment,
    materials,
    colors,
    layout,
    lighting,
    human_actions: humanActions,
  };
  const explicitAnimalPresence = typeof existing.animal_presence === 'boolean'
    ? existing.animal_presence
    : undefined;
  if (typeof explicitAnimalPresence === 'boolean') {
    sourceFacts.animal_presence = explicitAnimalPresence;
    const narrativeAnimalPresence = typeof existing.narrative_animal_presence === 'boolean'
      ? existing.narrative_animal_presence
      : explicitAnimalPresence;
    sourceFacts.narrative_animal_presence = narrativeAnimalPresence;
    sourceFacts.animal_actions = narrativeAnimalPresence
      ? unique(Array.isArray(existing.animal_actions) ? existing.animal_actions : [])
      : [];
  }
  const priorChronology = Array.isArray(existing.chronological_story) ? existing.chronological_story : [];
  sourceFacts.chronological_story = (priorChronology.length > parsedPrompts.length
    ? priorChronology.map((item, index) => chronologyItem(
        item,
        index ? '推进产品细节与使用情境' : '建立产品与空间关系',
      ))
    : parsedPrompts.length
    ? parsedPrompts.map((row, index) => clean([
        chronologyPrefix(priorChronology[index] || ''),
        summary(row, index ? '推进产品细节与使用情境' : '建立产品与空间关系'),
      ].filter(Boolean).join('：'), 900))
    : priorChronology.map((item, index) => chronologyItem(
        item,
        index ? '推进产品细节与使用情境' : '建立产品与空间关系',
      )))
    .filter(Boolean);

  const scenePrompts = prompts.map((item, index) => {
    const row = parsedPrompts[index] || {};
    const explicitLocation = kindValue(item?.location_type, 'environment', '');
    return {
      ...item,
      id: clean(item?.id || `scene_prompt_${index + 1}`, 100),
      // location_type 是场景自身的权威名称；布局中的“环境”可能只是全片概述，不能反向覆盖每个独立空间。
      location_type: clean(explicitLocation || row.environment || environment, 500),
      layout_prompt: clean([
        row.environment || environment ? `环境：${row.environment || environment}` : '',
        row.layout || layout ? `布局：${row.layout || layout}` : '',
        row.product || product ? `广告主体：${row.product || product}` : '',
      ].filter(Boolean).join('；'), 700),
      material_light_prompt: clean([
        row.materials || materials[0] ? `材质：${row.materials || materials[0]}` : '',
        row.colors || colors[0] ? `色彩：${row.colors || colors[0]}` : '',
        row.lighting || lighting ? `光线：${row.lighting || lighting}` : '',
      ].filter(Boolean).join('；'), 700),
      interaction_prompt: clean(row.action || kindValue(item?.interaction_prompt, 'interaction', humanActions[index] || ''), 500),
    };
  });
  const chronology = sourceFacts.chronological_story;
  const storyOutline = { ...(source.story_outline || {}) };
  const remapChronology = value => {
    const index = priorChronology.findIndex(item => clean(item, 1200) === clean(value, 1200));
    return index >= 0 ? (chronology[index] || clean(value, 700)) : clean(value, 700);
  };
  if (FRAME_MARKER.test(JSON.stringify(storyOutline))) {
    storyOutline.logline = `通过${environment || '真实空间'}中的连续展示，让观众理解${product || '广告主体'}的核心价值与使用结果。`;
    storyOutline.opening = chronology[0] || `建立${product || '广告主体'}与${environment || '真实空间'}的关系。`;
    storyOutline.development = `发展阶段：${(chronology.length > 2 ? chronology.slice(1, -1) : chronology.slice(1)).join('；')
      || '推进产品细节与使用情境。'}`;
    storyOutline.turning_point = sourceFacts.human_presence === false
      ? '画面从整体关系推进到产品细节和结果证明。'
      : `人物与${product || '广告主体'}发生功能性互动，产品价值从外观展示转为可感知体验。`;
    storyOutline.resolution = chronology[chronology.length - 1] || '完成产品信息收束与行动引导。';
  } else if (priorChronology.length && chronology.length) {
    storyOutline.opening = remapChronology(storyOutline.opening || '');
    storyOutline.development = remapChronology(storyOutline.development || '');
    storyOutline.resolution = remapChronology(storyOutline.resolution || '');
  }
  const plotBeats = (Array.isArray(source.plot_beats) ? source.plot_beats : []).map((item, index) => ({
    ...item,
    purpose: FRAME_MARKER.test(String(item?.purpose || ''))
      ? (index ? '推进产品细节、使用情境与结尾信息' : `建立${product || '广告主体'}与${environment || '真实空间'}的真实关系`)
      : clean(item?.purpose || '', 300),
    evidence_summary: kindValue(item?.evidence_summary || '', 'summary', summary(parsedPrompts[index] || {})),
  }));
  const cameraIntents = (Array.isArray(source.camera_intents) ? source.camera_intents : []).map(item => ({
    ...item,
    movement_subject: kindValue(item?.movement_subject || '', 'product', product),
  }));
  const characterActions = (Array.isArray(source.character_actions) ? source.character_actions : []).map((item, index) => ({
    ...item,
    key_action: kindValue(item?.key_action || '', 'interaction', humanActions[index] || '围绕广告主体完成可见的功能性互动'),
    prop_contact: kindValue(item?.prop_contact || '', 'product', product),
  }));
  const promptSuggestions = (Array.isArray(source.prompt_suggestions) ? source.prompt_suggestions : [])
    .map((item, index) => FRAME_MARKER.test(String(item || ''))
      ? (index === 0
        ? `严格保留${product || '广告主体'}、${environment || '真实空间'}与真实材质关系。`
        : '按参考证据的时间顺序组织剧情，不复制真人身份、服装或品牌水印。')
      : clean(item, 500));
  const output = {
    ...source,
    source_facts: sourceFacts,
    story_outline: storyOutline,
    plot_beats: plotBeats,
    scene_prompts: scenePrompts,
    camera_intents: cameraIntents,
    character_actions: characterActions,
    prompt_suggestions: unique(promptSuggestions),
    animal_actions: sourceFacts.narrative_animal_presence === false ? [] : normalizeAnimalActions(source.animal_actions),
    animal_prompts: sourceFacts.narrative_animal_presence === false ? [] : normalizeAnimalPrompts(source.animal_prompts),
    shot_breakdown: normalizeShotBreakdown(source.shot_breakdown),
  };
  output.generated_brief = FRAME_MARKER.test(String(source.generated_brief || ''))
    ? buildBrief(output)
    : String(source.generated_brief || '');
  return output;
}

module.exports = {
  FRAME_MARKER,
  LABELS,
  clean,
  field,
  facts,
  environmentProductConflated,
  visibleTextCandidates,
  productCandidateScore,
  chooseProductCandidate,
  summary,
  kindValue,
  chronologyPrefix,
  chronologyItem,
  normalizeRange,
  normalizeAnimalActions,
  normalizeAnimalPrompts,
  normalizeShotBreakdown,
  buildBrief,
  sanitizeAnalysis,
};
