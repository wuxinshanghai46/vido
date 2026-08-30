#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-spatial-storyboard-v302-'));
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const personIdentity = require('../src/services/newStoryAd/personIdentityContractService');
const scenePlanning = require('../src/services/newStoryAd/scenePlanningAuthorityService');
const scenePerformance = require('../src/services/newStoryAd/scenePerformanceCoverageContractService');
const lineage = require('../src/services/newStoryAd/storyboardImageLineageService');
const { bindShotsToScenes } = require('../src/services/newStoryAd/sceneBindingService');
const imageGate = require('../src/services/storyAdWorkspace/storyboardImageConfirmationGateService');

const cameraPlan = id => [
  { id: `camera_${id}_master`, view_id: 'master', label: '主建立机位', normalized_position: [0.1, 0.8], look_at: [0.5, 0.5] },
  { id: `camera_${id}_interaction`, view_id: 'interaction', label: '人物互动机位', normalized_position: [0.3, 0.7], look_at: [0.62, 0.45] },
  { id: `camera_${id}_detail`, view_id: 'detail', label: '细节机位', normalized_position: [0.58, 0.55], look_at: [0.6, 0.5] },
];

function scene(id, name) {
  return {
    id, scene_id: id, name, scene_revision: 1,
    image_url: `/${id}/master.png`,
    view_images: [
      { key: 'master', image_url: `/${id}/master.png` },
      { key: 'interaction', image_url: `/${id}/interaction.png` },
      { key: 'detail', image_url: `/${id}/detail.png` },
    ],
    scene_contract: { schema_version: 6, cameras: [] },
  };
}

function planned(id, name, actorBlocking = false) {
  return {
    id, name,
    scene_spec: {
      layoutText: `${name}入口在左，整面主展示墙贯穿背景，人物路线和家具位置固定`,
      materialLightText: '金属、石材与侧窗自然光保持方向、尺度和反射一致',
      interactionText: actorBlocking ? '人物从入口进入，沿中轴路线走到整面主展示墙前，在固定互动点触摸材料后离开' : '商品展示路线和镜头焦点保持连续',
      negativeText: '禁止结构漂移、文字、水印和无关物件',
      interactionAnchors: [{ id: `anchor_${id}_wall`, label: '整面主展示墙互动点', normalized_position: [0.62, 0.45] }],
      routes: [{ id: `route_${id}`, label: '入口到主展示墙', actor: actorBlocking ? '陈默' : '商品', from_position: [0.1, 0.82], to_position: [0.62, 0.45], path_points: [[0.1, 0.82], [0.35, 0.65], [0.62, 0.45]] }],
      cameraPlan: cameraPlan(id),
      sceneExperienceContract: { actor_blocking_required: actorBlocking },
      storyStates: [{ id: `state_${id}`, label: '互动前后状态' }],
    },
  };
}

const ctx = { cast_mode: 'single', expected_people: 1, characters: [{ id: 'person_1', name: '陈默' }], content_mode: 'commercial_subject' };
const plan = { spaces: [planned('exhibition', '高端商业展台', true), planned('home', '现代高端家居展示厅', true)] };
const rawAssets = [scene('exhibition', '高端商业展台'), scene('home', '现代高端家居展示厅')];
const assets = scenePlanning.enrichSceneAssets(rawAssets, plan, ctx, {});

assert.equal(personIdentity.shotPersonPresence({ subject_type: 'product_only', expected_people: 0, characters: [], keyframe_notes: '禁止出现人物和手部' }).required, false,
  '负向人物约束不得反向触发人物参考');
