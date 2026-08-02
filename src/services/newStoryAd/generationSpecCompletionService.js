const crypto = require('crypto');
const modelGatewayDefault = require('./modelGateway');
const jsonRepairDefault = require('./jsonRepairService');
const storageDefault = require('./storageService');
const subjectProfileText = require('./subjectProfileTextService');
const { cleanText } = require('./contextBuilder');

const WARDROBE_COMPONENTS = {
  garment: /上衣|衬衫|外套|夹克|针织|T恤|西装|套装|连衣裙|裙装|旗袍|长袍|制服|背心|卫衣|毛衣|dress|shirt|jacket|suit|uniform/i,
  lower: /下装|长裤|短裤|裤装|半裙|裙摆|连衣裙|裙装|旗袍|长袍|套装|trousers|pants|shorts|skirt|dress/i,
  shoes: /鞋|靴|凉鞋|高跟|运动鞋|皮鞋|赤脚|光脚|shoes?|sneakers?|boots?|heels?|sandals?|barefoot/i,
  accessories: /配饰|首饰|耳环|耳饰|耳钉|耳坠|项链|颈链|吊坠|胸针|手表|腕表|手链|手镯|戒指|眼镜|发饰|帽|领带|丝巾|无配饰|不佩戴|不戴|accessor|earring|necklace|watch|bracelet|ring|glasses|hat|tie|scarf/i,
  colour: /颜色|色调|配色|白色|黑色|灰色|米色|象牙|蓝色|绿色|红色|粉色|紫色|黄色|棕色|金色|银色|藏青|卡其|color|colour|white|black|blue|green|red|pink|purple|brown|navy|khaki/i,
  material: /材质|面料|棉|麻|羊毛|丝绸|真丝|皮革|牛仔|针织|雪纺|缎|丝|金属|珍珠|宝石|绒|纱|cotton|linen|wool|silk|leather|denim|knit|chiffon|satin|metal|pearl/i,
};

const SCENE_TEXT_COMPONENTS = {
  layoutText: [
    /布局|空间|区域|主体|展示区|前景|背景|入口|出口|通道|动线|边界|位置/u,
    /前景|背景|入口|出口|通道|动线|边界|相对|左侧|右侧|中央|纵深/u,
  ],
  materialLightText: [
    /材质|材料|木|金属|玻璃|石|织物|混凝土|涂料|瓷砖|皮革/u,
    /颜色|色调|配色|白|黑|灰|米|蓝|绿|红|棕|金|银/u,
    /光|照明|灯|窗|阴影|反射|色温|亮度/u,
    /纹理|粗糙|光泽|尺度|磨损|划痕|颗粒|肌理/u,
  ],
  interactionText: [
    /人物|商品|主体|动作|互动|展示|拿取|操作|接触/u,
    /路线|动线|移动|进入|离开|起点|终点|通行/u,
    /机位|镜头|拍摄|近景|远景|特写|焦点/u,
  ],
  negativeText: [/(?:不要|禁止|避免|不得|不能|无关|水印|文字|变形|漂移)/u],
};

