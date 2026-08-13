const crypto = require('crypto');
const storage = require('./storageService');
const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const outputLanguage = require('./outputLanguageService');
const stageProgress = require('./stageProgressService');
const visualRealismPolicy = require('./visualRealismPolicyService');
const briefAuthority = require('./briefAuthorityService');
const productAssetResolver = require('./productAssetResolverService');
const propIdentity = require('./propIdentityContractService');
const productIdentity = require('./productIdentityContractService');
const { contextPrompt, cleanText, assertContextConsistent } = require('./contextBuilder');
const { normalizeScenePlan, assertScenePlanContract } = require('./sceneBindingService');
const assetPlanSceneContracts = require('./assetPlanSceneContractService');
const personLooks = require('./personLookProfileService');
const personCountContract = require('./personCountContractService');
const worldSetting = require('./worldSettingContractService');
const contentSkill = require('./contentSkillService');
const storySceneCoverage = require('./storySceneCoverageService');
const storyFactsPrompt = require('./storyFactsPromptService');
const assetPlanPublication = require('./assetPlanPublicationService');
const checkpointLineage = require('./assetPlanCheckpointLineageService');
const sectionRecovery = require('./assetPlanSectionRecoveryContractService');

const ASSET_PLAN_PROJECTION_VERSION = 13;
const ASSET_PLAN_DRAFT_CHECKPOINT_KIND = 'asset_plan_draft_checkpoint';
const ASSET_PLAN_MISSING_SECTIONS_RECOVERY_KIND = 'asset_plan_missing_sections_recovery';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]);
    return result;
  }, {});
}

function fingerprint(task = {}, ctx = {}) {
  const currentCastFingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(canonical(ctx.cast_profiles || [])))
    .digest('hex');
  const castProfiles = currentCastFingerprint === ctx.asset_plan_generated_cast_fingerprint
    ? []
    : ctx.cast_profiles;
  return crypto.createHash('sha256').update(JSON.stringify(canonical({
    version: ASSET_PLAN_PROJECTION_VERSION,
    content_mode: contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode),
    story_scene_contract_version: Number(ctx.story_scene_contract_version || 0) || 0,
    // 页面渲染可能把换行折叠为空格；资产规划指纹必须按语义文本计算，
    // 否则用户未修改内容也会使检查点失配并重复调用主规划模型。
    brief: cleanText(ctx.brief, 5000),
    product_subject: ctx.product_subject,
    advertised_subject_contract: ctx.advertised_subject_contract
      || (referenceIsValid(ctx.reference_video_analysis)
        ? advertisedSubjectContract(ctx, ctx.reference_video_analysis)
        : null),
    reference_analysis: ctx.reference_video_analysis || null,
    cast_profiles: castProfiles,
    planning_cast_count: personCountContract.contract(ctx).planning_cast_count,
    visual_asset_count: personCountContract.contract(ctx).visual_asset_count,
    pet_profiles: ctx.pet_profiles,
    person_revision: ctx.person_contract?.person_revision || ctx.revisions?.person || 0,
    product_revision: ctx.product_contract?.product_revision || ctx.revisions?.product || 0,
    prop_revisions: (ctx.prop_assets || [])
      .filter(item => item.status !== 'planned_not_generated')
      .map(item => [item.prop_id || item.id, item.revision || 1]),
    scene_revisions: (ctx.scene_assets || []).map(item => [item.scene_id || item.id, item.revision || 1]),
    target_duration: ctx.target_duration,
    shot_count: ctx.shot_count,
    output_ratio: ctx.output_ratio,
    creative_direction: ctx.creative_direction,
    performance: ctx.performance,
  }))).digest('hex');
}

function referenceIsValid(reference = null) {
  return Boolean(
    reference
    && reference.status === 'completed'
    && reference.analysis_quality?.valid === true
    && reference.analysis_id
    && Array.isArray(reference.scene_prompts)
    && reference.scene_prompts.length,
  );
}

function assertReferenceReady(reference = null) {
  if (!reference?.analysis_id || reference.status === 'completed') return;
  const error = new Error('当前参考视频尚未分析完成，请重新分析或删除参考视频后再继续。');
  error.code = 'REFERENCE_VIDEO_ANALYSIS_NOT_READY';
  error.status = 409;
  error.retryable = true;
  throw error;
}

function explicitAnimalPrompt(item = {}) {
  const kind = cleanText(
    item.entity_type || item.subject_type || item.prompt_type || item.kind || item.category || '',
    60,
  ).toLowerCase();
  return ['animal', 'pet', 'animal_character', 'pet_character'].includes(kind)
    || Boolean(cleanText(item.species || item.breed || item.animal_type, 120));
}

function uniquePrompts(items = [], prefix = 'reference_subject') {
  const used = new Set();
  return items.filter(Boolean).filter((item, index) => {
    const key = cleanText(item.id || item.subject_id || `${prefix}_${index + 1}`, 100);
    if (used.has(key)) return false;
    used.add(key);
    return true;
  });
}

function narrativeAnimalProp(item = {}) {
  const type = cleanText(item.type || '', 80).toLowerCase();
  if (!['story_prop', 'animal', 'pet', 'animal_character', 'pet_character'].includes(type)) return false;
  const animalPattern = /动物|宠物|萌宠|橘猫|猫咪|小猫|猫|犬|小狗|狗|金毛|柯基|萨摩耶|拉布拉多|马|兔|鸟|鹦鹉|仓鼠/u;
  const name = cleanText(item.name || '', 240);
  if (type === 'story_prop') return animalPattern.test(name);
  const text = cleanText(`${name} ${item.description || ''}`, 1200);
  return animalPattern.test(text);
}

function animalSpecies(item = {}) {
  const text = cleanText(`${item.name || ''} ${item.description || ''}`, 1200);
  const match = text.match(/橘猫|猫咪|小猫|猫|金毛|柯基|萨摩耶|拉布拉多|犬|小狗|狗|马|兔|鹦鹉|鸟|仓鼠/u);
  if (!match) return '动物';
  if (/猫/u.test(match[0])) return '猫';
  if (/金毛|柯基|萨摩耶|拉布拉多|犬|狗/u.test(match[0])) return '狗';
  return match[0];
}

function placeholderPet(profile = {}) {
  const type = cleanText(profile.type || profile.species || '', 120);
  return !cleanText(profile.name || profile.displayName, 120)
    && !cleanText(profile.breed || profile.appearance || profile.description, 800)
    && (!type || type === '按广告需求判断' || type === 'animal');
}

function reconcileNarrativeAnimals(petProfiles = [], propPlan = [], ctx = {}) {
  const pets = Array.isArray(petProfiles) ? petProfiles.slice(0, 12) : [];
  const props = Array.isArray(propPlan) ? propPlan.slice(0, 24) : [];
  const expected = Math.max(0, Number(ctx.expected_animals || ctx.pet_contract?.expected_animals || pets.length) || 0);
  if (contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode) !== 'narrative_story' || expected < 1) {
    return { pet_profiles: pets, prop_plan: props };
  }
  const animalProps = props.filter(narrativeAnimalProp);
  if (!animalProps.length || (pets.length && !pets.every(placeholderPet))) {
    return { pet_profiles: pets, prop_plan: props };
  }
  const derived = animalProps.slice(0, expected).map((item, index) => ({
    id: cleanText(pets[index]?.id || pets[index]?.pet_id || `pet_${index + 1}`, 100),
    pet_id: cleanText(pets[index]?.pet_id || pets[index]?.id || `pet_${index + 1}`, 100),
    name: cleanText(item.name || `动物 ${index + 1}`, 120),
    type: animalSpecies(item),
    species: animalSpecies(item),
    breed: '',
    appearance: cleanText(item.description || item.name || '', 800),
    behaviorText: cleanText(Array.isArray(item.states) ? item.states.join('；') : '', 500),
    continuityText: cleanText(item.description || '', 600),
    negativeText: '禁止改变物种、毛色、体型和稳定识别特征，禁止在同一画面复制额外动物',
    reference_images: [],
    source: 'narrative_prop_projection',
    status: 'draft',
  }));
  return {
    pet_profiles: derived,
    // A narrative animal is a persistent visual subject, not a second copy in
    // the prop inventory. Keep towels, umbrellas and other real props only.
    prop_plan: props.filter(item => !animalProps.includes(item)),
  };
}

function advertisedSubjectContract(ctx = {}, reference = {}) {
  return productIdentity.projectAdvertisedSubjectContract(ctx, reference);
}

