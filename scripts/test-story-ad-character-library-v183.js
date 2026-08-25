'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const assetsRoute = require('../src/routes/assets');
const personPlanRoute = require('../src/routes/newStoryAd/personPlanGenerationRoute');

const root = path.resolve(__dirname, '..');
const image = key => ({ key, image_url: `/api/new-story-ad/assets/${key}.png` });

const invalidLegacy = assetsRoute.serializeAsset({
  id: 'legacy-background', type: 'character', image_url: '/empty-studio.png',
  source: 'local_actor_library_generated', production_usable_actor: true,
  metadata: { view_images: [image('front'), image('side'), image('back'), image('action')] },
});
assert.strictEqual(invalidLegacy.library_ready, false, '没有 verified 人物合同的历史测试图不得进入正式角色库');

const verified = assetsRoute.serializeAsset({
  id: 'actor-suwan', type: 'character', name: '苏晚', image_url: '/body-front.png', production_usable_actor: true,
  metadata: {
    subject_profile: { id: 'su-wan', displayName: '苏晚', roleName: '美学策展人', age: '28岁', gender: 'female', appearanceText: '现代女性' },
    person_contract: {
      status: 'verified',
      verification: { state: 'verified', used_model: 'vision/strict-person-qa' },
      cross_view_qa: { pass: true, used_model: 'vision/strict-person-qa', identity_score: 0.94, age_score: 0.9, wardrobe_score: 0.91, body_score: 0.88, photographic_realism_score: 0.9 },
      identity: { gender: 'female' },
    },
    body_views: [image('front'), image('side'), image('back'), image('action')],
    identity_views: [image('face_front')], expressions: ['neutral', 'smile', 'concern', 'surprise', 'focus', 'relief'].map(image),
    dossier_sheet: { image_url: '/dossier.png' },
  },
});
assert.strictEqual(verified.library_ready, true, '通过身份与跨视角验证的四视图人物必须进入角色库');
assert.strictEqual(verified.cover_image_url, '/api/new-story-ad/assets/face_front.png', '角色卡必须优先使用面部身份图而不是空背景或全身远景');
assert.strictEqual(verified.character_library.full_body_image_url, '/api/new-story-ad/assets/front.png');
assert.strictEqual(verified.character_library.dossier_image_url, '/dossier.png');
assert.strictEqual(verified.character_library.filters.age_band, '青年');
const summary = assetsRoute.serializeAsset({
  ...verified,
  metadata: {
    ...verified.metadata,
    person_contract: verified.person_contract,
    body_views: verified.body_views,
    identity_views: verified.identity_views,
  },
}, { summary: true });
assert.strictEqual(summary.character_library.summary_only, true, '角色库列表必须只返回轻量摘要');
assert.strictEqual(summary.body_views, undefined, '轻量摘要不得携带完整四视图和表情大图');

const weakQa = assetsRoute.serializeAsset({
  ...verified,
  id: 'weak-qa-actor',
  person_contract: { status: 'verified', verification: { state: 'verified' }, cross_view_qa: { pass: true } },
  metadata: {
    ...verified.metadata,
    person_contract: { status: 'verified', verification: { state: 'verified' }, cross_view_qa: { pass: true } },
  },
});
assert.strictEqual(weakQa.library_ready, false, '只有 verified 标记、没有视觉模型分数的历史空图不得进入正式角色库');

const legacyFourViews = assetsRoute.serializeAsset({
  ...verified,
  id: 'legacy-four-view-only',
  identity_views: [], expressions: [], dossier_sheet: null,
  metadata: { ...verified.metadata, identity_views: [], expressions: [], dossier_sheet: null },
});
assert.strictEqual(legacyFourViews.library_ready, false, '只有旧四视图、没有身份图表情图和档案大版的演员不得冒充完整角色库');

const context = {
  brief: '双人广告', cast_profiles: [
    { id: 'character_1', displayName: '林岚' },
    { id: 'character_2', displayName: '陈先生' },
  ], pet_profiles: [],
};
const subjectBody = personPlanRoute.currentPersonGenerationBody({
  taskId: 'task-two-people', storage: {
    getTask: () => ({ id: 'task-two-people', request: context }),
    getOutput: (_id, kind) => kind === 'context' ? context : null,
  },
  projectBundleService: { buildProjectBundle: () => ({ assets: { people: [
    { id: 'asset-1', profile: context.cast_profiles[0] },
    { id: 'asset-2', profile: context.cast_profiles[1] },
  ], animals: [] } }) },
});
assert.deepStrictEqual(subjectBody.subject_targets.map(row => row.id), ['character_1', 'character_2'], '缺图目标必须继续绑定原人物稳定 ID，不能按相同人物或索引合并');

const sources = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPersonSources.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public/story-ad/index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public/story-ad/character-library.css'), 'utf8');
assert.match(sources, /character_library=1&view=summary&fast=1/, '选择已有素材必须先读取免目录扫描的轻量角色摘要');
assert.match(sources, /\/api\/assets\/\$\{encodeURIComponent\(id\)\}/, '完整人物档案必须按选中人物再读取');
assert.match(sources, /actor-library-featured/, '角色库必须有顶部选中人物制作档案');
assert.match(sources, /actor-library-carousel/, '角色库必须有底部头像横向列表');
assert.match(sources, /角色筛选/, '角色库必须提供人物筛选入口');
assert.match(page, /character-library\.css/, '角色库独立样式必须由剧情广告页面加载');
assert.match(styles, /\.actor-library-featured-grid/, '角色库独立样式必须包含顶部人物档案布局');

const assetView = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
assert.match(assetView, /asset-card-person-entry/, '人物头像必须成为打开完整档案的主入口');
const statusView = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPlanReleaseStatus.js'), 'utf8');
assert.match(statusView, /personPlanTechnicalDetails/, '人物方案失败必须继续进入当前超管技术诊断投影');
assert.doesNotMatch(statusView, /文字方案确认后，再单独生成图片/, '退役的两步式人物生成说明不得恢复');

console.log('story-ad character library v183 tests passed');
