#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-subject-scene-plan-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const service = require('../src/services/newStoryAd/storyAdService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const sceneBinding = require('../src/services/newStoryAd/sceneBindingService');

function viewAsset(name, prefix) {
  return {
    name,
    image_url: `/assets/${prefix}-front.png`,
    view_images: ['front', 'side', 'back', 'action'].map(key => ({
      key,
      url: `/assets/${prefix}-${key}.png`,
    })),
  };
}

function fullSpec(marker) {
  return {
    layoutText: `${marker} 完整空间布局包含稳定入口、前后景、行动通路和可复用边界。`,
    materialLightText: `${marker} 使用地点专属材质、统一色温、明确自然光方向与真实商业拍摄质感。`,
    interactionText: `${marker} 保留可到达的人物与宠物互动区、商品展示位和连续机位。`,
    negativeText: `${marker} 禁止混入另一个地点、无关结构、人物、文字、水印和材质漂移。`,
  };
}

function loadFrontendModules() {
  const controls = new Map();
  const modeControl = { value: 'auto', classList: { toggle() {} }, dataset: {} };
  const scope = {
    querySelector(selector) {
      if (selector === '#dhNsaAdSceneMode') return modeControl;
      if (!controls.has(selector)) controls.set(selector, {
        value: '',
        classList: { toggle() {} },
        dataset: {},
        closest() { return null; },
      });
      return controls.get(selector);
    },
    querySelectorAll() { return []; },
  };
  const sandbox = {
    window: {},
    document: { querySelector: () => scope, getElementById: () => scope },
    requestAnimationFrame: callback => callback(),
    setInterval,
    clearInterval,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/subject-assets-ui.js'), 'utf8'),
    sandbox,
    { filename: 'subject-assets-ui.js' },
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/scene-assets.js'), 'utf8'),
    sandbox,
    { filename: 'scene-assets.js' },
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/task-persistence.js'), 'utf8'),
    sandbox,
    { filename: 'task-persistence.js' },
  );
  return { sandbox, scope, controls, modeControl };
}

