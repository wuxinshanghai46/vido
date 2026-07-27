const assert = require('assert');

const shotDesign = require('../src/services/newStoryAd/shotDesignService');
const continuity = require('../src/services/newStoryAd/continuityService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const keyframeContracts = require('../src/services/newStoryAd/keyframeContractService');
const keyframePromptInvariants = require('../src/services/newStoryAd/keyframePromptInvariantService');

const empty = shotDesign.normalizeShotDesign({});
assert.strictEqual(empty.shot_scope, 'auto');
assert.strictEqual(empty.surface_topology, undefined);
assert.strictEqual(empty.motion_effect, undefined);
assert.strictEqual(shotDesign.surfacePrompt(empty.surface_topology, empty.shot_scope), '');
assert.strictEqual(shotDesign.motionEffectPrompt(empty.motion_effect), '');

const continuousShot = {
  title: 'generic environment shot',
  visual: 'A task-defined primary surface behind the subject',
  action: 'The subject stands still',
  shot_scope: 'environment',
  surface_topology: {
    mode: 'continuous',
    seam_policy: 'hidden',
    finish_distribution: 'uniform',
  },
};
const surfaceText = shotDesign.surfacePrompt(continuousShot.surface_topology, continuousShot.shot_scope);
assert.match(surfaceText, /ONE monolithic uninterrupted visual plane/i);
assert.match(surfaceText, /ZERO visible joints/i);
assert.match(surfaceText, /ZERO full-height\/full-width boundaries/i);
assert.doesNotMatch(surfaceText, /physically supplied|visually recessive/i);
assert.doesNotMatch(surfaceText, /stainless|wall|actress|佛山/i);

const reconciledUnmappedFinish = shotDesign.resolveSurfaceTopology({
  mode: 'continuous',
  seam_policy: 'hidden',
  finish_distribution: 'regional',
}, '一整面连续完整基面，允许自然纹理局部变化但不得出现边界或接缝');
assert.equal(reconciledUnmappedFinish.finish_distribution, 'uniform', '没有明确空间映射的局部变化不能变成分区饰面');
const reconciledMappedFinish = shotDesign.resolveSurfaceTopology({
  mode: 'continuous',
  seam_policy: 'hidden',
  finish_distribution: 'regional',
}, '左侧区域采用较深饰面，右侧区域保持浅色纹理，过渡无缝');
assert.equal(reconciledMappedFinish.finish_distribution, 'regional', '明确映射到位置的饰面变化应继续支持');

const isolatedHardCut = continuity.continuityContract({
  title: 'independent environment shot',
  scene_id: 'scene_a',
  transition_type: 'hard_cut',
}, {
  title: 'comparison insert',
  scene_id: 'scene_a',
  action: '第一块样品进入画面并与第二块样品比较',
  exit_frame_state: '第一块样品停留在画面中央',
}, 1);
assert.strictEqual(isolatedHardCut.requires_previous_frame, false);
assert.strictEqual(isolatedHardCut.entry_frame_state, '');
assert.strictEqual(isolatedHardCut.action_start, '');

const isolatedPrompt = storyAd.buildKeyframePrompt({
  brief: 'A generic commercial environment',
  product_subject: 'task subject',
  scene_assets: [{
    id: 'scene_a',
    name: 'master environment',
    surface_topology: { mode: 'segmented', seam_policy: 'visible', finish_distribution: 'sample_comparison' },
  }],
}, {
  ...continuousShot,
  scene_id: 'scene_a',
  transition_type: 'hard_cut',
}, {
  visual_contract: {},
  continuity_lock: {
    transition_type: 'hard_cut',
    requires_previous_frame: false,
    entry_frame_state: '第一块样品停留在画面中央',
    action_start: '第一块样品进入画面',
  },
}, 4);
assert.match(isolatedPrompt, /Surface topology lock: ONE monolithic uninterrupted visual plane/);
assert.match(isolatedPrompt, /Seam policy: ZERO visible joints/);
assert.match(isolatedPrompt, /Finish distribution: one coherent dominant finish over the primary surface/);
assert.doesNotMatch(isolatedPrompt, /material may still be physically supplied|Keep any physically necessary task-supported joints visually recessive/);
assert.doesNotMatch(isolatedPrompt, /第一块样品|Entry frame state:|Action start\/end:/);
assert.strictEqual((isolatedPrompt.match(/Shot scope:/g) || []).length, 1);
assert.doesNotMatch(isolatedPrompt, /Master environment only — Surface topology lock:/);

const conflictingContext = {
  brief: '同一艺术空间内展示材质效果',
  product_subject: '任务主体',
  scene_assets: [{
    id: 'scene_continuous',
    name: '连续主场景',
    layout_summary: '一整面连续完整的主墙面',
    material_summary: '表面允许细腻的光泽和微纹理变化，但不得出现板块边界',
    scene_contract: {
      surface_topology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'uniform' },
    },
  }],
};
const conflictingShot = {
  title: '材质灵感展开',
  scene_id: 'scene_continuous',
  shot_scope: 'environment',
  visual: '整面墙由金属拉丝、做旧钢板与细碎纹理等不同质感拼接而成',
  action: '人物观察墙面不同区域的细节变化',
};
const [compiledConflictContract] = keyframeContracts.buildKeyframeContracts(conflictingContext, [conflictingShot]);
assert.equal(compiledConflictContract.visual_contract.shot_design.surface_topology.mode, 'continuous');
assert.equal(compiledConflictContract.visual_contract.shot_design.surface_topology.seam_policy, 'hidden');
assert.equal(compiledConflictContract.visual_contract.shot_design.surface_topology.finish_distribution, 'uniform');
assert.equal(compiledConflictContract.visual_contract.surface_topology_resolution.authority, 'scene_contract');
assert.equal(compiledConflictContract.visual_contract.surface_topology_resolution.conflict, true);
assert.equal(compiledConflictContract.visual_contract.surface_topology_resolution.prompt_semantics_version, 2);
const conflictingPrompt = storyAd.buildKeyframePrompt(conflictingContext, conflictingShot, compiledConflictContract, 0);
assert.match(conflictingPrompt, /Surface conflict resolution \(authoritative\)/i);
assert.match(conflictingPrompt, /SAME monolithic plane/i);
assert.match(conflictingPrompt, /They do not authorize panels, tiles, sample blocks, grids/i);
assert.match(conflictingPrompt, /Surface topology lock: ONE monolithic uninterrupted visual plane/i);
assert.doesNotMatch(conflictingPrompt, /和谐拼接|拼接而成/i);
assert.deepStrictEqual(
  shotDesign.surfacePromptInvariantIssues(conflictingPrompt, compiledConflictContract.visual_contract.shot_design),
  [],
);