function projectReferencePlan(ctx = {}) {
  const reference = ctx.reference_video_analysis;
  const deepScenes = Array.isArray(reference.reference_understanding?.scenes)
    ? reference.reference_understanding.scenes.filter(item => (
      item && item.scene_id && Array.isArray(item.events) && item.events.length
    ))
    : [];
  const canonicalSceneIds = new Set(deepScenes.map(item => cleanText(item.scene_id, 100)).filter(Boolean));
  const sourceScenePrompts = canonicalSceneIds.size
    ? reference.scene_prompts.filter(item => canonicalSceneIds.has(cleanText(item.id, 100)))
    : reference.scene_prompts;
  const eventSceneIds = new Map();
  deepScenes.forEach(scene => (scene.events || []).forEach(eventId => {
    const match = /^event_(\d+)$/u.exec(cleanText(eventId, 80));
    if (match) eventSceneIds.set(Number(match[1]), cleanText(scene.scene_id, 100));
  }));
  const characterPrompts = Array.isArray(reference.character_prompts) ? reference.character_prompts : [];
  const narrativeAnimalPresence = typeof reference.source_facts?.narrative_animal_presence === 'boolean'
    ? reference.source_facts.narrative_animal_presence
    : reference.source_facts?.animal_presence === true;
  const animalPrompts = uniquePrompts([
    ...(narrativeAnimalPresence && Array.isArray(reference.animal_prompts) ? reference.animal_prompts : []),
    ...(narrativeAnimalPresence ? characterPrompts.filter(explicitAnimalPrompt) : []),
  ], 'reference_animal');
  const humanPrompts = characterPrompts.filter(item => !explicitAnimalPrompt(item));
  const castProfiles = humanPrompts.map((item, index) => ({
    id: cleanText(item.id || `reference_character_${index + 1}`, 100),
    name: cleanText(item.role || item.name || `人物${index + 1}`, 120),
    role: cleanText(item.role || item.narrative_function || '', 200),
    age_range: cleanText(item.age_range || '', 100),
    appearanceText: cleanText(item.appearance_direction || '', 600),
    wardrobeText: cleanText(item.wardrobe_direction || '', 600),
    hairMakeupText: cleanText(item.hair_makeup_direction || item.hairMakeupText || '', 500),
    performanceText: cleanText(item.performance_style || '', 500),
    continuityText: cleanText(item.continuity_rules || '', 500),
    negativeText: cleanText(item.negative_prompt || '', 500),
    source: 'reference_analysis_projection',
    status: 'draft',
    projection_only: true,
    generated_asset: false,
    identity_extraction_allowed: false,
  }));
  const petProfiles = animalPrompts.map((item, index) => ({
    id: cleanText(item.id || item.subject_id || `reference_animal_${index + 1}`, 100),
    pet_id: cleanText(item.id || item.subject_id || `reference_animal_${index + 1}`, 100),
    name: cleanText(item.name || item.role || item.species || `动物${index + 1}`, 120),
    role: cleanText(item.role || item.narrative_function || '', 200),
    type: cleanText(item.type || item.species || item.animal_type || 'animal', 120),
    species: cleanText(item.species || item.type || item.animal_type || '', 120),
    breed: cleanText(item.breed || '', 160),
    appearance: cleanText(item.appearance_direction || item.appearance_prompt || item.appearance || item.description || '', 800),
    behaviorText: cleanText(item.behavior_direction || item.performance_style || item.actions || '', 600),
    continuityText: cleanText(item.continuity_rules || '', 600),
    negativeText: cleanText(item.negative_prompt || '', 500),
    source: 'reference_analysis_projection',
    status: 'draft',
    projection_only: true,
    generated_asset: false,
    identity_extraction_allowed: false,
    reference_images: [],
  }));
  const spaces = sourceScenePrompts.map((item, index) => {
    const id = cleanText(item.id || `reference_space_${index + 1}`, 100);
    const deepScene = deepScenes.find(scene => cleanText(scene.scene_id, 100) === id) || {};
    return {
      id,
      name: cleanText(item.location_type || `参考空间${index + 1}`, 120),
      description: cleanText(item.layout_prompt || reference.source_facts?.environment || '', 500),
      story_purpose: cleanText(deepScene.narrative_function || item.camera_purpose || '', 300),
      source: 'reference_analysis_projection',
      projection_only: true,
      generated_asset: false,
      scene_spec: {
        layoutText: cleanText(item.layout_prompt || reference.source_facts?.layout || '', 1000),
        materialLightText: cleanText(item.material_light_prompt || reference.source_facts?.lighting || '', 1000),
        interactionText: cleanText(item.interaction_prompt || '按照参考证据保持主体、产品与空间的相对位置', 1000),
        negativeText: cleanText(item.negative_prompt || '不得复制参考视频中的品牌、真人身份、版权图案或水印', 1000),
        storyStates: Array.isArray(item.story_states) ? item.story_states : [],
        interactionAnchors: Array.isArray(item.interaction_anchors) ? item.interaction_anchors : [],
        routes: Array.isArray(item.routes) ? item.routes : [],
        propPlacements: Array.isArray(item.prop_placements) ? item.prop_placements : [],
      },
    };
  });
  const product = cleanText(reference.source_facts?.product_or_service || ctx.product_subject || '', 200);
  const subjectContract = advertisedSubjectContract(ctx, reference);
  return {
    cast_profiles: castProfiles,
    pet_profiles: petProfiles,
    // 参考视频识别出的广告主体已经进入 product_subject / advertised_subject。
    // 它不是剧情中需要单独持有、移动或改变状态的道具，不能重复投影成“独立道具”。
    prop_plan: [],
    advertised_subject_contract: subjectContract,
    scene_plan: {
      source: 'reference_analysis_projection',
      projection_only: true,
      business_boundary: cleanText(ctx.brief, 500),
      advertised_subject: ctx.product_subject || product,
      cast_mode: castProfiles.length && petProfiles.length
        ? 'human_pet'
        : (petProfiles.length
          ? 'animal'
          : (castProfiles.length > 2 ? 'multi' : (castProfiles.length === 2 ? 'dual' : (castProfiles.length === 1 ? 'single' : 'no_human')))),
      scene_mode: spaces.length > 1 ? 'multi' : 'single',
      spaces,
      asset_strategy: [],
      story_strategy: (reference.plot_beats || []).map(item => cleanText(item.purpose || '', 300)).filter(Boolean),
      forbidden: ['不得复制参考视频中的真人身份、品牌标识、版权图案和水印'],
      suggested_shot_count: Number(ctx.shot_count || reference.camera_intents?.length || 5),
    },
    story_seed: {
      ...reference.story_outline,
      plot_beats: reference.plot_beats || [],
      shot_breakdown: (reference.shot_breakdown || []).map((shot, index) => ({
        ...shot,
        scene_id: eventSceneIds.get(index + 1) || shot.scene_id,
      })),
      camera_intents: reference.camera_intents || [],
      character_actions: reference.character_actions || [],
      advertised_subject: subjectContract.subject || product,
      product_proof_requirements: subjectContract.proof_requirements || [],
      source: 'reference_analysis_projection',
      projection_only: true,
    },
  };
}

function normalizePlan(source = {}, ctx = {}) {
  const rawScenePlan = source.scene_plan || source.scenePlan || source.scene_config || source.sceneConfig || {};
  let scenePlan = normalizeScenePlan(assetPlanSceneContracts.closeAssetPlanSceneContracts(rawScenePlan, {
    content_mode: ctx.content_mode || ctx.product_presentation?.mode,
  }));
  assertScenePlanContract(scenePlan);
  const castProfiles = Array.isArray(source.cast_profiles || source.castProfiles)
    ? (source.cast_profiles || source.castProfiles).slice(0, 12)
    : (ctx.cast_profiles || []);
  const existingProfiles = Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : [];
  const normalizedCastProfiles = castProfiles.map((profile, index) => {
      const existing = existingProfiles.find(item => cleanText(item?.id || '', 100)
        && cleanText(item?.id || '', 100) === cleanText(profile?.id || '', 100))
        || existingProfiles.find(item => cleanText(item?.displayName || item?.name || '', 120)
          && cleanText(item?.displayName || item?.name || '', 120) === cleanText(profile?.displayName || profile?.name || '', 120));
      const generatedLooks = personLooks.normalizeLookProfiles(profile);
      const existingLooks = existing ? personLooks.normalizeLookProfiles(existing) : [];
      const preservedLooks = existingLooks.length > generatedLooks.length ? existingLooks : generatedLooks;
      const withLooks = personLooks.normalizeProfileLooks({ ...profile, look_profiles: preservedLooks });
      return ({
      ...withLooks,
      id: cleanText(profile.id || `cast_${index + 1}`, 100),
      displayName: cleanText(profile.displayName || profile.name || `人物${index + 1}`, 120),
      name: cleanText(profile.name || profile.displayName || `人物${index + 1}`, 120),
      roleName: cleanText(profile.roleName || profile.role || '', 160),
      appearanceText: cleanText(profile.appearanceText || profile.appearance || '', 800),
      wardrobeText: cleanText(withLooks.wardrobeText || '', 1200),
      hairMakeupText: cleanText(
        profile.hairMakeupText || profile.hair_makeup || '自然真实的发型与妆容，严格匹配人物外貌、年龄和职业气质',
        400,
      ),
      negativeText: cleanText(profile.negativeText || profile.negative || '', 500),
      look_profiles: withLooks.look_profiles,
    }); });
  const narrativeCastProfiles = personCountContract.narrativeProfiles(normalizedCastProfiles, { brief: ctx.brief || '' });
  const eraSeparatedCastProfiles = personLooks.splitCrossEraProfiles(narrativeCastProfiles, { brief: ctx.brief || '' });
  if (eraSeparatedCastProfiles.length !== normalizedCastProfiles.length) {
    scenePlan = {
      ...scenePlan,
      cast_mode: eraSeparatedCastProfiles.length === 0 ? 'no_human'
        : (eraSeparatedCastProfiles.length === 1 ? 'single' : (eraSeparatedCastProfiles.length === 2 ? 'dual' : 'multi')),
    };
  }
  const reconciledAnimals = reconcileNarrativeAnimals(
    Array.isArray(source.pet_profiles || source.petProfiles)
      ? (source.pet_profiles || source.petProfiles)
      : (ctx.pet_profiles || []),
    Array.isArray(source.prop_plan || source.propPlan)
      ? (source.prop_plan || source.propPlan)
      : [],
    ctx,
  );
  return {
    cast_profiles: eraSeparatedCastProfiles,
    narrative_cast_profiles: narrativeCastProfiles,
    pet_profiles: reconciledAnimals.pet_profiles,
    prop_plan: reconciledAnimals.prop_plan,
    advertised_subject_contract: source.advertised_subject_contract && typeof source.advertised_subject_contract === 'object'
      ? source.advertised_subject_contract
      : (ctx.advertised_subject_contract || null),
    scene_plan: scenePlan,
    story_seed: source.story_seed && typeof source.story_seed === 'object' ? source.story_seed : {},
  };
}

function referenceProjectionFingerprint(reference = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical({
    analysis_id: reference.analysis_id || reference.id || '',
    status: reference.status || '',
    analysis_quality: reference.analysis_quality || {},
    generated_brief: reference.generated_brief || '',
    source_facts: reference.source_facts || {},
    story_outline: reference.story_outline || {},
    plot_beats: reference.plot_beats || [],
    character_prompts: reference.character_prompts || [],
    animal_prompts: reference.animal_prompts || [],
    scene_prompts: reference.scene_prompts || [],
    shot_breakdown: reference.shot_breakdown || [],
    camera_intents: reference.camera_intents || [],
    character_actions: reference.character_actions || [],
    animal_actions: reference.animal_actions || [],
    reference_understanding: reference.reference_understanding || {},
  }))).digest('hex');
}

