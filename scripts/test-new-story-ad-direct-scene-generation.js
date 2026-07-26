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
  console.log(JSON.stringify({
    status: 'PASS',
    api_requests: requests.length,
    confirmation_dialogs: confirmCalls,
    direct_checkpoint_authorization: true,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