function fingerprint(value = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function appendAuthorityText(original = '', supplement = '', max = 1200) {
  const first = cleanText(original, max);
  const second = cleanText(supplement, max);
  if (!first) return second;
  if (!second || first.includes(second)) return first;
  return cleanText(`${first}；AI补齐：${second}`, max);
}

function wardrobeMissingComponents(value = '') {
  const source = cleanText(value, 1600);
  const explicitNoAccessories = /(?:无|不佩戴|不戴)(?:任何|全部|所有)?(?:配饰|首饰)|(?:no|without)\s+(?:any\s+)?accessor(?:y|ies)/iu.test(source);
  const positiveSource = source.replace(
    /(?:不要|禁止|避免|不穿|不戴|不佩戴|do\s+not\s+wear|don't\s+wear|avoid)[^，。；,;\n]{0,40}/giu,
    '',
  );
  return Object.entries(WARDROBE_COMPONENTS)
    .filter(([key, pattern]) => {
      if (key === 'accessories' && explicitNoAccessories) return false;
      return !pattern.test(positiveSource);
    })
    .map(([key]) => key);
}

function sceneText(source = {}, key = '') {
  const aliases = {
    layoutText: ['layoutText', 'layout_text', 'layout', 'description'],
    materialLightText: ['materialLightText', 'material_light_text', 'materialLight', 'material', 'light'],
    interactionText: ['interactionText', 'interaction_text', 'interaction', 'camera'],
    negativeText: ['negativeText', 'negative_text', 'negative'],
  };
  return cleanText((aliases[key] || [key]).map(name => source?.[name]).find(Boolean) || '', 1600);
}

function sceneTextComplete(key, value = '') {
  const source = cleanText(value, 1600);
  const minimum = key === 'interactionText' || key === 'negativeText' ? 24 : 30;
  if (source.length < minimum) return false;
  return (SCENE_TEXT_COMPONENTS[key] || []).every(pattern => pattern.test(source));
}

function sceneMissingComponents(spec = {}) {
  const missing = Object.keys(SCENE_TEXT_COMPONENTS)
    .filter(key => !sceneTextComplete(key, sceneText(spec, key)));
  const structured = {
    storyStates: spec.storyStates || spec.story_states || spec.stateTimeline || spec.state_timeline,
    interactionAnchors: spec.interactionAnchors || spec.interaction_anchors,
    routes: spec.routes || spec.movement_routes,
  };
  Object.entries(structured).forEach(([key, value]) => {
    if (!Array.isArray(value) || !value.length) missing.push(key);
  });
  return missing;
}

function defaultPersonSupplement(profile = {}, missing = wardrobeMissingComponents(profile.wardrobeText)) {
  const role = cleanText(profile.roleName || '广告人物', 80);
  const rows = [];
  if (missing.includes('garment')) rows.push(`${role}采用藏青色棉麻上衣`);
  if (missing.includes('lower')) rows.push('搭配米白色直筒长裤');
  if (missing.includes('colour')) rows.push('整体使用藏青色与米白色的克制商业配色');
  if (missing.includes('material')) rows.push('服装使用真实可辨的棉麻面料与自然剪裁');
  if (missing.includes('shoes')) rows.push('穿棕色皮革低跟鞋');
  if (missing.includes('accessories')) rows.push('佩戴一对小型银色耳钉，固定在双耳并保持佩戴位置一致');
  return rows.join('；');
}

function defaultSceneSupplement(name = '当前场景') {
  return {
    layoutText: `${name}明确主体展示区、前景、背景、入口、出口、连续通道和完整空间边界，各区域保持可拍摄的真实相对位置与纵深关系`,
    materialLightText: `${name}使用与广告主体匹配的真实材料、统一商业配色和可辨尺度纹理，主光方向、环境光、阴影、反射、粗糙度及轻微使用痕迹保持物理一致`,
    interactionText: '明确人物或商品的起点、移动路线、互动位置、终点、主机位、反向机位和细节特写焦点，保证动作与镜头方向连续',
    negativeText: '禁止无关人物和物件；禁止文字、水印、Logo、结构变形、材质漂移、光向矛盾和不可到达的互动路线',
    storyStates: [{ id: 'state_1', label: '主要展示状态', state_before: ['主体进入前空间与物件位置固定'], visible_change: ['主体沿指定路线完成展示或互动'], state_after: ['离开镜头时保留已发生的物件状态'], shot_refs: [] }],
    interactionAnchors: [{ id: 'anchor_1', label: '主要互动点', purpose: '完成人物与商品或展示主体的核心互动', contact_rules: ['手部、视线、商品朝向和接触位置连续'] }],
    routes: [{ id: 'route_1', label: '主要拍摄行动路线', from: '入口或画面外起点', to: '核心展示位', actor: '主要人物或展示主体', continuity: '保持运动方向、视线和物件状态连续' }],
  };
}

async function parsedModelJson({ taskId, systemPrompt, userPrompt, maxTokens = 3600 } = {}, deps = {}) {
  const gateway = deps.modelGateway || modelGatewayDefault;
  const repair = deps.jsonRepair || jsonRepairDefault;
  const result = await gateway.generateText({
    taskId,
    stage: 'new_story_ad.assist',
    systemPrompt,
    userPrompt,
    maxTokens,
    temperature: 0.15,
  });
  const parsed = await repair.parseOrRepair({
    raw: result.text,
    expected: 'object',
    modelGateway: gateway,
    taskId,
    stage: 'new_story_ad.json_repair',
  });
  return { parsed, modelResult: result };
}

async function completePersonProfiles(options = {}, deps = {}) {
  const taskId = cleanText(options.taskId || '', 120);
  const brief = cleanText(options.brief || '', 5000);
  const storage = deps.storage || storageDefault;
  const sourceProfiles = (Array.isArray(options.castProfiles) ? options.castProfiles : [])
    .map(profile => subjectProfileText.canonicalProfile(profile || {}, { age: profile?.age || '' }));
  const targets = sourceProfiles.map((profile, index) => ({
    id: cleanText(profile.id || `cast_${index + 1}`, 80),
    index,
    profile,
    missing: wardrobeMissingComponents(profile.wardrobeText),
  })).filter(item => item.missing.length);
  if (!targets.length) return { cast_profiles: sourceProfiles, changed: false, model_call_count: 0, checkpoint_kind: '' };
  const input = {
    version: 1,
    brief,
    targets: targets.map(item => ({ id: item.id, index: item.index, role: item.profile.roleName, wardrobe: item.profile.wardrobeText, missing: item.missing })),
  };
  const checkpointKind = `generation_spec_completion:person:${fingerprint(input)}`;
  const cached = taskId && typeof storage.getOutput === 'function' ? storage.getOutput(taskId, checkpointKind) : null;
  if (cached?.status === 'complete' && Array.isArray(cached.cast_profiles)) {
    return { cast_profiles: cached.cast_profiles, changed: true, model_call_count: 0, checkpoint_kind: checkpointKind, reused: true };
  }
  let rows;
  let usedModel = '';
  if ((process.env.NEW_STORY_AD_MOCK_LLM === '1' || process.env.NEW_STORY_AD_MOCK_IMAGE === '1' || deps.deterministic === true)
    && deps.forceModel !== true) {
    rows = targets.map(item => ({ id: item.id, index: item.index, wardrobe_supplement: defaultPersonSupplement(item.profile, item.missing) }));
    usedModel = 'deterministic-test-completion';
  } else {
    const response = await parsedModelJson({
      taskId,
      systemPrompt: [
        '你是商用影视人物造型合同补齐器，只输出 JSON。',
        '用户原文是最高权威：不得改写、删减、替换或反转用户已经指定的服装、鞋履、饰品、颜色、材质和禁止项。',
        '每个人物只补 missing 中缺少的类别。补齐后必须形成上装+下装或完整连衣裙、鞋履、明确的配饰方案（可依据角色明确为无配饰）、配色和面料。',
        '配饰要给出具体类型、材质与佩戴位置；鞋履要给出类型、颜色与材质。不得使用“合适的、根据场景、适量”等空泛词。',
        '不同人物不得复制同一套造型。不得新增品牌、价格、功效、制服身份或宗教文化符号。',
        '输出：{"completions":[{"id":"人物ID","index":0,"wardrobe_supplement":"仅缺失项的具体中文补充"}]}',
      ].join('\n'),
      userPrompt: JSON.stringify(input),
    }, deps);
    rows = Array.isArray(response.parsed.completions) ? response.parsed.completions : [];
    usedModel = response.modelResult.used_model || '';
  }
  const completed = sourceProfiles.map((profile, index) => {
    const id = cleanText(profile.id || `cast_${index + 1}`, 80);
    const target = targets.find(item => item.index === index);
    if (!target) return profile;
    const row = rows.find(item => cleanText(item?.id || '', 80) === id)
      || rows.find(item => Number(item?.index) === index)
      || {};
    const supplement = cleanText(row.wardrobe_supplement || row.wardrobeSupplement || '', 900);
    const resolved = appendAuthorityText(profile.wardrobeText, supplement, 1200);
    const stillMissing = wardrobeMissingComponents(resolved);
    if (stillMissing.length) {
      const error = new Error(`人物“${profile.displayName || id}”造型自动补齐不完整：${stillMissing.join(', ')}`);
      error.code = 'PERSON_WARDROBE_AUTO_COMPLETION_INCOMPLETE';
      error.status = 502;
      error.missing_components = stillMissing;
      throw error;
    }
    return {
      ...profile,
      wardrobeText: resolved,
      wardrobe: { ...(profile.wardrobe && typeof profile.wardrobe === 'object' ? profile.wardrobe : {}), userPrompt: resolved },
      outfit: resolved,
      wardrobe_completion: {
        schema_version: 1,
        user_text: cleanText(profile.wardrobeText || '', 900),
        ai_supplement: supplement,
        resolved_text: resolved,
        completed_components: target.missing,
        source: 'generation_preflight_ai_completion',
        used_model: usedModel,
      },
    };
  });
  if (taskId && typeof storage.saveOutput === 'function') {
    storage.saveOutput(taskId, checkpointKind, { status: 'complete', cast_profiles: completed, used_model: usedModel, created_at: new Date().toISOString() });
  }
  return { cast_profiles: completed, changed: true, model_call_count: usedModel === 'deterministic-test-completion' ? 0 : 1, checkpoint_kind: checkpointKind, reused: false };
}

async function completeSceneSpec(options = {}, deps = {}) {
  const taskId = cleanText(options.taskId || '', 120);
  const storage = deps.storage || storageDefault;
  const spec = options.sceneSpec && typeof options.sceneSpec === 'object' ? options.sceneSpec : {};
  const missing = sceneMissingComponents(spec);
  if (!missing.length) return { scene_spec: spec, changed: false, model_call_count: 0, checkpoint_kind: '' };
  const input = {
    version: 1,
    brief: cleanText(options.brief || '', 5000),
    product_subject: cleanText(options.productSubject || '', 500),
    scene_id: cleanText(options.sceneId || '', 120),
    scene_name: cleanText(options.sceneName || '', 160),
    user_scene_spec: spec,
    missing,
  };
  const checkpointKind = `generation_spec_completion:scene:${fingerprint(input)}`;
  const cached = taskId && typeof storage.getOutput === 'function' ? storage.getOutput(taskId, checkpointKind) : null;
  if (cached?.status === 'complete' && cached.scene_spec) {
    return { scene_spec: cached.scene_spec, changed: true, model_call_count: 0, checkpoint_kind: checkpointKind, reused: true };
  }
  let supplement;
  let usedModel = '';
  if ((process.env.NEW_STORY_AD_MOCK_LLM === '1' || process.env.NEW_STORY_AD_MOCK_IMAGE === '1' || deps.deterministic === true)
    && deps.forceModel !== true) {
    supplement = defaultSceneSupplement(input.scene_name || '当前场景');
    usedModel = 'deterministic-test-completion';
  } else {
    const response = await parsedModelJson({
      taskId,
      systemPrompt: [
        '你是商用广告场景设计合同补齐器，只输出 JSON。',
        '用户场景原文是最高权威：不得改写、删减或替换已有空间、材料、颜色、光线、物件、动作和禁止项。只补 missing 中缺少的证据。',
        '补齐必须具体到：空间边界与相对位置；真实材料、颜色、尺度、纹理、使用痕迹和光源方向；人物/商品互动点、起终点、移动路线与可用机位；明确禁止项。',
        '同时补齐 storyStates、interactionAnchors 和 routes，使后续分镜能引用稳定 ID。不得新增用户未提供的品牌、功效、价格或无关地点。',
        '输出：{"scene_spec_supplement":{"layoutText":"...","materialLightText":"...","interactionText":"...","negativeText":"...","storyStates":[],"interactionAnchors":[],"routes":[]}}',
      ].join('\n'),
      userPrompt: JSON.stringify(input),
      maxTokens: 4200,
    }, deps);
    supplement = response.parsed.scene_spec_supplement || response.parsed.sceneSpecSupplement || response.parsed;
    usedModel = response.modelResult.used_model || '';
  }
  const merged = { ...spec };
  for (const key of Object.keys(SCENE_TEXT_COMPONENTS)) {
    const original = sceneText(spec, key);
    merged[key] = sceneTextComplete(key, original)
      ? original
      : appendAuthorityText(original, sceneText(supplement, key), key === 'interactionText' ? 900 : 1200);
  }
  const arrayAliases = {
    storyStates: ['storyStates', 'story_states'],
    interactionAnchors: ['interactionAnchors', 'interaction_anchors'],
    routes: ['routes', 'movement_routes'],
  };
  Object.entries(arrayAliases).forEach(([key, aliases]) => {
    const existing = aliases.map(name => spec[name]).find(Array.isArray);
    const generated = aliases.map(name => supplement?.[name]).find(Array.isArray);
    merged[key] = existing?.length ? existing : (generated || []);
  });
  const stillMissing = sceneMissingComponents(merged);
  if (stillMissing.length) {
    const error = new Error(`场景“${input.scene_name || input.scene_id || '当前场景'}”自动补齐不完整：${stillMissing.join(', ')}`);
    error.code = 'SCENE_SPEC_AUTO_COMPLETION_INCOMPLETE';
    error.status = 502;
    error.missing_components = stillMissing;
    throw error;
  }
  merged.auto_completion = {
    schema_version: 1,
    completed_components: missing,
    source: 'generation_preflight_ai_completion',
    used_model: usedModel,
  };
  if (taskId && typeof storage.saveOutput === 'function') {
    storage.saveOutput(taskId, checkpointKind, { status: 'complete', scene_spec: merged, used_model: usedModel, created_at: new Date().toISOString() });
  }
  return { scene_spec: merged, changed: true, model_call_count: usedModel === 'deterministic-test-completion' ? 0 : 1, checkpoint_kind: checkpointKind, reused: false };
}

module.exports = {
  WARDROBE_COMPONENTS,
  appendAuthorityText,
  wardrobeMissingComponents,
  sceneMissingComponents,
  completePersonProfiles,
  completeSceneSpec,
};
