'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const storySceneCoverage = require('../src/services/newStoryAd/storySceneCoverageService');
const personLookProjection = require('../src/services/storyAdWorkspace/personLookProjectionService');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const characters = [
  { character_id: 'person_presenter_a', role: '女性科技讲解者', evidence_refs: ['F001', 'F006'] },
  { character_id: 'person_presenter_duplicate', role: '同一位女性讲解者', evidence_refs: ['F006'] },
  { character_id: 'partial_hand', role: '只可见一只手部', evidence_refs: ['F009'] },
  { character_id: 'digital_agent', role: '半透明数字 AI 代理人形', evidence_refs: ['F012'] },
  { character_id: 'mall_crowd', role: '商场人流与背景顾客群', evidence_refs: ['F014'] },
  { character_id: 'grass_passers', role: '大草地其他的人与远景路人', evidence_refs: ['F018'] },
  { character_id: 'back_observer', role: '只可见后脑和部分肩部的观察者', evidence_refs: ['F021'] },
  { character_id: 'male_creator', role: '男性创作者', evidence_refs: ['F027', 'F028', 'F030'] },
];

const characterPrompts = characters.map((record, index) => ({
  id: record.character_id,
  role: record.role,
  narrative_function: record.role,
  appearance_direction: index === 0
    ? '一位女性，棕色头发盘起，身穿米色西装外套，负责持续讲解'
    : (record.character_id === 'male_creator' ? '一位男性创作者，深色头发，深色西装' : record.role),
}));

const scenePrompts = [
  { id: 'scene_lab', location_type: '科技体验空间', layout_prompt: '开放式展示区与交互台', material_light_prompt: '冷白环境光与蓝色屏幕光', interaction_prompt: '讲解者沿展示台移动' },
  { id: 'scene_lawn', location_type: '户外草地', layout_prompt: '开阔草地与步道', material_light_prompt: '自然日光', interaction_prompt: '创作者沿步道行走' },
];

const plotBeats = Array.from({ length: 6 }, (_, index) => ({
  id: `beat_${index + 1}`,
  range: [index * 4, (index + 1) * 4],
  purpose: ['建立科技体验', '讲解交互方式', '展示使用反馈', '切换户外空间', '创作者继续探索', '完成主题回收'][index],
}));
const shotBreakdown = plotBeats.map((beat, index) => ({
  id: `shot_${index + 1}`,
  range: beat.range,
  scene_id: index < 3 ? 'scene_lab' : 'scene_lawn',
  action: beat.purpose,
  subject_ids: index < 3
    ? ['person_presenter_a', 'person_presenter_duplicate', 'partial_hand', 'digital_agent']
    : ['male_creator', 'mall_crowd', 'grass_passers', 'back_observer'],
}));

const ctx = {
  content_mode: 'narrative_story',
  brief: '讲述人与科技在不同空间中的体验故事',
  target_duration: 24,
  shot_count: 6,
  expected_people: 9,
  planning_cast_count: 9,
  narrative_identity_count: 9,
  visual_asset_count: 9,
  cast_mode: 'multi',
  brief_source: 'reference_analysis',
  story_scene_contract_version: storySceneCoverage.CONTRACT_VERSION,
  world_setting: { country_region: '中国大陆' },
  reference_video_analysis: {
    analysis_id: 'reference-autofill-v41',
    status: 'completed',
    analysis_quality: { valid: true },
    source_facts: { environment: '当代科技体验空间与户外环境' },
    reference_understanding: {
      characters,
      scenes: [
        { scene_id: 'scene_lab', events: ['event_1', 'event_2', 'event_3'], narrative_function: '建立科技体验' },
        { scene_id: 'scene_lawn', events: ['event_4', 'event_5', 'event_6'], narrative_function: '完成户外探索' },
      ],
    },
    character_prompts: characterPrompts,
    scene_prompts: scenePrompts,
    plot_beats: plotBeats,
    shot_breakdown: shotBreakdown,
    camera_intents: [],
    animal_prompts: [],
  },
};

const projected = assetPlan.projectReferencePlan(ctx);
const normalized = assetPlan.normalizePlan(projected, ctx);
assert.equal(projected.cast_profiles.length, 2, '重复讲解者应合并，背景人流、局部肢体、背影和数字人形不得成为人物资产');
assert.deepStrictEqual(projected.cast_profiles.map(item => item.id), ['person_presenter_a', 'male_creator']);
projected.cast_profiles.forEach((profile) => {
  assert.ok(profile.displayName && !/^(?:出镜人物|人物|角色|主角)\s*\d*$/u.test(profile.displayName), '主要人物必须获得具体原创名称');
  assert.match(profile.age, /\d{1,3}\s*(?:岁|~|～|-|—|–|至|到)/u, '主要人物必须自动获得数字年龄或年龄区间');
  assert.equal(profile.ethnicity, '东亚外貌设计', '已确认中国地域时应自动补齐原创角色外貌设计');
  assert.equal(profile.asset_scope, 'primary');
});
assert.equal(projected.scene_plan.ambient_people.length, 5, '被排除的人物证据必须保留为场景氛围，而不是静默丢弃；同一人物重复证据应合并到主资产');
assert.ok(projected.scene_plan.ambient_people.every(item => item.requires_asset === false && item.asset_scope === 'scene_extra'));
assert.equal(projected.advertised_subject_contract, null, '纯剧情不得从参考内容误建广告主体');
assert.equal(projected.story_seed.advertised_subject, '');
assert.deepStrictEqual(storySceneCoverage.coverageIssues(projected, ctx), [], '参考投影必须一次形成完整剧情与场景覆盖合同');
assert.equal(assetPlan.complete(normalized, ctx), true, '参考投影过滤主要人物后必须替换旧识别总人数并一次通过资产方案完整性门禁');
assert.ok(projected.story_seed.shot_breakdown.every(shot => !shot.subject_ids.includes('partial_hand') && !shot.subject_ids.includes('digital_agent')));
assert.ok(projected.story_seed.shot_breakdown[0].subject_ids.includes('person_presenter_a'));
assert.equal(projected.story_seed.shot_breakdown[0].subject_ids.filter(id => id === 'person_presenter_a').length, 1, '重复人物证据必须映射到同一稳定人物 ID');

