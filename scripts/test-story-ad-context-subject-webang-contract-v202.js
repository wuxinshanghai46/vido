'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const settings = require('../src/services/settingsService');
const profileText = require('../src/services/newStoryAd/subjectProfileTextService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const providerAdapters = require('../src/services/newStoryAd/providerAdapterRegistry');
const pipelineModels = require('../src/services/pipelineModelService');
const assistProfiles = require('../src/services/newStoryAd/assistSubjectProfileService');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');

async function main() {
  const ui = read('public/story-ad/views/assetCenterView.js');
  const validation = ui.slice(ui.indexOf('function generationValidation'), ui.indexOf('\nfunction assetCard'));
  assert.match(ui, /store\.runStage\('person-plan', payload\)/, '人物主按钮必须先走真实人物规划链路');
  assert.doesNotMatch(validation, /族裔|发型\/妆造|至少需要一套完整造型/, '前端不得用 AI 可补齐字段阻断请求');

  const route = read('src/routes/newStoryAd/personPlanGenerationRoute.js');
  const planCall = route.indexOf('service.updatePersonPlan');
  const permitCall = route.indexOf("generationPermit.issue(req.params.id, 'subject_assets'", planCall);
  const visualCall = route.indexOf('generateAndCommitSubjectAssets({ body:', permitCall);
  assert(planCall < permitCall, '必须先文本规划再签发图片许可');
  assert(permitCall < visualCall, '图片许可必须在付费调用前消费');

  const robot = {
    displayName: '小安', roleName: '陪伴机器人',
    appearanceText: '身高1.2米、低重心圆角壳体骨架，乳白陶瓷涂层与铝合金材质，头部双镜头传感器和蓝色显示屏，四肢比例和轮廓始终一致。',
    wardrobeText: '外壳上有乳白护板和深灰关节驱动组，橡胶轮缘，背部挂载可拆卸急救配件和充电接口，蓝色色带配色与铝合金材质不变。',
    hairMakeupText: '头部面板固定双目镜头传感器阵列，顶部拾音天线，蓝色指示灯带以明暗变化显示交互表情。',
    negativeText: '禁止改变壳体结构和关节比例；禁止材质、颜色涂层和磨损状态漂移；禁止增减传感器、灯带、面板接口或出现多余零件与文字。',
  };
  assert.equal(profileText.subjectKind(robot), 'robot');
  assert.deepEqual(profileText.assistedProfileQuality(robot).issues, [], '机器人必须使用机械主体详细合同');
  assert.equal(profileText.subjectKind({ displayName: '陈默', roleName: '当代青年' }), 'human');
  assert.deepEqual(
    assistProfiles.contextEraIssues({ wardrobeText: '古代汉服襦裙与玉簪' }, { brief: '当代青年与陪伴机器人的海边故事' }, { profile: robot }),
    ['unsupported_historical_context'], '现代机器人项目必须拒绝无来源古代模板',
  );
  assert.deepEqual(
    assistProfiles.contextEraIssues({ wardrobeText: '古装发髻转换为现代西装与运动鞋' }, { brief: '同一人物从古代穿越到现代' }, { profile: { roleName: '穿越者' } }),
    [], '当前任务明确跨时代时必须保留古今双方证据',
  );
  assert.deepEqual(
    assistProfiles.contextEraIssues({ wardrobeText: '办公室西装、运动鞋和手机' }, { brief: '明代侠客的古代山林故事' }, { profile: { roleName: '侠客' } }),
    ['unsupported_modern_context'], '古代项目必须拒绝无来源现代职场模板',
  );

  const preset = settings.PROVIDER_PRESETS['webang-maas'];
  assert.equal(preset.api_url, 'https://tk.iserviceapi.com/api/v1', '微众 MaaS 必须使用生产基地址');
  assert.equal(settings.PROVIDER_PRESETS['webang-seedance'].api_url, 'https://tk.iserviceapi.com/api', '微众 Seedance 必须使用生产基地址');
  const ids = new Set(preset.defaultModels.map(model => model.id));
  ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-image-2', 'claude-opus-5', 'gemini-3.5-flash',
    'gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview'].forEach(id => assert(ids.has(id), `微众模型清单缺少 ${id}`));
  const claude = preset.defaultModels.find(model => model.id === 'claude-opus-5');
  assert.equal(claude.enabled, false, 'Claude 未签约前必须默认禁用');
  const imageConfig = settings.PROVIDER_ADAPTER_DEFAULTS['webang-maas'].adapter_config.image;
  assert.equal(imageConfig.generation_endpoint, '/images/generations');
  assert.equal(imageConfig.edit_endpoint, '/images/edits');
  assert.equal(imageConfig.gemini_chat_endpoint, '/chat/completions');
  assert.equal(imageConfig.edit_image_field, 'image[]');
  assert.equal(imageConfig.reference_images, true);
  assert.equal(imageConfig.input_fidelity, false);
  const stageModels = pipelineModels.getStageDefaults('new_story_ad.assist');
  ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gemini-3.5-flash', 'claude-opus-5']
    .forEach(id => assert(stageModels.some(model => model.provider_id === 'webang-maas' && model.model_id === id), `调用管理缺少 ${id}`));

  let textPayload;
  await providerAdapters.callOpenAICompatible(
    { family: 'webang-maas', providerId: 'webang-maas', modelId: 'gpt-5.6-terra', apiKey: 'test-only', baseURL: 'https://example.invalid/v1' },
    'system', 'user', { maxTokens: 2048, _client: { chat: { completions: { create: async payload => {
      textPayload = payload;
      return { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: {} };
    } } } } },
  );
  assert.equal(textPayload.max_completion_tokens, 2048, 'GPT-5.6 必须使用 max_completion_tokens');
  assert(!Object.hasOwn(textPayload, 'max_tokens'), 'GPT-5.6 不得发送 max_tokens');
  assert(!Object.hasOwn(textPayload, 'temperature'), 'GPT-5.6 不得默认发送未确认支持的 temperature');

  const generation = mediaAdapter.buildWebangGptImage2GenerationBody({ modelId: 'gpt-image-2' }, { prompt: '原创机器人', size: '1024x1536' });
  assert.deepEqual(Object.keys(generation).sort(), ['model', 'n', 'prompt', 'quality', 'size']);
  assert.equal(generation.quality, 'high');
  assert.equal(generation.size, '1024x1536');

  const fixtureName = `webang-contract-${process.pid}.png`;
  const fixturePath = path.join(mediaAdapter.ASSET_DIR, fixtureName);
  fs.mkdirSync(mediaAdapter.ASSET_DIR, { recursive: true });
  fs.writeFileSync(fixturePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9mAAAAAASUVORK5CYII=', 'base64'));
  try {
    const providerReference = await mediaAdapter.providerReferenceImageUrl(`/api/new-story-ad/assets/${fixtureName}`, 960);
    assert.match(providerReference, /\/api\/new-story-ad\/assets\/[^?]+\?thumb=960$/, '本地原始参考图必须转换为轻量 WebP 公网地址');
    assert(fs.existsSync(mediaAdapter.assetThumbPathFromName(fixtureName, 960)), '必须在调用厂商前生成参考图缩略图');
    const form = await mediaAdapter.buildWebangGptImage2EditForm(
      { modelId: 'gpt-image-2' },
      { prompt: '保持结构修改灯光', size: '1024x1024', referenceImages: [`/api/new-story-ad/assets/${fixtureName}`] },
    );
    const body = form.getBuffer().toString('latin1');
    ['model', 'prompt', 'size', 'quality', 'image[]'].forEach(field => assert(body.includes(`name="${field}"`), `edits multipart 缺少 ${field}`));
    assert.match(form.getHeaders()['content-type'], /^multipart\/form-data; boundary=/);
    assert(!body.includes('name="images"'), '微众 edits 不得发送 DeyunAI JSON images 字段');
  } finally {
    fs.rmSync(fixturePath, { force: true });
    fs.rmSync(mediaAdapter.assetThumbPathFromName(fixtureName, 960), { force: true });
  }

  const digitalHuman = read('src/routes/digitalHuman.js');
  assert.match(digitalHuman, /message\.images/);
  assert.match(digitalHuman, /image_url/);
  console.log('PASS story-ad context subject + Weizhong MaaS contract v202');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
