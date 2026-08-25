#!/usr/bin/env node
'use strict';

const assert = require('assert');
const dialogueAssist = require('../src/services/newStoryAd/briefDialogueAssistService');
const { buildContext, contextPrompt, assertContextConsistent } = require('../src/services/newStoryAd/contextBuilder');
const { normalizeBlueprint } = require('../src/services/newStoryAd/blueprintService');
const { assessBlueprintQuality } = require('../src/services/newStoryAd/blueprintQualityService');
const { assertBlueprintCastContract } = require('../src/services/newStoryAd/assetPlanService');
const { normalizeShots } = require('../src/services/newStoryAd/storyboardTableService');
const briefProjection = require('../src/services/storyAdWorkspace/briefProjectionService');

const userIdea = [
  '佛山海和不锈钢产品广告，展示铂棕碎钻蚀刻、高档金属装饰、做旧钢板和金属拉丝。',
  '要有个背景人物但是可以不介绍，只要出现在场景中，完成触摸、走过和驻足动作。',
].join('\n');
const castIntent = dialogueAssist.normalizeCastIntent({
  cast_intent: {
    status: 'explicit', decision: 'background_only', expected_people: 0,
    participants: [], evidence: '背景人物',
  },
}, userIdea);
assert.equal(castIntent.mode, 'single');
assert.equal(castIntent.expected_people, 1);
assert.equal(castIntent.participants.length, 1);

const ctx = buildContext({
  request_id: 'background-performer-v212', project_name: '佛山智造 · 不锈钢品牌广告',
  brief: userIdea, product_subject: '佛山海和不锈钢材料系列',
  content_mode: 'commercial_subject', content_mode_source: 'user', target_duration: 30,
  brief_intake: { cast_intent: castIntent, dialogue_history: [{ role: 'user', content: userIdea, topic: 'commercial_evidence' }] },
});
assert.equal(ctx.cast_mode, 'single');
assert.equal(ctx.expected_people, 1);
assert.equal(ctx.characters.length, 1);
assert.match(contextPrompt(ctx), /1 位背景出镜人物|背景出镜人物/);
assert.strictEqual(assertContextConsistent(ctx), ctx, '已规范化的背景人物合同不得在后续阶段覆盖已完善的人物资料');

const legacy = assertContextConsistent({
  ...ctx, cast_mode: 'auto', expected_people: 0, planning_cast_count: 0, visual_asset_count: 0, characters: [],
  brief_intake: { ...ctx.brief_intake, cast_intent: { confirmed: true, mode: 'auto', expected_people: 0, participants: [], source: 'semantic_dialogue' } },
});
assert.equal(legacy.expected_people, 1);
assert.equal(legacy.characters.length, 1);

