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
const { contextPrompt, cleanText, assertContextConsistent, normalizeCharacters } = require('./contextBuilder');
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
const subjectProfileText = require('./subjectProfileTextService');

const ASSET_PLAN_PROJECTION_VERSION = 15;
const ASSET_PLAN_DRAFT_CHECKPOINT_KIND = 'asset_plan_draft_checkpoint';
const ASSET_PLAN_MISSING_SECTIONS_RECOVERY_KIND = 'asset_plan_missing_sections_recovery';

function assertBlueprintCastContract(ctx = {}, blueprint = {}) {
  const hasBlueprint = Boolean(
    cleanText(blueprint.story_title || blueprint.title || blueprint.logline || blueprint.summary || '', 300)
    || (Array.isArray(blueprint.beats) && blueprint.beats.length)
    || (Array.isArray(blueprint.characters) && blueprint.characters.length)
  );
  if (!hasBlueprint) return ctx;
  const castIntent = ctx.brief_intake?.cast_intent || ctx.cast_intent || {};
  const blueprintCharacters = normalizeCharacters(blueprint.characters || [], ctx.project_name || ctx.brief || '');
  const blueprintCount = blueprintCharacters.filter(character => character.on_screen !== false).length;
  const expectedCount = personCountContract.contract(ctx).planning_cast_count;
  if (!castIntent.confirmed) {
    if (blueprintCount !== expectedCount) {
      const error = new Error('当前剧情中的出镜人物数量与立项信息不一致，请先返回对话立项确认“客户是否出镜”；本次没有调用模型。');
      error.code = 'CAST_INTENT_CONFIRMATION_REQUIRED';
      error.status = 409;
      throw error;
    }
    return ctx;
  }
  if (blueprintCount !== expectedCount) {
    const error = new Error(`已确认出镜 ${expectedCount} 人，但当前剧情蓝图包含 ${blueprintCount} 人。请重新生成或编辑剧情人物后再继续；本次没有调用模型。`);
    error.code = 'BLUEPRINT_CAST_CONTRACT_MISMATCH';
    error.status = 409;
    throw error;
  }
  return ctx;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]);
    return result;
  }, {});
}

function planningPetProfiles(profiles = []) {
  return (Array.isArray(profiles) ? profiles : []).map(profile => ({
    id: profile.pet_id || profile.petId || profile.id || '',
    name: profile.name || '',
    type: profile.type || profile.species || '',
    breed: profile.breed || '',
    appearance: profile.appearance || profile.description || '',
    visual_medium: profile.visual_medium || '',
  }));
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
    pet_profiles: planningPetProfiles(ctx.pet_profiles),
    // Visual dossier/image refreshes have their own person revision, but they do
    // not change the approved textual cast input used to build an asset plan.
    // Older contexts have no person_semantic revision, so retain the legacy
    // revision as the compatibility fallback.
    person_revision: ctx.revisions?.person_semantic ?? ctx.revisions?.person ?? 0,
    product_revision: ctx.product_contract?.product_revision || ctx.revisions?.product || 0,
    // Generated prop/scene assets are plan outputs. Only the semantic scene
    // revision belongs to the textual planning input.
    scene_revision: ctx.revisions?.scene || 0,
    target_duration: ctx.target_duration,
    shot_count: ctx.shot_count,
    output_ratio: ctx.output_ratio,
    creative_direction: ctx.creative_direction,
    performance: ctx.performance,
  }))).digest('hex');
}

