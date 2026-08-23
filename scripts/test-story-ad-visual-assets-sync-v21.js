const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const sceneWorld = require('../src/services/storyAdWorkspace/sceneWorldService');
const { collectStoryAdReleaseFiles } = require('./lib/storyAdReleaseFiles');

const transport = modelGateway.classifyError(new Error(
  'upstream connect error or disconnect/reset before headers. reset reason: connection termination',
));
assert.strictEqual(transport.code, 'TIMEOUT_OR_NETWORK');
assert.strictEqual(transport.retryable, true);

const plannedBundle = { assets: { scenes: [{ id: 'planned', name: '通用待生成场景', status: 'planned' }] } };
const plannedWorlds = sceneWorld.buildSceneWorlds(plannedBundle);
assert.strictEqual(plannedWorlds.length, 1, 'planned scenes must remain visible as preallocated scene-world tasks');
assert.strictEqual(plannedWorlds[0].visual_authority_ready, false, 'planned scene-world tasks must not impersonate generated visual assets');
const readyBundle = { assets: { scenes: [{ id: 'ready', name: '已生成场景', image_url: '/assets/ready.png' }] } };
assert.strictEqual(sceneWorld.buildSceneWorlds(readyBundle).length, 1, 'visual evidence must unlock one world');
const partialManifest = sceneWorld.productionManifest({ assets: { scenes: [...plannedBundle.assets.scenes, ...readyBundle.assets.scenes] } }, sceneWorld.buildSceneWorlds(readyBundle));
assert.strictEqual(partialManifest.counts.worlds, 1);
assert.strictEqual(partialManifest.counts.planned_scenes, 2);
assert.strictEqual(partialManifest.counts.pending_scenes, 1);

const assetView = read('public/story-ad/views/assetCenterView.js');
const planningStatusView = read('public/story-ad/views/assetCenterPlanReleaseStatus.js');
const unifiedStageView = read('public/story-ad/views/assetCenterStageView.js');
const billingRetryView = read('public/story-ad/views/assetCenterBillingRetry.js');
const billingReviewDialog = read('public/story-ad/views/assetCenterBillingReviewDialog.js');
const sceneWorldPage = read('public/story-ad/views/sceneWorldPage.js');
const scenePlanStatus = read('public/story-ad/views/scenePlanStatus.js');
assert(!assetView.includes('renderSceneWorldWorkspace(bundle)'), 'asset tasks and scene-world workflow must remain separate');
assert(sceneWorldPage.includes('renderSceneWorldWorkspace(bundle)'), 'the dedicated scene step must own the scene-world workspace');
assert(!assetView.includes('data-generate-visual-assets'), 'asset center must not expose the old all-subject-and-scene batch action');
assert(!sceneWorldPage.includes('data-generate-base-scene'), 'scene workflow must not expose the blocked independent scene-generation action');
assert(sceneWorldPage.includes('production_graph_v1'), 'scene workflow must be unlocked by the unified production graph');
assert(billingRetryView.includes("store.runStage('visual-assets'"));
assert(billingRetryView.includes('同时生成人物与场景'));
assert(unifiedStageView.includes('生成全部制作资产'), '人物、场景与镜头必须使用统一生成动作');
assert(unifiedStageView.includes('完整人物、穿搭配饰、随身物、动作表情、场景母图、360°全景、机位与逐镜绑定'), '统一动作必须明确覆盖完整制作资产');
assert.strictEqual((unifiedStageView.match(/data-generate-production-assets/g) || []).length, 1, '资产中心只能提供一个主生成入口');
assert(unifiedStageView.includes("generationActive ? '正在生成全部制作资产…'"), '统一按钮必须区分运行中与空闲状态');
assert(!planningStatusView.includes('人物方案需要更新') && !planningStatusView.includes('文字方案确认后，再单独生成图片'), '旧状态标签和两步式提示必须删除');
assert(!planningStatusView.includes('人物与场景方案'), '人物页不得继续显示合并方案提示');
assert(scenePlanStatus.includes('当前内容的场景方案'), '场景合同失效时必须只给出场景方案第一步');
assert(scenePlanStatus.includes('不修改人物身份、人物图片和人物造型'), '场景更新提示必须明确保护人物资产');
assert(scenePlanStatus.includes('已有站位绑定无法安全延续时会阻止发布'), '场景更新提示必须明确站位绑定失效时阻止发布');
assert.strictEqual((scenePlanStatus.match(/type="button" data-update-scene-plan/g) || []).length, 1, '场景合同失效提示只能提供一个场景方案更新按钮');
assert(!scenePlanStatus.includes('人物与场景方案'), '场景页不得继续显示合并方案提示');
assert(assetView.includes("host.querySelector('[data-generate-production-assets]')?.addEventListener"), '资产中心必须只提交统一制作资产入口');
assert(!assetView.includes('请先更新当前人物与场景方案'), '人物生成按钮不得继续显示合并方案提示');

const briefView = read('public/story-ad/views/briefView.js');
assert.strictEqual((briefView.match(/brief-reference-primary-action/g) || []).length, 1, 'next-step CTA must not be duplicated below the report');
assert(briefView.indexOf('brief-reference-primary-action is-top-action') < briefView.indexOf('data-reference-progress-host'), 'confirmed recovery CTA must stay at the top');
const referenceCss = read('public/story-ad/reference-understanding.css');
assert(referenceCss.includes('.reference-understanding-actions { order: -1; }'), 'report confirmation action must render directly below its header');

