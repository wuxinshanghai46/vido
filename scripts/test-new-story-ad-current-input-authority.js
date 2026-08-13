const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const subjectAssets = require('../src/services/newStoryAd/subjectAssetBundleService');
const sceneAssist = require('../src/services/newStoryAd/sceneAssistCompletenessService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const keyframeScheduler = require('../src/services/newStoryAd/keyframeParallelScheduler');

function browserModule(file) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  return sandbox.window;
}

async function main() {
  const ageWindow = browserModule('public/js/new-story-ad/person-age-authority.js');
  const age = ageWindow.NewStoryAdPersonAgeAuthority;
  assert(age);
  assert.match(age.alignText('东亚面孔，约30岁，气质温柔', 'middle_40_55'), /40-55岁中年年龄感/);
  assert.doesNotMatch(age.alignText('东亚面孔，约30岁，气质温柔', 'middle_40_55'), /约30岁/);
  const singleState = { castProfiles: [{ id: 'cast_1', age: 'adult_30_40', appearanceText: '约30岁，气质温柔' }] };
  age.apply(singleState, { age: 'middle_40_55', appearanceText: '约30岁，气质温柔' }, { markDirty: true });
  assert.strictEqual(singleState.castProfiles[0].age, 'middle_40_55');
  assert.match(singleState.castProfiles[0].appearanceText, /40-55岁/);
  assert.strictEqual(singleState.castProfiles[0]._generationDirty, true);
  const assetState = { personAsset: { production_usable_actor: true, person_contract: { status: 'verified' } } };
  assetState.actorAsset = assetState.personAsset;
  age.invalidateAsset(assetState);
  assert.strictEqual(assetState.personAsset.person_contract.status, 'outdated');
  assert.strictEqual(assetState.personAsset.production_usable_actor, false);
  const multiState = { castProfiles: [
    { id: 'cast_1', age: 'adult_30_40', appearanceText: '约30岁母亲' },
    { id: 'cast_2', age: 'child_8_12', appearanceText: '约8岁孩子' },
  ] };
  age.apply(multiState, { age: 'senior_55_plus' });
  assert.deepStrictEqual(multiState.castProfiles.map(item => item.age), ['adult_30_40', 'child_8_12']);

  const members = subjectAssets.humanMemberSpecs(
    { age: 'middle_40_55' },
    { cast_profiles: [{ id: 'cast_1', displayName: '人物一', roleName: '主角', age: 'middle_40_55', appearanceText: '约30岁，真实人物', wardrobeText: '固定服装', hairMakeupText: '固定发型' }] },
    1,
  );
  const personPrompt = subjectAssets.humanPrompt(members[0], 1);
  assert.match(personPrompt, /Age-range lock: 40~55岁/);
  assert.match(personPrompt, /Preserve one stable apparent maturity inside this interval/);
  assert.doesNotMatch(personPrompt, /约30岁/);

  const currentScene = {
    layoutText: 'NEW_USER_LAYOUT_当前修改后的完整空间布局，包含明确前景背景和行动路线。',
    materialLightText: 'NEW_USER_MATERIAL_当前修改后的材质色彩光线和真实尺度。',
    interactionText: '',
    negativeText: 'NEW_USER_NEGATIVE_禁止旧场景和无关元素进入画面。',
  };
  const modelScene = {
    layoutText: 'OLD_MODEL_LAYOUT_旧场景布局内容不应覆盖用户值。',
    materialLightText: 'OLD_MODEL_MATERIAL_旧材质内容不应覆盖用户值。',
    interactionText: 'MODEL_FILLED_INTERACTION_模型只补齐原来为空的互动机位字段。',
    negativeText: 'OLD_MODEL_NEGATIVE_旧禁止项。',
  };
  const mergedScene = sceneAssist.enforceAssistedSceneSpec(modelScene, currentScene, {}, { preserveCurrentFields: true });
  assert.strictEqual(mergedScene.layoutText, currentScene.layoutText);
  assert.strictEqual(mergedScene.materialLightText, currentScene.materialLightText);
  assert.strictEqual(mergedScene.negativeText, currentScene.negativeText);
  assert.strictEqual(mergedScene.interactionText, modelScene.interactionText);
  assert.strictEqual(sceneAssets.sceneDescriptionForSpec(currentScene, 'OLD_SPACE_DESCRIPTION'), currentScene.layoutText);
  const compiledPrompt = sceneAssets.buildSceneSheetPrompt({
    ctx: { product_subject: '当前任务主体', scene_spec: currentScene },
    body: { scene_spec: currentScene, description: sceneAssets.sceneDescriptionForSpec(currentScene, 'OLD_SPACE_DESCRIPTION') },
  });
  assert.match(compiledPrompt, /NEW_USER_LAYOUT/);
  assert.doesNotMatch(compiledPrompt, /OLD_SPACE_DESCRIPTION/);

  const guidanceWindow = browserModule('public/js/new-story-ad/verification-language.js');
  const language = guidanceWindow.NewStoryAdVerificationLanguage;
  assert(language.guidance({ subject: '人物', reasons: ['年龄特征不一致'], scores: [] }).some(item => item.includes('该人物年龄')));
  assert(language.guidance({ subject: '场景', reasons: ['材质和光线不匹配'], scores: [] }).some(item => item.includes('材质 / 色彩 / 光线')));
  assert(language.guidance({ subject: '场景', tone: 'unavailable' })[0].includes('无需修改'));

  const invoked = [];
  const schedule = await keyframeScheduler.runSchedule({
    indexes: [0, 1, 2],
    concurrency: 1,
    worker: async index => {
      invoked.push(index);
      return index === 0
        ? { index, failed: true, usable: false, stop_remaining: true, stop_code: 'PROVIDER_5XX_AMBIGUOUS' }
        : { index, failed: false, usable: true };
    },
  });
  assert.deepStrictEqual(invoked, [0]);
  assert.strictEqual(schedule.results.filter(item => item.error_code === 'KEYFRAME_BATCH_CIRCUIT_OPEN').length, 2);

  const sceneAssistSource = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterAssist.js'), 'utf8');
  const subjectUiSource = fs.readFileSync(path.join(root, 'public/js/new-story-ad/subject-assets-ui.js'), 'utf8');
  assert.match(sceneAssistSource, /preserve_current_scene_fields:\s*false/);
  assert.match(subjectUiSource, /applyPersonSpecAuthority/);
  console.log(JSON.stringify({
    status: 'PASS',
    age_authority: true,
    per_person_age: true,
    scene_fill_missing_authority: true,
    stale_scene_description_excluded: true,
    field_guidance: true,
    keyframe_batch_circuit: true,
    real_model_calls: 0,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
