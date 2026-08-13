'use strict';

const assert = require('assert');
const packs = require('../src/services/newStoryAd/capabilityPackService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');

const commercial = packs.resolve({ content_mode: 'commercial_subject', content_form: 'commercial_live_action', industry_profile: 'consumer_goods' });
assert.strictEqual(commercial.story_structure_id, 'commercial_problem_proof_action');
assert.strictEqual(commercial.scene_prototype_id, 'physical_evidence_space');
assert(commercial.industry_profile.evidence_types.includes('product_identity'));

const story = packs.resolve({ content_mode: 'narrative_story', content_form: 'narrative_live_action', industry_profile: 'generic' });
assert.strictEqual(story.story_structure_id, 'causal_character_arc');
assert(story.story_structure.forbidden.includes('sales_conversion'));

const comic = packs.resolve({ content_mode: 'narrative_story', content_form: 'comic', industry_profile: 'generic' });
assert.strictEqual(comic.content_form_id, 'comic_narrative');
assert.strictEqual(comic.scene_prototype_id, 'stylized_story_world');
assert(comic.content_form.required_final_proofs.includes('panel_readability'));

assert.throws(
  () => packs.resolve({ content_mode: 'commercial_subject', content_form: 'comic_narrative' }),
  error => error.code === 'CONTENT_FORM_MODE_CONFLICT',
);
assert.throws(
  () => packs.resolve({ content_mode: 'commercial_subject', industry_profile: 'hardcoded_unknown_industry' }),
  error => error.code === 'INDUSTRY_PROFILE_INVALID',
);

const commercialContext = contextBuilder.buildContext({
  content_mode: 'commercial_subject', content_mode_source: 'user', content_form: 'commercial_live_action',
  industry_profile: 'technology', brief: '展示一套经用户确认的软件工作流', product_subject: '工作流软件', cast_mode: 'no_human',
});
assert.strictEqual(commercialContext.capability_pack.industry_profile_id, 'technology');
assert.strictEqual(commercialContext.capability_pack.content_form.content_mode, commercialContext.content_mode);

const storyContext = contextBuilder.buildContext({
  content_mode: 'narrative_story', content_mode_source: 'user', content_form: 'narrative_live_action',
  brief: '两位朋友跨越多年重逢的故事', cast_mode: 'dual',
});
assert.strictEqual(storyContext.capability_pack.story_structure_id, 'causal_character_arc');

const comicContext = contextBuilder.buildContext({
  content_mode: 'narrative_story', content_mode_source: 'user', content_form: 'comic_narrative',
  production_mode: 'comic_narrative', brief: '原创漫剧角色寻找回家道路', cast_mode: 'single',
});
assert.strictEqual(comicContext.capability_pack.scene_prototype_id, 'stylized_story_world');
assert.strictEqual(comicContext.production_mode, 'comic_narrative');
const prompt = contextBuilder.contextPrompt(comicContext);
assert(prompt.includes('漫剧/动画剧情'));
assert(prompt.includes('panel_causal_arc'));
assert(prompt.includes('行业提示只能补充用户事实'));

const registry = packs.readRegistry();
assert.strictEqual(Object.keys(registry.content_forms).length, 3);
assert.strictEqual(Object.keys(registry.industry_profiles).length >= 4, true);
console.log(JSON.stringify({
  passed: true,
  content_forms: Object.keys(registry.content_forms),
  industries: Object.keys(registry.industry_profiles),
  commercial_story_comic_shared_service: true,
  hardcoded_industry_rejected: true,
}));
