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

let checks = 0;
const ok = (value, message) => { assert(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.deepStrictEqual(actual, expected, message); checks += 1; };

const taskId = 'production-graph-regression';
const expressions = Array.from({ length: 6 }, (_, index) => ({ id: `expr_${index}`, key: `expression_${index}`, image_url: `/expr-${index}.png` }));
const actions = Array.from({ length: 6 }, (_, index) => ({ id: `action_${index}`, key: `action_${index}`, image_url: `/action-${index}.png` }));
const profile = {
  id: 'char_designer', displayName: '林岚', roleName: '空间设计师', gender: 'female', age: '25岁',
  ethnicity: '原创东亚女性角色设计', appearanceText: '椭圆脸，清晰眉眼，挺拔匀称体态，沉静专业气质。',
  look_profiles: [{ id: 'look_work', name: '工作造型', scene_ids: ['scene_hall'], wardrobeText: '深色西装、同色长裤、低跟皮鞋，剪裁与面料完整明确。', hairMakeupText: '低马尾，干净自然妆面。', negativeText: '禁止换装、禁止增加首饰。' }],
  owned_props: [{ id: 'prop_bag', name: '设计师文件包', type: 'bag', description: '深棕色硬挺皮革文件包，金属扣，手提使用。', material: '皮革', hand: 'left' }],
};
equal(productionOrchestrator.paidPersonDossierCalls([{ ...profile,
  wardrobeText: '深色西装、同色长裤、黑色皮鞋。', hairMakeupText: '低马尾，干净自然妆面。' }]), 7,
  'one-look dossier prices six reusable boards plus only the isolated shoe object; wardrobe and hair evidence are local crops');
const context = {
  cast_profiles: [profile], cast_mode: 'single', brief: '设计师向客户介绍大厅材料方案。',
  person_asset: { cast_assets: [{ id: 'person_asset_1', profile_id: profile.id, cast_member_index: 0,
    dossier_sheet: { image_url: '/person-dossier.png' }, native_masters: { face: { image_url: '/face.png' }, body: { image_url: '/body.png' } },
    expressions, base_actions: actions, person_contract: { status: 'verified' } }] },
  person_contract: { status: 'verified' },
};
const outputs = {
  context,
  blueprint: { id: 'blueprint_1', revision: 3, fingerprint: 'blueprint-fingerprint', beats: [{ id: 'beat_1' }] },
  asset_plan_active: { fingerprint: 'asset-plan-fingerprint', plan: { spaces: [{ id: 'scene_hall', name: '社区大厅' }] } },
  scene_config: { spaces: [{ id: 'scene_hall', name: '社区大厅', story_purpose: '材料介绍', scene_spec: { layoutText: '入口、展示墙与洽谈区构成可通行的连续空间。', materialLightText: '金属墙板与自然侧光。' } }] },
  scene_assets: [{ id: 'scene_hall', scene_id: 'scene_hall', name: '社区大厅', layout: { image_url: '/scene-master.png' },
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
  equal(draft.shots[0].camera_binding.camera_id, 'camera_main', 'shot binds exact camera');
  equal(draft.validation.status, 'ready', `complete graph should be ready: ${draft.validation.issues.join(',')}`);
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
const originalGetOutput = storage.getOutput;
const originalSaveOutput = storage.saveOutput;
const originalUpdateTask = storage.updateTask;
try {
  storage.listGenerationRuns = () => [
    { id: 'owned-production-run', domain: 'production_assets', state: 'running', billing_state: 'not_submitted', orchestration_job_id: 'generation-v201' },
    { id: 'old-unknown', domain: 'person_plan', state: 'billing_unknown', billing_state: 'unknown', retry_blocked: true, automatic_retry_allowed: false },
    { id: 'unrelated-running', domain: 'video', state: 'running', billing_state: 'not_submitted', orchestration_job_id: 'other-generation' },
  ];
  equal(authorityLifecycle.promotionBlockers(taskId).length, 3, 'ordinary authority promotion remains blocked by active or unknown runs');
  const graphBlockers = authorityLifecycle.promotionBlockers(taskId, { production_graph_authority: true, generation_id: 'generation-v201' });
  equal(graphBlockers.map(item => item.id), ['unrelated-running'], 'graph promotion ignores only its owned run and quarantined historical unknown billing');
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
} finally {
  storage.listGenerationRuns = originalListGenerationRuns;
  storage.updateGenerationRun = originalUpdateGenerationRun;
  storage.listOutputs = originalListOutputs;
  storage.listArtifacts = originalListArtifacts;
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
ok(stageView.includes('生成全部制作资产'), 'asset center has one main generation action');
ok(!stageView.includes('data-generate-missing-subjects'), 'old missing-person action is removed');
const assetView = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterView.js'), 'utf8');
const productionAction = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterUnifiedProductionAction.js'), 'utf8');
ok(assetView.includes('assetCenterUnifiedProductionAction.js'), 'unified action is loaded only when the user clicks');
ok(productionAction.includes('/production-assets/plan'), 'UI reads server plan before generation');
ok(productionAction.includes("store.runStage('production-assets'"), 'UI submits only unified production stage');
ok(productionAction.includes('plan.maximum_confirmable_cost_rmb'), 'UI reads the server-owned cost ceiling instead of duplicating it');
const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/newStoryAd.js'), 'utf8');
const orchestratorSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/productionAssetOrchestratorService.js'), 'utf8');
const subjectBundleSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/subjectAssetBundleService.js'), 'utf8');
ok(orchestratorSource.includes('PRODUCTION_GRAPH_IMAGE_PRICE_UNKNOWN'), 'unpriced image routes are blocked before paid generation');
ok(orchestratorSource.includes('PRODUCTION_GRAPH_COST_LIMIT_EXCEEDED'), 'server enforces the confirmed visual cost limit');
equal(productionOrchestrator.MAX_CONFIRMED_VISUAL_COST_RMB, 12.38, 'server-owned production visual cost ceiling matches the authorized budget');
const budgetGuard = productionOrchestrator.create({});
equal(budgetGuard.assertConfirmation({ cost_confirmation: true, confirmed_cost_limit_rmb: 12.38, plan_fingerprint: 'budget-1238' },
  { pricing_status: 'catalog_priced_hard_visual_limit', estimated_visual_cost_max_rmb: 12.38, plan_fingerprint: 'budget-1238' }), 12.38,
  'the authorized 12.38 RMB boundary is accepted with the current server plan');
let overBudgetRejected = false;
try {
  budgetGuard.assertConfirmation({ cost_confirmation: true, confirmed_cost_limit_rmb: 12.39, plan_fingerprint: 'budget-over' },
    { pricing_status: 'catalog_priced_hard_visual_limit', estimated_visual_cost_max_rmb: 12.38, plan_fingerprint: 'budget-over' });
} catch (error) { overBudgetRejected = error.code === 'PRODUCTION_GRAPH_COST_CONFIRMATION_REQUIRED'; }
ok(overBudgetRejected, 'a client cannot raise the server-owned ceiling above 12.38 RMB');
let insufficientBudgetRejected = false;
try {
  budgetGuard.assertConfirmation({ cost_confirmation: true, confirmed_cost_limit_rmb: 9.49, plan_fingerprint: 'budget-low' },
    { pricing_status: 'catalog_priced_hard_visual_limit', estimated_visual_cost_max_rmb: 9.5, plan_fingerprint: 'budget-low' });
} catch (error) { insufficientBudgetRejected = error.code === 'PRODUCTION_GRAPH_COST_LIMIT_EXCEEDED'; }
ok(insufficientBudgetRejected, 'generation stops before model calls when the estimated visual cost exceeds confirmation');
ok(orchestratorSource.includes('const executionPlan = plan'), 'cost plan is recomputed after person and scene planning');
ok(orchestratorSource.includes('production_graph_authority: true'), 'person and scene planning are published under the owned graph generation');
ok(subjectBundleSource.includes('dossierComposites.composeWardrobeDetails'), 'unified person dossiers derive wardrobe detail panels locally from paid high-resolution contact sheets');
ok(routeSource.includes("assertLegacyMutationAllowed(req.params.id, 'scene_asset_repair')"), 'legacy scene repair is blocked at the server boundary');
const transition = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/briefAssetPlanTransition.js'), 'utf8');
ok(!transition.includes("runStage('scene-config'"), 'plot-to-assets transition no longer starts legacy scene generation');
const progressUi = fs.readFileSync(path.join(__dirname, '../public/story-ad/components/ui.js'), 'utf8');
ok(progressUi.includes("production_assets: '全部制作资产'"), 'top progress uses a user-facing unified production label');
const jobServiceSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/jobService.js'), 'utf8');
ok(jobServiceSource.includes("production_assets: 3600000"), 'unified production has an explicit one-hour execution window');

console.log(JSON.stringify({ ok: true, checks, model_calls: 0, media_calls: 0 }));