const performer = ctx.characters[0];
assert.equal(performer.name, '背景出镜人物', '尚未赋名的背景人物应保持中性标签');
const namedContext = assertContextConsistent({ ...ctx, characters: [{ ...performer, id: 'char_chenmo', name: '陈默', source: 'assigned_background_cast' }], cast_profiles: [{ id: 'char_chenmo', name: '陈默', displayName: '陈默', roleName: '背景出镜人物' }] });
assert.equal(namedContext.characters[0].name, '陈默', '背景人物一旦拥有权威姓名，合同入口必须保留该姓名');
assert.equal(namedContext.cast_profiles[0].name, '陈默', '人物档案必须与背景人物的权威姓名保持一致');
const rawBlueprint = {
  story_title: '光线里的金属层次',
  logline: '一位不介绍身份的背景人物通过触摸、走过和驻足，让四种不锈钢纹理在不同光线下形成清楚可见的空间效果。',
  target_duration: 30,
  narrative_contract: {
    version: 'causal-story-v1', arc_type: 'demonstration',
    setup: '建立未经光线验证的材料表面', trigger: '背景人物触摸材料并改变观察角度',
    progression: '依次用侧光、顶光和点光验证四种纹理', result: '完整展台呈现高级而可比较的材料效果',
    beat_refs: { setup: [1], trigger: [1], progression: [2], result: [3] },
  },
  characters: [{ ...performer, on_screen: true }],
  beats: [
    {
      beat_index: 1, role: '触摸建立材质证据', causal_role: 'setup', ad_phase: 'opening_hook',
      plot: '背景人物只露出手部与侧影，指尖划过铂棕碎钻蚀刻表面。', story_visual: '指尖、蚀刻纹理和移动侧光同框。',
      action: '背景人物缓慢触摸材料，侧光沿指尖方向移动。', state_before: ['纹理处于均匀光下'], state_after: ['蚀刻凹凸被侧光显现'],
      intended_changes: ['建立触感与光影关系'], visible_evidence: ['纹理高低差和反光变化'],
      spoken_line: '先看侧光掠过时，蚀刻纹理怎样把层次带出来。', speech_mode: 'voiceover', speaker: '旁白', speaker_id: 'narrator', dialogue_function: 'setup_goal',
      lighting_mood: '冷暖中性的移动侧光', camera_movement: '微距横移跟随指尖', prompt_notes: '产品纹理为主体，人物不介绍身份',
      ambient_sound: '展厅轻微环境声', sfx: ['指尖划过金属声'], music_cue: '克制的低频节奏', duration: 10,
    },
    {
      beat_index: 2, role: '多纹理并排验证', causal_role: 'development', ad_phase: 'product_proof',
      plot: '背景人物从装饰墙前走过并驻足，三维样片同步并排展开。', story_visual: '做旧、拉丝和装饰墙纹理在不同光线下连续切换。',
      action: '背景人物走过后停下观察，顶光和点光依次开启。', state_before: ['只验证蚀刻纹理'], state_after: ['四种纹理形成可比较结果'],
      intended_changes: ['扩展到同系列多种产品'], visible_evidence: ['做旧斑驳、拉丝走向和点状反光差异'],
      spoken_line: '做旧、拉丝和装饰墙各自回应光线，同系列也能形成不同空间气质。', speech_mode: 'voiceover', speaker: '旁白', speaker_id: 'narrator', dialogue_function: 'proof',
      lighting_mood: '顶光与点光依次切换', camera_movement: '中景横移后衔接三维正面展示', prompt_notes: '人物保持背景尺度参照，不成为讲解者',
      ambient_sound: '展厅脚步声', sfx: ['样片展开声'], music_cue: '节奏逐渐明亮', duration: 10,
    },
    {
      beat_index: 3, role: '完整空间效果收束', causal_role: 'resolution', ad_phase: 'closing_payoff',
      plot: '背景人物驻足于完整家居展台一侧，主体始终是组合后的金属墙面。', story_visual: '四种纹理组合成完整墙面与展台效果。',
      action: '镜头拉远显示整体空间，背景人物离开画面。', state_before: ['纹理处于分项比较'], state_after: ['材料组合成为完整高级空间'],
      intended_changes: ['从单项证据收束为整体效果'], visible_evidence: ['纹理组合、颜色搭配和空间反射完整可见'],
      spoken_line: '从材料细节到完整空间，佛山海和让不锈钢呈现更精致的设计效果。', speech_mode: 'voiceover', speaker: '旁白', speaker_id: 'narrator', dialogue_function: 'brand_closure',
      lighting_mood: '稳定暖色空间光', camera_movement: '缓慢拉远并稳定停住', prompt_notes: '自然场景收束，不生成视觉 Logo',
      ambient_sound: '空间环境声', sfx: ['轻微转场声'], music_cue: '温暖收束', duration: 10,
    },
  ],
};
const blueprint = normalizeBlueprint(rawBlueprint, { ...ctx, require_causal_contract: true });
const review = assessBlueprintQuality(blueprint, ctx);
assert.equal(review.pass, true, review.issues.join('；'));
assert.equal(blueprint.characters.length, 1);
assert.doesNotThrow(() => assertBlueprintCastContract(ctx, blueprint));

