'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sceneAssetService = require('../src/services/newStoryAd/sceneAssetService');
const sceneQaProjection = require('../src/services/storyAdWorkspace/sceneQaProjectionService');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const executable = file => read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function loadDossier() {
  const qaSandbox = {};
  vm.runInNewContext(`${executable('public/story-ad/views/sceneQaPublicState.js')}\nglobalThis.__qa={sceneQaPublicState,publicSceneQaReason,sceneQaRows,sceneQaFailureDetails};`, qaSandbox);
  const sandbox = {
    escapeHtml,
    mediaPreview: item => `<img src="${escapeHtml(item.image_url || item.url || '')}">`,
    sceneRuntimeFailureMarkup: () => '',
    setButtonBusy() {},
    toast() {},
    ...qaSandbox.__qa,
  };
  vm.runInNewContext(`${executable('public/story-ad/views/sceneDossierCard.js')}\nglobalThis.__dossier={sceneNeedsGeneration,sceneQaFailureDetails,sceneQaPublicState,publicSceneQaReason,renderSceneCoverCard};`, sandbox);
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
    bundle: { project: { id: 'task-qa' }, assets: { scenes: [{ id: 'scene-reverify', name: '复验场景', repair_plan: { action: 'reverify' } }] } },
    store: { beginStageSubmission() {}, async runStage(pathname, body) { requests.push({ pathname, body }); return { accepted: true }; } },
    async refreshShell() {},
  }, controllerFor: async () => null, cardFor: () => null });
  await button.clickHandler();
  assert.equal(authorizationCalls, 0, 'QA-only reverify must skip image billing authorization because it makes zero image calls');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, 'scene-assets/scene-reverify/fix');
  assert.equal(requests[0].body.scene_id, 'scene-reverify');
  assert.match(requests[0].body.request_key, /^scene-fix:scene-reverify:/);
}

async function testBatchBinding() {
  async function run(selector, scenes) {
    let confirmationCalls = 0;
    let authorizationCalls = 0;
    const submitted = [];
    const batchButton = { addEventListener(type, handler) { if (type === 'click') this.clickHandler = handler; } };
    const host = {
      querySelector(value) { return value === selector ? batchButton : null; },
      querySelectorAll() { return []; },
    };
    const sandbox = {
      setButtonBusy() {}, toast() {},
      confirmBillingAwareAction: async () => { confirmationCalls += 1; return { accepted: true, reviewBatch: { reviews: [] } }; },
      authorizeBillingReviews: async () => { authorizationCalls += 1; },
      sceneNeedsGeneration: () => false,
      scenePendingAction: scene => ({ kind: 'fix', billable: scene.repair_plan.action !== 'reverify' }),
      bindSceneQaActions() {},
      submitSceneFix: async ({ scene, billingAuthorized }) => { submitted.push({ action: scene.repair_plan.action, billingAuthorized }); return { accepted: true }; },
      createSceneCardEditorRuntime: () => ({ controllerFor: async () => null, cardFor: () => null, switchTab() {}, destroy() {} }),
    };
    vm.runInNewContext(`${executable('public/story-ad/views/sceneCardInteractions.js')}\nglobalThis.__bind=bindSceneCards;`, sandbox);
    sandbox.__bind(host, { bundle: { assets: { scenes } }, store: {}, async refreshShell() {} });
    await batchButton.clickHandler({ currentTarget: batchButton });
    return { confirmationCalls, authorizationCalls, submitted };
  }
  const review = await run('[data-review-all-scenes]', [
    { id: 'review', repair_plan: { action: 'reverify' } },
    { id: 'repair', repair_plan: { action: 'regenerate_failed_views' } },
  ]);
  assert.equal(review.confirmationCalls, 0, '批量重新审核不得弹出计费确认');
  assert.equal(review.authorizationCalls, 0, '批量重新审核不得执行图片计费授权');
  assert.deepEqual(review.submitted.map(item => item.action), ['reverify']);
  const repair = await run('[data-fix-all-scenes]', [
    { id: 'review', repair_plan: { action: 'reverify' } },
    { id: 'repair', repair_plan: { action: 'regenerate_failed_views' } },
  ]);
  assert.equal(repair.confirmationCalls, 1, '付费批量修复必须保留计费确认');
  assert.equal(repair.authorizationCalls, 1, '付费批量修复必须保留图片计费授权');
  assert.deepEqual(repair.submitted.map(item => item.action), ['regenerate_failed_views']);
}

