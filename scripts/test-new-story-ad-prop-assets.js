const assert = require('assert');
const fs = require('fs');
const path = require('path');
const propAssets = require('../src/services/newStoryAd/propAssetService');
const propIdentity = require('../src/services/newStoryAd/propIdentityContractService');
const propReferences = require('../src/services/newStoryAd/propReferenceService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');

function harness() {
  const outputs = new Map();
  let calls = 0;
  const prompts = [];
  const storage = {
    getOutput(taskId, kind) {
      return outputs.get(`${taskId}:${kind}`) || null;
    },
    saveOutput(taskId, kind, value) {
      outputs.set(`${taskId}:${kind}`, JSON.parse(JSON.stringify(value)));
      return value;
    },
  };
  const mediaAdapter = {
    async generateImage(options) {
      calls += 1;
      prompts.push(options.prompt);
      await options.onSubmitting?.();
      await options.onSubmitted?.({ providerRequestId: `request-${calls}`, taskId: `provider-${calls}` });
      return {
        image_url: `/atlas/${options.filename}.png`,
        filename: `${options.filename}.png`,
        provider_used: 'mock/image',
      };
    },
    async splitReferenceSheet({ filenamePrefix, viewKeys }) {
      return viewKeys.map(key => ({
        key,
        label: key,
        url: `/views/${filenamePrefix}_${key}.png`,
        image_url: `/views/${filenamePrefix}_${key}.png`,
        filename: `${filenamePrefix}_${key}.png`,
      }));
    },
  };
  return { storage, mediaAdapter, calls: () => calls, prompts };
}