const conflictingModelBlueprint = JSON.parse(JSON.stringify(rawBlueprint));
conflictingModelBlueprint.characters = [{ id: 'invented_designer', name: '陈默', role: '设计师', gender: 'male', age_range: '30~35岁', on_screen: true }];
conflictingModelBlueprint.narrative_contract.setup = '和映恒走进展厅，陈默停下观察墙面。';
conflictingModelBlueprint.segment_plan = [{ fixed_subjects: '和映恒', continuity_rules: ['陈默的服装保持一致'] }];
conflictingModelBlueprint.beats[0].story_visual = '背景出镜人物走进展厅，保持背景尺度。';
conflictingModelBlueprint.beats[1].plot = '他背景出镜人物走到墙前，背景出镜人物触摸纹理。';
conflictingModelBlueprint.beats.forEach((beat, index) => {
  beat.plot = `${index ? '陈默' : '和映恒'}走进展厅，${beat.plot}`;
  beat.action = `${index ? '陈默' : '和映恒'}抬手触摸样板，${beat.action}`;
  beat.dialogue_lines = [{ speech_mode: 'dialogue', speaker: index ? '陈默' : '和映恒', speaker_id: 'invented_designer', line: beat.spoken_line }];
  beat.speech_mode = index === 0 ? 'ambient_only' : 'silent';
  beat.speaker = '';
  beat.speaker_id = '';
  beat.spoken_line = '';
  beat.camera_movement_notes = `镜头最终停在${index ? '陈默' : '和映恒'}中景`;
});
const rejectedConflict = assessBlueprintQuality(conflictingModelBlueprint, ctx);
assert.equal(rejectedConflict.pass, false, '未规范化的声音冲突与空说话人必须被质量门禁拒绝');
assert(rejectedConflict.issues.some(issue => issue.includes('顶层被标记为静默')));
assert(rejectedConflict.issues.some(issue => issue.includes('未绑定明确说话人')));
const repairedConflict = normalizeBlueprint(conflictingModelBlueprint, { ...ctx, require_causal_contract: true });
assert.equal(repairedConflict.characters[0].name, '陈默', '模型已为唯一背景人物赋予稳定姓名时必须沿用该姓名');
assert(repairedConflict.beats.every(beat => !/和映恒/.test(`${beat.plot} ${beat.action}`)), '同一人物的其他临时别名不得残留在背景人物动作中');
assert.equal(/和映恒/.test(JSON.stringify(repairedConflict)), false, '背景人物的非权威别名不得残留在叙事合同、连续性、运镜或任何标准化文本字段中');
assert.match(repairedConflict.logline, /通过触摸、走过和驻足/, '“通过触摸”等语法连接词不得被误识别成人名并替换');
assert.equal(/背景背景出镜人物|(?:背景出镜人物){2,}/.test(JSON.stringify(repairedConflict)), false, '中性出镜人物标签不得被别名清理二次替换');
assert.equal(repairedConflict.characters[0].name, '陈默');
assert(repairedConflict.beats.every(beat => /陈默/.test(`${beat.plot} ${beat.action}`)), '人物已有姓名时，画面与动作应直接使用姓名而不是继续显示背景人物占位标签');
assert.equal(/他陈默|她陈默|陈默[^。！？；]{0,28}[，,]陈默/.test(JSON.stringify(repairedConflict)), false, '姓名替换不得产生代词粘连或同一句重复姓名');
assert(repairedConflict.beats.every(beat => beat.speech_mode === 'dialogue' && beat.speaker === '陈默' && beat.speaker_id === 'invented_designer'), '内层人物对白必须成为权威摘要并自动绑定唯一已赋名人物');
const repairedReview = assessBlueprintQuality(repairedConflict, ctx);
assert.equal(repairedReview.pass, true, repairedReview.issues.join('；'));

const storyboard = normalizeShots(blueprint.beats.map((beat, index) => ({
  index: index + 1, title: beat.role, visual: beat.story_visual, action: beat.action,
  dialogue: beat.spoken_line, speaker: beat.speaker, duration: beat.duration,
})), { ...ctx, characters: blueprint.characters });
assert.equal(storyboard.length, 3);
assert.equal(briefProjection.project(ctx, { title: ctx.project_name }).expected_people, 1);

console.log(JSON.stringify({
  passed: true, scope: 'background-performer-flow-v212',
  stages: ['semantic_cast', 'context', 'blueprint', 'quality', 'asset_plan_gate', 'storyboard', 'workspace_projection'],
  expected_people: 1, blueprint_characters: blueprint.characters.length, storyboard_shots: storyboard.length,
  real_model_calls: 0,
}));
