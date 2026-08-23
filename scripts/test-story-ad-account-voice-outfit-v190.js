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

const root = path.resolve(__dirname, '..');
const form = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPersonForm.js'), 'utf8');
const drawer = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPlanningDetails.js'), 'utf8');
const view = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
assert.doesNotMatch(form, /field\('voice_id'/, '用户表单不得继续暴露底层音色 ID 输入框');
assert.match(form, /data-system-voice-binding/, '人物编辑必须展示系统自动音色绑定状态');
assert.match(form, /data-save-regenerate-person/, '服装修改必须有保存并重生成人物图的明确入口');
assert.match(form, /data-jump-person-looks/, '人物编辑顶部必须提供直达服装造型的入口');
assert.match(drawer, /event\.submitter\?\.matches\('\[data-save-regenerate-person\]'/, '保存并重生成必须由实际提交按钮区分');
assert.match(drawer, /await onGenerate\?\.\(item, group, button\)/, '保存成功后必须进入现有计费确认和定向生成人物链路');
assert.match(view, /target\.profile\?\.id/, '定向生成必须使用刚保存的人物档案覆盖旧 bundle 人物文本');
assert.match(view, /item\.profile = \{ \.\.\.\(item\.profile \|\| \{\}\), \.\.\.normalizedValues \}/, '保存成功后必须更新定向生成使用的人物内存状态');

console.log('story-ad account voice and outfit v190: 20 assertions passed');
