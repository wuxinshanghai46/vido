'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const storage = require('../src/services/newStoryAd/storageService');
const graphService = require('../src/services/newStoryAd/productionGraphService');
const prompts = require('../src/services/newStoryAd/productionPromptCompilerService');
const revisions = require('../src/services/newStoryAd/revisionService');
const pipelineModels = require('../src/services/pipelineModelService');
const authorityLifecycle = require('../src/services/newStoryAd/authorityLifecycleService');
const productionOrchestrator = require('../src/services/newStoryAd/productionAssetOrchestratorService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');

let checks = 0;
const ok = (value, message) => { assert(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.deepStrictEqual(actual, expected, message); checks += 1; };

const taskId = 'production-graph-regression';
const expressions = Array.from({ length: 6 }, (_, index) => ({ id: `expr_${index}`, key: `expression_${index}`, image_url: `/expr-${index}.png` }));
const actions = Array.from({ length: 6 }, (_, index) => ({ id: `action_${index}`, key: `action_${index}`, image_url: `/action-${index}.png` }));
const profile = {
  id: 'char_designer', actor_id: 'new_story_actor_designer', actor_asset_id: 'actor_asset_designer', displayName: '林岚', roleName: '空间设计师', gender: 'female', age: '25岁',
  ethnicity: '原创东亚女性角色设计', appearanceText: '椭圆脸，清晰眉眼，挺拔匀称体态，沉静专业气质。',
  look_profiles: [{ id: 'look_work', name: '工作造型', scene_ids: ['scene_hall'], wardrobeText: '深色西装、同色长裤、低跟皮鞋，剪裁与面料完整明确。', hairMakeupText: '低马尾，干净自然妆面。', negativeText: '禁止换装、禁止增加首饰。' }],
  owned_props: [{ id: 'prop_bag', name: '设计师文件包', type: 'bag', description: '深棕色硬挺皮革文件包，金属扣，手提使用。', material: '皮革', hand: 'left' }],
};
equal(productionOrchestrator.paidPersonDossierCalls([{ ...profile,
  wardrobeText: '深色西装、同色长裤、黑色皮鞋。', hairMakeupText: '低马尾，干净自然妆面。' }]), 7,
  'one-look dossier prices six reusable boards plus only the isolated shoe object; wardrobe and hair evidence are local crops');
const context = {
  cast_profiles: [profile], cast_mode: 'single', brief: '设计师向客户介绍大厅材料方案。',
  person_asset: { cast_assets: [{ id: 'actor_asset_designer', actor_id: 'new_story_actor_designer', actor_asset_id: 'actor_asset_designer', name: '林岚', cast_member_index: 1,
    dossier_sheet: { image_url: '/person-dossier.png' }, native_masters: { face: { image_url: '/face.png' }, body: { image_url: '/body.png' } },
    expressions, base_actions: actions, person_contract: { status: 'verified' } }] },
  person_contract: { status: 'verified' },
};
const outputs = {
  context,
  blueprint: { id: 'blueprint_1', revision: 3, fingerprint: 'blueprint-fingerprint', beats: [{ id: 'beat_1' }] },
  asset_plan_active: { fingerprint: 'asset-plan-fingerprint', plan: { spaces: [{ id: 'scene_hall', name: '社区大厅' }] } },
  scene_config: { spaces: [{ id: 'scene_hall', name: '社区大厅', story_purpose: '材料介绍', scene_spec: { layoutText: '入口、展示墙与洽谈区构成可通行的连续空间。', materialLightText: '金属墙板与自然侧光。' } }] },
  scene_assets: [{ id: 'scene_hall', scene_id: 'scene_hall', name: '社区大厅', image_url: '/scene-master.png',
    view_images: [{ key: 'master', camera_id: 'camera_master', image_url: '/scene-master.png' }],
    scene_spec: { layout: '入口、展示墙与洽谈区构成可通行的连续空间。', materials: '金属墙板' }, zones: [{ id: 'zone_wall', label: '展示墙' }],
    cameras: [{ id: 'camera_main', label: '主机位', lens: '35mm', framing: '中景', image_url: '/camera.png' }],
    scene_world_assets: { authority_mode: 'panorama_3dof', panorama_url: '/panorama.png', panoramas: [{ id: 'pano_hall', image_url: '/panorama.png' }] }, qa: { pass: true } }],
  prop_assets: [{ id: 'prop_bag', prop_id: 'prop_bag', name: '设计师文件包', type: 'bag', attachment_mode: 'carried', owner_id: profile.id,
    description: '深棕色硬挺皮革文件包，金属扣，手提使用。', material: '皮革', image_url: '/bag.png', states: ['closed'] }],
  storyboard_table: [{ id: 'shot_1', shot_id: 'shot_1', title: '介绍材料', duration: 6, scene_id: 'scene_hall', camera_id: 'camera_main', zone_id: 'zone_wall',
    characters: [{ id: profile.id, name: profile.displayName }], visual: '林岚左手提着设计师文件包，右手指向展示墙。', action: '从自然站立到右手触摸墙面。',
    action_start: '左手提包，右手自然下垂', action_end: '左手仍提包，右手触摸墙面', prop_ids: ['prop_bag'], prop_contact: 'left_hand',
    shot_size: '中景', camera_movement: '缓慢推近', lighting_mood: '自然侧光，专业克制', speech_mode: 'dialogue', speaker_id: profile.id,
    dialogue_lines: [{ speech_mode: 'dialogue', speaker_id: profile.id, speaker: '林岚', line: '请看这里的金属纹理。' }], ambient_sound: '大厅轻微脚步声', sfx: ['手指触碰金属'], music_cue: '克制现代电子氛围' }],
  keyframe_contracts: [{ contract_fingerprint: 'old-contract-fingerprint' }],
};
const task = { id: taskId, content_revision: 7, request: context };
const saved = {};
const originals = Object.fromEntries(['getTask', 'getOutput', 'saveOutput', 'saveStage', 'updateTask'].map(key => [key, storage[key]]));
storage.getTask = id => id === taskId ? task : null;
storage.getOutput = (id, kind) => id === taskId ? (saved[kind] || outputs[kind] || null) : null;
storage.saveOutput = (id, kind, value) => { saved[kind] = value; return value; };
storage.saveStage = (id, kind, value) => { saved[`stage:${kind}`] = value; return value; };
storage.updateTask = (id, patch) => { Object.assign(task, patch); return task; };

try {
  const draft = graphService.compile(taskId, { publish: false });
  equal(draft.contract_version, 'production-graph-v1', 'graph contract version');
  equal(draft.characters.length, 1, 'one character compiled');
  equal(draft.characters[0].performance_library.expressions.length, 6, 'six expressions retained');
  equal(draft.characters[0].performance_library.actions.length, 6, 'six actions retained');
  equal(draft.props[0].attachment_mode, 'carried', 'bag is carried instead of silently worn or placed');
  equal(draft.props[0].default_hand, 'unspecified', 'root prop keeps explicit per-shot hand state separate from default');
  equal(draft.shots[0].object_bindings[0].hand_contact, 'left_hand', 'shot binds bag to left hand');
  equal(draft.shots[0].scene_binding.panorama_id, 'pano_hall', 'shot binds authoritative panorama');
  equal(draft.characters[0].assets.dossier_sheet_url, '/person-dossier.png', 'one-based production cast index binds the correct dossier');
  equal(draft.scenes[0].assets.master_view_url, '/scene-master.png', 'root scene image projects as the authoritative master');
  equal(draft.shots[0].camera_binding.camera_id, 'camera_main', 'shot binds exact camera');
  equal(draft.validation.status, 'ready', `complete graph should be ready: ${draft.validation.issues.join(',')}`);
  const multiViewGraph = { ...draft, spatial_mode: graphService.MULTI_VIEW_MODE,
    scenes: draft.scenes.map(scene => ({ ...scene, assets: { ...scene.assets, panorama_id: '', panorama_url: '', panorama_authority: '' } })) };
  equal(graphService.validate(multiViewGraph).status, 'ready', 'five-view mode is ready without a panorama');
  const panoramaGraph = { ...multiViewGraph, spatial_mode: graphService.PANORAMA_MODE };
  ok(graphService.validate(panoramaGraph).issues.includes('scene_panorama_missing:scene_hall'),
    'explicit panorama mode still requires an authoritative panorama');
  const published = graphService.publish(taskId, { compiled_by: 'test' });
  equal(task.production_graph_authority, graphService.AUTHORITY, 'new graph becomes task authority');
  equal(task.legacy_generation_enabled, false, 'legacy generation is disabled');
  equal(graphService.assertExecutable(taskId).fingerprint, published.fingerprint, 'current ready graph is executable');
  let blocked = null; try { graphService.assertLegacyMutationAllowed(taskId, 'person_plan'); } catch (error) { blocked = error; }
  equal(blocked?.code, 'LEGACY_PRODUCTION_PATH_BLOCKED', 'legacy mutation is rejected before it can write');
  const graphPrompt = prompts.compileVideoDirection({ video_prompt_override: '旧自由文本必须失效' }, { productionGraphShot: published.shots[0] });
  ok(graphPrompt.includes('统一制作图谱绑定（唯一权威）'), 'video prompt declares graph authority');
  ok(graphPrompt.includes('设计师文件包'), 'video prompt carries prop binding');
  ok(!graphPrompt.includes('旧自由文本必须失效'), 'legacy prompt override cannot overwrite graph shot');
  const keyframePrompt = prompts.compileKeyframeDirection({ keyframe_prompt_override: '旧提示词' }, { productionGraphShot: published.shots[0] });
  ok(keyframePrompt.includes('camera_main'), 'keyframe prompt receives exact camera binding');
  ok(!keyframePrompt.includes('旧提示词'), 'legacy keyframe override is ignored under graph authority');
} finally {
  Object.entries(originals).forEach(([key, value]) => { storage[key] = value; });
}

const originalListGenerationRuns = storage.listGenerationRuns;
const originalUpdateGenerationRun = storage.updateGenerationRun;
const originalListOutputs = storage.listOutputs;
const originalListArtifacts = storage.listArtifacts;
const originalListArtifactIds = storage.listArtifactIds;
const originalGetArtifact = storage.getArtifact;
const originalUpdateArtifact = storage.updateArtifact;
const originalGetOutput = storage.getOutput;
const originalSaveOutput = storage.saveOutput;
const originalUpdateTask = storage.updateTask;
try {
  storage.listGenerationRuns = () => [
    { id: 'owned-production-run', domain: 'production_assets', state: 'running', billing_state: 'not_submitted', orchestration_job_id: 'generation-v201' },
    { id: 'owned-person-run', domain: 'person_plan', state: 'running', billing_state: 'not_submitted', orchestration_job_id: 'person-generation-v227' },
    { id: 'old-unknown', domain: 'person_plan', state: 'billing_unknown', billing_state: 'unknown', retry_blocked: true, automatic_retry_allowed: false },
    { id: 'unrelated-running', domain: 'video', state: 'running', billing_state: 'not_submitted', orchestration_job_id: 'other-generation' },
  ];
  equal(authorityLifecycle.promotionBlockers(taskId).length, 4, 'ordinary authority promotion remains blocked by active or unknown runs');
  const graphBlockers = authorityLifecycle.promotionBlockers(taskId, { production_graph_authority: true, generation_id: 'generation-v201' });
  equal(graphBlockers.map(item => item.id), ['owned-person-run', 'unrelated-running'], 'graph promotion ignores only its owned run and quarantined historical unknown billing');
  const personBlockers = authorityLifecycle.promotionBlockers(taskId, { person_plan_authority: true, generation_id: 'person-generation-v227' });
  equal(personBlockers.map(item => item.id), ['owned-production-run', 'unrelated-running'], 'person-plan promotion ignores its exact owned run and quarantined historical unknown billing');
  const mismatchedPersonBlockers = authorityLifecycle.promotionBlockers(taskId, { person_plan_authority: true, generation_id: 'different-person-generation' });
  ok(mismatchedPersonBlockers.some(item => item.id === 'owned-person-run'), 'a different generation id cannot claim another person-plan run');
  storage.listGenerationRuns = () => [
    { id: 'owned-production-run', domain: 'production_assets', state: 'running', billing_state: 'not_submitted', orchestration_job_id: 'generation-v201' },
    { id: 'old-unknown', domain: 'person_plan', state: 'billing_unknown', billing_state: 'unknown', retry_blocked: true, automatic_retry_allowed: false },
  ];
  equal(authorityLifecycle.assertPromotionAllowed(taskId, { production_graph_authority: true, generation_id: 'generation-v201' }), true,
    'explicit graph authority can advance without resubmitting quarantined historical calls');

  const ownedRun = { id: 'owned-production-run', domain: 'production_assets', state: 'running', unit_version: 3,
    billing_state: 'not_submitted', orchestration_job_id: 'generation-v201', execution_disabled: false };
  const historicalRun = { id: 'old-unknown', domain: 'person_plan', state: 'billing_unknown', unit_version: 4,
    billing_state: 'unknown', retry_blocked: true, automatic_retry_allowed: false };
  const runUpdates = new Map();
  storage.listGenerationRuns = () => [ownedRun, historicalRun];
  storage.updateGenerationRun = (id, patch) => { runUpdates.set(id, patch); return { ...(id === ownedRun.id ? ownedRun : historicalRun), ...patch }; };
  storage.listOutputs = () => [];
  storage.listArtifacts = () => [];
  storage.listArtifactIds = () => [];
  storage.getArtifact = () => null;
  storage.updateArtifact = () => null;
  storage.getOutput = () => null;
  storage.saveOutput = (_id, kind, value) => { saved[kind] = value; return value; };
  storage.updateTask = (_id, patch) => { Object.assign(task, patch); return task; };
  const promoted = authorityLifecycle.activate(taskId,
    { candidate_id: 'plan-v201', content_revision: 7 },
    { plan_id: 'plan-v201', content_revision: 7, release_bundle_id: 'bundle-v201' },
    null,
    { production_graph_authority: true, generation_id: 'generation-v201' });
  equal(runUpdates.get(ownedRun.id).execution_disabled, false, 'owned production graph run remains executable after authority promotion');
  equal(runUpdates.get(ownedRun.id).authority_id, promoted.authority_id, 'owned production graph run is rebound to the promoted authority');
  equal(runUpdates.get(historicalRun.id).execution_disabled, true, 'quarantined historical run remains disabled after authority promotion');

  const ownedPersonRun = { id: 'owned-person-run', domain: 'person_plan', state: 'running', unit_version: 5,
    billing_state: 'not_submitted', orchestration_job_id: 'person-generation-v227', execution_disabled: false };
  runUpdates.clear();
  storage.listGenerationRuns = () => [ownedPersonRun];
  const personPromoted = authorityLifecycle.activate(taskId,
    { candidate_id: 'person-plan-v227', content_revision: 7 },
    { plan_id: 'person-plan-v227', content_revision: 7, release_bundle_id: 'bundle-v227' },
    null,
    { person_plan_authority: true, generation_id: 'person-generation-v227' });
  equal(runUpdates.get(ownedPersonRun.id).execution_disabled, false, 'owned person-plan run remains executable after authority promotion');
  equal(runUpdates.get(ownedPersonRun.id).authority_id, personPromoted.authority_id, 'owned person-plan run is rebound to the promoted authority');
} finally {
  storage.listGenerationRuns = originalListGenerationRuns;
  storage.updateGenerationRun = originalUpdateGenerationRun;
  storage.listOutputs = originalListOutputs;
  storage.listArtifacts = originalListArtifacts;
  storage.listArtifactIds = originalListArtifactIds;
  storage.getArtifact = originalGetArtifact;
  storage.updateArtifact = originalUpdateArtifact;
  storage.getOutput = originalGetOutput;
  storage.saveOutput = originalSaveOutput;
  storage.updateTask = originalUpdateTask;
}

const deleted = [];
revisions.invalidateOutputs({ deleteOutputs: (_taskId, kinds) => deleted.push(...kinds) }, taskId, 'person_visual');
ok(deleted.includes('production_graph_v1'), 'person visual edits invalidate the graph before downstream generation');
ok(pipelineModels.getStageMeta('new_story_ad.person_dossier_expression'), 'expression stage appears in model management');
ok(pipelineModels.getStageMeta('new_story_ad.person_dossier_action'), 'action stage appears in model management');

const stageView = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterStageView.js'), 'utf8');
ok(stageView.includes('生成人物资产'), 'asset center exposes a person-only generation action');
ok(stageView.includes('场景模块单独生成'), 'person generation explicitly excludes scene output');
const assetView = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterView.js'), 'utf8');
const productionAction = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterUnifiedProductionAction.js'), 'utf8');
ok(!assetView.includes('assetCenterUnifiedProductionAction.js'), 'person page no longer loads the combined production action');
ok(productionAction.includes('/production-assets/plan'), 'UI reads server plan before generation');
ok(productionAction.includes("store.runStage('production-assets'"), 'UI submits only unified production stage');
ok(productionAction.includes("spatial_mode: 'multi_view'"), 'UI defaults unified production to five-view mode');
ok(productionAction.includes('generate_panoramas: false'), 'UI does not silently request panorama generation');
ok(!productionAction.includes('maximum_confirmable_cost_rmb') && !productionAction.includes('视觉费用上限'), 'generation confirmation does not impose a fixed user spending ceiling');
const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/newStoryAd.js'), 'utf8');
const personPlanRouteSource = fs.readFileSync(path.join(__dirname, '../src/routes/newStoryAd/personPlanGenerationRoute.js'), 'utf8');
const independentPersonPlanSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/independentPersonPlanService.js'), 'utf8');
const planPublicationSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/assetPlanPublicationService.js'), 'utf8');
const orchestratorSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/productionAssetOrchestratorService.js'), 'utf8');
const subjectBundleSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/subjectAssetBundleService.js'), 'utf8');
ok(orchestratorSource.includes('PRODUCTION_GRAPH_IMAGE_PRICE_UNKNOWN'), 'unpriced image routes are blocked before paid generation');
const budgetGuard = productionOrchestrator.create({});
equal(budgetGuard.assertConfirmation({ cost_confirmation: true, plan_fingerprint: 'current-plan' },
  { pricing_status: 'catalog_priced_hard_visual_limit', estimated_visual_cost_max_rmb: 99, plan_fingerprint: 'current-plan' }), true,
  'the current plan confirmation is accepted without a fixed spending ceiling');
let stalePlanRejected = false;
try { budgetGuard.assertConfirmation({ cost_confirmation: true, plan_fingerprint: 'stale' },
  { pricing_status: 'catalog_priced_hard_visual_limit', plan_fingerprint: 'current' });
} catch (error) { stalePlanRejected = error.code === 'PRODUCTION_GRAPH_COST_CONFIRMATION_REQUIRED'; }
ok(stalePlanRejected, 'a stale generation plan remains blocked before model calls');
ok(orchestratorSource.includes('const executionPlan = plan'), 'cost plan is recomputed after person and scene planning');
equal(productionOrchestrator.requestedSpatialMode({}), graphService.MULTI_VIEW_MODE, 'unified production defaults to five-view mode');
equal(productionOrchestrator.requestedSpatialMode({ generate_panoramas: true }), graphService.PANORAMA_MODE,
  'legacy explicit panorama request remains panorama mode');
equal(productionOrchestrator.requestedSpatialMode({ spatial_mode: 'multi_view', generate_panoramas: true }), graphService.MULTI_VIEW_MODE,
  'explicit spatial mode wins over a stale panorama boolean');
const defaultSceneSpec = contextBuilder.normalizeSceneSpec({});
equal(defaultSceneSpec.sceneExperienceContract.required_authority, 'multi_view', 'scene contracts default to multi-view authority');
equal(defaultSceneSpec.sceneExperienceContract.rotation_required, false, 'multi-view does not silently require 360 rotation');
const panoramaSceneSpec = contextBuilder.normalizeSceneSpec({ sceneExperienceContract: { required_authority: 'panorama_3dof' } });
equal(panoramaSceneSpec.sceneExperienceContract.required_authority, 'panorama_3dof', 'explicit panorama scene authority is preserved');
equal(panoramaSceneSpec.sceneExperienceContract.rotation_required, true, 'explicit panorama authority retains rotation requirement');
ok(orchestratorSource.includes('production_graph_authority: true'), 'person and scene planning are published under the owned graph generation');
ok(personPlanRouteSource.includes('person_plan_authority: true'), 'the person-plan route explicitly claims only its own authority run');
ok(independentPersonPlanSource.includes('person_plan_authority: options.person_plan_authority === true'), 'person-plan ownership propagates through independent profile persistence');
ok(planPublicationSource.includes('person_plan_authority: person_plan_authority === true'), 'person-plan ownership reaches authority activation');
ok(subjectBundleSource.includes('dossierComposites.composeWardrobeDetails'), 'unified person dossiers derive wardrobe detail panels locally from paid high-resolution contact sheets');
ok(!routeSource.includes("assertLegacyMutationAllowed(req.params.id, 'scene_asset_repair')"), 'current scene repair remains available independently');
const transition = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/briefAssetPlanTransition.js'), 'utf8');
ok(!transition.includes("runStage('scene-config'"), 'plot-to-assets transition no longer starts legacy scene generation');
const progressUi = fs.readFileSync(path.join(__dirname, '../public/story-ad/components/ui.js'), 'utf8');
ok(progressUi.includes("production_assets: '全部制作资产'"), 'top progress uses a user-facing unified production label');
const jobServiceSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/jobService.js'), 'utf8');
ok(jobServiceSource.includes("production_assets: 3600000"), 'unified production has an explicit one-hour execution window');

console.log(JSON.stringify({ ok: true, checks, model_calls: 0, media_calls: 0 }));