assert.equal(personIdentity.shotPersonPresence({
  subject_type: 'product_only', expected_people: 0, characters: [],
  action: '摄影机沿展示墙横移，不出现人物',
  keyframe_notes: '禁止出现：人物、Logo 和其他空间元素',
  material_usage: '展示墙采用用户确认的不锈钢材料表面成果',
}).required, false, '“用户确认的材料”描述内容来源，不得被识别成画面人物');
assert.equal(personIdentity.shotForbidsPerson(ctx, { subject_type: 'product_only', expected_people: 0, characters: [], keyframe_notes: '禁止出现人物' }), true);
assert.equal(assets[1].scene_contract.anchors[0].id, 'anchor_home_wall', '场景规划锚点必须进入逐镜可绑定合同');
assert.equal(assets[1].scene_contract.cameras[1].normalized_position[0], 0.3, '规划机位坐标必须进入场景权威');

const sourceShots = [
  { index: 1, shot_id: 's1', scene_id: 'exhibition', scene_view: 'master', subject_type: 'human_scene', expected_people: 1, characters: [{ name: '陈默' }], visual: '人物进入展台', action: '人物观察材料', shot_size: 'wide' },
  { index: 2, shot_id: 's2', scene_id: 'exhibition', scene_view: 'detail', subject_type: 'product_only', expected_people: 0, characters: [], visual: '展台材质特写', action: '无人物', shot_size: 'close_up' },
  { index: 3, shot_id: 's3', scene_id: 'home', scene_view: 'detail', subject_type: 'product_only', expected_people: 0, characters: [], title: '金属拉丝极致特写', purpose: '拉丝纹理材质证明', visual: '纹理充满全画幅的金属拉丝微距', action: '禁止出现人物，镜头贴近板材', composition: '纹理充满全画幅', camera_movement: '极近横移', keyframe_notes: '只显示材料，禁止人物', shot_size: 'macro', lens_mm: 85, transition_reason: '进入家居应用场景' },
  { index: 4, shot_id: 's4', scene_id: 'home', scene_view: 'detail', subject_type: 'product_only', expected_people: 0, characters: [], title: '颜色搭配局部特写', purpose: '多颜色搭配证明', visual: '只显示一块颜色板的局部', action: '不出现人物，微距贴近色板', composition: '单块色板充满全画幅', camera_movement: 'macro_push', keyframe_notes: '禁止人物，只保留局部墙面', shot_size: 'close_up', lens_mm: 85 },
  { index: 5, shot_id: 's5', scene_id: 'exhibition', scene_view: 'master', subject_type: 'human_scene', expected_people: 1, characters: [{ name: '陈默' }], visual: '人物返回展台', action: '人物完成收束', shot_size: 'wide', transition_reason: '返回品牌展台收束' },
];
const bound = bindShotsToScenes(sourceShots, assets, { context: { ...ctx, scene_assets: assets } });
assert.equal(bound[2].scene_context_role, 'planned_actor_interaction');
assert.equal(bound[2].expected_people, 1);
assert.equal(bound[2].scene_view, 'interaction');
assert.match(bound[2].visual, /完整空间关系/);
assert.match(bound[2].title, /人物按规划路线体验/);
assert.match(bound[2].purpose, /人物.*规划动线/);
assert.doesNotMatch(bound[2].visual, /微距|纹理充满全画幅/);
assert.doesNotMatch(bound[2].composition, /纹理充满全画幅/);
assert.equal(bound[2].shot_size, 'medium_wide');
assert.doesNotMatch(bound[2].keyframe_notes, /禁止人物/);
assert.equal(bound[3].scene_context_role, 'planned_scene_establishing');
assert.match(bound[3].keyframe_notes, /不得裁成仅剩局部墙面/);
assert.match(bound[3].title, /完整空间与整面主要展示面/);
assert.equal(bound[3].subject_type, 'scene_only');
assert.equal(bound[3].no_person, true);
assert.equal(bound[3].expected_people, 0);
assert.equal(personIdentity.shotPersonPresence(bound[3], {}).required, false);
assert.equal(personIdentity.shotPersonRequired(ctx, bound[3], {}), false);
assert.doesNotMatch(bound[3].visual, /局部特写|只显示一块|微距/);
assert.doesNotMatch(bound[3].composition, /单块色板充满全画幅/);
assert.equal(bound[3].shot_size, 'wide');
assert.equal(bound[2].scene_performance_contract.version, 2);
assert.equal(bound[3].scene_performance_contract.version, 2);
assert.doesNotMatch(bound[2].action, /AI补齐|系统补齐|自动补齐/);
assert.equal(scenePerformance.inspect(bound, assets, ctx).ready, true);
assert.equal(bound[0].scene_performance_contract, undefined, '已有正确人物覆盖的相邻场景不得被重写');
const inferredCastCoverage = scenePerformance.ensureCoverage(sourceShots, assets, {});
assert.equal(inferredCastCoverage[2].expected_people, 1, '结构化场景明确要求人物时不得依赖顶层 context 才执行');
assert.equal(inferredCastCoverage[2].characters[0].name, '陈默', '顶层人物缺失时应从同一分镜表既有人物合同继承身份');