const unknownRegion = assetPlan.projectReferencePlan({
  ...ctx,
  world_setting: {},
  reference_video_analysis: { ...ctx.reference_video_analysis, analysis_id: 'reference-autofill-unknown-region' },
});
assert.ok(unknownRegion.cast_profiles.every(profile => profile.ethnicity === '未指定（原创角色，可修改）'), '地域未知时不得把参考真人族裔伪装成识别事实');
const projectedUiProfile = personLookProjection.personProfile(unknownRegion.cast_profiles[0], 0);
assert.equal(projectedUiProfile.ethnicity, '未指定（原创角色，可修改）', '资产工作区投影不得丢失自动补齐的族裔默认值');
assert.equal(projectedUiProfile.ethnicity_source, 'user_confirmable_default', '资产工作区投影必须保留族裔值的来源，供界面提示用户确认');

const briefView = read('public/story-ad/views/briefView.js');
const briefTransition = read('public/story-ad/views/briefAssetPlanTransition.js');
const appView = read('public/story-ad/app.js');
const assetCenter = read('public/story-ad/views/assetCenterView.js');
const personForm = read('public/story-ad/views/assetCenterPersonForm.js');
const dossier = read('public/story-ad/views/personDossierShowcase.js');
const historyModeSource = read('public/story-ad/workspaceHistoryMode.js').replace(/\bexport\s+/g, '');
const historyMode = new Function(`${historyModeSource}; return { historicalStepReadOnly, applyHistoricalReadonlyControls };`)();
assert.match(briefView, /createAssetPlanAndRefresh[\s\S]*view=assets/, '目标确认必须使用可恢复的资产方案转场');
assert.match(briefTransition, /let planError = null;[\s\S]*runStage\('scene-config'\)[\s\S]*loadBundle\(taskId, 'summary,assets'\)/, '方案创建失败后必须刷新可恢复状态并进入资产中心');
assert.match(appView, /historicalStepReadOnly[\s\S]*data-unlock-history-step/, '已进入后续环节的历史步骤必须默认只读并提供显式编辑入口');
const safeAction = { disabled: false, dataset: {}, matches: selector => selector === '[data-history-safe]' };
const editControl = { disabled: false, dataset: {}, matches: () => false };
historyMode.applyHistoricalReadonlyControls({ querySelectorAll: () => [safeAction, editControl] });
assert.equal(safeAction.disabled, false, '历史步骤中的生成、查看和导航等显式安全动作不得被误锁');
assert.equal(editControl.disabled, true, '历史步骤中的内容编辑控件必须保持禁用');
assert.equal(editControl.dataset.historicalReadonly, 'true', '历史内容编辑控件必须保留可审计的只读标记');
assert.equal(historyMode.historicalStepReadOnly({ navigation: { current: 'assets' } }, { view: 'brief', taskId: 'task-1' }), true, '从资产步骤返回目标步骤时必须进入只读模式');
assert.equal(historyMode.historicalStepReadOnly({ navigation: { current: 'assets' } }, { view: 'assets', taskId: 'task-1' }), false, '当前步骤不得被误锁');
assert.equal(historyMode.historicalStepReadOnly({ project: { workspace: 'storyboard' }, navigation: { current: 'brief', steps: { storyboard: { completed: true } } } }, { view: 'brief', taskId: 'task-1' }), true, '第一个未完成步骤不得覆盖任务已经到达的真实制作阶段');
assert.equal(historyMode.historicalStepReadOnly({ navigation: { current: 'final' } }, { view: 'workflow', taskId: 'task-1' }), false, '工作流总览始终保持可查看');
assert.match(assetCenter, /assetCenterPersonForm/, '人物编辑表单必须按需加载，避免扩大核心工作区体积');
assert.match(personForm, /name="ethnicity"/, '人物编辑表单必须提供独立原创族裔外貌字段');
assert.match(assetCenter, /\['年龄', personAgeDisplay\(profile\)\]/, '人物详情必须独立显示年龄');
assert.match(dossier, /fact\('原创族裔外貌设定'/, '完整人物档案必须独立显示原创族裔外貌设定');

console.log('story-ad reference asset autofill v41 regression: ok (2 primary, 5 ambient, coverage complete)');
