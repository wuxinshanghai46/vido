const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'new-story-ad-verification-lifecycle-test');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_MOCK_IMAGE = '1';
process.env.NEW_STORY_AD_MOCK_LLM = '1';
process.env.NEW_STORY_AD_PUBLIC_BASE_URL = 'https://test.invalid';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const personIdentity = require('../src/services/newStoryAd/personIdentityContractService');
const verification = require('../src/services/newStoryAd/visualVerificationService');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');

function passingSceneResult(overrides = {}) {
  return {
    pass: true,
    status: 'verified',
    observed_summary: '当前任务场景',
    cross_view_qa: {
      pass: true,
      scene_consistency_score: 0.94,
      geometry_consistency_score: 0.93,
      material_consistency_score: 0.95,
      mismatch_reasons: [],
    },
    requirement_qa: {
      pass: true,
      layout_match_score: 0.95,
      material_light_match_score: 0.94,
      interaction_match_score: 0.92,
      surface_topology_match_score: 0.96,
      negative_compliance_score: 0.99,
      mismatch_reasons: [],
    },
    spatial_coverage_qa: {
      pass: true,
      layout_topology_score: 0.95,
      camera_diversity_score: 0.92,
      reverse_coverage_score: 0.93,
      interaction_zone_score: 0.94,
      reasons: [],
    },
    anchors: [],
    zones: [],
    geometry_facts: [],
    materials: [],
    lighting: {},
    ...overrides,
  };
}

