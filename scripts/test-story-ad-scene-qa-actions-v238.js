'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sceneAssetService = require('../src/services/newStoryAd/sceneAssetService');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const executable = file => read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function loadDossier() {
  const sandbox = {
    escapeHtml,
    mediaPreview: item => `<img src="${escapeHtml(item.image_url || item.url || '')}">`,
    sceneRuntimeFailureMarkup: () => '',
    setButtonBusy() {},
    toast() {},
  };
  vm.runInNewContext(`${executable('public/story-ad/views/sceneDossierCard.js')}\nglobalThis.__dossier={sceneNeedsGeneration,sceneQaFailureDetails,renderSceneCoverCard};`, sandbox);
  return sandbox.__dossier;
}

function loadPrompt(dossier) {
  const sandbox = {
    escapeHtml,
    toast() {},
    normalizeSceneDossier: scene => ({ completed: (scene.view_images || []).length }),
    renderSceneCoverCard: dossier.renderSceneCoverCard,
    sceneNeedsGeneration: dossier.sceneNeedsGeneration,
    sceneGenerationSettingsMarkup: () => '<select data-scene-quality></select>',
  };
  vm.runInNewContext(`${executable('public/story-ad/views/scenePromptPreview.js')}\nglobalThis.__prompt={sceneProductionAction,scenePendingAction,renderSceneProductionCard};`, sandbox);
  return sandbox.__prompt;
}

function completeScene(action, plan = {}) {
  return {
    id: `scene-${action}`,
    name: '现代展厅',
    generation_prompt: '空场景空间合同',
    view_images: ['master', 'reverse', 'interaction', 'detail', 'layout'].map(key => ({ key, image_url: `/${key}.png` })),
    qa: { full_space_lock: false, cross_view_pass: false, reasons: ['反向视图入口位置与主视图不一致'] },
    scene_card: { qa_checks: [{ label: '跨视角一致性', pass: false, reasons: ['反向视图入口位置与主视图不一致'] }] },
    repair_plan: { action, ...plan },
  };
}

function testPlanner() {
  assert.equal(sceneAssetService.buildSceneRepairPlan({
    generation_contract_version: 7,
    scene_contract: { schema_version: 6, full_space_lock: false, verification: { state: 'rejected' }, view_issues: [] },
    view_images: ['master', 'layout', 'reverse', 'interaction', 'detail'].map(key => ({ key, image_url: `/${key}.png` })),
  }).action, 'reverify', '没有逐图证据时必须零图片复验');

  const missingDetail = sceneAssetService.buildSceneRepairPlan({
    generation_contract_version: 7,
    scene_contract: { schema_version: 6, qa_unavailable: true, verification: { state: 'unavailable' }, view_issues: [] },
    view_images: ['master', 'layout', 'reverse', 'interaction'].map(key => ({ key, image_url: `/${key}.png` })),
    failed_view_keys: ['detail'],
  });
  assert.equal(missingDetail.action, 'regenerate_failed_views');
  assert.deepEqual(missingDetail.view_keys, ['detail']);

  const targeted = sceneAssetService.buildSceneRepairPlan({
    generation_contract_version: 7,
    view_strategy: 'independent',
    scene_contract: { schema_version: 6, full_space_lock: false, verification: { state: 'rejected' }, view_issues: [{ code: 'REVERSE_MISMATCH', reason: '反向入口漂移', evidence: '入口从左侧移动到右侧', view_keys: ['reverse'] }] },
    view_images: ['master', 'layout', 'reverse', 'interaction', 'detail'].map(key => ({ key, image_url: `/${key}.png` })),
  });
  assert.equal(targeted.action, 'regenerate_failed_views');
  assert.deepEqual(targeted.view_keys, ['reverse']);

  const atlas = sceneAssetService.buildSceneRepairPlan({
    generation_contract_version: 7,
    view_strategy: 'atlas_2x2',
    scene_contract: { schema_version: 6, full_space_lock: false, verification: { state: 'rejected' }, view_issues: [{ code: 'REVERSE_MISMATCH', reason: '反向入口漂移', evidence: '入口从左侧移动到右侧', view_keys: ['reverse'] }] },
    view_images: ['master', 'layout', 'reverse', 'interaction', 'detail'].map(key => ({ key, image_url: `/${key}.png` })),
  });
  assert.equal(atlas.action, 'rebuild_atlas');
  assert.equal(atlas.provider_image_call_count, 2);
}

