#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-person-save-readback-'));
process.env.DB_ENABLED = '0';

const storyAd = require('../src/services/newStoryAd/storyAdService');
const workspace = require('../src/services/storyAdWorkspace/projectBundleService');
const owner = { id: 'person-save-owner', role: 'user' };

const created = storyAd.createTask({
  project_name: '人物保存回读',
  brief: '一名活了千年的角色在古代与现代之间穿越。',
  content_mode: 'narrative_story', content_mode_source: 'user',
  cast_mode: 'single', expected_people: 1,
}, owner);
const id = created.task.id;

const updated = storyAd.updateTaskRequest(id, {
  base_content_revision: 1,
  client_edit_seq: 1,
  cast_profiles: [{
    id: 'cast_1', displayName: '凌光', roleName: '男主角', age: '1000',
    appearanceText: '1000岁，面容清俊，身形挺拔，眼神沉静',
    look_profiles: [
      { id: 'ancient', name: '古代将军造型', story_state: '千年前', scene_ids: ['ancient_city'], wardrobeText: '白色暗纹锦缎直裾', wardrobe_contract: { schema_version: 2 }, knowledge_refs: ['kb:ancient'] },
      { id: 'modern', name: '现代简约造型', story_state: '千年后', scene_ids: ['modern_city'], wardrobeText: '纯白简约衬衫', wardrobe_contract: { schema_version: 2 }, knowledge_refs: ['kb:modern'] },
    ],
  }],
}, owner);
assert.equal(updated.context.cast_profiles[0].age, '1000');
assert.match(updated.context.cast_profiles[0].appearanceText, /1000岁/u);

const bundle = workspace.buildProjectBundle(id, { sections: 'summary,assets', user: owner });
const profile = bundle.assets.people[0].profile;
assert.equal(profile.age, '1000');
assert.match(profile.appearanceText, /1000岁/u);
assert.deepEqual(profile.look_profiles.map(look => look.id), ['ancient', 'modern']);
assert.equal(profile.look_profiles[0].wardrobe_contract.schema_version, 2);
assert.deepEqual(profile.look_profiles[1].knowledge_refs, ['kb:modern']);
assert(!bundle.story && !bundle.storyboard && !bundle.generation, '轻量人物回读不得加载 story/shots/media');
console.log('story ad person save readback v132: ok');
