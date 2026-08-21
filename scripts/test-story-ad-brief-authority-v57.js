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
assert.equal(context.cast_mode, 'dual', '用户明确两个时间层各有一位人物时必须保留双人物模式');
assert.equal(context.expected_people, 2, '显式人物数量证据必须规划两个独立人物');
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
const autoSelectedAd = contextBuilder.buildContext({
  content_mode: 'commercial_subject',
  content_mode_source: 'user',
  brief: '为 LibTV 流媒体服务制作一支面向年轻家庭的广告。',
  product_subject: '',
});
assert.equal(autoSelectedAd.product_subject, 'LibTV 流媒体服务', '隐藏广告主体后必须从用户内容自动提取');
assert.equal(productResolver.isResolvedSubject('面向年轻家庭'), false, '目标受众不得被误识别为广告主体');
const genericAd = contextBuilder.buildContext({
  content_mode: 'commercial_subject',
  content_mode_source: 'user',
  brief: '广告的核心目标是传达产品。',
  product_subject: '广告的核心目标是传达产品',
});
assert.equal(productResolver.isResolvedSubject(genericAd.product_subject), false, '泛化目标句不得被当成真实广告主体');
assert.equal(productResolver.inferredSubject({
  content_mode: 'commercial_subject',
  content_mode_source: 'user',
  brief: '制作一支广告。',
  reference_video_analysis: { source_facts: { product_or_service: '产品' } },
}), '待明确的展示主体', '参考视频返回的泛化主体也必须被统一拦截');
assert.throws(
  () => productResolver.assertCommercialSubject(genericAd),
  error => error.code === 'COMMERCIAL_SUBJECT_REQUIRED' && /没有调用模型/.test(error.message),
  '无法识别广告主体时必须在模型调用前阻止',
);
assert.throws(
  () => briefAssist.assertInput(genericAd, genericAd),
  error => error.code === 'ASSIST_AD_SUBJECT_REQUIRED' && /没有调用文本模型/.test(error.message),
  'AI 帮写必须在付费文本模型前拦截主体不明确的广告',
);
assert.doesNotThrow(() => productResolver.assertCommercialSubject(selectedStory), '纯剧情不得要求广告主体');
assert.doesNotThrow(() => briefAssist.assertInput(selectedStory, selectedStory), '剧情帮写不得要求广告主体');
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
const ambiguousParallel = contextBuilder.buildContext({ brief: '两个时间层交替推进，在同一条河流旁呈现不同阶段的变化。' });
assert.notEqual(ambiguousParallel.cast_mode, 'dual', '只有并行结构但没有人物数量证据时不得擅自写死双人物');

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
const storyDraft = {
  detailed_summary: '现代女孩在竹海中发现古代女孩留下的信物，循着不同年代的生活痕迹理解一段未完成的选择。两条时间线通过同一片竹海相互回应，最终让现代女孩决定正视自己的困境并迈出新的一步。',
  participants: [{ name: '现代女孩', role: '当代行动者', description: '通过追寻信物理解前人的选择。' }, { name: '古代女孩', role: '历史线人物', description: '以留下的痕迹回应后来的陌生人。' }],
  scenes: [{ name: '竹海步道', time: '现代与古代交错', description: '同一空间承接两条时间线。' }],
  story_sections: [{ title: '发现', content: '现代女孩在竹海发现信物，并对其来历产生疑问。' }, { title: '回应', content: '古代线揭示信物背后的选择，现代女孩获得面对现实的勇气。' }],
  closing: addition,
};
const raw = JSON.stringify(storyDraft);
assert.equal(briefAssist.validateRaw(raw, context), true);
const assisted = briefAssist.buildResponse({ parsed: storyDraft, context });
assert.equal(assisted.original_brief, sourceBrief);
assert.doesNotMatch(assisted.brief, /【原始创作需求】/, '原始输入必须单独保留，不得重复塞入用户可编辑的扩写正文');
assert.match(assisted.brief, /【详细剧情描述】/);
assert.match(assisted.brief, /【出场人物】/);
assert.match(assisted.brief, /【主要场景】/);
assert.match(assisted.brief, /【剧情段落】/);
assert.equal(assisted.screenplay_structure_version, 2);
assert.match(briefAssist.systemRule(context), /纯剧情任务/);
assert.match(briefAssist.systemRule(context), /人物、场景和剧情段落必须服务于人物关系、事件、情绪与主题/);
assert.doesNotMatch(briefAssist.modePrompt(context), /广告传播目标/);
assert.match(briefAssist.outputSchema(context), /详细剧情描述/);
assert.equal(briefAssist.validateRaw(JSON.stringify({ ...storyDraft, closing: '突出产品卖点并提升购买意愿，推动用户下单转化，强化品牌认知与销售结果，形成稳定的商品传播闭环和消费决策。' }), context), false, '纯故事不得被 AI 补成商品广告');

