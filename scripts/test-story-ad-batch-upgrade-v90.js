const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const looks = require('../src/services/newStoryAd/personLookProfileService');
const subjects = require('../src/services/newStoryAd/subjectAssetBundleService');
const orchestration = require('../src/services/newStoryAd/visualAssetOrchestrationService');

const profile = looks.normalizeProfileLooks({
  id: 'heroine',
  displayName: '苏月见',
  roleName: '二十岁古代未婚女子',
  appearanceText: '年轻、自然真实',
  look_profiles: [{
    id: 'ancient',
    name: '古代华服',
    story_state: '古代',
    wardrobeText: '分层襦裙、真丝披帛、绣花鞋、玉簪和耳坠',
    hairMakeupText: '长发披散，半挽发髻',
    style_richness: 'ornate_luxurious',
  }],
}, { ensure: true });

assert.equal(profile.look_profiles[0].style_richness, 'ornate_luxurious');
const member = subjects.humanMemberSpecs({}, { cast_profiles: [profile] }, 1)[0];
assert.equal(member.style_richness, 'ornate_luxurious');
assert.match(subjects.humanPrompt(member, 1), /Styling richness lock: ornate and luxurious/);
assert.match(subjects.humanPrompt(member, 1), /never like random costume piling/);
assert.equal(subjects.PERSON_VISUAL_ASSET_CONTRACT_VERSION, 2);

const targets = orchestration.normalizedSceneTargets({ scene_targets: [
  { scene_id: 'gate', name: '黄昏城楼', repair_existing: true },
  { scene_id: 'bridge', name: '月下石桥' },
] });
assert.equal(targets.length, 2);
assert.equal(targets[0].repair_existing, true);
assert.equal(targets[1].repair_existing, false);

const assetPersonState = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPersonState.js'), 'utf8');
const assetView = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
assert.match(assetPersonState, /visual_asset_contract_version \|\| 0\) >= 2/);
assert.match(assetView, /旧版档案 · 待升级/);
assert.match(assetView, /生成缺失人物 \/ 动物资产/, 'batch upgrade action must describe the current unified missing-subject flow');
assert.match(assetView, /repair_existing: repairing/);
assert.match(assetView, /subject_targets = pending\.map/, 'one user action must submit every missing person target');

const subjectBundleSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/subjectAssetBundleService.js'), 'utf8');
assert.match(subjectBundleSource, /generationConcurrency\.map\([\s\S]*?humans\.map\(\(member, index\) => \(\{ member, index \}\)\)[\s\S]*?Math\.min\(2, Math\.max\(1, humans\.length\)\)/, 'the service must process people as isolated units with bounded concurrency');
assert.match(subjectBundleSource, /subjectFailures\.push\(\{ kind: 'human'/, 'one failed person must be recorded independently');
assert.match(subjectBundleSource, /人物 \$\{index \+ 1\} 生成中断，继续处理其它独立主体/, 'one failed person must not stop the remaining people');
assert.match(subjectBundleSource, /checkpoint\.humans\[index\] = asset;[\s\S]*?checkpoint\.generated_counts\.people \+= 1;[\s\S]*?save\(\);/, 'each successful person must be atomically checkpointed before its worker completes');

const personEditor = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPersonLooks.js'), 'utf8');
assert.match(personEditor, /look_\$\{index\}_style_richness/);
const personForm = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPersonForm.js'), 'utf8');
assert.match(personForm, /name="generation_prompt"/, '当前人物编辑入口必须由完整提示词承载造型语义');
assert.doesNotMatch(personForm, /renderPersonLookEditors/, '旧造型分段编辑器不得阻塞统一提示词合同');

const assist = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterAssist.js'), 'utf8');
assert.match(assist, /用户选择的造型华丽程度/);
assert.match(assist, /不得无依据堆砌/);

const contextSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/contextBuilder.js'), 'utf8');
assert.match(contextSource, /visual_asset_contract_version/);
assert.match(contextSource, /isolated_accessory_count/);

const routeSource = fs.readFileSync(path.join(root, 'src/routes/newStoryAd.js'), 'utf8');
const productionAssetOrchestratorSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/productionAssetOrchestratorService.js'), 'utf8');
assert.match(routeSource, /productionAssetOrchestratorFactory\.create/, 'the route must delegate to the unified production asset orchestrator');
assert.match(productionAssetOrchestratorSource, /target\.repair_existing/);
assert.match(productionAssetOrchestratorSource, /sceneAssetService\.repairSceneAsset/);

const sceneWorld = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneWorldView.js'), 'utf8');
assert.match(sceneWorld, /选择360 \/ 3D模式/);
assert.match(sceneWorld, /打开3D导演预演（免供应商）/);
assert.match(sceneWorld, /当前选择：\$\{escapeHtml\(selectedExperience\)\}/);

console.log(JSON.stringify({
  passed: true,
  person_contract_version: subjects.PERSON_VISUAL_ASSET_CONTRACT_VERSION,
  ornate_style_propagated: true,
  batch_scene_repair_targets: targets.length,
  paid_model_calls: 0,
}, null, 2));
