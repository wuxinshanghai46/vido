const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const tempDir = path.join(root, '.tmp', 'visual-asset-root-causes-v88');
fs.rmSync(tempDir, { recursive: true, force: true });
fs.mkdirSync(tempDir, { recursive: true });
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const sceneStructured = require('../src/services/newStoryAd/sceneStructuredContractService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const sceneStrategy = require('../src/services/newStoryAd/sceneViewStrategyService');
const sceneAtlas = require('../src/services/newStoryAd/sceneAtlasService');
const completion = require('../src/services/newStoryAd/generationSpecCompletionService');
const people = require('../src/services/newStoryAd/subjectAssetBundleService');
const personIdentity = require('../src/services/newStoryAd/personIdentityContractService');

async function main() {
  const storyScene = {
    narrativeDescription: '桃林落英缤纷，花瓣随风飘落，命运初见氛围。',
    layoutText: '古城门位于画面中央，石墙、城门洞、道路、入口和完整边界清晰。',
    materialLightText: '青灰砖石、深色木门、黄土路面与夕阳侧逆光，纹理、磨损和阴影真实。',
    interactionText: '沈星回与苏月见在城门右侧交换玉佩，背景有迎亲队伍与往来行人，镜头跟随二人。',
    negativeText: '禁止无关人物、文字、水印、现代车辆和结构变形。',
    storyStates: [{ id: 'state_meet', visible_change: ['沈星回向苏月见递出玉佩'] }],
    interactionAnchors: [{ id: 'anchor_gate', label: '城门右侧互动区', purpose: '沈星回与苏月见交换玉佩', normalized_position: [0.72, 0.66] }],
    routes: [{ id: 'route_gate', from: '城门入口', to: '互动区', actor: '沈星回', continuity: '苏月见沿道路迎面走来' }],
  };
  const spatial = sceneStructured.compileSpatialAsset(storyScene, {}, { scene_id: 'gate' });
  const spatialText = JSON.stringify(spatial);
  assert.doesNotMatch(spatialText, /沈星回|苏月见|迎亲队伍|往来行人|交换玉佩/);
  assert.deepEqual(spatial.interaction_zones[0].position, [0.72, 0.66]);

  const prompt = sceneAssets.buildSceneSheetPrompt({
    ctx: { video_quality: 'final' },
    body: { description: '古城门环境资产', scene_spec: storyScene },
    outputRole: 'contract',
  });
  assert.doesNotMatch(prompt, /沈星回|苏月见|迎亲队伍|往来行人|交换玉佩/);
  assert.match(prompt, /Empty spatial-use contract/);
  const auditPrompt = sceneAssets.buildSceneAuditSafePrompt({ body: { scene_spec: storyScene }, viewKey: 'master' });
  assert.doesNotMatch(auditPrompt, /沈星回|苏月见|迎亲队伍|往来行人|交换玉佩/);

  const description = sceneAssets.sceneDescriptionForSpec(storyScene, '旧场景描述不得覆盖当前合同');
  assert.match(description, /落英缤纷/);
  assert.match(description, /古城门位于画面中央/);

  assert.equal(sceneStrategy.resolveSceneViewStrategy({ requested: 'auto', qualityTier: 'final' }).selected, 'image_derived');
  assert.equal(sceneStrategy.resolveSceneViewStrategy({ requested: 'auto', qualityTier: 'draft' }).selected, 'atlas_2x2');
  assert.equal(sceneStrategy.resolveSceneViewStrategy({ requested: 'auto', resolution: '4K' }).selected, 'image_derived');

  const atlasPath = path.join(tempDir, 'atlas-1536x1024.png');
  await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#777777' } }).png().toFile(atlasPath);
  const split = await sceneAtlas.splitSceneAtlas({ source: { filePath: atlasPath }, taskId: 'v88', sceneId: 'scene', revision: 1 });
  const splitMeta = await sharp(split.views[0].filePath).metadata();
  assert.equal(splitMeta.width, 768);
  assert.equal(splitMeta.height, 432);

  const age = people.inferMemberAge({ roleName: '古代闺秀女主', appearanceText: '二十岁左右的年轻女子' });
  assert.deepEqual(age, { age: 'young_adult_17_25', inferred: true });
  const member = people.humanMemberSpecs({}, { cast_profiles: [{
    id: 'heroine', roleName: '古代闺秀女主', appearanceText: '二十岁左右的年轻女子',
    wardrobeText: '宋制汉服襦裙，真丝与刺绣，绣鞋和发饰齐全', hairMakeupText: '长发挽成温婉古代发髻',
  }] }, 1)[0];
  const personPrompt = people.humanPrompt(member, 1);
  assert.equal(member.age, 'young_adult_17_25');
  assert.match(personPrompt, /unmarried romantic heroine/);
  assert.match(personPrompt, /long hair below the shoulders/);
  assert.match(personPrompt, /layered construction/);

  const lowRealism = personIdentity.normalizeQa({ pass: true, identity_score: 0.95, age_score: 0.95, wardrobe_score: 0.95, body_score: 0.95, photographic_realism_score: 0.5 });
  assert.equal(lowRealism.pass, false);
  const legacyQa = personIdentity.normalizeQa({ pass: true, identity_score: 0.95, age_score: 0.95, wardrobe_score: 0.95, body_score: 0.95 });
  assert.equal(legacyQa.pass, true);

  const closed = await completion.completeSceneSpec({
    taskId: '', sceneId: 'gate', sceneName: '古城门', sceneSpec: {},
  }, { deterministic: true, storage: { getOutput() { return null; }, saveOutput() {} } });
  assert.equal(closed.scene_spec.cameraPlan.length, 4);
  assert.ok(closed.scene_spec.cameraPlan.every(camera => camera.normalized_position.length === 2 && camera.look_at.length === 2));

  const uiSource = fs.readFileSync(path.join(root, 'public/story-ad/views/mediaLightbox.js'), 'utf8');
  assert.match(uiSource, /export function lightboxPanDelta/);
  assert.match(uiSource, /lightboxPanDelta\(event\.clientX - drag\.x, scale\)/);
  const billingSource = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterBillingRetry.js'), 'utf8');
  assert.match(billingSource, /每个场景分别生成主视、反向、互动、细节和布局 5 张原生图/);
  assert.match(billingSource, /当前缺失场景最多 \$\{missingSceneCount \* 5\} 次调用/);
  assert.match(billingSource, /草稿质量每个场景使用 1 张 2×2 视角图集和 1 张布局图/);

  const projectionSource = fs.readFileSync(path.join(root, 'src/services/storyAdWorkspace/sceneSpatialProjectionService.js'), 'utf8');
  assert.match(projectionSource, /camera\.normalized_position \|\| camera\.position/);
  assert.match(projectionSource, /camera\.look_at \|\| camera\.lookAt/);

  console.log(JSON.stringify({
    passed: true,
    cast_leak_removed: true,
    final_quality_strategy: 'image_derived',
    atlas_split_size: `${splitMeta.width}x${splitMeta.height}`,
    inferred_age: member.age,
    camera_points: closed.scene_spec.cameraPlan.length,
    paid_model_calls: 0,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
