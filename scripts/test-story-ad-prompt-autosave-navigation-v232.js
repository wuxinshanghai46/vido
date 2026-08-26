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
  assert.doesNotMatch(`${scene}\n${sceneCard}\n${sceneInteractions}`, /data-confirm-scene-prompt|confirmScenePrompt/u);
  assert.match(sceneInteractions, /await .*\.flush\(\)/u, '场景生成前必须等待自动保存完成');
  assert.match(sceneInteractions, /prompt_version_id/u, '场景生成必须携带最新提示词版本');
  assert.match(sceneCard, /generationStarted \? 'images' : 'prompt'/u);
  assert.match(person, /hasPersonMedia \|\| generationActive/u);
  assert.match(person, /personAutosave\?\.flush/u, '人物切页和关闭前必须刷新保存');
  assert.doesNotMatch(personForm, /type="submit"|保存提示词/u);
  assert.match(navigation, /return VIEW_ORDER\.map/u, '六个流程阶段必须始终显示');
  assert.doesNotMatch(navigation, /VIEW_ORDER\.filter/u, '导航不得按锁定状态删除阶段');
  assert.match(bundleStore, /requestSeq !== state\.bundleRequestSeq/u, '过期 bundle 响应必须丢弃');
  assert.match(bundleStore, /incomingRevision !== currentRevision \? \[\]/u, '内容版本变化必须重置分区缓存');
}

testAutosaveRuntime().then(() => {
  testCurrentUiContract();
  console.log(JSON.stringify({ passed: true, autosave: true, ime_safe: true, navigation_race_guard: true }));
}).catch(error => { console.error(error); process.exitCode = 1; });