async function projectReferenceIntake(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
  const currentContext = storage.getOutput(taskId, 'context') || task.request || {};
  const supplied = options.reference_analysis || options.referenceAnalysis || null;
  const reference = supplied && typeof supplied === 'object'
    ? { ...(currentContext.reference_video_analysis || {}), ...supplied }
    : currentContext.reference_video_analysis;
  if (!referenceIsValid(reference)) {
    return { projected: false, reason: 'reference_not_completed_or_invalid', context: currentContext };
  }
  const projectionFingerprint = referenceProjectionFingerprint(reference);
  if (currentContext.reference_analysis_projection?.fingerprint === projectionFingerprint) {
    return { projected: false, reason: 'unchanged', context: currentContext };
  }
  const priorContext = options.previous_context || options.previousContext || currentContext;
  const projectionContext = { ...currentContext, reference_video_analysis: reference };
  const plan = normalizePlan(projectReferencePlan(projectionContext), projectionContext);
  const existingCast = Array.isArray(priorContext.cast_profiles) ? priorContext.cast_profiles : [];
  const existingPets = Array.isArray(priorContext.pet_profiles) ? priorContext.pet_profiles : [];
  const replaceableRows = rows => !rows.length || rows.every(item => (
    item?.source === 'reference_analysis_projection' || item?.projection_only === true
  ));
  const replaceablePetRows = rows => replaceableRows(rows) || rows.every(item => (
    !cleanText(item?.source, 80)
    && !cleanText(item?.name || item?.displayName, 120)
    && !cleanText(item?.breed || item?.appearance || item?.description, 300)
    && !(Array.isArray(item?.reference_images) && item.reference_images.length)
  ));
  const castProfiles = replaceableRows(existingCast) ? plan.cast_profiles : existingCast;
  const petProfiles = replaceablePetRows(existingPets) ? plan.pet_profiles : existingPets;
  const existingStorySeed = priorContext.story_seed && typeof priorContext.story_seed === 'object'
    ? priorContext.story_seed
    : {};
  const storySeed = !Object.keys(existingStorySeed).length
    || existingStorySeed.source === 'reference_analysis_projection'
    || existingStorySeed.projection_only === true
    ? plan.story_seed
    : existingStorySeed;
  const existingScenePlan = options.existing_scene_plan || options.existingScenePlan || storage.getOutput(taskId, 'scene_config');
  const hasExistingScenes = Array.isArray(existingScenePlan?.spaces) && existingScenePlan.spaces.length > 0;
  const replaceableScenePlan = !hasExistingScenes
    || existingScenePlan.source === 'reference_analysis_projection'
    || existingScenePlan.projection_only === true;
  const scenePlan = replaceableScenePlan ? plan.scene_plan : existingScenePlan;
  const projectedPeople = castProfiles === plan.cast_profiles;
  const projectedPets = petProfiles === plan.pet_profiles;
  const primaryCast = castProfiles[0] || {};
  const personCounts = personCountContract.contract({
    ...projectionContext,
    cast_profiles: castProfiles,
    narrative_cast_profiles: projectedPeople ? plan.narrative_cast_profiles : projectionContext.narrative_cast_profiles,
    planning_cast_count: projectedPeople ? plan.narrative_cast_profiles.length : projectionContext.planning_cast_count,
    visual_asset_count: castProfiles.length,
  });
  const referenceBrief = cleanText(
    reference.generated_brief
      || reference.summary
      || reference.story_outline?.logline
      || reference.source_facts?.product_or_service
      || '',
    3000,
  );
  const keepUserBrief = projectionContext.brief_source === 'user'
    && cleanText(projectionContext.brief, 3000);
  const projectedProductContract = productIdentity.buildProductContract({
    ...projectionContext,
    advertised_subject_contract: plan.advertised_subject_contract,
  });
  const nextContext = assertContextConsistent({
    ...projectionContext,
    brief: keepUserBrief ? cleanText(projectionContext.brief, 3000) : referenceBrief,
    brief_source: keepUserBrief ? 'user' : 'reference_analysis',
    cast_profiles: castProfiles,
    narrative_cast_profiles: personCounts.narrative_profiles,
    pet_profiles: petProfiles,
    cast_mode: projectedPeople && projectedPets ? plan.scene_plan.cast_mode : projectionContext.cast_mode,
    expected_people: castProfiles.length,
    narrative_identity_count: personCounts.narrative_identity_count,
    planning_cast_count: personCounts.planning_cast_count,
    visual_asset_count: personCounts.visual_asset_count,
    expected_animals: petProfiles.length,
    story_seed: storySeed,
    person_spec: projectedPeople ? {
      ...(projectionContext.person_spec || {}),
      castMode: plan.scene_plan.cast_mode,
      expectedPeople: castProfiles.length,
      narrativeIdentityCount: personCounts.narrative_identity_count,
      planningCastCount: personCounts.planning_cast_count,
      visualAssetCount: personCounts.visual_asset_count,
      displayName: primaryCast.displayName || primaryCast.name || '',
      roleName: primaryCast.roleName || primaryCast.role || '',
      age: primaryCast.age || primaryCast.age_range || 'match_brief',
      appearanceText: primaryCast.appearanceText || '',
      wardrobeText: primaryCast.wardrobeText || '',
      look_profiles: primaryCast.look_profiles || [],
      negativeText: primaryCast.negativeText || '',
    } : projectionContext.person_spec,
    pet_contract: projectedPets && petProfiles.length ? {
      status: 'declared',
      expected_animals: petProfiles.length,
      profiles: petProfiles,
      source: 'reference_analysis_projection',
    } : projectionContext.pet_contract,
    advertised_subject_contract: plan.advertised_subject_contract,
    product_contract: projectedProductContract,
    reference_analysis_projection: {
      fingerprint: projectionFingerprint,
      analysis_id: cleanText(reference.analysis_id || reference.id || '', 100),
      source: 'reference_analysis_projection',
      model_call_count: 0,
      projected_at: new Date().toISOString(),
    },
  });
  const contentRevision = Math.max(1, Number(storage.getTask(taskId)?.content_revision || 1) || 1);
  storage.updateTask(taskId, { request: nextContext, brief: nextContext.brief });
  const snapshot = storage.saveSnapshot(taskId, {
    content_revision: contentRevision,
    status: 'draft_saved',
    payload: nextContext,
  });
  const lineage = {
    content_revision: contentRevision,
    snapshot_id: snapshot.id,
    input_fingerprint: snapshot.input_fingerprint,
  };
  storage.saveOutput(taskId, 'context', nextContext, lineage);
  storage.saveOutput(taskId, 'scene_config', scenePlan, lineage);
  return {
    projected: true,
    reason: 'completed_reference_projected',
    model_call_count: 0,
    context: nextContext,
    scene_plan: scenePlan,
    snapshot_id: snapshot.id,
  };
}

function complete(plan = null, ctx = {}) {
  return Boolean(
    plan
    && missingAssetPlanSections(plan, ctx).length === 0
    && storySceneCoverage.coverageIssues(plan, ctx).length === 0,
  );
}

function rawScenePlan(source = {}) {
  return source?.scene_plan || source?.scenePlan || source?.scene_config || source?.sceneConfig || {};
}

function hasPhysicalSpaces(source = {}) {
  return Array.isArray(rawScenePlan(source)?.spaces) && rawScenePlan(source).spaces.length > 0;
}

function sourceSection(source = {}, snakeKey = '', camelKey = '') {
  if (Object.prototype.hasOwnProperty.call(source || {}, snakeKey)) return source[snakeKey];
  if (camelKey && Object.prototype.hasOwnProperty.call(source || {}, camelKey)) return source[camelKey];
  return undefined;
}

function recoverySectionValidators(ctx = {}) {
  return {
    story_seed: (storySeed) => {
      if (!Object.values(storySeed || {}).some(value => cleanText(value, 300))) return ['empty'];
      return storySceneCoverage.storySeedIssues(storySeed, ctx);
    },
    scene_plan: (_scenePlan, source) => {
      if (!hasPhysicalSpaces(source)) return ['spaces_missing'];
      return storySceneCoverage.required(ctx) ? storySceneCoverage.coverageIssues(source, ctx) : [];
    },
  };
}

function validStorySeedSection(source = {}, ctx = {}) {
  return sectionRecovery.sectionDiagnostics(source, ctx, recoverySectionValidators(ctx)).story_seed.valid;
}

function validScenePlanSection(source = {}, ctx = {}) {
  return sectionRecovery.sectionDiagnostics(source, ctx, recoverySectionValidators(ctx)).scene_plan.valid;
}

function validAssetPlanSections(source = {}, ctx = {}) {
  return sectionRecovery.validSections(source, ctx, recoverySectionValidators(ctx));
}

function missingAssetPlanSections(source = {}, ctx = {}) {
  return sectionRecovery.missingSections(source, ctx, recoverySectionValidators(ctx));
}

function reusableDraftPayload(source = {}, ctx = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  return validAssetPlanSections(source, ctx).length > 0
    && missingAssetPlanSections(source, ctx).length > 0;
}

function narrativeSubjectMarker(value = '') {
  const marker = cleanText(value, 300).toLowerCase().replace(/[｜|／]/g, '/');
  return /^(?:纯剧情|故事主题|纯剧情\s*\/\s*故事主题|故事\/剧情主题|非广告|无广告主体|不适用|none|n\/?a)$/iu.test(marker);
}