const ui = read('public/story-ad/components/ui.js');
assert(ui.includes('生成中断（模型连接失败）'));
assert(ui.includes('生成中断（计费待核对）'));
assert(ui.includes('内容审核未通过'));
assert(!ui.includes('`${view.stageLabel}审核未通过`'), 'generic failures must not be mislabeled as audit failures');
assert(ui.includes('generation-lanes'));
assert(!ui.includes('>处理缺失项</button>'), '视觉失败面板不得再提供含义不明的通用按钮');
assert(ui.includes("前往资产中心${ready ? '继续缺失图片' : '更新人物与场景方案'}"), '不在资产中心时必须明确导航到合同修复入口');
assert(ui.includes("currentView !== 'assets'"), '已在资产中心时不得重复显示无效跳转');

const route = read('src/routes/newStoryAd.js');
const billingRoutes = read('src/routes/newStoryAd/visualAssetBillingRoutes.js');
assert(route.includes("queueTaskStage(req, res, 'visual_assets'"));
assert(route.includes('Promise.allSettled([subjectLane, sceneLane])'));
assert(route.includes('deferCommit: true'));
assert(route.includes('deferPublish: true'));
assert(route.includes('existingSceneAssets: sceneAssets'));
assert(route.includes('sceneFailures.push({'), 'scene failures must be collected without aborting the remaining scene targets');
assert(route.includes('continue;') && route.includes('error.partial_scene_assets = sceneAssets'), 'completed scenes must survive while later independent scenes continue');
assert(billingRoutes.includes("'/tasks/:id/visual-assets/retry-authorization'"), 'billing-unknown visual recovery must retain the owned one-time compatibility endpoint');
assert(billingRoutes.includes("'/tasks/:id/visual-assets/retry-authorizations'"), 'multi-unit billing recovery must expose one atomic batch authorization endpoint');
assert(billingRetryView.includes("? '核对并继续'"), '计费未知状态的主按钮必须先表达核对，再继续缺失项');
assert(!billingRetryView.includes("? '重新生成'"), '计费未知状态不得误导用户整批重新生成');
assert(!assetView.includes('当前人物配饰存在计费未知记录'), '单个人物按钮不能再被其它计费未知单元全局拦截');
assert(assetView.includes("lane: 'subjects'"), '人物按钮必须只核对人物分支的失败单元');
assert(assetView.includes("lane: 'scenes'"), '场景按钮必须只核对当前场景的失败单元');
assert(billingRetryView.includes('accept_duplicate_charge_risk: true'));
assert(billingRetryView.includes('/visual-assets/retry-authorizations'));
assert(billingRetryView.includes('checkpoint_keys: reviews.map'), '批量计费风险授权必须携带精确 checkpoint 集合');
assert.strictEqual((billingReviewDialog.match(/confirmDialog\(/g) || []).length, 1, '一次用户操作只能出现一个计费确认弹窗');
assert(billingReviewDialog.includes('本次一次确认同时覆盖'), '多个未知计费单元必须合并成一次明确确认');
assert(billingReviewDialog.includes('最多可能产生'), '批量确认必须展示最大重复费用次数');
assert(!billingRetryView.includes('for (const review of reviews)'), '一次确认后不得由前端逐 checkpoint 产生部分写入');
assert(!billingReviewDialog.includes('逐项核对：'), '不得再次为每个单元弹出确认框');
assert(billingRetryView.includes("import('./assetCenterBillingReviewDialog.js"), '计费确认界面必须只在用户点击时按需加载');
assert(billingRetryView.includes("progress.billing_state === 'unknown'"), '再次供应商未知后必须继续显示费用风险入口');
assert(billingRetryView.includes("subjectLane.billing_state === 'unknown'"), '主体分支未知计费必须继续锁定通用生成入口');

const jobs = read('src/services/newStoryAd/jobService.js');
assert(jobs.includes("function jobKey(taskId)"), 'single outer task lock must remain');
assert(jobs.includes("'visual_assets'"));
const store = read('public/story-ad/store/projectStore.js');
assert(store.includes('if (data.accepted === false)'), 'duplicate jobs must not be reported as submitted');
const adapter = read('src/services/newStoryAd/mediaAdapter.js');
assert(adapter.includes("'new_story_ad.image_provider'"), 'all image calls must share one provider pool');
assert(adapter.includes('generationBillingGuard.run'), '计费未知后必须阻止同一图片单元再次提交');
assert(adapter.includes('unitKey: clientRequestId'), '计费未知必须只冻结精确图片单元，不能拖停整次任务');
assert(adapter.includes("error.code = coolingDown ? 'IMAGE_CIRCUIT_OPEN'"), '断路器冷却不得再误报为模型配置没有可用通道');
assert(adapter.includes('本次没有发起新的图片调用'), '断路器提示必须明确当前没有产生新费用');
const deployRelease = collectStoryAdReleaseFiles({ root }).map(file => `'${file}'`).join('\n');
assert(deployRelease.includes("'src/services/newStoryAd/sceneBindingService.js'"), '场景权威合并运行文件必须进入生产发布清单');

console.log(JSON.stringify({
  success: true,
  transport_code: transport.code,
  planned_worlds: 1,
  ready_worlds: 1,
  joint_lanes: 2,
  duplicate_submission_guard: true,
  provider_pool: 'new_story_ad.image_provider',
}, null, 2));
