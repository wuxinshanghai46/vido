const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const sceneWorld = require('../src/services/storyAdWorkspace/sceneWorldService');

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
const mountBody = assetView.slice(assetView.indexOf('export async function mount'));
assert(mountBody.indexOf('renderSections(assets, total)') < mountBody.indexOf('renderSceneWorldWorkspace(bundle)'), 'SceneWorld must render below scene assets');
assert(assetView.includes('data-generate-visual-assets'));
assert(assetView.includes("store.runStage('visual-assets'"));
assert(assetView.includes('同时生成人物与场景'));

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

const jobs = read('src/services/newStoryAd/jobService.js');
assert(jobs.includes("function jobKey(taskId)"), 'single outer task lock must remain');
assert(jobs.includes("'visual_assets'"));
const store = read('public/story-ad/store/projectStore.js');
assert(store.includes('if (data.accepted === false)'), 'duplicate jobs must not be reported as submitted');
const adapter = read('src/services/newStoryAd/mediaAdapter.js');
assert(adapter.includes("'new_story_ad.image_provider'"), 'all image calls must share one provider pool');

console.log(JSON.stringify({
  success: true,
  transport_code: transport.code,
  planned_worlds: 0,
  ready_worlds: 1,
  joint_lanes: 2,
  duplicate_submission_guard: true,
  provider_pool: 'new_story_ad.image_provider',
}, null, 2));