const commercialAddition = '面向注重日常情绪体验的年轻职场人群，围绕东方香氛的自然气味与放松体验建立清晰认知，以真实使用时刻支撑核心价值，引导观众进一步了解产品并形成可信的品牌记忆。';
assert.match(briefAssist.systemRule(selectedAd), /广告任务/);
assert.match(briefAssist.modePrompt(selectedAd), /广告剧本帮写/);
assert.match(briefAssist.systemRule(selectedAd), /不得编造功效、价格、资质、品牌背书或不可验证事实/);
assert.match(briefAssist.outputSchema(selectedAd), /广告剧情概述/);
const adDraft = {
  detailed_summary: '年轻职场人在工作间隙需要从紧张状态中短暂抽离，东方香氛通过真实使用动作和自然气味联想进入日常空间，帮助建立可感知的放松体验，并以继续了解产品完成收束。',
  participants: [{ name: '年轻职场人', role: '使用者', description: '展示真实的工作间隙与使用过程。' }, { name: '东方香氛', role: '展示主体', description: '通过产品外观和使用动作承接核心价值。' }],
  scenes: [{ name: '办公室休息区', time: '午后', description: '承载使用前后的情绪变化。' }],
  story_sections: [{ title: '需求', content: '年轻职场人在连续工作后进入休息区，建立短暂放松的真实需求。' }, { title: '体验', content: '她使用东方香氛并回到稳定状态，产品通过可见动作自然出现。' }],
  closing: commercialAddition,
};
const assistedAd = briefAssist.buildResponse({ parsed: adDraft, context: selectedAd });
assert.match(assistedAd.brief, /【广告剧情概述】/);
assert.match(assistedAd.brief, /【出场人物 \/ 展示主体】/);
assert.doesNotMatch(assistedAd.brief, /【详细剧情描述】/);

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
const briefFormPayload = read('public/story-ad/views/briefFormPayload.js');
assert.match(briefView, /<select class="select" name="content_mode" required>/);
assert.match(briefView, /<option value="commercial_subject"/);
assert.match(briefView, /<option value="narrative_story"/);
assert.match(briefView, /请先选择“广告”或“剧情”，再使用 AI 帮写/);
assert.match(briefView, /content_mode: payload\.content_mode/);
assert.match(briefView, /!payload\.content_mode \|\| payload\.content_mode_source !== 'user'/);
assert.match(briefView, /brief\.content_mode_source === 'user' && brief\.content_mode === 'narrative_story'/);
assert.ok(briefView.indexOf('name="project_name"') < briefView.indexOf('name="content_mode"'), '内容类型必须位于项目名称下方');
assert.ok(briefView.indexOf('name="content_mode"') < briefView.indexOf('name="brief"'), '必须先选择内容类型，再填写内容目标');
assert.ok(briefView.indexOf('id="brief-settings-modal-title">手动编辑全部设置</h2>') < briefView.indexOf('id="brief-optional-settings-title">参考材料与识别信息</b>'), '手动设置弹窗必须包含当前参考材料与识别信息区');
assert.match(briefView, /renderAdvancedReferenceControls\(bundle, route\.isNew\)/, '当前参考材料与识别控件必须由正式高级设置模块渲染');
assert.equal((briefView.match(/name="product_subject"/g) || []).length, 0, '自动识别广告主体后不得继续显示手工输入框');
assert.match(briefFormPayload, /product_subject:\s*''/, '正式表单载荷不得把旧主体值重新覆盖自动识别结果');
assert.match(briefView, /promptDialog\(isStory \? 'AI 帮写剧情内容' : 'AI 帮写广告内容'/);
assert.match(briefView, /multiline: true/);
assert.match(briefView, /if \(idea === null\) return;/, '取消帮写弹窗必须在模型请求前退出');
assert.ok(briefView.indexOf('if (idea === null) return;') < briefView.indexOf("request('/api/new-story-ad/assist'"), '取消分支必须早于付费模型请求');
assert.match(briefView, /content_mode: payload\.content_mode/);
assert.match(briefView, /content_mode_source: 'user'/);
assert.match(briefView, /latest\.content_mode_source === 'user' \? \(latest\.content_mode \|\| ''\) : ''/, '推断模式不得在订阅刷新后伪装成用户选择');
assert.doesNotMatch(css, /\.content-mode-options/, '旧双卡片内容类型样式必须删除');

const dialogSource = read('public/story-ad/components/dialog.js');
assert.match(dialogSource, /options\.multiline \? '<textarea/);
assert.match(dialogSource, /event\.ctrlKey \|\| event\.metaKey/);
assert.match(dialogSource, /textarea:not\(\[disabled\]\)/, '多行输入必须纳入焦点循环');

const modalSource = read('public/story-ad/views/assetCenterPersonSources.js');
assert.match(modalSource, /aria-modal/);
assert.match(modalSource, /story-ad-modal-open/);
assert.match(modalSource, /event\.key === 'Escape'/);

const blueprintSource = read('src/services/newStoryAd/blueprintService.js');
assert.match(blueprintSource, /This is a pure narrative\/story task/);
assert.match(blueprintSource, /Do not invent a product, brand, selling point, purchase prompt or conversion goal/);

console.log('story-ad brief authority v57 regression passed (4 root-cause groups)');
