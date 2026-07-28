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
const stepNavigationUi = read('public/js/new-story-ad/step-navigation.js');
const wizardCss = read('public/css/digital-human-wizard.css');

const sceneHostIndex = html.indexOf('id="dhNsaAdSceneConfigHost"');
const nextIndex = html.indexOf('id="dhNsaAdContinueStorySetup"');
const statusIndex = html.indexOf('id="dhNsaAdStorySetupNext"');
const panelIndex = html.indexOf('id="dhNsaAdStorySetupPanel"');
const modeIndex = html.indexOf('id="dhNsaAdProductionMode"');
const assistIndex = html.indexOf('id="dhNsaAdCreativeAssist"');
const scriptIndex = html.indexOf('id="dhNsaAdStoryboard"');
const storyStepIndex = html.indexOf('data-panel="3"');
const scriptStepIndex = html.indexOf('data-panel="4"');
assert(nextIndex > 0 && nextIndex < sceneHostIndex, '剧情设置下一步主按钮必须位于场景配置顶部');
assert.strictEqual((html.match(/id="dhNsaAdContinueStorySetup"/g) || []).length, 1, '顶部只能保留一个剧情设置下一步主按钮');
assert(sceneHostIndex < statusIndex && statusIndex < storyStepIndex, '第 2 步只能保留资产就绪状态');
assert(storyStepIndex < scriptIndex && scriptIndex < panelIndex && panelIndex < scriptStepIndex, '第 3 步主按钮必须位于顶部标题区，并在剧情设置内容面板之前');
assert(!html.includes('class="dh-nsa-story-setup-actions"'), '第 3 步不得保留改变内容格局的底部按钮区');
assert(html.includes('data-nsa-step="6"') && html.includes('dh-luxgen-steps-six'), '剧情广告流程必须是六个独立步骤');
assert(assistIndex > panelIndex && assistIndex < scriptStepIndex, '剧情与表演 AI 辅写必须位于第 3 步内容面板内');
assert(html.includes('剧情呈现方式') && !html.includes('模式只决定生产和 QA 策略'), '视频基础信息必须改为真实用途说明');
assert(!html.includes('生成剧本前最后一步'), '剧情设置页不得显示多余的“最后一步”提示');
assert(html.includes('id="dhNsaAdStoryboard" type="button">生成剧本</button>'), '第 3 步主操作应直接显示“生成剧本”');
assert(legacy.includes("['#dhNsaAdStoryboard', '生成剧本']"), '运行时不得把第 3 步主操作覆盖回旧文案');
assert(legacy.includes("dhNsaAdContinueStorySetup: () => window.NewStoryAdStorySetup.open"), '下一步只能打开剧情设置，不能直接生成剧本');
assert(!legacy.includes("continueStorySetupBtn.classList.toggle('is-next'"), '下一步按钮默认不得显示高亮指向效果');
assert(!buttonStateUi.includes("continueStorySetupBtn.classList.toggle('is-next'"), '权威按钮状态模块不得默认高亮下一步按钮');
assert(wizardCss.includes('#dhNsaAdContinueStorySetup:not(:disabled):hover') && wizardCss.includes('#dhNsaAdContinueStorySetup:not(:disabled):focus-visible'), '下一步按钮只在指向或键盘聚焦时高亮');
assert(buttonStateUi.includes("lock('#dhNsaAdStoryboard', !storySetupReady.ready"), '生成剧本按钮点击时再确认剧情设置');
assert(legacy.includes('NewStoryAdStorySetup.approve') && legacy.includes("runStage('blueprint', btn)"), '第 3 步按钮必须先确认设置再生成剧本');
assert(legacy.includes("target?.id === 'dhNsaAdProductionMode'") && legacy.includes("markSourceDirty('creative')"), '剧情呈现方式修改必须失效旧剧本');
assert(bootstrap.includes("'/js/new-story-ad/story-setup.js'"), '剧情设置模块必须在旧 UI 前按需加载');
assert(storySetupUi.includes('showStep?.(3)') && !storySetupUi.includes('state.storySetupConfirmed = true;\n    markSourceDirty'), '进入第 3 步不得提前确认剧情设置');
assert(stepNavigationUi.includes('Math.min(6') && stepNavigationUi.includes('if (step === 3) return state.storySetupConfirmed === true'), '六步导航必须单独跟踪剧情设置确认状态');

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
assert.strictEqual(continueButton.classList.contains('is-next'), false);
assert.strictEqual(scriptButton.disabled, false);
const busyReadyState = { ...readyState, storySetupConfirmed: true, busy: true };
sandbox.window.NewStoryAdButtonState.updateLocks({
  state: busyReadyState,
  within: selector => buttonControls[selector] || null,
  getPersonSpec: spec,
});
assert.strictEqual(continueButton.disabled, true);
assert.strictEqual(continueButton.classList.contains('is-next'), false);
let openedStep = 0;
assert.strictEqual(ui.open({
  state: readyState,
  getPersonSpec: spec,
  renderAll: () => {},
  showStep: step => { openedStep = step; },
  toast: () => {},
}), true);
assert.strictEqual(readyState.storySetupConfirmed, undefined);
assert.strictEqual(openedStep, 3);
let marked = '';
assert.strictEqual(ui.approve({
  state: readyState,
  getPersonSpec: spec,
  markSourceDirty: scope => { marked = scope; },
  renderAll: () => {},
  toast: () => {},
}), true);
assert.strictEqual(readyState.storySetupConfirmed, true);
assert.strictEqual(marked, 'creative');

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
assert(assisted.text.includes('【剧情走向】'));
assert.strictEqual(assisted.creative_direction.actions[0].actor_id, 'cast_1');
assert(assisted.text.includes('\n\n【关键动作】\n1.'), '辅写内容必须使用真实换行和空行自动分段');
assert(!assisted.text.includes('\\n'), '辅写内容不得显示字面量反斜杠换行');
const petBase = contextBuilder.buildContext({
  brief: '主人和已经确认的金毛犬共同完成一条狗粮广告',
  cast_mode: 'human_pet',
  cast_profiles: [{ id: 'cast_1', name: '主人' }],
  pet_profiles: [{ id: 'pet_asset_confirmed_1', name: '小金' }],
});
assert.doesNotThrow(() => creativeAssist.buildResponse({
  parsed: { creative_direction: {
    plot_direction: '主人与小金在已确认场景内互动',
    actions: [{ actor_id: 'pet_asset_confirmed_1', actor: '小金', action: '走向已确认的狗粮并闻一闻' }],
    must_avoid: ['禁止新增人物、宠物或场景'],
  } },
  context: petBase,
  mode: 'creative_direction',
}), '已确认宠物资产 ID 必须作为合法表演主体');
assert.throws(
  () => creativeAssist.buildResponse({
    parsed: { creative_direction: {
      plot_direction: '新宠物进入画面',
      actions: [{ actor_id: 'pet_asset_unknown', actor: '陌生宠物', action: '进入画面' }],
    } },
    context: petBase,
    mode: 'creative_direction',
  }),
  error => error.code === 'ASSIST_CREATIVE_CONFLICT' && /未确认人物或宠物/.test(error.message),
);
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
    assert(options.userPrompt.includes(base.brief), 'AI 辅写必须携带第 1 步广告需求');
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
