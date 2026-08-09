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

const assetView = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
assert.match(assetView, /visual_asset_contract_version \|\| 0\) >= 2/);
assert.match(assetView, /旧版档案 · 待升级/);
assert.match(assetView, /升级独立穿搭 \/ 配饰档案/);
assert.match(assetView, /repair_existing: repairing/);
assert.match(assetView, /subject_targets = pending\.map/);

const personEditor = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPersonLooks.js'), 'utf8');
assert.match(personEditor, /华丽程度（AI 帮写和图片生成都会遵守）/);
assert.match(personEditor, /华丽华贵/);
assert.match(personEditor, /look_\$\{index\}_style_richness/);

const assist = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterAssist.js'), 'utf8');
assert.match(assist, /用户选择的造型华丽程度/);
assert.match(assist, /不得无依据堆砌/);

const contextSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/contextBuilder.js'), 'utf8');
assert.match(contextSource, /visual_asset_contract_version/);
assert.match(contextSource, /isolated_accessory_count/);

const routeSource = fs.readFileSync(path.join(root, 'src/routes/newStoryAd.js'), 'utf8');
assert.match(routeSource, /target\.repair_existing/);
assert.match(routeSource, /sceneAssetService\.repairSceneAsset/);

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
