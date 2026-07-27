const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/digital-human.html');
const legacy = read('public/js/new-story-ad-legacy-ui.js');
const bootstrap = read('public/js/new-story-ad/bootstrap.js');
const storySetupUi = read('public/js/new-story-ad/story-setup.js');
const buttonStateUi = read('public/js/new-story-ad/button-state.js');

const sceneHostIndex = html.indexOf('id="dhNsaAdSceneConfigHost"');
const nextIndex = html.indexOf('id="dhNsaAdContinueStorySetup"');
const statusIndex = html.indexOf('id="dhNsaAdStorySetupNext"');
const panelIndex = html.indexOf('id="dhNsaAdStorySetupPanel"');
const modeIndex = html.indexOf('id="dhNsaAdProductionMode"');
const assistIndex = html.indexOf('id="dhNsaAdCreativeAssist"');
const scriptIndex = html.indexOf('id="dhNsaAdStoryboard"');
assert(nextIndex > 0 && nextIndex < sceneHostIndex, '剧情设置下一步主按钮必须位于场景配置顶部');
assert.strictEqual((html.match(/id="dhNsaAdContinueStorySetup"/g) || []).length, 1, '顶部只能保留一个剧情设置下一步主按钮');
assert(sceneHostIndex < statusIndex && statusIndex < panelIndex, '场景结果后只保留资产就绪状态，再进入剧情设置面板');
assert(panelIndex < modeIndex && modeIndex < scriptIndex, '剧情设置必须在资产状态后显示，并从面板底部生成剧本');
assert(assistIndex > panelIndex && assistIndex < scriptIndex, '剧情与表演 AI 辅写必须位于剧本生成前');
assert(html.includes('剧情呈现方式') && !html.includes('模式只决定生产和 QA 策略'), '视频基础信息必须改为真实用途说明');
assert(legacy.includes("dhNsaAdContinueStorySetup: () => window.NewStoryAdStorySetup.open"), '下一步只能打开剧情设置，不能直接生成剧本');
assert(legacy.includes("continueStorySetupBtn.classList.toggle('is-next', storySetupReady.ready && !state.busy)"), '下一步按钮可用时必须复用统一主操作指向效果');
assert(buttonStateUi.includes("continueStorySetupBtn.classList.toggle('is-next', storySetupReady.ready && !state.busy)"), '权威按钮状态模块必须设置统一主操作指向效果');
assert(buttonStateUi.includes("!state.storySetupConfirmed || !storySetupReady.ready"), '权威按钮状态模块不能绕过剧情设置确认门禁');
assert(legacy.includes("dhNsaAdStoryboard: () => runStage('blueprint', btn)"), '面板底部按钮仍负责生成剧本');
assert(legacy.includes("target?.id === 'dhNsaAdProductionMode'") && legacy.includes("markSourceDirty('creative')"), '剧情呈现方式修改必须失效旧剧本');
assert(bootstrap.includes("'/js/new-story-ad/story-setup.js'"), '剧情设置模块必须在旧 UI 前按需加载');
assert(storySetupUi.includes("continueButton.hidden = state.storySetupExpanded === true"), '打开剧情设置后必须隐藏顶部下一步按钮');

