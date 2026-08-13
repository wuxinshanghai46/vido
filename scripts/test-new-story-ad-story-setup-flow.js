const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/digital-human.html');
const bootstrap = read('public/js/new-story-ad/bootstrap.js');
const storySetupUi = read('public/js/new-story-ad/story-setup.js');
const buttonStateUi = read('public/js/new-story-ad/button-state.js');
const stepNavigationUi = read('public/js/new-story-ad/step-navigation.js');
const stateSyncUi = read('public/js/new-story-ad/state-sync.js');
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
assert(html.includes('id="dhNsaAdStoryboard" type="button">生成剧情蓝图</button>'), '第 3 步主操作应直接显示“生成剧情蓝图”');
assert(!buttonStateUi.includes("continueStorySetupBtn.classList.toggle('is-next'"), '权威按钮状态模块不得默认高亮下一步按钮');
assert(wizardCss.includes('#dhNsaAdContinueStorySetup:not(:disabled):hover') && wizardCss.includes('#dhNsaAdContinueStorySetup:not(:disabled):focus-visible'), '下一步按钮只在指向或键盘聚焦时高亮');
assert(wizardCss.includes('#dhNsaAdPreviewFrames:not(:disabled):hover') && wizardCss.includes('#dhNsaAdPreviewFrames:not(:disabled):focus-visible'), '确认剧本生成分镜按钮必须在指向或键盘聚焦时显示主操作反馈');
assert(wizardCss.includes('#dhNsaAdScriptRegenerateTop:not(:disabled):hover') && wizardCss.includes('#dhNsaAdScriptRegenerateTop:not(:disabled):focus-visible'), '重新生成剧本按钮必须在指向或键盘聚焦时显示次级操作反馈');
assert(buttonStateUi.includes("lock('#dhNsaAdStoryboard', !storySetupReady.ready"), '生成剧本按钮点击时再确认剧情设置');
assert(!buttonStateUi.includes("storyboardBtn.classList.toggle('is-next'"), '生成剧本按钮默认不得直接进入高亮状态');
assert(wizardCss.includes('#dhNsaAdStoryboard:not(:disabled):hover') && wizardCss.includes('#dhNsaAdStoryboard:not(:disabled):focus-visible'), '生成剧本按钮只在指向或键盘聚焦时高亮');
assert(/\.dh-luxgen-step-action\s*\{[^}]*background:\s*rgba\(255,255,255,\.035\);[^}]*box-shadow:\s*none;/.test(wizardCss), '步骤主操作默认态必须同时清除通用主按钮阴影');
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
vm.runInNewContext(stateSyncUi, sandbox, { filename: 'state-sync.js' });
const ui = sandbox.window.NewStoryAdStorySetup;
const restoredStructuredText = sandbox.window.NewStoryAdStateSync.formatBriefText(
  '【剧情走向】第一段 【情绪与表演】第二段 1. 动作一 2. 动作二 • 禁止新增人物',
);
assert(restoredStructuredText.includes('【剧情走向】第一段\n\n【情绪与表演】第二段'));
assert(restoredStructuredText.includes('\n1. 动作一\n2. 动作二\n• 禁止新增人物'));
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
marked = '';
assert.strictEqual(ui.approve({
  state: readyState,
  getPersonSpec: spec,
  markSourceDirty: scope => { marked = scope; },
  renderAll: () => {},
  toast: () => {},
}), true);
assert.strictEqual(readyState.storySetupConfirmed, true);
assert.strictEqual(marked, '', '重复确认且内容未变时不得再次标记 creative，避免错误递增版本并使已有剧本失效');

