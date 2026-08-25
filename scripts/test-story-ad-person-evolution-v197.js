'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const evolution = require('../src/services/newStoryAd/personStateEvolutionService');
const looks = require('../src/services/newStoryAd/personLookProfileService');

const ageless = evolution.normalizeProfile({
  id: 'shen_yanci', identity_continuity: 'same_person', aging_mode: 'ageless', age: '1000岁',
  apparent_age: '28岁', age_states: [{ id: 'modern', name: '千年后', apparent_age: '28岁', story_state: '现代' }],
});
assert.equal(ageless.identity_id, 'shen_yanci');
assert.equal(ageless.lineage_identity_id, 'shen_yanci');
assert.equal(ageless.aging_mode, 'ageless');
assert.equal(ageless.age_states[0].apparent_age, '28岁');
assert.match(evolution.generationLocks(ageless, 'modern').aging_rule, /must not increase/);

const aging = evolution.normalizeProfile({
  id: 'person_a', aging_mode: 'natural_aging', age_states: [
    { id: 'young', apparent_age: '25岁' }, { id: 'old', apparent_age: '65岁' },
  ],
});
assert.equal(aging.age_states.length, 2);
assert.match(evolution.generationLocks(aging, 'old').aging_rule, /preserve identity geometry/);

const reincarnation = evolution.normalizeProfile({ id: 'modern_yun', identity_continuity: 'reincarnation' });
assert.equal(reincarnation.aging_mode, 'reincarnation');
assert.notEqual(reincarnation.lineage_identity_id, '');
assert.match(evolution.generationLocks(reincarnation).aging_rule, /distinct identity/);

const wardrobe = looks.normalizeLookProfiles({ id: 'person_a', look_profiles: [{
  id: 'winter', name: '雪夜造型', wardrobeText: '深色长袍', garments: ['长袍'], footwear: ['黑靴'],
  accessories: ['玉佩'], season_weather: '冬季大雪', action_suitability: '骑马与战斗', age_state_id: 'young',
}] })[0];
assert.deepEqual(wardrobe.garments, ['长袍']);
assert.deepEqual(wardrobe.footwear, ['黑靴']);
assert.deepEqual(wardrobe.accessories, ['玉佩']);
assert.equal(wardrobe.age_state_id, 'young');

const cardSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/sceneDossierCard.js'), 'utf8');
const editorSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterPersonEvolution.js'), 'utf8');
const assetSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterView.js'), 'utf8');
const personFormSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterPersonForm.js'), 'utf8');
assert(cardSource.includes('单人物标准人像'));
assert(editorSource.includes('高级：年龄与剧情状态演化'));
assert(editorSource.includes('同一人物自然变老'));
assert(editorSource.includes('时间经过但容颜不老'));
assert(personFormSource.includes('renderPersonEvolutionEditor'));
assert(assetSource.includes('collectPersonEvolutionValues'));

console.log('story-ad person evolution and wardrobe assets: ok');
