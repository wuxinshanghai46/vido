#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const history = require('../src/services/newStoryAd/briefDialogueHistoryService');
const { buildContext, contextPrompt } = require('../src/services/newStoryAd/contextBuilder');
const projection = require('../src/services/storyAdWorkspace/briefProjectionService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const revisions = require('../src/services/newStoryAd/revisionService');

const rawHistory = [
  { id: 'q1', seq: 1, role: 'assistant', content: '是否需要向客户现场介绍？', topic: 'cast' },
  { id: 'a1', seq: 2, role: 'user', content: '是', topic: 'cast', selected_answer: true },
  { id: 'a1', seq: 3, role: 'user', content: '是', topic: 'cast', selected_answer: true },
];
const castIntent = {
  confirmed: true,
  mode: 'dual',
  expected_people: 2,
  source: 'user_dialogue',
  participants: [
    { id: 'presenter', role: '空间设计师', gender: 'female', age_range: '28~35岁', on_screen: true },
    { id: 'customer', role: '客户', gender: 'male', age_range: '35~45岁', on_screen: true },
  ],
};

const normalizedHistory = history.normalizeHistory(rawHistory);
assert.equal(normalizedHistory.length, 2, '返回或重复保存时同一条对话不得重复');
assert.equal(normalizedHistory[1].topic, 'cast', '“是”必须继续绑定原问题主题');

const ctx = buildContext({
  project_name: '人物合同测试',
  brief: '设计师在展厅向客户介绍不锈钢墙面。',
  product_subject: '不锈钢墙面',
  content_mode: 'commercial_subject',
  content_mode_source: 'user',
  brief_intake: { dialogue_history: rawHistory, cast_intent: castIntent },
});
assert.equal(ctx.expected_people, 2);
assert.equal(ctx.cast_mode, 'dual');
assert.equal(ctx.characters.length, 2);
assert.deepEqual(ctx.characters.map(item => item.age_range), ['28~35岁', '35~45岁']);
assert.match(contextPrompt(ctx), /是否需要向客户现场介绍/);
assert.match(contextPrompt(ctx), /用户〔cast〕：是/);
assert.match(contextPrompt(ctx), /出镜人物合同/);

const brief = projection.project(ctx, { title: '人物合同测试' });
assert.equal(brief.brief_intake.dialogue_history.length, 2);
assert.equal(brief.brief_intake.cast_intent.expected_people, 2);
const audienceOnly = buildContext({
  ...ctx,
  characters: [],
  cast_mode: 'no_human',
  expected_people: 0,
  brief_intake: { ...ctx.brief_intake, cast_intent: { confirmed: true, mode: 'no_human', expected_people: 0, participants: [], source: 'user_dialogue' } },
});
assert.ok(revisions.changeDomains(audienceOnly, ctx).includes('person'), '出镜选择变化必须进入人物域并失效旧蓝图');
const historyOnly = buildContext({ ...ctx, brief_intake: { ...ctx.brief_intake, dialogue_history: [...normalizedHistory, { id: 'q2', role: 'assistant', content: '确认规格', topic: 'specifications' }] } });
assert.deepEqual(revisions.changeDomains(ctx, historyOnly), [], '仅补存对话记录不得触发蓝图失效或重复生成');

assert.throws(
  () => assetPlan.assertBlueprintCastContract(ctx, {
    story_title: '错误单人蓝图',
    characters: [{ id: 'presenter', name: '林岚', role: '空间设计师', gender: 'female', age_range: '28~35岁' }],
    beats: [{ title: '介绍材料' }],
  }),
  error => error.code === 'BLUEPRINT_CAST_CONTRACT_MISMATCH',
  '双人合同与单人蓝图冲突时必须在模型调用前停止',
);
assert.doesNotThrow(() => assetPlan.assertBlueprintCastContract(ctx, {
  story_title: '正确双人蓝图',
  characters: [
    { id: 'presenter', name: '林岚', role: '空间设计师', gender: 'female', age_range: '28~35岁' },
    { id: 'customer', name: '周衡', role: '客户', gender: 'male', age_range: '35~45岁' },
  ],
  beats: [{ title: '介绍材料' }],
}));

const legacyCtx = buildContext({
  project_name: '旧任务', brief: '设计师验证材料。', product_subject: '不锈钢',
  content_mode: 'commercial_subject', content_mode_source: 'user', cast_mode: 'no_human', expected_people: 0,
});
assert.throws(
  () => assetPlan.assertBlueprintCastContract(legacyCtx, {
    story_title: '旧单人蓝图',
    characters: [{ name: '林岚', role: '设计师', gender: 'female', age_range: '28~35岁' }],
    beats: [{ title: '验证材料' }],
  }),
  error => error.code === 'CAST_INTENT_CONFIRMATION_REQUIRED',
  '旧任务 0↔1 人物权威冲突必须要求用户重新确认，不能静默猜测',
);

const plotView = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/plotRoomView.js'), 'utf8');
const beatEditor = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/plotBeatEditor.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/story-ad/workspace-ux.css'), 'utf8');
for (const field of ['name', 'gender', 'age_range', 'role', 'relationship', 'description']) {
  assert.match(plotView, new RegExp(`data-character-field=\\"${field}\\"`));
}
for (const field of ['scene', 'shot_size', 'lighting_mood', 'speaker', 'sound_mode', 'camera_movement', 'transition', 'prompt_notes']) {
  assert.match(beatEditor, new RegExp(`\\b${field}\\b`));
}
assert.match(css, /beat-table-scroll\{[^}]*overflow-x:auto/);
assert.match(css, /story-overview-grid\{[^}]*align-items:stretch/);

console.log(JSON.stringify({ passed: true, checks: 30, scope: 'dialogue-cast-blueprint-v151', model_calls: 0 }));