const crossIndustryConflicts = [
  ['interior', '不同饰面自然拼接而成，形成完整连续的主背景'],
  ['apparel', '不同面料拼接成一体式无缝衣身，保持同一个完整轮廓'],
  ['automotive', '不同车漆颜色组合并列呈现于同一完整车身表面'],
  ['packaging', '模块化板块与样品墙式色彩展示覆盖同一完整包装正面'],
  ['english', 'Contrasting finishes combine in a panelled patchwork across one uninterrupted product surface'],
];
for (const [industry, visual] of crossIndustryConflicts) {
  const ctx = {
    ...conflictingContext,
    brief: `${industry} task ` + 'task-specific context without unrelated industry inference '.repeat(90),
  };
  const shot = {
    ...conflictingShot,
    title: `${industry} semantic conflict`,
    visual: `${visual}。` + '人物和产品均保持当前任务身份与真实商业摄影质感。'.repeat(30),
    action: '人物观察同一连续基面上的不同区域并说明其设计价值',
    voiceover: '多种材质、质感和颜色能够组合，但整体必须保持统一',
  };
  const [contract] = keyframeContracts.buildKeyframeContracts(ctx, [shot]);
  assert.equal(contract.visual_contract.surface_topology_resolution.conflict, true, `${industry} conflict should compile`);
  const prompt = storyAd.buildKeyframePrompt(ctx, shot, contract, 0);
  assert.ok(prompt.length <= 2400, `${industry} prompt must stay inside provider budget`);
  assert.match(prompt, /Surface conflict resolution \(authoritative\)/i);
  assert.match(prompt, /Surface topology lock: ONE monolithic uninterrupted visual plane/i);
  assert.match(prompt, /Seam policy: ZERO visible joints/i);
  assert.deepStrictEqual(shotDesign.surfacePromptInvariantIssues(prompt, contract.visual_contract.shot_design), []);
  assert.doesNotMatch(prompt, /和谐拼接|拼接而成|模块化板块|样品墙式|panelled patchwork/i);
}

