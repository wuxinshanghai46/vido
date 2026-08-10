#!/usr/bin/env node
'use strict';

const assert = require('assert');
const profileText = require('../src/services/newStoryAd/subjectProfileTextService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const personAge = require('../src/services/newStoryAd/personAgeContractService');
const subjects = require('../src/services/newStoryAd/subjectAssetBundleService');

for (const age of [0, 1, 17, 18, 35, 99, 100, 1000]) {
  const source = `${age}岁，面容与气质保持稳定`;
  assert.equal(profileText.alignAgeDescription(source, ''), source, `${age}岁不得删除或截断`);
}

for (const source of ['18~25岁', '18～25岁', '18-25岁', '18—25岁', '18–25岁', '18至25岁', '18到25岁']) {
  const normalized = personAge.normalize(source, { strict: true });
  assert.equal(normalized.value, '18~25岁', `${source}必须统一为同一年龄区间`);
  assert.equal(profileText.alignAgeDescription(`${source}，面容年轻`, ''), `${source}，面容年轻`, `${source}不得在保存前截断`);
}
assert.match(personAge.promptLock('18~25岁'), /between 18 and 25 years old/u);
assert.match(personAge.promptLock('22岁'), /exactly 22 years old/u);
assert.throws(() => personAge.normalize('25~18岁', { strict: true }), error => error.code === 'PERSON_AGE_FORMAT_INVALID');

const immortal = '实际年龄1000岁，外观约30岁，神态沉静';
assert.equal(profileText.alignAgeDescription(immortal, 'adult_30_40'), immortal, '实际年龄和外观年龄必须同时保留');

const context = contextBuilder.buildContext({
  brief: '一位跨越千年的角色在古代与现代生活。',
  cast_profiles: [{
    id: 'cast_1',
    name: '凌光',
    age: '1000',
    appearanceText: '1000岁，面容清俊，身形挺拔',
    look_profiles: [
      { id: 'ancient', name: '古代造型', wardrobeText: '古代将军服装', wardrobe_contract: { version: 2 } },
      { id: 'modern', name: '现代造型', wardrobeText: '现代简约服装', knowledge_refs: ['kb:test'] },
    ],
  }],
});
const saved = context.cast_profiles[0];
assert.equal(saved.age, '1000岁');
assert.equal(saved.age_contract.mode, 'exact');
assert.match(saved.appearanceText, /1000岁/u);
assert.equal(saved.look_profiles.length, 2);
const rangeContext = contextBuilder.buildContext({
  brief: '年轻角色', cast_profiles: [{ id: 'range_cast', age: '18至25岁', age_source: 'user', appearanceText: '面容年轻，气质沉静' }],
});
const rangeMember = subjects.humanMemberSpecs({}, rangeContext, 1)[0];
assert.equal(rangeMember.age, '18~25岁');
assert.equal(rangeMember.age_contract.min_years, 18);
assert.equal(rangeMember.age_contract.max_years, 25);
assert.match(subjects.humanPrompt(rangeMember, 1), /between 18 and 25 years old/u, '生成提示必须使用用户区间，不得映射成17~25岁预设段');
console.log('story ad person exact/range age save: ok');
