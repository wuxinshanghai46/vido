'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const contentSkill = require('../src/services/newStoryAd/contentSkillService');
const contentDomains = require('../src/services/newStoryAd/contentDomains');
const multiline = require('../src/services/newStoryAd/multilineTextContractService');
const projectBundle = require('../src/services/storyAdWorkspace/projectBundleService');

function expectCode(fn, code) {
  assert.throws(fn, error => error?.code === code, `expected ${code}`);
}

const commercial = contentDomains.snapshot('commercial_subject');
const narrative = contentDomains.snapshot('narrative_story');
assert.equal(commercial.mode, 'commercial_subject');
assert.equal(narrative.mode, 'narrative_story');
assert(commercial.required_sections.includes('advertised_subject'));
assert(!commercial.required_sections.includes('causal_chain'));
assert(narrative.required_sections.includes('causal_chain'));
assert(!narrative.required_sections.includes('call_to_action'));
assert(contentSkill.promptBlock('commercial_subject').includes('广告主体'));
assert(contentSkill.promptBlock('narrative_story').includes('不得凭空加入商品'));
expectCode(() => contentSkill.assertSelected({}), 'CONTENT_MODE_REQUIRED');
expectCode(() => contentSkill.mode('unknown_mode'), 'CONTENT_MODE_INVALID');
expectCode(() => contentSkill.assertSelected({ content_mode: 'narrative_story', content_mode_source: 'inferred' }), 'CONTENT_MODE_NOT_CONFIRMED');

const source = '【原始创作需求】第一段。\r\n\r\n【详细剧情描述】第二段。\r\n第三行。';
const normalized = multiline.normalize(source);
assert.equal(normalized, '【原始创作需求】第一段。\n\n【详细剧情描述】第二段。\n第三行。');
const before = multiline.metrics(source);
const after = multiline.metrics(projectBundle.cleanMultiline(source, 5000));
assert.deepEqual(after, before);
assert.equal(before.newlines, 3);
assert.equal(before.paragraphs, 2);
assert.equal(before.sections, 2);
assert.equal(multiline.assertEquivalent(source, normalized).sha256, before.sha256);
expectCode(() => multiline.assertEquivalent(source, source.replace(/\r?\n/g, ' ')), 'BRIEF_READBACK_MISMATCH');

const view = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/briefView.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/story-ad/workspace.css'), 'utf8');
assert(view.includes('assertBriefReadback(payload.brief'));
assert(css.includes('.brief-screenplay-input'));
assert(css.includes('white-space: pre-wrap'));

console.log('story-ad domain isolation and multiline brief contract: ok');
