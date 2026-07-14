const assert = require('assert');
process.env.NEW_STORY_AD_PUBLIC_BASE_URL = 'https://public.example';
const person = require('../src/services/newStoryAd/personIdentityContractService');
const product = require('../src/services/newStoryAd/productIdentityContractService');
const scenes = require('../src/services/newStoryAd/sceneBindingService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const publicReferences = require('../src/services/newStoryAd/publicReferenceService');
const sceneViewStrategy = require('../src/services/newStoryAd/sceneViewStrategyService');

const viewImages = ['front', 'side', 'back', 'action'].map(key => ({ key, url: `https://example.com/person-${key}.png` }));
const personAsset = { id: 'person-any-task', actor_id: 'person-any-task', view_images: viewImages };

(async () => {
  const referenceSet = publicReferences.normalizeVisionReferences([
    '/api/new-story-ad/assets/reference.png',
    'https://cdn.example/reference.png',
    'file:///private/reference.png',
    '/api/new-story-ad/assets/reference.png',
  ]);
  assert.deepStrictEqual(referenceSet.urls, [
    'https://public.example/api/new-story-ad/assets/reference.png',
    'https://cdn.example/reference.png',
  ]);
  assert.strictEqual(referenceSet.rejected.length, 1);
  assert.strictEqual(referenceSet.duplicates.length, 1);

  assert.strictEqual(sceneViewStrategy.resolveSceneViewStrategy({ requiredViews: ['master'] }).selected, 'single_view');
  assert.strictEqual(sceneViewStrategy.resolveSceneViewStrategy({ requiredViews: ['master', 'reverse'] }).selected, 'image_derived');
  assert.strictEqual(sceneViewStrategy.resolveSceneViewStrategy({ requested: '360', requiredViews: ['master', 'reverse'], videoAcquisitionEnabled: true }).selected, 'orbit_extract');
  const disabledOrbit = sceneViewStrategy.resolveSceneViewStrategy({ requested: 'orbit', requiredViews: ['master', 'reverse'], videoAcquisitionEnabled: false });
  assert.strictEqual(disabledOrbit.selected, 'image_derived');
  assert.strictEqual(disabledOrbit.fallback_reason, 'video_acquisition_not_enabled');

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
  const aliasPersonContract = person.buildPersonContract(personAsset, {
    appearanceText: '成年演员，椭圆脸，身份特征固定',
    wardrobeText: '深蓝色长袖服装',
    hairMakeupText: '黑色束发，自然妆容',
  });
  assert.match(aliasPersonContract.identity.face_description, /椭圆脸/);
  assert.match(aliasPersonContract.wardrobe.description, /深蓝色长袖/);
  assert.match(aliasPersonContract.appearance.hair_style, /黑色束发/);
  assert.equal(person.shotPersonPresence({ characters: [{ name: 'A' }], visual: 'A walks through the room in a black dress' }).mode, 'person');
  assert.strictEqual(personContract.status, 'verified');
  assert.doesNotThrow(() => person.assertVerifiedPerson({ cast_mode: 'single', person_asset: { ...personAsset, person_contract: personContract }, person_contract: personContract }));
  assert.throws(
    () => person.assertVerifiedPerson({ cast_mode: 'single', person_asset: personAsset }),
    error => error.code === 'PERSON_VERIFICATION_REQUIRED',
  );
  assert.doesNotThrow(() => person.assertVerifiedPerson({ cast_mode: 'no_human' }));

  let normalizedPersonUrls = [];
  const relativePersonAsset = {
    id: 'person-relative-references',
    actor_id: 'person-relative-references',
    view_images: ['front', 'side', 'back', 'action'].map(key => ({ key, url: `/api/new-story-ad/assets/${key}.png` })),
  };
  const relativePersonContract = await person.verifyPersonAsset({
    taskId: 'asset-contract-relative-test',
    asset: relativePersonAsset,
    spec: { age: 'task-defined', gender: 'task-defined', wardrobe: 'task-defined wardrobe' },
    gateway: {
      generateVision: async ({ imageUrls }) => {
        normalizedPersonUrls = imageUrls;
        return { text: '{}', used_model: 'test/vision' };
      },
    },
    repair: {
      parseOrRepair: async () => ({
        pass: true, identity_score: 0.94, age_score: 0.91, wardrobe_score: 0.93, body_score: 0.88, mismatch_reasons: [],
      }),
    },
  });
  assert.strictEqual(relativePersonContract.status, 'verified');
  assert.strictEqual(relativePersonContract.verification.state, 'verified');
  assert.strictEqual(normalizedPersonUrls.length, 4);
  assert(normalizedPersonUrls.every(url => url.startsWith('https://public.example/api/new-story-ad/assets/')));

  let reusedPersonCalled = false;
  const reusedPersonContract = await person.verifyPersonAsset({
    taskId: 'asset-contract-reuse-test',
    asset: { ...relativePersonAsset, person_contract: relativePersonContract, person_revision: 1 },
    spec: { age: 'task-defined', gender: 'task-defined', wardrobe: 'task-defined wardrobe' },
    revision: 1,
    gateway: { generateVision: async () => { reusedPersonCalled = true; throw new Error('must not run'); } },
  });
  assert.strictEqual(reusedPersonContract.status, 'verified');
  assert.strictEqual(reusedPersonCalled, false, 'unchanged verified person revision must reuse its verification result');

  const unreadablePersonContract = await person.verifyPersonAsset({
    taskId: 'asset-contract-invalid-reference-test',
    asset: {
      id: 'person-invalid-references',
      view_images: ['front', 'side', 'back', 'action'].map(key => ({ key, url: `file:///private/${key}.png` })),
    },
  });
  assert.strictEqual(unreadablePersonContract.status, 'unverified');
  assert.strictEqual(unreadablePersonContract.verification.code, 'VISION_REFERENCE_UNAVAILABLE');
  assert.strictEqual(unreadablePersonContract.verification.state, 'unavailable');

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

  const sceneOnlyProductCtx = {
    product_subject: '测试产品',
    assets: [{ type: 'product', url: 'https://example.test/product.png' }],
  };
  assert.equal(product.shotProductRequired(sceneOnlyProductCtx, { subject_type: 'scene_only', visual: '空展厅的墙面材质与地面光影' }), false);
  const productDetail = product.shotProductPresence(sceneOnlyProductCtx, { subject_type: 'product_only', visual: '测试产品的局部材质特写' });
  assert.equal(productDetail.required, true);
  assert.equal(productDetail.mode, 'partial');

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
  const partialPersonPrompt = storyAd.buildKeyframePrompt({
    brief: '通用长任务 '.repeat(120),
    product_subject: '当前任务主体',
    cast_mode: 'single',
    person_asset: { id: 'actor-1', name: '锁定演员', image_url: 'https://example.test/front.png', view_images: [{ key: 'front', url: 'https://example.test/front.png' }] },
    person_contract: { person_revision: 2, status: 'verified', cross_view_qa: { pass: true } },
    person_spec: { wardrobeText: '深色长袖服装，袖口和全片保持完全一致', appearanceText: '成年演员，身份固定', hairMakeupText: '发型固定' },
    forbidden: ['不得切换任务主体'],
    controlled_production: {
      product_control: { enabled: true, presence: 'high', lock_strength: 'strict', methods: ['detail', 'proof'] },
      style_control: { notes: '自然纪实光线与克制的商业质感' },
    },
  }, {
    title: '局部互动', characters: [], subject_type: 'product_only', visual: '锁定演员的手指和衣袖进入画面触摸主体', action: '指尖轻触可见主体',
  }, {
    scene_lock: { scene_id: 'scene-1', scene_name: '任务场景', scene_view: 'detail', anchor_ids: ['anchor-1'] },
    continuity_lock: { transition_type: 'match_cut', entry_frame_state: '承接上一镜局部位置', object_states: '主体保持在画面右侧且包装维持开启' },
    visual_contract: {
      product_required: true,
      product_presence: 'high',
      product_lock_strength: 'strict',
      product_methods: ['detail', 'proof'],
      evidence: '镜头必须给出真实可见的产品证据',
      style_direction: '自然纪实光线与克制的商业质感',
    },
  }, 2, { sceneAsset: { id: 'scene-1', name: '任务场景', material_summary: '材质必须保持一致', layout_summary: '结构必须保持一致' } });
  assert.ok(partialPersonPrompt.length <= 2400);
  assert.match(partialPersonPrompt, /Person QA required/);
  assert.match(partialPersonPrompt, /Actor wardrobe lock/);
  assert.match(partialPersonPrompt, /Shot scene binding:/i);
  assert.match(partialPersonPrompt, /Scene material lock:/i);
  assert.match(partialPersonPrompt, /Object state lock:/i);
  assert.match(partialPersonPrompt, /Semantic fidelity rule/i);
  assert.match(partialPersonPrompt, /Campaign brief:/i);
  assert.match(partialPersonPrompt, /Product visibility:/i);
  assert.match(partialPersonPrompt, /Product presentation methods:/i);
  assert.match(partialPersonPrompt, /Visual style direction:/i);
  assert.match(partialPersonPrompt, /Object state lock:/i);
  assert.strictEqual(storyAd.isCompleteKeyframe({ image_url: 'https://temporary-provider.example/keyframe.png' }), true);

  console.log('new story ad asset contracts: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
