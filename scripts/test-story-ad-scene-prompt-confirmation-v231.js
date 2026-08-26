#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-scene-prompt-confirmation-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const releaseBundle = require('../src/services/storyAdReleaseBundleService');
const confirmations = require('../src/services/newStoryAd/scenePromptConfirmationService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const panoramas = require('../src/services/newStoryAd/scenePanoramaService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const sceneVisualPrompt = require('../src/services/newStoryAd/sceneVisualPromptService');

function scene(id, name, suffix = '') {
  return {
    id,
    name,
    description: `${name}承担产品材质、人物触摸动作与空间关系的完整叙事展示${suffix}`,
    story_purpose: `证明${name}的材料质感与实际使用体验${suffix}`,
    generation_prompt: `${name}，真实商业空间，稳定空间比例，呈现不锈钢材质和人物触摸互动${suffix}`,
    scene_spec: {
      layoutText: `完整描述${name}的入口、展示墙、互动区和纵深关系，固定主要物体位置${suffix}`,
      materialLightText: `不锈钢蚀刻、拉丝与做旧表面接受侧向柔光，保留真实高光层次${suffix}`,
      interactionText: `人物沿展示墙缓慢移动，在指定互动区触摸材料并观察反射变化${suffix}`,
      negativeText: `禁止改变空间结构、材质纹理、人物身份、比例关系和固定锚点${suffix}`,
      cameraPlan: [{ id: `${id}-cam`, label: '主机位', framing: '全景', movement: '缓慢推进' }],
    },
  };
}

async function main() {
  const taskId = 'scene-confirmation-contract-task';
  const identity = releaseBundle.identity();
  storage.createTask({
    id: taskId,
    status: 'done',
    stage: 'scene_config_done',
    user_id: 'owner-1',
    request: { brief: '场景确认合同回归' },
    content_revision: 1,
    current_snapshot_id: `${taskId}:r1:snapshot`,
    lineage_enforced: true,
  });
  storage.updateTask(taskId, { required_bundle_id: identity.bundle_id });
  const firstPlan = { revision: 3, spaces: [scene('scene-a', '高级家居展厅'), scene('scene-b', '商业展台')] };
  storage.saveOutput(taskId, 'scene_config', firstPlan, { content_revision: 1, snapshot_id: `${taskId}:r1:snapshot` });

  const descriptorA = confirmations.authoritativeDescriptor(taskId, 'scene-a').descriptor;
  const descriptorB = confirmations.authoritativeDescriptor(taskId, 'scene-b').descriptor;
  assert.equal(confirmations.project(taskId, 'scene-a').confirmed, false);
  assert.throws(() => confirmations.assertConfirmed(taskId, 'scene-a'), error => error.code === 'SCENE_PROMPT_CONFIRMATION_REQUIRED');
  assert.throws(() => confirmations.confirm(taskId, 'scene-a', { confirmation_id: 'stale' }), error => error.code === 'SCENE_PROMPT_CHANGED');

  const receiptA = confirmations.confirm(taskId, 'scene-a', { confirmation_id: descriptorA.confirmation_id }, { id: 'owner-1' });
  const duplicateA = confirmations.confirm(taskId, 'scene-a', { confirmation_id: descriptorA.confirmation_id }, { id: 'owner-1' });
  assert.equal(receiptA.confirmed, true);
  assert.equal(duplicateA.duplicate, true);
  assert.equal(duplicateA.confirmed_at, receiptA.confirmed_at, 'duplicate confirmation must preserve the original timestamp');
  assert.equal(confirmations.assertConfirmed(taskId, 'scene-a').confirmation_id, descriptorA.confirmation_id);

  const editedPrompt = 'USER_EDITED_SCENE_PROMPT：清晨的高级家居展厅保持完整入口、连续不锈钢展示墙、明确互动区和真实侧向柔光。';
  assert.throws(
    () => confirmations.savePromptOverride(taskId, 'scene-a', { base_confirmation_id: 'stale', generation_prompt: editedPrompt }),
    error => error.code === 'SCENE_PROMPT_EDIT_CONFLICT',
  );
  assert.throws(
    () => confirmations.savePromptOverride(taskId, 'scene-a', { base_confirmation_id: descriptorA.confirmation_id, generation_prompt: '过短提示词' }),
    error => error.code === 'SCENE_PROMPT_TOO_SHORT',
  );
  storage.updateTask(taskId, { active_generation_id: 'generation-active' });
  assert.throws(
    () => confirmations.savePromptOverride(taskId, 'scene-a', { base_confirmation_id: descriptorA.confirmation_id, generation_prompt: editedPrompt }),
    error => error.code === 'SCENE_PROMPT_EDIT_ACTIVE_GENERATION',
  );
  storage.updateTask(taskId, { active_generation_id: '' });
  const editedState = confirmations.savePromptOverride(taskId, 'scene-a', {
    base_confirmation_id: descriptorA.confirmation_id,
    generation_prompt: editedPrompt,
  }, { id: 'owner-1' });
  assert.equal(editedState.prompt, editedPrompt);
  assert.equal(editedState.projection.prompt_source, 'user_override');
  assert.equal(editedState.projection.confirmed, false, 'saving an edit must invalidate the previous confirmation');
  assert.throws(() => confirmations.assertConfirmed(taskId, 'scene-a'), error => error.code === 'SCENE_PROMPT_CONFIRMATION_REQUIRED');
  const editedReceipt = confirmations.confirm(taskId, 'scene-a', {
    confirmation_id: editedState.descriptor.confirmation_id,
  }, { id: 'owner-1' });
  assert.equal(editedReceipt.generation_prompt, editedPrompt);
  assert.match(sceneVisualPrompt.buildSceneSheetPrompt({
    ctx: {}, sceneConfig: {}, body: { prompt: editedReceipt.generation_prompt, scene_spec: firstPlan.spaces[0].scene_spec },
  }), /USER_EDITED_SCENE_PROMPT/, 'the paid visual prompt must consume the saved authoritative edit');

  const receiptB = confirmations.confirm(taskId, 'scene-b', { confirmation_id: descriptorB.confirmation_id }, { id: 'owner-1' });
  assert.equal(receiptB.confirmed, true);
  assert.notEqual(confirmations.outputKind('scene-a'), confirmations.outputKind('scene-b'));
  assert(storage.getOutput(taskId, confirmations.outputKind('scene-a')));
  assert(storage.getOutput(taskId, confirmations.outputKind('scene-b')));

  storage.saveOutput(taskId, 'scene_config', {
    revision: 4,
    spaces: [scene('scene-a', '高级家居展厅', '，改为清晨侧光'), firstPlan.spaces[1]],
  }, { content_revision: 1, snapshot_id: `${taskId}:r1:snapshot` });
  assert.equal(confirmations.project(taskId, 'scene-a').confirmed, false, 'prompt edits must invalidate the old receipt');
  assert.equal(confirmations.project(taskId, 'scene-a').prompt_source, 'scene_plan', 'a changed scene plan must invalidate the saved override');
  assert.equal(confirmations.project(taskId, 'scene-b').confirmed, false, 'strict scene-config lineage changes invalidate old bundle receipts');
  storage.saveOutput(taskId, 'scene_assets', [{
    id: 'scene-a',
    scene_id: 'scene-a',
    space_id: 'scene-a',
    name: '高级家居展厅',
    image_url: '/api/new-story-ad/assets/scene-a-master.png',
    view_images: [{ key: 'master', image_url: '/api/new-story-ad/assets/scene-a-master.png' }],
    layout_summary: '完整场景布局',
    material_summary: '不锈钢材料与侧向柔光',
    interaction_summary: '人物触摸材料展示反射变化',
    scene_revision: 1,
    generation_contract_version: 7,
  }], { content_revision: 1, snapshot_id: `${taskId}:r1:snapshot` });

  let imageCalls = 0;
  let modelCalls = 0;
  const originalImage = mediaAdapter.generateImage;
  const originalText = modelGateway.generateText;
  mediaAdapter.generateImage = async () => { imageCalls += 1; return {}; };
  modelGateway.generateText = async () => { modelCalls += 1; return {}; };
  try {
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(taskId, { scene_id: 'scene-a' }),
      error => error.code === 'SCENE_PROMPT_CONFIRMATION_REQUIRED',
    );
    await assert.rejects(
      () => sceneAssets.repairSceneAsset(taskId, 'scene-a', {}),
      error => error.code === 'SCENE_PROMPT_CONFIRMATION_REQUIRED',
    );
    await assert.rejects(
      () => panoramas.generateScenePanorama(taskId, 'scene-a', {}),
      error => error.code === 'SCENE_PROMPT_CONFIRMATION_REQUIRED',
    );
    await assert.rejects(
      () => panoramas.generateTaskPanoramas(taskId, {}, {}, { imageGenerator: async () => { imageCalls += 1; } }),
      error => error.code === 'SCENE_PROMPT_CONFIRMATION_REQUIRED',
    );
  } finally {
    mediaAdapter.generateImage = originalImage;
    modelGateway.generateText = originalText;
  }
  assert.equal(imageCalls, 0, 'unconfirmed scene operations must stop before media calls');
  assert.equal(modelCalls, 0, 'unconfirmed scene operations must stop before model calls');

  const outputKinds = storage.listOutputs(taskId).map(row => row.kind);
  assert(outputKinds.includes(confirmations.outputKind('scene-a')));
  assert(outputKinds.includes(confirmations.outputKind('scene-b')));
  console.log(JSON.stringify({
    passed: true,
    independent_receipts: 2,
    stale_receipts_blocked: 2,
    editable_prompt_override: true,
    direct_scene_operations_blocked: 4,
    model_calls: modelCalls,
    media_calls: imageCalls,
  }));
}

main().finally(() => fs.rmSync(tempDir, { recursive: true, force: true })).catch(error => {
  console.error(error);
  process.exit(1);
});
