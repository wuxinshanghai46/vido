#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-scene-prompt-authority-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const releaseBundle = require('../src/services/storyAdReleaseBundleService');
const prompts = require('../src/services/newStoryAd/scenePromptConfirmationService');
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
  const taskId = 'scene-prompt-authority-contract-task';
  const identity = releaseBundle.identity();
  storage.createTask({
    id: taskId,
    status: 'done',
    stage: 'scene_config_done',
    user_id: 'owner-1',
    request: { brief: '场景提示词权威合同回归' },
    content_revision: 1,
    current_snapshot_id: `${taskId}:r1:snapshot`,
    lineage_enforced: true,
  });
  storage.updateTask(taskId, { required_bundle_id: identity.bundle_id });
  const firstPlan = { revision: 3, spaces: [scene('scene-a', '高级家居展厅'), scene('scene-b', '商业展台')] };
  storage.saveOutput(taskId, 'scene_config', firstPlan, { content_revision: 1, snapshot_id: `${taskId}:r1:snapshot` });

  const initial = prompts.currentState(taskId, 'scene-a');
  assert.equal(initial.projection.authoritative, true);
  assert.equal(initial.projection.saved, true);
  assert.match(initial.descriptor.prompt_version_id, /^[a-f0-9]{64}$/);
  assert.equal(prompts.assertCurrentPrompt(taskId, 'scene-a').prompt_version_id, initial.descriptor.prompt_version_id,
    'the generated scene may immediately use the current prompt without a confirmation receipt');
  storage.updateTask(taskId, {
    current_snapshot_id: `${taskId}:r1:queue-snapshot`,
    required_bundle_id: 'new-execution-release-identity',
  });
  const afterExecutionLineageChange = prompts.currentState(taskId, 'scene-a');
  assert.equal(afterExecutionLineageChange.descriptor.prompt_version_id, initial.descriptor.prompt_version_id,
    'queue snapshots and release identities must not make unchanged saved prompt content stale');

  const editedPrompt = 'USER_EDITED_SCENE_PROMPT：清晨的高级家居展厅保持完整入口、连续不锈钢展示墙、明确互动区和真实侧向柔光。';
  assert.throws(
    () => prompts.savePromptOverride(taskId, 'scene-a', { base_prompt_version_id: 'stale', generation_prompt: editedPrompt }),
    error => error.code === 'SCENE_PROMPT_EDIT_CONFLICT',
  );
  const saved = prompts.savePromptOverride(taskId, 'scene-a', {
    base_prompt_version_id: initial.descriptor.prompt_version_id,
    generation_prompt: editedPrompt,
  }, { id: 'owner-1' });
  assert.equal(saved.prompt, editedPrompt);
  assert.equal(saved.projection.authoritative, true);
  assert.equal(saved.projection.prompt_source, 'user_override');
  assert.notEqual(saved.descriptor.prompt_version_id, initial.descriptor.prompt_version_id);
  assert.equal(prompts.assertCurrentPrompt(taskId, 'scene-a').generation_prompt, editedPrompt,
    'saving is sufficient to make the edit authoritative for direct generation');

  assert.throws(
    () => prompts.savePromptOverride(taskId, 'scene-a', {
      base_prompt_version_id: initial.descriptor.prompt_version_id,
      generation_prompt: `${editedPrompt} 另一窗口覆盖`,
    }),
    error => error.code === 'SCENE_PROMPT_EDIT_CONFLICT',
    'two editors using one base version must not overwrite the first successful save',
  );

  const target = {
    scene_id: 'scene-a',
    space_id: 'scene-a',
    scene_spec: firstPlan.spaces[0].scene_spec,
    space: firstPlan.spaces[0],
  };
  const generationBody = sceneAssets.authoritativeSceneGenerationBody(
    { prompt: 'FORGED_REQUEST_PROMPT', description: 'FORGED_REQUEST_DESCRIPTION' },
    target,
    prompts.assertCurrentPrompt(taskId, 'scene-a'),
  );
  assert.equal(generationBody.prompt, editedPrompt,
    'derived scene descriptions and request fields must not overwrite the saved prompt');
  assert.notEqual(generationBody.description, editedPrompt,
    'structural scene description must remain a separate field');
  const providerPrompt = sceneVisualPrompt.buildSceneSheetPrompt({ ctx: {}, sceneConfig: {}, body: generationBody });
  assert(providerPrompt.includes(editedPrompt), 'the real provider prompt construction must contain the exact saved edit');
  assert(!providerPrompt.includes('FORGED_REQUEST_PROMPT'), 'the request prompt must not bypass current prompt authority');

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

  let mediaCalls = 0;
  let modelCalls = 0;
  let businessWrites = 0;
  const originals = {
    image: mediaAdapter.generateImage,
    text: modelGateway.generateText,
    saveOutput: storage.saveOutput,
    saveStage: storage.saveStage,
    updateTask: storage.updateTask,
  };
  mediaAdapter.generateImage = async () => { mediaCalls += 1; return {}; };
  modelGateway.generateText = async () => { modelCalls += 1; return {}; };
  storage.saveOutput = (...args) => { businessWrites += 1; return originals.saveOutput(...args); };
  storage.saveStage = (...args) => { businessWrites += 1; return originals.saveStage(...args); };
  storage.updateTask = (...args) => { businessWrites += 1; return originals.updateTask(...args); };
  try {
    assert.throws(
      () => prompts.confirm(taskId, 'scene-a', { confirmation_id: saved.descriptor.prompt_version_id }),
      error => error.code === 'LEGACY_SCENE_PROMPT_CONFIRMATION_DISABLED' && error.status === 410 && error.retryable === false,
    );
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(taskId, { scene_id: 'scene-a', prompt_version_id: initial.descriptor.prompt_version_id }),
      error => error.code === 'SCENE_PROMPT_VERSION_STALE' && error.status === 409,
    );
    await assert.rejects(
      () => sceneAssets.repairSceneAsset(taskId, 'scene-a', { prompt_version_id: initial.descriptor.prompt_version_id }),
      error => error.code === 'SCENE_PROMPT_VERSION_STALE',
    );
    await assert.rejects(
      () => panoramas.generateScenePanorama(taskId, 'scene-a', { prompt_version_id: initial.descriptor.prompt_version_id }),
      error => error.code === 'SCENE_PROMPT_VERSION_STALE',
    );
    await assert.rejects(
      () => panoramas.generateTaskPanoramas(taskId, { prompt_version_ids: { 'scene-a': initial.descriptor.prompt_version_id } }),
      error => error.code === 'SCENE_PROMPT_VERSION_STALE',
    );
  } finally {
    mediaAdapter.generateImage = originals.image;
    modelGateway.generateText = originals.text;
    storage.saveOutput = originals.saveOutput;
    storage.saveStage = originals.saveStage;
    storage.updateTask = originals.updateTask;
  }
  assert.equal(mediaCalls, 0, 'stale prompt versions must stop before paid media calls');
  assert.equal(modelCalls, 0, 'stale prompt versions must stop before model calls');
  assert.equal(businessWrites, 0, 'stale prompt versions and the legacy confirmation service must not persist state');

  storage.saveOutput(taskId, 'scene_config', {
    revision: 4,
    spaces: [scene('scene-a', '高级家居展厅', '，改为清晨侧光'), firstPlan.spaces[1]],
  }, { content_revision: 1, snapshot_id: `${taskId}:r1:snapshot` });
  const replanned = prompts.currentState(taskId, 'scene-a');
  assert.equal(replanned.prompt_source, 'scene_plan', 'a changed scene plan must invalidate the saved override');
  assert.notEqual(replanned.descriptor.prompt_version_id, saved.descriptor.prompt_version_id);

  console.log(JSON.stringify({
    passed: true,
    save_is_authority: true,
    legacy_confirmation_status: 410,
    concurrent_cas_conflicts: 1,
    stale_direct_operations_blocked: 4,
    provider_prompt_preserved: true,
    model_calls: modelCalls,
    media_calls: mediaCalls,
    business_writes: businessWrites,
  }));
}

main().finally(() => fs.rmSync(tempDir, { recursive: true, force: true })).catch(error => {
  console.error(error);
  process.exit(1);
});
