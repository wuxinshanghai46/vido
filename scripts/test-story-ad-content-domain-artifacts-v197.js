'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const artifacts = require('../src/services/newStoryAd/contentDomainArtifactService');

const narrativeContext = { content_mode: 'narrative_story', content_mode_source: 'user', content_revision: 3 };
const commercialContext = { content_mode: 'commercial_subject', content_mode_source: 'user', product_subject: '竹叶茶', content_revision: 4 };

const narrative = artifacts.tagBlueprint(narrativeContext, {
  story_title: '重回竹林',
  beats: [{ title: '归来', plot: '人物沿新修的林间道路回到原竹林旧址。' }],
});
assert.equal(narrative.content_mode, 'narrative_story');
assert.match(narrative.prompt_pack, /narrative/);
assert.equal(narrative.source_revision, 3);

const commercial = artifacts.tagBlueprint(commercialContext, {
  story_title: '竹叶茶广告',
  beats: [{ title: '展示', visual: '竹叶茶商品与冲泡材料清晰呈现。' }],
});
assert.equal(commercial.content_mode, 'commercial_subject');
assert.match(commercial.prompt_pack, /commercial/);
assert.notEqual(commercial.prompt_pack, narrative.prompt_pack);

const abbreviatedCommercial = artifacts.tagBlueprint({
  content_mode: 'commercial_subject',
  content_mode_source: 'user',
  product_subject: '高性能红色电动跑车',
}, {
  beats: [{ visual: '红色电动跑车驶入雨后街道，车身稳定通过弯道。' }],
});
assert.equal(abbreviatedCommercial.content_mode, 'commercial_subject');
assert.throws(() => artifacts.tagBlueprint({
  content_mode: 'commercial_subject',
  content_mode_source: 'user',
  product_subject: '高性能红色电动跑车',
}, {
  beats: [{ visual: '红色的花朵在清晨缓慢绽放。' }],
}), error => error?.code === 'CONTENT_DOMAIN_QA_FAILED');

assert.throws(() => artifacts.tagBlueprint(narrativeContext, {
  beats: [{ plot: '立即购买并下单。' }],
}), error => error?.code === 'CONTENT_DOMAIN_QA_FAILED');
assert.throws(() => artifacts.tagBlueprint({ content_mode: 'commercial_subject', content_mode_source: 'user' }, {
  beats: [{ visual: '一段普通画面。' }],
}), error => error?.code === 'CONTENT_DOMAIN_QA_FAILED');

const revisionSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/revisionService.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/storyAdService.js'), 'utf8');
const skillSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/contentSkillService.js'), 'utf8');
const briefSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/briefView.js'), 'utf8');
assert.match(revisionSource, /content_mode: ctx\.content_mode/);
assert.match(skillSource, /CONTENT_MODE_CHANGE_CONFIRMATION_REQUIRED/);
assert.match(skillSource, /content_mode_migration/);
assert.match(briefSource, /content_mode_change_confirmed = true/);

console.log('story-ad content-domain artifacts and explicit mode migration: ok');