async function testStructuredSceneAssistAndPersistence() {
  const originalGenerateText = modelGateway.generateText;
  modelGateway.generateText = async () => ({
    text: JSON.stringify({
      scene_plan: {
        scene_mode: 'multi',
        spaces: [
          { id: 'space_park', name: '城市公园草坪', description: '户外公园', story_purpose: '活力互动', scene_spec: fullSpec('PARK_ONLY') },
          { id: 'space_home', name: '家庭客餐厅', description: '住宅空间', story_purpose: '狗粮用餐', scene_spec: fullSpec('HOME_ONLY') },
        ],
      },
    }),
    used_model: 'mock/scene-plan',
    fallback_used: false,
    failed_models: [],
  });
  try {
    const response = await service.assistBrief({
      mode: 'scene_spec',
      brief: '先在城市公园草坪互动，再回到家庭客餐厅喂狗粮。',
      product_subject: '宠物狗粮',
      scene_mode: 'auto',
    }, { id: 'scene-plan-user' });
    assert.strictEqual(response.scene_plan.scene_mode, 'multi');
    assert.deepStrictEqual(response.scene_plan.spaces.map(space => space.id), ['space_park', 'space_home']);
    assert(response.scene_plan.spaces[0].scene_spec.layoutText.includes('PARK_ONLY'));
    assert(response.scene_plan.spaces[1].scene_spec.layoutText.includes('HOME_ONLY'));
    assert(!response.scene_plan.spaces[0].scene_spec.layoutText.includes('HOME_ONLY'));

    modelGateway.generateText = async () => ({
      text: JSON.stringify({
        scene_plan: {
          scene_mode: 'single',
          spaces: [
            {
              id: 'space_1',
              name: '模型临时返回的单场景',
              scene_spec: fullSpec('HOME_RECOMPILED'),
            },
          ],
        },
      }),
      used_model: 'mock/scoped-scene-plan',
      fallback_used: false,
      failed_models: [],
    });
    const scopedResponse = await service.assistBrief({
      mode: 'scene_spec',
      brief: '只重新补齐家庭客餐厅，不得改动公园。',
      scene_plan: response.scene_plan,
      target_space_id: 'space_home',
      scene_spec: response.scene_plan.spaces[1].scene_spec,
    }, { id: 'scene-plan-user' });
    assert.deepStrictEqual(
      scopedResponse.scene_plan.spaces.map(space => space.id),
      ['space_park', 'space_home'],
      '单场景重编译不得把权威双场景计划替换成模型临时 space_1',
    );
    assert(scopedResponse.scene_plan.spaces[0].scene_spec.layoutText.includes('PARK_ONLY'));
    assert(scopedResponse.scene_plan.spaces[1].scene_spec.layoutText.includes('HOME_RECOMPILED'));
    assert(scopedResponse.scene_spec.layoutText.includes('HOME_RECOMPILED'), '兼容 scene_spec 必须返回本次目标空间而不是固定首空间');

    const taskId = 'scene-plan-autosave';
    const base = {
      brief: '先在城市公园草坪互动，再回到家庭客餐厅喂狗粮。',
      product_subject: '宠物狗粮',
      scene_mode: 'auto',
      scene_spec: fullSpec('LEGACY_MIXED'),
      cast_mode: 'human_pet',
      expected_people: 2,
      expected_animals: 1,
    };
    storage.createTask({ id: taskId, title: 'scene plan autosave', request: base });
    storage.saveOutput(taskId, 'context', base);
    storage.saveOutput(taskId, 'scene_config', { scene_mode: 'single', spaces: [{ id: 'old_space', name: '旧空间', scene_spec: fullSpec('OLD') }] });
    storage.saveOutput(taskId, 'scene_assets', [{ scene_id: 'old_space', image_url: '/old.png' }]);
    service.updateTaskRequest(taskId, {
      ...base,
      scene_mode: 'multi',
      scene_spec: response.scene_plan.spaces[0].scene_spec,
      scene_plan: response.scene_plan,
      change_scope: 'scene',
      save_progress: true,
      progress_stage: 'scene_config_done',
      progress_snapshot: { scene_config: response.scene_plan },
    }, { id: 'scene-plan-user' });
    const stored = storage.getOutput(taskId, 'scene_config');
    assert.strictEqual(stored.scene_mode, 'multi', '显式新场景计划必须在失效清理后仍被持久化');
    assert.strictEqual(stored.spaces.length, 2);
    assert.strictEqual(storage.getOutput(taskId, 'scene_assets'), null, '旧场景资产必须随场景修订失效');

    const cachedClientTaskId = 'scene-plan-cached-client';
    storage.createTask({ id: cachedClientTaskId, title: 'cached client plan save', request: base });
    storage.saveOutput(cachedClientTaskId, 'context', base);
    storage.saveOutput(cachedClientTaskId, 'scene_config', response.scene_plan);
    service.updateTaskRequest(cachedClientTaskId, {
      ...base,
      scene_mode: 'multi',
      scene_spec: response.scene_plan.spaces[0].scene_spec,
      change_scope: 'scene',
      save_progress: true,
      progress_stage: 'scene_config_done',
      progress_snapshot: { scene_config: response.scene_plan },
    }, { id: 'scene-plan-user' });
    const cachedClientStored = storage.getOutput(cachedClientTaskId, 'scene_config');
    assert.strictEqual(cachedClientStored?.scene_mode, 'multi', '旧缓存客户端即使漏传顶层 scene_plan，也不得把快照中的双场景删除');
    assert.strictEqual(cachedClientStored?.spaces?.length, 2);

    const invalidSaveTaskId = 'scene-plan-missing-contract';
    storage.createTask({ id: invalidSaveTaskId, title: 'missing plan save', request: base });
    storage.saveOutput(invalidSaveTaskId, 'context', base);
    storage.saveOutput(invalidSaveTaskId, 'scene_config', response.scene_plan);
    assert.throws(
      () => service.updateTaskRequest(invalidSaveTaskId, {
        ...base,
        scene_mode: 'single',
        change_scope: 'scene',
        save_progress: true,
        progress_stage: 'scene_config_done',
        progress_snapshot: {},
      }, { id: 'scene-plan-user' }),
      error => error.code === 'SCENE_PLAN_REQUIRED_FOR_SCENE_SAVE',
      '场景变更没有权威场景计划时必须在任何持久化和失效清理之前拒绝',
    );
    assert.strictEqual(storage.getOutput(invalidSaveTaskId, 'scene_config')?.spaces?.length, 2, '被拒绝的场景保存不得破坏原场景合同');

    assert.throws(
      () => sceneBinding.resolveSceneGenerationTarget({
        sceneConfig: {},
        context: { scene_mode: 'single', scene_spec: fullSpec('FORM_ONLY') },
        body: { space_id: 'space_1', scene_id: 'space_1', scene_spec: fullSpec('FORM_ONLY') },
      }),
      error => error.code === 'SCENE_PLAN_REQUIRED_FOR_GENERATION',
      '没有持久化逐空间场景计划时必须在图片模型调用前停止',
    );
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
}

async function testFrontendSaveUsesOneAuthoritativeScenePlan() {
  const { sandbox } = loadFrontendModules();
  const plan = {
    scene_mode: 'multi',
    spaces: [
      { id: 'space_park', name: '公园', scene_spec: fullSpec('PARK_SAVE') },
      { id: 'space_home', name: '家庭', scene_spec: fullSpec('HOME_SAVE') },
    ],
  };
  const state = {
    taskId: 'frontend-scene-save',
    pendingChangeScope: 'scene',
    pendingMediaChange: 'none',
    sceneConfig: plan,
    scenePlanSelectedIndex: 1,
    sceneAssets: [],
    castProfiles: [],
    petProfiles: [],
    shots: [],
    contracts: [],
    keyframes: [],
    videoClips: [],
  };
  let submittedBody = null;
  await sandbox.window.NewStoryAdTaskPersistence.saveCurrentTaskProgress({ silent: true, render: false }, {
    state,
    payload: () => ({ brief: '双场景前端保存测试', change_scope: state.pendingChangeScope }),
    api: async (_url, options) => {
      submittedBody = options.body;
      return { outputs: { scene_config: plan } };
    },
    normalizeBundle() {},
  });
  assert.strictEqual(submittedBody.scene_plan.scene_mode, 'multi', '线上主保存模块必须提交唯一权威 scene_plan，不能只依赖通用进度快照');
  assert.strictEqual(submittedBody.progress_snapshot, undefined, '浏览器不得再携带可能覆盖服务器新产物的通用进度快照');
  assert.deepStrictEqual(
    submittedBody.scene_plan.spaces.map(space => space.id),
    ['space_park', 'space_home'],
    '唯一权威 scene_plan 必须保留全部空间身份，不能只保存当前编辑项',
  );
}

function testUnifiedLazySubjectGallery() {
  const { sandbox } = loadFrontendModules();
  const ui = sandbox.window.NewStoryAdSubjectAssetsUI;
  const personAsset = {
    cast_assets: [viewAsset('林悦', 'lin'), viewAsset('小杰', 'jie')],
  };
  const pets = [viewAsset('雪球', 'snow')];
  assert.strictEqual(ui.subjectMembers(viewAsset('单人', 'single'), []).length, 1);
  assert.strictEqual(ui.subjectMembers(personAsset, []).length, 2);
  assert.strictEqual(ui.subjectMembers(personAsset, pets).length, 3);
  assert.strictEqual(ui.subjectMembers(null, pets).length, 1);
  const html = ui.subjectGalleryHtml(personAsset, pets, {
    escapeHtml: value => String(value),
    assetThumbUrl: (url, width) => `${url}?thumb=${width}`,
  });
  assert.strictEqual((html.match(/data-nsa-subject-gallery(?:\s|>)/g) || []).length, 3, '双人和宠物必须各有独立四视图入口');
  assert.strictEqual((html.match(/data-src=/g) || []).length, 12, '三套四视图必须全部可查看');
  assert.strictEqual((html.match(/<img src=/g) || []).length, 3, '首屏只能加载每个主体一张主图');
  assert(html.includes('林悦') && html.includes('小杰') && html.includes('雪球'));

  const openKeys = new Set();
  const stablePerson = { ...viewAsset('林悦', 'lin'), actor_id: 'lin' };
  const stableKey = ui.subjectGalleryKey('person', stablePerson, 0);
  const lazyImages = [
    { dataset: { src: '/assets/lin-front.png' }, src: '' },
    { dataset: { src: '/assets/lin-side.png' }, src: '' },
  ];
  const label = { textContent: '' };
  const gallery = {
    open: false,
    dataset: { nsaSubjectGalleryKey: stableKey },
    querySelectorAll: selector => selector === 'img[data-src]' ? lazyImages : [],
  };
  const toggle = {
    closest: selector => selector === '[data-nsa-subject-gallery-toggle]' ? toggle : (selector === '[data-nsa-subject-gallery]' ? gallery : null),
    setAttribute(name, value) { this[name] = value; },
    querySelector: selector => selector === '[data-nsa-subject-gallery-label]' ? label : null,
  };
  const galleryHost = { contains: value => value === toggle };
  assert.strictEqual(ui.handleGalleryClick({ target: toggle }, galleryHost, null, openKeys), true);
  assert.strictEqual(openKeys.has(stableKey), true, '展开状态必须按稳定主体 ID 写入页面状态');
  assert.strictEqual(toggle['aria-expanded'], 'true');
  assert.strictEqual(label.textContent, '收起四视图');
  assert(lazyImages.every(image => image.src && !Object.prototype.hasOwnProperty.call(image.dataset, 'src')), '展开时只能加载当前主体的懒加载图片');
  const openedHtml = ui.subjectGalleryHtml(stablePerson, [], {
    escapeHtml: value => String(value),
    assetThumbUrl: value => value,
    openKeys,
  });
  assert.match(openedHtml, /data-nsa-subject-gallery-key="person:lin" open>/, '人物区重渲染后必须恢复展开状态');
  assert.match(openedHtml, /aria-expanded="true"><span[^>]*>收起四视图<\/span>/);
  gallery.open = true;
  assert.strictEqual(ui.handleGalleryClick({ target: toggle }, galleryHost, null, openKeys), true);
  assert.strictEqual(openKeys.has(stableKey), false, '用户主动收起后不得被后续重渲染再次展开');
  const closedHtml = ui.subjectGalleryHtml(stablePerson, [], {
    escapeHtml: value => String(value),
    assetThumbUrl: value => value,
    openKeys,
  });
  assert.doesNotMatch(closedHtml, /data-nsa-subject-gallery-key="person:lin" open>/);
  assert.match(closedHtml, /aria-expanded="false"><span[^>]*>查看四视图<\/span>/);

  const scopedSelection = ui.selectionItems({
    castProfiles: [
      { id: 'lin', displayName: '林悦', wardrobeText: '白色亚麻长裙', _generationDirty: true },
      { id: 'jie', displayName: '小杰', wardrobeText: '蓝白条纹短袖' },
    ],
    actorAsset: {
      cast_assets: [
        { ...viewAsset('林悦', 'lin'), actor_id: 'lin' },
        { ...viewAsset('小杰', 'jie'), actor_id: 'jie' },
      ],
    },
    petProfiles: [{ ...viewAsset('雪球', 'snow'), id: 'snow' }],
  });
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(scopedSelection.map(item => ({
      key: item.key,
      selected: item.selected,
      reusable: item.reusable,
      required: item.required,
    })))),
    [
      { key: 'human:lin', selected: true, reusable: true, required: false },
      { key: 'human:jie', selected: false, reusable: true, required: false },
      { key: 'pet:snow', selected: false, reusable: true, required: false },
    ],
    '弹窗必须从人物组资产读取完整四视图，只默认勾选真正修改的人物',
  );

  const incompleteSelection = ui.selectionItems({
    castProfiles: [{ id: 'lin', displayName: '林悦', wardrobeText: '白色亚麻长裙', _generationDirty: true }],
    actorAsset: { cast_assets: [{ ...viewAsset('林悦', 'lin'), actor_id: 'lin' }] },
    petProfiles: [{ id: 'snow', name: '雪球', image_url: '/assets/snow-front.png' }],
  });
  assert.strictEqual(incompleteSelection[1].reusable, false);
  assert.strictEqual(incompleteSelection[1].selected, true, '缺少四视图的未选主体必须在提交前自动纳入范围');
  assert.strictEqual(incompleteSelection[1].required, true, '缺少四视图的主体不能被取消勾选后交给后端报错');

  const recovered = ui.normalizeHumanProfile({
    id: 'cast_contract_only',
    appearanceText: '[object Object]',
    appearance: { userPrompt: '' },
    wardrobe: { userPrompt: '' },
    hairMakeup: { userPrompt: '' },
    person_contract: {
      identity: { face_description: '自然椭圆脸，眼下有轻微真实纹理' },
      wardrobe: { description: '米白色棉质短袖与自然褶皱长裤' },
      appearance: { hair_style: '低马尾，保留碎发与自然发丝' },
    },
  });
  assert.strictEqual(recovered.appearanceText, '自然椭圆脸，眼下有轻微真实纹理');
  assert.strictEqual(recovered.wardrobeText, '米白色棉质短袖与自然褶皱长裤');
  assert.strictEqual(recovered.hairMakeupText, '低马尾，保留碎发与自然发丝');
  assert.doesNotMatch(recovered.appearanceText, /\[object Object\]/);
}

