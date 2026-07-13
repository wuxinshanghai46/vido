const assert = require('assert');
const person = require('../src/services/newStoryAd/personIdentityContractService');
const product = require('../src/services/newStoryAd/productIdentityContractService');
const scenes = require('../src/services/newStoryAd/sceneBindingService');
const storyAd = require('../src/services/newStoryAd/storyAdService');

const viewImages = ['front', 'side', 'back', 'action'].map(key => ({ key, url: `https://example.com/person-${key}.png` }));
const personAsset = { id: 'person-any-task', actor_id: 'person-any-task', view_images: viewImages };

(async () => {
  const personContract = await person.verifyPersonAsset({
    taskId: 'asset-contract-test',
    asset: personAsset,
    spec: { age: 'task-defined', gender: 'task-defined', wardrobe: 'task-defined wardrobe' },
    gateway: {
      generateVision: async () => ({
        text: '{}', used_model: 'test/vision',
      }),
    },
    repair: {
      parseOrRepair: async () => ({
        pass: true, identity_score: 0.94, age_score: 0.91, wardrobe_score: 0.93, body_score: 0.88, mismatch_reasons: [],
      }),
    },
  });
  assert.strictEqual(personContract.status, 'verified');
  assert.doesNotThrow(() => person.assertVerifiedPerson({ cast_mode: 'single', person_asset: { ...personAsset, person_contract: personContract }, person_contract: personContract }));
  assert.throws(
    () => person.assertVerifiedPerson({ cast_mode: 'single', person_asset: personAsset }),
    error => error.code === 'PERSON_VERIFICATION_REQUIRED',
  );
  assert.doesNotThrow(() => person.assertVerifiedPerson({ cast_mode: 'no_human' }));

  const productCtx = {
    product_subject: 'current task product',
    revisions: { product: 2 },
    assets: [{ id: 'product-current-task', type: 'product', url: 'https://example.com/product.png', description: 'current task reference' }],
    controlled_production: { product_control: { enabled: true, lock_strength: 'strict' } },
  };
  const productContract = await product.verifyProductContract({
    taskId: 'asset-contract-test',
    ctx: productCtx,
    gateway: { generateVision: async () => ({ text: '{}', used_model: 'test/vision' }) },
    repair: { parseOrRepair: async () => ({ pass: true, identity_score: 0.92, shape_score: 0.9, color_score: 0.9, material_score: 0.84, conflicts: [] }) },
  });
  assert.strictEqual(productContract.status, 'verified');
  assert.doesNotThrow(() => product.assertVerifiedProduct({ ...productCtx, product_contract: productContract }));
  assert.throws(
    () => product.assertVerifiedProduct(productCtx),
    error => error.code === 'PRODUCT_VERIFICATION_REQUIRED',
  );

  const verifiedContract = { status: 'verified', cross_view_qa: { pass: true } };
  const sceneAssets = [
    { id: 'scene-a', scene_id: 'scene-a', scene_revision: 1, scene_contract: verifiedContract },
    { id: 'scene-b', scene_id: 'scene-b', scene_revision: 2, scene_contract: verifiedContract },
  ];
  assert.doesNotThrow(() => scenes.assertVerifiedSceneAssets(sceneAssets));
  assert.throws(
    () => scenes.bindShotToScene({ scene_id: 'missing' }, sceneAssets, 0),
    error => error.code === 'SCENE_BINDING_INVALID',
  );
  assert.throws(
    () => scenes.bindShotToScene({ scene_id: 'scene-b', scene_revision: 1 }, sceneAssets, 1),
    error => error.code === 'SCENE_REVISION_MISMATCH',
  );
  const first = scenes.bindShotToScene({ scene_id: 'scene-a', scene_revision: 1 }, sceneAssets, 0);
  assert.throws(
    () => scenes.bindShotToScene({ scene_id: 'scene-b', scene_revision: 2 }, sceneAssets, 1, first),
    error => error.code === 'SCENE_TRANSITION_REASON_REQUIRED',
  );
  const second = scenes.bindShotToScene({ scene_id: 'scene-b', scene_revision: 2, transition_reason: '当前任务剧情要求人物从前一空间进入新空间完成下一个动作' }, sceneAssets, 1, first);
  assert.strictEqual(second.scene_id, 'scene-b');
  assert.strictEqual(second.transition_reason.includes('当前任务'), true);

  const compactedPrompt = storyAd.compactKeyframePrompt([
    `Campaign brief: ${'task-specific brief '.repeat(180)}`,
    `Visual: ${'current shot visual '.repeat(100)}`,
    `Strict actor consistency lock: ${'identity wardrobe age body '.repeat(100)}`,
    `Semantic fidelity rule: ${'use only this task and never switch industry '.repeat(80)}`,
  ]);
  assert.ok(compactedPrompt.length <= 2400);
  assert.ok(compactedPrompt.includes('Visual:'));
  assert.ok(compactedPrompt.includes('Strict actor consistency lock:'));
  assert.ok(compactedPrompt.includes('Semantic fidelity rule:'));
  assert.strictEqual(storyAd.isCompleteKeyframe({ image_url: 'https://temporary-provider.example/keyframe.png' }), true);

  console.log('new story ad asset contracts: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
