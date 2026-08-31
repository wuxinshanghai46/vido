'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

async function testAutosaveRuntime() {
  const source = `${read('public/story-ad/components/textAutosave.js')
    .replace('export function bindTextAutosave', 'function bindTextAutosave')}\nmodule.exports = { bindTextAutosave };`;
  const sandbox = { module: { exports: {} }, exports: {}, setTimeout, clearTimeout, Promise, String };
  vm.runInNewContext(source, sandbox, { filename: 'textAutosave.js' });
  const { bindTextAutosave } = sandbox.module.exports;
  const input = new EventTarget();
  input.value = '初始提示词';
  const status = { dataset: {}, textContent: '' };
  const saved = [];
  const controller = bindTextAutosave({ input, status, delay: 5, save: async value => { saved.push(value); return { value }; } });

  await controller.flush();
  assert.deepStrictEqual(saved, [], '原样点击生成前冲刷不得伪造提示词更新或发出保存请求');

  input.value = '编辑后的提示词';
  input.dispatchEvent(new Event('input'));
  await controller.flush();
  assert.deepStrictEqual(saved, ['编辑后的提示词']);
  assert.strictEqual(status.dataset.autosaveState, 'saved');

  input.dispatchEvent(new Event('compositionstart'));
  input.value = '输入法组合中';
  input.dispatchEvent(new Event('input'));
  await controller.flush();
  assert.strictEqual(saved.length, 1, '输入法组合期间不得写入半成品');
  input.dispatchEvent(new Event('compositionend'));
  await controller.flush();
  assert.strictEqual(saved.at(-1), '输入法组合中');
  controller.destroy();
}

function testCurrentUiContract() {
  const scene = read('public/story-ad/views/sceneWorldPage.js');
  const sceneInteractions = read('public/story-ad/views/sceneCardInteractions.js');
  const sceneCard = read('public/story-ad/views/scenePromptPreview.js');
  const person = read('public/story-ad/views/assetCenterPlanningDetails.js');
  const personForm = read('public/story-ad/views/assetCenterPersonForm.js');
  const navigation = read('public/story-ad/app.js');
  const bundleStore = read('public/story-ad/store/projectBundleStore.js');
  const route = read('src/routes/newStoryAd.js');
  const sceneAssetService = read('src/services/newStoryAd/sceneAssetService.js');
  assert.doesNotMatch(`${scene}\n${sceneCard}\n${sceneInteractions}`, /data-confirm-scene-prompt|confirmScenePrompt/u);
  assert.doesNotMatch(`${scene}\n${sceneCard}\n${sceneInteractions}`, /prompt_confirmation|confirmation_id|base_confirmation_id/u,
    '旧提示词确认字段不得继续参与当前页面、保存或生成链路');
  assert.match(sceneInteractions, /await .*\.flush\(\)/u, '场景生成前必须等待自动保存完成');
  assert.match(sceneInteractions, /prompt_version_id/u, '场景生成必须携带最新提示词版本');
  assert.match(sceneInteractions, /data-run-scene-actions/u, '场景页必须用一个入口处理全部场景待办');
  assert.match(sceneInteractions, /Promise\.allSettled\(plan\.ready\.map/u, '统一场景处理必须提交独立场景任务，单场景失败不得阻止其他场景');
  assert.match(scene, /data-run-scene-actions/u, '场景页顶部必须只展示统一场景入口');
  assert.match(scene, /persistedScenePlanReady = scenes\.length > 0/u, '已持久化场景不得因 release eligibility 漂移从页面消失');
  assert.match(scene, /scenePlanReady \|\| persistedScenePlanReady \? '' : scenePlanBlockedView/u,
    '存在持久化场景时不得用重新生成提示词面板覆盖场景卡');
  assert.match(scene, /generationActive: sceneIsActive/u, '运行状态必须按场景隔离，不能锁住全部卡片');
  assert.match(route, /scopeId: sceneId/u, '场景生成队列必须以场景 ID 作为独立锁目标');
  assert.match(sceneAssetService, /mergeSceneAssets\(storage\.getOutput\(taskId, 'scene_assets'\) \|\| \[\], baseAsset\)/u,
    '并发发布基础场景时必须基于最新持久化资产合并');
  assert.match(sceneAssetService, /mergeSceneAssets\(storage\.getOutput\(taskId, 'scene_assets'\) \|\| \[\], asset\)/u,
    '并发发布最终场景时必须基于最新持久化资产合并');
  assert.match(sceneCard, /generationStarted \? 'images' : 'prompt'/u);
  assert.match(person, /hasPersonMedia \|\| generationActive/u);
  assert.match(person, /personAutosave\?\.flush/u, '人物切页和关闭前必须刷新保存');
  assert.doesNotMatch(personForm, /type="submit"|保存提示词/u);
  assert.match(navigation, /VIEW_ORDER\.filter\(view => view !== 'edit'/u, '成片剪辑必须在初版成片存在后才显示');
  assert.match(navigation, /counts\.final_videos/u, '剪辑入口显隐必须来自持久化成片计数');
  assert.match(bundleStore, /requestSeq !== state\.bundleRequestSeq/u, '过期 bundle 响应必须丢弃');
  assert.match(bundleStore, /incomingRevision !== currentRevision \? \[\]/u, '内容版本变化必须重置分区缓存');
}

testAutosaveRuntime().then(() => {
  testCurrentUiContract();
  console.log(JSON.stringify({ passed: true, autosave: true, ime_safe: true, navigation_race_guard: true }));
}).catch(error => { console.error(error); process.exitCode = 1; });