function testScenePlanFrontendAndCodeSize() {
  const { sandbox, modeControl, controls } = loadFrontendModules();
  const sceneUi = sandbox.window.NewStoryAdSceneAssets;
  const plan = {
    scene_mode: 'multi',
    spaces: [
      { id: 'space_park', name: '公园', scene_spec: fullSpec('PARK') },
      { id: 'space_home', name: '家庭', scene_spec: fullSpec('HOME') },
    ],
  };
  const state = { sceneAssets: [], sceneSelectedIndex: 0, scenePlanSelectedIndex: 0, sceneConfig: null };
  const applied = sceneUi.applyPlan(state, plan);
  assert.strictEqual(applied.plan.spaces.length, 2);
  assert.strictEqual(state.sceneConfig.scene_mode, 'multi');
  assert.strictEqual(modeControl.value, 'multi', '结构化双场景计划必须同步显示为多场景');
  assert.strictEqual(sceneUi.planPayload(state).spaces.length, 2);
  assert(controls.get('[data-nsa-scene-spec="layoutText"]').value.includes('PARK'));

  controls.get('[data-nsa-scene-spec="layoutText"]').value = 'PARK_EDITED';
  sceneUi.selectPlanSpace(state, 1);
  assert(controls.get('[data-nsa-scene-spec="layoutText"]').value.includes('HOME'));
  assert.strictEqual(state.scenePlanSelectedId, 'space_home', '场景选择必须同时保存稳定空间 ID，不能只依赖可漂移的数组下标');
  const switchedPlan = sceneUi.planPayload(state);
  assert.strictEqual(switchedPlan.spaces[0].scene_spec.layoutText, 'PARK_EDITED');
  assert(switchedPlan.spaces[1].scene_spec.layoutText.includes('HOME'));
  assert.strictEqual(sceneUi.plannedGenerationTarget(state).targetSpaceId, 'space_home');
  controls.get('[data-nsa-scene-spec="layoutText"]').value = 'STALE_FIRST_SCENE';
  sceneUi.hydrate(state, { request: { scene_spec: fullSpec('PARK') }, outputs: { scene_config: switchedPlan } });
  assert(controls.get('[data-nsa-scene-spec="layoutText"]').value.includes('HOME'), '任务刷新不得用顶层首场景 scene_spec 覆盖当前选中的第二场景');
  assert.strictEqual(state.scenePlanSelectedId, 'space_home');

  const host = { innerHTML: '' };
  sceneUi.render({ host, state });
  assert(host.innerHTML.includes('data-nsa-scene-plan-select="0"'));
  assert(host.innerHTML.includes('data-nsa-scene-plan-select="1"'));
  assert(host.innerHTML.includes('公园') && host.innerHTML.includes('家庭'));
  assert(host.innerHTML.includes('场景 2/2'));
  assert.match(host.innerHTML, /dh-nsa-scene-tab active[^>]*>\s*<button type="button" data-nsa-scene-plan-select="1"/);

  const reversedAssets = [
    { id: 'space_home', scene_id: 'space_home', space_id: 'space_home', name: '家庭', image_url: '/home.png', view_images: [{ key: 'master', url: '/home.png' }] },
    { id: 'space_park', scene_id: 'space_park', space_id: 'space_park', name: '公园', image_url: '/park.png', view_images: [{ key: 'master', url: '/park.png' }] },
  ];
  state.sceneAssets = reversedAssets;
  sceneUi.render({ host, state });
  assert(host.innerHTML.includes('场景 2/2'), '资产数组顺序与计划顺序不同时，卡片序号必须仍使用场景计划索引');
  assert(!host.innerHTML.includes('场景 1/2 · 版本'), '选中的计划场景 2 不能因为资产位于数组第 1 项而显示成场景 1');

  const legacyParkAsset = {
    id: 'space_park',
    scene_id: 'space_park',
    space_id: 'space_park',
    image_url: '/park.png',
    view_images: [{ key: 'master', url: '/park.png' }],
  };
  state.sceneAssets = [legacyParkAsset];
  state.sceneSelectedIndex = 0;
  assert.strictEqual(sceneUi.selectedSceneAssetIndex(state), -1, '未生成的场景 2 不得错误复用场景 1 的资产索引');
  assert.strictEqual(sceneUi.selectedSceneUpgradeRequired(state), false, '场景 1 的旧资产状态不得隐藏场景 2 的生成入口');
  const selectedMissingTarget = sceneUi.plannedGenerationTarget(state);
  assert.strictEqual(selectedMissingTarget.currentAsset, null);
  assert.strictEqual(selectedMissingTarget.targetSpaceId, 'space_home');

  const cssSource = fs.readFileSync(path.join(__dirname, '../public/css/digital-human-wizard.css'), 'utf8');
  assert.match(cssSource, /\.dh-nsa-scene-tab\.active > button\[data-nsa-scene-plan-select\]/, '计划场景标签必须具有明确选中态');
  assert.doesNotMatch(cssSource, /\.dh-nsa-scene-main\s*\{[^}]*height:\s*100%/s, '右侧场景表单不能被左侧五视图强制等高');
  assert.doesNotMatch(cssSource, /\.dh-nsa-scene-spec-grid textarea\s*\{[^}]*height:\s*100%/s, '场景文本框不能按预览栏高度无限拉伸');

  const beforeCount = state.sceneConfig.spaces.length;
  const draft = sceneUi.addDraftSpace(state);
  assert.strictEqual(state.sceneConfig.spaces.length, beforeCount + 1);
  assert.strictEqual(state.scenePlanSelectedIndex, 2);
  assert.strictEqual(draft.draft, true);
  assert.strictEqual(controls.get('[data-nsa-scene-spec="layoutText"]').value, '');

  const legacySource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js'), 'utf8');
  assert.match(legacySource, /dhNsaAdAddSceneSheet:\s*\(\)\s*=>\s*window\.NewStoryAdSceneAssets\?\.addDraft\?/);
  assert.doesNotMatch(legacySource, /dhNsaAdAddSceneSheet:\s*\(\)\s*=>\s*generateSceneSheet/);
  assert.match(legacySource, /scene_plan:\s*currentPlan/, '场景重编译必须把完整权威计划提交给后端');
  assert.match(legacySource, /target_space_id:\s*targetSpaceId/, '场景重编译必须显式提交当前选中的稳定空间 ID');
  assert.match(legacySource, /selectPlanSpaceById\?\.\(state,\s*sceneId\)/, '场景卡片升级入口必须按稳定空间 ID 同步计划选择');

  const legacyLines = legacySource.split(/\r?\n/).length;
  assert(legacyLines <= 6400, `旧剧情广告 UI 不得继续膨胀：当前 ${legacyLines} 行`);
  const galleryBytes = fs.statSync(path.join(__dirname, '../public/js/new-story-ad/subject-assets-ui.js')).size;
  assert(galleryBytes < 28000, `统一主体模块体积异常：${galleryBytes} bytes`);
}

async function main() {
  await testStructuredSceneAssistAndPersistence();
  await testFrontendSaveUsesOneAuthoritativeScenePlan();
  testUnifiedLazySubjectGallery();
  testScenePlanFrontendAndCodeSize();
  console.log('剧情广告统一主体四视图与结构化多场景回归：全部通过');
}

main()
  .finally(() => {
    try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch {}
  })
  .catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
