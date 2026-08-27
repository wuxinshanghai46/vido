'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

async function main() {
  const productResolver = require('../src/services/newStoryAd/productAssetResolverService');
  const productGeneration = require('../src/services/newStoryAd/productAssetGenerationService');
  const shotDesign = require('../src/services/newStoryAd/shotDesignService');
  const blueprint = require('../src/services/newStoryAd/blueprintService');
  const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
  const benchmarkStrategy = require('../src/services/newStoryAd/benchmarkStrategyService');
  const semantic = require('../src/services/storyAdWorkspace/productionSemanticLocalizationService');
  const cameraProjection = require('../src/services/storyAdWorkspace/sceneCameraProjectionService');

  const material = productResolver.productPresentation({
    product_subject: '当前广告主体',
    brief: '不锈钢原材料厂家要通过成品展示墙介绍铂棕碎钻纹理和金属背景墙。',
  });
  assert.equal(material.mode, 'material_surface');
  assert.equal(material.scene_linked, true);
  assert.equal(material.standalone_generation_supported, false);

  let imageCalls = 0;
  await assert.rejects(() => productGeneration.generateProductAsset('material-task', {}, {}, {
    storage: {
      getTask() { return { request: {} }; },
      getOutput() { return { product_subject: '不锈钢背景墙', brief: '展示材料纹理和墙面成品' }; },
      updateTask() { throw new Error('门禁必须发生在状态写入前'); },
    },
    mediaAdapter: { async generateImage() { imageCalls += 1; } },
  }), error => error.code === 'STANDALONE_PRODUCT_GENERATION_NOT_APPLICABLE');
  assert.equal(imageCalls, 0, '场景内展示主体不得调用独立商品图片模型');

  const productOutputs = new Map([['material-reference:context', {
    product_subject: '不锈钢背景墙', brief: '展示材料纹理和墙面成品',
    product_presentation: { mode: 'material_surface', description: '铂棕碎钻纹理' },
  }]]);
  let splitCalls = 0;
  let referencePrompt = '';
  const referenceResult = await productGeneration.generateProductAsset('material-reference', {
    reference_only: true, product_name: '不锈钢背景墙', description: '铂棕碎钻纹理',
  }, { generationId: 'generation-reference' }, {
    storage: {
      getTask() { return { request: {}, generation_started_at: '2026-08-02T00:00:00.000Z' }; },
      getOutput(taskId, kind) { return productOutputs.get(`${taskId}:${kind}`) || null; },
      saveOutput(taskId, kind, value) { productOutputs.set(`${taskId}:${kind}`, value); },
      updateTask() {},
    },
    mediaAdapter: {
      async generateImage(input) { imageCalls += 1; referencePrompt = input.prompt; return { image_url: '/generated/material-reference.png', provider_used: 'mock' }; },
      async splitReferenceSheet() { splitCalls += 1; return []; },
    },
    productIdentity: { buildProductContract() { return { status: 'pending', product_revision: 1 }; } },
    revisionService: { invalidateOutputs() {} },
  });
  assert.equal(imageCalls, 1, '展示主体参考图只调用一次图片模型');
  assert.equal(splitCalls, 0, '单张展示主体参考图不得再切成虚假的商品四视图');
  assert.equal(referenceResult.product_asset.reference_only, true);
  assert.equal(referenceResult.product_asset.type, 'product_material');
  assert.equal(referenceResult.product_asset.view_images.length, 1);
  assert.match(referencePrompt, /do not turn it into an unrelated standalone package/);

  const effect = shotDesign.motionEffectPrompt({
    type: 'explode_view', source_state: '完整机器人', target_state: '部件沿三轴分解后精确复位',
    timeline: '0-1秒定格；1-3秒分解；3-4秒悬停；4-6秒复位', preserve_scene_geometry: true,
  });
  assert.match(effect, /non-overlapping axes/);
  assert.match(effect, /exact original position/);
  assert.match(effect, /0-1秒定格/);

  const normalized = blueprint.normalizeBlueprint({ beats: [
    { plot: '旧方案造成空间廉价感', spoken_line: '先别急着看材料。' },
    { plot: '人物走到新展示墙前', promo_visual: '完整成品墙进入画面', spoken_line: '先看它放进空间以后。' },
    { plot: '微距展示纹理并对比旧拉丝钢板', visual_proof: '纹理、反射和边缘细节可见', dialogue_function: 'proof', spoken_line: '光一走，层次就出来了。' },
    { plot: '完整空间收束', spoken_line: '材料不是配角，它决定空间的质感。' },
  ] }, { brief: '材料墙广告', product_subject: '不锈钢背景墙', target_duration: 20, cast_mode: 'single' });
  assert.equal(normalized.beats[0].ad_phase, 'opening_hook');
  assert.equal(normalized.beats.at(-1).ad_phase, 'closing_payoff');
  assert(normalized.beats.slice(1, -1).some(beat => ['product_introduction', 'product_proof'].includes(beat.ad_phase)));
  assert.equal(normalized.ad_structure_contract.version, 'opening-proof-closing-v1');
  assert(normalized.copy_naturalness_policy.never_apply_to.includes('video_effect_timelines'));

  const sceneSpec = contextBuilder.normalizeSceneSpec({
    layoutText: '完整空间布局说明，包含入口、展示墙和人物行走路径。',
    materialLightText: '金属墙面与柔和侧光，保持真实反射。',
    interactionText: '人物从入口走向展示墙并停在细节观察位。',
    negativeText: '不要额外墙面，不要错误材质，不要文字。',
    cameraPlan: [{ id: 'cam-entry', label: '入口建立位', movement: '从入口缓慢推进至展示墙', duration: 4 }],
  });
  assert.equal(sceneSpec.cameraPlan[0].movement, '从入口缓慢推进至展示墙');
  assert.equal(sceneSpec.cameraPlan[0].duration, 4);

  assert.equal(semantic.labelFor('natural_smile', 'natural_smile'), '自然微笑');
  const localizedCamera = semantic.sceneCamera({ view_id: 'master', label: 'Main Layout View', role: 'master', framing: 'wide', lens: 'wide', height: 'medium' });
  assert.equal(localizedCamera.label, '主空间全景机位');
  assert.equal(localizedCamera.framing, '全景');
  assert.equal(localizedCamera.lens, '广角');
  assert.equal(localizedCamera.height, '中等机位');
  assert.equal(semantic.sceneCamera({ view_id: 'detail', visible_evidence: 'surface topology variations,lighting gradients' }).visible_evidence, '表面肌理变化、光线渐变');
  const projectedCamera = cameraProjection.projectSceneCamera({
    id: 'interaction', movement_type: 'tracking', route: '入口到展墙', speed: 'slow',
    subject_action: '人物触摸材料', focus_target: '手部与纹理', continuity: '保持轴线', stabilization: 'gimbal', duration: 4,
  });
  assert.equal(projectedCamera.movement_type, 'tracking');
  assert.equal(projectedCamera.route, '入口到展墙');
  assert.equal(projectedCamera.subject_action, '人物触摸材料');
  assert.equal(projectedCamera.focus, '手部与纹理');
  assert.equal(projectedCamera.duration, 4);
  const benchmark = benchmarkStrategy.resolve({
    brief: '用长发模特展示不锈钢背景墙，加入旧钢板对比和纹理特写。',
    product_subject: '不锈钢材料',
    product_presentation: { mode: 'material_surface', scene_linked: true },
  });
  assert.match(benchmark.opening_hook, /完整空间|旧方案/);
  assert.match(benchmark.spectacle, /分解/);
  assert.match(benchmark.prompt_method, /摄影机轨迹/);
  const historicalBenchmark = benchmarkStrategy.resolve({
    brief: '人物从展示墙介绍不锈钢材料纹理，并展示完整高级家居空间。',
    product_subject: '当前广告主体',
    product_presentation: { mode: 'standalone_product', scene_linked: false },
  });
  assert.match(historicalBenchmark.opening_hook, /完整空间/);
  assert.match(historicalBenchmark.subject_introduction, /不锈钢材料与成品背景墙/);
  const prompt = contextBuilder.contextPrompt(contextBuilder.buildContext({
    brief: '不锈钢材料广告', product_subject: '不锈钢背景墙', benchmark_strategy: { ...benchmark, user_edited: true },
  }));
  assert.match(prompt, /竞品方法应用合同/);
  assert.match(prompt, /opening_hook/);
  assert.match(prompt, /不能靠故意病句/);

  const uiSource = read('public/story-ad/components/ui.js').replace(/\bexport\s+/g, '');
  const lightboxSource = read('public/story-ad/views/mediaLightbox.js').replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
  const sandbox = {};
  vm.runInNewContext(`${lightboxSource}\nglobalThis.__unique = uniqueLightboxEntries;`, sandbox, { filename: 'sceneDossierLightbox.js' });
  vm.runInNewContext(`${uiSource}\nglobalThis.__progressView = generationProgressView;`, sandbox, { filename: 'ui.js' });
  const unique = sandbox.__unique([
    { dataset: { mediaZoomGroup: 'person', mediaZoomUrl: '/same.png', mediaZoomLabel: '重复一' } },
    { dataset: { mediaZoomGroup: 'person', mediaZoomUrl: '/same.png', mediaZoomLabel: '重复二' } },
    { dataset: { mediaZoomGroup: 'person', mediaZoomUrl: '/next.png', mediaZoomLabel: '下一张' } },
  ], 'person');
  assert.deepEqual(Array.from(unique, item => item.url), ['/same.png', '/next.png']);
  assert(lightboxSource.indexOf('image.src = previewUrl') < lightboxSource.indexOf('await preloadLightboxUrl(current.url)'), '灯箱必须立即显示已有预览，再在后台加载并升级原图');
  assert.match(lightboxSource, /function preloadLightboxUrl[^{]+timeoutMs\s*=\s*12000/, '灯箱资源预载必须设置有限等待时间');
  assert.match(lightboxSource, /图片加载超时/, '原图或预览长时间无 load/error 时必须退出加载态并保留当前预览');
  assert.doesNotMatch(lightboxSource, /image\.removeAttribute\('src'\)/, '后台原图加载期间不得清空已显示的预览图');
  assert.match(lightboxSource, /<img data-media-lock="true" draggable="false" alt="">/, '动态大图必须阻止全局媒体优化器和原生拖拽复用图片');
  assert.match(uiSource, /data-media-preview-url="\$\{escapeHtml\(previewUrl\)\}"/, '灯箱预览地址必须复用已经请求的缩略图');

  const dossierUi = read('public/story-ad/views/personDossierShowcase.js');
  assert.match(dossierUi, /配饰与鞋履单品/);
  assert.match(dossierUi, /2K 独立细节图/);
  assert.match(dossierUi, /accessory_details/);
  assert.match(dossierUi, /wardrobe_details/);
  assert.match(dossierUi, /groupRoot.*-accessories/s);
  assert.match(dossierUi, /groupRoot.*-actions/s);
  assert.doesNotMatch(dossierUi, /const group = `person-dossier-/, '人物档案不同分区不得共用一个灯箱序列');
  assert.doesNotMatch(dossierUi, /fallbackAccessories/, '没有配饰细节时不得再回退到全身照');
  assert.match(dossierUi, /不再用头像或全身图冒充配饰/);
  assert.doesNotMatch(dossierUi, /dossier-accessories[^\n]+identity\.slice/, '配饰区不得再次使用头像数组');
  const assetUi = read('public/story-ad/views/assetCenterView.js');
  const sceneWorldPageUi = read('public/story-ad/views/sceneWorldPage.js');
  const sceneProductionUi = `${read('public/story-ad/views/scenePromptPreview.js')}\n${read('public/story-ad/views/sceneCardInteractions.js')}`;
  const planningUi = read('public/story-ad/views/assetCenterPlanningDetails.js');
  assert.match(planningUi, /动态拍摄路线与执行细则/);
  assert.match(planningUi, /机位调度与观看方向/);
  assert.match(planningUi, /紫色虚线表示整组镜头的机位调度顺序，不等同于单个镜头的实际运镜轨迹/);
  assert.match(planningUi, /movement_type/);
  assert.match(planningUi, /subject_action/);
  assert.match(planningUi, /continuity/);
  assert.match(planningUi, /camera\.position/);
  assert.match(planningUi, /camera-map-route/);
  assert(planningUi.indexOf("group === 'scenes' ? sceneDetails(item)") < planningUi.indexOf('查看场景原始图集'), '机位规划必须出现在原始场景图集之前');
  assert.match(planningUi, /data-scene-edit/);
  assert.match(planningUi, /data-product-edit/);
  assert.match(assetUi, /standalone_generation_supported/);
  assert.match(assetUi, /AI 生成商品资产/);
  assert.match(assetUi, /AI 生成展示主体参考图/);
  assert.match(assetUi, /不会伪装成独立商品四视图/);
  assert.match(assetUi, /data-upload-product/);
  assert.doesNotMatch(assetUi, /重新生成场景与机位|data-generate-scene/, '资产中心不得继续拥有场景生成入口');
  assert.match(sceneProductionUi, /data-generate-scene/);
  assert.match(`${sceneWorldPageUi}\n${sceneProductionUi}`, /提示词/);
  assert.match(`${sceneWorldPageUi}\n${sceneProductionUi}`, /场景画面/);
  assert.doesNotMatch(assetUi, /本片广告结构与竞品方法/);
  assert.doesNotMatch(assetUi, /COMPETITOR METHOD/);
  assert.doesNotMatch(assetUi, /data-edit-benchmark/);
  const shotUi = read('public/story-ad/views/shotDesignerView.js');
  assert.match(shotUi, /explode_view/);
  assert.match(shotUi, /data-motion-effect-field="timeline"/);

  const briefUi = read('public/story-ad/views/briefView.js');
  assert.match(briefUi, /benchmark_strategy/);
  assert.doesNotMatch(briefUi, /竞品方法如何用于这支广告/);
  assert.match(briefUi, /type="hidden" name="benchmark_opening_hook"/);

  const storeUi = read('public/story-ad/store/projectStore.js');
  const storyboardUi = read('public/story-ad/views/storyboardView.js');
  assert.match(storeUi, /applyMutationResult\(data\)/, '后台提交响应必须先合并到当前 bundle，进度条才能立即出现');
  assert.doesNotMatch(storyboardUi, /await store\.runStage\('storyboard'\);[\s\S]{0,220}await context\.refreshShell\(\)/, '文字分镜提交后不得立即刷新并重置进度轮询');
  const storeSandbox = {
    request: async (url, options = {}) => {
      if (options.method === 'POST' && url.endsWith('/storyboard')) return {
        success: true,
        accepted: true,
        task: {
          id: 'task-progress', status: 'queued', stage: 'storyboard_queued', active_stage: 'storyboard',
          active_generation_id: 'generation-progress', generation_queued_at: '2026-08-02T08:00:00.000Z',
        },
        job: { id: 'generation-progress', stage: 'storyboard', status: 'queued' },
      };
      throw new Error(`unexpected request ${url}`);
    },
    uploadAsset() {}, uploadReferenceVideo() {}, beginReferenceReplacement() {}, replacementCurrent() {},
    removeProjectReference() {}, restoreReferenceReplacement() {}, setTimeout, clearTimeout, Date, URLSearchParams,
  };
  const runnableStoreSource = storeUi.replace(/^import .*$/gm, '').replace(/\bexport\s+/g, '');
  vm.runInNewContext(`${runnableStoreSource}\nglobalThis.__createProjectStore = createProjectStore;`, storeSandbox, { filename: 'projectStore.js' });
  const progressStore = storeSandbox.__createProjectStore();
  progressStore.state.bundle = { project: { id: 'task-progress', status: 'done' }, generation: { progress: { stage: 'old', percent: 100 } }, revisions: { content: 1 } };
  await progressStore.runStage('storyboard');
  assert.equal(progressStore.state.bundle.project.active_generation_id, 'generation-progress');
  assert.equal(progressStore.state.bundle.generation.progress, null, '提交新任务后必须清除上一轮 100% 进度');
  const submittedProgress = sandbox.__progressView(progressStore.state.bundle);
  assert.equal(submittedProgress.active, true);
  assert.equal(submittedProgress.stage, 'storyboard');
  assert.equal(submittedProgress.percent, 0);
  progressStore.stopProgressPolling();

  console.log(JSON.stringify({ passed: true, checks: 79, image_model_calls: imageCalls, split_calls: splitCalls, submitted_progress_visible: true }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