const maxConflictContext = {
  ...conflictingContext,
  brief: '当前任务要求在已验证主场景中展示人物、产品与连续表面的商业价值。'.repeat(80),
  product_subject: '当前任务产品',
  cast_mode: 'single',
  characters: [{ id: 'actor-1', name: '当前任务演员' }],
  person_asset: {
    id: 'actor-1', name: '当前任务演员', image_url: 'https://example.test/actor.png',
    view_images: [{ key: 'front', url: 'https://example.test/actor.png' }],
  },
  person_contract: { person_revision: 2, identity: { face_description: '身份、年龄和外观固定' }, wardrobe: { description: '任务指定服装保持一致' } },
  person_spec: { wardrobeText: '任务指定服装保持一致', appearanceText: '身份、年龄和外观固定' },
  assets: [{ type: 'product', url: 'https://example.test/product.png' }],
  product_contract: {
    status: 'verified', product_revision: 3, reference_images: ['https://example.test/product.png'],
    identity: { description: '当前任务产品身份固定', shape: '形状固定', material: '材质固定', dominant_colors: ['任务指定颜色'] },
  },
  controlled_production: {
    product_control: { enabled: true, presence: 'high', lock_strength: 'strict', methods: ['detail', 'proof'] },
    style_control: { notes: '自然写实商业摄影与任务指定灯光方向' },
    negative_control: { text: '不得切换人物、产品、场景或行业' },
  },
  forbidden: ['不得切换人物、产品、场景或行业'],
};
const maxConflictShot = {
  ...conflictingShot,
  title: '最长提示词冲突门禁',
  subject_type: 'product_only',
  characters: ['actor-1'],
  visual: '人物拿起当前任务产品，身后的连续主表面由多种材质和颜色和谐拼接而成。'.repeat(40),
  action: '人物触摸产品并观察墙面不同区域，保持人物、产品和场景身份不变。'.repeat(20),
  voiceover: '不同材质和颜色可以组合，但设计必须保持统一。'.repeat(12),
  keyframe_notes: '必须同时显示人物、当前任务产品和主场景证据。'.repeat(15),
};
const [maxConflictContract] = keyframeContracts.buildKeyframeContracts(maxConflictContext, [maxConflictShot]);
const maxConflictPrompt = storyAd.buildKeyframePrompt(maxConflictContext, maxConflictShot, maxConflictContract, 0);
assert.ok(maxConflictPrompt.length <= 2400);
assert.match(maxConflictPrompt, /Surface conflict resolution \(authoritative\)/i);
assert.match(maxConflictPrompt, /Surface topology lock: ONE monolithic uninterrupted visual plane/i);
assert.match(maxConflictPrompt, /Seam policy: ZERO visible joints/i);
assert.match(maxConflictPrompt, /Locked real actor\/person asset/i);
assert.match(maxConflictPrompt, /Product identity lock/i);
assert.match(maxConflictPrompt, /Shot scene binding/i);
assert.match(maxConflictPrompt, /Semantic fidelity rule/i);
assert.deepStrictEqual(shotDesign.surfacePromptInvariantIssues(maxConflictPrompt, maxConflictContract.visual_contract.shot_design), []);
assert.deepStrictEqual(keyframePromptInvariants.issues(maxConflictPrompt, {
  design: maxConflictContract.visual_contract.shot_design,
  sceneRequired: true,
  personRequired: true,
  actorLocked: true,
  productRequired: true,
  productLocked: true,
}), []);
assert.doesNotMatch(maxConflictPrompt, /和谐拼接|拼接而成|墙面不同区域/i);

