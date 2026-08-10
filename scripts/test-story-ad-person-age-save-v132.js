#!/usr/bin/env node
'use strict';

const assert = require('assert');
const profileText = require('../src/services/newStoryAd/subjectProfileTextService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');

for (const age of [0, 1, 17, 18, 35, 99, 100, 1000]) {
  const source = `${age}岁，面容与气质保持稳定`;
  assert.equal(profileText.alignAgeDescription(source, ''), source, `${age}岁不得删除或截断`);
}

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
assert.equal(saved.age, '1000');
assert.match(saved.appearanceText, /1000岁/u);
assert.equal(saved.look_profiles.length, 2);
console.log('story ad person age save v132: ok');
