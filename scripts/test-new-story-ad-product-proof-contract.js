const assert = require('assert');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const productIdentity = require('../src/services/newStoryAd/productIdentityContractService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const productQa = require('../src/services/newStoryAd/productConsistencyQaService');

const reference = {
  analysis_id: 'reference-product-proof-test',
  source_facts: { product_or_service: '当前任务识别出的广告主体' },
  reference_understanding: {
    contract_version: 'reference-understanding-v6',
    story_summary: { brand_function: '通过可见使用结果证明主体价值', cta: '了解更多' },
    brand_role: {
      subject: '跨行业广告主体',
      story_function: '通过可见使用结果证明主体价值',
      visible_claims: ['只使用参考证据支持的公开卖点'],
      proof_moments: [
        { id: 'proof-use', event_id: 'event_2', requirement: '展示主体被实际使用', evidence_refs: ['F003'] },
        'event_3',
      ],
      evidence_refs: ['F003', 'F004'],
    },
  },
};

const projected = assetPlan.advertisedSubjectContract({}, reference);
assert.equal(projected.kind, 'advertised_subject');
assert.equal(projected.presentation.mode, 'evidence_driven');
assert.equal(projected.presentation.story_function, '通过可见使用结果证明主体价值');
assert.equal(projected.asset_requirement.proof_required, true);
assert.equal(projected.asset_requirement.visual_lock_required, false);
assert.equal(projected.asset_requirement.source_identity_reuse_allowed, false);
assert.equal(projected.proof_requirements.length, 2);
assert.equal(projected.proof_requirements[0].proof_id, 'proof-use');
assert.equal(projected.proof_requirements[0].event_id, 'event_2');
assert.equal(projected.source.analysis_id, reference.analysis_id);

const referencePlan = assetPlan.projectReferencePlan({
  reference_video_analysis: {
    ...reference,
    status: 'completed',
    analysis_quality: { valid: true },
    scene_prompts: [{
      id: 'scene-1', location_type: '任务证据空间', layout_prompt: '主体位于空间中心',
      material_light_prompt: '使用任务证据中的材质和光线', interaction_prompt: '按证据展示主体作用',
    }],
    character_prompts: [], animal_prompts: [], plot_beats: [], shot_breakdown: [], camera_intents: [], character_actions: [],
  },
});
assert.equal(referencePlan.advertised_subject_contract.subject, '跨行业广告主体');
assert.equal(referencePlan.advertised_subject_contract.proof_requirements.length, 2);
assert.notEqual(
  assetPlan.referenceProjectionFingerprint(reference),
  assetPlan.referenceProjectionFingerprint({
    ...reference,
    reference_understanding: {
      ...reference.reference_understanding,
      brand_role: { ...reference.reference_understanding.brand_role, proof_moments: ['event_9'] },
    },
  }),
  '品牌作用或证明节点改变时必须触发重新投影',
);

const proofOnlyContext = {
  product_subject: '旧占位主体',
  advertised_subject_contract: projected,
  controlled_production: { product_control: { enabled: false } },
};
const proofOnly = productIdentity.buildProductContract(proofOnlyContext);
assert.equal(proofOnly.status, 'proof_required');
assert.equal(proofOnly.advertised_subject, '跨行业广告主体');
assert.equal(proofOnly.proof_required, true);
assert.equal(proofOnly.visual_lock_required, false);
assert.equal(productIdentity.proofRequired(proofOnlyContext), true);
assert.equal(productIdentity.visualLockRequired(proofOnlyContext), false);
assert.equal(productIdentity.productRequired(proofOnlyContext), false, '兼容入口只代表视觉身份锁，不应把语义证明误当成图片锁');
assert.equal(productIdentity.proofRequired({ product_contract: proofOnly }), true, '通用上下文规范化后仍须从商品合同恢复证明要求');
assert.equal(productIdentity.shotProductProofRequired(proofOnlyContext, {
  subject_type: 'proof_scene', visual: '跨行业广告主体的可见使用结果',
}), true);
assert.equal(productIdentity.shotProductVisualLockRequired(proofOnlyContext, {
  subject_type: 'proof_scene', visual: '跨行业广告主体的可见使用结果',
}), false);

let verificationCalls = 0;
productIdentity.verifyProductContract({
  taskId: 'proof-only',
  ctx: proofOnlyContext,
  gateway: { generateVision: async () => { verificationCalls += 1; throw new Error('must not call'); } },
}).then((verified) => {
  assert.equal(verificationCalls, 0, '没有视觉锁要求时不得为语义证明调用视觉审计模型');
  assert.equal(verified.status, 'proof_required');

  const materialContext = {
    product_presentation: { mode: 'material_surface' },
    product_contract: { reference_images: ['/material-a.png', '/material-b.png'] },
  };
  assert.deepEqual(sceneAssets.sceneMaterialReferenceImages(materialContext), ['/material-a.png', '/material-b.png']);

  const standaloneContext = {
    product_presentation: { mode: 'standalone_product' },
    product_contract: { reference_images: ['/standalone-product.png'] },
  };
  assert.deepEqual(sceneAssets.sceneMaterialReferenceImages(standaloneContext), [], '独立商品图不得污染空场景材质');
  assert.deepEqual(sceneAssets.sceneMaterialReferenceImages(standaloneContext, {
    scene_spec: { material_reference_images: ['/explicit-material.png'] },
  }), ['/explicit-material.png'], '显式场景材质参考必须继续生效');

  const lockedContext = {
    ...proofOnlyContext,
    product_asset: { id: 'product-1', type: 'product', image_url: '/product.png' },
  };
  const locked = productIdentity.buildProductContract(lockedContext);
  assert.equal(locked.proof_required, true);
  assert.equal(locked.visual_lock_required, true);
  assert.equal(locked.status, 'unverified');
  assert.equal(productIdentity.shotProductVisualLockRequired(lockedContext, {
    subject_type: 'product_only', visual: '跨行业广告主体特写',
  }), true);

  const proofShots = [
    { order: 1, subject_type: 'scene_only', visual: '建立空间' },
    { order: 2, product_proof_ids: ['proof-use'], visual: '展示当前广告主体被使用' },
    { order: 3, product_proof_ids: ['reference_proof_2'], visual: '展示可见结果' },
  ];
  const partialCoverage = productIdentity.auditProofCoverage(proofOnlyContext, proofShots, [
    { qa: { pass: true, product_pass: true } },
    { qa: { pass: true, product_pass: true } },
    { qa: { pass: false, product_pass: false } },
  ]);
  assert.equal(partialCoverage.pass, false, '任一证明节点缺少通过的成片镜头时不得进入最终合成');
  assert.deepEqual(partialCoverage.missing_proof_ids, ['reference_proof_2']);
  const fullCoverage = productIdentity.auditProofCoverage(proofOnlyContext, proofShots, [
    { qa: { pass: true, product_pass: true } },
    { qa: { pass: true, product_pass: true } },
    { qa: { pass: true, product_pass: true } },
  ]);
  assert.equal(fullCoverage.pass, true);
  assert.equal(fullCoverage.covered, 2);

  return productQa.reviewProductKeyframe({
    taskId: 'proof-only-shot',
    ctx: proofOnlyContext,
    shot: proofShots[1],
    generatedUrl: '/generated-proof.png',
    gateway: {
      generateVision: async ({ imageUrls }) => {
        assert.deepEqual(imageUrls, ['/generated-proof.png'], '证明型主体无图片锁时只能审查生成图，不得附带不存在的商品参考');
        return { text: JSON.stringify({ pass: true, proof_pass: true, proof_evidence: ['主体使用结果清晰可见'], conflicts: [] }), used_model: 'mock/proof' };
      },
    },
    repair: { parseOrRepair: async ({ raw }) => JSON.parse(raw) },
  });
}).then((proofQa) => {
  assert.equal(proofQa.pass, true);
  assert.equal(proofQa.proof_pass, true);
  assert.equal(proofQa.identity_score, null, '无视觉锁时只验证主体证明，不伪造外观一致性分数');

  console.log('New Story Ad product proof contract regression tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