const legacyCovered = bound.map(shot => shot.scene_id === 'home' ? {
  ...shot,
  title: shot.scene_context_role === 'planned_actor_interaction' ? '旧极致特写' : '旧局部墙面',
  composition: shot.scene_context_role === 'planned_actor_interaction' ? '纹理充满全画幅' : '单块色板充满全画幅',
  scene_performance_contract: { ...shot.scene_performance_contract, version: 1 },
} : shot);
const upgradedCoverage = scenePerformance.ensureCoverage(legacyCovered, assets, ctx);
assert.equal(upgradedCoverage[2].scene_performance_contract.version, 2, '旧空间表演合同必须升级');
assert.equal(upgradedCoverage[3].scene_performance_contract.version, 2, '旧空间建立合同必须升级');
assert.doesNotMatch(upgradedCoverage[2].composition, /纹理充满全画幅/);
assert.doesNotMatch(upgradedCoverage[3].composition, /单块色板充满全画幅/);

const baseFingerprint = lineage.shotContractFingerprint(bound[2], 2);
for (const patch of [
  { camera_id: 'camera_changed' }, { scene_view: 'master' }, { zone_ids: ['zone_changed'] },
  { anchor_ids: ['anchor_changed'] }, { subject_position: '右侧' }, { scene_context_role: 'changed' },
]) {
  assert.notEqual(lineage.shotContractFingerprint({ ...bound[2], ...patch }, 2), baseFingerprint,
    `空间字段变化必须使图片失效：${Object.keys(patch)[0]}`);
}

const taskId = 'spatial-storyboard-v302-gate';
storage.createTask({ id: taskId, title: '空间血缘门禁', brief: '空间血缘门禁', content_revision: 1, request: ctx });
storage.saveOutput(taskId, 'context', ctx);
storage.saveOutput(taskId, 'scene_config', plan);
storage.saveOutput(taskId, 'scene_assets', rawAssets);
storage.saveOutput(taskId, 'storyboard_table', bound);
storage.saveOutput(taskId, 'shot_reference_packs', bound.map((_, index) => ({ fingerprint: `pack_${index + 1}` })));
storage.saveOutput(taskId, 'storyboard_images', bound.map((shot, index) => {
  const asset = assets.find(item => item.scene_id === shot.scene_id);
  const master = asset.view_images.find(view => view.key === 'master');
  const selected = asset.view_images.find(view => view.key === shot.scene_view) || master;
  return {
    shot_index: index + 1, image_url: `/image_${index + 1}.png`, lineage_schema_version: 2,
    scene_id: shot.scene_id, scene_revision: 1, scene_reference_url: master.image_url,
    scene_view_reference_url: selected.image_url === master.image_url ? '' : selected.image_url,
    reference_pack_fingerprint: `pack_${index + 1}`,
    scene_planning_fingerprint: asset.scene_planning_fingerprint,
    shot_contract_fingerprint: lineage.shotContractFingerprint(shot, index),
  };
}));
assert.equal(imageGate.inspect(taskId).ready, true, '空间和镜头血缘一致时允许继续');

