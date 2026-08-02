const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const lines = relativePath => read(relativePath).split(/\r?\n/).length;

function assertFile(relativePath) {
  assert(fs.existsSync(path.join(ROOT, relativePath)), `${relativePath} 不存在`);
}

function run() {
  const frozenLegacyLimits = {
    'src/services/newStoryAd/storyAdService.js': 3800,
    'src/services/newStoryAd/sceneAssetService.js': 1816,
    'src/routes/newStoryAd.js': 1880,
    'public/js/new-story-ad-legacy-ui.js': 6399,
    'public/js/new-story-ad/bootstrap.js': 180,
  };
  Object.entries(frozenLegacyLimits).forEach(([file, limit]) => {
    assert(lines(file) <= limit, `${file} 为 ${lines(file)} 行，超过冻结上限 ${limit}，新增能力必须拆到独立模块`);
  });

  [
    'src/services/newStoryAd/assetGenerationCheckpointService.js',
    'src/services/newStoryAd/generationConcurrencyService.js',
    'src/services/newStoryAd/personDossierCompiler.js',
    'src/services/newStoryAd/dossierCompositeService.js',
    'src/services/newStoryAd/propAssetService.js',
    'src/services/newStoryAd/propIdentityContractService.js',
    'src/services/newStoryAd/propTimelineService.js',
    'src/services/newStoryAd/referenceSelectionService.js',
    'src/services/newStoryAd/sceneStructuredContractService.js',
    'src/services/newStoryAd/assetPlanService.js',
    'src/routes/newStoryAd/propRoutes.js',
    'public/js/new-story-ad/asset-ui-contract.js',
    'public/js/new-story-ad/person-dossier-ui.js',
    'public/js/new-story-ad/prop-assets.js',
  ].forEach(assertFile);

  const bootstrap = read('public/js/new-story-ad/bootstrap.js');
  const assetLoader = read('public/js/new-story-ad/bootstrap-asset-loader.js');
  ['scene-assets.js', 'subject-assets-ui.js', 'person-dossier-ui.js', 'prop-assets.js', 'real-person-dossier.js'].forEach(name => {
    assert(!bootstrap.includes(name), `首屏核心脚本不得加载重型资产模块 ${name}`);
    assert(assetLoader.includes(name), `资产步骤加载器缺少 ${name}`);
  });
  assert(bootstrap.includes('asset-ui-contract.js'), '首屏必须加载轻量资产数据契约');
  assert(bootstrap.includes('stopImmediatePropagation'), '进入资产步骤前必须等待重型模块加载完成');

  const subjectShim = read('src/services/newStoryAd/subjectReferenceService.js');
  assert(subjectShim.includes("module.exports = require('./referenceSelectionService')"), '引用选择必须只有 referenceSelectionService 一条权威路径');
  assert(lines('src/services/newStoryAd/subjectReferenceService.js') <= 4, '旧引用选择服务只能保留兼容导出');

  const subjectBundle = read('src/services/newStoryAd/subjectAssetBundleService.js');
  const realPerson = read('src/services/newStoryAd/personDossierService.js');
  assert(subjectBundle.includes('personDossierCompiler.compilePersonDossier'), '普通 AI 人物必须使用统一20项档案编译器');
  assert(realPerson.includes('personDossierCompiler.compilePersonDossier'), '授权真人必须使用统一20项档案编译器');
  assert(subjectBundle.includes('atomic_assets: compiled.atomic_assets'), '普通 AI 人物必须持久化20项底层档案素材');
  assert(realPerson.includes('atomic_assets: atomicAssets'), '授权真人必须持久化20项底层档案素材');

  const propRoutes = read('src/routes/newStoryAd/propRoutes.js');
  const rootRoutes = read('src/routes/newStoryAd.js');
  assert(propRoutes.includes('/tasks/:id/prop-assets'), '独立道具路由缺失');
  assert(!rootRoutes.includes("router.get('/tasks/:id/prop-assets'"), '道具路由不得回写旧总路由');

  const sceneService = read('src/services/newStoryAd/sceneAssetService.js');
  assert(sceneService.includes('sceneStructuredContractService'), '场景生成必须读取结构化场景契约');
  assert(sceneService.includes('structured_scene_contract'), '结构化场景证据必须进入生成与复核');

  const assetPlan = read('src/services/newStoryAd/assetPlanService.js');
  const modelGateway = read('src/services/newStoryAd/modelGateway.js');
  assert(assetPlan.includes("stage: 'new_story_ad.asset_plan'"), '无参考任务必须走单次统一资产计划');
  assert(assetPlan.includes("source: 'reference_analysis_projection'"), '有效参考分析必须确定性投影');
  assert(assetPlan.includes('previous?.fingerprint === currentFingerprint'), '资产计划必须按输入指纹复用');
  assert(modelGateway.includes("stage === 'new_story_ad.asset_plan'") && modelGateway.includes("? 'new_story_ad.scene_config'"), '统一资产计划必须继承已验证的场景配置文本路由');

  const personUi = read('public/js/new-story-ad/subject-assets-ui.js');
  const dossierUi = read('public/js/new-story-ad/person-dossier-ui.js');
  const workspaceAssetCenter = read('public/story-ad/views/assetCenterView.js');
  assert(!workspaceAssetCenter.includes("mediaSection('可复用原子素材'"), '新版资产中心不得向用户展示底层可复用原子素材');
  assert(personUi.includes('cover_image_url'), '人物卡片必须默认只读取封面');
  assert(personUi.includes('data-nsa-subject-dossier-key') && dossierUi.includes('20项完整档案视图'), '人物卡片必须提供20项完整档案视图入口');

  console.log(JSON.stringify({
    passed: true,
    frozen_file_lines: Object.fromEntries(Object.keys(frozenLegacyLimits).map(file => [file, lines(file)])),
    authoritative_person_paths: 1,
    authoritative_prop_paths: 1,
    authoritative_reference_selectors: 1,
    first_step_heavy_asset_modules: 0,
  }, null, 2));
}

run();
