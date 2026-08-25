#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const voiceAssignment = require('../src/services/newStoryAd/accountVoiceAssignmentService');

const catalog = {
  voices: [
    { id: 'vp_1111111111111111', name: '授权女声', gender: 'female', clonable: true, rights_status: 'user_confirmed_licensed' },
    { id: 'vp_2222222222222222', name: '授权男声', gender: 'male', clonable: true, rights_status: 'user_confirmed_licensed' },
    { id: 'vp_3333333333333333', name: '未授权音色', gender: 'female', clonable: true, rights_status: 'unknown' },
  ],
};
const input = {
  user_id: 'account-a',
  cast_profiles: [
    { id: 'heroine', displayName: '林岚', roleName: '空间设计师', gender: 'female', age: '25岁' },
    { id: 'client', displayName: '陈先生', roleName: '客户', gender: 'male', age: '42岁' },
  ],
  voice_assignments: { speakers: {} },
};
const projected = voiceAssignment.applyAccountVoiceAssignments(input, {}, { voicePacks: { loadCatalog: () => catalog } });
assert.strictEqual(projected.changed, true);
assert.strictEqual(projected.assigned_count, 2);
assert.strictEqual(projected.context.cast_profiles[0].voice_id, 'vp_1111111111111111');
assert.strictEqual(projected.context.cast_profiles[1].voice_id, 'vp_2222222222222222');
assert.strictEqual(projected.context.voice_assignments.speakers.heroine, 'vp_1111111111111111');
assert.strictEqual(projected.context.voice_assignments.speakers['林岚'], 'vp_1111111111111111');
assert.match(projected.context.cast_profiles[0].voice_tone, /自然、清晰/);
assert.match(projected.context.cast_profiles[0].voice_tone, /口型同步/);

const reused = voiceAssignment.applyAccountVoiceAssignments({
  ...projected.context,
  cast_profiles: projected.context.cast_profiles.map((profile, index) => index ? profile : { ...profile, voice_id: 'custom_existing' }),
}, {}, { voicePacks: { loadCatalog: () => catalog } });
assert.strictEqual(reused.context.cast_profiles[0].voice_id, 'custom_existing', '现有账号音色绑定不得被自动匹配覆盖');

const noCatalog = voiceAssignment.applyAccountVoiceAssignments(input, {}, { voicePacks: { loadCatalog: () => ({ voices: [] }) } });
assert.strictEqual(noCatalog.assigned_count, 0);
assert.strictEqual(noCatalog.context.cast_profiles[0].voice_binding.status, 'authorized_pack_unavailable');

const persisted = [];
const persistedContext = voiceAssignment.applyAndPersistContext(input, { userId: 'account-a', taskId: 'task-a', contentRevision: 3 }, {
  voicePacks: { loadCatalog: () => catalog },
  storage: {
    saveOutput(taskId, kind, value, metadata) { persisted.push({ taskId, kind, value, metadata }); },
    updateTask(taskId, patch) { persisted.push({ taskId, patch }); },
  },
});
assert.strictEqual(persisted.length, 2, '生成预检自动补齐必须同时持久化 context 与任务 request');
assert.strictEqual(persistedContext.voice_assignments.speakers.heroine, 'vp_1111111111111111');

const root = path.resolve(__dirname, '..');
const form = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPersonForm.js'), 'utf8');
const storyboard = fs.readFileSync(path.join(root, 'public/story-ad/views/storyboardView.js'), 'utf8');
const drawer = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPlanningDetails.js'), 'utf8');
const view = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
assert.doesNotMatch(form, /field\('voice_id'/, '用户表单不得继续暴露底层音色 ID 输入框');
assert.doesNotMatch(form, /renderPersonVoiceBinding|声音与对白表演/, '声音与对白不属于人物外观生成表单');
assert.match(storyboard, /对白与声音表演[\s\S]*data-shot-speaker[\s\S]*data-shot-spoken-line/, '说话人和台词必须在分镜线稿逐镜设置');
assert.doesNotMatch(storyboard, /name="voice_id"|data-shot-voice-id/, '分镜线稿不得要求普通用户填写底层音色 ID');
assert.match(form, /data-save-regenerate-person/, '服装修改必须有保存并重生成人物图的明确入口');
assert.match(form, /name="generation_prompt"/, '人物编辑必须使用单一完整生成提示词');
assert.match(drawer, /event\.submitter\?\.matches\('\[data-save-regenerate-person\]'/, '保存并重生成必须由实际提交按钮区分');
assert.match(drawer, /await onGenerate\?\.\(item, group, button\)/, '保存成功后必须进入现有计费确认和定向生成人物链路');
assert.match(view, /target\.profile\?\.id/, '定向生成必须使用刚保存的人物档案覆盖旧 bundle 人物文本');
assert.match(view, /item\.profile = savedProfile/, '保存成功后必须使用服务器回读的人物档案更新内存状态');

console.log('story-ad account voice and outfit v190: 23 assertions passed');
