const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'story-ad-initial-scene-plan-v230s');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const modelGateway = require('../src/services/newStoryAd/modelGateway');
const storage = require('../src/services/newStoryAd/storageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const sceneWorkflow = require('../src/services/storyAdWorkspace/sceneWorkflowProjectionService');
const authorityLifecycle = require('../src/services/newStoryAd/authorityLifecycleService');

const projectedPreview = sceneWorkflow.projectBundleState([], { asset_setup_confirmed: true }, { blueprint: { beats: [
  { title: '进入展厅', scene: '现代展示空间', visual: '人物走入展厅', action: '沿通道前进' },
  { title: '触摸纹理', scene: '展示墙前', visual: '人物触摸金属纹理', action: '手指划过表面' },
] } });
assert.equal(projectedPreview.scene_workflow.estimated_count, 2);
assert.equal(projectedPreview.scene_workflow.preview_scenes.length, 2);
assert.equal(projectedPreview.scene_workflow.initialization_required, true);
assert(projectedPreview.scene_workflow.preview_scenes.every(scene => scene.generation_prompt));

const taskId = 'initial-scene-plan-v230s';
const profile = {
  id: 'person-1', name: '陈默', displayName: '陈默', role: '空间体验者', age: '30岁', ethnicity: '东亚原创人物设计', asset_scope: 'primary',
  appearanceText: '椭圆脸与自然眉眼，五官和鼻唇比例清晰，身形匀称挺拔且肩线自然，肤色与皮肤质感真实，神态安静专注、目光稳定，整体具有可持续识别的现代职业气质。',
  wardrobeText: '米白色棉质短袖T恤上衣搭配深灰色精纺直筒长裤和黑色皮革低跟鞋，服装颜色克制、材质层次清楚，保持无配饰状态，不佩戴未经设定的眼镜、首饰或手表。',
  hairMakeupText: '黑色齐肩直发发型采用自然中分缝，底妆与肤质清透，眉眼妆容克制、唇色自然，不佩戴眼镜、发饰、帽子或夸张首饰。',
  negativeText: '禁止改变人物年龄、脸型、五官、发型、服装颜色和鞋履；禁止发带、帽子、夸张首饰、多余肢体、畸形手指和塑料皮肤。',
  look_profiles: [{ id: 'look-1', name: '展示空间造型', wardrobeText: '米白色短袖、深灰直筒裤和黑色低跟鞋', hairMakeupText: '黑色齐肩直发与自然妆面', negativeText: '禁止发带、帽子和服装换色' }],
};
const context = {
  content_mode: 'commercial_subject', brief: '陈默在现代不锈钢展示空间触摸展示墙，突出精致金属纹理。',
  product_subject: '不锈钢材料', target_duration: 30, output_ratio: '16:9',
  cast_profiles: [profile], narrative_cast_profiles: [profile], prop_plan: [], asset_setup_confirmed: true,
};
storage.createTask({ id: taskId, title: '首次场景补齐回归', brief: context.brief, request: context, content_revision: 1, status: 'done' });
storage.saveOutput(taskId, 'context', context);
assetPlan.persistIndependentPersonProfiles(taskId, [profile], { source: 'test', model_meta: { model_call_count: 0 } });

const partial = require('../src/services/newStoryAd/assetPlanPublicationService').currentPlan(taskId);
assert.equal(assetPlan.complete(partial, storage.getOutput(taskId, 'context')), false);
assert.equal(assetPlan.initialScenePlanSource(partial, storage.getOutput(taskId, 'context')), true);
const generationId = 'initial-scene-plan-job';
storage.createGenerationRun({
  id: 'initial-scene-plan-unit', task_id: taskId, work_id: taskId, domain: 'scene_plan', operation: 'run_scene_plan',
  orchestration_job_id: generationId, state: 'running', unit_version: 1, billing_state: 'not_submitted', provider_submission_state: 'not_applicable',
});
assert.equal(authorityLifecycle.promotionBlockers(taskId, { scene_plan_authority: true, generation_id: generationId }).length, 0,
  'the current scene-plan generation must not block its own authority promotion');
storage.createGenerationRun({
  id: 'unrelated-scene-plan-unit', task_id: taskId, work_id: taskId, domain: 'scene_plan', operation: 'run_scene_plan',
  orchestration_job_id: 'another-job', state: 'running', unit_version: 1, billing_state: 'not_submitted', provider_submission_state: 'not_applicable',
});
assert.equal(authorityLifecycle.promotionBlockers(taskId, { scene_plan_authority: true, generation_id: generationId }).length, 1,
  'an unrelated active scene-plan generation must remain a promotion blocker');
storage.updateGenerationRun('unrelated-scene-plan-unit', { state: 'failed_terminal' });

const originalGenerateText = modelGateway.generateText;
let modelCalls = 0;
modelGateway.generateText = async ({ userPrompt = '' }) => {
  modelCalls += 1;
  const request = JSON.parse(userPrompt);
  const section = request.required_missing_sections[0];
  const value = section === 'scene_plan' ? {
    business_boundary: '不锈钢材料广告', advertised_subject: '不锈钢材料', cast_mode: 'single', scene_mode: 'single',
    spaces: [{ id: 'showroom', name: '现代不锈钢展示空间', description: '陈默在现代不锈钢展示空间触摸展示墙', story_purpose: '展示精致金属纹理', scene_spec: { layoutText: '固定入口、展示墙与中央通道', materialLightText: '灰色空间、柔和侧光与金属反射', interactionText: '陈默沿通道走到展示墙并触摸纹理', negativeText: '禁止新增其它地点、人物和商品', storyStates: [], interactionAnchors: [], routes: [], propPlacements: [] } }],
    asset_strategy: [], story_strategy: [], forbidden: [], suggested_shot_count: 5,
  } : { logline: '陈默在现代不锈钢展示空间触摸展示墙并呈现金属纹理。', opening: '进入展示空间', development: '触摸展示墙', turning_point: '光线呈现纹理', resolution: '完成材料认知' };
  return { text: JSON.stringify({ required_missing_sections: [section], section_patch: { section, value } }), used_model: 'mock/scene-plan', fallback_used: false, failed_models: [] };
};

(async () => {
  try {
    const scenePlan = await assetPlan.replanScene(taskId, { generation_id: generationId });
    const saved = require('../src/services/newStoryAd/assetPlanPublicationService').currentPlan(taskId);
    assert.equal(scenePlan.spaces.length, 1);
    assert.equal(saved.cast_profiles[0].id, 'person-1');
    assert.equal(saved.cast_profiles[0].appearanceText, profile.appearanceText);
    assert.equal(storage.getOutput(taskId, 'scene_config').spaces.length, 1);
    assert.equal(storage.getTask(taskId).stage, 'scene_config_done');
    assert.equal(storage.getTask(taskId).error || '', '');
    assert.equal(storage.getGenerationRun('initial-scene-plan-unit').authority_id, storage.getTask(taskId).active_authority_id,
      'the owned scene-plan generation must be rebound to the newly active authority');
    assert.equal(modelCalls, 2, '首次场景补齐只能调用缺失的 scene_plan 与 story_seed 两段');
    console.log(JSON.stringify({ success: true, reproduced_error: 'scene_plan_self_blocked_authority_promotion', recovered_sections: ['scene_plan', 'story_seed'], preserved_person: true, owned_generation_rebound: true, unrelated_generation_blocked: true, model_calls: modelCalls }, null, 2));
  } finally {
    modelGateway.generateText = originalGenerateText;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