const overflowContract = JSON.parse(JSON.stringify(maxConflictContract));
overflowContract.scene_lock = {
  scene_id: 'scene-overflow',
  scene_name: '当前任务已验证主场景',
  scene_view: 'reverse',
  anchor_ids: ['anchor-a', 'anchor-b', 'anchor-c'],
  zone_ids: ['zone-a', 'zone-b'],
  scene_zone_id: 'zone-a',
  scene_zone_label_zh: '任务指定交互区域与连续主表面',
  transition_from: 'scene-overflow/master',
  transition_reason: '保持同一物理空间与任务叙事连续性'.repeat(8),
};
overflowContract.continuity_lock = {
  requires_previous_frame: true,
  transition_type: 'cut_on_action',
  continuity_from: '上一镜已接受关键帧',
  entry_frame_state: '人物、产品、灯光、相机轴线和道具状态必须继承'.repeat(12),
  exit_frame_state: '动作完成后仍保持同一人物、产品和场景身份'.repeat(12),
  action_start: '人物开始观察任务指定对象'.repeat(8),
  action_end: '人物完成当前镜头动作'.repeat(8),
  object_states: '所有任务对象的位置、朝向、状态与上一镜一致'.repeat(12),
  transition_reason: '连续动作匹配'.repeat(12),
};
overflowContract.visual_contract = {
  ...overflowContract.visual_contract,
  composition: '严格保持任务指定主体、环境证据、相机关系和视觉层级'.repeat(20),
  subject: '当前任务人物与产品身份不可替换'.repeat(20),
  evidence: '任务指定产品、交互动作和场景锚点必须清晰可见'.repeat(20),
  style: '真实商业摄影、自然材质、任务指定灯光和镜头质感'.repeat(20),
  style_direction: '保持同一任务的真实摄影方向'.repeat(20),
  negative_requirements: '禁止替换行业、地点、人物、产品、结构或视觉载体'.repeat(20),
};
overflowContract.visual_contract.shot_design.motion_effect = {
  type: 'controlled_transition',
  source_state: '当前任务连续表面与全部身份锁定保持稳定'.repeat(12),
  target_state: '仅允许任务指定的光学与微纹理变化'.repeat(12),
  timeline: '按任务镜头节奏渐进变化并在结束帧稳定'.repeat(12),
  preserve_scene_geometry: true,
  target_reference_asset: 'task-reference-asset',
  notes: '不得引入新结构、新行业或新对象'.repeat(12),
};
const overflowPrompt = storyAd.buildKeyframePrompt(
  maxConflictContext,
  maxConflictShot,
  overflowContract,
  0,
  {
    sceneAsset: {
      id: 'scene-overflow',
      name: '当前任务已验证主场景',
      image_url: 'https://example.test/scene.png',
      lock_strength: 'strict',
      material_summary: '任务指定材质和连续表面结构'.repeat(30),
      layout_summary: '任务指定空间拓扑、功能区域和相机关系'.repeat(30),
      style_summary: '任务指定真实商业摄影风格'.repeat(30),
      view_images: [
        { key: 'master', url: 'https://example.test/master.png' },
        { key: 'reverse', url: 'https://example.test/reverse.png' },
      ],
    },
    previousFrame: {
      index: 1,
      title: '上一镜',
      image_url: 'https://example.test/previous.png',
      prompt: '上一镜的任务人物、产品、场景、灯光、道具和相机关系均已确认'.repeat(40),
    },
  },
);
assert.ok(overflowPrompt.length <= 2400);
assert.match(overflowPrompt, /Semantic fidelity rule:/i);
assert.match(overflowPrompt, /Surface conflict resolution \(authoritative\):/i);
assert.match(overflowPrompt, /Shot scene binding:/i);
assert.match(overflowPrompt, /Locked real actor\/person asset:/i);
assert.match(overflowPrompt, /Product identity lock:/i);
assert.deepStrictEqual(keyframePromptInvariants.issues(overflowPrompt, {
  design: overflowContract.visual_contract.shot_design,
  sceneRequired: true,
  personRequired: true,
  actorLocked: true,
  productRequired: true,
  productLocked: true,
}), []);

