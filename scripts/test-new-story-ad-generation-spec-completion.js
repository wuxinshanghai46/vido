const assert = require('assert');
const fs = require('fs');
const path = require('path');

const completion = require('../src/services/newStoryAd/generationSpecCompletionService');
const sceneBinding = require('../src/services/newStoryAd/sceneBindingService');

function memoryStorage() {
  const rows = new Map();
  return {
    getOutput(taskId, kind) { return rows.get(`${taskId}:${kind}`) || null; },
    saveOutput(taskId, kind, value) { rows.set(`${taskId}:${kind}`, JSON.parse(JSON.stringify(value))); return value; },
  };
}

function fakeRepair() {
  return { async parseOrRepair({ raw }) { return JSON.parse(raw); } };
}

async function main() {
  const partialScenePlan = {
    scene_mode: 'single',
    spaces: [{ id: 'partial-scene', name: '待补齐场景', scene_spec: { layoutText: '入口、主体区和背景形成连续空间边界' } }],
  };
  assert.throws(
    () => sceneBinding.resolveSceneGenerationTarget({ sceneConfig: partialScenePlan, body: { scene_id: 'partial-scene' } }),
    error => error?.code === 'SCENE_SPEC_REQUIRED_FOR_SPACE' && error.missing_fields.includes('materialLightText'),
    '未进入生成补齐流程时仍须严格拒绝不完整场景合同',
  );
  const completionTarget = sceneBinding.resolveSceneGenerationTarget({
    sceneConfig: partialScenePlan,
    body: { scene_id: 'partial-scene', allow_incomplete_scene_spec: true },
  });
  assert(completion.sceneMissingComponents(completionTarget.scene_spec).includes('materialLightText'));

  assert.deepEqual(
    completion.wardrobeMissingComponents('紫色真丝连衣裙'),
    ['shoes', 'accessories'],
    '已有连衣裙、颜色和材质时，只能补鞋履与配饰',
  );
  assert(!completion.wardrobeMissingComponents('白色棉质衬衫、黑色羊毛长裤、黑色皮鞋，不佩戴任何配饰').length);
  assert(
    completion.wardrobeMissingComponents('\u4e0d\u4f69\u6234\u9879\u94fe').includes('accessories'),
    '\u53ea\u5426\u5b9a\u4e00\u79cd\u914d\u9970\u4e0d\u80fd\u88ab\u8bef\u5224\u4e3a\u914d\u9970\u5df2\u5b8c\u6574',
  );
  assert(
    !completion.wardrobeMissingComponents('\u4e0d\u4f69\u6234\u4efb\u4f55\u914d\u9970').includes('accessories'),
    '\u7528\u6237\u660e\u786e\u8981\u6c42\u65e0\u4efb\u4f55\u914d\u9970\u65f6\u5fc5\u987b\u4fdd\u7559\u8be5\u6743\u5a01\u8981\u6c42',
  );
  assert(
    !completion.wardrobeMissingComponents('\u4e0d\u7a7f\u9ad8\u8ddf\u978b\uff0c\u8d64\u811a').includes('shoes'),
    '\u5426\u5b9a\u978b\u578b\u540e\u7684\u660e\u786e\u8d64\u811a\u8981\u6c42\u5e94\u88ab\u8bc6\u522b\u4e3a\u5b8c\u6574\u8db3\u90e8\u8bbe\u5b9a',
  );

  const storage = memoryStorage();
  let personCalls = 0;
  const personGateway = {
    async generateText(input) {
      personCalls += 1;
      assert.equal(input.stage, 'new_story_ad.assist');
      assert.match(input.systemPrompt, /用户原文是最高权威/);
      return {
        used_model: 'mock/person-completer',
        text: JSON.stringify({
          completions: [{ id: 'hero', index: 0, wardrobe_supplement: '银色真皮高跟鞋；佩戴一对小型珍珠耳钉，固定在双耳' }],
        }),
      };
    },
  };
  const person = await completion.completePersonProfiles({
    taskId: 'completion-person',
    brief: '真丝面料广告，人物在展厅介绍工艺',
    castProfiles: [{
      id: 'hero', displayName: '苏晚', roleName: '设计师', age: 'adult_30_40',
      appearanceText: '成年女性，真实商业人物气质',
      wardrobeText: '用户指定的紫色真丝连衣裙',
      hairMakeupText: '低发髻与自然妆面', negativeText: '禁止服装漂移',
    }],
  }, { storage, modelGateway: personGateway, jsonRepair: fakeRepair(), forceModel: true });
  assert.equal(personCalls, 1);
  assert(person.changed);
  assert(person.cast_profiles[0].wardrobeText.startsWith('用户指定的紫色真丝连衣裙；AI补齐：'));
  assert.match(person.cast_profiles[0].wardrobeText, /高跟鞋/);
  assert.match(person.cast_profiles[0].wardrobeText, /珍珠耳钉/);
  assert.deepEqual(person.cast_profiles[0].wardrobe_completion.completed_components, ['shoes', 'accessories']);
  assert(!completion.wardrobeMissingComponents(person.cast_profiles[0].wardrobeText).length);
  const reusedPerson = await completion.completePersonProfiles({
    taskId: 'completion-person', brief: '真丝面料广告，人物在展厅介绍工艺',
    castProfiles: [{ id: 'hero', displayName: '苏晚', roleName: '设计师', age: 'adult_30_40', appearanceText: '成年女性，真实商业人物气质', wardrobeText: '用户指定的紫色真丝连衣裙', hairMakeupText: '低发髻与自然妆面', negativeText: '禁止服装漂移' }],
  }, { storage, modelGateway: personGateway, jsonRepair: fakeRepair(), forceModel: true });
  assert(reusedPerson.reused);
  assert.equal(personCalls, 1, '同一输入重试必须复用补齐检查点，不得重复调用文本模型');

  let completePersonCalls = 0;
  const completePerson = await completion.completePersonProfiles({
    taskId: 'already-complete', brief: '广告', castProfiles: [{
      id: 'complete', wardrobeText: '白色棉质衬衫、黑色羊毛长裤、黑色皮鞋，不佩戴任何配饰',
    }],
  }, { storage, modelGateway: { async generateText() { completePersonCalls += 1; } }, forceModel: true });
  assert(!completePerson.changed);
  assert.equal(completePersonCalls, 0, '用户已写完整时不得调用补齐模型');

  await assert.rejects(
    completion.completePersonProfiles({ taskId: 'bad-person', castProfiles: [{ id: 'bad', wardrobeText: '紫色真丝连衣裙' }] }, {
      storage: memoryStorage(), forceModel: true, jsonRepair: fakeRepair(),
      modelGateway: { async generateText() { return { used_model: 'mock', text: JSON.stringify({ completions: [{ id: 'bad', wardrobe_supplement: '保持优雅' }] }) }; } },
    }),
    error => error.code === 'PERSON_WARDROBE_AUTO_COMPLETION_INCOMPLETE',
  );

  assert(completion.sceneMissingComponents({ layoutText: '展厅入口与主体展示区形成前景、背景和连续通道，完整空间边界清晰' }).includes('materialLightText'));
  const sceneStorage = memoryStorage();
  let sceneCalls = 0;
  const sceneGateway = {
    async generateText(input) {
      sceneCalls += 1;
      assert.match(input.systemPrompt, /用户场景原文是最高权威/);
      return {
        used_model: 'mock/scene-completer',
        text: JSON.stringify({ scene_spec_supplement: {
          layoutText: '补充左右两侧与中央展示台的相对位置和纵深',
          materialLightText: '墙面为暖灰色金属与石材，纹理尺度真实，右侧窗光形成主光，灯带补光，保留轻微划痕与粗糙反射',
          interactionText: '人物从入口沿右侧路线进入中央展示位，主机位拍摄全景，反向机位与近景特写锁定商品互动焦点',
          negativeText: '禁止无关人物；禁止文字、水印、结构变形、材质漂移和光向矛盾',
          storyStates: [{ id: 'state_intro', label: '进入', state_before: ['空场'], visible_change: ['人物进入'], state_after: ['人物到达展示位'], shot_refs: [] }],
          interactionAnchors: [{ id: 'anchor_product', label: '展示位', purpose: '介绍商品', contact_rules: ['视线和手部接触连续'] }],
          routes: [{ id: 'route_entry', label: '入口到展示位', from: '入口', to: '展示位', actor: '苏晚', continuity: '保持向左运动' }],
        } }),
      };
    },
  };
  const scene = await completion.completeSceneSpec({
    taskId: 'completion-scene', brief: '人物进入展厅介绍材料', productSubject: '金属板', sceneId: 'hall', sceneName: '光影艺廊',
    sceneSpec: { layoutText: '用户指定：展厅入口与主体展示区形成前景、背景和连续通道，完整空间边界清晰' },
  }, { storage: sceneStorage, modelGateway: sceneGateway, jsonRepair: fakeRepair(), forceModel: true });
  assert(scene.changed);
  assert(scene.scene_spec.layoutText.startsWith('用户指定：'));
  assert.equal(scene.scene_spec.routes[0].id, 'route_entry');
  assert(!completion.sceneMissingComponents(scene.scene_spec).length);
  assert.equal(sceneCalls, 1);
  const reusedScene = await completion.completeSceneSpec({
    taskId: 'completion-scene', brief: '人物进入展厅介绍材料', productSubject: '金属板', sceneId: 'hall', sceneName: '光影艺廊',
    sceneSpec: { layoutText: '用户指定：展厅入口与主体展示区形成前景、背景和连续通道，完整空间边界清晰' },
  }, { storage: sceneStorage, modelGateway: sceneGateway, jsonRepair: fakeRepair(), forceModel: true });
  assert(reusedScene.reused);
  assert.equal(sceneCalls, 1);

  const subjectSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/subjectAssetBundleService.js'), 'utf8');
  const sceneSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/sceneAssetService.js'), 'utf8');
  assert(sceneSource.includes("body: { ...body, allow_incomplete_scene_spec: true }"), '场景生成必须允许补齐器接收不完整的逐空间合同');
  const uiSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterView.js'), 'utf8');
  assert(subjectSource.indexOf('const completion = await generationSpecCompletion.completePersonProfiles') < subjectSource.indexOf('assertCompleteSubjectProfiles(counts, humans, pets)'), '人物补齐必须发生在完整性门禁和图片生成之前');
  assert(sceneSource.indexOf('const sceneCompletion = await generationSpecCompletion.completeSceneSpec') < sceneSource.indexOf('assertCompleteUpgradeSceneSpec(body)'), '场景补齐必须发生在付费图片生成门禁之前');
  assert.doesNotMatch(uiSource.slice(uiSource.indexOf('function generationValidation'), uiSource.indexOf('function assetCard')), /\['服装',\s*profile\.wardrobeText\]/);
  assert.match(uiSource, /自动补齐缺少的服装、鞋履、配饰、配色和面料/);

  console.log(JSON.stringify({
    passed: true,
    person_model_calls: personCalls,
    scene_model_calls: sceneCalls,
    person_checkpoint_reused: reusedPerson.reused,
    scene_checkpoint_reused: reusedScene.reused,
    user_person_text_preserved: person.cast_profiles[0].wardrobeText.startsWith('用户指定的紫色真丝连衣裙'),
    user_scene_text_preserved: scene.scene_spec.layoutText.startsWith('用户指定：'),
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
