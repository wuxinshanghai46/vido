#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.DB_ENABLED = '0';

const service = require('../src/services/newStoryAd/storyAdService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const subjectProfileText = require('../src/services/newStoryAd/subjectProfileTextService');
const assistContentRepair = require('./repair-new-story-ad-assist-content');

/** 验证模型只返回外貌时，后端仍会补齐全部人物一致性字段。 */
function testPartialModelResponseIsCompleted() {
  const result = service.enforceAssistedPersonSpec({
    appearanceText: '真实商业人物，神态自然。',
  }, {
    castMode: 'single',
    gender: 'female',
    age: 'adult_30_40',
    origin: 'east_asian_cn',
    roleName: '品牌形象代表',
  }, {
    brief: '为办公空间品牌制作一条真实剧情广告',
    product_subject: '办公空间品牌',
  });

  assert.equal(result.castMode, 'single');
  assert.equal(result.gender, 'female');
  assert.equal(result.age, 'adult_30_40');
  assert.equal(result.origin, 'east_asian_cn');
  assert.equal(result.roleName, '品牌形象代表');
  assert.match(result.appearanceText, /30-40岁/);
  assert.ok(result.wardrobeText.length >= 30, '服装字段必须自动补齐');
  assert.ok(result.hairMakeupText.length >= 30, '发型妆造字段必须自动补齐');
  assert.ok(result.negativeText.length >= 30, '人物禁止项必须自动补齐');
  assert.match(result.wardrobeText, /办公空间品牌/);
}

/** 验证模型漏字段时不会覆盖用户已经手动填写的人物约束。 */
function testExistingUserDetailsArePreserved() {
  const current = {
    age: 'adult_30_40',
    roleName: '品牌经理',
    wardrobeText: '用户指定：深蓝色西装外套、米色长裤和黑色低跟鞋。',
    hairMakeupText: '用户指定：齐肩直发、自然淡妆和银色细框眼镜。',
    negativeText: '用户指定：不要白衬衫；不要夸张首饰。',
  };
  const result = service.enforceAssistedPersonSpec({ appearanceText: '成熟、可信。' }, current, {});

  assert.equal(result.wardrobeText, current.wardrobeText);
  assert.equal(result.hairMakeupText, current.hairMakeupText);
  assert.equal(result.negativeText, current.negativeText);
}

/** 回归：同一年龄描述反复经过补齐必须保持幂等，不能每次再叠一遍年龄感。 */
function testRepeatedAgeDescriptionIsCollapsedIdempotently() {
  const corrupted = '30-40岁成熟青年年龄感，成熟青年年龄感，成熟青年年龄感，原创、可信、自然外观';
  const once = service.enforceAssistedPersonSpec(
    { age: 'adult_30_40', appearanceText: corrupted },
    { age: 'adult_30_40' },
    {},
  ).appearanceText;
  const twice = service.enforceAssistedPersonSpec(
    { age: 'adult_30_40', appearanceText: once },
    { age: 'adult_30_40' },
    {},
  ).appearanceText;
  assert.equal(once, twice, '年龄前缀清洗必须幂等');
  assert.equal((once.match(/成熟青年年龄感/g) || []).length, 1);
  assert.match(once, /原创、可信、自然外观/);
  assert.equal(
    subjectProfileText.alignAgeDescription(corrupted, 'adult_30_40'),
    once,
  );
}

/** 验证前端使用逐字段合并，而不是把部分响应直接当成完整结果。 */
function testFrontendCompletenessGuardIsWired() {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js'), 'utf8');
  const progressSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/assist-progress.js'), 'utf8');
  assert.match(source, /function completePersonSpecSuggestion\(/);
  assert.match(source, /const completedSuggestion = completePersonSpecSuggestion\(suggestion, current, fallback\)/);
  assert.match(source, /applyPersonSpecSuggestion\(completedSuggestion\)/);
  assert.match(source, /function completeSceneSpecSuggestion\(/);
  assert.match(source, /const nextSpec = completeSceneSpecSuggestion\(suggestion, currentSpec, fallbackSpec\)/);
  assert.match(source, /label: '正在创建 \/ 补齐全部人物档案…',\s*timeoutMs: 120000,/);
  assert.match(source, /channel: 'person_assist'/);
  assert.match(source, /channel: 'scene_assist'/);
  assert.match(source, /showGlobalProgress: false/);
  assert.match(progressSource, /补齐内容已写入下方本人物字段/);
  assert.match(source, /percentAlreadyShown \|\| snap\.indeterminate \? ''/);
  assert.match(source, /refreshProfileValidation\?\.\(/);
}

/** 回归：人物姓名写入状态后必须立即重算校验，不得继续显示旧的“缺少姓名”。 */
function testSubjectProfileValidationRefreshesAfterEditingName() {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/subject-assets-ui.js'), 'utf8');
  const sandbox = { window: { NewStoryAdPersonAgeAuthority: {} } };
  vm.runInNewContext(source, sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/subject-profile-authority.js'), 'utf8'), sandbox);
  const ui = sandbox.window.NewStoryAdSubjectAssetsUI;
  const authority = sandbox.window.NewStoryAdSubjectProfileAuthority;
  const state = {
    castProfiles: [{
      id: 'cast_1',
      displayName: '',
      roleName: '售货员',
      appearanceText: '中年女性，真实自然。',
      wardrobeText: '棉麻上衣与深色长裤。',
      hairMakeupText: '黑色短发与自然淡妆。',
    }],
    petProfiles: [],
  };
  const validation = { innerHTML: '' };
  const summary = { textContent: '' };
  const scope = {
    querySelector(selector) {
      if (selector === '[data-nsa-subject-validation]') return validation;
      if (selector === '[data-nsa-subject-summary-index="0"]') return summary;
      return null;
    },
  };
  const target = {
    dataset: { nsaSubjectKind: 'cast', nsaSubjectIndex: '0', nsaSubjectField: 'displayName' },
    value: '林妈',
  };
  assert.equal(ui.updateProfileFromField(state, target), true);
  assert.equal(authority.refreshProfileValidation(scope, state, { castMode: 'single', expectedPeople: 1 }), true);
  assert.equal(state.castProfiles[0].displayName, '林妈');
  assert.equal(state.castProfiles[0].name, '林妈');
  assert.equal(summary.textContent, '林妈');
  assert(!validation.innerHTML.includes('缺少：姓名'), '旧的姓名缺失警告必须立即消失');
  assert(validation.innerHTML.includes('逐主体档案数量和必填信息完整'));
}

function testGeneratedActorAgeConstraintDoesNotDowngrade() {
  const actorSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/actors.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(actorSource, sandbox);
  const ageValue = sandbox.window.NewStoryAdActors.ageValue;
  assert.equal(ageValue('young_adult'), 'young_adult');
  assert.equal(ageValue('25-32 years old'), 'young_adult');
  assert.equal(ageValue('二十七岁中国女性'), 'young_adult');
  assert.equal(ageValue('young_adult_17_25'), 'young_adult_17_25');
  assert.equal(ageValue('17-25 years old'), 'young_adult_17_25');
  assert.equal(ageValue('25'), '', '单独的边界数字不能覆盖已锁定年龄段');

  const legacySource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js'), 'utf8');
  assert.match(legacySource, /asset\.person_contract\?\.identity\?\.age_range/);
  assert.match(legacySource, /personAgeValue\(structuredAge \|\| \(!spec\.age \? asset\.description \|\| '' : ''\)\) \|\| spec\.age/);
}

/** 回归：按钮重渲染后仍应显示进行中/成功状态，并使用足以覆盖服务端模型等待的超时。 */
async function testSinglePersonAssistHasPersistentFeedback() {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/subject-profile-assist.js'), 'utf8');
  let capturedRequest = null;
  const renderedStatuses = [];
  const sandbox = {
    document: {},
    window: {
      NewStoryAdSubjectAssetsUI: {
        syncProfileFieldsFromDom() {},
        normalizeHumanProfile(profile = {}, index = 0) {
          return {
            id: profile.id || `cast_${index + 1}`,
            displayName: profile.displayName || '',
            roleName: profile.roleName || '',
            appearanceText: profile.appearanceText || '',
            wardrobeText: profile.wardrobeText || '',
            hairMakeupText: profile.hairMakeupText || '',
            negativeText: profile.negativeText || '',
          };
        },
      },
      NewStoryAdGenerationFlow: {
        async requestInlineGeneration(stage, context, request) {
          assert.equal(stage, 'assist_person_profile');
          capturedRequest = request;
          return {
            cast_profiles: [{
              id: 'cast_2',
              displayName: '小杰',
              roleName: '儿子',
              appearanceText: '八岁东亚男孩，圆脸，真实自然。',
              wardrobeText: '蓝白条纹短袖、卡其短裤和白色运动鞋。',
              hairMakeupText: '自然黑色短发，不佩戴帽子和眼镜。',
              negativeText: '禁止改变年龄、发型、服装、鞋和配饰。',
            }],
            assist_subject_target: { kind: 'human', index: 1, id: 'cast_2' },
          };
        },
      },
    },
  };
  vm.runInNewContext(source, sandbox);
  const state = {
    castProfiles: [
      { id: 'cast_1', displayName: '林悦', roleName: '母亲', appearanceText: '完整外貌', wardrobeText: '完整服装', hairMakeupText: '完整发型', negativeText: '完整禁止项' },
      { id: 'cast_2', displayName: '', roleName: '', appearanceText: '', wardrobeText: '', hairMakeupText: '', negativeText: '' },
    ],
    petProfiles: [{ id: 'pet_1', name: '雪球' }],
  };
  const changed = await sandbox.window.NewStoryAdSubjectProfileAssist.assistHumanProfile({
    state,
    index: 1,
    api: async () => ({}),
    buildPayload: () => ({ brief: '家庭剧情广告' }),
    collectSpec: () => ({ castMode: 'human_pet' }),
    renderAll: () => renderedStatuses.push(state.subjectAssistStatus?.[1]?.status || ''),
    setBusy() {},
    setButtonBusy() {},
    toast() {},
  });
  assert.equal(changed, true);
  assert.equal(capturedRequest.timeoutMs, 120000);
  assert.equal(capturedRequest.showGlobalProgress, false, '单人物补齐只能显示人物卡内状态，不得复用全局百分比进度');
  assert.equal(capturedRequest.exclusive, false);
  assert.equal(capturedRequest.channel, 'person_assist');
  assert.equal(capturedRequest.editDomain, 'person');
  assert.ok(renderedStatuses.includes('running'), '请求期间必须留下可见的进行中状态');
  assert.equal(state.subjectAssistStatus[1].status, 'success');
  assert.match(state.subjectAssistStatus[1].message, /已补齐 6 项/);
  assert.equal(state.castProfiles[0].displayName, '林悦', '不得改写其他人物');
  assert.equal(state.petProfiles[0].name, '雪球', '不得改写宠物');
}

/** 回归：人物和场景文本补齐使用独立通道；同一通道仍禁止重复提交。 */
async function testIndependentAssistChannels() {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/generation-flow.js'), 'utf8');
  const RuntimeDOMException = globalThis.DOMException || class DOMException extends Error {
    constructor(message = '', name = 'Error') {
      super(message);
      this.name = name;
    }
  };
  const sandbox = {
    window: { crypto: { randomUUID: (() => { let i = 0; return () => `generation-${++i}`; })() } },
    AbortController,
    DOMException: RuntimeDOMException,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, sandbox);
  const flow = sandbox.window.NewStoryAdGenerationFlow;
  const state = {
    activeGenerationId: '',
    taskSessionEpoch: 1,
    taskId: 'task-assist-channels',
    clientEditSeq: 3,
    domainEditSeq: { person: 1, scene: 2 },
  };
  let resolvePerson;
  let resolveScene;
  const person = flow.runInlineGeneration('assist_person_spec', { state }, () => new Promise(resolve => { resolvePerson = resolve; }), {
    exclusive: false, channel: 'person_assist', editDomain: 'person',
  });
  const scene = flow.runInlineGeneration('assist_scene_spec', { state }, () => new Promise(resolve => { resolveScene = resolve; }), {
    exclusive: false, channel: 'scene_assist', editDomain: 'scene',
  });
  assert.equal(Object.keys(state.inlineGenerationChannels).length, 2);
  assert.equal(state.activeGenerationId, '', '文本辅助不得占用图片/任务生成的全局锁');
  await assert.rejects(
    () => flow.runInlineGeneration('assist_person_profile', { state }, async () => ({}), {
      exclusive: false, channel: 'person_assist', editDomain: 'person',
    }),
    error => error.code === 'ASSIST_CHANNEL_ALREADY_ACTIVE',
  );
  resolvePerson({ kind: 'person' });
  assert.deepStrictEqual(await person, { kind: 'person' });
  assert.ok(state.inlineGenerationChannels.scene_assist, '人物完成不得清除场景通道');
  await assert.rejects(
    () => flow.runInlineGeneration('subject_assets', { state }, async () => ({})),
    error => error.code === 'GENERATION_ALREADY_ACTIVE',
  );
  resolveScene({ kind: 'scene' });
  assert.deepStrictEqual(await scene, { kind: 'scene' });
  assert.equal(Object.keys(state.inlineGenerationChannels).length, 0);
}

/** 验证真实 assist 服务在模型部分返回时也会输出完整人物设定。 */
async function testAssistServiceCompletesPartialResponse() {
  const originalGenerateText = modelGateway.generateText;
  let capturedRequest = null;
  modelGateway.generateText = async request => {
    capturedRequest = request;
    return ({
    text: JSON.stringify({ person_spec: { appearanceText: '成熟可信的真实商业人物。' } }),
    used_model: 'mock/partial-person-spec',
    fallback_used: false,
    failed_models: [],
    });
  };
  try {
    const response = await service.assistBrief({
      mode: 'person_spec',
      brief: '办公空间品牌剧情广告，主角是一位30-40岁女性品牌形象代表',
      product_subject: '办公空间品牌',
      person_spec: {
        castMode: 'single',
        gender: 'female',
        age: 'adult_30_40',
        origin: 'east_asian_cn',
        roleName: '品牌形象代表',
      },
    }, { id: 'test-user' });

    assert.ok(response.person_spec.appearanceText);
    assert.ok(response.person_spec.wardrobeText);
    assert.ok(response.person_spec.hairMakeupText);
    assert.ok(response.person_spec.negativeText);
    assert.equal(response.person_spec.roleName, '品牌形象代表');
    assert.match(capturedRequest.systemPrompt, /四视图固定状态规则/);
    assert.match(capturedRequest.systemPrompt, /不得使用“户外时、室内时、运动时/);
    assert.match(capturedRequest.userPrompt, /帽子、眼镜、发带等发饰和首饰始终佩戴或始终不佩戴/);
    assert.match(capturedRequest.userPrompt, /禁止四视图之间增减、更换、变色或移动/);
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
}

async function testSinglePersonAssistIsScoped() {
  const originalGenerateText = modelGateway.generateText;
  let capturedRequest = null;
  let calls = 0;
  modelGateway.generateText = async request => {
    calls += 1;
    capturedRequest = request;
    return {
      text: JSON.stringify({
        person_spec: { castMode: 'dual', expectedPeople: 2 },
        cast_profiles: [{
          id: 'cast_2',
          displayName: '小杰',
          roleName: '儿子',
          appearanceText: '东亚男孩，约八岁，圆脸，健康活泼。',
          wardrobeText: '固定穿蓝白条纹短袖、卡其短裤和白色运动鞋，不佩戴首饰。',
          hairMakeupText: '固定自然黑色短发，四视图均不佩戴帽子、眼镜或发饰。',
          negativeText: '禁止改变发型、服装、鞋和配饰。',
        }],
        pet_profiles: [],
      }),
      used_model: 'mock/scoped-person-assist',
      fallback_used: false,
      failed_models: [],
    };
  };
  const body = {
    mode: 'person_spec',
    brief: '母子与宠物在家庭和公园互动',
    cast_mode: 'human_pet',
    person_spec: { castMode: 'human_pet', expectedPeople: 2, expectedAnimals: 1 },
    cast_profiles: [
      { id: 'cast_1', displayName: '林悦', roleName: '母亲', appearanceText: '完整外貌', wardrobeText: '完整服装', hairMakeupText: '完整发型' },
      { id: 'cast_2', displayName: '', roleName: '', appearanceText: '', wardrobeText: '', hairMakeupText: '' },
    ],
    pet_profiles: [{ id: 'pet_1', name: '雪球', type: '犬', appearance: '白色蓬松犬' }],
    assist_subject_target: { kind: 'human', index: 1, id: 'cast_2' },
  };
  try {
    const response = await service.assistBrief(body, { id: 'test-user' });
    assert.strictEqual(calls, 1);
    assert.strictEqual(response.cast_profiles.length, 1);
    assert.strictEqual(response.cast_profiles[0].id, 'cast_2');
    assert.strictEqual(response.pet_profiles.length, 0);
    assert.deepStrictEqual(response.assist_subject_target, { kind: 'human', index: 1, id: 'cast_2' });
    assert.match(capturedRequest.systemPrompt, /只能输出目标人物的一条 cast_profiles 记录/);
    assert.match(capturedRequest.userPrompt, /不得返回或改写其他人物和宠物/);

    await assert.rejects(
      () => service.assistBrief({ ...body, assist_subject_target: { kind: 'human', index: 8, id: 'missing' } }, { id: 'test-user' }),
      error => error.code === 'ASSIST_SUBJECT_TARGET_INVALID',
    );
    assert.strictEqual(calls, 1, 'invalid scoped target must fail before the text model call');
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
}

/** 验证场景模型只返回一条残句时，原有四项设定不会被清空。 */
async function testSceneAssistPreservesCompleteExistingSpec() {
  const originalGenerateText = modelGateway.generateText;
  modelGateway.generateText = async () => ({
    text: JSON.stringify({ scene_spec: { layoutText: '一个现代空间，核心墙面由' } }),
    used_model: 'mock/partial-scene-spec',
    fallback_used: false,
    failed_models: [],
  });
  const current = {
    layoutText: '一个可连续拍摄的完整现代空间，入口、前景、背景、展示区和行动通路清晰，多个镜头切换后仍保持同一空间身份。',
    materialLightText: '用户指定的金属表面、色彩、纹理、反射、粗糙度和尺度保持一致，采用自然侧光与克制的商业重点光。',
    interactionText: '预留人物站位、商品展示区、可到达的互动区域以及连续镜头移动路径，场景参考保持空场景。',
    negativeText: '不要人物、文字、水印、Logo、无关装饰、材质漂移、结构变化、模块化拼板或可见接缝。',
    surfaceTopology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'uniform' },
  };
  try {
    const response = await service.assistBrief({
      mode: 'scene_spec',
      brief: '为当前产品制作真实商业空间广告',
      product_subject: '当前产品',
      scene_spec: current,
    }, { id: 'test-user' });
    assert.equal(response.scene_spec.layoutText, current.layoutText, '模型残句不得覆盖完整布局');
    assert.equal(response.scene_spec.materialLightText, current.materialLightText);
    assert.equal(response.scene_spec.interactionText, current.interactionText);
    assert.equal(response.scene_spec.negativeText, current.negativeText);
    assert.equal(response.scene_spec.surfaceTopology.mode, 'continuous');
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
}

/** 验证没有旧值时也会使用通用兜底补齐四项，而不是放行空字段。 */
function testSceneAssistFallbackIsComplete() {
  const result = service.enforceAssistedSceneSpec({ layoutText: '残句' }, {}, {
    brief: '通用产品广告',
    product_subject: '通用产品',
  });
  assert.ok(result.layoutText.length >= 30);
  assert.ok(result.materialLightText.length >= 30);
  assert.ok(result.interactionText.length >= 24);
  assert.ok(result.negativeText.length >= 24);
  assert.match(result.layoutText, /完整真实空间/);
  assert.match(result.materialLightText, /材质、色彩和光线/);
  assert.match(result.interactionText, /场景参考保持空场景/);
  assert.match(result.negativeText, /不要出现真人/);
}

function testLegacyFrameEvidenceIsNotKeptAsSceneDescription() {
  const raw = '以下是逐帧分析及总结： 1. **时间点 0.3 秒** - 产品或服务：大玻璃全景幕墙窗 - 真实环境：现代住宅客厅，窗外为城市天际线 - 材质：玻璃、木饰面和米色织物 - 颜色：米白与原木色 - 布局：窗在左侧，沙发位于右侧 - 光线：自然侧光，明亮柔和';
  const result = service.enforceAssistedSceneSpec({}, {
    layoutText: raw,
    materialLightText: raw,
    interactionText: '人物在窗边观察室外景观。',
    negativeText: '不要无关人物、文字和水印。',
  }, {}, { preserveCurrentFields: true });
  assert.ok(!result.layoutText.includes('逐帧分析'));
  assert.ok(!result.layoutText.includes('时间点'));
  assert.match(result.layoutText, /现代住宅客厅/);
  assert.match(result.layoutText, /窗在左侧/);
  assert.ok(!result.materialLightText.includes('逐帧分析'));
  assert.match(result.materialLightText, /玻璃、木饰面/);
  assert.match(result.materialLightText, /自然侧光/);
}

function testAssistContentRepairIsDeterministic() {
  const raw = '以下是逐帧分析及总结： - 产品或服务：全景幕墙窗 - 真实环境：现代住宅客厅 - 材质：透明玻璃与木饰面 - 颜色：米白与原木色 - 布局：大窗位于左侧，沙发位于右侧 - 光线：自然侧光，明亮柔和';
  const rawSecond = '以下是逐帧分析及总结： - 产品或服务：薄纱窗帘 - 真实环境：室内窗边 - 材质：半透明织物 - 颜色：米白色 - 布局：窗帘位于画面中央 - 光线：自然逆光';
  const bundle = {
    task: {
      id: 'repair-fixture',
      request: {
        person_spec: {
          age: 'adult_30_40',
          appearanceText: '30-40岁成熟青年年龄感，成熟青年年龄感，成熟青年年龄感，真实自然',
        },
        scene_spec: { layoutText: raw, materialLightText: raw },
        reference_video_analysis: {
          source_facts: { product_or_service: raw, environment: raw, materials: [raw], colors: [raw], layout: raw, lighting: raw },
          scene_prompts: [
            { layout_prompt: raw, material_light_prompt: raw },
            { layout_prompt: rawSecond, material_light_prompt: rawSecond },
          ],
        },
      },
    },
    outputs: [{ kind: 'context', payload: { scene_spec: { layoutText: raw, materialLightText: raw } } }],
  };
  const once = assistContentRepair.repairTaskBundle(bundle);
  const twice = assistContentRepair.repairTaskBundle(once);
  assert.deepStrictEqual(twice, once, '任务修复重复执行不得继续改变数据');
  assert.equal((once.task.request.person_spec.appearanceText.match(/成熟青年年龄感/g) || []).length, 1);
  assert.ok(!once.task.request.scene_spec.layoutText.includes('逐帧分析'));
  assert.ok(!once.outputs[0].payload.scene_spec.materialLightText.includes('逐帧分析'));
  assert.equal(once.task.request.reference_video_analysis.source_facts.product_or_service, '全景幕墙窗');
  assert.match(once.task.request.reference_video_analysis.scene_prompts[1].layout_prompt, /室内窗边/);
  assert.match(once.task.request.reference_video_analysis.scene_prompts[1].layout_prompt, /薄纱窗帘/);
}

/** 按顺序运行人物辅助补齐专项回归。 */
async function main() {
  testPartialModelResponseIsCompleted();
  testExistingUserDetailsArePreserved();
  testRepeatedAgeDescriptionIsCollapsedIdempotently();
  testFrontendCompletenessGuardIsWired();
  testSubjectProfileValidationRefreshesAfterEditingName();
  testGeneratedActorAgeConstraintDoesNotDowngrade();
  await testSinglePersonAssistHasPersistentFeedback();
  await testIndependentAssistChannels();
  testSceneAssistFallbackIsComplete();
  testLegacyFrameEvidenceIsNotKeptAsSceneDescription();
  testAssistContentRepairIsDeterministic();
  await testAssistServiceCompletesPartialResponse();
  await testSinglePersonAssistIsScoped();
  await testSceneAssistPreservesCompleteExistingSpec();
  console.log('剧情广告人物/场景辅助补齐完整性：全部测试通过');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
