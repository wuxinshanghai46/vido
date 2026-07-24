const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const subjectAssets = require('../src/services/newStoryAd/subjectAssetBundleService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const personIdentity = require('../src/services/newStoryAd/personIdentityContractService');
const storyService = require('../src/services/newStoryAd/storyAdService');
const sceneBindingService = require('../src/services/newStoryAd/sceneBindingService');

function castProfile(index, overrides = {}) {
  return {
    id: `cast_${index}`,
    displayName: `人物${index}`,
    roleName: `独立角色${index}`,
    appearanceText: `人物${index}的独立脸型、年龄、体型与气质特征`,
    wardrobeText: `人物${index}专属的上衣、下装、鞋和配饰`,
    hairMakeupText: `人物${index}专属的发型与妆造`,
    negativeText: '不得改变该人物的身份、年龄、服装和发型',
    ...overrides,
  };
}

function petProfile(index, overrides = {}) {
  return {
    id: `pet_${index}`,
    name: `宠物${index}`,
    type: index % 2 ? '金毛犬' : '英短猫',
    breed: index % 2 ? '金毛寻回犬' : '英国短毛猫',
    appearance: `宠物${index}独立的毛色、体型、面部花纹和项圈`,
    ...overrides,
  };
}

function verifiedPerson(asset = {}) {
  return {
    schema_version: 1,
    person_id: asset.actor_id,
    person_revision: 1,
    status: 'verified',
    reference_views: Object.fromEntries((asset.view_images || []).map(view => [view.key, view.url])),
    cross_view_qa: {
      pass: true, identity_score: 0.96, age_score: 0.95, wardrobe_score: 0.96, body_score: 0.94,
      mismatch_reasons: [],
    },
  };
}

function verifiedPet(asset = {}) {
  return {
    schema_version: 1,
    pet_id: asset.pet_id,
    pet_revision: 1,
    status: 'verified',
    reference_views: Object.fromEntries((asset.view_images || []).map(view => [view.key, view.url])),
    cross_view_qa: {
      pass: true, species_score: 0.99, identity_score: 0.96, coat_score: 0.96, body_score: 0.94,
      conflicts: [],
    },
  };
}

function harness({ cancelAt = 0 } = {}) {
  const outputs = new Map();
  let submissions = 0;
  let cancellationChecks = 0;
  const prompts = [];
  const mediaAdapter = {
    async generateActorReference({ filename, prompt }) {
      submissions += 1;
      prompts.push(prompt);
      assert(prompt.includes('2x2 grid'));
      return { image_url: `/sheet/${filename}.png`, provider_used: 'mock-image' };
    },
    async splitActorSheet({ filenamePrefix, viewKeys }) {
      return viewKeys.map(key => ({ key, url: `/views/${filenamePrefix}_${key}.png`, provider_used: 'mock-image' }));
    },
  };
  const storage = {
    getOutput(taskId, kind) { return outputs.get(`${taskId}:${kind}`) || null; },
    saveOutput(taskId, kind, value) { outputs.set(`${taskId}:${kind}`, JSON.parse(JSON.stringify(value))); },
  };
  const cancellation = {
    throwIfCancelled() {
      cancellationChecks += 1;
      if (cancelAt && cancellationChecks === cancelAt) {
        const error = new Error('cancelled');
        error.code = 'USER_CANCELLED';
        throw error;
      }
    },
  };
  return {
    deps: {
      mediaAdapter, storage, cancellation,
      personIdentity: { verifyPersonAsset: async ({ asset }) => verifiedPerson(asset) },
      petIdentity: { verifyPetAsset: async ({ asset }) => verifiedPet(asset) },
    },
    outputs,
    submissions: () => submissions,
    prompts,
  };
}

(async () => {
  const batch = harness();
  const bundle = await subjectAssets.generateSubjectBundle({
    taskId: 'task_subject_bundle',
    generationId: 'generation_subject_bundle',
    body: {
      brief: '一家三口与一只金毛在客厅互动，展示宠物食品。',
      cast_mode: 'human_pet',
      expected_people: 3,
      expected_animals: 1,
      person_spec: {
        castMode: 'human_pet',
        expectedPeople: 3,
        expectedAnimals: 1,
        petType: '金毛犬',
        petDescription: '浅金色毛发，红色项圈，左耳尖有一小撮深色毛',
      },
      cast_profiles: [
        castProfile(1, { displayName: '妈妈林悦', roleName: '母亲' }),
        castProfile(2, { displayName: '爸爸周屿', roleName: '父亲' }),
        castProfile(3, { displayName: '孩子小满', roleName: '8岁女儿' }),
      ],
      pet_profiles: [petProfile(1, { name: '豆包', type: '金毛犬' })],
    },
  }, batch.deps);
  assert.strictEqual(batch.submissions(), 4, 'three people plus one pet must submit four independent identity sheets');
  assert.strictEqual(bundle.cast_assets.length, 3);
  assert.strictEqual(bundle.pet_profiles.length, 1);
  assert.strictEqual(new Set(bundle.cast_assets.map(asset => asset.actor_id)).size, 3, 'cast members must have distinct stable IDs');
  assert.strictEqual(bundle.person_contract.status, 'verified');
  assert.strictEqual(bundle.person_contract.cross_view_qa.member_count_pass, true);
  assert.strictEqual(bundle.pet_contract.status, 'verified');
  assert.strictEqual(bundle.pet_profiles[0].reference_images.length, 4);
  assert(batch.prompts[0].includes('妈妈林悦') && !batch.prompts[0].includes('爸爸周屿'), 'each human prompt must contain only the selected member');
  assert(batch.prompts[1].includes('爸爸周屿') && !batch.prompts[1].includes('妈妈林悦'), 'the second human prompt must not contain the first member');
  assert(batch.prompts[3].includes('豆包') && !batch.prompts[3].includes('妈妈林悦'), 'pet prompt must not contain any human member');
  const normalizedContext = contextBuilder.buildContext({
    brief: '一家三口与一只金毛在客厅互动',
    cast_mode: 'human_pet',
    expected_people: 3,
    expected_animals: 1,
    cast_profiles: [
      castProfile(1, { displayName: '妈妈林悦' }),
      castProfile(2, { displayName: '爸爸周屿' }),
      castProfile(3, { displayName: '孩子小满' }),
    ],
    pet_profiles: [petProfile(1)],
  });
  assert.strictEqual(normalizedContext.cast_profiles[0].appearanceText, castProfile(1).appearanceText, 'context normalization must preserve per-member appearance');
  assert.strictEqual(normalizedContext.cast_profiles[1].wardrobe.userPrompt, castProfile(2).wardrobeText, 'context normalization must preserve per-member wardrobe');
  assert.strictEqual(normalizedContext.cast_profiles[2].hairMakeup.userPrompt, castProfile(3).hairMakeupText, 'context normalization must preserve per-member hair and makeup');
  assert.notStrictEqual(
    subjectAssets.checkpointKind('task', 'brief', {}, { people: 1, pets: 1 }, {
      pet_profiles: [{ appearance: 'white coat' }],
    }),
    subjectAssets.checkpointKind('task', 'brief', {}, { people: 1, pets: 1 }, {
      pet_profiles: [{ appearance: 'black coat' }],
    }),
    'changing a member profile must not reuse an incompatible checkpoint',
  );
  assert.doesNotThrow(() => personIdentity.assertVerifiedPerson({
    cast_mode: 'human_pet',
    expected_people: 3,
    person_asset: { cast_assets: bundle.cast_assets, person_contract: bundle.person_contract },
    person_contract: bundle.person_contract,
  }), 'aggregate cast contract must satisfy the downstream verified-person gate');

  const boardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-subject-board-'));
  for (let index = 1; index <= 4; index += 1) {
    await sharp({
      create: {
        width: 180, height: 240, channels: 3,
        background: { r: 40 * index, g: 30 * index, b: 20 * index },
      },
    }).jpeg().toFile(path.join(boardDir, `subject-${index}.jpg`));
  }
  const boardAdapter = {
    ASSET_DIR: boardDir,
    publicAssetUrl: filename => `/new-story-ad-assets/${filename}`,
  };
  const boardUrl = await subjectAssets.buildSubjectBoard(
    [1, 2, 3].map(index => ({ image_url: `/new-story-ad-assets/subject-${index}.jpg` })),
    [{ image_url: '/new-story-ad-assets/subject-4.jpg' }],
    boardAdapter,
  );
  const boardPath = path.join(boardDir, path.basename(boardUrl));
  assert(boardUrl && fs.existsSync(boardPath), 'three people plus one pet must produce a local all-subject reference board');
  const boardMetadata = await sharp(boardPath).metadata();
  assert.deepStrictEqual([boardMetadata.width, boardMetadata.height], [720, 960], 'all-subject board must contain every subject tile in a balanced grid');
  assert.strictEqual(subjectAssets.hasLocalSubjectBoard(boardUrl, boardAdapter), true, 'completed subject board must be reusable');
  fs.rmSync(boardDir, { recursive: true, force: true });

  const keyframeReferences = storyService.keyframeReferenceImages({
    cast_mode: 'human_pet',
    expected_people: 3,
    expected_animals: 1,
    subject_board_url: '/api/new-story-ad/assets/all-subjects.jpg',
    person_asset: { image_url: '/api/new-story-ad/assets/person-1.jpg' },
    cast_profiles: [1, 2, 3].map(index => ({
      id: `person-${index}`,
      image_url: `/api/new-story-ad/assets/person-${index}.jpg`,
    })),
    pet_profiles: [{ id: 'pet-1', image_url: '/api/new-story-ad/assets/pet-1.jpg' }],
    assets: [{ type: 'product', image_url: '/api/new-story-ad/assets/product.jpg' }],
  }, '/api/new-story-ad/assets/scene.jpg', {
    image_url: '/api/new-story-ad/assets/previous.jpg',
  }, {
    title: 'Actor group product presentation',
    visual: 'Three actors and one pet present the product',
  });
  assert.deepStrictEqual(keyframeReferences.map(value => new URL(value).pathname), [
    '/api/new-story-ad/assets/scene.jpg',
    '/api/new-story-ad/assets/all-subjects.jpg',
    '/api/new-story-ad/assets/product.jpg',
    '/api/new-story-ad/assets/previous.jpg',
  ], 'reference cap must retain scene, every subject through the board, product and continuity');

  const verifiedScene = id => ({
    id,
    scene_id: id,
    scene_revision: 1,
    view_images: ['master', 'reverse', 'interaction', 'detail', 'layout']
      .map(key => ({ key, url: `/api/new-story-ad/assets/${id}-${key}.jpg` })),
    scene_contract: {
      schema_version: 3,
      status: 'verified',
      requirement_qa: { pass: true },
      cross_view_qa: { pass: true },
      spatial_coverage_qa: { pass: true },
      layout_contract: { status: 'available' },
    },
  });
  const multiScenes = [verifiedScene('home'), verifiedScene('office')];
  const detectedPlan = sceneBindingService.normalizeScenePlan({
    spaces: [
      { id: 'home', name: '家庭客厅' },
      { id: 'office', name: '办公室' },
      { id: 'store', name: '门店' },
    ],
  });
  assert.strictEqual(sceneBindingService.resolveSceneMode('auto', detectedPlan), 'multi', 'auto mode must detect a multi-space story plan');
  assert.throws(
    () => sceneBindingService.assertSceneModeAssets('multi', multiScenes, detectedPlan.spaces),
    error => error.code === 'MULTI_SCENE_ASSETS_REQUIRED' && error.required_scene_count === 3,
    'every detected independent space must have its own verified asset',
  );
  assert.throws(
    () => sceneBindingService.assertSceneModeAssets('multi', multiScenes.slice(0, 1)),
    error => error.code === 'MULTI_SCENE_ASSETS_REQUIRED',
    'multi-space tasks must not proceed with only one scene asset',
  );
  assert.doesNotThrow(
    () => sceneBindingService.assertSceneModeAssets('multi', multiScenes),
    'every independent space must have a verified scene asset',
  );
  const boundScenes = sceneBindingService.bindShotsToScenes([
    { scene_id: 'home', title: 'Home opening' },
    { scene_id: 'office', title: 'Office ending', transition_reason: 'The story moves from home to work' },
  ], multiScenes);
  assert.deepStrictEqual(boundScenes.map(shot => shot.scene_id), ['home', 'office'], 'each shot must remain bound to its declared space asset');

  const resumeStore = new Map();
  const first = harness({ cancelAt: 3 });
  first.deps.storage.getOutput = (taskId, kind) => resumeStore.get(`${taskId}:${kind}`) || null;
  first.deps.storage.saveOutput = (taskId, kind, value) => resumeStore.set(`${taskId}:${kind}`, JSON.parse(JSON.stringify(value)));
  const request = {
    taskId: 'task_resume_bundle',
    body: {
      brief: '两位同事在办公室对话。',
      cast_mode: 'dual',
      expected_people: 2,
      person_spec: { castMode: 'dual', expectedPeople: 2 },
      cast_profiles: [castProfile(1), castProfile(2)],
    },
  };
  await assert.rejects(() => subjectAssets.generateSubjectBundle(request, first.deps), error => error.code === 'USER_CANCELLED');
  assert.strictEqual(first.submissions(), 1, 'cancellation must stop before the second paid image submission');
  const second = harness();
  second.deps.storage.getOutput = (taskId, kind) => resumeStore.get(`${taskId}:${kind}`) || null;
  second.deps.storage.saveOutput = (taskId, kind, value) => resumeStore.set(`${taskId}:${kind}`, JSON.parse(JSON.stringify(value)));
  const resumed = await subjectAssets.generateSubjectBundle(request, second.deps);
  assert.strictEqual(second.submissions(), 1, 'resume must reuse the completed first member and generate only the missing member');
  assert.strictEqual(resumed.cast_assets.length, 2);

  const concurrent = harness();
  const concurrentRequest = {
    taskId: 'task_concurrent_bundle',
    body: {
      brief: 'Two people in one scene',
      cast_mode: 'dual',
      expected_people: 2,
      person_spec: { castMode: 'dual', expectedPeople: 2 },
      cast_profiles: [castProfile(1), castProfile(2)],
    },
  };
  const firstConcurrent = subjectAssets.generateSubjectBundle(concurrentRequest, concurrent.deps);
  await assert.rejects(
    () => subjectAssets.generateSubjectBundle(concurrentRequest, concurrent.deps),
    error => error.code === 'SUBJECT_ASSET_GENERATION_IN_PROGRESS',
    'concurrent duplicate requests must be rejected before another paid submission',
  );
  await firstConcurrent;
  assert.strictEqual(concurrent.submissions(), 2, 'only one concurrent batch may submit paid subject generations');

  const missingProfiles = harness();
  await assert.rejects(
    () => subjectAssets.generateSubjectBundle({
      taskId: 'task_missing_profiles',
      body: {
        brief: '两位人物共同出镜',
        cast_mode: 'dual',
        expected_people: 2,
        person_spec: { castMode: 'dual', expectedPeople: 2 },
      },
    }, missingProfiles.deps),
    error => error.code === 'SUBJECT_PROFILES_REQUIRED' && error.actual_count === 0,
    'multi-person requests without member profiles must fail before supplier submission',
  );
  assert.strictEqual(missingProfiles.submissions(), 0, 'profile contract failure must happen before any paid supplier call');

  const single = harness();
  const singleBundle = await subjectAssets.generateSubjectBundle({
    taskId: 'task_single_profile',
    body: {
      brief: '一位品牌顾问独立出镜',
      cast_mode: 'single',
      expected_people: 1,
      expected_animals: 0,
      person_spec: { castMode: 'single', expectedPeople: 1 },
      cast_profiles: [castProfile(1, { displayName: '顾问林晓', roleName: '品牌顾问' })],
      pet_profiles: [],
    },
  }, single.deps);
  assert.strictEqual(singleBundle.cast_assets.length, 1);
  assert.strictEqual(singleBundle.pet_profiles.length, 0);
  assert.strictEqual(single.submissions(), 1, 'single person must use one independent profile and one submission');

  const petOnly = harness();
  const petOnlyBundle = await subjectAssets.generateSubjectBundle({
    taskId: 'task_pet_only_profile',
    body: {
      brief: '两只不同宠物展示宠物食品',
      cast_mode: 'animal',
      expected_people: 0,
      expected_animals: 2,
      person_spec: { castMode: 'animal', expectedPeople: 0, expectedAnimals: 2 },
      cast_profiles: [],
      pet_profiles: [petProfile(1), petProfile(2)],
    },
  }, petOnly.deps);
  assert.strictEqual(petOnlyBundle.cast_assets.length, 0);
  assert.strictEqual(petOnlyBundle.pet_profiles.length, 2);
  assert.strictEqual(petOnly.submissions(), 2, 'pure-pet mode must generate one independent asset per pet');

  const boundaryCounts = subjectAssets.resolveCounts(
    { castMode: 'human_pet', expectedPeople: 99, expectedAnimals: 99 },
    { cast_profiles: Array.from({ length: 12 }, (_, index) => castProfile(index + 1)), pet_profiles: Array.from({ length: 8 }, (_, index) => petProfile(index + 1)) },
  );
  assert.deepStrictEqual(boundaryCounts, { mode: 'human_pet', people: 12, pets: 8 }, 'subject counts must enforce the 12-person and 8-pet upper bounds');

  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'public/js/new-story-ad-legacy-ui.js'), 'utf8');
  const subjectUi = fs.readFileSync(path.join(root, 'public/js/new-story-ad/subject-assets-ui.js'), 'utf8');
  const sceneBinding = fs.readFileSync(path.join(root, 'src/services/newStoryAd/sceneBindingService.js'), 'utf8');
  const adapter = fs.readFileSync(path.join(root, 'src/services/newStoryAd/videoAdapter.js'), 'utf8');
  const storySource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyAdService.js'), 'utf8');
  assert(ui.includes("'/api/new-story-ad/subject-assets'"), 'multi-person/pet UI must use the subject bundle endpoint');
  assert(subjectUi.includes('state.petProfiles') && ui.includes('NewStoryAdSubjectAssetsUI.petProfiles'), 'generated pet references must be preserved in request payloads');
  assert(ui.includes('cast_profiles: state.castProfiles') && ui.includes('expected_animals: petCount'), 'subject generation payload must submit exact counts and independent profiles');
  assert(sceneBinding.includes('MULTI_SCENE_ASSETS_REQUIRED'), 'multi-scene storyboard must be blocked until independent scene assets exist');
  assert(sceneBinding.includes('assertVerifiedSceneAssets(assets)'), 'storyboard must reject unverified scene assets');
  assert(adapter.includes('castCount > 1'), 'multi-person video must not upload only the first actor as the whole cast');
  assert(storySource.includes('subjectReferences.keyframeReferenceUrls'), 'keyframes must use the reference-capacity orchestrator');

  console.log('New story ad subject asset bundle regression passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
