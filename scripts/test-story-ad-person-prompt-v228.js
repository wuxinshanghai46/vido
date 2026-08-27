const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const promptService = require('../src/services/newStoryAd/personGenerationPromptService');
const projection = require('../src/services/newStoryAd/blueprintCharacterProjectionService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const subjectBundle = require('../src/services/newStoryAd/subjectAssetBundleService');
const propProjection = require('../src/services/storyAdWorkspace/personOwnedPropProjectionService');
const runtimeContract = require('../src/services/newStoryAd/personGenerationRuntimeContractService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');

const base = {
  id: 'char_chenmo', displayName: '陈默', roleName: '背景出镜人物', gender: '女性', age: '25岁',
  appearanceText: '25岁女性，短发，面部轮廓清晰，气质安静克制',
  wardrobeText: '固定穿紫色晚礼服、黑色高跟鞋与银色耳钉',
  hairMakeupText: '黑色齐肩短发，淡妆',
  performanceText: '旧服装为白色针织衫和灰色长裤；不介绍身份，承担触摸、走过、驻足等画面动作',
  continuityText: '全部视图保持同一人物、同一服装与同一配饰',
  negativeText: '不得出现文字、水印和多余人物',
};

const fallback = promptService.fallbackPrompt(base);
['名称：陈默', '描述：', '服装：固定穿紫色晚礼服', '发型妆造：', '特征：', '随身道具：无', '构图规范：', '视觉限制：', '视觉风格：'].forEach(label => {
  assert(fallback.includes(label), `历史人物提示词缺少 ${label}`);
});
assert(!fallback.includes('白色针织衫'), '旧表演字段里的过期服装不得泄漏到最终提示词');
assert(fallback.includes('触摸、走过、驻足'), '剧情动作必须保留到人物特征');

const withProp = promptService.project({ ...base, owned_props: [{ id: 'phone', name: '黑色手机', description: '磨砂黑色，屏幕关闭', material: '铝合金与玻璃', scale: '掌心尺寸' }] });
assert(withProp.generation_prompt.includes('随身道具：黑色手机，磨砂黑色，屏幕关闭，铝合金与玻璃，掌心尺寸'));
assert.equal(withProp.generation_settings.model, 'gpt-image-2');
assert.equal(withProp.generation_settings.quality, 'standard');
assert.equal(withProp.generation_settings.resolution, '2K');
assert.equal(withProp.generation_settings.generation_type, 'three_view');
assert.deepEqual(propProjection.ownedProps(withProp, {}, [], 0).map(prop => prop.name), ['黑色手机']);

const runtime = runtimeContract.inspect({ look_count: 1 }, { mediaAdapter: {
  requiredImageModelForStage: () => 'gpt-image-2',
  availableImageCandidates: () => ['smscrw', 'webang-maas', 'deyunai'].map(provider_id => ({ provider_id, model_id: 'gpt-image-2' })),
} });
assert.equal(runtime.model_label, 'GPT Image 2');
assert.deepEqual(runtime.aspect_ratios, ['1:1', '3:2', '3:4']);
assert.equal(runtime.estimated_provider_calls, 6);
assert.equal(runtime.expected_output_assets, 22);
assert.equal(runtime.available_route_count, 3);
const compactRuntime = runtimeContract.inspect({ look_count: 1, generation_settings: { generation_type: 'three_view' } }, { mediaAdapter: {
  requiredImageModelForStage: () => 'gpt-image-2',
  availableImageCandidates: () => ['smscrw', 'webang-maas', 'deyunai'].map(provider_id => ({ provider_id, model_id: 'gpt-image-2' })),
} });
assert.equal(compactRuntime.estimated_provider_calls, 3);
assert.equal(compactRuntime.expected_output_assets, 5);
assert.equal(mediaAdapter.sizeFor({ provider: { adapter_config: { image: {} } } }, '3:2'), '1536x1024', '人物动作与表情的 3:2 合同必须形成横向供应商请求');

const modelPrompt = '名称：陈默\n\n描述：模型已完成描述\n\n服装：紫色晚礼服\n\n发型妆造：短发淡妆\n\n特征：自然驻足\n\n随身道具：无\n\n构图规范：专业人物设定图\n\n视觉限制：无文字水印\n\n视觉风格：电影级写实';
const projected = projection.projectCharacters({ cast_profiles: [base] }, {
  characters: [{ id: 'char_chenmo', name: '陈默', role: '背景出镜人物', age_range: '25岁', generation_prompt: modelPrompt, owned_props: [] }],
});
assert.equal(projected.cast_profiles[0].generation_prompt, modelPrompt, '蓝图模型生成的完整提示词必须原样跨层保存换行');
assert.equal(projected.cast_profiles[0].generation_prompt_source, 'blueprint_model');

const normalized = contextBuilder.normalizeCharacter({ ...base, generation_prompt: modelPrompt, owned_props: [] }, 0);
assert.equal(normalized.generation_prompt, modelPrompt, '上下文标准化不得压平完整提示词');
assert.deepEqual(normalized.owned_props, []);

const member = subjectBundle.humanMemberSpecs({}, { cast_profiles: [{ ...base, generation_prompt: modelPrompt }] }, 1)[0];
const providerPrompt = subjectBundle.humanPrompt(member, 1);
assert(providerPrompt.includes(modelPrompt), '人物图片生成必须使用用户看到的最终提示词');
assert(!providerPrompt.includes('白色针织衫'), '权威最终提示词存在时不得混入历史分散字段');
assert.equal(subjectBundle.personProfileResumeCompatible(
  { ...base, negativeText: '禁止文字；禁止水印；禁止多余人物' },
  { ...base, negativeText: '禁止文字；禁止水印' },
), true, '只移除旧负面限制时必须复用已付费成功资产');

const casualPrompt = promptService.fallbackPrompt({
  ...base, active_look_id: 'casual', wardrobeText: '米白亚麻衬衫与直筒长裤',
  look_profiles: [{ id: 'formal', wardrobeText: '黑色晚礼服' }, { id: 'casual', wardrobeText: '米白亚麻衬衫与直筒长裤' }],
});
assert(casualPrompt.includes('米白亚麻衬衫') && !casualPrompt.includes('黑色晚礼服'), '多造型人物必须按当前造型独立编译提示词');

const form = read('public/story-ad/views/assetCenterPersonForm.js');
const planning = read('public/story-ad/views/assetCenterPlanningDetails.js');
const view = read('public/story-ad/views/assetCenterView.js');
const projectBundle = read('src/services/storyAdWorkspace/projectBundleService.js');
assert(form.includes('name="generation_prompt"') && form.includes('runtime.model_label') && form.includes('runtime.aspect_ratios')
  && form.includes('estimated_provider_calls') && form.includes('expected_output_assets') && form.includes('available_route_count'));
assert(form.includes('name="generation_type"') && form.includes('name="quality"') && form.includes('name="resolution"'),
  '人物工具栏必须提供生成类型、画质和模型真实支持的清晰度');
assert(!form.includes('renderPersonLookEditors') && !form.includes('renderPersonEvolutionEditor'), '人物界面必须是单一提示词编辑面');
assert(!planning.includes('data-owned-prop-form') && !planning.includes('由模型生成道具'), '不得再渲染独立随身道具表单');
assert(view.includes("generation_prompt_source: 'user'") && view.includes('item.profile = savedProfile'), '保存后必须用服务器回读结果进入定向生成');
assert(view.includes('generation_settings') && view.includes('count: 1'),
  '人物设置必须与提示词一起保存，且单组数量固定为 1');
assert(projectBundle.includes('generation_runtime: personGenerationRuntime.inspect'), '人物详情必须投影服务端实时生成合同');

console.log(JSON.stringify({ passed: true, assertions: 46, props_empty: true, props_present: true, stale_wardrobe_blocked: true, negative_rebase_safe: true, multi_look_isolated: true, single_prompt_ui: true, runtime_contract: { provider_calls: 6, output_assets: 22, routes: 3 } }));