function rawContentModeViolations(source = {}, ctx = {}) {
  const mode = contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode);
  const scenePlan = rawScenePlan(source);
  const props = Array.isArray(sourceSection(source, 'prop_plan', 'propPlan'))
    ? sourceSection(source, 'prop_plan', 'propPlan')
    : [];
  const storySeed = sourceSection(source, 'story_seed', 'storySeed') || {};
  const advertisedSubject = cleanText(scenePlan?.advertised_subject || '', 300);
  const contractSubject = cleanText(source?.advertised_subject_contract?.subject || '', 300);
  const storySubject = cleanText(storySeed?.advertised_subject || '', 300);
  const proofRequirements = Array.isArray(storySeed?.product_proof_requirements)
    ? storySeed.product_proof_requirements.filter(Boolean)
    : [];
  if (mode === 'narrative_story') {
    return [
      advertisedSubject && !narrativeSubjectMarker(advertisedSubject) ? 'scene_plan.advertised_subject' : '',
      props.some(item => String(item?.type || '').toLowerCase() === 'advertised_product') ? 'prop_plan.advertised_product' : '',
      contractSubject && !narrativeSubjectMarker(contractSubject) ? 'advertised_subject_contract.subject' : '',
      storySubject && !narrativeSubjectMarker(storySubject) ? 'story_seed.advertised_subject' : '',
      proofRequirements.length ? 'story_seed.product_proof_requirements' : '',
    ].filter(Boolean);
  }
  const hasSceneSection = Object.keys(scenePlan || {}).length > 0;
  const hasPhysicalScene = Array.isArray(scenePlan?.spaces) && scenePlan.spaces.length > 0;
  return hasSceneSection && hasPhysicalScene && !advertisedSubject
    ? ['scene_plan.advertised_subject_missing']
    : [];
}

function normalizeContentModeMarkers(plan = {}, ctx = {}) {
  const mode = contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode);
  if (mode !== 'narrative_story') return plan;
  const scenePlan = plan.scene_plan && typeof plan.scene_plan === 'object' ? { ...plan.scene_plan } : {};
  if (narrativeSubjectMarker(scenePlan.advertised_subject)) scenePlan.advertised_subject = '';
  const storySeed = plan.story_seed && typeof plan.story_seed === 'object' ? { ...plan.story_seed } : {};
  if (narrativeSubjectMarker(storySeed.advertised_subject)) storySeed.advertised_subject = '';
  const subjectContract = plan.advertised_subject_contract && typeof plan.advertised_subject_contract === 'object'
    ? { ...plan.advertised_subject_contract }
    : plan.advertised_subject_contract;
  if (subjectContract && narrativeSubjectMarker(subjectContract.subject)) subjectContract.subject = '';
  return { ...plan, scene_plan: scenePlan, story_seed: storySeed, advertised_subject_contract: subjectContract };
}

function assertGeneratedContentMode(source = {}, ctx = {}, stage = 'asset_plan') {
  const violations = rawContentModeViolations(source, ctx);
  if (!violations.length) return source;
  const error = new Error(`${stage} 返回内容违反当前内容模式：${violations.join('、')}`);
  error.code = 'PROVIDER_RESPONSE_INVALID';
  error.retryable = true;
  error.content_mode_violations = violations;
  throw error;
}

function assertContentModeIsolation(plan = {}, ctx = {}) {
  const mode = contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode);
  const normalized = normalizeContentModeMarkers(plan, ctx);
  const violations = rawContentModeViolations(normalized, ctx);
  if (violations.length) {
    if (mode === 'narrative_story') {
      const error = new Error('纯剧情资产规划包含商业广告结构，已阻止保存以避免剧情与广告串用');
      error.code = 'ASSET_PLAN_CONTENT_MODE_CROSSTALK';
      error.status = 422;
      error.retryable = true;
      error.content_mode_violations = violations;
      throw error;
    }
    const error = new Error('商业广告资产规划缺少明确广告主体，已阻止保存以避免被纯剧情规则覆盖');
    error.code = 'ASSET_PLAN_CONTENT_MODE_CROSSTALK';
    error.status = 422;
    error.retryable = true;
    error.content_mode_violations = violations;
    throw error;
  }
  return normalized;
}

function sectionPatchValidators(ctx = {}, basePayload = {}) {
  const validators = recoverySectionValidators(ctx);
  return {
    story_seed: (value) => validators.story_seed(value, { ...basePayload, story_seed: value }),
    scene_plan: (value) => validators.scene_plan(value, { ...basePayload, scene_plan: value }),
  };
}

function sectionPatchOutput(section = '', contentMode = 'commercial_subject', ctx = {}) {
  if (section === 'cast_profiles') {
    return [{
      id: 'stable_cast_id', name: '人物名称', role: '剧情或广告职责', appearanceText: '外貌',
      wardrobeText: '服装', look_profiles: [],
    }];
  }
  if (section === 'prop_plan') {
    return contentMode === 'narrative_story'
      ? [{ id: 'stable_prop_id', name: '剧情道具', type: 'wearable_accessory/story_prop/fixed_scene_object', description: '身份、材质、比例和使用方式' }]
      : (sectionRecovery.standaloneProductRequired({}, ctx)
        ? [{ id: 'stable_product_id', name: '明确广告主体', type: 'advertised_product', description: '身份、材质、比例、使用方式和主体证据' }]
        : []);
  }
  if (section === 'scene_plan') {
    return {
      business_boundary: '业务边界', advertised_subject: contentMode === 'narrative_story' ? '' : '明确广告主体',
      cast_mode: 'single/dual/multi/no_human/animal/human_pet/auto', scene_mode: 'single/multi',
      spaces: [{
        id: 'stable_space_id', name: '中文空间名', description: '该物理空间', story_purpose: '剧情或广告作用',
        scene_spec: {
          layoutText: '布局、出入口和固定结构', materialLightText: '材质、色彩和光线',
          interactionText: '动作区、锚点与路线', negativeText: '禁止出现内容',
          storyStates: [], interactionAnchors: [], routes: [], propPlacements: [],
        },
      }],
      asset_strategy: [], story_strategy: [], forbidden: [], suggested_shot_count: 5,
    };
  }
  return contentMode === 'narrative_story' ? {
    logline: '梗概', opening: '', development: '', turning_point: '', resolution: '',
    plot_beats: [{
      id: 'stable_beat_id', phase: 'opening/development/turning_point/resolution/transition',
      era: '时间层', time_anchor: '时间位置', location: '地点', production_state: '可见环境状态',
      production_relation: { era: 'same/continuous/changed', time: 'same/continuous/changed', location: 'same/continuous/changed', environment: 'same/continuous/changed' },
      summary: '可见动作', cause: '原因', consequence: '结果',
    }],
  } : { logline: '广告故事梗概', opening: '', development: '', turning_point: '', resolution: '' };
}

async function recoverAssetPlanSectionPatch(taskId, ctx = {}, payload = {}, section = '', options = {}) {
  const contentMode = contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode);
  const generationId = cleanText(options.generation_id || options.generationId || '', 160);
  const fingerprintValue = cleanText(options.fingerprint || '', 160);
  const checkpoint = storage.getOutput(taskId, ASSET_PLAN_DRAFT_CHECKPOINT_KIND);
  const authority = sectionRecovery.checkpointCompatibility(storage.getTask(taskId) || {}, checkpoint, {
    ...options,
    ctx,
    fingerprint: fingerprintValue,
  });
  if (!authority.compatible) {
    const error = new Error(`资产规划区段恢复检查点已过期：${authority.issues.join('、')}`);
    error.code = 'ASSET_PLAN_CHECKPOINT_CAS_FAILED';
    error.status = 409;
    error.retryable = false;
    error.cas_issues = authority.issues;
    throw error;
  }
  const validators = sectionPatchValidators(ctx, payload);
  const validBefore = validAssetPlanSections(payload, ctx);
  const result = await modelGateway.generateText({
    taskId,
    stage: 'new_story_ad.asset_plan_section_patch',
    systemPrompt: [
      '你是资产规划精确区段修复 agent，只能输出 required_missing_sections 中唯一指定的区段。',
      '输出根对象必须且只能包含 required_missing_sections 与 section_patch。',
      'section_patch 必须且只能包含 section 与 value；不得返回、改写或复述其他区段。',
      '用户原文和 existing_valid_sections 是事实权威，不得新造题材、行业、人物、商品、地点或关系。',
      contentSkill.promptBlock(contentMode),
      section === 'cast_profiles'
        ? `cast_profiles must contain exactly ${personCountContract.contract(ctx).planning_cast_count} narrative identities. Count identities, not era-specific visual asset cards. A reincarnation is a separate named identity; the same living or time-travelling person across eras is one identity with multiple look_profiles.`
        : '',
      section === 'story_seed' || section === 'scene_plan' ? storySceneCoverage.promptBlock(ctx) : '',
      contentMode === 'narrative_story'
        ? '纯剧情允许显式 prop_plan: [] 表示没有独立道具；禁止 advertised_product、商品、品牌和销售转化。'
        : (sectionRecovery.standaloneProductRequired(payload, ctx)
          ? '当前权威合同要求独立产品资产：prop_plan 必须包含 type=advertised_product 的主体证据，不能用空数组绕过。'
          : '商业主体合同必须保留；服务、应用、材质表面等非独立道具主体允许显式 prop_plan: []，不得为了凑道具虚构实体商品。'),
    ].filter(Boolean).join('\n'),
    userPrompt: JSON.stringify({
      brief: ctx.brief || '',
      content_mode: contentMode,
      required_missing_sections: [section],
      person_count_contract: {
        narrative_identity_count: personCountContract.contract(ctx).planning_cast_count,
        visual_asset_count: personCountContract.contract(ctx).visual_asset_count,
        cast_profiles_semantics: 'narrative identities; era-specific visual cards are projected after validation',
      },
      existing_valid_sections: validBefore,
      existing_payload: payload,
      advertised_subject: contentMode === 'commercial_subject'
        ? cleanText(ctx.product_subject || ctx.product_presentation?.subject || '', 300)
        : '',
      required_output: {
        required_missing_sections: [section],
        section_patch: { section, value: sectionPatchOutput(section, contentMode, ctx) },
      },
    }),
    maxTokens: section === 'scene_plan' || section === 'story_seed' ? 4800 : 2800,
    temperature: 0.1,
    structuredOutput: { mode: 'json_object', name: 'asset_plan_section_patch' },
    validateText: (_text, meta = {}) => {
      const candidate = meta.parsed_json || {};
      const merged = sectionRecovery.mergeSectionPatch(payload, candidate, section, ctx, validators);
      assertGeneratedContentMode(merged, ctx, 'asset_plan_section_patch');
      sectionRecovery.assertRequiredSectionsCandidate(merged, [section], ctx, sectionPatchValidators(ctx, merged));
      return true;
    },
  });
  const parsed = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'object',
    modelGateway,
    taskId,
    stage: 'new_story_ad.json_repair',
  });
  const value = sectionRecovery.validateSectionPatch(parsed, section, ctx, validators);
  const language = await outputLanguage.ensureChineseOutput({
    payload: { [section]: value },
    kind: 'scene_config',
    taskId,
    context: ctx,
  });
  const repairedValue = sectionRecovery.sectionValue(language.payload || {}, section);
  const repairedPatch = {
    required_missing_sections: [section],
    section_patch: { section, value: repairedValue },
  };
  const merged = sectionRecovery.mergeSectionPatch(payload, repairedPatch, section, ctx, sectionPatchValidators(ctx, payload));
  assertGeneratedContentMode(merged, ctx, 'asset_plan_section_patch_language');
  sectionRecovery.assertRequiredSectionsCandidate(merged, [section], ctx, sectionPatchValidators(ctx, merged));
  const validAfter = validAssetPlanSections(merged, ctx);
  const lost = validBefore.filter(item => !validAfter.includes(item));
  if (lost.length) {
    const error = new Error(`资产规划区段补丁覆盖了已有有效区段：${lost.join('、')}`);
    error.code = 'ASSET_PLAN_SECTION_PATCH_OVERWRITE';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  const saved = sectionRecovery.saveCheckpointAtomic(
    taskId,
    ASSET_PLAN_DRAFT_CHECKPOINT_KIND,
    merged,
    ctx,
    {
      ...options,
      generation_id: generationId,
      fingerprint: fingerprintValue,
      status: 'asset_plan_section_recovered',
      validators: recoverySectionValidators(ctx),
      extra: {
        last_recovered_section: section,
        last_used_model: result.used_model,
        last_language_repaired: language.repaired === true,
      },
    },
  );
  return {
    payload: saved.payload,
    section,
    model_meta: {
      used_model: result.used_model,
      fallback_used: result.fallback_used,
      failed_models: result.failed_models || [],
      language_repaired: language.repaired === true,
    },
  };
}