const sandbox = {
  window: {
    NewStoryAdSceneAssets: {
      sceneLockAssessment: asset => ({ complete: asset.complete === true }),
    },
  },
  document: { getElementById: () => null },
  requestAnimationFrame: callback => callback(),
  console,
  setTimeout,
  clearTimeout,
};
vm.runInNewContext(storySetupUi, sandbox, { filename: 'story-setup.js' });
vm.runInNewContext(buttonStateUi, sandbox, { filename: 'button-state.js' });
const ui = sandbox.window.NewStoryAdStorySetup;
const readyState = {
  context: { cast_mode: 'single', creative_direction: {} },
  sceneConfig: { spaces: [{ id: 'scene_a' }, { id: 'scene_b' }] },
  sceneAssets: [{ scene_id: 'scene_a', complete: true }, { scene_id: 'scene_b', complete: true }],
  personAsset: { image_url: '/actor.png' },
  petProfiles: [],
};
const spec = key => ({ castMode: 'single', expectedAnimals: '0' }[key] || '');
assert.strictEqual(ui.readiness(readyState, spec).ready, true);
assert.strictEqual(ui.readiness({ ...readyState, personAsset: null }, spec).ready, false);
assert.strictEqual(ui.readiness({ ...readyState, context: { cast_mode: 'no_human' }, personAsset: null }, key => key === 'castMode' ? 'no_human' : '').ready, true);
const fakeButton = () => {
  const classes = new Set();
  return {
    disabled: false,
    classList: {
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    setAttribute: () => {},
    removeAttribute: () => {},
  };
};
const continueButton = fakeButton();
const scriptButton = fakeButton();
const buttonControls = {
  '#dhNsaAdText': { value: '为已确认商品制作一条真实剧情广告' },
  '#dhNsaAdContinueStorySetup': continueButton,
  '#dhNsaAdStoryboard': scriptButton,
};
sandbox.window.NewStoryAdButtonState.updateLocks({
  state: { ...readyState, storySetupConfirmed: false, busy: false },
  within: selector => buttonControls[selector] || null,
  getPersonSpec: spec,
});
assert.strictEqual(continueButton.disabled, false);
assert.strictEqual(continueButton.classList.contains('is-next'), true);
assert.strictEqual(scriptButton.disabled, true);
const busyReadyState = { ...readyState, storySetupConfirmed: true, busy: true };
sandbox.window.NewStoryAdButtonState.updateLocks({
  state: busyReadyState,
  within: selector => buttonControls[selector] || null,
  getPersonSpec: spec,
});
assert.strictEqual(continueButton.disabled, true);
assert.strictEqual(continueButton.classList.contains('is-next'), false);
let marked = '';
let saved = '';
assert.strictEqual(ui.open({
  state: readyState,
  getPersonSpec: spec,
  markSourceDirty: scope => { marked = scope; },
  renderAll: () => {},
  scheduleAutoSave: reason => { saved = reason; },
  toast: () => {},
}), true);
assert.strictEqual(readyState.storySetupConfirmed, true);
assert.strictEqual(marked, 'creative');
assert.strictEqual(saved, 'story_setup_confirmed');

const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const revision = require('../src/services/newStoryAd/revisionService');
const storySetup = require('../src/services/newStoryAd/storySetupService');
const creativeAssist = require('../src/services/newStoryAd/assistCreativeDirectionService');
const base = contextBuilder.buildContext({
  source: 'new_story_ad_legacy_style_ui',
  brief: '为已确认的咖啡产品制作一条真人剧情广告',
  production_mode: 'narrative_live_action',
  story_setup_confirmed: true,
  cast_mode: 'single',
  cast_profiles: [{ id: 'cast_1', name: '林晓' }],
});
assert.strictEqual(base.story_setup_confirmed, true);
assert.strictEqual(base.request_source, 'new_story_ad_legacy_style_ui');
assert(contextBuilder.contextPrompt(base).includes('真人剧情演绎，以已确认人物的动作、表情和对白推动故事'));
const modeChanged = { ...base, production_mode: 'product_story' };
assert.deepStrictEqual(revision.changeDomains(base, modeChanged), ['creative']);
assert.throws(
  () => storySetup.assertConfirmed({ ...base, story_setup_confirmed: false }, 'script_package'),
  error => error.code === 'STORY_SETUP_REQUIRED',
);
assert.doesNotThrow(() => storySetup.assertConfirmed(base, 'script_package'));
assert.doesNotThrow(() => storySetup.assertConfirmed({ ...base, request_source: 'api_client', story_setup_confirmed: false }, 'script_package'));

const assisted = creativeAssist.buildResponse({
  parsed: {
    creative_direction: {
      plot_direction: '林晓先疲惫工作，使用咖啡后逐渐恢复专注并完成提案。',
      tone: '从疲惫到放松、自信',
      pace: '前慢后快',
      ending: '完成提案后进入品牌后期落版',
      actions: [{ actor_id: 'cast_1', actor: '林晓', action: '拿起已确认的咖啡饮用', expression: '逐渐放松', required: true }],
      must_avoid: ['禁止新增人物或切换场景'],
    },
  },
  context: base,
  mode: 'creative_direction',
  modelResult: { used_model: 'fixture-model', fallback_used: false, failed_models: [] },
});
assert(assisted.text.includes('剧情走向：'));
assert.strictEqual(assisted.creative_direction.actions[0].actor_id, 'cast_1');
assert.throws(
  () => creativeAssist.buildResponse({
    parsed: { creative_direction: { raw: '新增一位女主角面对镜头说台词，然后切换到全新办公室场景完成故事。' } },
    context: { ...base, cast_mode: 'no_human', cast_profiles: [], characters: [], person_asset: null },
    mode: 'creative_direction',
  }),
  error => error.code === 'ASSIST_CREATIVE_CONFLICT',
);

(async () => {
  const modelGateway = require('../src/services/newStoryAd/modelGateway');
  const storyAdService = require('../src/services/newStoryAd/storyAdService');
  const originalGenerateText = modelGateway.generateText;
  modelGateway.generateText = async options => {
    assert.strictEqual(options.stage, 'new_story_ad.assist');
    assert(options.systemPrompt.includes('只辅写剧情走向和表演要求'));
    assert(options.userPrompt.includes('creative_direction 剧情与表演要求辅写'));
    return {
      text: JSON.stringify({
        creative_direction: {
          raw: '林晓先在已确认场景中疲惫工作，饮用咖啡后逐渐恢复专注，完成提案后预留品牌后期落版。禁止新增人物或切换场景。',
          plot_direction: '从疲惫工作到恢复专注并完成提案',
          actions: [{ actor_id: 'cast_1', actor: '林晓', action: '饮用已确认的咖啡', required: true }],
          must_avoid: ['禁止新增人物或切换场景'],
        },
      }),
      used_model: 'fixture-model',
      fallback_used: false,
      failed_models: [],
    };
  };
  try {
    const response = await storyAdService.assistBrief({
      source: 'new_story_ad_legacy_style_ui',
      brief: base.brief,
      mode: 'creative_direction',
      story_setup_confirmed: true,
      production_mode: 'narrative_live_action',
      cast_mode: 'single',
      cast_profiles: [{ id: 'cast_1', name: '林晓' }],
      scene_assets: [{ scene_id: 'scene_a', name: '已确认场景' }],
    });
    assert(response.text.includes('禁止新增人物'));
    assert.strictEqual(response.mode, 'creative_direction');
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
  console.log('new story ad post-asset story setup flow: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