const legacyTaskId = 'spatial-storyboard-v302-legacy-gate';
storage.createTask({ id: legacyTaskId, title: '旧图兼容门禁', brief: '旧图兼容门禁', content_revision: 1, request: ctx });
storage.saveOutput(legacyTaskId, 'context', ctx);
storage.saveOutput(legacyTaskId, 'scene_config', plan);
storage.saveOutput(legacyTaskId, 'scene_assets', rawAssets);
storage.saveOutput(legacyTaskId, 'storyboard_table', bound);
storage.saveOutput(legacyTaskId, 'shot_reference_packs', bound.map((_, index) => ({ fingerprint: `legacy_pack_${index + 1}` })));
storage.saveOutput(legacyTaskId, 'storyboard_images', bound.map((shot, index) => {
  const asset = assets.find(item => item.scene_id === shot.scene_id);
  const master = asset.view_images.find(view => view.key === 'master');
  const selected = asset.view_images.find(view => view.key === shot.scene_view) || master;
  return {
    shot_index: index + 1,
    image_url: `/legacy_${index + 1}.png`,
    lineage_schema_version: index === 3 ? 1 : 0,
    shot_contract_fingerprint: lineage.legacyShotContractFingerprint(shot, index),
    ...(index === 3 ? {
      scene_id: shot.scene_id,
      scene_revision: 1,
      scene_reference_url: master.image_url,
      scene_view_reference_url: selected.image_url === master.image_url ? '' : selected.image_url,
      reference_pack_fingerprint: `legacy_pack_${index + 1}`,
    } : {}),
  };
}));
assert.equal(imageGate.inspect(legacyTaskId).ready, true, 'V301 旧图应按生成时指纹口径兼容，不能升级后全量误伤');
storage.saveOutput(legacyTaskId, 'storyboard_table', bound.map((shot, index) => index === 2 ? { ...shot, action: `${shot.action}并停留确认` } : shot));
assert.deepEqual(imageGate.inspect(legacyTaskId).stale_indexes, [3], '旧图内容真正变化时仍必须精准失效');

storage.saveOutput(taskId, 'scene_world_overrides', {
  assignment_revision: 2,
  assignments: [{ character_id: 'person_1', world_id: 'home', presence: 'confirmed', blocking_position: [0.75, 0.35], route_points: [[0.1, 0.8], [0.75, 0.35]] }],
});
const changedGate = imageGate.inspect(taskId);
assert.deepEqual(changedGate.stale_indexes, [3, 4], '家居站位变化只应使家居两镜失效');
assert(changedGate.stale_reasons[3].includes('SCENE_PLANNING_CHANGED'));

const viewSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/storyboardView.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/storyboard-simple.css'), 'utf8');
const sketchSource = fs.readFileSync(path.join(__dirname, '../src/services/storyAdWorkspace/storyboardSketchService.js'), 'utf8');
assert.doesNotMatch(viewSource, /aspect-ratio:\$\{Number\(ratio\[1\]\)/, '缩略图不得继续写入输出比例内联高度');
assert.match(cssSource, /storyboard-simple-view \.sketch-tile-media \.media \{[^}]*object-fit:cover/s);
assert.match(cssSource, /storyboard-scene-sequence ol\{[^}]*flex:1 1 auto/s);
assert.match(viewSource, /<p>\$\{escapeHtml\(reason\)\}<\/p>/);
assert.match(sketchSource, /场景空间与导演规划（强制执行）/);

console.log(JSON.stringify({
  ok: true,
  contract: 'story_ad_spatial_storyboard_v302',
  provider_calls: 0,
  repaired_indexes: [3, 4],
  stale_after_assignment_change: changedGate.stale_indexes,
}, null, 2));