async function recoverAssetPlanSections(taskId, ctx = {}, partialPayload = {}, options = {}) {
  const requested = Array.isArray(options.required_sections) ? options.required_sections : null;
  let payload = { ...partialPayload };
  const recoveredSections = [];
  const modelMetas = [];
  sectionRecovery.saveCheckpointAtomic(
    taskId,
    ASSET_PLAN_DRAFT_CHECKPOINT_KIND,
    payload,
    ctx,
    {
      ...options,
      status: 'asset_plan_sections_recovery_ready',
      validators: recoverySectionValidators(ctx),
      allow_generation_handoff: true,
      replace_incompatible: options.replace_incompatible === true,
    },
  );
  while (true) {
    const remaining = missingAssetPlanSections(payload, ctx)
      .filter(section => !requested || requested.includes(section));
    if (!remaining.length) break;
    const section = remaining[0];
    stageProgress.update(taskId, {
      stage: 'scene_config', phase: `asset_plan_section_patch:${section}`, completed: recoveredSections.length, total: recoveredSections.length + remaining.length,
      generationId: cleanText(options.generation_id || options.generationId || '', 160),
      message: `正在只补齐 ${section}；已持久化区段不会重复生成`,
    });
    const recovered = await recoverAssetPlanSectionPatch(taskId, ctx, payload, section, options);
    payload = recovered.payload;
    recoveredSections.push(section);
    modelMetas.push(recovered.model_meta);
  }
  const stillMissing = missingAssetPlanSections(payload, ctx)
    .filter(section => !requested || requested.includes(section));
  if (stillMissing.length) {
    const error = new Error(`资产规划缺失区段恢复不完整：${stillMissing.join('、')}`);
    error.code = 'ASSET_PLAN_SECTION_RECOVERY_INCOMPLETE';
    error.status = 502;
    error.retryable = true;
    throw error;
  }
  storage.saveOutput(taskId, ASSET_PLAN_MISSING_SECTIONS_RECOVERY_KIND, {
    ...checkpointLineage.checkpointFields(storage.getTask(taskId) || {}, {
      generation_id: sectionRecovery.resolveGenerationId(storage.getTask(taskId) || {}, options),
    }),
    status: 'complete',
    contract_version: sectionRecovery.CONTRACT_VERSION,
    fingerprint: options.fingerprint || '',
    content_mode: contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode),
    recovered_sections: recoveredSections,
    remaining_missing_sections: missingAssetPlanSections(payload, ctx),
    used_models: modelMetas.map(item => item.used_model).filter(Boolean),
    created_at: new Date().toISOString(),
  }, { content_revision: Number(storage.getTask(taskId)?.content_revision || 1) || 1 });
  return {
    payload,
    recovered_sections: recoveredSections,
    model_meta: {
      used_model: modelMetas.map(item => item.used_model).filter(Boolean).join(' -> '),
      model_call_count: modelMetas.length,
      fallback_used: modelMetas.some(item => item.fallback_used === true),
      failed_models: modelMetas.flatMap(item => item.failed_models || []),
      language_repaired: modelMetas.some(item => item.language_repaired === true),
    },
  };
}

function saveNarrativeDraftCheckpoint(taskId, ctx = {}, payload = {}, options = {}, status = 'narrative_recovery_partial') {
  return sectionRecovery.saveCheckpointAtomic(
    taskId,
    ASSET_PLAN_DRAFT_CHECKPOINT_KIND,
    payload,
    ctx,
    {
      ...options,
      status,
      validators: recoverySectionValidators(ctx),
      allow_generation_handoff: true,
      replace_incompatible: options.replace_incompatible === true,
      extra: {
        content_skill: contentSkill.snapshot('narrative_story'),
        unified_model_meta: options.unified_model_meta || options.unifiedModelMeta || null,
      },
    },
  );
}

async function parseChineseRecoveryResult(taskId, ctx, result, kind) {
  const parsed = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'object',
    modelGateway,
    taskId,
    stage: 'new_story_ad.json_repair',
  });
  return outputLanguage.ensureChineseOutput({ payload: parsed, kind, taskId, context: ctx });
}

async function recoverNarrativeStoryDevelopment(taskId, ctx = {}, partialPayload = {}, options = {}) {
  const storyFactsStageBudgetMs = 285000;
  stageProgress.update(taskId, {
    stage: 'scene_config', phase: 'story_facts', completed: 0, total: 3,
    generationId: cleanText(options.generation_id || options.generationId || '', 80),
    message: '正在生成故事因果、关系发展与结构化制作变化事实；尚未产出合格区段',
  });
  const minimumBeats = storySceneCoverage.expectedBeatCount(ctx);
  const validateStoryFacts = (_text, meta = {}) => {
    const candidate = storySceneCoverage.compileAssetPlan({
      ...partialPayload,
      story_seed: meta.parsed_json?.story_seed || meta.parsed_json?.storySeed || {},
    });
    assertGeneratedContentMode(candidate, ctx, 'story_facts');
    const issues = storySceneCoverage.storySeedIssues(candidate.story_seed, ctx);
    if (issues.length) {
      const error = new Error(`剧情事实未覆盖完整因果链：${issues.join('；')}`);
      error.code = 'ASSET_PLAN_STORY_SCENE_COVERAGE_INCOMPLETE';
      error.retryable = true;
      error.story_scene_coverage_issues = issues;
      throw error;
    }
    return true;
  };
  let result;
  try {
    result = await modelGateway.generateText({
    taskId,
    stage: 'new_story_ad.story_facts',
    systemPrompt: storyFactsPrompt.developmentSystemPrompt(ctx),
    userPrompt: JSON.stringify(storyFactsPrompt.developmentUserPayload(ctx, partialPayload, minimumBeats)),
    maxTokens: 5200,
    temperature: 0.35,
    stageBudgetMs: storyFactsStageBudgetMs,
    structuredOutput: { mode: 'json_object', name: 'narrative_story_development' },
      validateText: validateStoryFacts,
    });
  } catch (error) {
    const repairableCode = ['PROVIDER_RESPONSE_INVALID', 'MODEL_JSON', 'PROVIDER_EMPTY_RESPONSE'].includes(String(error?.code || ''))
      || (Array.isArray(error?.failed_models)
        && error.failed_models.some(item => ['PROVIDER_RESPONSE_INVALID', 'MODEL_JSON', 'PROVIDER_EMPTY_RESPONSE'].includes(String(item?.code || '')))
        && cleanText(error?.candidate_text || '', 24000));
    if (!repairableCode) throw error;
    const baseSeed = error?.candidate_parsed_json?.story_seed || error?.candidate_parsed_json?.storySeed || {};
    const baseBeats = Array.isArray(baseSeed?.plot_beats || baseSeed?.plotBeats) ? (baseSeed.plot_beats || baseSeed.plotBeats) : [];
    const diagnosticIssues = error?.failed_models?.[0]?.response_diagnostics?.issues;
    const issues = Array.isArray(diagnosticIssues) && diagnosticIssues.length
      ? diagnosticIssues
      : String(error?.failed_models?.[0]?.message || error?.message || '').split(',').filter(Boolean);
    const repairScope = storySceneCoverage.buildStorySeedRepairScope(baseSeed, issues, minimumBeats);
    if (storyFactsPrompt.shouldUseCompactRetry(baseBeats, repairScope, minimumBeats)) {
      result = await modelGateway.generateText({
        taskId,
        stage: 'new_story_ad.story_facts_compact_retry',
        systemPrompt: storyFactsPrompt.compactRetrySystemPrompt(ctx),
        userPrompt: JSON.stringify(storyFactsPrompt.compactRetryUserPayload(
          ctx,
          partialPayload,
          minimumBeats,
          baseBeats,
          issues,
        )),
        maxTokens: 4200,
        temperature: 0.1,
        maxCandidates: 3,
        stageBudgetMs: storyFactsStageBudgetMs,
        structuredOutput: { mode: 'json_object', name: 'narrative_story_facts_compact_retry' },
        validateText: validateStoryFacts,
      });
    } else {
    if (!cleanText(error?.candidate_text || '', 24000)) throw error;
    let repairedSeed = null;
    const repairResult = await modelGateway.generateText({
      taskId,
      stage: 'new_story_ad.story_facts_repair',
      systemPrompt: storyFactsPrompt.repairSystemPrompt(ctx),
      userPrompt: JSON.stringify(storyFactsPrompt.repairUserPayload(
        ctx,
        minimumBeats,
        issues,
        repairScope,
      )),
      maxTokens: 3200,
      temperature: 0.1,
      maxCandidates: 3,
      stageBudgetMs: storyFactsStageBudgetMs,
      structuredOutput: { mode: 'json_object', name: 'narrative_story_facts_patch' },
      validateText: (_text, meta = {}) => {
        repairedSeed = storySceneCoverage.mergeStorySeedPatch(baseSeed, meta.parsed_json || {}, { repair_scope: repairScope });
        return validateStoryFacts('', { parsed_json: { story_seed: repairedSeed } });
      },
    });
    result = {
      ...repairResult,
      text: JSON.stringify({ story_seed: repairedSeed }),
      parsed_json: { story_seed: repairedSeed },
      repair_patch: repairResult.parsed_json || null,
    };
    }
  }
  const language = await parseChineseRecoveryResult(taskId, ctx, result, 'story_seed');
  const storySeed = storySceneCoverage.compileStorySeed(language.payload?.story_seed || language.payload?.storySeed || {});
  const issues = storySceneCoverage.storySeedIssues(storySeed, ctx);
  if (issues.length) storySceneCoverage.assertCoverage({ story_seed: storySeed, scene_plan: { spaces: [] } }, ctx);
  return { story_seed: storySeed, result, language };
}