async function testFixBinding() {
  const requests = [];
  let authorizationCalls = 0;
  const button = {
    dataset: { fixScene: 'scene-reverify' },
    closest() { return null; },
    addEventListener(type, handler) { if (type === 'click') this.clickHandler = handler; },
  };
  const host = {
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll(selector) { return selector === '[data-fix-scene]' ? [button] : []; },
  };
  const sandbox = {
    setButtonBusy() {},
    toast() {},
    confirmBillingAwareAction: async () => ({ accepted: true, reviewBatch: { reviews: [] } }),
    authorizeBillingReviews: async () => { authorizationCalls += 1; return []; },
  };
  vm.runInNewContext(`${executable('public/story-ad/views/sceneQaActions.js')}\nglobalThis.__bind=bindSceneQaActions;`, sandbox);
  sandbox.__bind({ host, context: {
    bundle: { project: { id: 'task-qa' }, assets: { scenes: [{ id: 'scene-reverify', name: '复验场景' }] } },
    store: { beginStageSubmission() {}, async runStage(pathname, body) { requests.push({ pathname, body }); return { accepted: true }; } },
    async refreshShell() {},
  }, controllerFor: async () => null, cardFor: () => null });
  await button.clickHandler();
  assert.equal(authorizationCalls, 1, 'direct fix click must authorize only after the billing review preflight');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, 'scene-assets/scene-reverify/fix');
  assert.equal(requests[0].body.scene_id, 'scene-reverify');
  assert.match(requests[0].body.request_key, /^scene-fix:scene-reverify:/);
}

async function main() {
  testPlanner();
  await testFixBinding();
  const dossier = loadDossier();
  const prompt = loadPrompt(dossier);
  const reverify = completeScene('reverify', { count: 0, reasons: ['反向视图入口位置与主视图不一致'] });
  assert.equal(dossier.sceneNeedsGeneration(reverify), false, '复验任务不得进入批量图片生成');
  assert.equal(prompt.scenePendingAction(reverify).kind, 'fix', '无逐图证据必须进入统一修复编排');
  assert.deepEqual([...dossier.sceneQaFailureDetails(reverify).labels], ['跨视角一致性']);
  assert.match(dossier.renderSceneCoverCard(reverify), /未通过：跨视角一致性[\s\S]*反向视图入口位置与主视图不一致/);
  const reverifyHtml = prompt.renderSceneProductionCard(reverify);
  assert.match(reverifyHtml, /data-fix-scene="scene-reverify"/);
  assert.match(reverifyHtml, /修复未通过项/);
  assert.match(reverifyHtml, /data-scene-quality/);

  const repair = completeScene('regenerate_failed_views', { count: 1, view_labels: ['反向空间'], message: '只重做反向空间。' });
  const repairHtml = prompt.renderSceneProductionCard(repair);
  assert.match(repairHtml, /data-fix-scene="scene-regenerate_failed_views"/);
  assert.match(repairHtml, /修复：反向空间（1 张）/);
  assert.match(repairHtml, /data-scene-quality/);
  assert.equal(dossier.sceneNeedsGeneration(repair), false, '定向修复不得误入普通批量生成路由');
  assert.equal(prompt.scenePendingAction(repair).kind, 'fix', '定向补图必须进入统一修复聚合');

  const atlasHtml = prompt.renderSceneProductionCard(completeScene('rebuild_atlas', { count: 2 }));
  assert.match(atlasHtml, /修复空间母图与布局（2 次图片调用）/);
  const fullHtml = prompt.renderSceneProductionCard(completeScene('regenerate_full_scene', { count: 2 }));
  assert.match(fullHtml, /data-fix-scene="scene-regenerate_full_scene"/);
  assert.match(fullHtml, /修复并升级当前场景/);

  const interactions = read('public/story-ad/views/sceneQaActions.js');
  assert.match(interactions, /scene-assets\/\$\{encodeURIComponent\(sceneId\)\}\/fix/);
  assert.match(interactions, /authorizeBillingReviews/);
  assert.match(interactions, /confirmBillingAwareAction/);
  assert.doesNotMatch(interactions, /data-reverify-scene|data-repair-scene/);
  assert.match(read('public/story-ad/views/sceneWorldPage.js'), /data-generate-all-scenes>生成全部缺失场景/);
  assert.match(read('public/story-ad/views/sceneWorldPage.js'), /data-fix-all-scenes>修复全部未通过场景/);
  const routes = read('src/routes/newStoryAd.js');
  assert.match(routes, /scene-assets\/:sceneId\/fix/);
  assert.match(routes, /LEGACY_SCENE_VERIFY_DISABLED/);
  assert.match(routes, /LEGACY_SCENE_REPAIR_DISABLED/);
  console.log(JSON.stringify({ passed: true, unified_fix_action: true, targeted_repair_views: 1, atlas_image_calls: 2, supplier_calls: 0 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
