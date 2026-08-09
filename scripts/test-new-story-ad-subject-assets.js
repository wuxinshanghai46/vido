const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');
const subjectAssets = require('../src/services/newStoryAd/subjectAssetBundleService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const personIdentity = require('../src/services/newStoryAd/personIdentityContractService');
const personAssetLifecycle = require('../src/services/newStoryAd/personAssetLifecycleService');
const storyService = require('../src/services/newStoryAd/storyAdService');
const sceneBindingService = require('../src/services/newStoryAd/sceneBindingService');
const sceneCheckpointProjection = require('../src/services/newStoryAd/sceneCheckpointProjectionService');
const subjectAssetPersistence = require('../src/routes/newStoryAd/subjectAssetPersistence');

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

assert.strictEqual(
  typeof personAssetLifecycle.latestSubjectCheckpointRow,
  'function',
  '任务公开投影必须提供统一的最新主体检查点选择器，刷新后才能恢复真实运行状态',
);
const projectedSubjectCheckpoint = personAssetLifecycle.latestSubjectCheckpointRow([
  {
    kind: 'subject_asset_checkpoint:task_restore:old',
    updated_at: '2026-07-25T10:00:00.000Z',
    payload: { status: 'complete' },
  },
  {
    kind: 'subject_asset_checkpoint:task_restore:new',
    updated_at: '2026-07-25T10:02:00.000Z',
    payload: { status: 'running' },
  },
  {
    kind: 'scene_asset_checkpoint:task_restore:scene',
    updated_at: '2026-07-25T10:03:00.000Z',
    payload: { status: 'running' },
  },
]);
assert.strictEqual(projectedSubjectCheckpoint.kind, 'subject_asset_checkpoint:task_restore:new');
assert.strictEqual(projectedSubjectCheckpoint.payload.status, 'running');
assert.deepStrictEqual(
  personAssetLifecycle.projectLatestSubjectCheckpoint([{ kind: 'context' }], [
    projectedSubjectCheckpoint,
    { kind: 'subject_asset_checkpoint:older', updated_at: '2026-07-25T09:00:00.000Z', payload: { status: 'complete' } },
  ]).map(row => row.kind),
  ['context', 'subject_asset_checkpoint:task_restore:new'],
  '公开任务投影只应恢复最新一条主体生成检查点',
);

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
      return { image_url: `/sheet/${filename}.png`, provider_used: 'mock-image' };
    },
    async splitReferenceSheet({ filenamePrefix, viewKeys }) {
      return viewKeys.map(key => ({
        key,
        url: `/views/${filenamePrefix}_${key}.png`,
        image_url: `/views/${filenamePrefix}_${key}.png`,
        provider_used: 'mock-image',
      }));
    },
    async splitActorSheet({ filenamePrefix, viewKeys }) {
      return viewKeys.map(key => ({ key, url: `/views/${filenamePrefix}_${key}.png`, provider_used: 'mock-image' }));
    },
    async generateImage({ filename }) {
      return { image_url: `/details/${filename}.png`, provider_used: 'mock-image' };
    },
  };
  const storage = {
    getOutput(taskId, kind) { return outputs.get(`${taskId}:${kind}`) || null; },
    saveOutput(taskId, kind, value) { outputs.set(`${taskId}:${kind}`, JSON.parse(JSON.stringify(value))); },
    listOutputs(taskId) {
      const prefix = `${taskId}:`;
      return Array.from(outputs.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, payload]) => ({
          task_id: taskId,
          kind: key.slice(prefix.length),
          payload,
          updated_at: payload?.updated_at || '',
        }));
    },
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
  assert.strictEqual(batch.submissions(), 19, 'three complete 4-atlas plus 2-native-master people and one pet sheet must submit nineteen calls');
  assert.strictEqual(bundle.cast_assets.length, 3);
  assert(bundle.cast_assets.every(asset => asset.atomic_assets.length === 20));
  assert(bundle.cast_assets.every(asset => asset.category_atlases.length === 4));
  assert(bundle.cast_assets.every(asset => asset.generation_summary.planned_provider_calls === 6));
  assert(bundle.cast_assets.every(asset => asset.quality_status === 'native_masters_ready'));
  assert(bundle.cast_assets.every(asset => asset.native_masters.face.image_url && asset.native_masters.body.image_url));
  assert.strictEqual(bundle.pet_profiles.length, 1);
  assert.strictEqual(new Set(bundle.cast_assets.map(asset => asset.actor_id)).size, 3, 'cast members must have distinct stable IDs');
  const persistedDossier = subjectAssetPersistence.restoreGeneratedDossierFields(
    [{ id: 'library_actor', image_url: '/library/cover.jpg', metadata: {} }],
    [bundle.cast_assets[0]],
  )[0];
  assert.strictEqual(persistedDossier.atomic_assets.length, 20, 'actor-library persistence must not truncate the unified dossier');
  assert.strictEqual(persistedDossier.category_atlases.length, 4);
  assert.ok(persistedDossier.native_masters.face.image_url);
  assert.ok(persistedDossier.cover_image_url);
  assert.strictEqual(bundle.person_contract.status, 'verified');
  assert.strictEqual(bundle.person_contract.cross_view_qa.member_count_pass, true);
  assert.strictEqual(bundle.pet_contract.status, 'verified');
  assert.strictEqual(bundle.pet_profiles[0].reference_images.length, 4);
  assert(batch.prompts[0].includes('妈妈林悦') && !batch.prompts[0].includes('爸爸周屿'), 'each human prompt must contain only the selected member');
  assert(batch.prompts[6].includes('爸爸周屿') && !batch.prompts[6].includes('妈妈林悦'), 'the second human prompt must not contain the first member');
  assert(batch.prompts[18].includes('豆包') && !batch.prompts[18].includes('妈妈林悦'), 'pet prompt must not contain any human member');
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
  const normalizedDossierContext = contextBuilder.buildContext({
    brief: '人物档案持久化测试',
    person_asset: {
      id: 'bundle_dossier_test',
      image_url: bundle.cast_assets[0].image_url,
      cast_assets: [bundle.cast_assets[0]],
    },
  });
  assert.strictEqual(normalizedDossierContext.person_asset.cast_assets[0].atomic_assets.length, 20, 'context normalization must preserve all 20 dossier items');
  assert.strictEqual(normalizedDossierContext.person_asset.cast_assets[0].category_atlases.length, 4, 'context normalization must preserve four category atlases');
  assert.ok(normalizedDossierContext.person_asset.cast_assets[0].cover_image_url, 'context normalization must preserve the dossier cover');
  assert.notStrictEqual(
    subjectAssets.checkpointKind('task', 'brief', {}, { people: 1, pets: 1 }, {
      pet_profiles: [{ appearance: 'white coat' }],
    }),
    subjectAssets.checkpointKind('task', 'brief', {}, { people: 1, pets: 1 }, {
      pet_profiles: [{ appearance: 'black coat' }],
    }),
    'changing a member profile must not reuse an incompatible checkpoint',
  );
  const stableCastProfile = castProfile(1);
  const enrichedCastProfile = {
    ...stableCastProfile,
    appearance: {
      ageRange: 'match_brief',
      userPrompt: stableCastProfile.appearanceText,
    },
    wardrobe: {
      userPrompt: stableCastProfile.wardrobeText,
    },
    view_images: [
      { key: 'front', url: '/generated/front.jpg' },
      { key: 'side', url: '/generated/side.jpg' },
    ],
    atomic_assets: [{ kind: 'body', key: 'front', url: '/generated/front.jpg' }],
    category_atlases: [{ kind: 'body', image_url: '/generated/body-atlas.jpg' }],
    person_contract: { status: 'verified', person_revision: 1 },
    actor_asset_id: 'generated_actor_asset',
  };
  const stableCheckpointKind = subjectAssets.checkpointKind(
    'task_stable_fingerprint',
    'brief',
    { castMode: 'single', expectedPeople: 1 },
    { mode: 'single', people: 1, pets: 0 },
    { cast_profiles: [stableCastProfile] },
  );
  assert.strictEqual(
    subjectAssets.checkpointKind(
      'task_stable_fingerprint',
      'brief',
      { castMode: 'single', expectedPeople: 1 },
      { mode: 'single', people: 1, pets: 0 },
      { cast_profiles: [enrichedCastProfile] },
    ),
    stableCheckpointKind,
    'generated view, contract and persistence metadata must not change the paid-generation checkpoint',
  );
  assert.notStrictEqual(
    subjectAssets.checkpointKind(
      'task_stable_fingerprint',
      'brief',
      { castMode: 'single', expectedPeople: 1 },
      { mode: 'single', people: 1, pets: 0 },
      { cast_profiles: [{ ...stableCastProfile, wardrobeText: 'materially different wardrobe' }] },
    ),
    stableCheckpointKind,
    'a generation-relevant wardrobe change must create a new checkpoint',
  );

  const legacyCompatibility = harness();
  const legacyCompatibilityRequest = {
    taskId: 'task_legacy_checkpoint_compatibility',
    body: {
      brief: 'One spokesperson presents the product',
      cast_mode: 'single',
      expected_people: 1,
      person_spec: { castMode: 'single', expectedPeople: 1 },
      cast_profiles: [stableCastProfile],
    },
  };
  const legacyInitial = await subjectAssets.generateSubjectBundle(legacyCompatibilityRequest, legacyCompatibility.deps);
  assert.strictEqual(legacyCompatibility.submissions(), 6);
  const storedCheckpoint = legacyCompatibility.outputs.get(
    `${legacyCompatibilityRequest.taskId}:${legacyInitial.checkpoint_kind}`,
  );
  legacyCompatibility.outputs.delete(`${legacyCompatibilityRequest.taskId}:${legacyInitial.checkpoint_kind}`);
  legacyCompatibility.outputs.set(
    `${legacyCompatibilityRequest.taskId}:subject_asset_checkpoint:${legacyCompatibilityRequest.taskId}:legacy-fingerprint`,
    storedCheckpoint,
  );
  const legacyReused = await subjectAssets.generateSubjectBundle({
    ...legacyCompatibilityRequest,
    body: {
      ...legacyCompatibilityRequest.body,
      cast_profiles: [enrichedCastProfile],
    },
  }, legacyCompatibility.deps);
  assert.strictEqual(
    legacyCompatibility.submissions(),
    6,
    'a complete semantically compatible legacy checkpoint must migrate without another paid image submission',
  );
  assert.strictEqual(legacyReused.cast_assets[0].atomic_assets.length, 20);

  const multiLookBatch = harness();
  const multiLookProfile = castProfile(1, {
    displayName: 'Lin Jing',
    roleName: 'time traveler',
    wardrobeText: 'pale cyan Song-style robe, white cloth shoes and a wooden hairpin',
    hairMakeupText: 'black hair pinned with a wooden hairpin',
    look_profiles: [
      {
        id: 'lin_jing_ancient', name: 'Ancient look', story_state: 'ancient era',
        scene_ids: ['ancient_garden'],
        wardrobeText: 'pale cyan Song-style robe, white cloth shoes and a wooden hairpin',
        hairMakeupText: 'black hair pinned with a wooden hairpin',
      },
      {
        id: 'lin_jing_modern', name: 'Modern look', story_state: 'modern era',
        scene_ids: ['modern_hall'],
        wardrobeText: 'off-white linen shirt, straight trousers, leather mules and a silver bracelet',
        hairMakeupText: 'natural shoulder-length black hair and light makeup',
      },
    ],
  });
  const multiLookBundle = await subjectAssets.generateSubjectBundle({
    taskId: 'task_multi_look_assets',
    body: {
      brief: 'The same woman crosses from an ancient garden into a modern exhibition hall.',
      cast_mode: 'single', expected_people: 1,
      person_spec: { castMode: 'single', expectedPeople: 1 },
      cast_profiles: [multiLookProfile],
    },
  }, multiLookBatch.deps);
  assert.strictEqual(multiLookBatch.submissions(), 12, 'two looks for one identity must create two isolated six-call dossiers');
  assert.strictEqual(multiLookBundle.cast_assets.length, 1, 'multiple looks must not increase the character count');
  assert.strictEqual(multiLookBundle.cast_assets[0].look_assets.length, 2, 'both declared looks must be persisted as independent assets');
  assert.deepStrictEqual(
    multiLookBundle.cast_assets[0].look_assets.map(look => look.id),
    ['lin_jing_ancient', 'lin_jing_modern'],
  );
  assert(multiLookBatch.prompts.slice(0, 6).every(prompt => prompt.includes('Song-style robe') && !prompt.includes('linen shirt')),
    'the ancient dossier must never receive modern wardrobe text');
  assert(multiLookBatch.prompts.slice(6, 12).every(prompt => prompt.includes('linen shirt') && !prompt.includes('Song-style robe')),
    'the modern dossier must never receive ancient wardrobe text');
  assert.notStrictEqual(
    subjectAssets.checkpointKind(
      'task_multi_look_fingerprint', 'brief', { castMode: 'single', expectedPeople: 1 },
      { mode: 'single', people: 1, pets: 0 }, { cast_profiles: [multiLookProfile] },
    ),
    subjectAssets.checkpointKind(
      'task_multi_look_fingerprint', 'brief', { castMode: 'single', expectedPeople: 1 },
      { mode: 'single', people: 1, pets: 0 }, {
        cast_profiles: [{
          ...multiLookProfile,
          look_profiles: multiLookProfile.look_profiles.map(look => (
            look.id === 'lin_jing_modern' ? { ...look, wardrobeText: 'black modern suit' } : look
          )),
        }],
      },
    ),
    'editing any look must invalidate the paid-generation checkpoint fingerprint',
  );
  assert.doesNotThrow(() => personIdentity.assertVerifiedPerson({
    cast_mode: 'human_pet',
    expected_people: 3,
    person_asset: { cast_assets: bundle.cast_assets, person_contract: bundle.person_contract },
    person_contract: bundle.person_contract,
  }), 'aggregate cast contract must satisfy the downstream verified-person gate');

  const scoped = harness();
  const reusablePetsWithReferenceImagesOnly = bundle.pet_profiles.map((profile) => {
    const { view_images, ...rest } = profile;
    return rest;
  });
  const scopedContext = {
    person_asset: { cast_assets: bundle.cast_assets },
    pet_profiles: reusablePetsWithReferenceImagesOnly,
  };
  scoped.deps.storage.getOutput = (taskId, kind) => kind === 'context'
    ? scopedContext
    : scoped.outputs.get(`${taskId}:${kind}`) || null;
  const scopedBundle = await subjectAssets.generateSubjectBundle({
    taskId: 'task_subject_scope',
    generationId: 'generation_subject_scope',
    body: {
      brief: '一家三口与一只金毛在客厅互动，展示宠物食品。',
      cast_mode: 'human_pet',
      expected_people: 3,
      expected_animals: 1,
      person_spec: { castMode: 'human_pet', expectedPeople: 3, expectedAnimals: 1 },
      cast_profiles: [
        castProfile(1, { displayName: '妈妈林悦', roleName: '母亲', wardrobeText: '浅杏色上衣搭配白色亚麻长裙和白色帆布鞋' }),
        castProfile(2, { displayName: '爸爸周屿', roleName: '父亲' }),
        castProfile(3, { displayName: '孩子小满', roleName: '8岁女儿' }),
      ],
      pet_profiles: [petProfile(1, { name: '豆包', type: '金毛犬' })],
      subject_targets: [{ kind: 'human', index: 0, id: 'cast_1' }],
    },
  }, scoped.deps);
  assert.strictEqual(scoped.submissions(), 6, 'scoped subject regeneration must submit only the selected complete person dossier');
  assert.strictEqual(scopedBundle.generated_counts.people, 1);
  assert.strictEqual(scopedBundle.generated_counts.pets, 0);
  assert.notStrictEqual(scopedBundle.cast_assets[0].actor_id, bundle.cast_assets[0].actor_id, 'selected person must receive a new asset');
  assert.strictEqual(scopedBundle.cast_assets[1].actor_id, bundle.cast_assets[1].actor_id, 'unselected person must preserve the previous asset');
  assert.strictEqual(scopedBundle.cast_assets[2].actor_id, bundle.cast_assets[2].actor_id, 'every other unselected person must be preserved');
  assert.strictEqual(scopedBundle.pet_profiles[0].pet_id, bundle.pet_profiles[0].pet_id, 'unselected pet must preserve the previous asset');
  assert(scoped.prompts[0].includes('白色亚麻长裙'), 'the selected person prompt must contain the exact edited wardrobe');
  assert(scoped.prompts[0].includes('Four-view continuity is a hard identity contract'), 'the paid image prompt must enforce one invariant visible state across all four views');
  assert(scoped.prompts[0].includes('Never add, remove, swap, recolor, resize or reposition'), 'the paid image prompt must forbid accessory and wardrobe drift between cells');
  assert(scoped.prompts[0].includes('Negative continuity rules:'), 'the paid image prompt must include the selected person-specific negative rules');
  assert(!scoped.prompts[0].includes('爸爸周屿'), 'the selected person prompt must remain isolated from unselected cast members');

  const invalidScope = harness();
  await assert.rejects(() => subjectAssets.generateSubjectBundle({
    taskId: 'task_invalid_subject_scope',
    body: {
      brief: '两位人物共同出镜',
      cast_mode: 'dual',
      expected_people: 2,
      person_spec: { castMode: 'dual', expectedPeople: 2 },
      cast_profiles: [castProfile(1), castProfile(2)],
      subject_targets: [{ kind: 'human', index: 0, id: 'not-current' }],
    },
  }, invalidScope.deps), error => error.code === 'SUBJECT_TARGET_INVALID');
  assert.strictEqual(invalidScope.submissions(), 0, 'invalid subject scope must fail before any supplier submission');

  const projectedPartialScenes = sceneCheckpointProjection.projectSceneAssets([
    {
      kind: 'scene_config',
      payload: { spaces: [{ id: 'park', name: '城市公园草坪' }] },
    },
    {
      kind: 'scene_assets',
      payload: [
        { id: 'legacy-space', space_id: 'legacy-space', image_url: '/scene/legacy.png' },
      ],
    },
    {
      kind: 'scene_asset_checkpoint:park',
      payload: {
        status: 'partial',
        scene_id: 'park',
        metadata: { space_id: 'park', generation_contract_version: 6 },
        views: {
          master: { status: 'succeeded', url: '/scene/park-master.png' },
          layout: { status: 'succeeded', image_url: '/scene/park-layout.png' },
          reverse: { status: 'succeeded', url: '/scene/park-reverse.png' },
          detail: { status: 'succeeded', url: '/scene/park-detail.png' },
          interaction: {
            status: 'failed',
            error_code: 'PROVIDER_5XX_AMBIGUOUS',
            billing_state: 'unknown',
          },
        },
      },
    },
    {
      kind: 'scene_asset_checkpoint:space_1',
      payload: {
        status: 'partial',
        scene_id: 'space_1',
        metadata: { space_id: 'space_1', generation_contract_version: 6 },
        views: {
          master: { status: 'succeeded', url: '/scene/incorrect-planless-master.png' },
        },
      },
    },
  ]);
  assert.strictEqual(projectedPartialScenes.length, 1, 'only assets and checkpoints owned by the authoritative scene plan may be publicly projected');
  assert.strictEqual(projectedPartialScenes[0].name, '城市公园草坪');
  assert.strictEqual(projectedPartialScenes[0].view_images.length, 4, 'every successful partial scene view must remain visible');
  assert.strictEqual(projectedPartialScenes[0].billing_review_required, true, 'ambiguous provider billing must remain explicit and must not auto-retry');

  const multiSceneCheckpointProjection = sceneCheckpointProjection.projectSceneAssets([
    {
      kind: 'scene_config',
      payload: { spaces: [{ id: 'park', name: '城市公园草坪' }, { id: 'home', name: '现代家庭空间' }] },
    },
    {
      kind: 'context',
      payload: {
        scene_assets: [
          { id: 'park', space_id: 'park', image_url: '/scene/park-published.png', view_images: [{ key: 'master', url: '/scene/park-published.png' }] },
          { id: 'home', space_id: 'home', image_url: '/scene/home-previous.png', view_images: [{ key: 'master', url: '/scene/home-previous.png' }] },
        ],
      },
    },
    {
      kind: 'scene_asset_checkpoint:home',
      payload: {
        status: 'partial',
        scene_id: 'home',
        metadata: { space_id: 'home', generation_contract_version: 7 },
        views: {
          master: { status: 'succeeded', url: '/scene/home-current.png' },
          layout: { status: 'failed', error_code: 'PROVIDER_5XX_AMBIGUOUS', billing_state: 'unknown' },
        },
      },
    },
  ]);
  assert.strictEqual(multiSceneCheckpointProjection.length, 2, 'context-only scene assets must survive when a partial checkpoint exists for one sibling scene');
  assert.strictEqual(multiSceneCheckpointProjection.find(asset => asset.space_id === 'park').image_url, '/scene/park-published.png');
  assert.strictEqual(multiSceneCheckpointProjection.find(asset => asset.space_id === 'home').image_url, '/scene/home-current.png');
  assert.strictEqual(multiSceneCheckpointProjection.find(asset => asset.space_id === 'home').partial_checkpoint, true);

  const legacyPlanlessProjection = sceneCheckpointProjection.projectSceneAssets([
    {
      kind: 'scene_asset_checkpoint:legacy-space',
      payload: {
        status: 'partial',
        scene_id: 'legacy-space',
        metadata: { space_id: 'legacy-space', generation_contract_version: 6 },
        views: {
          master: { status: 'succeeded', url: '/scene/legacy-master.png' },
        },
      },
    },
  ]);
  assert.strictEqual(legacyPlanlessProjection.length, 1, 'legacy planless checkpoints remain available when no authoritative plan exists');

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
      schema_version: 6,
      status: 'verified',
      requirement_qa: { pass: true },
      photographic_realism_qa: { pass: true },
      camera_design_qa: { pass: true },
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
  assert.strictEqual(first.submissions(), 6, 'cancellation must stop before the second person dossier starts');
  const cancelledCheckpoint = Array.from(resumeStore.entries())
    .find(([key]) => key.includes(':subject_asset_checkpoint:'))?.[1];
  assert.strictEqual(cancelledCheckpoint.status, 'partial', 'a cancelled batch with completed assets must not remain stuck in running state');
  assert.strictEqual(cancelledCheckpoint.error_code, 'USER_CANCELLED');
  const second = harness();
  second.deps.storage.getOutput = (taskId, kind) => resumeStore.get(`${taskId}:${kind}`) || null;
  second.deps.storage.saveOutput = (taskId, kind, value) => resumeStore.set(`${taskId}:${kind}`, JSON.parse(JSON.stringify(value)));
  const resumed = await subjectAssets.generateSubjectBundle(request, second.deps);
  assert.strictEqual(second.submissions(), 6, 'resume must reuse the completed first dossier and generate only the missing person');
  assert.strictEqual(resumed.cast_assets.length, 2);

  const failureStore = new Map();
  const failedBatch = harness();
  failedBatch.deps.storage.getOutput = (taskId, kind) => failureStore.get(`${taskId}:${kind}`) || null;
  failedBatch.deps.storage.saveOutput = (taskId, kind, value) => failureStore.set(`${taskId}:${kind}`, JSON.parse(JSON.stringify(value)));
  let verificationCalls = 0;
  failedBatch.deps.personIdentity.verifyPersonAsset = async ({ asset }) => {
    verificationCalls += 1;
    if (verificationCalls === 2) {
      const error = new Error('verification infrastructure unavailable');
      error.code = 'VISION_QA_UNAVAILABLE';
      error.status = 503;
      throw error;
    }
    return verifiedPerson(asset);
  };
  const failureRequest = {
    taskId: 'task_partial_failure_bundle',
    body: {
      brief: 'Two distinct coworkers present the product',
      cast_mode: 'dual',
      expected_people: 2,
      person_spec: { castMode: 'dual', expectedPeople: 2 },
      cast_profiles: [castProfile(1), castProfile(2)],
    },
  };
  await assert.rejects(
    () => subjectAssets.generateSubjectBundle(failureRequest, failedBatch.deps),
    error => error.code === 'VISION_QA_UNAVAILABLE'
      && error.details?.subject_checkpoint?.status === 'partial'
      && error.details?.subject_checkpoint?.completed_people === 1,
    'a failure after one verified member must expose a resumable partial checkpoint',
  );
  const failedCheckpoint = Array.from(failureStore.entries())
    .find(([key]) => key.includes(':subject_asset_checkpoint:'))?.[1];
  assert.strictEqual(failedCheckpoint.status, 'partial');
  assert.strictEqual(failedCheckpoint.humans.filter(Boolean).length, 1);
  const failureResume = harness();
  failureResume.deps.storage.getOutput = (taskId, kind) => failureStore.get(`${taskId}:${kind}`) || null;
  failureResume.deps.storage.saveOutput = (taskId, kind, value) => failureStore.set(`${taskId}:${kind}`, JSON.parse(JSON.stringify(value)));
  const recoveredFailure = await subjectAssets.generateSubjectBundle(failureRequest, failureResume.deps);
  assert.strictEqual(failureResume.submissions(), 0, 'retry after QA failure must reuse all completed category atlases for both people');
  assert.strictEqual(recoveredFailure.cast_assets.length, 2);

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
  const differentConcurrentRequest = {
    ...concurrentRequest,
    body: {
      ...concurrentRequest.body,
      cast_profiles: [
        { ...castProfile(1), wardrobe: 'different wardrobe to force a different checkpoint kind' },
        castProfile(2),
      ],
    },
  };
  await assert.rejects(
    () => subjectAssets.generateSubjectBundle(differentConcurrentRequest, concurrent.deps),
    error => error.code === 'SUBJECT_ASSET_GENERATION_IN_PROGRESS',
    'concurrent requests for the same task must be rejected even when their checkpoint kinds differ',
  );
  await firstConcurrent;
  assert.strictEqual(concurrent.submissions(), 12, 'only one concurrent batch may submit two complete dossiers');

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
  assert.strictEqual(single.submissions(), 6, 'single person must use one independent profile, four category atlases and two native masters');

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
  const subjectAssistUi = fs.readFileSync(path.join(root, 'public/js/new-story-ad/subject-profile-assist.js'), 'utf8');
  const sceneBinding = fs.readFileSync(path.join(root, 'src/services/newStoryAd/sceneBindingService.js'), 'utf8');
  const adapter = fs.readFileSync(path.join(root, 'src/services/newStoryAd/videoAdapter.js'), 'utf8');
  const providerAssets = fs.readFileSync(path.join(root, 'src/services/newStoryAd/deyunaiPersonAssetService.js'), 'utf8');
  const storySource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyAdService.js'), 'utf8');
  const referencePackSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/shotReferencePackService.js'), 'utf8');
  const taskViewSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/taskViewService.js'), 'utf8');
  const stateSyncSource = fs.readFileSync(path.join(root, 'public/js/new-story-ad/state-sync.js'), 'utf8');
  const checkpointPollingSource = fs.readFileSync(path.join(root, 'public/js/new-story-ad/subject-checkpoint-polling.js'), 'utf8');
  const bootstrapSource = fs.readFileSync(path.join(root, 'public/js/new-story-ad/bootstrap.js'), 'utf8');
  const assetLoaderSource = fs.readFileSync(path.join(root, 'public/js/new-story-ad/bootstrap-asset-loader.js'), 'utf8');
  assert(ui.includes("'/api/new-story-ad/subject-assets'"), 'multi-person/pet UI must use the subject bundle endpoint');
  assert(
    ui.includes('timeoutMs: 45 * 60 * 1000'),
    'long-running multi-atlas subject generation must not fall back to the generic 45-second POST timeout',
  );
  assert(subjectUi.includes('state.petProfiles') && ui.includes('NewStoryAdSubjectAssetsUI.petProfiles'), 'generated pet references must be preserved in request payloads');
  assert(ui.includes('cast_profiles: state.castProfiles') && ui.includes('expected_animals: petCount'), 'subject generation payload must submit exact counts and independent profiles');
  assert(sceneBinding.includes('MULTI_SCENE_ASSETS_REQUIRED'), 'multi-scene storyboard must be blocked until independent scene assets exist');
  assert(sceneBinding.includes('assertVerifiedSceneAssets(assets)'), 'storyboard must reject unverified scene assets');
  assert(providerAssets.includes('for (let index = 0; index < cast.length; index += 1)'), 'multi-person video must upload every cast member to the managed person library');
  assert(providerAssets.includes('asset_ids: assets.map'), 'multi-person provider asset ids must be persisted as a complete list');
  assert(storySource.includes('shotReferencePacks.referenceUrls') && referencePackSource.includes('references.keyframeReferenceUrls'), 'keyframes must use the single reference-pack capacity orchestrator');
  assert(
    taskViewSource.includes('personAssetLifecycle.projectLatestSubjectCheckpoint(visibleOutputs, rawBundle.outputs)'),
    'the task API must expose exactly the latest subject checkpoint so refresh recovery receives the running batch',
  );
  assert(bootstrapSource.includes('/js/new-story-ad/subject-checkpoint-polling.js'), 'checkpoint polling must load before the legacy UI');

  const subjectUiSandbox = { window: {} };
  vm.createContext(subjectUiSandbox);
  vm.runInContext(subjectUi, subjectUiSandbox, { filename: 'subject-assets-ui.js' });
  vm.runInContext(subjectAssistUi, subjectUiSandbox, { filename: 'subject-profile-assist.js' });
  const assetCastMode = subjectUiSandbox.window.NewStoryAdSubjectAssetsUI.assetCastMode;
  assert.strictEqual(assetCastMode('dual', 2, 'human_pet'), 'human_pet', 'a two-person asset must not remove the task pet mode');
  assert.strictEqual(assetCastMode('human_pet', 2, 'dual'), 'human_pet', 'a persisted mixed-subject asset must restore the mixed mode');
  assert.strictEqual(assetCastMode('dual', 2, 'dual'), 'dual', 'human-only dual mode must remain backward compatible');
  const selectionItems = subjectUiSandbox.window.NewStoryAdSubjectAssetsUI.selectionItems;
  const reusableViews = ['front', 'side', 'back', 'action'].map(key => ({ key, url: `/views/${key}.jpg` }));
  const referenceOnlyPetItems = selectionItems({
    castProfiles: [],
    actorAsset: { cast_assets: [] },
    petProfiles: [{ ...petProfile(1), reference_images: reusableViews.map(view => view.url) }],
  });
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(referenceOnlyPetItems.map(item => ({
      selected: item.selected,
      reusable: item.reusable,
      required: item.required,
      disabled: item.disabled,
    })))),
    [{ selected: false, reusable: true, required: false, disabled: false }],
    'a verified pet with four reference_images must remain reusable after refresh and must not be force-selected',
  );
  const scopedUiItems = selectionItems({
    castProfiles: [
      { ...castProfile(1), image_url: '/people/one.jpg', _generationDirty: true },
      { ...castProfile(2), image_url: '/people/two.jpg' },
    ],
    actorAsset: { cast_assets: [
      { actor_id: 'cast_1', view_images: reusableViews },
      { actor_id: 'cast_2', view_images: reusableViews },
    ] },
    petProfiles: [{ ...petProfile(1), image_url: '/pets/one.jpg', view_images: reusableViews }],
  });
  assert.strictEqual(
    JSON.stringify(scopedUiItems.filter(item => item.selected).map(item => item.title)),
    JSON.stringify(['人物1']),
    'the confirmation dialog must preselect only the edited subject when existing assets are present',
  );
  const mergeAssistedHumanProfile = subjectUiSandbox.window.NewStoryAdSubjectProfileAssist.mergeHumanProfile;
  const preservedPerson = { ...castProfile(1), actor_asset_id: 'asset_person_1', image_url: '/people/one.jpg', person_contract: { status: 'verified' } };
  const isolatedAssistState = {
    castProfiles: [preservedPerson, { id: 'cast_2', displayName: '', roleName: '' }],
    petProfiles: [{ ...petProfile(1), image_url: '/pets/one.jpg' }],
  };
  const preservedSnapshot = JSON.stringify(isolatedAssistState.castProfiles[0]);
  const petSnapshot = JSON.stringify(isolatedAssistState.petProfiles);
  assert.strictEqual(mergeAssistedHumanProfile(isolatedAssistState, 1, {
    assist_subject_target: { kind: 'human', index: 1, id: 'cast_2' },
    cast_profiles: [castProfile(2, { displayName: '小杰', roleName: '儿子' })],
  }), false, 'an assist response without an explicit replaceable-field contract must not overwrite the profile');
  assert.strictEqual(mergeAssistedHumanProfile(isolatedAssistState, 1, {
    assist_subject_target: { kind: 'human', index: 1, id: 'cast_2' },
    assist_replaceable_fields: ['displayName', 'roleName', 'appearanceText', 'wardrobeText', 'hairMakeupText', 'negativeText'],
    cast_profiles: [castProfile(2, { displayName: '小杰', roleName: '儿子' })],
  }), true);
  assert.strictEqual(JSON.stringify(isolatedAssistState.castProfiles[0]), preservedSnapshot, 'single-person assist must preserve another generated person byte-for-byte');
  assert.strictEqual(JSON.stringify(isolatedAssistState.petProfiles), petSnapshot, 'single-person assist must preserve pets byte-for-byte');
  assert.strictEqual(isolatedAssistState.castProfiles[1].displayName, '小杰');
  assert.strictEqual(isolatedAssistState.castProfiles[1]._generationDirty, true);
  assert.strictEqual(isolatedAssistState.castProfiles[0]._generationDirty, undefined);
  assert(subjectUi.includes('data-nsa-subject-assist-index'), 'each human profile must render its own assist action');
  assert(/scheduleAutoSave\('single_person_assist',\s*\{\s*immediate:\s*true\s*\}\)/.test(ui)
    && /await waitForAutoSave\(version\)/.test(ui),
  'single-person assist must autosave after the scoped merge and wait for server confirmation');
  assert(!bootstrapSource.includes('/js/new-story-ad/subject-profile-assist.js')
    && bootstrapSource.includes('/js/new-story-ad/bootstrap-asset-loader.js')
    && assetLoaderSource.includes('/js/new-story-ad/subject-profile-assist.js'),
  'the scoped assist module must stay behind the step-2 lazy loader');

  const documentMock = { querySelector: () => null };
  const stateSyncSandbox = {
    window: {},
    document: documentMock,
    URL,
    URLSearchParams,
    console,
  };
  vm.createContext(stateSyncSandbox);
  vm.runInContext(stateSyncSource, stateSyncSandbox, { filename: 'state-sync.js' });
  const sync = stateSyncSandbox.window.NewStoryAdStateSync;
  const restoredState = {
    taskId: '',
    castProfiles: [],
    petProfiles: [],
    personGenerationProgress: null,
    sceneAssets: [],
    referenceAssets: [],
    videoClips: [],
    videoShotStatuses: [],
  };
  sync.hydrateTaskBundle({
    task: { id: 'task_mixed_restore', request: {} },
    outputs: {
      context: {
        cast_mode: 'human_pet',
        expected_people: 2,
        expected_animals: 1,
        cast_profiles: [castProfile(1), castProfile(2)],
        pet_profiles: [{ ...petProfile(1, { name: '雪球' }), image_url: '/pets/snowball.jpg' }],
        person_asset: {
          id: 'cast_bundle_restore',
          image_url: '/people/person-1.jpg',
          cast_assets: [
            { ...castProfile(1), image_url: '/people/person-1.jpg' },
            { ...castProfile(2), image_url: '/people/person-2.jpg' },
          ],
        },
      },
    },
  }, {
    state: restoredState,
    within: () => null,
    root: () => documentMock,
    rememberTaskId: () => {},
  });
  assert.strictEqual(restoredState.castProfiles.length, 2, 'mixed-subject restore must retain all independent human profiles');
  assert.strictEqual(restoredState.petProfiles.length, 1, 'a committed person asset must not suppress pet profile hydration');
  assert.strictEqual(restoredState.petProfiles[0].name, '雪球');
  assert.strictEqual(restoredState.petProfiles[0].image_url, '/pets/snowball.jpg');

  const duplicatedCastModeFields = [{ value: 'dual' }, { value: 'dual' }];
  const duplicatedAnimalFields = [{ value: '0' }, { value: '0' }];
  const duplicatedFormRoot = {
    querySelectorAll(selector) {
      if (selector === '[data-nsa-person-spec="castMode"]') return duplicatedCastModeFields;
      if (selector === '[data-nsa-person-spec="expectedAnimals"]') return duplicatedAnimalFields;
      return [];
    },
  };
  sync.hydratePersonSpec({
    person_spec: { castMode: 'human_pet', expectedAnimals: '1' },
    cast_profiles: [castProfile(1), castProfile(2)],
    pet_profiles: [{ ...petProfile(1, { name: '雪球' }), image_url: '/pets/snowball.jpg' }],
  }, {
    state: { castProfiles: [], petProfiles: [] },
    root: () => duplicatedFormRoot,
  });
  assert.deepStrictEqual(
    duplicatedCastModeFields.map(field => field.value),
    ['human_pet', 'human_pet'],
    'every responsive copy of the cast-mode control must restore the persisted mixed-subject mode',
  );
  assert.deepStrictEqual(
    duplicatedAnimalFields.map(field => field.value),
    ['1', '1'],
    'every responsive copy of the pet count must restore the persisted value before profile reconciliation',
  );

  const checkpointState = {
    taskId: '',
    castProfiles: [],
    petProfiles: [],
    personGenerationProgress: null,
    sceneAssets: [],
    referenceAssets: [],
    videoClips: [],
    videoShotStatuses: [],
  };
  sync.hydrateTaskBundle({
    task: { id: 'task_running_restore', request: {} },
    outputs: {
      context: {
        cast_mode: 'human_pet',
        cast_profiles: [castProfile(1), castProfile(2)],
        pet_profiles: [petProfile(1)],
        person_asset: {
          id: 'stale_previous_cast',
          image_url: '/people/stale-person.jpg',
          cast_assets: [{ name: 'stale', image_url: '/people/stale-person.jpg' }],
        },
      },
      'subject_asset_checkpoint:task_running_restore:contract': {
        status: 'running',
        counts: { mode: 'human_pet', people: 2, pets: 1 },
        humans: [{
          name: '人物1',
          image_url: '/people/person-1.jpg',
          subject_profile: castProfile(1),
        }, null],
        pets: [null],
        updated_at: new Date().toISOString(),
      },
    },
  }, {
    state: checkpointState,
    within: () => null,
    root: () => documentMock,
    rememberTaskId: () => {},
  });
  assert.strictEqual(checkpointState.personGenerationProgress.active, true, 'refresh during generation must restore visible background progress');
  assert.strictEqual(checkpointState.personGenerationProgress.restoredFromCheckpoint, true);
  assert.strictEqual(checkpointState.actorAsset.cast_assets.length, 1, 'completed members must remain recoverable while the batch continues');
  assert.strictEqual(checkpointState.actorAsset.cast_assets[0].image_url, '/people/person-1.jpg', 'the current running checkpoint must replace a stale cast from an older generation');
  assert(checkpointState.personGenerationProgress.message.includes('1/3'));

  const partialState = {
    taskId: '',
    castProfiles: [],
    petProfiles: [],
    personGenerationProgress: null,
    sceneAssets: [],
    referenceAssets: [],
    videoClips: [],
    videoShotStatuses: [],
  };
  sync.hydrateTaskBundle({
    task: { id: 'task_partial_restore', request: {} },
    outputs: {
      context: { cast_profiles: [castProfile(1), castProfile(2)] },
      'subject_asset_checkpoint:task_partial_restore:contract': {
        status: 'partial',
        error_code: 'VISION_QA_UNAVAILABLE',
        counts: { mode: 'dual', people: 2, pets: 0 },
        humans: [{ name: '人物1', image_url: '/people/person-1.jpg', subject_profile: castProfile(1) }],
        pets: [],
        updated_at: new Date().toISOString(),
      },
    },
  }, {
    state: partialState,
    within: () => null,
    root: () => documentMock,
    rememberTaskId: () => {},
  });
  assert.strictEqual(partialState.personGenerationProgress, null, 'a failed batch must not remain visually stuck as actively generating');
  assert.strictEqual(partialState.actorAsset.cast_assets.length, 1, 'partial assets must remain visible and resumable after refresh');

  let pollingCallback = null;
  let clearedTimer = null;
  const pollingSandbox = {
    window: {},
    encodeURIComponent,
    setInterval(callback) {
      pollingCallback = callback;
      return 42;
    },
    clearInterval(timer) {
      clearedTimer = timer;
    },
  };
  vm.createContext(pollingSandbox);
  vm.runInContext(checkpointPollingSource, pollingSandbox, { filename: 'subject-checkpoint-polling.js' });
  const pollingState = {
    taskId: 'task_polling_restore',
    personGenerationProgress: { active: true, restoredFromCheckpoint: true },
    subjectCheckpointTimer: null,
  };
  let polledPath = '';
  let rendered = 0;
  assert.strictEqual(pollingSandbox.window.NewStoryAdSubjectCheckpointPolling.resume({
    state: pollingState,
    api: async pathValue => {
      polledPath = pathValue;
      return { task: { id: pollingState.taskId }, outputs: {} };
    },
    hydrateTaskBundle: () => {
      pollingState.personGenerationProgress = null;
    },
    renderAll: () => {
      rendered += 1;
    },
    intervalMs: 1,
  }), true);
  await pollingCallback();
  assert.strictEqual(polledPath, '/api/new-story-ad/tasks/task_polling_restore?compact=1');
  assert.strictEqual(rendered, 1, 'checkpoint polling must re-render after the server bundle changes');
  assert.strictEqual(clearedTimer, 42, 'checkpoint polling must stop after the task is committed');

  console.log('New story ad subject asset bundle regression passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
