const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
const subjectAssets = require('../src/services/newStoryAd/subjectAssetBundleService');
const { currentAllScenePrompts, currentScenePrompt } = require('./helpers/current-scene-prompt-fixture');

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
    photographic_realism_qa: {
      pass: true,
      photographic_realism_score: 0.94,
      physical_material_score: 0.93,
      natural_variation_score: 0.9,
      optical_capture_score: 0.92,
      real_photo_evidence: ['natural lens falloff', 'localized physical variation'],
      synthetic_signals: [],
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
    camera_design_qa: {
      pass: true,
      role_definition_score: 0.94,
      requirement_mapping_score: 0.93,
      direction_evidence_score: 0.91,
      parameter_completeness_score: 0.96,
      layout_mapping_score: 0.9,
      mismatch_reasons: [],
    },
    cameras: ['master', 'reverse', 'interaction', 'detail'].map((key, index) => ({
      view_id: key,
      label: key,
      role: `${key} role`,
      framing: key === 'detail' ? 'close detail' : 'wide',
      lens_class: key === 'detail' ? '50-85mm detail' : '24-35mm wide',
      height_class: key === 'detail' ? 'surface_level' : 'eye_level',
      orientation: `${key} direction`,
      estimated_azimuth_degrees: [20, 130, 75, 70][index],
      estimated_pitch_degrees: [2, 1, 0, -12][index],
      azimuth_delta_from_master_degrees: key === 'reverse' ? 110 : null,
      normalized_position: [[0.12, 0.82], [0.82, 0.25], [0.32, 0.68], [0.5, 0.55]][index],
      look_at: [[0.55, 0.45], [0.42, 0.58], [0.58, 0.48], [0.57, 0.5]][index],
      position_confidence: 0.9,
      target_description: `${key} target`,
      allowed_zone_ids: ['zone_action'],
      requirement_refs: key === 'interaction' ? ['interaction']
        : (key === 'detail' ? ['material_light'] : ['layout']),
      visible_evidence: `${key} visible evidence`,
      pass: true,
      mismatch_reasons: [],
    })),
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
      layoutText: '建立一面完整连续且边界清晰的背景墙、稳定入口、无阻挡通道和明确商业操作区域',
      materialLightText: '使用尺度真实的连续金属墙面、统一材质方向、自然柔和主光与合理商业辅助照明',
      interactionText: '主体能够在墙前完整操作区域内连续完成动作，摄影机路径保持清晰且没有遮挡',
      negativeText: '禁止样板拼贴墙、可见接缝、重复家具、错误透视、无关人物、文字水印和空间断裂',
      surfaceTopology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'uniform', notes: '连续完整基面' },
    },
  }, { id: 'verification-lifecycle-user' });
  const taskId = created.task.id;
  storage.saveOutput(taskId, 'scene_config', {
    scene_mode: 'multi',
    spaces: [
      { id: 'scene-rejected', name: '拒绝后复验场景', scene_spec: created.context.scene_spec },
      { id: 'scene-layout', name: '布局视图场景', scene_spec: created.context.scene_spec },
    ],
  });
  currentAllScenePrompts(taskId);
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
  assert.equal(storage.getOutput(taskId, 'scene_config')?.spaces?.length, 2,
    `人物自动保存不得失效当前逐空间场景计划：${JSON.stringify(autosaved.changed_domains)}`);
  const changed = storyAd.updateTaskRequest(taskId, {
    ...autosaved.context,
    save_progress: true,
    change_scope: 'person',
    person_spec: { ...spec, wardrobeText: '改为白色短袖服装' },
  }, { id: 'verification-lifecycle-user' });
  assert.notEqual(changed.context.person_contract.status, 'verified', '人物外观合同真实变化后必须重新验证');
  assert.equal(storage.getOutput(taskId, 'scene_config')?.spaces?.length, 2,
    '人物规格变化不得失效当前逐空间场景计划');

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

  const rejectedEnglishContract = await personIdentity.verifyPersonAsset({
    taskId,
    asset: personAsset,
    spec,
    gateway: {
      generateVision: async () => ({ text: '{}', used_model: 'mock/person-english-reason' }),
    },
    repair: {
      parseOrRepair: async () => ({
        pass: false,
        identity_score: 0.96,
        age_score: 0.94,
        wardrobe_score: 0.42,
        body_score: 0.9,
        mismatch_reasons: ['The shoes in the action view have a distinct block heel and do not match the other three views.'],
      }),
    },
  });
  assert.equal(rejectedEnglishContract.status, 'rejected');
  assert.match(rejectedEnglishContract.cross_view_qa.mismatch_reasons[0], /鞋型|鞋跟|鞋子/);
  assert.doesNotMatch(rejectedEnglishContract.cross_view_qa.mismatch_reasons[0], /[A-Za-z]/, '用户可见人物验证原因必须为中文');
  assert.match(rejectedEnglishContract.cross_view_qa.raw_mismatch_reasons[0], /block heel/, '内部诊断必须保留模型原始原因');

  const languageSandbox = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'public/js/new-story-ad/verification-language.js'), 'utf8'),
    languageSandbox,
  );
  const historicalReason = languageSandbox.window.NewStoryAdVerificationLanguage.reason(
    'The shoes in the action view are inconsistent with the front, side and back views.',
    '人物',
  );
  assert.match(historicalReason, /鞋型|鞋跟|鞋子/);
  assert.doesNotMatch(historicalReason, /[A-Za-z]/, '历史英文验证记录也必须在显示边界转换为中文');

  const castTask = storyAd.createTask({
    brief: '两名人物分别持有独立四视图，重新验证时不得把人物组当成第一人',
    product_subject: '通用多人验证',
    cast_mode: 'dual',
    expected_people: 2,
  }, { id: 'verification-lifecycle-user' });
  const castSpecs = [
    { id: 'cast_1', displayName: '人物甲', roleName: '角色甲', appearanceText: '人物甲外貌', wardrobeText: '人物甲服装', hairMakeupText: '人物甲发型' },
    { id: 'cast_2', displayName: '人物乙', roleName: '角色乙', appearanceText: '人物乙外貌', wardrobeText: '人物乙服装', hairMakeupText: '人物乙发型' },
  ];
  const castAssets = castSpecs.map((member, index) => {
    const actorId = `actor_cast_${index + 1}`;
    const asset = {
      id: `asset_cast_${index + 1}`,
      actor_id: actorId,
      actor_asset_id: `asset_cast_${index + 1}`,
      name: member.displayName,
      subject_profile: member,
      image_url: `https://test.invalid/${actorId}/front.png`,
      view_images: ['front', 'side', 'back', 'action'].map(key => ({ key, url: `https://test.invalid/${actorId}/${key}.png` })),
    };
    const contract = personIdentity.buildPersonContract(asset, member, { revision: 3 });
    if (index === 0) {
      contract.status = 'unverified';
      contract.cross_view_qa = personIdentity.normalizeQa({ pass: false, mismatch_reasons: [] });
      contract.verification = verification.unavailable(Object.assign(new Error('视觉审核暂时不可用'), { code: 'VISION_QA_UNAVAILABLE' }));
    } else {
      contract.status = 'verified';
      contract.cross_view_qa = personIdentity.normalizeQa({
        pass: true, identity_score: 0.98, age_score: 0.97, wardrobe_score: 0.96, body_score: 0.95, mismatch_reasons: [],
      });
      contract.verification = verification.verified('mock/already-verified');
    }
    return { ...asset, person_contract: contract, person_revision: 3, production_usable_actor: index === 1 };
  });
  const pendingAggregate = subjectAssets.aggregatePersonContract(castAssets, 3);
  assert.equal(pendingAggregate.status, 'unverified', '成员审核服务不可用时，人物组不得被误写成图片一致性拒绝');
  assert.equal(pendingAggregate.verification.state, 'unavailable', '人物组应保留可重试的审核异常语义');
  const castContext = {
    ...castTask.context,
    cast_mode: 'dual',
    expected_people: 2,
    cast_profiles: castSpecs,
    person_spec: { castMode: 'dual', expectedPeople: 2 },
    revisions: { ...(castTask.context.revisions || {}), person: 3 },
    person_asset: {
      id: 'cast_bundle_verification',
      actor_id: 'cast_bundle_verification',
      cast_mode: 'dual',
      expected_people: 2,
      cast_assets: castAssets,
      image_url: castAssets[0].image_url,
      view_images: castAssets[0].view_images,
      person_revision: 3,
      person_contract: pendingAggregate,
    },
    person_contract: pendingAggregate,
  };
  storage.saveOutput(castTask.task.id, 'context', castContext);
  storage.saveOutput(castTask.task.id, 'person_contract', pendingAggregate);
  storage.updateTask(castTask.task.id, { request: castContext });
  const originalPersonVerify = personIdentity.verifyPersonAsset;
  const verifiedActorIds = [];
  personIdentity.verifyPersonAsset = async ({ asset, spec: member, revision }) => {
    verifiedActorIds.push(asset.actor_id);
    const contract = personIdentity.buildPersonContract(asset, member, { revision });
    contract.status = 'verified';
    contract.cross_view_qa = personIdentity.normalizeQa({
      pass: true, identity_score: 0.97, age_score: 0.96, wardrobe_score: 0.95, body_score: 0.94, mismatch_reasons: [],
    });
    contract.verification = verification.verified('mock/member-reverify');
    return contract;
  };
  try {
    const castReverified = await storyAd.verifyPersonContract(castTask.task.id);
    assert.deepEqual(verifiedActorIds, ['actor_cast_1'], '默认只重验未通过或审核异常的成员，已验证成员不得重复产生视觉审核调用');
    assert.equal(castReverified.person_asset.cast_assets[0].person_contract.status, 'verified');
    assert.equal(castReverified.person_asset.cast_assets[1].person_contract.verification.used_model, 'mock/already-verified');
    assert.equal(castReverified.person_contract.contract_type, 'cast_bundle');
    assert.equal(castReverified.person_contract.status, 'verified');
    assert.equal(castReverified.person_contract.cross_view_qa.verified_members, 2);
    const persistedCast = storage.getOutput(castTask.task.id, 'context');
    assert.equal(persistedCast.person_asset.cast_assets[0].person_contract.status, 'verified', '成员合同必须写回人物组资产');
    assert.equal(persistedCast.cast_profiles[0].person_contract.status, 'verified', '逐人物档案必须同步最新合同');
    assert.equal(storage.getOutput(castTask.task.id, 'person_contract').contract_type, 'cast_bundle', '持久化层不得再被单人合同覆盖');
  } finally {
    personIdentity.verifyPersonAsset = originalPersonVerify;
  }

  let releaseConcurrentVerification;
  let concurrentCalls = 0;
  const concurrentAsset = {
    id: 'asset_concurrent',
    actor_id: 'actor_concurrent',
    image_url: 'https://test.invalid/concurrent/front.png',
    view_images: ['front', 'side', 'back', 'action'].map(key => ({ key, url: `https://test.invalid/concurrent/${key}.png` })),
  };
  concurrentAsset.person_contract = personIdentity.buildPersonContract(concurrentAsset, spec, { revision: 1 });
  const firstConcurrentVerification = subjectAssets.reverifyPersonBundle({
    taskId: 'task_concurrent_person_verify',
    personAsset: concurrentAsset,
    personSpec: spec,
  }, {
    personIdentity: {
      verifyPersonAsset: async ({ asset, spec: currentSpec, revision }) => {
        concurrentCalls += 1;
        await new Promise(resolve => { releaseConcurrentVerification = resolve; });
        const contract = personIdentity.buildPersonContract(asset, currentSpec, { revision });
        contract.status = 'verified';
        contract.cross_view_qa = personIdentity.normalizeQa({
          pass: true, identity_score: 0.98, age_score: 0.97, wardrobe_score: 0.96, body_score: 0.95, mismatch_reasons: [],
        });
        return contract;
      },
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => subjectAssets.reverifyPersonBundle({
    taskId: 'task_concurrent_person_verify',
    personAsset: concurrentAsset,
    personSpec: spec,
  }, {
    personIdentity: { verifyPersonAsset: async () => { concurrentCalls += 1; } },
  }), error => error.code === 'PERSON_VERIFICATION_IN_PROGRESS');
  releaseConcurrentVerification();
  await firstConcurrentVerification;
  assert.equal(concurrentCalls, 1, '并发重复点击必须在第二次视觉审核调用前被任务锁拦截');

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
  currentScenePrompt(taskId, 'scene-rejected');
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
  currentScenePrompt(taskId, 'scene-layout');
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
  const conflictingSceneSpec = {
    ...conflictingTask.context.scene_spec,
    layoutText: '画面视觉焦点是一整面连续完整且边界清晰的背景墙，并保留稳定入口、完整地面与无阻挡通道',
    materialLightText: '不锈钢纹理在同一连续基面上自然变化，使用统一柔和主光方向与合理商业辅助照明',
    interactionText: '墙前保留完整商业展示与操作区域，人物和摄影机能够沿清晰通道连续移动且不受遮挡',
    negativeText: '禁止模块化拼板、矩形板块、网格墙、可见接缝、文字水印、重复家具和不相关人物',
  };
  storage.saveOutput(conflictingTask.task.id, 'scene_config', {
    scene_mode: 'single',
    spaces: [{ id: 'scene-conflict-reconciled', name: '连续背景墙', scene_spec: conflictingSceneSpec }],
  });
  currentAllScenePrompts(conflictingTask.task.id);
  const reconciledGenerated = await sceneAssets.generateSceneAsset(conflictingTask.task.id, {
    scene_id: 'scene-conflict-reconciled',
    scene_spec: conflictingSceneSpec,
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