// V14 included generated visual output revisions in the planning-input hash.
// Keep the exact historical projection read-only so a controlled migration can
// prove old records without treating newly generated images as semantic edits.
function legacyFingerprintV14(task = {}, ctx = {}) {
  const currentCastFingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(canonical(ctx.cast_profiles || [])))
    .digest('hex');
  const castProfiles = currentCastFingerprint === ctx.asset_plan_generated_cast_fingerprint
    ? []
    : ctx.cast_profiles;
  return crypto.createHash('sha256').update(JSON.stringify(canonical({
    version: 14,
    content_mode: contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode),
    story_scene_contract_version: Number(ctx.story_scene_contract_version || 0) || 0,
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

function referenceCharacterRecord(reference = {}, prompt = {}) {
  const characters = Array.isArray(reference.reference_understanding?.characters)
    ? reference.reference_understanding.characters
    : [];
  const id = cleanText(prompt.id || prompt.character_id || '', 100);
  return characters.find(item => cleanText(item?.character_id || item?.id || '', 100) === id) || {};
}

function referenceCharacterEvidence(record = {}) {
  const values = record.evidence_refs || record.evidence_frame_ids || record.frame_ids || [];
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

function referenceCharacterText(prompt = {}, record = {}) {
  return cleanText([
    prompt.name, prompt.role, prompt.narrative_function, prompt.appearance_direction,
    prompt.performance_style, record.role, record.narrative_function,
  ].filter(Boolean).join('；'), 2400);
}

function referenceCharacterGender(text = '') {
  if (/女性|女士|女孩|女讲解|女展示|woman|female/iu.test(text)) return 'female';
  if (/男性|男士|男孩|男创作|man|male/iu.test(text)) return 'male';
  return 'unspecified';
}

function incidentalReferenceCharacter(prompt = {}, record = {}) {
  const explicitScope = cleanText(prompt.asset_scope || prompt.assetScope || record.asset_scope || '', 80).toLowerCase();
  if (['background', 'ambient', 'incidental', 'scene_extra', 'crowd', 'non_asset'].includes(explicitScope)) return true;
  const text = referenceCharacterText(prompt, record);
  const evidence = referenceCharacterEvidence(record);
  if (/人流|路人|群演|背景人物|围观人群|游客群|顾客群|其他的人|crowd|background extra/iu.test(text)) return true;
  if (/只可见.{0,8}(?:手|手部|局部)|一只.{0,8}手|局部肢体/iu.test(text)) return true;
  if (/半透明.{0,12}(?:人形|数字)|(?:人形|数字).{0,12}(?:AI代理|全息)|AI代理之一|数字代理之一/iu.test(text)) return true;
  if (evidence.length <= 1 && /只可见后脑|部分肩部|轮廓模糊|几乎成为剪影/iu.test(text)) return true;
  return false;
}

function referenceCharacterDesign(ctx = {}, prompt = {}, record = {}, index = 0) {
  const text = referenceCharacterText(prompt, record);
  const gender = referenceCharacterGender(text);
  const names = gender === 'female'
    ? ['林澜', '顾宁', '苏晴', '沈悦']
    : (gender === 'male' ? ['周屿', '陈序', '陆川', '程远'] : ['云舟', '安然', '知夏', '景行']);
  const explicitAge = cleanText(prompt.age_range || prompt.age || '', 100);
  const ageRange = /\d{1,3}\s*(?:岁|~|～|-|—|–|至|到)/u.test(explicitAge)
    ? explicitAge
    : (/讲解|展示|创作|操作|西装|职业/iu.test(text) ? '25~35岁' : '20~40岁');
  const explicitEthnicity = cleanText(prompt.ethnicity || prompt.ethnic_appearance || '', 100);
  const confirmedRegion = cleanText([
    ctx.world_setting?.country_region, ctx.world_setting?.country, ctx.world_setting?.region,
    ctx.country_region, ctx.country, ctx.region, ctx.reference_video_analysis?.source_facts?.country_region,
  ].filter(Boolean).join(' '), 400);
  const eastAsianContext = /中国|中国大陆|港澳台|东亚|China|Chinese|East Asian/iu.test(confirmedRegion);
  const ethnicity = explicitEthnicity || (eastAsianContext ? '东亚外貌设计' : '未指定（原创角色，可修改）');
  const role = cleanText(record.role || prompt.narrative_function || prompt.role || '', 200);
  return {
    name: names[index % names.length],
    name_source: 'platform_original_character_design',
    role,
    gender,
    age_range: ageRange,
    age_source: /\d/u.test(explicitAge) ? 'confirmed_reference' : 'platform_story_inference',
    ethnicity,
    ethnicity_source: explicitEthnicity ? 'confirmed_input' : (eastAsianContext ? 'platform_story_inference' : 'user_confirmable_default'),
  };
}

function projectReferenceCharacters(reference = {}, ctx = {}) {
  const prompts = (Array.isArray(reference.character_prompts) ? reference.character_prompts : [])
    .filter(item => !explicitAnimalPrompt(item));
  const ambientPeople = [];
  const primary = [];
  const sourceToPrimary = new Map();
  for (const prompt of prompts) {
    const record = referenceCharacterRecord(reference, prompt);
    const sourceId = cleanText(prompt.id || prompt.character_id || `reference_character_${primary.length + 1}`, 100);
    if (incidentalReferenceCharacter(prompt, record)) {
      ambientPeople.push({
        id: sourceId,
        description: referenceCharacterText(prompt, record),
        evidence_refs: referenceCharacterEvidence(record),
        requires_asset: false,
        asset_scope: 'scene_extra',
      });
      continue;
    }
    const evidence = new Set(referenceCharacterEvidence(record));
    const gender = referenceCharacterGender(referenceCharacterText(prompt, record));
    const duplicate = primary.find(item => item.gender === gender && gender !== 'unspecified'
      && [...evidence].some(frameId => item.evidence.has(frameId)));
    if (duplicate) {
      duplicate.prompts.push(prompt);
      duplicate.records.push(record);
      evidence.forEach(frameId => duplicate.evidence.add(frameId));
      sourceToPrimary.set(sourceId, duplicate.id);
      continue;
    }
    const design = referenceCharacterDesign(ctx, prompt, record, primary.length);
    const row = { id: sourceId, prompt, prompts: [prompt], records: [record], evidence, gender, design };
    primary.push(row);
    sourceToPrimary.set(sourceId, sourceId);
  }
  const castProfiles = primary.map(row => {
    const appearance = [...new Set(row.prompts.map(item => cleanText(item.appearance_direction || '', 600)).filter(Boolean))].join('；');
    const performance = [...new Set(row.prompts.map(item => cleanText(item.performance_style || item.narrative_function || '', 500)).filter(Boolean))].join('；');
    return {
      id: row.id,
      name: row.design.name,
      displayName: row.design.name,
      name_source: row.design.name_source,
      role: row.design.role,
      roleName: row.design.role,
      gender: row.design.gender,
      age_range: row.design.age_range,
      age: row.design.age_range,
      age_source: row.design.age_source,
      ethnicity: row.design.ethnicity,
      ethnicity_source: row.design.ethnicity_source,
      appearanceText: cleanText(appearance || '按已确认剧情设计原创、可持续复用的人物外观', 800),
      wardrobeText: cleanText(row.prompt.wardrobe_direction || '根据当前品牌、时代与场景设计原创服装', 600),
      hairMakeupText: cleanText(row.prompt.hair_makeup_direction || row.prompt.hairMakeupText || '符合年龄、身份和剧情地域的自然发型与妆造', 500),
      performanceText: cleanText(performance, 500),
      continuityText: cleanText(row.prompt.continuity_rules || '跨镜保持原创人物身份、年龄、外貌和造型一致', 500),
      negativeText: cleanText(row.prompt.negative_prompt || '禁止复制参考真人身份、禁止产生多余人物', 500),
      source_identity_ids: row.prompts.map(item => cleanText(item.id || item.character_id || '', 100)).filter(Boolean),
      evidence_refs: [...row.evidence],
      asset_scope: 'primary',
      source: 'reference_analysis_projection',
      status: 'draft',
      projection_only: true,
      generated_asset: false,
      identity_extraction_allowed: false,
    };
  });
  return { castProfiles, ambientPeople, sourceToPrimary };
}

function referenceStorySeed(reference = {}, scenePrompts = [], sourceToPrimary = new Map()) {
  const sourceBeats = Array.isArray(reference.plot_beats) ? reference.plot_beats : [];
  const shots = Array.isArray(reference.shot_breakdown) ? reference.shot_breakdown : [];
  const sceneById = new Map(scenePrompts.map(scene => [cleanText(scene.id || '', 100), scene]));
  const count = Math.max(sourceBeats.length, shots.length);
  const plotBeats = Array.from({ length: count }, (_, index) => {
    const beat = sourceBeats[index] || {};
    const shot = shots[index] || {};
    const sceneId = cleanText(shot.scene_id || '', 100);
    const scene = sceneById.get(sceneId) || {};
    const previousSceneId = cleanText(shots[index - 1]?.scene_id || '', 100);
    const summary = cleanText(beat.purpose || shot.action || shot.visual || `推进第 ${index + 1} 个参考事件`, 600);
    const nextSummary = cleanText(sourceBeats[index + 1]?.purpose || shots[index + 1]?.action || '', 500);
    const range = Array.isArray(beat.range) ? beat.range : (Array.isArray(shot.range) ? shot.range : []);
    const location = cleanText(scene.location_type || scene.name || sceneId || '已确认参考空间', 160);
    return {
      id: cleanText(beat.id || `beat_${String(index + 1).padStart(3, '0')}`, 100),
      phase: index === 0 ? 'opening' : (index === count - 1 ? 'resolution' : (index >= Math.floor(count * 0.7) ? 'turning_point' : 'development')),
      era: cleanText(scene.era || reference.source_facts?.era || '当代原创视觉世界', 120),
      time_anchor: range.length >= 2 ? `${Number(range[0]).toFixed(3)}~${Number(range[1]).toFixed(3)}秒` : `第${index + 1}事件`,
      location,
      production_state: cleanText([scene.layout_prompt, scene.material_light_prompt, reference.source_facts?.environment].filter(Boolean).join('；') || location, 320),
      summary,
      cause: index === 0 ? '参考叙事开始并建立主题' : cleanText(sourceBeats[index - 1]?.purpose || shots[index - 1]?.action || '上一事件推进至当前状态', 500),
      consequence: nextSummary || (index === count - 1 ? '完成故事主题收束' : '推动下一事件发生'),
      production_relation: index === 0
        ? { era: 'changed', time: 'changed', location: 'changed', environment: 'changed' }
        : { era: 'same', time: 'continuous', location: sceneId && sceneId === previousSceneId ? 'same' : 'changed', environment: sceneId && sceneId === previousSceneId ? 'continuous' : 'changed' },
      production_requirements: {
        layout: cleanText(scene.layout_prompt || '', 500),
        material_light: cleanText(scene.material_light_prompt || '', 500),
        interaction: cleanText(scene.interaction_prompt || shot.action || '', 500),
        negative: cleanText(scene.negative_prompt || '', 500),
      },
    };
  });
  const shotBreakdown = shots.map(shot => ({
    ...shot,
    subject_ids: [...new Set((Array.isArray(shot.subject_ids) ? shot.subject_ids : [])
      .map(id => sourceToPrimary.get(cleanText(id, 100)) || (String(id) === 'advertised_subject' ? 'advertised_subject' : ''))
      .filter(Boolean))],
  }));
  return storySceneCoverage.compileStorySeed({
    ...reference.story_outline,
    plot_beats: plotBeats,
    shot_breakdown: shotBreakdown,
    camera_intents: reference.camera_intents || [],
    character_actions: reference.character_actions || [],
    source: 'reference_analysis_projection',
    projection_only: true,
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
  const projectedCharacters = projectReferenceCharacters(reference, ctx);
  const castProfiles = projectedCharacters.castProfiles;
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
  const narrativeOnly = contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode) === 'narrative_story';
  const compiledReferenceStory = referenceStorySeed(reference, sourceScenePrompts, projectedCharacters.sourceToPrimary);
  const projectedScenePlan = {
    source: 'reference_analysis_projection',
    projection_only: true,
    business_boundary: cleanText(ctx.brief, 500),
    advertised_subject: narrativeOnly ? '' : (ctx.product_subject || product),
    cast_mode: castProfiles.length && petProfiles.length
      ? 'human_pet'
      : (petProfiles.length
        ? 'animal'
        : (castProfiles.length > 2 ? 'multi' : (castProfiles.length === 2 ? 'dual' : (castProfiles.length === 1 ? 'single' : 'no_human')))),
    scene_mode: spaces.length > 1 ? 'multi' : 'single',
    spaces,
    ambient_people: projectedCharacters.ambientPeople,
    ambient_people_policy: '背景人流、路人、群演、局部肢体和非叙事数字人形属于场景氛围，不建立独立人物资产；仅在镜头中按需生成。',
    asset_strategy: [],
    story_strategy: (reference.plot_beats || []).map(item => cleanText(item.purpose || '', 300)).filter(Boolean),
    forbidden: ['不得复制参考视频中的真人身份、品牌标识、版权图案和水印'],
    suggested_shot_count: Number(ctx.shot_count || reference.camera_intents?.length || 5),
  };
  const authoritativeScenePlan = narrativeOnly
    ? {
      ...storySceneCoverage.compileScenePlan(compiledReferenceStory, projectedScenePlan),
      source: projectedScenePlan.source,
      projection_only: true,
      ambient_people: projectedScenePlan.ambient_people,
      ambient_people_policy: projectedScenePlan.ambient_people_policy,
      cast_mode: projectedScenePlan.cast_mode,
      suggested_shot_count: projectedScenePlan.suggested_shot_count,
      forbidden: projectedScenePlan.forbidden,
    }
    : projectedScenePlan;
  return {
    cast_profiles: castProfiles,
    pet_profiles: petProfiles,
    // 参考视频识别出的广告主体已经进入 product_subject / advertised_subject。
    // 它不是剧情中需要单独持有、移动或改变状态的道具，不能重复投影成“独立道具”。
    prop_plan: [],
    advertised_subject_contract: narrativeOnly ? null : subjectContract,
    scene_plan: authoritativeScenePlan,
    story_seed: {
      ...compiledReferenceStory,
      shot_breakdown: compiledReferenceStory.shot_breakdown.map((shot, index) => ({
        ...shot,
        scene_id: eventSceneIds.get(index + 1) || shot.scene_id,
      })),
      advertised_subject: narrativeOnly ? '' : (subjectContract.subject || product),
      product_proof_requirements: narrativeOnly ? [] : (subjectContract.proof_requirements || []),
      source: 'reference_analysis_projection',
      projection_only: true,
    },
  };
}

function concreteAge(value = '') {
  const text = cleanText(value, 80);
  if (!/\d{1,3}\s*(?:岁|~|～|-|—|–|至|到)/u.test(text)) return '';
  const range = text.match(/(\d{1,3})\s*(?:~|～|-|—|–|至|到)\s*(\d{1,3})\s*岁?/u);
  if (range) return `${range[1]}~${range[2]}岁`;
  const exact = text.match(/(\d{1,3})\s*岁/u);
  return exact ? `${exact[1]}岁` : '';
}

function confirmedRegion(ctx = {}) {
  const world = ctx.world_setting || ctx.worldSetting || {};
  const confirmed = world.country_region_confirmed === true || world.region_confirmed === true
    || ctx.country_region_confirmed === true || ctx.region_confirmed === true;
  if (!confirmed) return '';
  return cleanText(world.country_region || world.country || world.region || ctx.country_region || ctx.country || ctx.region, 120);
}

function originalEthnicityForRegion(region = '') {
  if (/中国|港澳台|东亚|日本|韩国|China|Chinese|East Asian|Japan|Korea/iu.test(region)) return '东亚外貌设计';
  if (/南亚|印度|India|South Asian/iu.test(region)) return '南亚外貌设计';
  if (/中东|西亚|Middle East|West Asian/iu.test(region)) return '中东外貌设计';
  if (/非洲|Africa/iu.test(region)) return '非洲外貌设计';
  if (/拉丁|南美|Latin|South America/iu.test(region)) return '拉丁裔外貌设计';
  if (/欧洲|北美|欧美|Europe|North America/iu.test(region)) return '欧美外貌设计';
  return region ? `${region}原创地域外貌设计` : '';
}

function ageRangeForStoryStage(text = '') {
  if (/婴儿|婴孩|幼儿|襁褓/iu.test(text)) return '0~3岁';
  if (/儿童|小孩|孩童|男孩|女孩|小学生/iu.test(text)) return '6~12岁';
  if (/少年|少女|青少年|中学生/iu.test(text)) return '13~17岁';
  if (/青年|年轻|姑娘|小伙/iu.test(text)) return '20~30岁';
  if (/中年/iu.test(text)) return '40~55岁';
  if (/老年|老人|老者|年迈/iu.test(text)) return '60~75岁';
  return '';
}

function normalizeProfileDemographics(profile = {}, existing = {}, ctx = {}, castCount = 1) {
  if (subjectProfileText.subjectKind({ ...existing, ...profile }) === 'robot') {
    return { subject_kind: 'robot', ethnicity: '', ethnicity_source: 'not_applicable_robot' };
  }
  const ageCandidates = [
    profile.age_contract?.display_text, profile.age_contract?.value, profile.age, profile.age_range, profile.ageRange,
    ...(Array.isArray(profile.age_states) ? profile.age_states.map(item => item?.apparent_age) : []),
    existing.age_contract?.display_text, existing.age_contract?.value, existing.age, existing.age_range, existing.ageRange,
    ...(Array.isArray(existing.age_states) ? existing.age_states.map(item => item?.apparent_age) : []),
  ];
  let age = ageCandidates.map(concreteAge).find(Boolean) || '';
  let ageSource = cleanText(profile.age_source || existing.age_source, 80);
  const name = cleanText(profile.displayName || profile.name || existing.displayName || existing.name, 120);
  const brief = cleanText(ctx.brief, 5000);
  if (!age) {
    const nameIndex = name ? brief.indexOf(name) : -1;
    const briefScope = castCount === 1 ? brief : (nameIndex >= 0 ? brief.slice(Math.max(0, nameIndex - 40), nameIndex + name.length + 40) : '');
    age = concreteAge(briefScope);
    if (age) ageSource = 'confirmed_brief';
  }
  if (!age) {
    const adultEvidence = cleanText([
      profile.roleName, profile.role, profile.appearanceText, profile.appearance,
      existing.roleName, existing.role, existing.appearanceText, existing.appearance,
      castCount === 1 ? brief : '',
    ].filter(Boolean).join('；'), 2400);
    age = ageRangeForStoryStage(adultEvidence);
    if (age) ageSource = 'platform_story_inference';
    else if (/成年|成人|女士|男士|女子|母亲|父亲|父母|夫妻|丈夫|妻子|职业|侠客|恋人|重逢对象|转世之人|现代重逢|白月光/iu.test(adultEvidence)) {
      age = '25~35岁';
      ageSource = 'platform_story_inference';
    }
  }
  const explicitEthnicity = cleanText(
    profile.ethnicity || profile.ethnic_appearance || existing.ethnicity || existing.ethnic_appearance,
    120,
  );
  const region = confirmedRegion(ctx);
  const characterEvidence = cleanText([
    profile.roleName, profile.role, profile.appearanceText, profile.appearance,
    existing.roleName, existing.role, existing.appearanceText, existing.appearance,
  ].filter(Boolean).join('；'), 1000);
  const ethnicity = explicitEthnicity || originalEthnicityForRegion(region)
    || (characterEvidence ? '未指定（原创角色，可修改）' : '');
  const ethnicitySource = cleanText(profile.ethnicity_source || existing.ethnicity_source, 80)
    || (explicitEthnicity ? 'confirmed_input' : (region ? 'platform_story_inference' : (ethnicity ? 'user_confirmable_default' : '')));
  return {
    ...(age ? { age, age_range: age, age_source: ageSource || 'confirmed_input' } : {}),
    ...(ethnicity ? { ethnicity, ethnicity_source: ethnicitySource } : {}),
  };
}

function normalizePlan(source = {}, ctx = {}, options = {}) {
  const rawScenePlan = source.scene_plan || source.scenePlan || source.scene_config || source.sceneConfig || {};
  let scenePlan = normalizeScenePlan(assetPlanSceneContracts.closeAssetPlanSceneContracts(rawScenePlan, {
    content_mode: ctx.content_mode || ctx.product_presentation?.mode,
  }));
  if (options.allowPartialScene !== true) assertScenePlanContract(scenePlan);
  const castProfiles = Array.isArray(source.cast_profiles || source.castProfiles)
    ? (source.cast_profiles || source.castProfiles).slice(0, 12)
    : (ctx.cast_profiles || []);
  const existingProfiles = Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : [];
  const currentCastFingerprint = crypto.createHash('sha256').update(JSON.stringify(canonical(existingProfiles))).digest('hex');
  const existingProfilesArePlannerOutput = Boolean(ctx.asset_plan_generated_cast_fingerprint)
    && currentCastFingerprint === ctx.asset_plan_generated_cast_fingerprint;
  const normalizedCastProfiles = castProfiles.map((profile, index) => {
      const existing = existingProfiles.find(item => cleanText(item?.id || '', 100)
        && cleanText(item?.id || '', 100) === cleanText(profile?.id || '', 100))
        || existingProfiles.find(item => cleanText(item?.displayName || item?.name || '', 120)
          && cleanText(item?.displayName || item?.name || '', 120) === cleanText(profile?.displayName || profile?.name || '', 120));
      const generatedLooks = personLooks.normalizeLookProfiles(profile);
      const existingLooks = existing ? personLooks.normalizeLookProfiles(existing) : [];
      const preservedLooks = existingLooks.length > generatedLooks.length ? existingLooks : generatedLooks;
      const demographics = normalizeProfileDemographics(profile, existing, ctx, castProfiles.length);
      const withLooks = personLooks.normalizeProfileLooks({ ...profile, ...demographics, look_profiles: preservedLooks });
      const authority = subjectProfileText.profileFieldAuthority(existing || {});
      const edited = new Set(subjectProfileText.userEditedFields(existing || {}));
      const userOwned = field => !existingProfilesArePlannerOutput || authority[field] === 'user' || edited.has(field);
      const preserveDetail = field => {
        const before = cleanText(existing?.[field] || '', field === 'appearanceText' ? 800 : 1200);
        const generated = cleanText(profile?.[field] || profile?.[field.replace('Text', '')] || '', field === 'appearanceText' ? 800 : 1200);
        if (!before || !userOwned(field)) return generated;
        if (!generated || generated.includes(before)) return generated || before;
        return cleanText(`${before}；AI补充：${generated}`, field === 'appearanceText' ? 800 : 1200);
      };
      const resolvedWardrobe = preserveDetail('wardrobeText') || cleanText(withLooks.wardrobeText || '', 1200);
      const resolvedHairMakeup = preserveDetail('hairMakeupText') || '自然真实的发型与妆容，严格匹配人物外貌、年龄和职业气质';
      const resolvedNegative = preserveDetail('negativeText');
      const resolvedLooks = withLooks.look_profiles.map((look, lookIndex) => lookIndex ? look : ({ ...look, wardrobeText: resolvedWardrobe, hairMakeupText: resolvedHairMakeup, negativeText: resolvedNegative }));
      return ({
      ...withLooks,
      id: cleanText(profile.id || `cast_${index + 1}`, 100),
      displayName: cleanText(userOwned('displayName') && existing?.displayName ? existing.displayName : (profile.displayName || profile.name || `人物${index + 1}`), 120),
      name: cleanText(userOwned('displayName') && (existing?.name || existing?.displayName) ? (existing.name || existing.displayName) : (profile.name || profile.displayName || `人物${index + 1}`), 120),
      roleName: cleanText(userOwned('roleName') && existing?.roleName ? existing.roleName : (profile.roleName || profile.role || ''), 160),
      appearanceText: preserveDetail('appearanceText'),
      wardrobeText: resolvedWardrobe,
      hairMakeupText: resolvedHairMakeup,
      negativeText: resolvedNegative,
      field_authority: { ...(profile.field_authority || {}), ...authority },
      user_edited_fields: [...new Set([...(profile.user_edited_fields || []), ...edited])],
      ...demographics,
      look_profiles: resolvedLooks,
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
  const projectionContext = {
    ...currentContext,
    reference_video_analysis: reference,
    world_setting: worldSetting.infer(currentContext.world_setting, {
      brief: currentContext.brief,
      reference_video_analysis: reference,
      content_form: currentContext.content_form,
    }),
  };
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
    cast_profiles: (profiles) => (Array.isArray(profiles) ? profiles : []).flatMap((profile, index) => {
      const issues = [];
      const prefix = `[${index}]`;
      const existingProfiles = Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : [];
      const existing = existingProfiles.find(item => cleanText(item?.id || '', 100)
        && cleanText(item?.id || '', 100) === cleanText(profile?.id || '', 100))
        || existingProfiles.find(item => cleanText(item?.displayName || item?.name || '', 120)
          && cleanText(item?.displayName || item?.name || '', 120) === cleanText(profile?.displayName || profile?.name || '', 120))
        || {};
      // Missing-section recovery must evaluate the same deterministic
      // demographics that normalizePlan will persist. Otherwise a valid first
      // model result is incorrectly sent through a second paid recovery call.
      const validatedProfile = {
        ...profile,
        ...normalizeProfileDemographics(profile, existing, ctx, profiles.length),
      };
      const name = cleanText(validatedProfile.name || validatedProfile.displayName || '', 120);
      const age = cleanText(validatedProfile.age || validatedProfile.age_range || '', 100);
      const ethnicity = cleanText(validatedProfile.ethnicity || validatedProfile.ethnic_appearance || '', 120);
      if (!name || /^(?:出镜人物|人物|角色|主角)\s*\d*$/u.test(name)) issues.push(`${prefix}.descriptive_name_missing`);
      if (!/\d{1,3}\s*(?:岁|~|～|-|—|–|至|到)/u.test(age)) issues.push(`${prefix}.concrete_age_missing`);
      if (!ethnicity) issues.push(`${prefix}.ethnicity_design_missing`);
      const detailQuality = subjectProfileText.assistedProfileQuality(validatedProfile);
      detailQuality.issues.forEach(field => issues.push(`${prefix}.${field}_detail_incomplete`));
      if (['background', 'ambient', 'incidental', 'scene_extra', 'crowd', 'non_asset'].includes(cleanText(validatedProfile.asset_scope || '', 80).toLowerCase())) {
        issues.push(`${prefix}.incidental_person_must_not_be_asset`);
      }
      return issues;
    }),
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

function sectionValidationContext(source = {}, ctx = {}) {
  const referenceProjection = cleanText(rawScenePlan(source)?.source || source?.story_seed?.source || '', 100)
    === 'reference_analysis_projection';
  if (!referenceProjection || cleanText(ctx.brief_source || '', 80) !== 'reference_analysis') return ctx;
  const projectedCast = Array.isArray(sourceSection(source, 'cast_profiles', 'castProfiles'))
    ? sourceSection(source, 'cast_profiles', 'castProfiles')
    : [];
  const count = projectedCast.length;
  return {
    ...ctx,
    cast_profiles: projectedCast,
    narrative_cast_profiles: projectedCast,
    expected_people: count,
    narrative_identity_count: count,
    planning_cast_count: count,
    visual_asset_count: count,
    cast_mode: count > 2 ? 'multi' : (count === 2 ? 'dual' : (count === 1 ? 'single' : 'no_human')),
  };
}

function validStorySeedSection(source = {}, ctx = {}) {
  const validationCtx = sectionValidationContext(source, ctx);
  return sectionRecovery.sectionDiagnostics(source, validationCtx, recoverySectionValidators(validationCtx)).story_seed.valid;
}

function validScenePlanSection(source = {}, ctx = {}) {
  const validationCtx = sectionValidationContext(source, ctx);
  return sectionRecovery.sectionDiagnostics(source, validationCtx, recoverySectionValidators(validationCtx)).scene_plan.valid;
}

function validAssetPlanSections(source = {}, ctx = {}) {
  const validationCtx = sectionValidationContext(source, ctx);
  return sectionRecovery.validSections(source, validationCtx, recoverySectionValidators(validationCtx));
}

function missingAssetPlanSections(source = {}, ctx = {}) {
  const validationCtx = sectionValidationContext(source, ctx);
  return sectionRecovery.missingSections(source, validationCtx, recoverySectionValidators(validationCtx));
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

function detailedPersonProfileIssues(profiles = []) {
  return (Array.isArray(profiles) ? profiles : []).flatMap((profile, index) => {
    const quality = subjectProfileText.assistedProfileQuality(profile);
    return quality.issues.map(field => `cast_profiles[${index}].${field}_not_detailed`);
  });
}

function assertDetailedPersonProfiles(profiles = []) {
  const issues = detailedPersonProfileIssues(profiles);
  if (!issues.length) return profiles;
  const error = new Error(`人物方案缺少可生产的外观、服装配饰或妆造细节：${issues.join('、')}`);
  error.code = 'PERSON_PLAN_DETAIL_INCOMPLETE';
  error.status = 502;
  error.retryable = true;
  error.person_plan_issues = issues;
  throw error;
}

function sectionPatchOutput(section = '', contentMode = 'commercial_subject', ctx = {}) {
  if (section === 'cast_profiles') {
    return [{
      id: 'stable_cast_id', name: '具体原创人物名称', role: '剧情或广告职责', age_range: '25~35岁',
      ethnicity: '依据已确认地域和剧情设定的原创外貌族裔设计；无法确定时标记为待用户确认', asset_scope: 'primary',
      appearanceText: '80-160字；脸型五官、体型体态、肤色肤质、气质神态、稳定识别特征',
      wardrobeText: '60-160字；上装、下装或连衣裙、鞋履、颜色、材质、配饰及佩戴位置',
      hairMakeupText: '50-120字；发型发色、妆面肤质、眼镜、发饰和首饰',
      negativeText: '至少45字；身份年龄、外貌、发型妆造、服装配饰和常见AI瑕疵禁止项',
      look_profiles: [{ id: 'stable_look_id', name: '造型名称', wardrobeText: '完整服装鞋履配饰', hairMakeupText: '完整发型妆面', negativeText: '造型禁止项' }],
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
        ? [`cast_profiles must contain exactly ${personCountContract.contract(ctx).planning_cast_count} primary narrative identities. Count identities, not era-specific visual asset cards. Never include crowds, passers-by, background people, partial hands/bodies, silhouettes without continuity, holographic agents or other ambient people as assets. Every asset must have a concrete original name, a numeric age or age range, ethnicity as an original character design field, and asset_scope=primary. A reincarnation is a separate named identity; the same living or time-travelling person across eras is one identity with multiple look_profiles.`,
          '人物文字方案必须是可直接供图片、完整档案、分镜和视频使用的生产规格，禁止返回一句概括。appearanceText 必须覆盖脸型五官、体型体态、肤色肤质、气质神态和稳定识别特征；wardrobeText 必须覆盖上装、下装或连衣裙、鞋履、颜色、材质、配饰类型与佩戴位置；hairMakeupText 必须覆盖发型发色、妆面肤质、眼镜、发饰或首饰；negativeText 必须覆盖身份年龄、外貌、发型妆造、服装配饰和常见 AI 瑕疵。',
          'existing_payload 中用户明确填写的文字是权威约束：必须逐字保留其事实，只能在其后补充缺少的生产细节；不得把详细内容缩短为模板句。每个 look_profile 也必须分别给出完整服装鞋履配饰、发型妆面和禁止项。'].join('\n')
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
      if (section === 'cast_profiles') assertDetailedPersonProfiles(merged.cast_profiles);
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
  if (section === 'cast_profiles') assertDetailedPersonProfiles(merged.cast_profiles);
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

function persist(taskId, ctx, rawPlan, meta, scope = 'all') {
  const plan = attachFixedPropsToScenes(normalizePlan(rawPlan, ctx, { allowPartialScene: scope === 'person' }));
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
    ethnicity: primaryCast.ethnicity || primaryCast.ethnic_appearance || '',
    appearanceText: primaryCast.appearanceText || '',
    wardrobeText: primaryCast.wardrobeText || '',
    look_profiles: primaryCast.look_profiles || [],
    hairMakeupText: primaryCast.hairMakeupText || '',
    negativeText: primaryCast.negativeText || '',
  };
  const personContext = {
    ...ctx,
    cast_profiles: plan.cast_profiles,
    narrative_cast_profiles: plan.narrative_cast_profiles,
    pet_profiles: plan.pet_profiles,
    cast_mode: plan.scene_plan.cast_mode || ctx.cast_mode,
    expected_people: plan.scene_plan.cast_mode === 'no_human' ? 0 : plan.cast_profiles.length,
    narrative_identity_count: personCounts.narrative_identity_count,
    planning_cast_count: personCounts.planning_cast_count,
    visual_asset_count: personCounts.visual_asset_count,
    person_spec: personSpec,
    asset_plan_fingerprint: meta.fingerprint,
    asset_plan_generated_cast_fingerprint: castFingerprint,
    asset_setup_confirmed: false,
    scene_setup_confirmed: false,
    shot_design_confirmed: false,
  };
  const sceneContext = {
    ...ctx,
    story_seed: plan.story_seed,
    asset_plan_fingerprint: meta.fingerprint,
    scene_setup_confirmed: false,
    shot_design_confirmed: false,
  };
  const fullContext = {
    ...personContext,
    prop_plan: plan.prop_plan,
    prop_assets: props,
    story_seed: plan.story_seed,
    advertised_subject_contract: plan.advertised_subject_contract || ctx.advertised_subject_contract || null,
    product_contract: projectedProductContract,
  };
  const projectedContext = assertContextConsistent(scope === 'person'
    ? personContext
    : (scope === 'scene' ? sceneContext : fullContext));
  // The persisted context marks planner-generated cast profiles so future
  // fingerprints exclude derived output. Publish against that exact context
  // snapshot; otherwise a newly created plan is stale on its very next read.
  const persistedFingerprint = fingerprint(storage.getTask(taskId) || {}, projectedContext);
  const persistedMeta = { ...meta, fingerprint: persistedFingerprint };
  const nextContext = assertContextConsistent({
    ...projectedContext,
    asset_plan_fingerprint: persistedFingerprint,
  });
  const activePlan = assetPlanPublication.publish(taskId, plan, { ...persistedMeta, scope });
  const nextPlan = { ...activePlan, ...persistedMeta };
  storage.saveOutput(taskId, 'asset_plan', nextPlan);
  if (scope !== 'person') storage.saveOutput(taskId, 'scene_config', plan.scene_plan);
  if (scope === 'all') storage.saveOutput(taskId, 'prop_assets', props);
  storage.saveOutput(taskId, 'context', nextContext);
  storage.updateTask(taskId, checkpointLineage.currentPlanningTaskPatch(), { systemFinalization: true });
  return nextPlan;
}

function persistIndependentPersonProfiles(taskId, profiles = [], meta = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  assertDetailedPersonProfiles(profiles);
  const previous = assetPlanPublication.currentPlan(taskId);
  const base = previous && typeof previous === 'object' ? previous : {
    cast_profiles: Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : [],
    narrative_cast_profiles: Array.isArray(ctx.narrative_cast_profiles) ? ctx.narrative_cast_profiles : (ctx.cast_profiles || []),
    pet_profiles: Array.isArray(ctx.pet_profiles) ? ctx.pet_profiles : [],
    prop_plan: Array.isArray(ctx.prop_plan) ? ctx.prop_plan : [],
    story_seed: ctx.story_seed && typeof ctx.story_seed === 'object' ? ctx.story_seed : {},
    scene_plan: storage.getOutput(taskId, 'scene_config') || {
      cast_mode: ctx.cast_mode || ctx.person_spec?.castMode || (profiles.length > 1 ? 'group' : (profiles.length ? 'single' : 'no_human')),
      scene_mode: ctx.scene_mode || 'auto',
      spaces: [],
    },
    advertised_subject_contract: ctx.advertised_subject_contract || null,
  };
  const candidate = normalizePlan({
    ...base,
    cast_profiles: profiles,
    narrative_cast_profiles: profiles,
  }, ctx, { allowPartialScene: true });
  if (previous) {
    const overrides = storage.getOutput(taskId, 'scene_world_overrides') || {};
    assertScopedPlanIsolation(normalizePlan(previous, ctx, { allowPartialScene: true }), candidate, 'person', overrides);
  }
  return persist(taskId, ctx, candidate, {
    fingerprint: fingerprint(task, ctx),
    source: 'independent_person_plan_completion',
    completed_at: new Date().toISOString(),
    ...meta,
  }, 'person');
}

function ids(items = []) {
  return (Array.isArray(items) ? items : []).map(item => cleanText(item?.id, 160)).filter(Boolean).sort();
}

function assertSameIds(before = [], after = [], code, label) {
  if (JSON.stringify(ids(before)) === JSON.stringify(ids(after))) return;
  const error = new Error(`${label}的稳定 ID 发生变化，已阻止发布以保护人物与场景绑定`);
  error.code = code;
  error.status = 422;
  error.retryable = false;
  throw error;
}

function assertScopedPlanIsolation(previous = {}, next = {}, scope = '', overrides = {}) {
  const unchanged = scope === 'person'
    ? ['scene_plan', 'story_seed', 'prop_plan', 'pet_profiles', 'advertised_subject_contract']
    : ['cast_profiles', 'narrative_cast_profiles', 'pet_profiles', 'prop_plan', 'story_seed', 'advertised_subject_contract'];
  unchanged.forEach(key => {
    if (JSON.stringify(canonical(previous[key])) === JSON.stringify(canonical(next[key]))) return;
    const error = new Error(`${scope}方案更新越界修改了 ${key}，候选方案未发布`);
    error.code = 'ASSET_PLAN_SCOPED_UPDATE_CROSSTALK';
    error.status = 422;
    error.retryable = false;
    throw error;
  });
  if (scope === 'person') {
    assertSameIds(previous.cast_profiles, next.cast_profiles, 'PERSON_PLAN_STABLE_ID_CHANGED', '人物方案');
    const nextById = new Map((next.cast_profiles || []).map(person => [String(person.id || ''), person]));
    for (const assignment of (overrides.assignments || [])) {
      const person = nextById.get(String(assignment.character_id || ''));
      const lookIds = new Set((person?.look_profiles || []).map(look => String(look.id || '')));
      if (!person || (assignment.look_id && !lookIds.has(String(assignment.look_id)))) {
        const error = new Error('人物方案会使现有场景站位或造型绑定失效，已阻止发布');
        error.code = 'PERSON_PLAN_BINDING_ORPHANED';
        error.status = 422;
        error.retryable = false;
        throw error;
      }
    }
  } else {
    assertSameIds(previous.scene_plan?.spaces, next.scene_plan?.spaces, 'SCENE_PLAN_STABLE_ID_CHANGED', '场景方案');
    const worldIds = new Set(ids(next.scene_plan?.spaces));
    if ((overrides.assignments || []).some(item => item.world_id && !worldIds.has(String(item.world_id)))) {
      const error = new Error('场景方案会使现有人物站位绑定失效，已阻止发布');
      error.code = 'SCENE_PLAN_BINDING_ORPHANED';
      error.status = 422;
      error.retryable = false;
      throw error;
    }
  }
  return true;
}

function markSceneConfigDone(taskId, generationId = '') {
  const task = storage.getTask(taskId) || {};
  const activeGenerationId = cleanText(task.active_generation_id || '', 160);
  const ownedByJob = Boolean(generationId) && activeGenerationId === cleanText(generationId, 160);
  storage.updateTask(taskId, {
    status: ownedByJob ? 'running' : 'done',
    stage: 'scene_config_done',
    error: '',
    error_code: '',
    ...(ownedByJob ? {} : { active_generation_id: '', active_stage: '' }),
  });
}

async function replanScope(taskId, scope, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  let previous = assetPlanPublication.currentPlan(taskId);
  if (!complete(previous, ctx)) {
    const error = new Error('当前完整资产方案不存在，不能执行分域更新');
    error.code = 'ASSET_PLAN_SCOPED_SOURCE_REQUIRED';
    error.status = 409;
    throw error;
  }
  const section = scope === 'person' ? 'cast_profiles' : 'scene_plan';
  const generationId = cleanText(options.generation_id || options.generationId || '', 160);
  const currentFingerprint = fingerprint(task, ctx);
  const releaseMigration = assetPlanPublication.migrateCompatibleRelease(taskId, {
    fingerprint: currentFingerprint,
    reason: `${scope}_plan_user_refresh`,
    generationId,
  });
  if (releaseMigration.blocked) {
    const error = new Error('当前任务仍有活动生成或计费状态未确认，已停止方案迁移和模型调用');
    error.code = 'ASSET_PLAN_RELEASE_MIGRATION_BLOCKED';
    error.status = 409;
    error.retryable = false;
    error.details = releaseMigration.compatibility;
    throw error;
  }
  if (releaseMigration.migrated) {
    // A release migration only makes the existing plan safe to read. The user
    // explicitly requested regeneration, so continue into the scoped model
    // patch instead of returning the old (often sparse) text as if regenerated.
    previous = releaseMigration.plan;
  }
  sectionRecovery.saveCheckpointAtomic(taskId, ASSET_PLAN_DRAFT_CHECKPOINT_KIND, previous, ctx, {
    ...options,
    generation_id: generationId,
    fingerprint: currentFingerprint,
    status: `${scope}_plan_update_ready`,
    validators: recoverySectionValidators(ctx),
    allow_generation_handoff: true,
    replace_incompatible: true,
  });
  storage.updateTask(taskId, { status: 'running', stage: `${scope}_plan` });
  storage.saveStage(taskId, `${scope}_plan`, { status: 'running', input_summary: ctx.brief });
  const recovered = await recoverAssetPlanSectionPatch(taskId, ctx, previous, section, {
    ...options,
    generation_id: generationId,
    fingerprint: currentFingerprint,
  });
  const next = normalizePlan(recovered.payload, ctx);
  const overrides = storage.getOutput(taskId, 'scene_world_overrides') || {};
  assertScopedPlanIsolation(normalizePlan(previous, ctx), next, scope, overrides);
  const saved = persist(taskId, ctx, next, {
    fingerprint: currentFingerprint,
    source: `${scope}_plan_section_patch`,
    model_meta: { ...recovered.model_meta, model_call_count: 1, scope },
    completed_at: new Date().toISOString(),
  }, scope);
  storage.deleteOutput(taskId, ASSET_PLAN_DRAFT_CHECKPOINT_KIND);
  storage.saveStage(taskId, `${scope}_plan`, {
    status: 'done',
    output_summary: scope === 'person' ? '人物文字方案已独立更新' : '场景文字方案已独立更新',
    diagnostics: { fingerprint: currentFingerprint, scope, model_call_count: 1 },
  });
  storage.updateTask(taskId, { status: 'running', stage: `${scope}_plan_done` });
  return scope === 'person' ? saved.cast_profiles : saved.scene_plan;
}

async function replanPerson(taskId, options = {}) { return replanScope(taskId, 'person', options); }
async function replanScene(taskId, options = {}) { return replanScope(taskId, 'scene', options); }

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
  markSceneConfigDone(taskId);
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
  assertBlueprintCastContract(ctx, storage.getOutput(taskId, 'blueprint') || {});
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
      generation_id: generationId,
      production_graph_authority: options.production_graph_authority === true,
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
    markSceneConfigDone(taskId, generationId);
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
      '人物资产只包含需要跨镜保持身份一致的主要剧情人物。人流、路人、群演、商场顾客群、草地远景人群、只露手或局部身体的人、无持续身份的背影剪影、半透明数字人形和背景 AI 代理必须归入场景氛围，不得建立人物资产。',
      '每个主要人物必须提供具体原创名称、数字年龄或年龄区间、原创角色的族裔/地域外貌设计、身份职责和 asset_scope=primary。参考真人未明确的族裔不得冒充事实；应依据已确认地域与剧情设定给出可编辑的原创设计，确实无法确定时明确标记待用户确认。',
      '人物方案必须按现有人物资产和剧情证据详细展开，不得用一句抽象概括代替：appearanceText 至少覆盖脸型五官、体型体态、肤色肤质、气质神态；wardrobeText 至少覆盖上装、下装、鞋履、颜色、材质、配饰；hairMakeupText 至少覆盖发型发色、妆容肤质、眼镜或首饰；negativeText 至少覆盖身份年龄、发型妆造、服装配饰和常见 AI 瑕疵。已有用户确认字段是事实权威，只能补缺项，禁止改写。',
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
  "cast_profiles": [{"id":"稳定人物ID","name":"具体原创人物名称","role":"剧情职责","age_range":"25~35岁","ethnicity":"原创角色的族裔或地域外貌设计","asset_scope":"primary","appearanceText":"80-160字；详细描述脸型五官、体型体态、肤色肤质、气质神态与可识别特征","wardrobeText":"60-160字；详细描述上装、下装、鞋履、颜色、材质和配饰","hairMakeupText":"50-120字；详细描述发型发色、妆容肤质、眼镜发饰或首饰","look_profiles":[{"id":"稳定造型ID","name":"造型名称","story_state":"时代或剧情状态","scene_ids":["适用场景ID"],"scene_names":["适用场景名称"],"world_profile_id":"world_setting中的稳定ID","wardrobeText":"该造型固定服装鞋履配饰","hairMakeupText":"该造型固定发型妆容","negativeText":"该造型禁止项","continuityText":"该造型内部一致性","style_family":"知识风格ID或task_defined","wardrobe_contract":{"garment_system":{"mode":"one_piece/top_bottom/layered","items":[{"slot":"upper/lower/one_piece/ensemble/outerwear","type":"具体单品","evidence":"证据"}]},"footwear":{"type":"类型","color":"颜色","material":"材质","evidence":"证据"},"accessories":{"mode":"specified/none","items":[],"evidence":"证据"},"palette":{"colors":["主色","辅色"],"evidence":"证据"},"materials":[{"name":"材质","used_for":"位置","evidence":"证据"}],"negative_constraints":[],"knowledge_doc_ids":[]}}],"performanceText":"表演与动作","continuityText":"人物身份跨镜一致性","negativeText":"至少45字；明确身份年龄、发型妆造、服装配饰和AI瑕疵禁止项"}],
  "prop_plan": [{"id":"稳定道具ID","name":"名称","type":"${currentContentMode === 'narrative_story' ? 'wearable_accessory/story_prop/fixed_scene_object' : 'advertised_product/wearable_accessory/story_prop/fixed_scene_object'}","description":"身份、材质、比例和使用方式","states":[],"owner_id":"","scene_id":""}],
  "scene_plan": {
    "business_boundary":"业务边界","advertised_subject":"${currentContentMode === 'narrative_story' ? '' : '明确广告主体'}","cast_mode":"single/dual/multi/no_human/animal/human_pet/auto","scene_mode":"single/multi",
    "spaces":[{"id":"稳定空间ID","name":"中文空间名","description":"仅描述该独立空间","story_purpose":"剧情作用","scene_spec":{"layoutText":"布局、出入口和固定结构","materialLightText":"材质、色彩和光线","interactionText":"动作区、锚点与路线","negativeText":"禁止出现内容","storyStates":[],"interactionAnchors":[],"routes":[],"propPlacements":[],"sceneExperienceContract":{"required_authority":"multi_view、panorama_3dof或geometry_6dof；默认multi_view，只有用户明确要求360或可移动空间时才升级","representation":"physical或digital或abstract","extent":"enclosed或open或stage或screen","rotation_required":false,"translation_required":false,"actor_blocking_required":false,"camera_path_required":false,"metric_scale_required":false}}}],
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
    generation_id: generationId,
    production_graph_authority: options.production_graph_authority === true,
  });
  storage.saveStage(taskId, 'scene_config', {
    status: 'done',
    output_summary: '统一资产计划已生成',
    diagnostics: { ...modelMeta, fingerprint: currentFingerprint, cache_hit: false },
  });
  markSceneConfigDone(taskId, generationId);
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
  assertBlueprintCastContract,
  fingerprint,
  legacyFingerprintV14,
  referenceIsValid,
  assertReferenceReady,
  advertisedSubjectContract,
  projectReferencePlan,
  projectReferenceIntake,
  referenceProjectionFingerprint,
  normalizePlan,
  normalizeProfileDemographics,
  detailedPersonProfileIssues,
  assertDetailedPersonProfiles,
  complete,
  validAssetPlanSections,
  missingAssetPlanSections,
  reusableDraftPayload,
  narrativeSubjectMarker,
  rawContentModeViolations,
  normalizeContentModeMarkers,
  assertGeneratedContentMode,
  assertContentModeIsolation,
  assertScopedPlanIsolation,
  markSceneConfigDone,
  replanPerson,
  replanScene,
  persistIndependentPersonProfiles,
  syncPrevious,
  generate,
};
