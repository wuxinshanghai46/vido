const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function loadSceneUi() {
  const source = fs.readFileSync(path.join(root, 'public/js/new-story-ad/scene-assets.js'), 'utf8');
  const sandbox = {
    window: {},
    document: {
      getElementById: () => null,
      querySelector: () => null,
    },
    console,
    setInterval,
    clearInterval,
  };
  vm.runInNewContext(source, sandbox, { filename: 'scene-assets.js' });
  return sandbox.window.NewStoryAdSceneAssets;
}

function loadSceneUiWithSpec(values = {}) {
  const controls = new Map();
  const control = (key, fallback = '') => {
    const selector = `[data-nsa-scene-spec="${key}"]`;
    if (!controls.has(selector)) {
      controls.set(selector, {
        value: values[key] ?? fallback,
        dataset: {},
        classList: { toggle() {}, add() {}, remove() {} },
        closest() { return null; },
        getAttribute(name) { return name === 'data-nsa-scene-spec' ? key : ''; },
      });
    }
    return controls.get(selector);
  };
  ['layoutText', 'materialLightText', 'interactionText', 'negativeText',
    'surfaceTopology.mode', 'surfaceTopology.seam_policy', 'surfaceTopology.finish_distribution',
    'surfaceTopology.primary_surface_count', 'surfaceTopology.secondary_surface_policy', 'surfaceTopology.notes']
    .forEach(key => control(key, key.startsWith('surfaceTopology.') && !/count|notes/.test(key) ? 'auto' : ''));
  const document = {
    documentElement: { dataset: {} },
    body: null,
    getElementById: () => null,
    querySelector(selector) { return controls.get(selector) || null; },
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const sandbox = { window: {}, document, console, setInterval, clearInterval };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'public/js/new-story-ad/scene-assets.js'), 'utf8'),
    sandbox,
    { filename: 'scene-assets.js' },
  );
  return { sceneUi: sandbox.window.NewStoryAdSceneAssets, controls };
}

async function main() {
  const sceneUi = loadSceneUi();
  const requests = [];
  let confirmCalls = 0;
  const state = {
    taskId: 'direct-scene-generation-test',
    sceneAssets: [],
    scenePlanSelectedId: 'space_park',
    scenePlanSelectedIndex: 0,
    sceneConfig: {
      scene_mode: 'single',
      spaces: [{
        id: 'space_park',
        name: '公园草坪',
        scene_spec: {
          layoutText: '开阔草坪与步道构成一个连续空间。',
          materialLightText: '自然日光与真实草地材质。',
          interactionText: '中央留出活动区域。',
          negativeText: '禁止人物、文字和水印。',
        },
      }],
    },
  };

  const generated = await sceneUi.generate({
    state,
    ensureTask: async () => state.taskId,
    api: async (url, options) => {
      requests.push({ url, options });
      return {
        scene_assets: [{
          id: 'space_park',
          scene_id: 'space_park',
          space_id: 'space_park',
          name: '公园草坪',
          view_images: [{ key: 'master', url: '/scene/master.png' }],
        }],
      };
    },
    payload: () => [],
    normalizeBundle: () => {},
    renderAll: () => {},
    setBusy: () => {},
    setButtonBusy: () => {},
    toast: () => {},
    confirmAction: async () => {
      confirmCalls += 1;
      return false;
    },
  });

  assert.strictEqual(generated, true);
  assert.strictEqual(requests.length, 1, '用户点击生成后必须只提交一次请求');
  assert.strictEqual(
    requests[0].options.body.acknowledge_billing_unknown,
    true,
    '用户主动生成必须在首次请求中携带检查点恢复授权',
  );
  assert.strictEqual(confirmCalls, 0, '场景生成不得再弹出计费状态二次确认');
  assert.strictEqual(state.sceneAssets[0].space_id, 'space_park');

  const { sceneUi: editedUi } = loadSceneUiWithSpec({
    layoutText: '用户刚改成只保留一面完整的艺术背景墙，其他边界退居背景。',
    materialLightText: '主墙使用当前任务材质，允许正常施工收口。',
    interactionText: '主墙前保留可到达的互动区域和通行路线。',
    negativeText: '禁止增加第二面展示墙、立柱或独立材质面板。',
    'surfaceTopology.mode': 'continuous',
    'surfaceTopology.seam_policy': 'hidden',
    'surfaceTopology.finish_distribution': 'uniform',
  });
  const editedRequests = [];
  const editedState = {
    taskId: 'edited-scene-generation-test',
    sceneAssets: [],
    scenePlanSelectedId: 'space_wall',
    scenePlanSelectedIndex: 0,
    sceneConfig: {
      scene_mode: 'single',
      spaces: [{
        id: 'space_wall',
        name: '旧场景计划',
        scene_spec: {
          layoutText: '旧合同：连续无缝墙面。',
          materialLightText: '旧材质描述。',
          interactionText: '旧互动位。',
          negativeText: '旧禁止项。',
          surfaceTopology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'uniform' },
        },
      }],
    },
  };
  assert.equal(editedUi.hasContinuousSurfaceIntent({ layoutText: '一面完整的艺术背景墙。' }), false);
  assert.equal(editedUi.hasSinglePrimarySurfaceIntent({ layoutText: '一面完整的艺术背景墙。' }), true);
  await editedUi.generate({
    state: editedState,
    ensureTask: async () => editedState.taskId,
    api: async (url, options) => {
      editedRequests.push({ url, options });
      return { scene_assets: [{ id: 'space_wall', scene_id: 'space_wall', space_id: 'space_wall', view_images: [{ key: 'master', url: '/wall.png' }] }] };
    },
    payload: () => [],
    normalizeBundle: () => {},
    renderAll: () => {},
    setBusy: () => {},
    setButtonBusy: () => {},
    toast: () => {},
  });
  const submittedSpec = editedRequests[0].options.body.scene_spec;
  assert.match(submittedSpec.layoutText, /用户刚改成/);
  assert.doesNotMatch(submittedSpec.layoutText, /旧合同/);
  assert.equal(submittedSpec.surfaceTopology.mode, 'auto', '旧 continuous 不能覆盖当前文本');
  assert.equal(submittedSpec.surfaceTopology.seam_policy, 'auto', '旧 hidden 不能覆盖当前文本');
  assert.equal(submittedSpec.surfaceTopology.primary_surface_count, 1);
  assert.equal(submittedSpec.surfaceTopology.secondary_surface_policy, 'forbidden');
  assert.match(editedState.sceneConfig.spaces[0].scene_spec.layoutText, /用户刚改成/, '生成前必须把当前表单写回选中的场景计划');
  assert.throws(
    () => editedUi.assertCurrentSceneSpecSubmitted(
      submittedSpec,
      { ...submittedSpec, layoutText: '旧合同：连续无缝墙面。' },
    ),
    error => error.code === 'SCENE_SPEC_STALE_SUBMISSION_BLOCKED',
  );
  console.log(JSON.stringify({
    status: 'PASS',
    api_requests: requests.length + editedRequests.length,
    confirmation_dialogs: confirmCalls,
    direct_checkpoint_authorization: true,
    current_edit_authoritative: true,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
