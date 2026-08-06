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
assert.deepStrictEqual(sceneWorld.buildSceneWorlds(plannedBundle), [], 'planned text must not become a world');
const readyBundle = { assets: { scenes: [{ id: 'ready', name: '已生成场景', image_url: '/assets/ready.png' }] } };
assert.strictEqual(sceneWorld.buildSceneWorlds(readyBundle).length, 1, 'visual evidence must unlock one world');
const partialManifest = sceneWorld.productionManifest({ assets: { scenes: [...plannedBundle.assets.scenes, ...readyBundle.assets.scenes] } }, sceneWorld.buildSceneWorlds(readyBundle));
assert.strictEqual(partialManifest.counts.worlds, 1);
assert.strictEqual(partialManifest.counts.planned_scenes, 2);
assert.strictEqual(partialManifest.counts.pending_scenes, 1);

const assetView = read('public/story-ad/views/assetCenterView.js');
const billingRetryView = read('public/story-ad/views/assetCenterBillingRetry.js');
const mountBody = assetView.slice(assetView.indexOf('export async function mount'));
assert(mountBody.indexOf('renderSections(assets, total)') < mountBody.indexOf('renderSceneWorldWorkspace(bundle)'), 'SceneWorld must render below scene assets');
assert(assetView.includes('data-generate-visual-assets'));
assert(billingRetryView.includes("store.runStage('visual-assets'"));
assert(billingRetryView.includes('同时生成人物与场景'));
assert(!assetView.includes('<button class="btn primary" type="button" data-build-scenes>'), '场景规划按钮静止时不得伪装成默认下一步');
assert(assetView.includes("assets.scenes?.length ? '重新建立场景规划' : '建立场景规划'"), '已有场景方案时必须明确显示为重新建立');
assert(assetView.includes("button.classList.add('primary')"), '场景规划按钮只在执行期间进入强调态');
assert(assetView.includes("button.classList.remove('primary')"), '场景规划执行结束后必须恢复中性态');

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

const route = read('src/routes/newStoryAd.js');
assert(route.includes("queueTaskStage(req, res, 'visual_assets'"));
assert(route.includes('Promise.allSettled([subjectLane, sceneLane])'));
assert(route.includes('deferCommit: true'));
assert(route.includes('deferPublish: true'));
assert(route.includes('existingSceneAssets: sceneAssets'));
assert(route.includes('sceneError.partial_scene_assets = sceneAssets'), 'completed scenes must survive a later scene failure');
assert(route.includes("'/tasks/:id/visual-assets/retry-authorization'"), 'billing-unknown visual recovery must expose an owned one-time authorization endpoint');
assert(billingRetryView.includes("? '重新生成'"), '计费未知状态的主按钮必须明确命名为重新生成');
assert(!billingRetryView.includes('接受费用风险并继续缺失项'), '费用风险说明不能替代重新生成的操作名称');
assert(!assetView.includes('当前人物配饰存在计费未知记录'), '单个人物按钮不能再被其它计费未知单元全局拦截');
assert(assetView.includes("lane: 'subjects'"), '人物按钮必须只核对人物分支的失败单元');
assert(assetView.includes("lane: 'scenes'"), '场景按钮必须只核对当前场景的失败单元');
assert(billingRetryView.includes('accept_duplicate_charge_risk: true'));
assert(billingRetryView.includes('/visual-assets/retry-authorization'));
assert(billingRetryView.includes('checkpoint_key: review.review_key'), '计费风险授权必须精确到单个 checkpoint');
assert(billingRetryView.includes('for (const review of reviews)'), '多个计费未知单元必须逐项确认，不能批量授权');
assert(billingRetryView.includes("progress.billing_state === 'unknown'"), '再次供应商未知后必须继续显示费用风险入口');
assert(billingRetryView.includes("subjectLane.billing_state === 'unknown'"), '主体分支未知计费必须继续锁定通用生成入口');

const jobs = read('src/services/newStoryAd/jobService.js');
assert(jobs.includes("function jobKey(taskId)"), 'single outer task lock must remain');
assert(jobs.includes("'visual_assets'"));
const store = read('public/story-ad/store/projectStore.js');
assert(store.includes('if (data.accepted === false)'), 'duplicate jobs must not be reported as submitted');
const adapter = read('src/services/newStoryAd/mediaAdapter.js');
assert(adapter.includes("'new_story_ad.image_provider'"), 'all image calls must share one provider pool');
assert(adapter.includes('generationBillingGuard.run'), '同一任务首次计费未知后必须阻止尚未提交的后续图片调用');
const deployRelease = collectStoryAdReleaseFiles({ root }).map(file => `'${file}'`).join('\n');
assert(deployRelease.includes("'src/services/newStoryAd/sceneBindingService.js'"), '场景权威合并运行文件必须进入生产发布清单');

console.log(JSON.stringify({
  success: true,
  transport_code: transport.code,
  planned_worlds: 0,
  ready_worlds: 1,
  joint_lanes: 2,
  duplicate_submission_guard: true,
  provider_pool: 'new_story_ad.image_provider',
}, null, 2));