async function main() {
  testPlanner();
  await testFixBinding();
  await testBatchBinding();
  const dossier = loadDossier();
  const prompt = loadPrompt(dossier);
  const reverify = completeScene('reverify', { count: 0, reasons: ['反向视图入口位置与主视图不一致'] });
  assert.equal(dossier.sceneNeedsGeneration(reverify), false, '复验任务不得进入批量图片生成');
  assert.equal(prompt.scenePendingAction(reverify).kind, 'fix', '无逐图证据必须进入统一修复编排');
  assert.deepEqual([...dossier.sceneQaFailureDetails(reverify).labels], ['跨视角一致性']);
  assert.match(dossier.renderSceneCoverCard(reverify), /QA 尚未定位到具体图片[\s\S]*反向视图入口位置与主视图不一致/);
  const reverifyHtml = prompt.renderSceneProductionCard(reverify);
  assert.match(reverifyHtml, /data-fix-scene="scene-reverify"/);
  assert.match(reverifyHtml, /重新审核（0 次图片调用）/);
  assert.doesNotMatch(reverifyHtml, /data-scene-quality/);
  const qaUnavailable = completeScene('reverify');
  qaUnavailable.qa.qa_unavailable = true;
  qaUnavailable.qa.verification_state = 'unavailable';
  qaUnavailable.qa.reasons = ['new_story_ad.scene_camera_qa 视觉模型全部失败：smscrw/claude:UNKNOWN；webang-maas/gemini:PROVIDER_RESPONSE_INVALID；zhipu/glm:RATE_LIMIT'];
  qaUnavailable.scene_card.qa_checks[0].reasons = qaUnavailable.qa.reasons;
  const unavailableHtml = dossier.renderSceneCoverCard(qaUnavailable);
  assert.match(unavailableHtml, /<details class="scene-cover-qa-notice"><summary>/);
  assert.doesNotMatch(unavailableHtml, /role="status"/);
  assert.match(unavailableHtml, /审核暂不可用 · 图片已保留/);
  assert.match(unavailableHtml, /重新审核 0 次图片调用/);
  assert.doesNotMatch(unavailableHtml, /<details[^>]*\sopen(?:\s|>)/,
    'QA service notice must remain collapsed by default so it does not cover the scene card');
  assert.doesNotMatch(unavailableHtml, /scene-cover-qa-failure is-service-unavailable/,
    'service availability must not reuse the large content-failure warning card');
  assert.doesNotMatch(unavailableHtml, /smscrw|webang-maas|zhipu|claude|gemini|PROVIDER_RESPONSE|RATE_LIMIT|UNKNOWN/,
    'ordinary scene card must not expose provider/model/internal QA codes');
  const compactCss = read('public/story-ad/scene-dossier.css');
  assert.match(compactCss, /\.scene-cover-qa-notice summary\{[^}]*min-height:36px[^}]*padding:6px 10px/);
  assert.match(compactCss, /\.scene-cover-qa-notice summary b\{[^}]*font-size:11px/);
  assert.match(compactCss, /\.scene-cover-qa-notice summary:focus-visible\{[^}]*outline:/);
  assert.match(compactCss, /@media\(max-width:480px\)[^\n]*\.scene-cover-qa-notice summary\{[^}]*min-height:42px/);
  assert.match(compactCss, /@media\(max-width:480px\)[^\n]*\.scene-cover-qa-notice summary span\{display:none\}/,
    'narrow cards must hide secondary QA copy instead of wrapping over the controls');
  assert.doesNotMatch(compactCss, /\.scene-cover-qa-notice[^\n{]*\{[^}]*position:(?:absolute|fixed)/,
    'compact QA notice must stay in document flow and never cover the image or controls');
  const unavailableCardHtml = prompt.renderSceneProductionCard(qaUnavailable);
  assert.match(unavailableCardHtml, /只重新审核，不重新生成图片。/);
  assert.doesNotMatch(unavailableCardHtml, /QA 服务暂时没有完成；已有图片全部保留/,
    'card footer must not repeat the expanded QA notice copy');

  const projectedUnavailable = sceneQaProjection.project({
    full_space_lock: false, qa_unavailable: true, verification: { state: 'unavailable' },
  });
  assert.equal(projectedUnavailable.qa_unavailable, true);
  assert.equal(projectedUnavailable.verification_state, 'unavailable');
  assert.equal(dossier.sceneQaPublicState({ qa: projectedUnavailable, repair_plan: { action: 'reverify' } }).kind, 'service_unavailable',
    '机器态必须在没有供应商关键词时稳定识别 QA 不可用');
  const projectedRejected = sceneQaProjection.project({
    full_space_lock: false, qa_unavailable: false, verification: { state: 'rejected', reasons: ['构图不一致'] },
  });
  assert.equal(projectedRejected.qa_unavailable, false);
  assert.equal(projectedRejected.verification_state, 'rejected');
  assert.equal(dossier.sceneQaPublicState({ qa: projectedRejected, repair_plan: { action: 'regenerate_failed_views' } }).kind, 'content_failed');
  assert.notEqual(dossier.sceneQaPublicState({
    qa: { ...projectedRejected, error: 'provider RATE_LIMIT' }, repair_plan: { action: 'reverify' },
  }).kind, 'service_unavailable', '明确内容拒绝态不能因错误文案关键词被误投影为服务不可用');
  assert.equal(dossier.sceneQaPublicState({
    qa: { ...projectedUnavailable, error: '上游错误文案已变化' }, repair_plan: { action: 'reverify' },
  }).kind, 'service_unavailable', 'QA 不可用机器态不得依赖错误文案');
  assert.equal(dossier.sceneQaPublicState({
    qa: { ...projectedUnavailable, full_space_lock: true }, repair_plan: { action: 'reverify' },
  }).kind, 'unknown', '已通过空间锁的场景不得继续显示 QA 警告');

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
  const worldPage = read('public/story-ad/views/sceneWorldPage.js');
  assert.match(worldPage, /data-review-all-scenes>重新审核全部（\$\{reviewReadyCount\}，0 次图片调用）/);
  assert.match(worldPage, /data-fix-all-scenes>修复未通过项（\$\{repairReadyCount\}）/);
  assert.doesNotMatch(worldPage, /修复全部未通过场景/);
  const cardInteractions = read('public/story-ad/views/sceneCardInteractions.js');
  assert.match(cardInteractions, /bindFixBatch\('\[data-review-all-scenes\]', false\)/);
  assert.match(cardInteractions, /if \(billable\)[\s\S]*confirmBillingAwareAction[\s\S]*authorizeBillingReviews/);
  const routes = read('src/routes/newStoryAd.js');
  assert.match(routes, /scene-assets\/:sceneId\/fix/);
  const fixRoute = routes.slice(
    routes.indexOf("router.post('/tasks/:id/scene-assets/:sceneId/fix'"),
    routes.indexOf("router.get('/tasks/:id/progress'"),
  );
  assert.match(fixRoute, /const qaOnly = plan\.action === 'reverify'/);
  assert.match(fixRoute, /const stage = qaOnly \? 'scene_qa' : 'scene_asset'/,
    'QA-only reverify must have an independent job stage from paid scene image repair');
  assert.match(fixRoute, /if \(qaOnly\)[\s\S]*reverifySceneAsset[\s\S]*provider_image_call_count: 0/,
    'QA-only route must stop after verification and report zero image calls');
  assert.match(fixRoute, /return sceneAssetService\.fixSceneAsset/,
    'real regenerate/repair actions must retain the scene_asset execution branch');
  const permitSource = read('src/services/newStoryAd/generationPermitService.js');
  assert.doesNotMatch(permitSource.match(/const PROTECTED_STAGES = new Set\([\s\S]*?\);/)?.[0] || '', /scene_qa/,
    'scene_qa must not consume an image generation Active Plan permit');
  assert.match(routes, /LEGACY_SCENE_VERIFY_DISABLED/);
  assert.match(routes, /LEGACY_SCENE_REPAIR_DISABLED/);
  console.log(JSON.stringify({ passed: true, unified_fix_action: true, targeted_repair_views: 1, atlas_image_calls: 2, supplier_calls: 0 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
