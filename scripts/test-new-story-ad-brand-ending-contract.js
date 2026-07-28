const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { buildContext, contextPrompt } = require('../src/services/newStoryAd/contextBuilder');
const brandEnding = require('../src/services/newStoryAd/brandEndingService');
const temporalEvidence = require('../src/services/newStoryAd/temporalEvidenceLifecycleService');
const revision = require('../src/services/newStoryAd/revisionService');
const { buildKeyframeContracts } = require('../src/services/newStoryAd/keyframeContractService');

const noLogo = buildContext({
  brief: '一家人与宠物分享狗粮，最后在客厅自然收束',
  output_ratio: '16:9',
  brand_overlay: { enabled: false },
});
assert.strictEqual(brandEnding.enabled(noLogo), false);
assert.match(contextPrompt(noLogo), /未上传.*普通剧情自然结尾/);

const uploadedNotAuthorized = buildContext({
  brief: '一家人与宠物分享狗粮',
  brand_overlay: {
    enabled: true,
    authorization_confirmed: false,
    asset: { id: 'logo-1', url: '/api/new-story-ad/assets/logo.png' },
  },
});
assert.strictEqual(brandEnding.enabled(uploadedNotAuthorized), false);
assert.match(contextPrompt(uploadedNotAuthorized), /尚未确认授权.*不得启用品牌结尾/);
assert.throws(
  () => brandEnding.assertReady(uploadedNotAuthorized),
  error => error.code === 'BRAND_ASSET_AUTHORIZATION_REQUIRED' && error.status === 422,
);

const activeLogo = buildContext({
  brief: '一家人与宠物分享狗粮，最后在客厅自然收束',
  output_ratio: '16:9',
  brand_overlay: {
    enabled: true,
    authorization_confirmed: true,
    asset: { id: 'logo-1', url: '/api/new-story-ad/assets/logo.png' },
    position: 'bottom_right',
    width_percent: 24,
    end_duration_sec: 3,
  },
});
assert.strictEqual(brandEnding.enabled(activeLogo), true);
assert.strictEqual(brandEnding.assertReady(activeLogo), true);
assert.match(contextPrompt(activeLogo), /最后一个剧情镜头.*当前已确认场景/);
assert.match(contextPrompt(activeLogo), /冻结该镜头最后一帧 3 秒/);

const legacyBlueprint = {
  beats: [
    { beat_index: 1, plot: '雪球跑向食盆', visual_layers: [{ type: 'story', content: '雪球进入客厅' }] },
    { beat_index: 2, plot: '屏幕浮现品牌Logo', visual: '品牌标识在画面中央浮现', action: 'Logo逐渐形成' },
  ],
};
const ordinaryBlueprint = brandEnding.applyToBlueprint(legacyBlueprint, noLogo);
assert.strictEqual(ordinaryBlueprint.brand_ending.enabled, false);
assert.strictEqual(ordinaryBlueprint.beats.some(beat => beat.brand_ending?.enabled), false);
assert.doesNotMatch(JSON.stringify(ordinaryBlueprint.beats), /浮现品牌Logo|Logo逐渐形成/);

const brandedBlueprint = brandEnding.applyToBlueprint(legacyBlueprint, activeLogo);
assert.strictEqual(brandedBlueprint.beats[1].brand_ending.enabled, true);
assert.strictEqual(brandedBlueprint.beats[1].brand_ending.mode, 'last_scene_hold');
assert.strictEqual(brandedBlueprint.beats[1].brand_ending.position, 'bottom_right');
assert.match(JSON.stringify(brandedBlueprint.beats[1]), /当前故事场景|品牌安全区/);

const rawShots = [
  {
    index: 1,
    visual: '狗粮颗粒落入食盆',
    action: '狗粮状态发生变化',
    temporal_state: {
      entity_refs: ['狗粮', '食盆'],
      evidence_requirements: ['狗粮已经落入食盆'],
    },
  },
  {
    index: 2,
    visual: '雪球在客厅自然停下，屏幕浮现品牌Logo',
    action: '品牌标识出现',
    temporal_state: {
      entity_refs: ['雪球', '品牌标识'],
      evidence_requirements: ['雪球停在客厅'],
    },
  },
];
const ordinaryShots = brandEnding.applyToShots(rawShots, noLogo);
assert.deepStrictEqual(ordinaryShots[1].temporal_state.entity_refs, ['雪球']);
assert.strictEqual(ordinaryShots[1].brand_ending, undefined);
const compiled = temporalEvidence.compile({
  ctx: noLogo,
  blueprint: { characters: [{ name: '雪球', role: '宠物' }] },
  shots: ordinaryShots,
});
assert.strictEqual(compiled.graph.entities.some(entity => entity.name === '狗粮'), true);
assert.strictEqual(compiled.graph.entities.some(entity => entity.name === '食盆'), true);
assert.strictEqual(compiled.graph.shot_states.length, 2);

const brandedShots = brandEnding.applyToShots(rawShots, activeLogo);
assert.strictEqual(brandedShots[1].brand_ending.enabled, true);
assert.match(brandedShots[1].composition, /右下角保留品牌安全区/);
assert.match(brandedShots[1].exit_frame_state, /当前场景中稳定停留/);
assert.deepStrictEqual(brandedShots[1].temporal_state.entity_refs, ['雪球']);
const contracts = buildKeyframeContracts(activeLogo, brandedShots);
assert.strictEqual(contracts[0].brand_ending_lock, null);
assert.strictEqual(contracts[1].brand_ending_lock.mode, 'last_scene_hold');
assert.match(contracts[1].visual_contract.text_rule, /(?:never|do not) render any logo/);

const changedDomains = revision.changeDomains(noLogo, activeLogo);
assert(changedDomains.includes('creative'));
assert.strictEqual(revision.changeScope(noLogo, activeLogo), 'creative');

const composeSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/composeService.js'), 'utf8');
assert.match(composeSource, /tpad=stop_mode=clone:stop_duration=/);
assert.match(composeSource, /enable='gte\(t,\$\{duration\.toFixed\(3\)\}\)'/);
assert.match(composeSource, /normalizedBrandOverlay\.end_duration_sec/);

const storySetupSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/story-setup.js'), 'utf8');
assert.match(storySetupSource, /state\.brandLogoAsset && state\.brandLogoAuthorized !== true/);
assert.match(storySetupSource, /请确认授权或删除 Logo 后再生成剧本/);

console.log('new story ad scene-integrated brand ending contract: ok');
