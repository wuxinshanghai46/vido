const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sceneBlocks = require('../src/services/newStoryAd/sceneBlockService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const lineage = require('../src/services/newStoryAd/videoLineageService');
const storage = require('../src/services/newStoryAd/storageService');

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

  const authoredOneTakeShots = shots.map((shot, index) => index < 3 ? { ...shot, one_take_group_id: 'take-alpha' } : shot);
  const oneTakeBlocks = sceneBlocks.buildSceneBlocks(authoredOneTakeShots, contracts, {
    allow_one_take: true,
    provider_supports_one_take: true,
  });
  assert.deepStrictEqual(oneTakeBlocks.map(block => block.member_indexes), [[0, 1, 2], [3], [4]], '只有明确标记并通过能力检查的一镜到底才允许合并');
  assert.strictEqual(oneTakeBlocks[0].continuous, true);
  assert.ok(sceneBlocks.generationPrompt(oneTakeBlocks[0], authoredOneTakeShots, contracts).includes('uninterrupted take'));

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
  assert.ok((await videoAdapter.probeDuration(parts[0].file_path)) >= 1.9);
  assert.ok((await videoAdapter.probeDuration(parts[1].file_path)) >= 2.9);
  [tmp, ...parts.map(part => part.file_path)].forEach(file => { try { fs.unlinkSync(file); } catch {} });

  const integrationTaskId = `scene_block_pipeline_${Date.now()}`;
  storage.createTask({ id: integrationTaskId, type: 'new_story_ad', status: 'running', stage: 'video', request: {}, user_id: 'test' });
  let providerCalls = 0;
  let pipelineResult;
  try {
    pipelineResult = await videoAdapter.generateSceneBlockVideos({
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
    });
    assert.strictEqual(providerCalls, 1, 'two storyboard beats in one block must make one provider generation call');
    assert.strictEqual(pipelineResult.clips.filter(Boolean).length, 2, 'one block must split back into per-shot QA clips');
    assert.strictEqual(pipelineResult.clips[0].scene_block_id, pipelineResult.clips[1].scene_block_id);
    assert.deepStrictEqual(pipelineResult.target_indexes, [0, 1]);
  } finally {
    const generatedFiles = (pipelineResult?.clips || []).map(clip => clip?.file_path).filter(Boolean);
    const sourceFiles = (pipelineResult?.clips || []).map(clip => clip?.scene_block_source_file).filter(Boolean);
    [...generatedFiles, ...sourceFiles].forEach(file => { try { fs.unlinkSync(file); } catch {} });
    storage.deleteTask(integrationTaskId);
  }

  const partialTaskId = `scene_block_partial_${Date.now()}`;
  const partialShots = [
    { id: 'partial-a', title: '成功单元', scene_id: 'space-partial-a', duration: 2, characters: [] },
    { id: 'partial-b', title: '失败单元', scene_id: 'space-partial-b', duration: 2, characters: [] },
  ];
  const partialContracts = partialShots.map(shot => ({ scene_lock: sceneLock(shot.scene_id) }));
  const partialBlocks = sceneBlocks.buildSceneBlocks(partialShots, partialContracts);
  storage.createTask({ id: partialTaskId, type: 'new_story_ad', status: 'running', stage: 'video', request: {}, user_id: 'test' });
  let partialResult;
  try {
    partialResult = await videoAdapter.generateSceneBlockVideos({
      taskId: partialTaskId,
      shots: partialShots,
      contracts: partialContracts,
      keyframes: [{ image_url: '/frame-a.png' }, { image_url: '/frame-b.png' }],
      sceneBlocks: partialBlocks,
      ctx: { cast_mode: 'no_human', output_ratio: '16:9', video_resolution: '480p' },
      options: {
        only_indexes: [0, 1],
        video_concurrency: 1,
        _pinnedVideoModel: { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128' },
        _generateShotVideo: async ({ taskId, shot, index }) => {
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
      },
      existingClips: [],
    });
  } catch (error) { throw error; }
  try {
    assert.deepStrictEqual(partialResult.failed_indexes, [1], 'a failed independent block must be reported without aborting sibling blocks');
    assert.strictEqual(partialResult.clips[0].error_code || '', '', 'successful paid output must not be poisoned by a sibling failure');
    assert.ok(fs.existsSync(partialResult.clips[0].file_path));
    assert.strictEqual(storage.getOutput(partialTaskId, 'video_shot_status_1').lifecycle, 'generated');
    assert.strictEqual(storage.getOutput(partialTaskId, 'video_shot_status_2').lifecycle, 'failed');
    assert.strictEqual(storage.getOutput(partialTaskId, 'video_shot_status_2').provider_submission_state, 'not_submitted');
  } finally {
    (partialResult?.clips || []).map(clip => clip?.file_path).filter(Boolean).forEach(file => { try { fs.unlinkSync(file); } catch {} });
    storage.deleteTask(partialTaskId);
  }
  console.log('new story ad continuous scene block video: ok');
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
