const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'new-story-ad-multi-space-cast-recovery');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_PUBLIC_BASE_URL = 'https://test.invalid';
process.env.NEW_STORY_AD_SCENE_IMAGE_RETRY_DELAY_MS = '1';
process.env.NEW_STORY_AD_MOCK_LLM = '1';

const storage = require('../src/services/newStoryAd/storageService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');
const sceneBinding = require('../src/services/newStoryAd/sceneBindingService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const generateSceneAssetWithLegacyMaintenancePath = sceneAssets.generateSceneAsset;
sceneAssets.generateSceneAsset = (taskId, body = {}, runOptions = {}) => generateSceneAssetWithLegacyMaintenancePath(
  taskId,
  { view_strategy: 'image_derived', ...body },
  { ...runOptions, maintenanceLegacyAcquisition: true },
);
const sceneCheckpoint = require('../src/services/newStoryAd/sceneGenerationCheckpointService');
const subjectBundles = require('../src/services/newStoryAd/subjectAssetBundleService');

function fullSceneSpec(marker, place) {
  return {
    layoutText: `${marker} ${place} complete footprint, one entrance, one action zone, stable anchors and circulation.`,
    materialLightText: `${marker} ${place} task-specific materials with physically plausible daylight and practical light.`,
    interactionText: `${marker} ${place} empty reachable interaction zone with a clear access route and usable cameras.`,
    negativeText: `${marker} ${place} no people, no labels, no unrelated location, no duplicated anchors.`,
  };
}

function human(id, name, role, marker) {
  return {
    id,
    displayName: name,
    roleName: role,
    appearanceText: `${marker}_APPEARANCE`,
    wardrobeText: `${marker}_WARDROBE`,
    hairMakeupText: `${marker}_HAIR`,
    negativeText: `${marker}_NEGATIVE`,
  };
}

function pet(id, name, type, marker) {
  return {
    id,
    name,
    type,
    breed: `${marker}_BREED`,
    appearance: `${marker}_APPEARANCE`,
  };
}

function verifiedSceneContract(sceneId) {
  return {
    schema_version: 1,
    scene_id: sceneId,
    full_space_lock: true,
    qa_unavailable: false,
    verification: { state: 'verified' },
    requirement_qa: {
      pass: true,
      layout_match_score: 0.98,
      material_light_match_score: 0.98,
      interaction_match_score: 0.98,
      surface_topology_match_score: 0.98,
      negative_compliance_score: 0.98,
      mismatch_reasons: [],
    },
    cross_view_qa: {
      pass: true,
      root_identity_score: 0.98,
      geometry_score: 0.98,
      material_score: 0.98,
      lighting_score: 0.98,
      mismatch_reasons: [],
    },
    spatial_coverage_qa: {
      pass: true,
      layout_topology_score: 0.98,
      camera_diversity_score: 0.98,
      reverse_coverage_score: 0.98,
      interaction_zone_score: 0.98,
      reasons: [],
    },
    layout_contract: {
      required: true,
      status: 'available',
      mode: 'near_vertical_topdown_reference',
    },
    view_issues: [],
  };
}

function assertCountsAndMemberIsolation() {
  const modes = [
    {
      name: 'single',
      body: { cast_mode: 'single', cast_profiles: [human('h1', 'Alice', 'lead', 'SINGLE_A')] },
      expected: { mode: 'single', people: 1, pets: 0 },
    },
    {
      name: 'dual',
      body: {
        cast_mode: 'dual',
        cast_profiles: [
          human('h1', 'Alice', 'lead', 'DUAL_A'),
          human('h2', 'Bob', 'support', 'DUAL_B'),
        ],
      },
      expected: { mode: 'dual', people: 2, pets: 0 },
    },
    {
      name: 'multi',
      body: {
        cast_mode: 'multi',
        expected_people: 3,
        cast_profiles: [
          human('h1', 'Alice', 'mother', 'MULTI_A'),
          human('h2', 'Bob', 'father', 'MULTI_B'),
          human('h3', 'Carol', 'child', 'MULTI_C'),
        ],
      },
      expected: { mode: 'multi', people: 3, pets: 0 },
    },
    {
      name: 'human_pet',
      body: {
        cast_mode: 'human_pet',
        expected_people: 2,
        expected_animals: 1,
        cast_profiles: [
          human('h1', 'Alice', 'mother', 'HUMAN_PET_A'),
          human('h2', 'Carol', 'child', 'HUMAN_PET_B'),
        ],
        pet_profiles: [pet('p1', 'Goldie', 'dog', 'HUMAN_PET_P')],
      },
      expected: { mode: 'human_pet', people: 2, pets: 1 },
    },
    {
      name: 'animal',
      body: {
        cast_mode: 'animal',
        expected_people: 0,
        expected_animals: 2,
        pet_profiles: [
          pet('p1', 'Goldie', 'dog', 'ANIMAL_A'),
          pet('p2', 'Mimi', 'cat', 'ANIMAL_B'),
        ],
      },
      expected: { mode: 'animal', people: 0, pets: 2 },
    },
  ];

  modes.forEach(testCase => {
    const counts = subjectBundles.resolveCounts({}, testCase.body);
    assert.deepStrictEqual(counts, testCase.expected, `${testCase.name} must preserve exact human/pet counts`);
    const humans = subjectBundles.humanMemberSpecs({}, testCase.body, counts.people);
    const pets = subjectBundles.petMemberSpecs({}, testCase.body, counts.pets);
    assert.strictEqual(subjectBundles.assertCompleteSubjectProfiles(counts, humans, pets), true);

    humans.forEach((member, index) => {
      const prompt = subjectBundles.humanPrompt(member, humans.length);
      assert(prompt.includes(member.appearanceText));
      assert(prompt.includes(member.wardrobeText));
      assert(prompt.includes(member.hairMakeupText));
      humans.filter((_, other) => other !== index).forEach(other => {
        assert(!prompt.includes(other.appearanceText), `${testCase.name} member prompt leaked another appearance`);
        assert(!prompt.includes(other.wardrobeText), `${testCase.name} member prompt leaked another wardrobe`);
        assert(!prompt.includes(other.hairMakeupText), `${testCase.name} member prompt leaked another hair/makeup`);
      });
    });
    pets.forEach((profile, index) => {
      const prompt = subjectBundles.petPrompt(profile, pets.length);
      assert(prompt.includes(profile.appearance));
      pets.filter((_, other) => other !== index).forEach(other => {
        assert(!prompt.includes(other.appearance), `${testCase.name} pet prompt leaked another pet appearance`);
      });
    });
  });

  assert.deepStrictEqual(
    subjectBundles.resolveCounts({}, { cast_mode: 'multi', expected_people: 999, expected_animals: 999 }),
    { mode: 'multi', people: 12, pets: 8 },
    'counts must be capped before any supplier work',
  );
  assert.deepStrictEqual(
    subjectBundles.resolveCounts({}, { cast_mode: 'animal', expected_people: 0, expected_animals: 0 }),
    { mode: 'animal', people: 0, pets: 0 },
    'explicit zero must not be overwritten by a truthy fallback',
  );
  const recoveredFromContract = subjectBundles.humanMemberSpecs({}, {
    cast_profiles: [{
      id: 'contract_only',
      displayName: 'Contract Actor',
      roleName: 'lead',
      appearanceText: '[object Object]',
      appearance: { userPrompt: '' },
      wardrobe: { userPrompt: '' },
      hairMakeup: { userPrompt: '' },
      person_contract: {
        identity: { face_description: 'CONTRACT_FACE' },
        wardrobe: { description: 'CONTRACT_WARDROBE' },
        appearance: { hair_style: 'CONTRACT_HAIR' },
      },
    }],
  }, 1)[0];
  assert.strictEqual(recoveredFromContract.appearanceText, 'CONTRACT_FACE');
  assert.strictEqual(recoveredFromContract.wardrobeText, 'CONTRACT_WARDROBE');
  assert.strictEqual(recoveredFromContract.hairMakeupText, 'CONTRACT_HAIR');
  assert.throws(
    () => subjectBundles.assertCompleteSubjectProfiles(
      subjectBundles.resolveCounts({}, {
        cast_mode: 'single',
        expected_people: 2,
        cast_profiles: [
          human('single_conflict_1', 'Alice', 'lead', 'SINGLE_CONFLICT_A'),
          human('single_conflict_2', 'Bob', 'support', 'SINGLE_CONFLICT_B'),
        ],
      }),
      [
        human('single_conflict_1', 'Alice', 'lead', 'SINGLE_CONFLICT_A'),
        human('single_conflict_2', 'Bob', 'support', 'SINGLE_CONFLICT_B'),
      ],
      [],
    ),
    error => error?.code === 'SUBJECT_PROFILES_REQUIRED' && error?.expected_count === 1,
    'single mode with two people must fail before supplier work',
  );
  assert.throws(
    () => subjectBundles.assertCompleteSubjectProfiles(
      { mode: 'human_pet', people: 1, pets: 1 },
      [human('shared_subject_id', 'Alice', 'lead', 'CROSS_ID_HUMAN')],
      [pet('shared_subject_id', 'Goldie', 'dog', 'CROSS_ID_PET')],
    ),
    error => error?.code === 'SUBJECT_PROFILES_REQUIRED'
      && error?.duplicate_ids?.includes('shared_subject_id'),
    'human and pet IDs must also be unique across subject kinds',
  );
}

async function assertSubjectSupplierPreflightAndConcurrency() {
  let supplierCalls = 0;
  const noCallMedia = {
    generateActorReference: async () => {
      supplierCalls += 1;
      throw new Error('supplier must not be called');
    },
  };
  await assert.rejects(
    () => subjectBundles.generateSubjectBundle({
      taskId: 'subject-missing-cast',
      body: { cast_mode: 'dual', expected_people: 2, cast_profiles: [] },
    }, { mediaAdapter: noCallMedia }),
    error => error?.code === 'SUBJECT_PROFILES_REQUIRED'
      && error.expected_count === 2
      && error.actual_count === 0,
  );
  assert.strictEqual(supplierCalls, 0, 'missing cast profiles must fail before supplier call');

  let releaseFirst;
  let firstStarted;
  const firstStartedPromise = new Promise(resolve => { firstStarted = resolve; });
  const firstReleasePromise = new Promise(resolve => { releaseFirst = resolve; });
  const saved = new Map();
  const body = {
    cast_mode: 'single',
    cast_profiles: [human('concurrent_h1', 'Concurrent Alice', 'lead', 'CONCURRENT_A')],
  };
  const concurrentMedia = {
    ASSET_DIR: '',
    generateActorReference: async () => {
      supplierCalls += 1;
      firstStarted();
      await firstReleasePromise;
      return { url: '/mock-sheet.png', image_url: '/mock-sheet.png' };
    },
    splitActorSheet: async () => ['front', 'side', 'back', 'action'].map(key => ({
      key,
      url: `/mock-${key}.png`,
      image_url: `/mock-${key}.png`,
    })),
    splitReferenceSheet: async ({ viewKeys = [] }) => viewKeys.map(key => ({
      key,
      url: `/mock-${key}.png`,
      image_url: `/mock-${key}.png`,
    })),
    generateImage: async ({ filename }) => ({
      filename,
      url: `/mock/${filename}.png`,
      image_url: `/mock/${filename}.png`,
      provider_used: 'mock-image',
    }),
    publicAssetUrl: filename => `/mock/${filename}`,
  };
  const concurrentStorage = {
    getOutput: (taskId, kind) => saved.get(`${taskId}:${kind}`) || null,
    saveOutput: (taskId, kind, value) => saved.set(`${taskId}:${kind}`, JSON.parse(JSON.stringify(value))),
  };
  const personIdentity = {
    verifyPersonAsset: async () => ({
      status: 'verified',
      person_revision: 1,
      cross_view_qa: { pass: true },
      reference_views: {},
    }),
  };
  const first = subjectBundles.generateSubjectBundle(
    { taskId: 'subject-concurrent', body },
    { mediaAdapter: concurrentMedia, storage: concurrentStorage, personIdentity },
  );
  await firstStartedPromise;
  await assert.rejects(
    () => subjectBundles.generateSubjectBundle(
      { taskId: 'subject-concurrent', body },
      { mediaAdapter: concurrentMedia, storage: concurrentStorage, personIdentity },
    ),
    error => error?.code === 'SUBJECT_ASSET_GENERATION_IN_PROGRESS',
  );
  releaseFirst();
  await first;
  assert.strictEqual(supplierCalls, 6, 'same subject batch may run only one four-atlas plus native face/body dossier');

  let cancellationChecks = 0;
  let cancellationSupplierCalls = 0;
  const cancelError = Object.assign(new Error('cancelled by QA'), { code: 'USER_CANCELLED', cancelled: true });
  const cancelBody = {
    cast_mode: 'dual',
    expected_people: 2,
    cast_profiles: [
      human('cancel_h1', 'Cancel Alice', 'lead', 'CANCEL_A'),
      human('cancel_h2', 'Cancel Bob', 'support', 'CANCEL_B'),
    ],
  };
  await assert.rejects(
    () => subjectBundles.generateSubjectBundle(
      { taskId: 'subject-cancel', body: cancelBody },
      {
        mediaAdapter: {
          ...concurrentMedia,
          generateActorReference: async () => {
            cancellationSupplierCalls += 1;
            return { url: '/cancel-sheet.png', image_url: '/cancel-sheet.png' };
          },
        },
        storage: concurrentStorage,
        personIdentity,
        cancellation: {
          throwIfCancelled: () => {
            cancellationChecks += 1;
            if (cancellationChecks >= 2) throw cancelError;
          },
        },
      },
    ),
    error => error?.code === 'USER_CANCELLED',
  );
  assert.strictEqual(cancellationSupplierCalls, 6, 'cancellation after the first complete six-image member must block later member calls');
}

async function assertMultiSpacePromptsAndRecovery() {
  assert.strictEqual(typeof sceneBinding.normalizeScenePlan, 'function', 'scene plan normalizer must be public');
  assert.strictEqual(typeof sceneBinding.resolveSceneGenerationTarget, 'function', 'scene target resolver must be public');

  const parkSpec = fullSceneSpec('PARK_ONLY_MARKER', 'park lawn');
  const homeSpec = fullSceneSpec('HOME_ONLY_MARKER', 'family living room');
  const scenePlan = sceneBinding.normalizeScenePlan({
    mode: 'multi',
    spaces: [
      { id: 'space_park', name: 'Park', scene_spec: parkSpec },
      { space_id: 'space_home', name: 'Home', scene_spec: homeSpec },
    ],
  });
  assert.deepStrictEqual(scenePlan.spaces.map(space => space.space_id), ['space_park', 'space_home']);
  assert.deepStrictEqual(scenePlan.spaces.map(space => space.scene_id), ['space_park', 'space_home']);

  const baseContext = {
    brief: 'Move from a park scene to a family home scene.',
    product_subject: 'test subject',
    cast_mode: 'no_human',
    scene_mode: 'multi',
    scene_plan: scenePlan,
  };
  const sceneConfig = { mode: 'multi', spaces: scenePlan.spaces };
  const parkTarget = sceneBinding.resolveSceneGenerationTarget({
    sceneConfig,
    context: baseContext,
    body: { space_id: 'space_park' },
  });
  const homeTarget = sceneBinding.resolveSceneGenerationTarget({
    sceneConfig,
    context: baseContext,
    body: { scene_id: 'space_home' },
  });
  assert.strictEqual(parkTarget.scene_id, 'space_park');
  assert.strictEqual(homeTarget.scene_id, 'space_home');
  assert(parkTarget.scene_spec.layoutText.includes('PARK_ONLY_MARKER'));
  assert(homeTarget.scene_spec.layoutText.includes('HOME_ONLY_MARKER'));

  const elevenSpacePlan = sceneBinding.normalizeScenePlan({
    mode: 'multi',
    spaces: Array.from({ length: 11 }, (_, index) => ({
      id: `space_${index + 1}`,
      name: `Space ${index + 1}`,
      scene_spec: fullSceneSpec(`AUTHORITY_${index + 1}`, `room ${index + 1}`),
    })),
  });
  const repairedTargets = elevenSpacePlan.spaces.map((space, index) => sceneBinding.resolveSceneGenerationTarget({
    sceneConfig: elevenSpacePlan,
    context: { ...baseContext, scene_mode: 'multi', scene_plan: elevenSpacePlan },
    body: {
      space_id: space.id,
      scene_spec: {
        layout: `客户端编辑布局 ${index + 1}`,
        materials: '',
        light: '',
        interaction: `客户端互动 ${index + 1}`,
        negative: `客户端限制 ${index + 1}`,
      },
    },
  }));
  assert.equal(repairedTargets.length, 11, '联合生成必须逐一覆盖 11 个独立场景');
  repairedTargets.forEach((target, index) => {
    assert.equal(target.scene_spec.layoutText, `客户端编辑布局 ${index + 1}`);
    assert(target.scene_spec.materialLightText.includes(`AUTHORITY_${index + 1}`), '旧客户端缺字段时必须按同一 space_id 补回权威材质光线合同');
    assert(!sceneBinding.sceneSpecMissingFields(target.scene_spec).length, '合并后的每个场景合同必须完整');
  });

  const staleWallSpec = {
    ...parkSpec,
    layoutText: '旧配置：多块展示墙与侧墙共同承载不同材料。',
    surfaceTopology: {
      mode: 'continuous',
      seam_policy: 'hidden',
      finish_distribution: 'regional',
    },
  };
  const editedWallSpec = {
    ...parkSpec,
    layoutText: '当前用户编辑：展厅只保留一面完整的艺术背景墙，其他侧墙不得承载展示材料。',
    surfaceTopology: {
      mode: 'continuous',
      seam_policy: 'hidden',
      finish_distribution: 'regional',
    },
  };
  const staleWallPlan = sceneBinding.normalizeScenePlan({
    mode: 'single',
    spaces: [{ id: 'space_wall', name: 'Wall', scene_spec: staleWallSpec }],
  });
  const editedWallTarget = sceneBinding.resolveSceneGenerationTarget({
    sceneConfig: staleWallPlan,
    context: { ...baseContext, scene_mode: 'single', scene_plan: staleWallPlan },
    body: { space_id: 'space_wall', scene_spec: editedWallSpec },
  });
  assert.strictEqual(editedWallTarget.submitted_scene_spec_used, true, 'current submitted scene spec must override persisted plan');
  assert(editedWallTarget.scene_spec.layoutText.includes('当前用户编辑'), 'generation target must use the current edited text');
  assert(!editedWallTarget.scene_spec.layoutText.includes('旧配置'), 'stale persisted scene text must not survive');
  assert.strictEqual(editedWallTarget.scene_spec.surfaceTopology.mode, 'auto', 'one wall must not inherit inferred seamless mode');
  assert.strictEqual(editedWallTarget.scene_spec.surfaceTopology.seam_policy, 'auto', 'one wall must not inherit inferred hidden seams');
  assert.strictEqual(editedWallTarget.scene_spec.surfaceTopology.primary_surface_count, 1, 'one-wall edit must become a cardinality contract');
  assert.strictEqual(editedWallTarget.scene_spec.surfaceTopology.secondary_surface_policy, 'forbidden', 'one-wall edit must forbid secondary display surfaces');
  assert(editedWallTarget.scene_plan.spaces[0].scene_spec.layoutText.includes('当前用户编辑'), 'returned scene plan must persist the authoritative edit');

  const calls = [];
  const originalGenerateImage = mediaAdapter.generateImage;
  const originalAnalyze = sceneSpace.analyzeSceneViews;
  const originalValidateLayout = sceneSpace.validateLayoutAcquisition;
  let failUnknownLayoutFor = '';
  mediaAdapter.generateImage = async options => {
    calls.push(options);
    const key = /_(master|layout|reverse|interaction|detail)_/.exec(options.filename)?.[1] || 'unknown';
    if (key === 'layout' && failUnknownLayoutFor && options.taskId === failUnknownLayoutFor) {
      failUnknownLayoutFor = '';
      const error = new Error('HTTP 500 / UNKXXXO004IFR / billing_state=unknown');
      error.code = 'PROVIDER_5XX_AMBIGUOUS';
      error.billing_state = 'unknown';
      error.retryable = false;
      throw error;
    }
    return {
      url: `/mock-${options.taskId}-${key}-${calls.length}.png`,
      image_url: `/mock-${options.taskId}-${key}-${calls.length}.png`,
      provider_used: 'mock/image2',
    };
  };
  sceneSpace.validateLayoutAcquisition = async () => ({
    pass: true,
    layout_role_score: 0.98,
    footprint_coverage_score: 0.98,
    overhead_verticality_score: 0.98,
    boundary_completeness_score: 0.98,
    estimated_downward_pitch_degrees: 88,
    visible_horizon: false,
    dominant_vertical_wall_face: false,
    complete_perimeter_visible: true,
    ceiling_removed_or_not_visible: true,
    master_like_composition: false,
    scene_identity_score: 0.98,
    camera_relocation_score: 0.98,
    reasons: [],
  });
  sceneSpace.analyzeSceneViews = async options => verifiedSceneContract(options.sceneId);

  try {
    for (const [taskId, targetId] of [['multi-space-park', 'space_park'], ['multi-space-home', 'space_home']]) {
      storage.createTask({ id: taskId, title: taskId, request: baseContext });
      storage.saveOutput(taskId, 'context', baseContext);
      storage.saveOutput(taskId, 'scene_config', sceneConfig);
      await sceneAssets.generateSceneAsset(taskId, { space_id: targetId });
    }
    const parkCalls = calls.filter(call => call.taskId === 'multi-space-park');
    const homeCalls = calls.filter(call => call.taskId === 'multi-space-home');
    assert.strictEqual(parkCalls.length, 5);
    assert.strictEqual(homeCalls.length, 5);
    parkCalls.forEach(call => {
      assert(call.prompt.includes('PARK_ONLY_MARKER'), 'park prompt must contain its own space contract');
      assert(!call.prompt.includes('HOME_ONLY_MARKER'), 'park prompt must not contain home contract');
    });
    homeCalls.forEach(call => {
      assert(call.prompt.includes('HOME_ONLY_MARKER'), 'home prompt must contain its own space contract');
      assert(!call.prompt.includes('PARK_ONLY_MARKER'), 'home prompt must not contain park contract');
    });

    const missingPlanTask = 'multi-space-missing-plan';
    const missingPlanContext = { ...baseContext, scene_plan: null };
    storage.createTask({ id: missingPlanTask, title: missingPlanTask, request: missingPlanContext });
    storage.saveOutput(missingPlanTask, 'context', missingPlanContext);
    storage.saveOutput(missingPlanTask, 'scene_config', { mode: 'multi', spaces: [] });
    const callsBeforeMissingPlan = calls.length;
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(missingPlanTask, { space_id: 'space_park' }),
      error => error?.status === 422,
    );
    assert.strictEqual(calls.length, callsBeforeMissingPlan, 'missing multi-space plan must fail before supplier');

    const unknownTask = 'multi-space-layout-unknown';
    storage.createTask({ id: unknownTask, title: unknownTask, request: baseContext });
    storage.saveOutput(unknownTask, 'context', baseContext);
    storage.saveOutput(unknownTask, 'scene_config', sceneConfig);
    failUnknownLayoutFor = unknownTask;
    const unknownStart = calls.length;
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(unknownTask, { space_id: 'space_park' }),
      error => error?.code === 'PROVIDER_5XX_AMBIGUOUS'
        && error?.partial_scene_checkpoint === true,
    );
    assert.strictEqual(calls.length - unknownStart, 2, 'unknown layout failure must stop after master and layout');
    const partial = storage.getOutput(unknownTask, sceneCheckpoint.outputKind('space_park'));
    assert.strictEqual(partial.scene_id, 'space_park');
    assert.strictEqual(partial.views.master.status, 'succeeded');
    assert.strictEqual(partial.views.layout.status, 'failed');
    assert.strictEqual(partial.views.layout.billing_state, 'unknown');

    await assert.rejects(
      () => sceneAssets.generateSceneAsset(unknownTask, { space_id: 'space_park' }),
      error => error?.code === 'SCENE_ASSET_BILLING_UNKNOWN'
        && error?.details?.requires_billing_acknowledgement === true,
    );
    assert.strictEqual(calls.length - unknownStart, 2, 'unacknowledged unknown billing must make zero new supplier calls');

    const legacyUnknownTask = 'multi-space-legacy-layout-unknown';
    storage.createTask({ id: legacyUnknownTask, title: legacyUnknownTask, request: baseContext });
    storage.saveOutput(legacyUnknownTask, 'context', baseContext);
    storage.saveOutput(legacyUnknownTask, 'scene_config', sceneConfig);
    storage.saveOutput(legacyUnknownTask, sceneCheckpoint.outputKind('space_park'), {
      task_id: legacyUnknownTask,
      scene_id: 'space_park',
      status: 'partial',
      input_fingerprint: 'legacy-checkpoint-without-billing-fields',
      views: {
        master: {
          status: 'succeeded',
          attempts: 1,
          url: '/mock-legacy-master.png',
          image_url: '/mock-legacy-master.png',
        },
        layout: {
          status: 'failed',
          attempts: 1,
          error_code: 'PROVIDER_5XX_AMBIGUOUS',
        },
      },
    });
    const callsBeforeLegacyGuard = calls.length;
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(legacyUnknownTask, { space_id: 'space_park' }),
      error => error?.code === 'SCENE_ASSET_BILLING_UNKNOWN'
        && error?.details?.failed_views?.[0]?.key === 'layout',
    );
    assert.strictEqual(
      calls.length,
      callsBeforeLegacyGuard,
      'legacy ambiguous 5xx without billing fields must make zero supplier calls',
    );

    const recovered = await sceneAssets.generateSceneAsset(unknownTask, {
      space_id: 'space_park',
      acknowledge_billing_unknown: true,
    });
    const recoveryCalls = calls.slice(unknownStart);
    assert.strictEqual(recoveryCalls.filter(call => /_master_/.test(call.filename)).length, 1);
    assert.strictEqual(recoveryCalls.filter(call => /_layout_/.test(call.filename)).length, 2);
    assert.strictEqual(recoveryCalls.length, 6, 'recovery must add only layout plus three derived views');
    assert.strictEqual(recovered.scene_asset.scene_id, 'space_park');
    assert.strictEqual(recovered.scene_asset.view_acquisition.resumed_from_checkpoint, true);
  } finally {
    mediaAdapter.generateImage = originalGenerateImage;
    sceneSpace.analyzeSceneViews = originalAnalyze;
    sceneSpace.validateLayoutAcquisition = originalValidateLayout;
  }
}

async function main() {
  assertCountsAndMemberIsolation();
  const cancelledCheckpoint = {
    status: 'running',
    views: {
      master: { status: 'succeeded', url: '/master.png', image_url: '/master.png' },
    },
  };
  sceneCheckpoint.markCancelled(
    cancelledCheckpoint,
    'layout',
    Object.assign(new Error('cancelled by user'), { code: 'USER_CANCELLED', cancelled: true }),
  );
  assert.strictEqual(cancelledCheckpoint.status, 'partial');
  assert.strictEqual(cancelledCheckpoint.last_error_code, 'USER_CANCELLED');
  assert.deepStrictEqual(cancelledCheckpoint.cancelled_view_keys, ['layout']);
  assert.strictEqual(cancelledCheckpoint.views.master.status, 'succeeded');
  assert.strictEqual(cancelledCheckpoint.views.layout, undefined, '取消不得虚构供应商提交或计费状态');
  await assertSubjectSupplierPreflightAndConcurrency();
  await assertMultiSpacePromptsAndRecovery();
  console.log('New Story Ad multi-space, cast isolation and recovery regression tests passed');
}

main()
  .finally(() => {
    try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (_) {}
  })
  .catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
