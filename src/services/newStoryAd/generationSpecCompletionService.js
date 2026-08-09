const crypto = require('crypto');
const modelGatewayDefault = require('./modelGateway');
const jsonRepairDefault = require('./jsonRepairService');
const storageDefault = require('./storageService');
const subjectProfileText = require('./subjectProfileTextService');
const { cleanText } = require('./contextBuilder');
const personLooks = require('./personLookProfileService');
const wardrobeKnowledge = require('./wardrobeStyleKnowledgeService');
const contentSkill = require('./contentSkillService');

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

function wardrobeMissingComponents(value = '', contract = null, input = {}) {
  return wardrobeKnowledge.wardrobeMissingComponents(cleanText(value, 2000), contract, input);
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
    cameraPlan: spec.cameraPlan || spec.camera_plan,
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

function stableSceneToken(value = '') {
  const token = cleanText(value || 'scene', 120).replace(/[^a-z0-9_-]+/ig, '_').replace(/^_+|_+$/g, '');
  return token || `scene_${fingerprint(value || 'scene').slice(0, 10)}`;
}

function defaultSceneSupplement(name = '当前场景', spec = {}, sceneId = '', input = {}) {
  const token = stableSceneToken(sceneId || name);
  const knownInteraction = sceneText(spec, 'interactionText');
  const routeEvidence = knownInteraction || `${name}的已确认入口、通道与核心互动位置`;
  const narrativeOnly = contentSkill.mode(input.content_mode || input.contentMode || '') === 'narrative_story';
  return {
    layoutText: `${name}明确主体展示区、前景、背景、入口、出口、连续通道和完整空间边界，各区域保持可拍摄的真实相对位置与纵深关系`,
    materialLightText: narrativeOnly
      ? `${name}使用与故事时代、地点和情绪氛围一致的真实材料、协调配色和可辨尺度纹理，主光方向、环境光、阴影、反射、粗糙度及轻微使用痕迹保持物理一致`
      : `${name}使用与广告主体匹配的真实材料、统一商业配色和可辨尺度纹理，主光方向、环境光、阴影、反射、粗糙度及轻微使用痕迹保持物理一致`,
    interactionText: narrativeOnly
      ? '明确故事人物或叙事主体的起点、移动路线、互动位置、终点、主机位、反向机位和细节特写焦点，保证情节动作与镜头方向连续'
      : '明确人物或商品的起点、移动路线、互动位置、终点、主机位、反向机位和细节特写焦点，保证动作与镜头方向连续',
    negativeText: '禁止无关人物和物件；禁止文字、水印、Logo、结构变形、材质漂移、光向矛盾和不可到达的互动路线',
    storyStates: [{ id: `state_${token}_main`, label: `${name}${narrativeOnly ? '主要叙事状态' : '主要展示状态'}`, state_before: ['主体进入前空间与物件位置固定'], visible_change: [routeEvidence], state_after: ['互动完成后保留已发生的物件状态'], shot_refs: [] }],
    interactionAnchors: [{ id: `anchor_${token}_main`, label: `${name}主要互动点`, purpose: routeEvidence, contact_rules: ['手部、视线、物件朝向和接触位置连续'] }],
    routes: [{ id: `route_${token}_main`, label: `${name}主要拍摄行动路线`, from: '已确认入口或画面外起点', to: '已确认核心互动位置', actor: narrativeOnly ? '场景中的故事人物或叙事主体' : '场景中的主要人物或展示主体', continuity: `${routeEvidence}；保持运动方向、视线和物件状态连续` }],
  };
}

function defaultCameraPlan(sceneId = '', sceneName = '') {
  const token = stableSceneToken(sceneId || sceneName || 'scene');
  return [
    { id: `camera_${token}_master`, label: '主建立机位', view_id: 'master', normalized_position: [0.12, 0.82], look_at: [0.52, 0.48], framing: 'wide establishing', lens: '24-35mm', height: 'eye_level', movement_type: 'dolly_in', route: '场景入口到主建立位', speed: 'slow', duration: 4 },
    { id: `camera_${token}_reverse`, label: '反向机位', view_id: 'reverse', normalized_position: [0.84, 0.22], look_at: [0.48, 0.52], framing: 'wide reverse', lens: '28-40mm', height: 'eye_level', movement_type: 'lateral_slide', route: '主建立位到反向位', speed: 'medium_slow', duration: 3 },
    { id: `camera_${token}_interaction`, label: '互动机位', view_id: 'interaction', normalized_position: [0.28, 0.7], look_at: [0.58, 0.46], framing: 'medium wide', lens: '35-50mm', height: 'eye_level', movement_type: 'tracking', route: '入口沿行动路线到互动区', speed: 'subject_sync', duration: 4 },
    { id: `camera_${token}_detail`, label: '细节机位', view_id: 'detail', normalized_position: [0.58, 0.54], look_at: [0.6, 0.5], framing: 'close detail', lens: '50-85mm', height: 'subject_level', movement_type: 'macro_push', route: '互动区到细节焦点', speed: 'very_slow', duration: 3 },
  ];
}

function closeSceneSpec(spec = {}, input = {}) {
  const missing = sceneMissingComponents(spec);
  if (!missing.length) return { scene_spec: spec, completed_components: [] };
  const fallback = defaultSceneSupplement(input.scene_name || '当前场景', spec, input.scene_id, input);
  fallback.cameraPlan = defaultCameraPlan(input.scene_id, input.scene_name);
  const closed = { ...spec };
  for (const key of Object.keys(SCENE_TEXT_COMPONENTS)) {
    if (!missing.includes(key)) continue;
    closed[key] = appendAuthorityText(sceneText(spec, key), sceneText(fallback, key), key === 'interactionText' ? 900 : 1200);
  }
  ['storyStates', 'interactionAnchors', 'routes', 'cameraPlan'].forEach(key => {
    if (missing.includes(key)) closed[key] = fallback[key];
  });
  return { scene_spec: closed, completed_components: missing };
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
    .map(profile => personLooks.normalizeProfileLooks(
      subjectProfileText.canonicalProfile(profile || {}, { age: profile?.age || '' }),
      { ensure: true },
    ))
    .map(profile => ({
      ...profile,
      look_profiles: profile.look_profiles.map(look => {
        if (look.wardrobe_contract && typeof look.wardrobe_contract === 'object') return look;
        const input = { brief, profile, look };
        const projected = wardrobeKnowledge.buildEvidenceContract(look.wardrobeText, input);
        return wardrobeKnowledge.missingComponents(projected).length
          ? look
          : { ...look, wardrobe_contract: projected, knowledge_refs: projected.knowledge_doc_ids || [] };
      }),
    }));
  const targets = sourceProfiles.flatMap((profile, index) => (
    profile.look_profiles.map((look, lookIndex) => ({
      id: cleanText(profile.id || `cast_${index + 1}`, 80),
      index,
      look_id: look.id,
      look_index: lookIndex,
      profile: personLooks.profileWithLook(profile, look),
      missing: wardrobeMissingComponents(look.wardrobeText, look.wardrobe_contract, { brief, profile, look }),
      knowledge: wardrobeKnowledge.resolve({ brief, profile, look }, { limit: 2 }),
    }))
  )).filter(item => item.missing.length);
  if (!targets.length) return { cast_profiles: sourceProfiles, changed: false, model_call_count: 0, checkpoint_kind: '' };
  const input = {
    version: 3,
    wardrobe_knowledge_version: wardrobeKnowledge.STYLE_KNOWLEDGE_VERSION,
    brief,
    targets: targets.map(item => ({
      id: item.id,
      index: item.index,
      look_id: item.look_id,
      look_index: item.look_index,
      role: item.profile.roleName,
      look_name: item.profile.active_look_name,
      story_state: item.profile.look_profiles?.find?.(look => look.id === item.look_id)?.story_state || '',
      wardrobe: item.profile.wardrobeText,
      hair_makeup: item.profile.hairMakeupText,
      missing: item.missing,
      knowledge: item.knowledge.families.map(family => ({ id: family.id, doc_id: family.doc_id, instruction: family.instruction })),
    })),
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
    rows = targets.map(item => ({ id: item.id, index: item.index, look_id: item.look_id, look_index: item.look_index, wardrobe_supplement: defaultPersonSupplement(item.profile, item.missing) }));
    usedModel = 'deterministic-test-completion';
  } else {
    const response = await parsedModelJson({
      taskId,
      systemPrompt: [
        '你是商用影视人物造型合同补齐器，只输出 JSON。',
        '用户原文是最高权威：不得改写、删减、替换或反转用户已经指定的服装、鞋履、饰品、颜色、材质和禁止项。',
        '每个人物的每个 look_id 独立补 missing 中缺少的类别。不得把一个造型的服装、鞋履、配饰、发型或妆面补进另一个造型。补齐后必须形成上装+下装或完整连衣裙、鞋履、明确的配饰方案（可依据角色明确为无配饰）、配色、面料和发型妆面证据。',
        '配饰要给出具体类型、材质与佩戴位置；鞋履要给出类型、颜色与材质。不得使用“合适的、根据场景、适量”等空泛词。',
        '不同人物不得复制同一套造型。不得新增品牌、价格、功效、制服身份或宗教文化符号。',
        wardrobeKnowledge.promptBlock({ brief, extra: input.targets.map(target => `${target.look_name} ${target.story_state}`).join(' ') }),
        '每条 completion 必须同时返回 wardrobe_contract。garment_system.mode 只能是 one_piece、top_bottom 或 layered；items 必须列出 slot、type、evidence。footwear 必须有 type/color/material/evidence。accessories.mode 只能是 specified 或 none；specified 时列 items。palette.colors 和 materials 均不得为空。hair_makeup 必须忠实承接原人物设定，不得擅自增删指定发饰或改变妆面。任何单个字段不得复制整段造型描述来冒充结构化清单。',
        '输出：{"completions":[{"id":"人物ID","index":0,"look_id":"造型ID","look_index":0,"wardrobe_supplement":"仅该造型缺失项的具体中文补充","wardrobe_contract":{"style_family":"知识风格ID或task_defined","era_label":"时代/地域","garment_system":{"mode":"one_piece/top_bottom/layered","items":[{"slot":"upper/lower/one_piece/ensemble/outerwear","type":"具体单品","evidence":"对应自然语言证据"}]},"footwear":{"type":"鞋履类型","color":"颜色","material":"材质","evidence":"证据"},"accessories":{"mode":"specified/none","items":[{"type":"类型","position":"位置","material":"材质","evidence":"证据"}],"evidence":"证据"},"palette":{"colors":["主色","辅色"],"evidence":"证据"},"materials":[{"name":"面料/材质","used_for":"使用位置","evidence":"证据"}],"hair_makeup":{"description":"完整发型妆面","hairstyle":"发型","hair_accessories":["发饰或明确无发饰"],"makeup":"妆面","evidence":"证据"},"negative_constraints":[],"knowledge_doc_ids":[]}}]}',
      ].join('\n'),
      userPrompt: JSON.stringify(input),
    }, deps);
    rows = Array.isArray(response.parsed.completions) ? response.parsed.completions : [];
    usedModel = response.modelResult.used_model || '';
  }
  const completed = sourceProfiles.map((profile, index) => {
    const id = cleanText(profile.id || `cast_${index + 1}`, 80);
    const completedLooks = profile.look_profiles.map((look, lookIndex) => {
      const target = targets.find(item => item.index === index && item.look_id === look.id);
      if (!target) return look;
      const row = rows.find(item => cleanText(item?.id || '', 80) === id && cleanText(item?.look_id || item?.lookId || '', 100) === look.id)
        || rows.find(item => Number(item?.index) === index && Number(item?.look_index ?? item?.lookIndex) === lookIndex)
        || (profile.look_profiles.length === 1 ? rows.find(item => cleanText(item?.id || '', 80) === id || Number(item?.index) === index) : null)
        || {};
      const supplement = cleanText(row.wardrobe_supplement || row.wardrobeSupplement || '', 900);
      const resolved = appendAuthorityText(look.wardrobeText, supplement, 1200);
      const rawContract = row.wardrobe_contract || row.wardrobeContract || null;
      const contractInput = { brief, profile, look: { ...look, wardrobeText: resolved } };
      const resolvedContract = wardrobeKnowledge.normalizeContract(rawContract || wardrobeKnowledge.buildEvidenceContract(resolved, contractInput), resolved, contractInput);
      const stillMissing = wardrobeKnowledge.missingComponents(resolvedContract);
      if (stillMissing.length) {
        const error = new Error(`人物“${profile.displayName || id}”的“${look.name || look.id}”造型自动补齐不完整：${stillMissing.join(', ')}`);
        error.code = 'PERSON_WARDROBE_AUTO_COMPLETION_INCOMPLETE';
        error.status = 502;
        error.missing_components = stillMissing;
        error.look_id = look.id;
        throw error;
      }
      return {
        ...look,
        wardrobeText: resolved,
        style_family: resolvedContract.style_family,
        wardrobe_contract: resolvedContract,
        knowledge_refs: resolvedContract.knowledge_doc_ids || [],
        wardrobe_completion: {
          schema_version: 4,
          user_text: cleanText(look.wardrobeText || '', 900),
          ai_supplement: supplement,
          resolved_text: resolved,
          wardrobe_contract: resolvedContract,
          completed_components: target.missing,
          source: 'generation_preflight_ai_completion',
          used_model: usedModel,
        },
      };
    });
    const primary = completedLooks[0] || {};
    return {
      ...profile,
      look_profiles: completedLooks,
      wardrobeText: primary.wardrobeText || profile.wardrobeText,
      hairMakeupText: primary.hairMakeupText || profile.hairMakeupText,
      wardrobe: { ...(profile.wardrobe && typeof profile.wardrobe === 'object' ? profile.wardrobe : {}), userPrompt: primary.wardrobeText || profile.wardrobeText },
      outfit: primary.wardrobeText || profile.wardrobeText,
      wardrobe_contract: primary.wardrobe_contract || profile.wardrobe_contract,
      wardrobe_completion: primary.wardrobe_completion || profile.wardrobe_completion,
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
    version: 2,
    brief: cleanText(options.brief || '', 5000),
    product_subject: cleanText(options.productSubject || '', 500),
    content_mode: contentSkill.mode(options.contentMode || options.content_mode || ''),
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
    supplement = defaultSceneSupplement(input.scene_name || '当前场景', spec, input.scene_id, input);
    usedModel = 'deterministic-test-completion';
  } else {
    const response = await parsedModelJson({
      taskId,
      systemPrompt: [
        input.content_mode === 'narrative_story'
          ? '你是纯剧情场景设计合同补齐器，只输出 JSON；禁止添加商品、品牌、卖点、购买引导或商业转化。'
          : '你是商用广告场景设计合同补齐器，只输出 JSON。',
        '用户场景原文是最高权威：不得改写、删减或替换已有空间、材料、颜色、光线、物件、动作和禁止项。只补 missing 中缺少的证据。',
        input.content_mode === 'narrative_story'
          ? '补齐必须具体到：空间边界与相对位置；符合故事时代、地点和情绪的真实材料、颜色、尺度、纹理、使用痕迹和光源方向；人物/叙事主体互动点、起终点、移动路线与可用机位；明确禁止项。'
          : '补齐必须具体到：空间边界与相对位置；真实材料、颜色、尺度、纹理、使用痕迹和光源方向；人物/商品互动点、起终点、移动路线与可用机位；明确禁止项。',
        '同时补齐 storyStates、interactionAnchors、routes 和 cameraPlan，使后续分镜能引用稳定 ID。不得新增用户未提供的品牌、功效、价格或无关地点。',
        'cameraPlan 每项必须包含 id、label、view_id、normalized_position、look_at、framing、lens、height、movement_type、route、speed、duration；两个坐标字段均为 0..1 的二维坐标。',
        '输出：{"scene_spec_supplement":{"layoutText":"...","materialLightText":"...","interactionText":"...","negativeText":"...","storyStates":[],"interactionAnchors":[],"routes":[],"cameraPlan":[]}}',
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
    cameraPlan: ['cameraPlan', 'camera_plan'],
  };
  Object.entries(arrayAliases).forEach(([key, aliases]) => {
    const existing = aliases.map(name => spec[name]).find(Array.isArray);
    const generated = aliases.map(name => supplement?.[name]).find(Array.isArray);
    merged[key] = existing?.length ? existing : (generated || []);
  });
  const deterministicClosure = closeSceneSpec(merged, input);
  const closed = deterministicClosure.scene_spec;
  const stillMissing = sceneMissingComponents(closed);
  if (stillMissing.length) {
    if (taskId && typeof storage.saveOutput === 'function') {
      storage.saveOutput(taskId, checkpointKind, {
        status: 'failed',
        user_scene_spec: spec,
        model_supplement: supplement,
        merged_scene_spec: merged,
        closed_scene_spec: closed,
        missing_components: stillMissing,
        used_model: usedModel,
        created_at: new Date().toISOString(),
      });
    }
    const error = new Error(`场景“${input.scene_name || input.scene_id || '当前场景'}”自动补齐不完整：${stillMissing.join(', ')}`);
    error.code = 'SCENE_SPEC_AUTO_COMPLETION_INCOMPLETE';
    error.status = 502;
    error.missing_components = stillMissing;
    throw error;
  }
  closed.auto_completion = {
    schema_version: 2,
    completed_components: missing,
    deterministic_closed_components: deterministicClosure.completed_components,
    source: 'generation_preflight_ai_completion',
    used_model: usedModel,
  };
  if (taskId && typeof storage.saveOutput === 'function') {
    storage.saveOutput(taskId, checkpointKind, { status: 'complete', scene_spec: closed, used_model: usedModel, created_at: new Date().toISOString() });
  }
  return { scene_spec: closed, changed: true, model_call_count: usedModel === 'deterministic-test-completion' ? 0 : 1, checkpoint_kind: checkpointKind, reused: false };
}

module.exports = {
  WARDROBE_COMPONENTS,
  appendAuthorityText,
  wardrobeMissingComponents,
  sceneMissingComponents,
  closeSceneSpec,
  completePersonProfiles,
  completeSceneSpec,
};