assert.throws(
  () => shotDesign.assertSurfacePromptConsistent(
    'Visual: multiple finishes are spliced into panels\nSurface topology lock: ONE monolithic uninterrupted visual plane\nSeam policy: ZERO visible joints',
    compiledConflictContract.visual_contract.shot_design,
  ),
  error => error.code === 'KEYFRAME_PROMPT_CONTRACT_CONFLICT'
    && error.details.issues.includes('missing_surface_conflict_resolution')
    && error.details.issues.includes('unresolved_segmented_surface_narrative'),
);
assert.throws(
  () => keyframePromptInvariants.assertPrompt('Semantic fidelity rule: keep the current task.', {
    sceneRequired: true,
    personRequired: true,
    actorLocked: true,
    productRequired: true,
    productLocked: true,
  }),
  error => error.code === 'KEYFRAME_PROMPT_INVARIANT_FAILED'
    && error.details.issues.includes('missing_scene_binding')
    && error.details.issues.includes('missing_actor_identity')
    && error.details.issues.includes('missing_product_identity'),
);

const [comparisonContract] = keyframeContracts.buildKeyframeContracts(conflictingContext, [{
  ...conflictingShot,
  title: '独立样品对比',
  shot_scope: 'product_comparison',
  surface_topology: { mode: 'segmented', seam_policy: 'visible', finish_distribution: 'sample_comparison' },
}]);
assert.equal(comparisonContract.visual_contract.shot_design.surface_topology.mode, 'segmented');
assert.equal(comparisonContract.visual_contract.surface_topology_resolution.authority, 'isolated_shot_contract');
assert.equal(comparisonContract.visual_contract.surface_topology_resolution.conflict, false);

const comparisonText = shotDesign.surfacePrompt({
  mode: 'segmented',
  seam_policy: 'visible',
  finish_distribution: 'sample_comparison',
}, 'product_comparison');
assert.match(comparisonText, /isolated product\/sample comparison insert/i);
assert.match(comparisonText, /must not redefine the topology of the master environment/i);
const comparisonKeyframePrompt = storyAd.buildKeyframePrompt({
  brief: 'A generic material comparison task',
  product_subject: 'task subject',
}, {
  title: 'comparison insert',
  visual: 'Three task-defined samples shown independently',
  action: 'Camera passes across the samples',
  shot_scope: 'product_comparison',
  surface_topology: { mode: 'segmented', seam_policy: 'visible', finish_distribution: 'sample_comparison' },
}, { visual_contract: {} }, 3);
assert.match(comparisonKeyframePrompt, /isolated product\/sample comparison insert/i);

const particleShot = {
  title: 'brand endcard',
  visual: 'A clean task-defined background with dispersed material particles and clear central space',
  action: 'Particles gather into the authored target',
  shot_scope: 'brand_endcard',
  motion_effect: {
    type: 'particle_assembly',
    source_state: 'particles remain dispersed around the center',
    target_state: 'the approved brand mark is fully formed',
    timeline: '0-1s hold; 1-3.5s converge; 3.5-4.5s form; final frame holds',
    preserve_scene_geometry: true,
  },
};
const keyframePrompt = storyAd.buildKeyframePrompt({
  brief: 'A generic commercial task',
  product_subject: 'task subject',
  output_ratio: '9:16',
}, particleShot, { visual_contract: {} }, 5);
assert.match(keyframePrompt, /START KEYFRAME/i);
assert.match(keyframePrompt, /not yet fully formed/i);

