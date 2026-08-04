const crypto = require('crypto');
const storage = require('./storageService');
const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const outputLanguage = require('./outputLanguageService');
const stageProgress = require('./stageProgressService');
const visualRealismPolicy = require('./visualRealismPolicyService');
const propIdentity = require('./propIdentityContractService');
const { contextPrompt, cleanText, assertContextConsistent } = require('./contextBuilder');
const { normalizeScenePlan, assertScenePlanContract } = require('./sceneBindingService');

const ASSET_PLAN_PROJECTION_VERSION = 3;

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
    brief: ctx.brief,
    product_subject: ctx.product_subject,
    reference_analysis: ctx.reference_video_analysis || null,
    cast_profiles: castProfiles,
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
  return {
    cast_profiles: castProfiles,
    pet_profiles: petProfiles,
    // 参考视频识别出的广告主体已经进入 product_subject / advertised_subject。
    // 它不是剧情中需要单独持有、移动或改变状态的道具，不能重复投影成“独立道具”。
    prop_plan: [],
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
      source: 'reference_analysis_projection',
      projection_only: true,
    },
  };
}

function normalizePlan(source = {}, ctx = {}) {
  const scenePlan = normalizeScenePlan(source.scene_plan || source.scenePlan || source.scene_config || source.sceneConfig || {});
  assertScenePlanContract(scenePlan);
  const castProfiles = Array.isArray(source.cast_profiles || source.castProfiles)
    ? (source.cast_profiles || source.castProfiles).slice(0, 12)
    : (ctx.cast_profiles || []);
  return {
    cast_profiles: castProfiles.map((profile, index) => ({
      ...profile,
      id: cleanText(profile.id || `cast_${index + 1}`, 100),
      displayName: cleanText(profile.displayName || profile.name || `人物${index + 1}`, 120),
      name: cleanText(profile.name || profile.displayName || `人物${index + 1}`, 120),
      roleName: cleanText(profile.roleName || profile.role || '', 160),
      appearanceText: cleanText(profile.appearanceText || profile.appearance || '', 800),
      wardrobeText: cleanText(profile.wardrobeText || profile.wardrobe || '', 600),
      hairMakeupText: cleanText(
        profile.hairMakeupText || profile.hair_makeup || '自然真实的发型与妆容，严格匹配人物外貌、年龄和职业气质',
        400,
      ),
      negativeText: cleanText(profile.negativeText || profile.negative || '', 500),
    })),
    pet_profiles: Array.isArray(source.pet_profiles || source.petProfiles)
      ? (source.pet_profiles || source.petProfiles).slice(0, 12)
      : (ctx.pet_profiles || []),
    prop_plan: Array.isArray(source.prop_plan || source.propPlan)
      ? (source.prop_plan || source.propPlan).slice(0, 24)
      : [],
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
  const nextContext = assertContextConsistent({
    ...projectionContext,
    brief: keepUserBrief ? cleanText(projectionContext.brief, 3000) : referenceBrief,
    brief_source: keepUserBrief ? 'user' : 'reference_analysis',
    cast_profiles: castProfiles,
    pet_profiles: petProfiles,
    cast_mode: projectedPeople && projectedPets ? plan.scene_plan.cast_mode : projectionContext.cast_mode,
    expected_people: castProfiles.length,
    expected_animals: petProfiles.length,
    story_seed: storySeed,
    person_spec: projectedPeople ? {
      ...(projectionContext.person_spec || {}),
      castMode: plan.scene_plan.cast_mode,
      expectedPeople: castProfiles.length,
      displayName: primaryCast.displayName || primaryCast.name || '',
      roleName: primaryCast.roleName || primaryCast.role || '',
      age: primaryCast.age || primaryCast.age_range || 'match_brief',
      appearanceText: primaryCast.appearanceText || '',
      wardrobeText: primaryCast.wardrobeText || '',
      negativeText: primaryCast.negativeText || '',
    } : projectionContext.person_spec,
    pet_contract: projectedPets && petProfiles.length ? {
      status: 'declared',
      expected_animals: petProfiles.length,
      profiles: petProfiles,
      source: 'reference_analysis_projection',
    } : projectionContext.pet_contract,
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

function complete(plan = null) {
  return Boolean(
    plan
    && Array.isArray(plan.cast_profiles)
    && Array.isArray(plan.prop_plan)
    && plan.story_seed
    && Array.isArray(plan.scene_plan?.spaces)
    && plan.scene_plan.spaces.length,
  );
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
  const nextPlan = { ...plan, ...meta };
  const props = propDrafts(plan, ctx.prop_assets);
  const castFingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(canonical(plan.cast_profiles || [])))
    .digest('hex');
  const primaryCast = plan.cast_profiles[0] || {};
  const personSpec = {
    ...(ctx.person_spec || {}),
    castMode: plan.scene_plan.cast_mode || ctx.cast_mode || 'auto',
    expectedPeople: plan.scene_plan.cast_mode === 'no_human' ? 0 : plan.cast_profiles.length,
    displayName: primaryCast.displayName || primaryCast.name || '',
    roleName: primaryCast.roleName || primaryCast.role || '',
    age: primaryCast.age || primaryCast.age_range || 'match_brief',
    appearanceText: primaryCast.appearanceText || '',
    wardrobeText: primaryCast.wardrobeText || '',
    hairMakeupText: primaryCast.hairMakeupText || '',
    negativeText: primaryCast.negativeText || '',
  };
  const nextContext = assertContextConsistent({
    ...ctx,
    cast_profiles: plan.cast_profiles,
    pet_profiles: plan.pet_profiles,
    cast_mode: plan.scene_plan.cast_mode || ctx.cast_mode,
    expected_people: plan.scene_plan.cast_mode === 'no_human' ? 0 : plan.cast_profiles.length,
    prop_plan: plan.prop_plan,
    prop_assets: props,
    story_seed: plan.story_seed,
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
  return nextPlan;
}

function syncPrevious(taskId) {
  const task = storage.getTask(taskId);
  const ctx = storage.getOutput(taskId, 'context') || task?.request || {};
  const previous = storage.getOutput(taskId, 'asset_plan');
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
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  assertReferenceReady(ctx.reference_video_analysis);
  const generationId = cleanText(options.generation_id || options.generationId || '', 80);
  const currentFingerprint = fingerprint(task, ctx);
  const previous = storage.getOutput(taskId, 'asset_plan');
  if (previous?.fingerprint === currentFingerprint && complete(previous)) {
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
  if (referenceIsValid(ctx.reference_video_analysis)) {
    plan = normalizePlan(projectReferencePlan(ctx), ctx);
    modelMeta = { source: 'reference_analysis_projection', model_call_count: 0 };
  } else {
    const systemPrompt = [
      '你是剧情广告统一资产规划 agent，只输出 JSON 对象。',
      '一次完成原创人物、独立道具、物理场景和故事种子的规划，不得把同一需求拆成多次模型理解。',
      '人物模式严格遵守用户人数与是否无人；固定场景物只能放入场景，不得当作独立道具图片生成。',
      '每个独立物理空间必须有稳定 ID 和完整 scene_spec。',
      visualRealismPolicy.sceneSpecRealismRuleZh(),
    ].join('\n');
    const userPrompt = `${contextPrompt(ctx)}

输出严格 JSON：
{
  "cast_profiles": [{"id":"稳定人物ID","name":"人物名称","role":"剧情职责","appearanceText":"原创外貌与气质","wardrobeText":"原创服装","performanceText":"表演与动作","continuityText":"跨镜一致性","negativeText":"禁止项"}],
  "prop_plan": [{"id":"稳定道具ID","name":"名称","type":"advertised_product/wearable_accessory/story_prop/fixed_scene_object","description":"身份、材质、比例和使用方式","states":[],"owner_id":"","scene_id":""}],
  "scene_plan": {
    "business_boundary":"业务边界","advertised_subject":"广告主体","cast_mode":"single/dual/multi/no_human/animal/human_pet/auto","scene_mode":"single/multi",
    "spaces":[{"id":"稳定空间ID","name":"中文空间名","description":"仅描述该独立空间","story_purpose":"剧情作用","scene_spec":{"layoutText":"布局、出入口和固定结构","materialLightText":"材质、色彩和光线","interactionText":"动作区、锚点与路线","negativeText":"禁止出现内容","storyStates":[],"interactionAnchors":[],"routes":[],"propPlacements":[],"sceneExperienceContract":{"required_authority":"panorama_3dof或geometry_6dof","representation":"physical或digital或abstract","extent":"enclosed或open或stage或screen","rotation_required":true,"translation_required":false,"actor_blocking_required":false,"camera_path_required":false,"metric_scale_required":false}}}],
    "asset_strategy":[],"story_strategy":[],"forbidden":[],"suggested_shot_count":5
  },
  "story_seed":{"logline":"故事梗概","opening":"","development":"","turning_point":"","resolution":""}
}`;
    const result = await modelGateway.generateText({
      taskId,
      stage: 'new_story_ad.asset_plan',
      systemPrompt,
      userPrompt,
      maxTokens: 4600,
    });
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
    plan = normalizePlan(language.payload, ctx);
    modelMeta = {
      source: 'unified_model_plan',
      model_call_count: 1,
      used_model: result.used_model,
      fallback_used: result.fallback_used,
      failed_models: result.failed_models,
      language_repaired: language.repaired,
      language_assessment: language.assessment,
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
  projectReferencePlan,
  projectReferenceIntake,
  referenceProjectionFingerprint,
  normalizePlan,
  complete,
  syncPrevious,
  generate,
};
