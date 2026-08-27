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
  vm.runInNewContext(`${executable('public/story-ad/views/scenePromptPreview.js')}\nglobalThis.__prompt={sceneProductionAction,renderSceneProductionCard};`, sandbox);
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
    view_images: [{ key: 'master', image_url: '/master.png' }],
  }).action, 'reverify', '没有逐图证据时必须零图片复验');

  const targeted = sceneAssetService.buildSceneRepairPlan({
    generation_contract_version: 7,
    view_strategy: 'independent',
    scene_contract: { schema_version: 6, full_space_lock: false, verification: { state: 'rejected' }, view_issues: [{ code: 'REVERSE_MISMATCH', reason: '反向入口漂移', evidence: '入口从左侧移动到右侧', view_keys: ['reverse'] }] },
    view_images: [{ key: 'master', image_url: '/master.png' }],
  });
  assert.equal(targeted.action, 'regenerate_failed_views');
  assert.deepEqual(targeted.view_keys, ['reverse']);

  const atlas = sceneAssetService.buildSceneRepairPlan({
    generation_contract_version: 7,
    view_strategy: 'atlas_2x2',
    scene_contract: { schema_version: 6, full_space_lock: false, verification: { state: 'rejected' }, view_issues: [{ code: 'REVERSE_MISMATCH', reason: '反向入口漂移', evidence: '入口从左侧移动到右侧', view_keys: ['reverse'] }] },
    view_images: [{ key: 'master', image_url: '/master.png' }],
  });
  assert.equal(atlas.action, 'rebuild_atlas');
  assert.equal(atlas.provider_image_call_count, 2);
}

async function testReverifyBinding() {
  const requests = [];
  let confirmationCalls = 0;
  const button = {
    dataset: { reverifyScene: 'scene-reverify' },
    addEventListener(type, handler) { if (type === 'click') this.clickHandler = handler; },
  };
  const host = {
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll(selector) { return selector === '[data-reverify-scene]' ? [button] : []; },
  };
  const sandbox = {
    setButtonBusy() {},
    toast() {},
    confirmBillingAwareAction: async () => { confirmationCalls += 1; return { accepted: true }; },
  };
  vm.runInNewContext(`${executable('public/story-ad/views/sceneQaActions.js')}\nglobalThis.__bind=bindSceneQaActions;`, sandbox);
  sandbox.__bind({ host, context: {
    bundle: { project: { id: 'task-qa' }, assets: { scenes: [{ id: 'scene-reverify', name: '复验场景' }] } },
    store: { async runStage(pathname, body) { requests.push({ pathname, body }); return { scene_asset: { scene_contract: { full_space_lock: true } } }; } },
    async refreshShell() {},
  }, controllerFor: async () => null, cardFor: () => null });
  await button.clickHandler();
  assert.equal(confirmationCalls, 0, 'reverify must not open a billing confirmation');
  assert.deepEqual(requests, [{ pathname: 'scene-assets/scene-reverify/verify', body: undefined }]);
}

async function main() {
  testPlanner();
  await testReverifyBinding();
  const dossier = loadDossier();
  const prompt = loadPrompt(dossier);
  const reverify = completeScene('reverify', { count: 0, reasons: ['反向视图入口位置与主视图不一致'] });
  assert.equal(dossier.sceneNeedsGeneration(reverify), false, '复验任务不得进入批量图片生成');
  assert.deepEqual([...dossier.sceneQaFailureDetails(reverify).labels], ['跨视角一致性']);
  assert.match(dossier.renderSceneCoverCard(reverify), /未通过：跨视角一致性[\s\S]*反向视图入口位置与主视图不一致/);
  const reverifyHtml = prompt.renderSceneProductionCard(reverify);
  assert.match(reverifyHtml, /data-reverify-scene="scene-reverify"/);
  assert.match(reverifyHtml, /再次验证（不生成图片）/);
  assert.doesNotMatch(reverifyHtml, /data-scene-quality/);

  const repair = completeScene('regenerate_failed_views', { count: 1, view_labels: ['反向空间'], message: '只重做反向空间。' });
  const repairHtml = prompt.renderSceneProductionCard(repair);
  assert.match(repairHtml, /data-repair-scene="scene-regenerate_failed_views"/);
  assert.match(repairHtml, /只修复：反向空间（1 张）/);
  assert.match(repairHtml, /data-scene-quality/);
  assert.equal(dossier.sceneNeedsGeneration(repair), false, '定向修复不得误入普通批量生成路由');

  const atlasHtml = prompt.renderSceneProductionCard(completeScene('rebuild_atlas', { count: 2 }));
  assert.match(atlasHtml, /重建空间母图与布局（2 次图片调用）/);
  const fullHtml = prompt.renderSceneProductionCard(completeScene('regenerate_full_scene', { count: 2 }));
  assert.match(fullHtml, /data-generate-scene="scene-regenerate_full_scene"/);
  assert.match(fullHtml, /完整重新生成当前场景/);

  const interactions = read('public/story-ad/views/sceneQaActions.js');
  const verifyBlock = interactions.slice(interactions.indexOf("host.querySelectorAll('[data-reverify-scene]')"), interactions.indexOf("host.querySelectorAll('[data-repair-scene]')"));
  const repairBlock = interactions.slice(interactions.indexOf("host.querySelectorAll('[data-repair-scene]')"));
  assert.match(verifyBlock, /scene-assets\/\$\{encodeURIComponent\(sceneId\)\}\/verify/);
  assert.doesNotMatch(verifyBlock, /confirmBillingAwareAction|\/repair/);
  assert.match(verifyBlock, /图片调用 0 次/);
  assert.match(repairBlock, /scene-assets\/\$\{encodeURIComponent\(sceneId\)\}\/repair/);
  assert.match(repairBlock, /confirmBillingAwareAction/);
  console.log(JSON.stringify({ passed: true, reverify_image_calls: 0, targeted_repair_views: 1, atlas_image_calls: 2, supplier_calls: 0 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
