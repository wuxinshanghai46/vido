const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sceneBlocks = require('../src/services/newStoryAd/sceneBlockService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const paidExecutionPolicy = require('../src/services/newStoryAd/paidVideoExecutionPolicyService');
const lineage = require('../src/services/newStoryAd/videoLineageService');
const storage = require('../src/services/newStoryAd/storageService');
const boundaryRepair = require('../src/services/newStoryAd/videoBoundaryRepairService');

async function run() {
  const shots = [
    { id: 'a', title: '进入', scene_id: 'space-alpha', scene_revision: 2, duration: 3, visual: '主体进入当前任务空间', action: '沿入口向内部移动', characters: ['角色一'] },
    { id: 'b', title: '互动', scene_id: 'space-alpha', scene_revision: 2, duration: 4, visual: '主体到达内部区域', action: '与当前任务对象互动', characters: ['角色一', '角色二'], transition_type: 'cut_on_action' },
    { id: 'c', title: '细节', scene_id: 'space-alpha', scene_revision: 2, duration: 3, visual: '摄影机连续靠近细节区域', action: '主体完成当前任务动作', characters: ['角色二'] },
    { id: 'd', title: '时间变化', scene_id: 'space-alpha', scene_revision: 2, duration: 3, visual: '同一空间的后续时间', transition_type: 'fade' },
    { id: 'e', title: '新空间', scene_id: 'space-beta', scene_revision: 1, duration: 3, visual: '进入另一个任务空间' },
  ];
  const sceneLock = id => ({ scene_id: id, scene_revision: id === 'space-alpha' ? 2 : 1, layout_summary: 'current task layout', view_images: [{ key: 'master', url: '/api/new-story-ad/assets/master.png' }] });
  const contracts = shots.map(shot => ({ contract_fingerprint: `contract-${shot.id}`, scene_lock: sceneLock(shot.scene_id) }));
  const blocks = sceneBlocks.buildSceneBlocks(shots, contracts, { scene_block_max_duration: 15 });
  assert.deepStrictEqual(blocks.map(block => block.member_indexes), [[0], [1], [2], [3], [4]], '同一场景必须默认保留真实剪辑边界');
  assert.strictEqual(blocks[0].duration_sec, 3);
  assert.strictEqual(blocks[0].continuous, false);
  assert.deepStrictEqual(sceneBlocks.expandIndexesToBlocks([1], blocks), [1], '单镜失败只能重做当前生成单元');
  assert.strictEqual(blocks[0].spatial_reference_urls[0], '/api/new-story-ad/assets/master.png');
  const prompt = sceneBlocks.generationPrompt(blocks[0], shots, contracts, { 1: 'repair the current-task action handoff' });
  assert.ok(prompt.includes('exactly one final edit shot'));
  assert.ok(prompt.includes('Edit shot contract'));
  assert.ok(prompt.includes('Generation unit contract'));
  assert.ok(prompt.length <= 3950);
  ['钢材', '厨房', '展厅', '家居', '佛山'].forEach(term => assert.ok(!prompt.includes(term), `scene block prompt must not hardcode ${term}`));

  const qualityBlocks = sceneBlocks.buildSceneBlocks(shots, contracts, {
    scene_block_max_duration: 15,
    continuous_quality_mode: true,
    scene_block_generation: true,
  });
  assert.deepStrictEqual(qualityBlocks.map(block => block.member_indexes), [[0], [1], [2], [3], [4]], '质量模式也必须让每个已批准关键帧成为独立供应商首帧');
  assert.strictEqual(qualityBlocks[0].generation_mode, 'single_shot');
  assert.strictEqual(qualityBlocks[0].duration_sec, 3);
  assert.deepStrictEqual(sceneBlocks.expandIndexesToBlocks([1], qualityBlocks), [1], '单镜失败不得扩张为相邻镜头重复付费');
  const isolatedQualityBlocks = sceneBlocks.isolateIndexes(qualityBlocks, shots, contracts, [1]);
  assert.deepStrictEqual(isolatedQualityBlocks.map(block => block.member_indexes), [[0], [1], [2], [3], [4]], 'keyframe-transition recovery must isolate the authorized shot from an older multi-shot paid unit');
  assert.deepStrictEqual(sceneBlocks.expandIndexesToBlocks([1], isolatedQualityBlocks), [1]);
  assert.strictEqual(sceneBlocks.blockForIndex(isolatedQualityBlocks, 1).duration_sec, 4, 'isolated paid duration must equal the current authored shot only');
  assert.strictEqual(sceneBlocks.blockForIndex(isolatedQualityBlocks, 1).isolated_for_keyframe_transition, true);

  const authoredOneTakeShots = shots.map((shot, index) => index < 3 ? { ...shot, one_take_group_id: 'take-alpha' } : shot);
  const oneTakeBlocks = sceneBlocks.buildSceneBlocks(authoredOneTakeShots, contracts, {
    allow_one_take: true,
    provider_supports_one_take: true,
  });
  assert.deepStrictEqual(oneTakeBlocks.map(block => block.member_indexes), [[0], [1], [2], [3], [4]], '供应商没有时间多关键帧能力时，即使脚本标记一镜到底也不得合并已批准镜头');
  assert.strictEqual(oneTakeBlocks[0].continuous, false);

  const semanticShots = [
    { id: 'semantic-a', scene_id: 'space-semantic', duration: 5, characters: ['角色一'] },
    { id: 'semantic-b', scene_id: 'space-semantic', duration: 5, characters: ['角色一'], transition_type: 'hard_cut' },
    { id: 'semantic-c', scene_id: 'space-semantic', duration: 5, characters: [] },
    { id: 'semantic-d', scene_id: 'space-semantic', duration: 5, characters: [], transition_type: 'match_cut' },
  ];
  const semanticContracts = semanticShots.map(() => ({ scene_lock: sceneLock('space-semantic') }));
  const semanticBlocks = sceneBlocks.buildSceneBlocks(semanticShots, semanticContracts);
  assert.deepStrictEqual(semanticBlocks.map(block => block.member_indexes), [[0], [1], [2], [3]], '人物数量变化和剪辑边界不得触发隐式母片合并');
  const preservedSemanticBlocks = sceneBlocks.buildSceneBlocks(semanticShots, semanticContracts, { preserve_existing_topology: true });
  assert.deepStrictEqual(preservedSemanticBlocks.map(block => block.member_indexes), [[0], [1], [2], [3]], 'repairing an existing task must preserve the prior paid clip topology');

  const handoffShots = [
    { id: 'handoff-a', scene_id: 'space-handoff', duration: 5, characters: ['actor'], exit_frame_state: 'hand reaches the surface', screen_direction: 'left_to_right' },
    { id: 'handoff-b', scene_id: 'space-handoff', duration: 5, characters: [], transition_type: 'hard_cut', entry_frame_state: 'the same hand continues touching the surface', screen_direction: 'left_to_right' },
  ];
  const handoffBlocks = sceneBlocks.buildSceneBlocks(handoffShots, handoffShots.map(() => ({ scene_lock: sceneLock('space-handoff') })));
  assert.deepStrictEqual(handoffBlocks.map(block => block.member_indexes), [[0], [1]], '动作交接属于连续性合同，不等于付费生成单元合并');

  const baseLineage = lineage.buildShotLineage({
    shot: shots[0], index: 0, contract: contracts[0], keyframe: { image_url: '/frame.png' },
    ctx: { revisions: { source: 1, scene: 2, person: 1, product: 1 } }, modelRoute: 'provider/model', sceneBlock: oneTakeBlocks[0],
  });
  const changedBlock = { ...oneTakeBlocks[0], fingerprint: 'changed-block' };
  const changedLineage = lineage.buildShotLineage({
    shot: shots[0], index: 0, contract: contracts[0], keyframe: { image_url: '/frame.png' },
    ctx: { revisions: { source: 1, scene: 2, person: 1, product: 1 } }, modelRoute: 'provider/model', sceneBlock: changedBlock,
  });
  assert.notStrictEqual(baseLineage.fingerprint, changedLineage.fingerprint, 'scene block changes must invalidate derived shot clips');
  assert.strictEqual(lineage.reuseDecision({ file_path: __filename, provider_used: 'provider/model', qa: { pass: true }, motion_prompt: '' }, baseLineage).reusable, false, 'independent legacy clips cannot masquerade as a continuous block');
  const legacyGroupedBlock = {
    ...oneTakeBlocks[0],
    id: 'legacy-group-1-2',
    fingerprint: 'legacy-group-fingerprint',
    member_indexes: [0, 1],
    first_index: 0,
    last_index: 1,
    generation_mode: 'one_take',
    continuous: true,
  };
  const groupedFirstLineage = lineage.buildShotLineage({
    shot: shots[0], index: 0, contract: contracts[0], keyframe: { image_url: '/frame.png' },
    ctx: { revisions: { source: 1, scene: 2, person: 1, product: 1 } }, modelRoute: 'provider/model', sceneBlock: legacyGroupedBlock,
  });
  const singleFirstLineage = lineage.buildShotLineage({
    shot: shots[0], index: 0, contract: contracts[0], keyframe: { image_url: '/frame.png' },
    ctx: { revisions: { source: 1, scene: 2, person: 1, product: 1 } }, modelRoute: 'provider/model', sceneBlock: oneTakeBlocks[0],
  });
  const groupedFirstClip = lineage.attachLineage({
    file_path: __filename, provider_used: 'provider/model', qa: { pass: true }, cross_shot_qa: { pass: true },
    scene_block_members: [1, 2],
  }, groupedFirstLineage);
  assert.strictEqual(lineage.reuseDecision(groupedFirstClip, singleFirstLineage).reusable, true, 'multi-shot母片的首镜由自己的关键帧直接锚定，QA通过后可安全迁移为单镜');
  const groupedSecondLineage = lineage.buildShotLineage({
    shot: shots[1], index: 1, contract: contracts[1], keyframe: { image_url: '/frame-b.png' },
    ctx: { revisions: { source: 1, scene: 2, person: 1, product: 1 } }, modelRoute: 'provider/model', sceneBlock: legacyGroupedBlock,
  });
  const singleSecondLineage = lineage.buildShotLineage({
    shot: shots[1], index: 1, contract: contracts[1], keyframe: { image_url: '/frame-b.png' },
    ctx: { revisions: { source: 1, scene: 2, person: 1, product: 1 } }, modelRoute: 'provider/model', sceneBlock: oneTakeBlocks[1],
  });
  const groupedSecondClip = lineage.attachLineage({
    file_path: __filename, provider_used: 'provider/model', qa: { pass: true }, cross_shot_qa: { pass: true },
    scene_block_members: [1, 2],
  }, groupedSecondLineage);
  assert.strictEqual(lineage.reuseDecision(groupedSecondClip, singleSecondLineage).reusable, false, 'multi-shot母片的后续镜头没有自己的时间首帧锚点，禁止迁移为可信单镜');

  const tmp = path.join(__dirname, '..', 'outputs', 'analysis', 'scene-block-test-source.mp4');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  await videoAdapter.renderLocalClip({ outputPath: tmp, durationSec: 5, aspectRatio: '16:9' });
  const splitBlock = { ...blocks[0], id: 'test-block', fingerprint: 'test-fingerprint', member_indexes: [0, 1], first_index: 0, last_index: 1, beats: [
    { shot_index: 1, start_sec: 0, end_sec: 2, duration_sec: 2 },
    { shot_index: 2, start_sec: 2, end_sec: 5, duration_sec: 3 },
  ] };
  const parts = await videoAdapter.splitSceneBlockClip({ taskId: 'scene_block_test', block: splitBlock, sourceClip: { file_path: tmp, provider_used: 'test/model', video_url: '/source.mp4' }, shots, tracks: [], ctx: { output_ratio: '16:9', video_resolution: '480p' } });
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(parts[0].scene_block_start_sec, 0);
  assert.strictEqual(parts[1].scene_block_start_sec, 2);
  assert.strictEqual(parts[0].scene_block_end_sec, 2, 'motion analysis must not move an authored semantic shot boundary');
  assert.strictEqual(parts[0].scene_block_edit_evidence.semantic_boundaries_locked, true);
  assert.strictEqual(parts[0].scene_block_edit_evidence.method, 'authored_semantic_boundaries');
  assert.ok((await videoAdapter.probeDuration(parts[0].file_path)) >= 1.9);
  assert.ok((await videoAdapter.probeDuration(parts[1].file_path)) >= 2.9);
  [tmp, ...parts.map(part => part.file_path)].forEach(file => { try { fs.unlinkSync(file); } catch {} });

  const integrationTaskId = `scene_block_pipeline_${Date.now()}`;
  storage.createTask({ id: integrationTaskId, type: 'new_story_ad', status: 'running', stage: 'video', request: {}, user_id: 'test' });
  let providerCalls = 0;
  try {
    await assert.rejects(() => videoAdapter.generateSceneBlockVideos({
      taskId: integrationTaskId,
      shots: shots.slice(0, 2),
      contracts: contracts.slice(0, 2),
      keyframes: [{ image_url: '/frame-a.png' }, { image_url: '/frame-b.png' }],
      sceneBlocks: oneTakeBlocks.slice(0, 1).map(block => ({ ...block, member_indexes: [0, 1], first_index: 0, last_index: 1, duration_sec: 7, beats: block.beats.slice(0, 2) })),
      ctx: { cast_mode: 'no_human', output_ratio: '16:9', video_resolution: '480p' },
      options: {
        only_indexes: [0, 1],
        video_concurrency: 2,
        _pinnedVideoModel: { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128' },
        _generateShotVideo: async ({ taskId, shot, index }) => {
          providerCalls += 1;
          const filePath = path.join(__dirname, '..', 'outputs', 'analysis', `${taskId}_${index}.mp4`);
          await videoAdapter.renderLocalClip({ outputPath: filePath, durationSec: shot.duration_sec, aspectRatio: '16:9' });
          return { file_path: filePath, video_url: '/mock-block.mp4', provider_used: 'deyunai/doubao-seedance-2-0-260128', provider_task_id: 'mock-scene-block' };
        },
      },
      existingClips: [],
    }), error => error?.code === 'VIDEO_MULTI_KEYFRAME_ANCHOR_UNSUPPORTED'
      && error?.providerSubmitted === false
      && error?.billingState === 'not_submitted');
    assert.strictEqual(providerCalls, 0, '未锚定后续关键帧的多镜单元必须在供应商提交前停止');
  } finally {
    storage.deleteTask(integrationTaskId);
  }

  const partialTaskId = `scene_block_partial_${Date.now()}`;
  const partialShots = [
    { id: 'partial-a', title: '成功单元', scene_id: 'space-partial-a', duration: 2, characters: [] },
    { id: 'partial-b', title: '失败单元', scene_id: 'space-partial-b', duration: 2, characters: [] },
    { id: 'partial-c', title: '失败后不得提交的单元', scene_id: 'space-partial-c', duration: 2, characters: [] },
  ];
  const partialContracts = partialShots.map(shot => ({ scene_lock: sceneLock(shot.scene_id) }));
  const partialBlocks = sceneBlocks.buildSceneBlocks(partialShots, partialContracts);
  storage.createTask({ id: partialTaskId, type: 'new_story_ad', status: 'running', stage: 'video', request: {}, user_id: 'test' });
  storage.saveOutput(partialTaskId, 'video_shot_status_2', {
    index: 2, shot_index: 1, lifecycle: 'qa_failed', provider_task_id: 'old-provider-task',
    provider_submission_state: 'submitted', billing_state: 'unknown', provider_submitted_at: '2026-07-21T00:00:00.000Z',
    provider_started_at: '2026-07-21T00:00:01.000Z', last_polled_at: '2026-07-21T00:01:00.000Z', requested_video_seconds: 10,
  });
  let partialError;
  const calledIndexes = [];
  try {
    await videoAdapter.generateSceneBlockVideos({
      taskId: partialTaskId,
      shots: partialShots,
      contracts: partialContracts,
      keyframes: [{ image_url: '/frame-a.png' }, { image_url: '/frame-b.png' }, { image_url: '/frame-c.png' }],
      sceneBlocks: partialBlocks,
      ctx: { cast_mode: 'no_human', output_ratio: '16:9', video_resolution: '480p' },
      options: paidExecutionPolicy.canonicalize({
        only_indexes: [0, 1, 2],
        video_concurrency: 3,
        continue_after_unit_failure: true,
        continueAfterUnitFailure: true,
        allow_throttle_retry: true,
        allowThrottleRetry: true,
        allow_local_fallback: true,
        allowLocalFallback: true,
        parallel_videos: true,
        parallelVideos: true,
        _pinnedVideoModel: { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128' },
        _generateShotVideo: async ({ taskId, shot, index }) => {
          calledIndexes.push(index);
          if (index === 1) {
            const error = new Error('simulated provider billing failure');
            error.code = 'PROVIDER_BILLING';
            error.retryable = false;
            throw error;
          }
          const filePath = path.join(__dirname, '..', 'outputs', 'analysis', `${taskId}_${index}.mp4`);
          await videoAdapter.renderLocalClip({ outputPath: filePath, durationSec: shot.duration_sec, aspectRatio: '16:9' });
          return { shot_index: index, file_path: filePath, video_url: '/mock-partial.mp4', provider_used: 'deyunai/doubao-seedance-2-0-260128', provider_task_id: 'mock-partial-success' };
        },
      }),
      existingClips: [],
    });
  } catch (error) { partialError = error; }
  try {
    assert(partialError, '付费单元失败必须终止本批后续提交');
    assert.deepStrictEqual(calledIndexes, [0, 1], '失败后尚未开始的付费单元不得继续调用模型');
    const partialClips = partialError.partial_video_clips || [];
    assert.strictEqual(partialClips[0].error_code || '', '', '失败前已完成的付费输出必须保留');
    assert.ok(fs.existsSync(partialClips[0].file_path));
    assert.strictEqual(storage.getOutput(partialTaskId, 'video_shot_status_1').lifecycle, 'generated');
    assert.strictEqual(storage.getOutput(partialTaskId, 'video_shot_status_2').lifecycle, 'failed');
    assert.strictEqual(storage.getOutput(partialTaskId, 'video_shot_status_2').provider_submission_state, 'not_submitted');
    assert.strictEqual(storage.getOutput(partialTaskId, 'video_shot_status_2').billing_state, 'not_submitted', '新尝试提交前失败不得继承旧计费状态');
    assert.strictEqual(storage.getOutput(partialTaskId, 'video_shot_status_2').provider_submitted_at, '', '新尝试必须清空旧提交时间');
    assert.strictEqual(storage.getOutput(partialTaskId, 'video_shot_status_2').last_polled_at, '', '新尝试必须清空旧轮询时间');
    assert.strictEqual(storage.getOutput(partialTaskId, 'video_shot_status_3').provider_submission_state, 'not_submitted');
  } finally {
    (partialError?.partial_video_clips || []).map(clip => clip?.file_path).filter(Boolean).forEach(file => { try { fs.unlinkSync(file); } catch {} });
    storage.deleteTask(partialTaskId);
  }

  const boundaryTaskId = `scene_block_boundary_${Date.now()}`;
  const boundaryShots = [
    { id: 'boundary-a', title: 'Previous', scene_id: 'space-boundary', duration: 5, characters: [{ name: 'actor' }], exit_frame_state: 'hand touches wall', screen_direction: 'left_to_right' },
    { id: 'boundary-b', title: 'Current', scene_id: 'space-boundary', duration: 5, characters: [{ name: 'actor' }], transition_type: 'hard_cut', entry_frame_state: 'same hand continues', screen_direction: 'left_to_right' },
  ];
  const boundaryContracts = boundaryShots.map(() => ({
    scene_lock: sceneLock('space-boundary'),
    cast_lock: { person_contract: { person_id: 'actor-1', person_revision: 1, wardrobe_fingerprint: 'wardrobe-1' } },
  }));
  const boundaryKeyframes = boundaryShots.map((_, index) => ({ image_url: `/frame-${index + 1}.png`, qa: { pass: true, person: { person_presence: 'person' } } }));
  const boundaryBlocks = sceneBlocks.buildSceneBlocks(boundaryShots, boundaryContracts, { preserve_existing_topology: true });
  const boundaryClips = [
    { shot_index: 0, file_path: __filename, video_url: '/previous.mp4', qa: { pass: true, frames: [{ image_url: '/previous-head.jpg', second: 0 }, { image_url: '/previous-tail.jpg', second: 4.95 }] } },
    { shot_index: 1, file_path: __filename, video_url: '/current.mp4', qa: { pass: true }, cross_shot_qa: { pass: false, failure_dimensions: ['screen_direction', 'action_continuity'], problems: ['action restarted'] } },
  ];
  const boundaryContract = boundaryRepair.buildContract({ clips: boundaryClips, shots: boundaryShots, keyframes: boundaryKeyframes, contracts: boundaryContracts, index: 1 });
  assert.strictEqual(boundaryContract.direct_tail_capability.safe, false);
  assert(boundaryContract.direct_tail_capability.reasons.includes('tail_only_cannot_bind_current_approved_keyframe'));
  let submittedOptions;
  storage.createTask({ id: boundaryTaskId, type: 'new_story_ad', status: 'running', stage: 'video', request: {}, user_id: 'test' });
  try {
    await assert.rejects(() => videoAdapter.generateSceneBlockVideos({
      taskId: boundaryTaskId, shots: boundaryShots, contracts: boundaryContracts,
      keyframes: boundaryKeyframes, sceneBlocks: boundaryBlocks,
      ctx: { cast_mode: 'single', person_asset: { image_url: '/actor.png' }, output_ratio: '16:9', video_resolution: '480p' }, existingClips: boundaryClips,
      options: {
        only_indexes: [1], _pinnedVideoModel: { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128' },
        _boundaryRepairContracts: { 1: boundaryContract }, _repairInstructions: { 1: boundaryRepair.repairInstruction(boundaryContract) },
        _generateShotVideo: async () => { throw new Error('unsafe direct-tail input must be blocked before provider submission'); },
      },
    }), error => error?.code === 'VIDEO_BOUNDARY_REPAIR_TAIL_INSUFFICIENT');

    const fallbackOptionsByIndex = {};
    let personAssetPreparations = 0;
    await videoAdapter.generateSceneBlockVideos({
      taskId: boundaryTaskId, shots: boundaryShots, contracts: boundaryContracts,
      keyframes: boundaryKeyframes, sceneBlocks: boundaryBlocks,
      ctx: { cast_mode: 'single', person_asset: { image_url: '/actor.png' }, output_ratio: '16:9', video_resolution: '480p' }, existingClips: boundaryClips,
      options: {
        only_indexes: [0, 1], _pinnedVideoModel: { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128' },
        _keyframeFirstFrameOnlyIndexes: [1], _boundaryRepairContracts: {},
        _preparePersonAsset: async () => { personAssetPreparations += 1; return { asset_url: 'asset://shared-person' }; },
        _prepareKeyframeReferenceAsset: async ({ index }) => {
          if (index === 1) throw new Error('direct current-keyframe fallback must not require the advanced asset library');
          return { asset_url: 'asset://ordinary-keyframe' };
        },
        _prepareBoundaryReferenceAsset: async () => { throw new Error('keyframe fallback must not prepare the previous-tail asset'); },
        _generateShotVideo: async ({ index, options }) => { fallbackOptionsByIndex[index] = options; return { shot_index: index, file_path: __filename, video_url: '/mock-keyframe-fallback.mp4', provider_used: 'deyunai/doubao-seedance-2-0-260128', provider_task_id: 'mock-keyframe-fallback' }; },
      },
    });
    submittedOptions = fallbackOptionsByIndex[1];
    assert.strictEqual(personAssetPreparations, 1, 'a mixed request may prepare one shared person asset for its ordinary unit');
    assert.strictEqual(fallbackOptionsByIndex[0]._deyunaiPersonAsset.asset_url, 'asset://shared-person');
    assert.strictEqual(submittedOptions._deyunaiPersonAsset, null);
    assert.deepStrictEqual(submittedOptions._sceneReferenceAssetUrls, []);
    assert.strictEqual(submittedOptions._boundaryReferenceAssetUrl, '');
    assert.strictEqual(submittedOptions._inputModeOverride, 'approved_keyframe_first_frame_only');

    const managedContract = { ...boundaryContract, input_strategy: boundaryRepair.MANAGED_DUAL_REFERENCE };
    await videoAdapter.generateSceneBlockVideos({
      taskId: boundaryTaskId, shots: boundaryShots, contracts: boundaryContracts,
      keyframes: boundaryKeyframes, sceneBlocks: boundaryBlocks,
      ctx: { cast_mode: 'single', person_asset: { image_url: '/actor.png' }, output_ratio: '16:9', video_resolution: '480p' }, existingClips: boundaryClips,
      options: {
        only_indexes: [1], _pinnedVideoModel: { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128' },
        _keyframeReferenceOnlyIndexes: [1],
        _boundaryRepairContracts: { 1: managedContract }, _repairInstructions: { 1: boundaryRepair.repairInstruction(managedContract) },
        _prepareKeyframeReferenceAsset: async () => ({ asset_url: 'asset://current-keyframe' }),
        _prepareBoundaryReferenceAsset: async () => ({ asset_url: 'asset://previous-tail' }),
        _generateShotVideo: async ({ index, options }) => { submittedOptions = options; return { shot_index: index, file_path: __filename, video_url: '/mock-managed-boundary.mp4', provider_used: 'deyunai/doubao-seedance-2-0-260128', provider_task_id: 'mock-managed-boundary' }; },
      },
    });
    assert.strictEqual(submittedOptions._deyunaiPersonAsset.asset_url, 'asset://current-keyframe');
    assert.deepStrictEqual(submittedOptions._sceneReferenceAssetUrls, ['asset://previous-tail']);
    assert.strictEqual(submittedOptions._inputModeOverride, 'approved_keyframe_and_previous_tail_private_references');

    await videoAdapter.generateSceneBlockVideos({
      taskId: boundaryTaskId, shots: boundaryShots, contracts: boundaryContracts,
      keyframes: boundaryKeyframes, sceneBlocks: boundaryBlocks,
      ctx: { cast_mode: 'single', person_asset: { image_url: '/actor.png' }, output_ratio: '16:9', video_resolution: '480p' }, existingClips: boundaryClips,
      options: {
        only_indexes: [0], _pinnedVideoModel: { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128' },
        _keyframeReferenceOnlyIndexes: [0], _boundaryRepairContracts: {},
        _preparePersonAsset: async () => { throw new Error('private-keyframe mode must not prepare the shared person asset'); },
        _prepareKeyframeReferenceAsset: async () => ({ asset_url: 'asset://approved-keyframe' }),
        _generateShotVideo: async ({ index, options }) => { submittedOptions = options; return { shot_index: index, file_path: __filename, video_url: '/mock-private-keyframe.mp4', provider_used: 'deyunai/doubao-seedance-2-0-260128', provider_task_id: 'mock-private-keyframe' }; },
      },
    });
    assert.strictEqual(submittedOptions._deyunaiPersonAsset.asset_url, 'asset://approved-keyframe');
    assert.strictEqual(submittedOptions._inputModeOverride, 'approved_keyframe_private_reference_only');
    assert.deepStrictEqual(submittedOptions._sceneReferenceAssetUrls, []);
  } finally {
    storage.deleteTask(boundaryTaskId);
  }
  console.log('new story ad continuous scene block video: ok');
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