const motionPrompt = videoAdapter.clipPrompt(particleShot, { product_subject: 'task subject' }, {}, null);
assert.match(motionPrompt, /Within-shot motion effect: particle_assembly/i);
assert.match(motionPrompt, /Do not substitute a simple opacity fade or dissolve/i);
assert.match(motionPrompt, /explicitly authored effect target is allowed/i);

const defaultMotionPrompt = videoAdapter.clipPrompt({ visual: 'ordinary frame', action: 'ordinary motion' }, { product_subject: 'task subject' }, {}, null);
assert.doesNotMatch(defaultMotionPrompt, /Within-shot motion effect/i);
assert.match(defaultMotionPrompt, /Do not add unrelated people, objects, text, logos/i);

const stateContract = continuity.continuityContract({
  object_states: { package: 'open', product: { position: 'right', state: 'stable' } },
});
assert.match(stateContract.object_states, /package: open/i);
assert.match(stateContract.object_states, /position: right/i);
assert.doesNotMatch(stateContract.object_states, /\[object Object\]/i);

const defaultScenePrompt = sceneAssets.buildSceneSheetPrompt({ ctx: { brief: 'generic task' } });
assert.match(defaultScenePrompt, /visible panel seams, joints/i);
assert.doesNotMatch(defaultScenePrompt, /Task-specific surface construction contract|Shot scope:/i);
const continuousScenePrompt = sceneAssets.buildSceneSheetPrompt({
  ctx: {
    brief: 'generic task',
    scene_spec: {
      surfaceTopology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'uniform' },
    },
  },
});
assert.match(continuousScenePrompt, /one optically uninterrupted primary plane/i);
assert.doesNotMatch(continuousScenePrompt, /visible panel seams, joints/i);

const singleWallTopology = shotDesign.resolveSurfaceTopology(undefined, [
  '空间采用开放式布局，只设置一面主背景墙，展示任务指定材料。',
  '材质说明同时提到铂棕纹理、做旧钢板和拉丝质感，但没有指定第二面墙。',
]);
assert.equal(singleWallTopology.primary_surface_count, 1, '普通“一面墙”必须编译为明确的几何数量');
assert.equal(singleWallTopology.secondary_surface_policy, 'forbidden');
assert.equal(singleWallTopology.mode, 'auto', '一面墙是数量约束，不应被误判为无缝连续表面');
assert.equal(singleWallTopology.seam_policy, 'auto');
assert.equal(singleWallTopology.finish_distribution, 'uniform', '未映射到具体区域的多个饰面词不能授权额外墙面');
const singleWallText = shotDesign.surfacePrompt(singleWallTopology, 'environment');
assert.match(singleWallText, /EXACTLY ONE prominent task-material display\/background plane/i);
assert.match(singleWallText, /second feature wall.*column.*freestanding panel/i);
assert.match(singleWallText, /Secondary surface policy: FORBIDDEN/i);

const singleWallScenePrompt = sceneAssets.buildSceneSheetPrompt({
  ctx: {
    brief: '通用空间材料展示',
    scene_spec: {
      layoutText: '开放式空间中只设置一面主展示墙，其他边界退居背景。',
      materialLightText: '主墙呈现任务指定金属纹理；材料说明还包含做旧和拉丝观察词。',
    },
  },
});
assert.match(singleWallScenePrompt, /EXACTLY ONE prominent task-material display\/background plane/i);
assert.match(singleWallScenePrompt, /exactly one prominent task-material plane/i);
assert.doesNotMatch(singleWallScenePrompt, /visible panel seams, joints, bevels/i);

const genericMultiWallTopology = shotDesign.resolveSurfaceTopology(undefined, '完整室内空间，按任务需要设置多面围护墙体。');
assert.strictEqual(genericMultiWallTopology, undefined, '没有单墙意图的通用空间不得被全局强制成一面墙');

console.log('new-story-ad shot design tests passed');
