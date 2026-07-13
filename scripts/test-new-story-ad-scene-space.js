const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'new-story-ad-scene-space-test');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_MOCK_IMAGE = '1';
process.env.NEW_STORY_AD_MOCK_LLM = '1';
process.env.NEW_STORY_AD_PUBLIC_BASE_URL = 'https://test.invalid';

const storage = require('../src/services/newStoryAd/storageService');
const service = require('../src/services/newStoryAd/storyAdService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const sceneBinding = require('../src/services/newStoryAd/sceneBindingService');
const revision = require('../src/services/newStoryAd/revisionService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');

async function main() {
  const created = service.createTask({
    brief: '为当前任务生成具有连续行动和可见结果的通用剧情广告',
    product_subject: '当前任务主体',
    duration: 18,
    cast_mode: 'single',
    scene_spec: {
      layoutText: '按当前任务动态形成主展示区、行动区与背景层次',
      materialLightText: '按当前任务动态选择真实材质与自然商业布光',
      interactionText: '保留可执行动作区域和连续摄影机路径',
    },
  }, { id: 'scene-space-test-user' });
  const taskId = created.task.id;

  const generated = await sceneAssets.generateSceneAsset(taskId, {
    name: '当前任务动态场景',
    aspect_ratio: '16:9',
  });
  const asset = generated.scene_asset;
  assert.equal(asset.view_images.length, 4, '必须生成四个独立场景视图');
  assert.deepEqual(asset.view_images.map(view => view.key), ['master', 'reverse', 'interaction', 'detail']);
  assert.equal(new Set(asset.view_images.map(view => view.url)).size, 4, '四视图不能再由同一结果冒充');
  assert.equal(asset.scene_revision, 1);
  assert.equal(asset.scene_contract.status, 'verified');
  assert.equal(asset.scene_contract.cross_view_qa.pass, true);

  const secondAsset = {
    ...asset,
    id: 'unrelated_second_scene',
    scene_id: 'unrelated_second_scene',
    scene_revision: 3,
  };
  const bound = sceneBinding.bindShotsToScenes([
    { title: '建立空间', visual: '展示完整空间和主体关系', action: '镜头建立整体关系', scene_id: asset.scene_id, scene_revision: 1 },
    { title: '执行动作', visual: '主体在行动区完成操作', action: '进行明确互动和操作', scene_id: asset.scene_id, scene_revision: 1 },
    { title: '读取细节', visual: '读取当前材质与结果细节', action: '镜头靠近观察细节', scene_id: asset.scene_id, scene_revision: 1 },
  ], [asset, secondAsset]);
  assert(bound.every(shot => shot.scene_id === asset.scene_id), '未指定场景时不能按镜头序号轮换到其他场景');
  assert.equal(bound[0].scene_view, 'master');
  assert.equal(bound[1].scene_view, 'interaction');
  assert.equal(bound[2].scene_view, 'detail');
  assert(bound.every(shot => shot.scene_revision === 1));
  assert(bound.every(shot => shot.camera_id));

  storage.saveOutput(taskId, 'storyboard_table', bound.slice(0, 2));
  storage.saveOutput(taskId, 'blueprint', { story_title: '旧人物版本剧本' });
  storage.saveOutput(taskId, 'keyframes', [{ image_url: '/old-frame.png', qa: { pass: true } }]);
  const beforeScene = storage.getOutput(taskId, 'scene_assets');
  const updated = service.updateTaskRequest(taskId, {
    ...storage.getOutput(taskId, 'context'),
    change_scope: 'person',
    person_asset: {
      id: 'dynamic-person-revision-2',
      name: '当前任务人物',
      image_url: '/api/new-story-ad/assets/dynamic-person.png',
      real_person_reference: true,
      view_images: ['front', 'side', 'back', 'action'].map(key => ({ key, url: `https://test.invalid/${key}.png` })),
      person_contract: {
        status: 'verified',
        person_revision: 2,
        cross_view_qa: { pass: true, identity_score: 0.95, age_score: 0.95, wardrobe_score: 0.95, body_score: 0.95, mismatch_reasons: [] },
      },
    },
    person_contract: {
      status: 'verified',
      person_revision: 2,
      cross_view_qa: { pass: true, identity_score: 0.95, age_score: 0.95, wardrobe_score: 0.95, body_score: 0.95, mismatch_reasons: [] },
    },
  }, { id: 'scene-space-test-user' });
  assert.equal(updated.change_scope, 'person');
  assert.equal(updated.context.revisions.person, 2);
  assert.equal(updated.context.revisions.scene, 1);
  assert.deepEqual(storage.getOutput(taskId, 'scene_assets'), beforeScene, '人物更新必须保留场景资产');
  assert.equal(storage.getOutput(taskId, 'blueprint'), null, '人物更新必须失效旧剧本');
  assert.equal(storage.getOutput(taskId, 'keyframes'), null, '人物更新必须失效旧关键帧');

  const rebound = sceneBinding.bindShotsToScenes(bound.slice(0, 2), beforeScene);
  storage.saveOutput(taskId, 'storyboard_table', rebound);
  const keyframeResult = await service.generateKeyframesStage(taskId, { max_scene_retries: 1 });
  assert.equal(keyframeResult.keyframes.length, 2);
  keyframeResult.keyframes.forEach(frame => {
    assert.equal(frame.qa.pass, true);
    assert.equal(frame.reference_mode, 'strict_scene_reference');
    assert(frame.reference_count >= 1);
    assert.equal(frame.reference_preserving, false, 'mock provider must not pretend it performed real reference preservation');
    assert(Array.isArray(frame.candidates) && frame.candidates.length >= 1, '关键帧必须保留候选审片记录');
  });
  const selected = service.selectKeyframeCandidate(taskId, 0, keyframeResult.keyframes[0].candidates[0].id);
  assert.equal(selected.keyframe.selected_candidate_id, keyframeResult.keyframes[0].candidates[0].id);

  assert.equal(mediaAdapter.supportsReferenceImages({
    family: 'deyunai',
    adapter: 'deyunai',
    providerId: 'deyunai',
    provider: {},
  }), true);
  assert.equal(mediaAdapter.supportsReferenceImages({
    family: 'openai-compatible',
    adapter: 'openai-compatible',
    providerId: 'generic',
    provider: {},
  }), false);

  const originalVision = modelGateway.generateVision;
  modelGateway.generateVision = async () => ({
    text: JSON.stringify({
      pass: true,
      scene_consistency_score: 0.4,
      anchor_consistency_score: 0.5,
      camera_match_score: 0.4,
      material_match_score: 0.5,
      mismatch_reasons: ['dynamic spatial mismatch'],
      forbidden_new_elements: [],
    }),
    used_model: 'mock/forced-failure',
  });
  const rejectedQa = await sceneSpace.reviewKeyframe({
    taskId,
    sceneReferenceUrl: 'https://test.invalid/reference.png',
    generatedUrl: 'https://test.invalid/generated.png',
    contract: asset.scene_contract,
    shot: bound[0],
  });
  modelGateway.generateVision = originalVision;
  assert.equal(rejectedQa.pass, false, '低于阈值的场景 QA 必须真实失败');
  assert.equal(rejectedQa.status, 'failed');

  const invalidated = [];
  revision.invalidateOutputs({ deleteOutput: (_taskId, kind) => invalidated.push(kind) }, taskId, 'person');
  assert(!invalidated.includes('scene_assets'));
  assert(invalidated.includes('keyframes'));

  console.log(JSON.stringify({
    success: true,
    task_id: taskId,
    scene_revision: asset.scene_revision,
    views: asset.view_images.map(view => view.key),
    bound_views: bound.map(shot => shot.scene_view),
    person_scene_preserved: true,
    keyframe_qa_passed: keyframeResult.keyframes.length,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});
