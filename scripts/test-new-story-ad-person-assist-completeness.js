#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.DB_ENABLED = '0';

const service = require('../src/services/newStoryAd/storyAdService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const subjectProfileText = require('../src/services/newStoryAd/subjectProfileTextService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
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
  const confirmationSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/auto-save-confirmation.js'), 'utf8');
  assert.match(source, /function completePersonSpecSuggestion\(/);
  assert.match(source, /const completedSuggestion = completePersonSpecSuggestion\(suggestion, current, fallback\)/);
  assert.match(source, /applyPersonSpecSuggestion\(completedSuggestion\)/);
  assert.match(source, /function completeSceneSpecSuggestion\(/);
  assert.match(source, /const nextSpec = completeSceneSpecSuggestion\(suggestion, currentSpec, fallbackSpec\)/);
  assert.match(source, /label: '正在补齐全部人物设置…',\s*timeoutMs: 120000,/);
  assert.match(source, /channel: 'person_assist'/);
  assert.match(source, /channel: 'scene_assist'/);
  assert.match(source, /showGlobalProgress: false/);
  assert.match(progressSource, /补齐内容已写入下方本人物字段/);
  assert.match(source, /percentAlreadyShown \|\| snap\.indeterminate \? ''/);
  assert.match(source, /refreshProfileValidation\?\.\(/);
  assert.match(source, /const waitForAutoSave = /);
  assert.match(confirmationSource, /async function wait\(/);
  assert.match(source, /await waitForAutoSave\(saveVersion\)/);
}

/** 回归：单人档案已经被 AI 细化后，旧的全局通用字段不得在重渲染时覆盖它。 */
function testDetailedProfileSurvivesReconcile() {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/subject-assets-ui.js'), 'utf8');
  const sandbox = { window: { NewStoryAdPersonAgeAuthority: { apply() {} } } };
  vm.runInNewContext(source, sandbox);
  const ui = sandbox.window.NewStoryAdSubjectAssetsUI;
  const state = {
    castProfiles: [{
      id: 'cast_1',
      displayName: '林悦',
      roleName: '门窗产品体验者',
      age: 'adult_30_40',
      appearanceText: '35岁东亚女性，鹅蛋脸，暖米色肤色，眉眼舒展，身形修长，气质从容可信。',
      wardrobeText: '雾蓝色针织上衣、暖白色阔腿裤、米色低跟鞋和小号银色耳钉。',
      hairMakeupText: '深棕色低发髻，轻薄自然底妆，裸粉色唇妆。',
      negativeText: '禁止金发、香槟色长裙和参考片真人身份复制。',
    }],
  };
  ui.reconcileProfiles(state, {
    castMode: 'single',
    expectedPeople: '1',
    appearanceText: '30-40岁成熟青年年龄感，原创、可信、符合当前产品定位的自然外观',
    wardrobeText: '根据当前品牌与真实场景重新设计的原创服装，不复刻原片',
    hairMakeupText: '自然真实的发型和妆造',
    negativeText: '禁止复制真人身份',
  });
  assert.match(state.castProfiles[0].appearanceText, /鹅蛋脸/);
  assert.match(state.castProfiles[0].wardrobeText, /雾蓝色针织上衣/);
  assert.match(state.castProfiles[0].hairMakeupText, /深棕色低发髻/);
  assert.doesNotMatch(state.castProfiles[0].appearanceText, /符合当前产品定位/);
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
  assert(validation.innerHTML.includes('人物数量和必填信息完整'));
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
  let saveConfirmed = false;
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
    onChanged: async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      saveConfirmed = true;
    },
  });
  assert.equal(changed, true);
  assert.equal(capturedRequest.timeoutMs, 120000);
  assert.equal(capturedRequest.showGlobalProgress, false, '单人物补齐只能显示人物卡内状态，不得复用全局百分比进度');
  assert.equal(capturedRequest.exclusive, false);
  assert.equal(capturedRequest.channel, 'person_assist');
  assert.equal(capturedRequest.editDomain, 'person');
  assert.ok(renderedStatuses.includes('running'), '请求期间必须留下可见的进行中状态');
  assert.equal(state.subjectAssistStatus[1].status, 'success');
  assert.match(state.subjectAssistStatus[1].message, /已完善并保存 6 项/);
  assert.strictEqual(saveConfirmed, true, 'success feedback must wait for server save confirmation');
  assert.equal(state.castProfiles[0].displayName, '林悦', '不得改写其他人物');
  assert.equal(state.petProfiles[0].name, '雪球', '不得改写宠物');
}

/** 回归：参考视频投影的非空创作方向不是最终档案，AI 必须细化它们并保留用户字段。 */
async function testReferenceDirectionsAreEnrichedWithoutOverwritingUserFields() {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/subject-profile-assist.js'), 'utf8');
  let capturedRequest = null;
  const sandbox = {
    document: {},
    window: {
      NewStoryAdSubjectAssetsUI: {
        syncProfileFieldsFromDom() {},
        normalizeHumanProfile(profile = {}, index = 0) {
          return {
            ...profile,
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
          capturedRequest = request;
          return {
            cast_profiles: [{
              id: 'reference_cast_1',
              displayName: '林悦',
              roleName: '产品体验与展示角色',
              appearanceText: '30-40岁东亚女性，鹅蛋脸与清晰下颌线，眉眼舒展、鼻唇比例自然；中等身高与匀称体型，肩背挺直；暖调自然肤色保留细微纹理，目光专注，神态成熟可信。',
              wardrobeText: 'AI 不应覆盖这条用户服装。',
              hairMakeupText: '深棕色齐肩直发，三七分缝并自然收于耳后；轻薄自然底妆、柔和眉形与低饱和豆沙唇色；固定佩戴银色细框眼镜，不佩戴帽子和夸张耳饰。',
              negativeText: '禁止改变年龄、性别、脸型和五官比例；禁止更换发型、发色、眼镜或妆容；禁止改变服装、鞋和配饰；不要网红脸、塑料皮肤、夸张表情或多余人物。',
            }],
            assist_subject_target: { kind: 'human', index: 0, id: 'reference_cast_1' },
            assist_replaceable_fields: ['appearanceText', 'hairMakeupText', 'negativeText'],
          };
        },
      },
    },
  };
  vm.runInNewContext(source, sandbox);
  const userWardrobe = '用户指定：米白色亚麻西装外套、深灰直筒长裤、黑色低跟鞋和银色腕表。';
  const state = {
    personSpecSource: { kind: 'reference_video', manualOverride: false },
    castProfiles: [{
      id: 'reference_cast_1',
      displayName: '林悦',
      roleName: '产品体验与展示角色',
      appearanceText: '原创、可信、符合当前产品定位的自然外观，不复制原片真人',
      wardrobeText: userWardrobe,
      hairMakeupText: '发型和妆造符合当前角色、场景与表观年龄，保持自然真实',
      negativeText: '禁止人脸身份复刻、原片服装复制和私密属性推断',
      field_authority: {
        appearanceText: 'reference_direction',
        wardrobeText: 'user',
        hairMakeupText: 'system_default',
        negativeText: 'reference_safety',
      },
      user_edited_fields: ['wardrobeText'],
    }],
    petProfiles: [],
  };
  let saveConfirmed = false;
  const changed = await sandbox.window.NewStoryAdSubjectProfileAssist.assistHumanProfile({
    state,
    index: 0,
    api: async () => ({}),
    buildPayload: () => ({ brief: '门窗品牌剧情广告' }),
    collectSpec: () => ({ castMode: 'single' }),
    renderAll() {},
    setBusy() {},
    setButtonBusy() {},
    toast() {},
    onChanged: async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      saveConfirmed = true;
    },
  });
  assert.equal(changed, true);
  assert.deepStrictEqual(
    Array.from(capturedRequest.body.assist_replaceable_fields),
    ['appearanceText', 'hairMakeupText', 'negativeText'],
  );
  assert.match(state.castProfiles[0].appearanceText, /鹅蛋脸/);
  assert.equal(state.castProfiles[0].wardrobeText, userWardrobe, '用户手动服装不得被 AI 覆盖');
  assert.equal(state.castProfiles[0].field_authority.appearanceText, 'ai_generated');
  assert.equal(state.castProfiles[0].field_authority.wardrobeText, 'user');
  sandbox.window.NewStoryAdSubjectProfileAssist.recordManualEdit(state, {
    dataset: { nsaSubjectKind: 'cast', nsaSubjectIndex: '0', nsaSubjectField: 'roleName' },
  });
  assert.equal(state.castProfiles[0].field_authority.roleName, 'user');
  assert.ok(state.castProfiles[0].user_edited_fields.includes('roleName'));
}

/** 回归：生产中的参考方向模板不得通过详细人物设定质量门槛。 */
function testDetailedProfileQualityRejectsReferenceDirections() {
  const generic = {
    appearanceText: '30-40岁成熟青年年龄感，原创、可信、符合当前产品定位的自然外观，不复制原片真人',
    wardrobeText: '根据当前品牌与真实场景重新设计的原创服装，不复刻原片',
    hairMakeupText: '自然真实的发型与妆容，严格匹配人物外貌、年龄和职业气质',
    negativeText: '禁止人脸身份复刻、原片服装复制和私密属性推断',
  };
  const rejected = subjectProfileText.assistedProfileQuality(generic);
  assert.equal(rejected.valid, false);
  assert.deepStrictEqual(rejected.issues.sort(), subjectProfileText.ASSIST_DETAIL_FIELDS.slice().sort());

  const detailed = {
    appearanceText: '30-40岁东亚女性，鹅蛋脸与清晰下颌线，眉眼舒展、鼻唇比例自然；中等身高与匀称体型，肩背挺直；暖调自然肤色保留细微纹理，目光专注，神态成熟可信。',
    wardrobeText: '固定穿米白色亚麻西装外套与浅灰真丝内搭，下装为深灰色高腰直筒长裤，搭配黑色低跟皮鞋；佩戴银色细框眼镜和小尺寸腕表，不增加其它配饰，全部镜头保持相同材质与色彩。',
    hairMakeupText: '深棕色齐肩直发，三七分缝并自然收于耳后；轻薄自然底妆、柔和眉形与低饱和豆沙唇色；固定佩戴银色细框眼镜，不佩戴帽子和夸张耳饰。',
    negativeText: '禁止改变年龄、性别、脸型和五官比例；禁止更换发型、发色、眼镜或妆容；禁止改变服装、鞋和配饰；不要网红脸、塑料皮肤、夸张表情或多余人物。',
  };
  assert.equal(subjectProfileText.assistedProfileQuality(detailed).valid, true);
}

/** 回归：字段来源与用户手动编辑标记必须跨越请求标准化，供后端保护用户内容。 */
function testFieldAuthoritySurvivesContextNormalization() {
  const context = contextBuilder.buildContext({
    brief: '都市家居产品体验剧情广告',
    cast_profiles: [{
      id: 'reference_cast_1',
      displayName: '林悦',
      roleName: '产品体验与展示角色',
      appearanceText: '参考视频提供的创作方向',
      wardrobeText: '用户明确指定的米白色棉麻套装',
      hairMakeupText: '系统默认发型方向',
      negativeText: '参考安全约束',
      field_authority: {
        displayName: 'reference_fact',
        roleName: 'reference_fact',
        appearanceText: 'reference_direction',
        wardrobeText: 'user',
        hairMakeupText: 'system_default',
        negativeText: 'reference_safety',
      },
      user_edited_fields: ['wardrobeText'],
    }],
  }, { id: 'test-user' });
  assert.deepStrictEqual(context.cast_profiles[0].field_authority, {
    displayName: 'reference_fact',
    roleName: 'reference_fact',
    appearanceText: 'reference_direction',
    wardrobeText: 'user',
    hairMakeupText: 'system_default',
    negativeText: 'reference_safety',
  });
  assert.deepStrictEqual(context.cast_profiles[0].user_edited_fields, ['wardrobeText']);
}

/** 回归：历史参考任务按实际继承值迁移来源，不把后来生成或手改的详细字段误标为可覆盖。 */
function testLegacyReferenceAuthorityMigrationUsesLineage() {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/state-sync.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  const migrate = sandbox.window.NewStoryAdStateSync.migrateReferenceProfileAuthority;
  const genericAppearance = '30-40岁成熟青年年龄感，原创、可信、符合当前产品定位的自然外观，不复制原片真人';
  const genericWardrobe = '根据当前品牌与真实场景重新设计的原创服装，不复刻原片';
  const detailedWardrobe = '用户指定的米白色棉麻西装、深灰长裤和黑色低跟鞋';
  const migrated = migrate([{
    appearanceText: genericAppearance,
    wardrobeText: detailedWardrobe,
  }], {
    appearanceText: genericAppearance,
    wardrobeText: genericWardrobe,
  }, {
    kind: 'reference_video',
    manualOverride: false,
  });
  assert.equal(migrated[0].field_authority.appearanceText, 'reference_direction');
  assert.equal(migrated[0].field_authority.wardrobeText, undefined, '与继承值不同的详细服装必须保留');
  const manual = migrate([{ appearanceText: genericAppearance }], {
    appearanceText: genericAppearance,
  }, {
    kind: 'manual',
    manualOverride: true,
  });
  assert.equal(manual[0].field_authority, undefined, '手动权威任务不得迁移为参考方向');
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
          appearanceText: '八岁东亚男孩，圆脸和柔和下颌线，明亮黑色眼睛与自然眉形；身高中等、体型健康匀称，站姿活泼；自然暖调肤色保留儿童肤质，目光好奇，笑容真实不过度。',
          wardrobeText: '固定穿蓝白条纹棉质短袖上衣，下装为卡其色直筒短裤，搭配白色低帮运动鞋；不佩戴首饰、帽子或手表，服装颜色、材质和版型在全部镜头中保持一致。',
          hairMakeupText: '固定自然黑色短发，侧分并保留轻微蓬松纹理；儿童自然肤质，不使用明显妆容；全部镜头均不佩戴帽子、眼镜、发带或其它发饰。',
          negativeText: '禁止改变年龄、性别、圆脸和眼睛比例；禁止更换短发、发色或增加眼镜；禁止改变条纹上衣、卡其短裤、白鞋和配饰；不要塑料皮肤、夸张表情或多余人物。',
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
    assert.match(capturedRequest.userPrompt, /允许生成或重写的字段只有/);
    assert.equal(typeof capturedRequest.validateText, 'function');
    assert.equal(capturedRequest.validateText(JSON.stringify({
      cast_profiles: [{
        id: 'cast_2',
        displayName: '小杰',
        roleName: '儿子',
        appearanceText: '原创可信的自然外观，不复制原片真人',
        wardrobeText: '根据品牌重新设计原创服装',
        hairMakeupText: '自然真实的发型与妆容',
        negativeText: '禁止复制原片人物',
      }],
    })), false, '泛泛的参考方向必须被模型响应质量门拒绝');
    assert.equal(capturedRequest.validateText(capturedRequest ? JSON.stringify({
      cast_profiles: [{
        id: 'cast_2',
        displayName: '小杰',
        roleName: '儿子',
        appearanceText: '八岁东亚男孩，圆脸和柔和下颌线，明亮黑色眼睛与自然眉形；身高中等、体型健康匀称，站姿活泼；自然暖调肤色保留儿童肤质，目光好奇，笑容真实不过度。',
        wardrobeText: '蓝白横条纹棉质圆领短袖上衣，搭配卡其色直筒棉质短裤；白色低帮运动鞋配浅灰短袜；不戴项链、手表和帽子，固定使用轻便黑色儿童眼镜。',
        hairMakeupText: '自然黑色短发，侧分发缝，耳侧与后颈修剪整齐；儿童素颜肤质，不使用成人彩妆；固定佩戴黑色儿童眼镜，不佩戴帽子、耳饰和发带。',
        negativeText: '禁止改变年龄、性别、圆脸五官与儿童体型；禁止改变黑色短发、眼镜与素颜状态；禁止替换蓝白上衣、卡其短裤、白鞋的款式和颜色；禁止塑料皮肤、网红脸、成人化妆容与多余人物。',
      }],
    }) : ''), true, '可直接生成人物资产的详细描述必须通过质量门');

    await assert.rejects(
      () => service.assistBrief({ ...body, assist_subject_target: { kind: 'human', index: 8, id: 'missing' } }, { id: 'test-user' }),
      error => error.code === 'ASSIST_SUBJECT_TARGET_INVALID',
    );
    assert.strictEqual(calls, 1, 'invalid scoped target must fail before the text model call');

    const protectedBody = {
      ...body,
      person_context: { spec_source: { kind: 'reference_video', manualOverride: false } },
      cast_profiles: [{
        ...body.cast_profiles[1],
        displayName: '小杰',
        roleName: '儿子',
        wardrobeText: '用户指定：深蓝色棉质圆领上衣、卡其色短裤和白色运动鞋。',
        field_authority: {
          displayName: 'reference_fact',
          roleName: 'reference_fact',
          wardrobeText: 'user',
        },
        user_edited_fields: ['wardrobeText'],
      }],
      assist_subject_target: { kind: 'human', index: 0, id: 'cast_2' },
      assist_replaceable_fields: ['appearanceText', 'wardrobeText', 'hairMakeupText', 'negativeText'],
    };
    await service.assistBrief(protectedBody, { id: 'test-user' });
    assert.deepStrictEqual(
      capturedRequest.userPrompt.match(/允许生成或重写的字段只有：([^；]+)/)?.[1].split('、'),
      ['appearanceText', 'hairMakeupText', 'negativeText'],
      '后端必须过滤客户端伪造的可覆盖字段，保护用户手动服装',
    );
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
  const nestedBusinessBoundary = '环境：城市中的现代建筑，建筑有多层阳台、绿色植被屋顶，背景为城市天际线和山脉；空间布局：以下是逐帧分析及总结： 1. 时间点 0.3 秒；广告主体：现代多层住宅；配备大玻璃全景幕墙窗。';
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
          source_facts: {
            product_or_service: raw,
            environment: raw,
            materials: [raw],
            colors: [raw],
            layout: raw,
            lighting: raw,
            chronological_story: [
              `0.3—27.16 秒：${raw}`,
              `36.11—62.97 秒：${rawSecond}`,
            ],
          },
          story_outline: {
            opening: `0.3—27.16 秒：${raw}`,
            development: `0.3—27.16 秒：${raw}`,
            resolution: `36.11—62.97 秒：${rawSecond}`,
          },
          scene_prompts: [
            { layout_prompt: raw, material_light_prompt: raw },
            { layout_prompt: rawSecond, material_light_prompt: rawSecond },
          ],
        },
      },
    },
    outputs: [
      { kind: 'context', payload: { scene_spec: { layoutText: raw, materialLightText: raw } } },
      { kind: 'scene_config', payload: { business_boundary: nestedBusinessBoundary } },
      { kind: 'asset_plan', payload: { scene_plan: { business_boundary: nestedBusinessBoundary } } },
    ],
  };
  const once = assistContentRepair.repairTaskBundle(bundle);
  const twice = assistContentRepair.repairTaskBundle(once);
  assert.deepStrictEqual(twice, once, '任务修复重复执行不得继续改变数据');
  assert.equal((once.task.request.person_spec.appearanceText.match(/成熟青年年龄感/g) || []).length, 1);
  assert.ok(!once.task.request.scene_spec.layoutText.includes('逐帧分析'));
  assert.ok(!once.outputs[0].payload.scene_spec.materialLightText.includes('逐帧分析'));
  assert.doesNotMatch(once.outputs[1].payload.business_boundary, /逐帧分析|时间点\s*0\.3\s*秒/);
  assert.match(once.outputs[1].payload.business_boundary, /城市中的现代建筑/);
  assert.doesNotMatch(once.outputs[2].payload.scene_plan.business_boundary, /逐帧分析|时间点\s*0\.3\s*秒/);
  assert.equal(once.task.request.reference_video_analysis.source_facts.product_or_service, '全景幕墙窗');
  assert.doesNotMatch(
    JSON.stringify(once.task.request.reference_video_analysis.source_facts.chronological_story),
    /逐帧分析|时间点/,
  );
  assert.equal(
    once.task.request.reference_video_analysis.story_outline.opening,
    once.task.request.reference_video_analysis.source_facts.chronological_story[0],
  );
  assert.equal(
    once.task.request.reference_video_analysis.story_outline.resolution,
    once.task.request.reference_video_analysis.source_facts.chronological_story[1],
  );
  assert.match(once.task.request.reference_video_analysis.scene_prompts[1].layout_prompt, /室内窗边/);
  assert.match(once.task.request.reference_video_analysis.scene_prompts[1].layout_prompt, /薄纱窗帘/);
}

/** 按顺序运行人物辅助补齐专项回归。 */
async function main() {
  testPartialModelResponseIsCompleted();
  testExistingUserDetailsArePreserved();
  testRepeatedAgeDescriptionIsCollapsedIdempotently();
  testFrontendCompletenessGuardIsWired();
  testDetailedProfileSurvivesReconcile();
  testSubjectProfileValidationRefreshesAfterEditingName();
  testGeneratedActorAgeConstraintDoesNotDowngrade();
  await testSinglePersonAssistHasPersistentFeedback();
  await testReferenceDirectionsAreEnrichedWithoutOverwritingUserFields();
  testDetailedProfileQualityRejectsReferenceDirections();
  testFieldAuthoritySurvivesContextNormalization();
  testLegacyReferenceAuthorityMigrationUsesLineage();
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