(async () => {
  const taskId = 'prop-task';
  const run = harness();
  run.storage.saveOutput(taskId, 'context', { brief: '人物拿起钥匙开门', prop_assets: [] });
  run.storage.saveOutput(taskId, 'storyboard_table', [
    { shot_index: 0, scene_id: 'hall', visual: '钥匙放在玄关托盘' },
    {
      shot_index: 1,
      scene_id: 'hall',
      action: '人物拿起钥匙',
      prop_contact: '右手拇指和食指捏住钥匙柄',
      prop_states: { key: '拿起' },
    },
  ]);
  const stateful = await propAssets.generatePropAsset(taskId, {
    id: 'key',
    name: '银色钥匙',
    type: 'story_prop',
    description: '带圆角黑色钥匙柄和一枚银色钥匙齿',
    material: '拉丝银色金属与哑光黑色塑料',
    scale: '掌心大小',
    quantity: 1,
    scene_id: 'hall',
    placement: '玄关托盘中央',
    states: ['放置', '拿起'],
  }, run);
  assert.strictEqual(run.calls(), 2);
  assert.strictEqual(stateful.view_images.length, 4);
  assert.strictEqual(stateful.state_views.length, 2);
  assert.strictEqual(stateful.shot_timeline.length, 2);
  assert.strictEqual(stateful.shot_timeline[1].state, '拿起');
  assert.strictEqual(stateful.generation_summary.planned_provider_calls, 2);
  assert(run.prompts[1].includes('physically plausible neutral hand contact'));
  assert(run.prompts[1].includes('resting placement'));
  assert(!run.prompts[1].includes('No person, hand'));

  const resumed = await propAssets.generatePropAsset(taskId, {
    ...stateful,
    reference_image_url: '',
  }, run);
  assert.strictEqual(run.calls(), 2, 'completed prop units must not be resubmitted');
  assert.strictEqual(resumed.generation_summary.provider_calls_this_run, 0);
  assert.strictEqual(resumed.generation_summary.checkpoint_hits, 2);

  const identityUrlsBeforeStateRevalidation = resumed.view_images.map(item => item.image_url);
  const revalidated = await propAssets.regeneratePropStates(taskId, {
    prop_id: 'key',
    state_revision: 2,
  }, run);
  assert.strictEqual(run.calls(), 3, 'state-only revalidation must use exactly one provider call');
  assert.deepStrictEqual(
    revalidated.view_images.map(item => item.image_url),
    identityUrlsBeforeStateRevalidation,
    'state-only revalidation must preserve identity views',
  );
  assert.strictEqual(revalidated.state_views.length, 2);
  assert.strictEqual(revalidated.state_revision, 2);
  assert.strictEqual(revalidated.state_revalidation.provider_calls_this_run, 1);

  const revalidatedAgain = await propAssets.regeneratePropStates(taskId, {
    prop_id: 'key',
    state_revision: 2,
  }, run);
  assert.strictEqual(run.calls(), 3, 'repeating the same state revision must reuse its checkpoint');
  assert.strictEqual(revalidatedAgain.state_revalidation.provider_calls_this_run, 0);
  assert.strictEqual(revalidatedAgain.state_revalidation.checkpoint_hits, 1);

  const staticProp = await propAssets.generatePropAsset(taskId, {
    id: 'cup',
    name: '透明玻璃杯',
    description: '直筒透明玻璃杯',
    material: '透明玻璃',
  }, run);
  assert.strictEqual(run.calls(), 4);
  assert.strictEqual(staticProp.generation_summary.planned_provider_calls, 1);

  assert.strictEqual(propIdentity.inferType({ name: '腕表配饰' }), 'wearable_accessory');
  await assert.rejects(() => propAssets.generatePropAsset(taskId, {
    id: 'door',
    name: '固定玻璃门',
    type: 'fixed_scene_object',
    description: '入口固定门',
  }, run), error => error.code === 'FIXED_SCENE_OBJECT_USES_SCENE_CONTRACT');

  const refs = propReferences.selectPropReference([stateful], {
    shot_index: 1,
    action: '拿起银色钥匙',
    prop_ids: ['key'],
  });
  assert.strictEqual(refs.length, 1);
  assert(refs[0].includes('拿起'));

  const structured = sceneAssets.sceneStructuredContract({
    storyStates: [{ id: 'before', state_before: ['钥匙在托盘'] }],
    interactionAnchors: [{ id: 'tray', purpose: '拿取钥匙' }],
    routes: [{ id: 'door-route', from: '托盘', to: '门口' }],
    propPlacements: [{ prop_id: 'key', placement: '托盘中央' }],
  }, { prop_assets: [stateful] }, { scene_id: 'hall' });
  assert.strictEqual(structured.has_evidence, true);
  assert.strictEqual(structured.story_states.length, 1);
  assert.strictEqual(structured.interaction_anchors.length, 1);
  assert.strictEqual(structured.routes.length, 1);
  assert.strictEqual(structured.prop_placements.length, 1);
  const prompt = sceneAssets.buildSceneSheetPrompt({
    ctx: { prop_assets: [stateful] },
    body: {
      scene_id: 'hall',
      scene_spec: {
        layoutText: '玄关入口、托盘和玻璃门形成连续可拍空间',
        materialLightText: '自然侧光照亮木质托盘和玻璃门',
        interactionText: '人物从托盘拿起钥匙后走向门口',
        storyStates: structured.story_states,
        interactionAnchors: structured.interaction_anchors,
        routes: structured.routes,
        propPlacements: structured.prop_placements,
      },
    },
  });
  assert(!prompt.includes('Structured scene evidence contract'), '场景空景图提示词不得重新注入剧情状态合同');
  assert(prompt.includes('door-route'), '去除剧情叙述时仍应保留可拍摄路线的结构标识');
  assert(prompt.includes('prop_placements'), '场景固定摆位仍应作为空间结构证据保留');
  const propUi = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/prop-assets.js'), 'utf8');
  assert(propUi.includes('dataset.nsaPropGenerate'));
  assert(propUi.includes("asset.status !== 'planned_not_generated'"));
  assert(propUi.includes("button.textContent = '生成道具档案'"));

  console.log(JSON.stringify({
    passed: true,
    stateful_prop_calls: 2,
    state_revalidation_calls: 1,
    state_revalidation_duplicate_calls: 0,
    static_prop_calls: 1,
    resume_duplicate_calls: 0,
    scene_structured_contract: true,
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