const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const revision = require('../src/services/newStoryAd/revisionService');
const storySetup = require('../src/services/newStoryAd/storySetupService');
const creativeAssist = require('../src/services/newStoryAd/assistCreativeDirectionService');
const multilineBrief = '【广告主题】咖啡广告\n\n【核心故事线】先疲惫工作\n1. 饮用咖啡\n2. 恢复专注';
const multilineCreative = '【剧情走向】从疲惫到专注\n\n【关键动作】\n1. 拿起咖啡\n2. 完成提案';
const base = contextBuilder.buildContext({
  source: 'new_story_ad_legacy_style_ui',
  brief: multilineBrief,
  creative_direction: { raw: multilineCreative },
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
assert.strictEqual(base.brief, multilineBrief, '广告需求保存必须保留真实换行');
assert.strictEqual(base.creative_direction.raw, multilineCreative, '剧情与表演要求保存必须保留真实换行');
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

    let briefGoalModelCalls = 0;
    modelGateway.generateText = async options => {
      briefGoalModelCalls += 1;
      assert.strictEqual(options.stage, 'new_story_ad.assist');
      const isStoryGoal = options.userPrompt.includes('brief_goal 剧情剧本帮写');
      if (isStoryGoal) {
        assert(options.systemPrompt.includes('纯剧情任务'));
        assert(options.systemPrompt.includes('不得把剧情变广告'));
        assert(options.userPrompt.includes('姐妹在故乡竹海重逢'));
      } else {
        assert(options.systemPrompt.includes('广告任务'));
        assert(options.userPrompt.includes('brief_goal 广告剧本帮写'));
        assert(options.userPrompt.includes('年轻人的便携咖啡广告'));
      }
      assert(options.systemPrompt.includes('详细概述、出场人物或展示主体、主要场景、剧情段落与结尾'));
      const text = JSON.stringify(isStoryGoal ? {
        detailed_summary: '多年未见的姐妹回到故乡竹海，在共同整理旧屋与重走儿时小径的过程中，被迫面对当年分别时没有说出口的误解。两人从克制试探到坦白旧伤，最终理解彼此当年的选择，并决定以新的关系重新出发。',
        participants: [
          { name: '姐姐', role: '离乡多年的姐姐', description: '希望完成旧屋交接，表面冷静，内心仍期待妹妹理解自己的离开。' },
          { name: '妹妹', role: '留守故乡的妹妹', description: '对姐姐的离开怀有怨意，却保存着两人童年的共同物件。' },
        ],
        scenes: [
          { name: '故乡竹海小径', time: '傍晚', description: '承载童年记忆，也是姐妹从沉默走向交流的主要空间。' },
          { name: '山间旧屋', time: '入夜', description: '旧物触发真相，两人在这里完成正面沟通。' },
        ],
        story_sections: [
          { title: '重逢与隔阂', content: '姐姐回到旧屋，妹妹以礼貌而疏离的方式迎接，两人因一件旧物产生第一次情绪碰撞。' },
          { title: '真相与和解', content: '姐妹沿竹海小径回忆往事，在旧屋说清当年的选择，承认彼此的伤害并约定重新建立联系。' },
        ],
        closing: '和解不是遗忘过去，而是看见彼此的处境后，仍愿意共同走向新的生活。',
      } : {
        detailed_summary: '一位年轻上班族在通勤与临时会议之间需要快速获得一杯稳定口感的咖啡。便携咖啡通过随身携带、快速冲泡和真实使用情境被自然展示，最后以工作状态恢复和从容出发完成广告收束。',
        participants: [
          { name: '年轻上班族', role: '核心使用者', description: '在通勤和工作间隙展示真实使用需求与体验。' },
          { name: '便携咖啡', role: '广告展示主体', description: '通过包装、冲泡和饮用过程展示便携与稳定口感。' },
        ],
        scenes: [
          { name: '通勤车厢', time: '清晨', description: '建立赶时间的真实需求。' },
          { name: '办公室休息区', time: '上午', description: '完成冲泡、饮用与状态变化的可见展示。' },
        ],
        story_sections: [
          { title: '需求出现', content: '上班族匆忙通勤并接到临时会议通知，表现需要快速整理状态的真实处境。' },
          { title: '产品展示与收束', content: '她在办公室快速冲泡便携咖啡，通过包装、冲泡和饮用动作展示产品，并从容进入会议。' },
        ],
        closing: '建立便携、可靠且有品质感的产品认知，引导观众进一步了解或购买。',
      });
      assert.strictEqual(await options.validateText(text), true);
      return { text, used_model: 'fixture-brief-goal', fallback_used: false, failed_models: [] };
    };
    const goalResponse = await storyAdService.assistBrief({
      mode: 'brief_goal',
      brief: '年轻人的便携咖啡广告',
      product_subject: '便携咖啡',
      target_duration: 30,
    }, { id: 'test-user' });
    assert.match(goalResponse.brief, /年轻上班族/);
    assert.match(goalResponse.brief, /产品认知/);
    assert.match(goalResponse.brief, /【广告剧情概述】/);
    assert.match(goalResponse.brief, /【出场人物 \/ 展示主体】/);
    assert.match(goalResponse.brief, /【主要场景】/);
    assert.match(goalResponse.brief, /【广告剧情段落】/);
    assert.equal(goalResponse.screenplay_structure_version, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(goalResponse, 'characters'), false, '目标帮写不得提前输出人物');
    assert.equal(Object.prototype.hasOwnProperty.call(goalResponse, 'shot_count'), false, '目标帮写不得提前输出分镜数量');
    assert.equal(briefGoalModelCalls, 1);
    const storyGoalResponse = await storyAdService.assistBrief({
      mode: 'brief_goal',
      brief: '一对多年未见的姐妹在故乡竹海重逢，故事表达和解与重新出发。',
      product_subject: '',
      content_mode: 'narrative_story',
      content_mode_source: 'user',
      target_duration: 60,
    }, { id: 'test-user' });
    assert.match(storyGoalResponse.brief, /【详细剧情描述】/);
    assert.match(storyGoalResponse.brief, /【出场人物】/);
    assert.match(storyGoalResponse.brief, /【剧情段落】/);
    assert.doesNotMatch(storyGoalResponse.brief, /产品|商品|品牌|购买|转化/);
    assert.equal(briefGoalModelCalls, 2);
    await assert.rejects(
      storyAdService.assistBrief({ mode: 'brief_goal', brief: '' }, { id: 'test-user' }),
      error => error.code === 'ASSIST_BRIEF_GOAL_EMPTY' && /没有调用文本模型/.test(error.message),
    );
    assert.equal(briefGoalModelCalls, 2, '空想法必须在模型调用前阻断');
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
  console.log('new story ad post-asset story setup flow: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
