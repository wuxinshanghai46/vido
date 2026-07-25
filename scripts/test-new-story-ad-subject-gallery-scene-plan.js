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
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
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
  assert.strictEqual((html.match(/data-nsa-subject-gallery>/g) || []).length, 3, '双人和宠物必须各有独立四视图入口');
  assert.strictEqual((html.match(/data-src=/g) || []).length, 12, '三套四视图必须全部可查看');
  assert.strictEqual((html.match(/<img src=/g) || []).length, 3, '首屏只能加载每个主体一张主图');
  assert(html.includes('林悦') && html.includes('小杰') && html.includes('雪球'));
}

function testScenePlanFrontendAndCodeSize() {
  const { sandbox, modeControl } = loadFrontendModules();
  const sceneUi = sandbox.window.NewStoryAdSceneAssets;
  const plan = {
    scene_mode: 'multi',
    spaces: [
      { id: 'space_park', name: '公园', scene_spec: fullSpec('PARK') },
      { id: 'space_home', name: '家庭', scene_spec: fullSpec('HOME') },
    ],
  };
  const state = { sceneAssets: [], sceneSelectedIndex: 0, sceneConfig: null };
  const applied = sceneUi.applyPlan(state, plan);
  assert.strictEqual(applied.plan.spaces.length, 2);
  assert.strictEqual(state.sceneConfig.scene_mode, 'multi');
  assert.strictEqual(modeControl.value, 'multi', '结构化双场景计划必须同步显示为多场景');
  assert.strictEqual(sceneUi.planPayload(state).spaces.length, 2);

  const legacyLines = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js'), 'utf8').split(/\r?\n/).length;
  assert(legacyLines <= 6400, `旧剧情广告 UI 不得继续膨胀：当前 ${legacyLines} 行`);
  const galleryBytes = fs.statSync(path.join(__dirname, '../public/js/new-story-ad/subject-assets-ui.js')).size;
  assert(galleryBytes < 26000, `统一主体模块体积异常：${galleryBytes} bytes`);
}

async function main() {
  await testStructuredSceneAssistAndPersistence();
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