async function main() {
  const created = storyAd.createTask({
    brief: '验证人物与空间资产自动验收闭环',
    product_subject: '测试主体',
    cast_mode: 'single',
    scene_spec: {
      layoutText: '一面完整连续的背景墙和一个操作区域',
      materialLightText: '金属墙面，真实柔和照明',
      interactionText: '主体在墙前完成操作',
      negativeText: '禁止拼贴墙、可见接缝和无关人物',
      surfaceTopology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'uniform', notes: '连续完整基面' },
    },
  }, { id: 'verification-lifecycle-user' });
  const taskId = created.task.id;
  const spec = { age: '30-40', gender: 'female', appearanceText: '成年女性演员', wardrobeText: '深色长袖套装', hairMakeupText: '短发淡妆' };
  const personAsset = {
    id: 'person-asset-verified',
    actor_id: 'actor-verified',
    image_url: 'https://test.invalid/front.png',
    view_images: ['front', 'side', 'back', 'action'].map(key => ({ key, url: `https://test.invalid/${key}.png` })),
  };
  const baseContract = personIdentity.buildPersonContract(personAsset, spec, { revision: 1 });
  const verifiedContract = {
    ...baseContract,
    status: 'verified',
    cross_view_qa: personIdentity.normalizeQa({
      pass: true,
      identity_score: 0.96,
      age_score: 0.94,
      wardrobe_score: 0.95,
      body_score: 0.9,
      mismatch_reasons: [],
      used_model: 'mock/person-qa',
    }),
    verification: verification.verified('mock/person-qa'),
  };
  const committed = storyAd.commitGeneratedPersonAsset(taskId, { ...personAsset, person_contract: verifiedContract }, spec);
  assert.equal(committed.person_contract.status, 'verified', '生成后应原子保存已验证人物合同');
  const saved = storage.getOutput(taskId, 'context');
  const autosaved = storyAd.updateTaskRequest(taskId, {
    ...saved,
    save_progress: true,
    change_scope: 'person',
    person_asset: { ...saved.person_asset, person_contract: saved.person_contract },
  }, { id: 'verification-lifecycle-user' });
  assert.equal(autosaved.context.person_contract.status, 'verified', '同一人物指纹的自动保存不得重置验证状态');
  assert.equal(autosaved.context.person_contract.cross_view_qa.pass, true);
  const changed = storyAd.updateTaskRequest(taskId, {
    ...autosaved.context,
    save_progress: true,
    change_scope: 'person',
    person_spec: { ...spec, wardrobeText: '改为白色短袖服装' },
  }, { id: 'verification-lifecycle-user' });
  assert.notEqual(changed.context.person_contract.status, 'verified', '人物外观合同真实变化后必须重新验证');

  let personQaAttempts = 0;
  const retriedPersonContract = await personIdentity.verifyPersonAsset({
    taskId,
    asset: personAsset,
    spec,
    qaAttempts: 2,
    gateway: {
      generateVision: async () => {
        personQaAttempts += 1;
        if (personQaAttempts === 1) {
          const error = new Error('视觉服务暂不可用');
          error.code = 'VISION_QA_UNAVAILABLE';
          error.retryable = true;
          throw error;
        }
        return { text: '{}', used_model: 'mock/person-retry' };
      },
    },
    repair: {
      parseOrRepair: async () => ({ pass: true, identity_score: 0.96, age_score: 0.94, wardrobe_score: 0.95, body_score: 0.9, mismatch_reasons: [] }),
    },
  });
  assert.equal(personQaAttempts, 2, '人物验证基础设施失败时应自动重试同一组图片');
  assert.equal(retriedPersonContract.status, 'verified');

  const requested = {
    layout: '完整连续背景墙',
    material_light: '金属墙面和真实照明',
    interaction: '墙前操作区',
    negative: '禁止拼贴墙和可见接缝',
    surface_topology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'uniform', notes: '连续完整基面' },
  };
  const rejectedContract = sceneSpace.normalizeContract(passingSceneResult({
    requirement_qa: {
      pass: false,
      layout_match_score: 0.92,
      material_light_match_score: 0.9,
      interaction_match_score: 0.9,
      surface_topology_match_score: 0.35,
      negative_compliance_score: 0.55,
      mismatch_reasons: ['背景墙被生成成多块拼接并出现可见接缝'],
    },
    view_issues: [{
      code: 'SURFACE_TOPOLOGY_INVALID',
      view_keys: ['master'],
      reason: '主视图背景墙出现可见拼缝',
      evidence: '连续基面被竖向边界切分',
      confidence: 0.98,
    }],
  }), { sceneId: 'scene-rejected', revision: 1, requested, views: [] });
  assert.equal(rejectedContract.cross_view_qa.pass, true);
  assert.equal(rejectedContract.requirement_qa.pass, false);
  assert.equal(rejectedContract.status, 'rejected', '跨视图一致但不符合原始要求时必须拒绝');

  assert.equal(sceneAssets.needsLayoutView({ layout: '单面背景墙', interaction: '固定机位' }), true);
  assert.equal(sceneAssets.needsLayoutView({ layout: '前厅、走廊和后场组成多个区域', interaction: '人物沿动线连续穿行' }), true);

  const originalVision = modelGateway.generateVision;
  modelGateway.generateVision = async () => ({
    text: JSON.stringify(passingSceneResult({
      requirement_qa: rejectedContract.requirement_qa,
      view_issues: rejectedContract.view_issues,
    })),
    used_model: 'mock/rejected-scene',
  });
  const rejectedGenerated = await sceneAssets.generateSceneAsset(taskId, { scene_id: 'scene-rejected', scene_spec: created.context.scene_spec });
  assert.equal(rejectedGenerated.scene_asset.scene_contract.status, 'rejected');
  assert(storage.getOutput(taskId, 'scene_assets').some(asset => asset.scene_id === 'scene-rejected'), '验证不合格的场景图片仍应保存供用户对照');

  let reverifyPrompt = '';
  modelGateway.generateVision = async request => {
    reverifyPrompt = request.userPrompt || '';
    return { text: JSON.stringify(passingSceneResult()), used_model: 'mock/reverify-scene' };
  };
  const reverification = await sceneAssets.reverifySceneAsset(taskId, 'scene-rejected');
  assert.equal(reverification.scene_asset.scene_contract.status, 'verified');
  assert.match(reverifyPrompt, /surface_topology/);
  assert.match(reverifyPrompt, /continuous/);
  assert.match(reverifyPrompt, /hidden/);
  assert.match(reverifyPrompt, /material_reference_available/);
  assert.match(reverifyPrompt, /do not fail solely because a proprietary, trade or unfamiliar finish name/i);
  assert.match(reverifyPrompt, /a smooth reflection or lighting gradient is not a seam by itself/i);

  modelGateway.generateVision = originalVision;
  const layoutGenerated = await sceneAssets.generateSceneAsset(taskId, {
    scene_id: 'scene-layout',
    scene_spec: created.context.scene_spec,
    include_layout_view: true,
  });
  assert.equal(layoutGenerated.scene_asset.view_images.length, 5);
  assert(layoutGenerated.scene_asset.view_images.some(view => view.key === 'layout'));
  assert.equal(layoutGenerated.scene_asset.scene_contract.layout_contract.status, 'available');

  const conflictingTask = storyAd.createTask({
    brief: '生成一整面连续完整的不锈钢背景墙用于商业展示',
    product_subject: '测试墙面',
    cast_mode: 'no_human',
    scene_spec: {
      layoutText: '画面视觉焦点是一整面连续完整的背景墙',
      materialLightText: '不锈钢纹理在同一连续基面上变化',
      negativeText: '禁止模块化拼板、矩形板块、网格墙和可见接缝',
      surfaceTopology: {
        mode: 'modular',
        seam_policy: 'task_defined',
        finish_distribution: 'regional',
        notes: '背景必须是一整面连续完整平直的墙体',
      },
    },
  }, { id: 'verification-lifecycle-user' });
  const reconciledGenerated = await sceneAssets.generateSceneAsset(conflictingTask.task.id, {
    scene_id: 'scene-conflict-reconciled',
    scene_spec: conflictingTask.context.scene_spec,
  });
  assert.equal(reconciledGenerated.scene_asset.surface_topology.mode, 'continuous', '连续墙面文字要求必须覆盖冲突的模块化旧值');
  assert.equal(reconciledGenerated.scene_asset.surface_topology.seam_policy, 'hidden');
  assert.equal(reconciledGenerated.scene_asset.surface_topology.finish_distribution, 'uniform', '未映射到明确位置的局部变化必须收敛为无边界统一饰面');
  assert.doesNotMatch(reconciledGenerated.scene_asset.prompt, /a modular system is required/i);
  assert.doesNotMatch(reconciledGenerated.scene_asset.prompt, /visible panel seams, joints, bevels/i);
  assert.match(reconciledGenerated.scene_asset.prompt, /ONE monolithic uninterrupted visual plane/i);
  assert.match(reconciledGenerated.scene_asset.prompt, /ZERO visible joints/i);
  assert.doesNotMatch(reconciledGenerated.scene_asset.prompt, /physically supplied as sheets, boards or panels|visually recessive joints/i);
  const reconciledContext = storage.getOutput(conflictingTask.task.id, 'context');
  assert.equal(reconciledContext.scene_spec.surfaceTopology.mode, 'continuous', '实际生成所用的纠偏设置必须写回任务上下文');
  assert.equal(reconciledContext.scene_spec.surfaceTopology.seam_policy, 'hidden');

  console.log(JSON.stringify({
    success: true,
    person_atomic_verification: true,
    person_same_fingerprint_preserved: true,
    person_same_asset_qa_retry: true,
    scene_requirement_gate: true,
    rejected_scene_preserved: true,
    reverify_surface_topology: true,
    conditional_layout_view: true,
    contradictory_scene_spec_reconciled: true,
    reconciled_scene_spec_persisted: true,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