async function recoverNarrativeSceneCoverage(taskId, ctx = {}, partialPayload = {}, options = {}) {
  stageProgress.update(taskId, {
    stage: 'scene_config', phase: 'topology_compilation', completed: 1, total: 3,
    generationId: cleanText(options.generation_id || options.generationId || '', 80),
    message: '故事事实已保存，平台正在确定性编译场次拓扑；此阶段不调用模型',
  });
  const scenePlan = storySceneCoverage.compileScenePlan(partialPayload.story_seed || {}, partialPayload.scene_plan || {});
  storySceneCoverage.assertCoverage({ ...partialPayload, scene_plan: scenePlan }, ctx);
  return {
    scene_plan: scenePlan,
    result: { used_model: '', fallback_used: false, failed_models: [] },
    language: { repaired: false },
    deterministic: true,
  };
}

async function recoverMissingAssetPlanSections(taskId, ctx = {}, partialPayload = {}, options = {}) {
  if (contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode) !== 'narrative_story'
    || !storySceneCoverage.required(ctx)) {
    return recoverAssetPlanSections(taskId, ctx, partialPayload, options);
  }

  let payload = { ...partialPayload };
  const recoveredSections = [];
  const modelMetas = [];
  const identityMissing = missingAssetPlanSections(payload, ctx).filter(section => ['cast_profiles', 'prop_plan'].includes(section));
  if (identityMissing.length) {
    const identity = await recoverAssetPlanSections(taskId, ctx, payload, { ...options, required_sections: identityMissing });
    payload = identity.payload;
    recoveredSections.push(...identity.recovered_sections);
    if (identity.model_meta) modelMetas.push(identity.model_meta);
    saveNarrativeDraftCheckpoint(taskId, ctx, payload, options, 'narrative_identity_recovered');
  }
  if (!validStorySeedSection(payload, ctx)) {
    const story = await recoverNarrativeStoryDevelopment(taskId, ctx, payload, options);
    payload = { ...payload, story_seed: story.story_seed };
    recoveredSections.push('story_seed');
    modelMetas.push({
      used_model: story.result.used_model, fallback_used: story.result.fallback_used,
      failed_models: story.result.failed_models || [], language_repaired: story.language.repaired,
    });
    saveNarrativeDraftCheckpoint(taskId, ctx, payload, options, 'narrative_story_locked');
  }
  if (!validScenePlanSection(payload, ctx)) {
    const scenes = await recoverNarrativeSceneCoverage(taskId, ctx, payload, options);
    payload = { ...payload, scene_plan: scenes.scene_plan };
    recoveredSections.push('scene_plan');
    if (!scenes.deterministic) modelMetas.push({
      used_model: scenes.result.used_model, fallback_used: scenes.result.fallback_used,
      failed_models: scenes.result.failed_models || [], language_repaired: scenes.language.repaired,
    });
    saveNarrativeDraftCheckpoint(taskId, ctx, payload, options, 'narrative_scene_coverage_complete');
  }
  storySceneCoverage.assertCoverage(payload, ctx);
  const remainingMissing = missingAssetPlanSections(payload, ctx);
  if (remainingMissing.length) {
    const error = new Error(`剧情资产规划分阶段恢复仍不完整：${remainingMissing.join('、')}`);
    error.code = 'ASSET_PLAN_SECTION_RECOVERY_INCOMPLETE';
    error.retryable = true;
    throw error;
  }
  storage.saveOutput(taskId, ASSET_PLAN_MISSING_SECTIONS_RECOVERY_KIND, {
    status: 'complete', content_mode: 'narrative_story', recovered_sections: recoveredSections,
    used_models: modelMetas.map(item => item.used_model).filter(Boolean), created_at: new Date().toISOString(),
  });
  return {
    payload,
    recovered_sections: [...new Set(recoveredSections)],
    model_meta: {
      used_model: modelMetas.map(item => item.used_model).filter(Boolean).join(' -> '),
      model_call_count: modelMetas.length,
      fallback_used: modelMetas.some(item => item.fallback_used === true),
      failed_models: modelMetas.flatMap(item => item.failed_models || []),
      language_repaired: modelMetas.some(item => item.language_repaired === true),
    },
  };
}

function propDrafts(plan = {}, existing = []) {
  const saved = new Map((Array.isArray(existing) ? existing : [])
    .map(item => [String(item.id || item.prop_id || ''), item]));
  return (plan.prop_plan || [])
    .map((item, index) => propIdentity.normalizeProp(item, index))
    .filter(item => !(item.type === 'advertised_product' && item.source === 'reference_evidence_candidate'))
    .filter(item => item.type !== 'fixed_scene_object')
    .map((item) => {
      const previous = saved.get(String(item.id));
      if (previous && previous.status !== 'planned_not_generated') return previous;
      return {
        ...item,
        prop_id: item.id,
        contract: propIdentity.buildContract(item),
        image_url: '',
        cover_image_url: '',
        view_images: [],
        state_views: [],
        category_atlases: [],
        shot_timeline: [],
        status: 'planned_not_generated',
      };
    });
}

function attachFixedPropsToScenes(plan = {}) {
  const fixed = (plan.prop_plan || [])
    .map((item, index) => propIdentity.normalizeProp(item, index))
    .filter(item => item.type === 'fixed_scene_object');
  if (!fixed.length) return plan;
  const spaces = (plan.scene_plan?.spaces || []).map((space) => {
    const spec = { ...(space.scene_spec || {}) };
    const existing = Array.isArray(spec.propPlacements) ? spec.propPlacements : [];
    const additions = fixed
      .filter(prop => !prop.scene_id || String(prop.scene_id) === String(space.id))
      .map(prop => ({
        prop_id: prop.id,
        name: prop.name,
        quantity: prop.quantity,
        placement: prop.placement || prop.description,
        owner_id: prop.owner_id,
        fixed: true,
      }));
    spec.propPlacements = [...existing, ...additions].filter((item, index, rows) => (
      rows.findIndex(other => String(other.prop_id || other.name) === String(item.prop_id || item.name)) === index
    ));
    return { ...space, scene_spec: spec };
  });
  return { ...plan, scene_plan: { ...plan.scene_plan, spaces } };
}

function persist(taskId, ctx, rawPlan, meta) {
  const plan = attachFixedPropsToScenes(normalizePlan(rawPlan, ctx));
  const activePlan = assetPlanPublication.publish(taskId, plan, meta);
  const nextPlan = { ...activePlan, ...meta };
  const props = propDrafts(plan, ctx.prop_assets);
  const castFingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(canonical(plan.cast_profiles || [])))
    .digest('hex');
  const primaryCast = plan.cast_profiles[0] || {};
  const personCounts = personCountContract.contract({
    ...ctx,
    cast_profiles: plan.cast_profiles,
    narrative_cast_profiles: plan.narrative_cast_profiles,
    planning_cast_count: plan.narrative_cast_profiles.length,
    narrative_identity_count: plan.narrative_cast_profiles.length,
    visual_asset_count: plan.cast_profiles.length,
  });
  const projectedProductContract = plan.advertised_subject_contract
    ? productIdentity.buildProductContract({
        ...ctx,
        advertised_subject_contract: plan.advertised_subject_contract,
      })
    : ctx.product_contract;
  const personSpec = {
    ...(ctx.person_spec || {}),
    castMode: plan.scene_plan.cast_mode || ctx.cast_mode || 'auto',
    expectedPeople: plan.scene_plan.cast_mode === 'no_human' ? 0 : plan.cast_profiles.length,
    narrativeIdentityCount: personCounts.narrative_identity_count,
    planningCastCount: personCounts.planning_cast_count,
    visualAssetCount: personCounts.visual_asset_count,
    displayName: primaryCast.displayName || primaryCast.name || '',
    roleName: primaryCast.roleName || primaryCast.role || '',
    age: primaryCast.age || primaryCast.age_range || 'match_brief',
    appearanceText: primaryCast.appearanceText || '',
    wardrobeText: primaryCast.wardrobeText || '',
    look_profiles: primaryCast.look_profiles || [],
    hairMakeupText: primaryCast.hairMakeupText || '',
    negativeText: primaryCast.negativeText || '',
  };
  const nextContext = assertContextConsistent({
    ...ctx,
    cast_profiles: plan.cast_profiles,
    narrative_cast_profiles: plan.narrative_cast_profiles,
    pet_profiles: plan.pet_profiles,
    cast_mode: plan.scene_plan.cast_mode || ctx.cast_mode,
    expected_people: plan.scene_plan.cast_mode === 'no_human' ? 0 : plan.cast_profiles.length,
    narrative_identity_count: personCounts.narrative_identity_count,
    planning_cast_count: personCounts.planning_cast_count,
    visual_asset_count: personCounts.visual_asset_count,
    prop_plan: plan.prop_plan,
    prop_assets: props,
    story_seed: plan.story_seed,
    advertised_subject_contract: plan.advertised_subject_contract || ctx.advertised_subject_contract || null,
    product_contract: projectedProductContract,
    person_spec: personSpec,
    asset_plan_fingerprint: meta.fingerprint,
    asset_plan_generated_cast_fingerprint: castFingerprint,
    asset_setup_confirmed: false,
    shot_design_confirmed: false,
  });
  storage.saveOutput(taskId, 'asset_plan', nextPlan);
  storage.saveOutput(taskId, 'scene_config', plan.scene_plan);
  storage.saveOutput(taskId, 'prop_assets', props);
  storage.saveOutput(taskId, 'context', nextContext);
  storage.updateTask(taskId, checkpointLineage.currentPlanningTaskPatch(), { systemFinalization: true });
  return nextPlan;
}

