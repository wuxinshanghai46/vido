#!/usr/bin/env node
'use strict';

const assert = require('assert');
const subjectProfileText = require('../src/services/newStoryAd/subjectProfileTextService');
const repair = require('./repair-story-ad-target-person-authority-v396');

const polluted = {
  id: repair.TARGET_PERSON_ID,
  displayName: '陈默',
  age: '25岁',
  appearanceText: '旧描述；新描述',
  wardrobeText: '固定穿着紫色晚礼服；固定穿米白针织上衣',
  hairMakeupText: '旧发型；新发型',
  negativeText: '禁止出现第二套服装',
  generation_prompt: '旧提示词',
  user_edited_fields: ['displayName', 'appearanceText', 'wardrobeText', 'hairMakeupText', 'negativeText'],
  field_authority: { displayName: 'user', appearanceText: 'user', wardrobeText: 'user', hairMakeupText: 'user', negativeText: 'user' },
  look_profiles: [{ id: 'char_chenmo_look_1', wardrobeText: '冲突服装', hairMakeupText: '冲突发型', negativeText: '冲突限制' }],
};

const cleaned = repair.cleanProfile(polluted);
assert.equal(cleaned.id, repair.TARGET_PERSON_ID);
assert.doesNotMatch(cleaned.wardrobeText, /紫色晚礼服|黑色高跟鞋/u);
assert.match(cleaned.negativeText, /禁止出现紫色晚礼服/u);
assert.equal(cleaned.look_profiles[0].wardrobeText, cleaned.wardrobeText);
assert.equal(cleaned.look_profiles[0].hairMakeupText, cleaned.hairMakeupText);
assert.equal(cleaned.generation_prompt_source, 'compiled_from_profile');
assert.match(cleaned.generation_prompt, /服装：固定穿哑光米白色短袖针织上衣/u);
assert.doesNotMatch(cleaned.generation_prompt, /服装：[\s\S]*固定穿着紫色晚礼服/u);
assert(!cleaned.user_edited_fields.includes('wardrobeText'));
assert.equal(cleaned.field_authority.wardrobeText, 'system_default');
assert.equal(subjectProfileText.assistedProfileQuality(cleaned).valid, true);

assert.throws(() => repair.assertExpectedSource(
  { id: repair.TARGET_TASK_ID, title: '错误任务', active_generation_id: '' },
  { id: repair.TARGET_PERSON_ID },
), /目标任务身份不匹配/u);
assert.throws(() => repair.assertExpectedSource(
  { id: repair.TARGET_TASK_ID, title: '佛山智造 · 不锈钢品牌广告', active_generation_id: 'active' },
  { id: repair.TARGET_PERSON_ID },
), /活动生成/u);
assert.equal(repair.assertExpectedSource({
  id: repair.TARGET_TASK_ID,
  title: '佛山智造 · 不锈钢品牌广告',
  active_generation_id: '',
}, cleaned), 'clean_intermediate');

console.log(JSON.stringify({
  passed: true,
  coherent_prompt: true,
  stale_user_authority_removed: true,
  current_look_aligned: true,
  provider_calls: 0,
}));
