'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const gateway = require('../src/services/newStoryAd/modelGateway');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');

const candidates = gateway.diversifyTextCandidates([
  { provider_id: 'apismile', model_id: 'gpt-5.5' },
  { provider_id: 'apismile', model_id: 'gemini-2.5-pro' },
  { provider_id: 'apismile', model_id: 'gemini-2.5-flash' },
  { provider_id: 'aiapi', model_id: 'deepseek-chat' },
  { provider_id: 'deyunai', model_id: 'gemini-2.5-pro' },
]);
assert.deepEqual(candidates.slice(0, 3).map(item => item.provider_id), ['apismile', 'aiapi', 'deyunai']);

const brief = '男主沈星河与女主苏月在古代相爱。苏月死后，沈星河服药活过千年到现代，在现代樱花林遇见苏月的转生女孩。';
const context = contextBuilder.buildContext({
  brief,
  content_mode: 'narrative_story', content_mode_source: 'user',
  cast_mode: 'dual', expected_people: 2,
  narrative_identity_count: 2, planning_cast_count: 2, visual_asset_count: 2,
});
assert.equal(context.planning_cast_count, 3, '前世双主角 + 现代转生者必须规划为三个剧情身份');
assert.equal(context.narrative_identity_count, 3);

const source = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/briefNarrativeRecognition.js'), 'utf8')
  .replace(/\bexport\s+/g, '');
const sandbox = {};
vm.runInNewContext(`${source}\nglobalThis.tested={narrativeRecognition};`, sandbox);
const preview = sandbox.tested.narrativeRecognition(brief);
assert.equal(preview.mixed, true);
assert.equal(preview.samePerson, true);
assert.equal(preview.reincarnation, true);
assert(preview.lines.some(line => line.includes('稳定人物身份 ID')));
assert(preview.lines.some(line => line.includes('新的独立身份')));

const css = fs.readFileSync(path.join(__dirname, '../public/story-ad/production-v202.css'), 'utf8');
assert.match(css, /\.brief-screenplay-input\s*\{[\s\S]*max-height:\s*none;[\s\S]*overflow-y:\s*hidden;/);
assert.match(css, /\.brief-recognition-preview/);

console.log('story-ad v208 cross-era recognition, provider diversity and continuous form: ok');