function syncPrevious(taskId) {
  const task = storage.getTask(taskId);
  const ctx = storage.getOutput(taskId, 'context') || task?.request || {};
  const previous = assetPlanPublication.currentPlan(taskId);
  if (!task || !complete(previous)) {
    const error = new Error('No complete asset plan is available for safe context synchronization');
    error.code = 'ASSET_PLAN_SYNC_SOURCE_REQUIRED';
    throw error;
  }
  const synchronized = persist(taskId, assertContextConsistent(ctx), previous, {
    fingerprint: fingerprint(task, ctx),
    source: previous.source,
    model_meta: previous.model_meta,
    completed_at: previous.completed_at,
    synchronized_at: new Date().toISOString(),
  });
  storage.saveStage(taskId, 'scene_config', {
    status: 'done',
    output_summary: 'Complete asset plan synchronized to person, prop and scene context',
    diagnostics: { fingerprint: synchronized.fingerprint, cache_hit: true, synchronized: true },
  });
  storage.updateTask(taskId, {
    status: 'running',
    stage: 'scene_config_done',
    active_generation_id: '',
    active_stage: '',
  });
  stageProgress.update(taskId, {
    stage: 'scene_config',
    status: 'done',
    phase: 'persisted',
    completed: 3,
    total: 3,
    generationId: '',
    message: '人物、道具和场景资产计划已从完整缓存同步',
  });
  return synchronized;
}

