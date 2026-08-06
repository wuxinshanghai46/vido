'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const authority = require('../src/services/newStoryAd/briefAuthorityService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const productResolver = require('../src/services/newStoryAd/productAssetResolverService');
const briefAssist = require('../src/services/newStoryAd/briefGoalAssistService');

const sourceBrief = '现代和古代交替，两个时代各有一位女孩；核心场景是一个女孩子在竹海漫步，按故事剧情推进，不含商品。';
const context = contextBuilder.buildContext({ brief: sourceBrief, product_subject: '' });

assert.equal(context.content_mode, 'narrative_story', '无明确商品的故事必须进入纯剧情模式');
assert.equal(context.product_subject, '', '纯剧情不得伪造商品主体');
assert.equal(context.product_presentation.mode, 'narrative_story');
assert.equal(context.product_presentation.standalone_generation_supported, false);
assert.equal(context.cast_mode, 'dual', '现代/古代交替默认是双人物模式');
assert.equal(context.expected_people, 2, '现代/古代交替必须规划两个独立人物');
assert.deepEqual(authority.explicitSceneRequirements(sourceBrief), ['竹海']);

const selectedStory = contextBuilder.buildContext({
  content_mode: 'narrative_story',
  brief: '宣传产品卖点，但用户已经明确选择剧情模式。',
  product_subject: '',
});
assert.equal(selectedStory.content_mode, 'narrative_story', '显式选择剧情必须高于文本关键词自动判断');
assert.equal(selectedStory.product_subject, '', '剧情模式且无真实商品时不得制造商品主体');
const selectedAd = contextBuilder.buildContext({
  content_mode: 'commercial_subject',
  brief: '一个女孩在竹海漫步。',
  product_subject: '东方香氛',
});
assert.equal(selectedAd.content_mode, 'commercial_subject', '显式选择广告必须进入商业主体方案');
assert.equal(selectedAd.product_subject, '东方香氛');
const legacyInferredStory = contextBuilder.buildContext({
  content_mode: 'narrative_story',
  product_presentation: { mode: 'narrative_story', source: 'user_story_brief' },
  brief: '参考视频完成后识别出商品。',
  product_subject: '定制家具套装',
  reference_video_analysis: { source_facts: { product_or_service: '定制家具套装' } },
});
assert.equal(legacyInferredStory.content_mode, 'commercial_subject', '旧版本自动推断的剧情值不得压过后来识别出的明确商品证据');
assert.equal(legacyInferredStory.content_mode_source, 'inferred');

const prompt = contextBuilder.contextPrompt(context);
assert.match(prompt, /纯剧情 \/ 故事主题/);
assert.match(prompt, /精确人数：2/);
assert.match(prompt, /明确场景硬约束：竹海/);
assert.doesNotMatch(prompt, /广告主体：待明确/);

const samePerson = contextBuilder.buildContext({ brief: '同一个女孩穿越，在现代和古代交替出现，并在竹海中漫步。' });
assert.notEqual(samePerson.cast_mode, 'dual', '用户明确同一人物时不得强拆为两人');

const commercial = contextBuilder.buildContext({ brief: '不锈钢原材料厂家要通过成品展示墙介绍材料纹理。' });
assert.equal(commercial.content_mode, 'commercial_subject', '明确厂家和材料的任务仍应按商业主体处理');
assert.equal(commercial.product_presentation.mode, 'material_surface');
const explicitProduct = productResolver.productPresentation({
  brief: '讲一个女孩在竹海漫步的故事。',
  product_subject: '东方香氛',
});
assert.notEqual(explicitProduct.mode, 'narrative_story', '显式填写产品时必须保留产品广告模式');
const referenceProduct = productResolver.productPresentation({
  brief: '参考视频已完成识别。',
  product_subject: '东方香氛',
  product_presentation: { mode: 'narrative_story', source: 'user_story_brief' },
});
assert.notEqual(referenceProduct.mode, 'narrative_story', '后续识别出的明确商品必须覆盖旧的自动纯剧情推断');

const addition = '面向喜爱东方自然美学与时间叙事的观众，强化跨时代人物关系与竹海意境带来的情绪记忆，让观众理解故事关于选择、延续与自我回应的主题，并愿意继续关注完整情节。';
const raw = JSON.stringify({ goal_addition: addition });
assert.equal(briefAssist.validateRaw(raw, context), true);
const assisted = briefAssist.buildResponse({ parsed: { goal_addition: addition }, context });
assert.equal(assisted.original_brief, sourceBrief);
assert(assisted.brief.startsWith(sourceBrief), 'AI 帮写结果必须逐字保留原始内容');
assert.match(assisted.brief, /【传播目标补充】/);
assert.equal(briefAssist.validateRaw(JSON.stringify({ goal_addition: '突出产品卖点并提升购买意愿，推动用户下单转化，强化品牌认知与销售结果，形成稳定的商品传播闭环和消费决策。' }), context), false, '纯故事不得被 AI 补成商品广告');

const goodPlan = {
  cast_profiles: [{ id: 'modern', name: '现代女孩' }, { id: 'ancient', name: '古代女孩' }],
  scene_plan: { spaces: [{ name: '竹海步道', description: '女孩在竹海漫步', scene_spec: { layoutText: '竹林与步道' } }] },
};
assert.deepEqual(authority.planAuthorityIssues(goodPlan, context), []);
assert.throws(() => authority.assertPlanAuthority({
  cast_profiles: [{ id: 'merged', name: '同一女孩' }],
  scene_plan: { spaces: [{ name: '现代书房', description: '书房', scene_spec: { layoutText: '书桌和书架' } }] },
}, context), error => error.code === 'ASSET_PLAN_USER_FACT_DRIFT' && /人物数量应为 2/.test(error.message) && /竹海/.test(error.message));

const css = read('public/story-ad/workspace.css');
const modalRule = css.match(/\.asset-primary-actions[\s\S]+?\.asset-card:hover/)?.[0] || '';
assert(modalRule, '必须找到真人资产弹窗样式');
assert.doesNotMatch(modalRule, /var\(--(?:panel|field|card|accent)\)/, '弹窗不得再使用不存在的主题变量');
assert.match(modalRule, /background:var\(--surface\)/);
assert.match(modalRule, /\.real-person-source-form input:focus/);
assert.match(modalRule, /\.story-ad-modal-open\{overflow:hidden\}/);

const briefView = read('public/story-ad/views/briefView.js');
assert.match(briefView, /name="content_mode" value="commercial_subject"/);
assert.match(briefView, /name="content_mode" value="narrative_story"/);
assert.match(briefView, /请先选择“广告”或“剧情”，再使用 AI 帮写/);
assert.match(briefView, /content_mode: payload\.content_mode/);
assert.match(briefView, /!payload\.content_mode \|\| payload\.content_mode_source !== 'user'/);
assert.match(briefView, /brief\.content_mode_source === 'user' && brief\.content_mode === 'narrative_story'/);
assert.match(css, /\.content-mode-options input:checked\+span/);

const modalSource = read('public/story-ad/views/assetCenterPersonSources.js');
assert.match(modalSource, /aria-modal/);
assert.match(modalSource, /story-ad-modal-open/);
assert.match(modalSource, /event\.key === 'Escape'/);

const blueprintSource = read('src/services/newStoryAd/blueprintService.js');
assert.match(blueprintSource, /This is a pure narrative\/story task/);
assert.match(blueprintSource, /Do not invent a product, brand, selling point, purchase prompt or conversion goal/);

console.log('story-ad brief authority v57 regression passed (4 root-cause groups)');