async function generate(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const forceSceneCoverageReplan = options.replan_scene_coverage === true || options.replanSceneCoverage === true;
  let ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  if (forceSceneCoverageReplan && contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode) === 'narrative_story') {
    ctx = { ...ctx, story_scene_contract_version: storySceneCoverage.CONTRACT_VERSION };
    storage.updateTask(taskId, { request: { ...(task.request || {}), story_scene_contract_version: storySceneCoverage.CONTRACT_VERSION } });
    storage.saveOutput(taskId, 'context', ctx, { content_revision: task.content_revision });
  }
  assertReferenceReady(ctx.reference_video_analysis);
  productAssetResolver.assertCommercialSubject(ctx, {
    code: 'ASSET_PLAN_AD_SUBJECT_REQUIRED',
    message: '未从内容目标或参考视频中识别出明确的产品、服务或品牌；请补充广告主体后再创建资产方案，本次没有调用模型',
  });
  const generationId = cleanText(options.generation_id || options.generationId || '', 80);
  const currentFingerprint = fingerprint(task, ctx);
  const previous = assetPlanPublication.currentPlan(taskId);
  if (!forceSceneCoverageReplan && previous?.fingerprint === currentFingerprint && complete(previous, ctx)) {
    persist(taskId, ctx, previous, {
      fingerprint: previous.fingerprint,
      source: previous.source,
      model_meta: previous.model_meta,
      completed_at: previous.completed_at,
    });
    storage.saveStage(taskId, 'scene_config', {
      status: 'done',
      output_summary: '资产计划输入未变化，已复用完整结果',
      diagnostics: { fingerprint: currentFingerprint, cache_hit: true, source: previous.source },
    });
    stageProgress.update(taskId, {
      stage: 'scene_config',
      status: 'done',
      phase: 'fingerprint_reused',
      completed: 3,
      total: 3,
      generationId,
      message: '输入指纹一致，已复用人物、道具和场景资产计划',
    });
    return previous.scene_plan;
  }

  storage.updateTask(taskId, { status: 'running', stage: 'scene_config' });
  storage.saveStage(taskId, 'scene_config', { status: 'running', input_summary: ctx.brief });
  stageProgress.update(taskId, {
    stage: 'scene_config',
    phase: 'context_ready',
    completed: 0,
    total: 3,
    generationId,
    message: '已确认当前项目输入，准备统一规划人物、道具和场景',
  });

  let plan;
  let modelMeta;
  const authoritativeUserBrief = ctx.brief_source === 'user' && cleanText(ctx.brief, 3000);
  if (referenceIsValid(ctx.reference_video_analysis) && !authoritativeUserBrief) {
    plan = normalizePlan(projectReferencePlan(ctx), ctx);
    modelMeta = { source: 'reference_analysis_projection', model_call_count: 0 };
  } else {
    const currentContentMode = contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode);
    const systemPrompt = [
      currentContentMode === 'narrative_story'
        ? '你是纯剧情统一资产规划 agent，只输出 JSON 对象；本任务不是广告。'
        : '你是商业广告统一资产规划 agent，只输出 JSON 对象。',
      '一次完成原创人物、独立道具、物理场景和故事种子的规划，不得把同一需求拆成多次模型理解。',
      '人物模式严格遵守用户人数与是否无人；固定场景物只能放入场景，不得当作独立道具图片生成。',
      '用户原文是事实权威：人物数量、时代对应关系、明确地点和人物动作必须逐项保留，不得为了“更像广告”而替换、合并或补成其它行业空间。',
      '先识别跨时代人物关系，再建立人物方案：只有原文明确“本人穿越、两人共同穿越、长生者本人活到现代、同一身份来到未来”时，identity_continuity 才能写 same_person，古今姓名保持不变；“转生、转世、轮回、投胎、来生、后世化身”必须写 reincarnation，视为新的独立人物身份，禁止沿用前世姓名。',
      '转世人物必须在对应现代 look_profile.character_name 写出自己的正式姓名；原文没有提供时也必须生成一个符合现代背景的正式姓名，并将 name_source 写为 planner_generated，不能写“转世女主、现代女子、云知月（现代）”等占位名或沿用前世姓名。',
      '同一时代内的普通换装可使用多个 look_profiles；古代与现代、前世与今生等跨时代状态不得作为同一人物资产的两套造型交付，必须由平台拆成独立人物档案。',
      `cast_profiles 必须严格输出 ${personCountContract.contract(ctx).planning_cast_count} 个剧情身份，而不是 ${personCountContract.contract(ctx).visual_asset_count} 张分时代素材卡。同一本人跨时代只占一个剧情身份并保留多个 look_profiles；转世必须单列为新身份和新姓名。平台会在规划通过后再投影为分时代素材卡。`,
      worldSetting.promptBlock(ctx.world_setting),
      currentContentMode === 'narrative_story'
        ? '本任务是纯剧情：scene_plan.advertised_subject 必须为 JSON 空字符串，禁止 advertised_product、商品、品牌、卖点、购买引导和销售转化。'
        : '本任务是商业广告：必须保留明确广告主体和可核对的主体证据，不得套用纯剧情空主体结构。',
      storySceneCoverage.promptBlock(ctx),
      '每个独立物理空间必须有稳定 ID 和完整 scene_spec。',
      visualRealismPolicy.sceneSpecRealismRuleZh(),
    ].join('\n');
    const userPrompt = `${contextPrompt(ctx)}

输出顺序硬要求：必须先输出 story_seed.plot_beats，再输出 cast_profiles、prop_plan。纯剧情模式只输出结构化故事事实，场景拓扑由平台编译；即使输出额度接近上限，也不得省略 plot_beats。

输出严格 JSON：
{
  "story_seed":${currentContentMode === 'narrative_story'
    ? '{"logline":"故事梗概","opening":"","development":"","turning_point":"","resolution":"","plot_beats":[{"id":"稳定节拍ID","phase":"opening/development/turning_point/resolution/transition","era":"来自输入的时间层/时期","time_anchor":"明确时间位置","location":"具体地点","production_state":"该节拍可见环境状态","production_relation":{"era":"same/continuous/changed","time":"same/continuous/changed","location":"same/continuous/changed","environment":"same/continuous/changed"},"production_requirements":{"layout":"布局事实","material_light":"材质光线事实","interaction":"动作区和路线事实","negative":"禁止内容"},"scene_change_reason":"关系说明","summary":"可见剧情动作","cause":"发生原因","consequence":"造成结果"}]}'
    : '{"logline":"广告故事梗概","opening":"","development":"","turning_point":"","resolution":""}'},
  "cast_profiles": [{"id":"稳定人物ID","name":"人物名称","role":"剧情职责","appearanceText":"原创外貌与气质","wardrobeText":"首个造型的兼容字段","look_profiles":[{"id":"稳定造型ID","name":"造型名称","story_state":"时代或剧情状态","scene_ids":["适用场景ID"],"scene_names":["适用场景名称"],"world_profile_id":"world_setting中的稳定ID","wardrobeText":"该造型固定服装鞋履配饰","hairMakeupText":"该造型固定发型妆容","negativeText":"该造型禁止项","continuityText":"该造型内部一致性","style_family":"知识风格ID或task_defined","wardrobe_contract":{"garment_system":{"mode":"one_piece/top_bottom/layered","items":[{"slot":"upper/lower/one_piece/ensemble/outerwear","type":"具体单品","evidence":"证据"}]},"footwear":{"type":"类型","color":"颜色","material":"材质","evidence":"证据"},"accessories":{"mode":"specified/none","items":[],"evidence":"证据"},"palette":{"colors":["主色","辅色"],"evidence":"证据"},"materials":[{"name":"材质","used_for":"位置","evidence":"证据"}],"negative_constraints":[],"knowledge_doc_ids":[]}}],"performanceText":"表演与动作","continuityText":"人物身份跨镜一致性","negativeText":"全局禁止项"}],
  "prop_plan": [{"id":"稳定道具ID","name":"名称","type":"${currentContentMode === 'narrative_story' ? 'wearable_accessory/story_prop/fixed_scene_object' : 'advertised_product/wearable_accessory/story_prop/fixed_scene_object'}","description":"身份、材质、比例和使用方式","states":[],"owner_id":"","scene_id":""}],
  "scene_plan": {
    "business_boundary":"业务边界","advertised_subject":"${currentContentMode === 'narrative_story' ? '' : '明确广告主体'}","cast_mode":"single/dual/multi/no_human/animal/human_pet/auto","scene_mode":"single/multi",
    "spaces":[{"id":"稳定空间ID","name":"中文空间名","description":"仅描述该独立空间","story_purpose":"剧情作用","scene_spec":{"layoutText":"布局、出入口和固定结构","materialLightText":"材质、色彩和光线","interactionText":"动作区、锚点与路线","negativeText":"禁止出现内容","storyStates":[],"interactionAnchors":[],"routes":[],"propPlacements":[],"sceneExperienceContract":{"required_authority":"panorama_3dof或geometry_6dof","representation":"physical或digital或abstract","extent":"enclosed或open或stage或screen","rotation_required":true,"translation_required":false,"actor_blocking_required":false,"camera_path_required":false,"metric_scale_required":false}}}],
    "asset_strategy":[],"story_strategy":[],"forbidden":[],"suggested_shot_count":5
  }
}`;
    const persistedDraft = storage.getOutput(taskId, ASSET_PLAN_DRAFT_CHECKPOINT_KIND);
    const replanDraft = forceSceneCoverageReplan && previous ? {
      ...checkpointLineage.checkpointFields(task),
      status: 'story_scene_coverage_replan',
      fingerprint: currentFingerprint,
      content_mode: currentContentMode,
      reusable: true,
      payload: {
        cast_profiles: previous.cast_profiles || [],
        pet_profiles: previous.pet_profiles || [],
        prop_plan: previous.prop_plan || [],
        advertised_subject_contract: previous.advertised_subject_contract || ctx.advertised_subject_contract || null,
        scene_plan: { spaces: [] },
        story_seed: currentContentMode === 'narrative_story' ? {} : (previous.story_seed || {}),
      },
      unified_model_meta: previous.model_meta || null,
      created_at: new Date().toISOString(),
    } : null;
    const rawStoredDraft = replanDraft || persistedDraft;
    const storedDraftCompatibility = checkpointLineage.compatibility(task, rawStoredDraft, {
      fingerprint: currentFingerprint,
      contentMode: currentContentMode,
      requireReusable: true,
    });
    const storedDraft = storedDraftCompatibility.reusable ? rawStoredDraft : null;
    let payload;
    let unifiedMeta = null;
    let unifiedModelCallCount = 0;
    let reusedDraft = false;
    if (storedDraft?.fingerprint === currentFingerprint
      && storedDraft?.content_mode === currentContentMode
      && reusableDraftPayload(storedDraft.payload, ctx)
      && missingAssetPlanSections(storedDraft.payload, ctx).length > 0) {
      payload = storedDraft.payload;
      reusedDraft = true;
    } else {
      const result = await modelGateway.generateText({
        taskId,
        stage: 'new_story_ad.asset_plan',
        systemPrompt,
        userPrompt,
        maxTokens: 6200,
        temperature: 0.2,
        timeoutMs: 90000,
        maxCandidates: 3,
        stageBudgetMs: 300000,
        structuredOutput: { mode: 'json_object', name: 'unified_asset_plan' },
        validateText: (_text, meta = {}) => {
          assertGeneratedContentMode(meta.parsed_json || {}, ctx, 'asset_plan');
          return true;
        },
      });
      unifiedModelCallCount = 1;
      const draft = await jsonRepair.parseOrRepair({
        raw: result.text,
        expected: 'object',
        modelGateway,
        taskId,
        stage: 'new_story_ad.json_repair',
      });
      const language = await outputLanguage.ensureChineseOutput({
        payload: draft,
        kind: 'asset_plan',
        taskId,
        context: ctx,
      });
      assertGeneratedContentMode(language.payload, ctx, 'asset_plan_language');
      payload = language.payload;
      unifiedMeta = {
        used_model: result.used_model,
        fallback_used: result.fallback_used,
        failed_models: result.failed_models || [],
        language_repaired: language.repaired,
        language_assessment: language.assessment,
      };
    }
    if (currentContentMode === 'narrative_story'
      && Array.isArray(payload?.story_seed?.plot_beats || payload?.storySeed?.plotBeats)
      && (payload.story_seed?.plot_beats || payload.storySeed?.plotBeats).length
      && !validScenePlanSection(payload, ctx)) {
      payload = storySceneCoverage.compileAssetPlan(payload);
    }
    let recoveryMeta = null;
    let recoveredSections = [];
    const missingSections = missingAssetPlanSections(payload, ctx);
    if (missingSections.length) {
      sectionRecovery.saveCheckpointAtomic(
        taskId,
        ASSET_PLAN_DRAFT_CHECKPOINT_KIND,
        payload,
        ctx,
        {
          ...options,
          generation_id: generationId,
          fingerprint: currentFingerprint,
          status: 'asset_plan_sections_missing',
          validators: recoverySectionValidators(ctx),
          allow_generation_handoff: true,
          // An explicit replan draft is synthesized from the current published
          // people/props and current release envelope. It is not the persisted
          // checkpoint we are about to CAS against. Permit replacement only
          // for this explicit transaction; saveCheckpointAtomic still verifies
          // the live task bundle, content revision and generation before write.
          replace_incompatible: Boolean(replanDraft) || !storedDraft,
          extra: {
            content_skill: contentSkill.snapshot(currentContentMode),
            unified_model_meta: unifiedMeta || storedDraft?.unified_model_meta || null,
          },
        },
      );
      try {
        const recovered = await recoverMissingAssetPlanSections(taskId, ctx, payload, {
          ...options,
          fingerprint: currentFingerprint,
        });
        payload = recovered.payload;
        recoveredSections = recovered.recovered_sections || [];
        recoveryMeta = recovered.model_meta;
      } catch (error) {
        const latestDraft = storage.getOutput(taskId, ASSET_PLAN_DRAFT_CHECKPOINT_KIND);
        const latestPayload = latestDraft?.payload || payload;
        storage.saveOutput(taskId, ASSET_PLAN_MISSING_SECTIONS_RECOVERY_KIND, {
          ...checkpointLineage.checkpointFields(task, { generation_id: generationId }),
          status: 'failed',
          contract_version: sectionRecovery.CONTRACT_VERSION,
          fingerprint: currentFingerprint,
          content_mode: currentContentMode,
          valid_sections: validAssetPlanSections(latestPayload, ctx),
          missing_sections: missingAssetPlanSections(latestPayload, ctx),
          error_code: cleanText(error?.code || 'ASSET_PLAN_SECTIONS_RECOVERY_FAILED', 100),
          error: cleanText(error?.message || error, 800),
          created_at: new Date().toISOString(),
        }, { content_revision: Number(task.content_revision || 1) || 1 });
        throw error;
      }
    }
    storySceneCoverage.assertCoverage(payload, ctx);
    plan = assertContentModeIsolation(normalizePlan(payload, ctx), ctx);
    briefAuthority.assertPlanAuthority(plan, ctx);
    storage.deleteOutput(taskId, ASSET_PLAN_DRAFT_CHECKPOINT_KIND);
    modelMeta = {
      source: recoveryMeta ? 'unified_model_plan_with_missing_sections_recovery' : 'unified_model_plan',
      model_call_count: unifiedModelCallCount + Number(recoveryMeta?.model_call_count || (recoveryMeta ? 1 : 0)),
      used_model: recoveryMeta?.used_model || unifiedMeta?.used_model || storedDraft?.unified_model_meta?.used_model || '',
      fallback_used: recoveryMeta?.fallback_used === true || unifiedMeta?.fallback_used === true,
      failed_models: [...(unifiedMeta?.failed_models || []), ...(recoveryMeta?.failed_models || [])],
      language_repaired: unifiedMeta?.language_repaired === true || recoveryMeta?.language_repaired === true,
      language_assessment: unifiedMeta?.language_assessment || null,
      draft_checkpoint_reused: reusedDraft,
      scene_recovery_used: Boolean(recoveryMeta),
      missing_sections_recovery_used: Boolean(recoveryMeta),
      recovered_sections: recoveredSections,
      content_mode: currentContentMode,
      content_skill: contentSkill.snapshot(currentContentMode),
    };
  }

  stageProgress.update(taskId, {
    stage: 'scene_config',
    phase: 'structure_validated',
    completed: 2,
    total: 3,
    generationId,
    message: '人物、道具和场景资产计划结构已通过校验',
  });
  persist(taskId, ctx, plan, {
    fingerprint: currentFingerprint,
    source: modelMeta.source,
    model_meta: modelMeta,
    completed_at: new Date().toISOString(),
  });
  storage.saveStage(taskId, 'scene_config', {
    status: 'done',
    output_summary: '统一资产计划已生成',
    diagnostics: { ...modelMeta, fingerprint: currentFingerprint, cache_hit: false },
  });
  storage.updateTask(taskId, { status: 'running', stage: 'scene_config_done' });
  stageProgress.update(taskId, {
    stage: 'scene_config',
    status: 'done',
    phase: 'persisted',
    completed: 3,
    total: 3,
    generationId,
    message: '人物、道具和场景资产计划已保存',
  });
  return plan.scene_plan;
}

module.exports = {
  fingerprint,
  referenceIsValid,
  assertReferenceReady,
  advertisedSubjectContract,
  projectReferencePlan,
  projectReferenceIntake,
  referenceProjectionFingerprint,
  normalizePlan,
  complete,
  validAssetPlanSections,
  missingAssetPlanSections,
  reusableDraftPayload,
  narrativeSubjectMarker,
  rawContentModeViolations,
  normalizeContentModeMarkers,
  assertGeneratedContentMode,
  assertContentModeIsolation,
  syncPrevious,
  generate,
};
