#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-competitor-continuity-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_MOCK_LLM = '1';

const sceneBlocks = require('../src/services/newStoryAd/sceneBlockService');
const motionAwareEdit = require('../src/services/newStoryAd/motionAwareEditService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const videoFrameQa = require('../src/services/newStoryAd/videoFrameQaService');
const composeService = require('../src/services/newStoryAd/composeService');
const storage = require('../src/services/newStoryAd/storageService');
const storyService = require('../src/services/newStoryAd/storyAdService');

function genericShot(index, duration, extra = {}) {
  return {
    id: `generic-${index + 1}`,
    title: `通用连续镜头 ${index + 1}`,
    scene_id: 'generic-current-task-space',
    scene_revision: 1,
    duration,
    characters: ['当前任务角色'],
    visual: `当前任务空间中的第 ${index + 1} 个视觉节拍`,
    action: `角色连续完成第 ${index + 1} 个自然动作`,
    screen_direction: 'left_to_right',
    ...extra,
  };
}

function contract() {
  return {
    scene_lock: {
      scene_id: 'generic-current-task-space',
      scene_revision: 1,
      scene_contract: { lighting: 'current task authored light' },
    },
  };
}

function renderTestPatternVideo(filePath, durationSec = 3) {
  const rendered = spawnSync(ffmpegPath, [
    '-y', '-f', 'lavfi', '-i', `testsrc2=s=320x180:r=24:d=${durationSec}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', filePath,
  ], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(rendered.status, 0, rendered.stderr || '无法生成视觉合成去重测试视频');
}

function testGenericKeyframeAnchoredUnits() {
  assert.strictEqual(sceneBlocks.DEFAULT_MIN_BLOCK_DURATION, 6);
  assert.strictEqual(sceneBlocks.DEFAULT_MAX_BLOCK_DURATION, 10);
  const durations = [3, 3, 4, 2, 4, 4];
  const shots = durations.map((duration, index) => genericShot(index, duration));
  const blocks = sceneBlocks.buildSceneBlocks(shots, shots.map(contract), {
    continuous_quality_mode: true,
    scene_block_generation: true,
  });
  assert.deepStrictEqual(blocks.map(block => block.member_indexes), [[0], [1], [2], [3], [4], [5]], '每个批准关键帧必须且只能进入一个独立供应商生成单元');
  assert.deepStrictEqual(blocks.map(block => block.duration_sec), durations, '逐镜生成必须保留脚本时长，不能为了供应商时长窗口吞并镜头');
  assert(blocks.every(block => block.automatic_retry_limit === 0), '单镜单元不得自动产生第二次付费调用');

  const shortBoundaryShots = [
    genericShot(0, 3),
    genericShot(1, 3, { transition_type: 'fade' }),
  ];
  const shortBoundaryBlocks = sceneBlocks.buildSceneBlocks(shortBoundaryShots, shortBoundaryShots.map(contract), {
    continuous_quality_mode: true,
    scene_block_generation: true,
  });
  assert.deepStrictEqual(shortBoundaryBlocks.map(block => block.member_indexes), [[0], [1]], '明确转场硬边界不能为凑够 6 秒而被吞并');
  assert(shortBoundaryBlocks.every(block => block.duration_sec === 3), '硬边界和单镜不足时允许安全短单元');

  const prompt = sceneBlocks.generationPrompt(blocks[0], shots, shots.map(contract));
  ['不锈钢', '家居', '佛山', '展厅', '厨房', '医疗行业'].forEach(term => {
    assert(!prompt.includes(term), `通用连续单元不得硬编码行业关键词：${term}`);
  });
}

async function testMotionAwareBoundariesAndFallback() {
  const sourcePath = path.join(tempDir, 'motion-source.mp4');
  const rendered = spawnSync(ffmpegPath, [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=2.5',
    '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=0.8',
    '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30:d=2.7',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]',
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', sourcePath,
  ], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(rendered.status, 0, rendered.stderr || '无法生成运动切点测试视频');
  const beats = [
    { shot_index: 1, start_sec: 0, end_sec: 3, duration_sec: 3 },
    { shot_index: 2, start_sec: 3, end_sec: 6, duration_sec: 3 },
  ];
  motionAwareEdit.clearAnalysisCacheForTest();
  const selected = await motionAwareEdit.selectSafeCutPoints({
    filePath: sourcePath,
    beats,
    searchWindowSec: 0.8,
    fps: 6,
    minimumBeatSec: 1,
  });
  assert.strictEqual(selected.evidence.policy_version, motionAwareEdit.POLICY_VERSION);
  assert.strictEqual(selected.evidence.boundaries.length, 1);
  const boundary = selected.evidence.boundaries[0];
  assert(boundary.selected_sec >= 2.2 && boundary.selected_sec <= 3.8, '运动安全切点只能在计划边界前后 ±0.8 秒的有限窗口内选择');
  assert(boundary.selected_sec > boundary.planned_sec, '计划点仍处于高运动时，应能向后找到稳定切点，不能只允许提前切');
  assert(selected.beats.every(beat => beat.duration_sec >= 1), '切点调整不得把相邻节拍压缩到安全下限以下');
  assert.strictEqual(selected.beats[0].end_sec, selected.beats[1].start_sec, '相邻节拍必须共享同一个实际切点');
  assert(selected.beats.every((beat, index, list) => index === 0 || beat.start_sec >= list[index - 1].start_sec), '调整后节拍必须保持单调顺序');
  assert.strictEqual(selected.evidence.analysis_cache_hit, false);
  const cached = await motionAwareEdit.selectSafeCutPoints({ filePath: sourcePath, beats, searchWindowSec: 0.8, fps: 6, minimumBeatSec: 1 });
  assert.strictEqual(cached.evidence.analysis_cache_hit, true, '同一母片及分析参数必须命中缓存，不能为每个拆分镜头重复运动分析');

  const fallback = await motionAwareEdit.selectSafeCutPoints({
    filePath: path.join(tempDir, 'missing-source.mp4'),
    beats,
  });
  assert.strictEqual(fallback.evidence.method, 'planned_boundary_fallback');
  assert.strictEqual(fallback.evidence.fallback_reason, 'source_or_boundaries_missing');
  assert.deepStrictEqual(fallback.beats, beats, '缺少运动证据时必须回退计划切点，不得虚构分析结果');
}

async function testContinuousSourceVisualDeduplication() {
  assert.strictEqual(typeof composeService.buildVisualComposeUnits, 'function', '合成层必须提供视觉输入去重合同');
  const sharedSource = path.join(tempDir, 'continuous-mother.mp4');
  const clips = [
    {
      shot_index: 0,
      file_path: path.join(tempDir, 'split-1.mp4'),
      scene_block_source_file: sharedSource,
      scene_block_id: 'block-1-3',
      scene_block_members: [1, 2, 3],
      scene_block_start_sec: 0,
      scene_block_end_sec: 3,
    },
    {
      shot_index: 1,
      file_path: path.join(tempDir, 'split-2.mp4'),
      scene_block_source_file: sharedSource,
      scene_block_id: 'block-1-3',
      scene_block_members: [1, 2, 3],
      scene_block_start_sec: 3,
      scene_block_end_sec: 6,
    },
    {
      shot_index: 2,
      file_path: path.join(tempDir, 'split-3.mp4'),
      scene_block_source_file: sharedSource,
      scene_block_id: 'block-1-3',
      scene_block_members: [1, 2, 3],
      scene_block_start_sec: 6,
      scene_block_end_sec: 9,
    },
    { shot_index: 3, file_path: path.join(tempDir, 'independent.mp4') },
  ];
  renderTestPatternVideo(sharedSource, 9);
  renderTestPatternVideo(clips[3].file_path, 2);
  const units = composeService.buildVisualComposeUnits(clips);
  assert.strictEqual(units.length, 2, '同一连续母片拆出的三个 QA 片段在视觉合成时只能输入一次');
  assert.strictEqual(units[0].source_file_path, sharedSource);
  assert.deepStrictEqual(units[0].member_indexes, [0, 1, 2]);
  assert.strictEqual(units[0].preserved_continuous_source, true);
  assert.strictEqual(units[0].timeline_beats.length, 3, '视觉去重不能丢失三个分镜的时间线节拍元数据');
  assert.strictEqual(units[1].preserved_continuous_source, false);

  const composed = await composeService.concatVideos({ taskId: 'visual-source-dedup', clips, transitions: [{}, {}, {}, {}] });
  assert.strictEqual(composed.visual_input_count, 2, '最终视觉合成只能读取连续母片一次，再加一个独立镜头');
  assert.strictEqual(composed.visual_units.filter(unit => unit.source_file_path === sharedSource).length, 1, '同一母片不得重复进入转码输入');
  const duration = await videoAdapter.probeDuration(composed.file_path);
  assert(duration >= 10.7 && duration <= 11.3, `去重后仍必须保留完整 9+2 秒时间线，实际 ${duration} 秒`);
}

async function testMissingCrossShotEvidenceIsBlocking() {
  const result = await videoFrameQa.reviewCrossShot({
    taskId: 'missing-cross-shot-evidence',
    previous: { pass: true, frames: [] },
    current: { pass: true, frames: [{ image_url: '/one-frame.jpg' }] },
  });
  assert.strictEqual(result.pass, false, '缺帧不能以 not_applicable 静默通过跨镜连续性 QA');
  assert.strictEqual(result.error_code, 'VIDEO_QA_EVIDENCE_MISSING');
  assert.notStrictEqual(result.status, 'not_applicable');
}

function testP0CannotBeManuallyAccepted() {
  const taskId = 'competitor-p0-manual-accept';
  const clipPath = path.join(tempDir, 'existing-paid-output.mp4');
  fs.writeFileSync(clipPath, 'mock existing paid media');
  storage.createTask({ id: taskId, type: 'new_story_ad', user_id: 'test-user', request: {} });
  storage.saveOutput(taskId, 'storyboard_table', [{ index: 1, title: '当前任务镜头' }]);
  storage.saveOutput(taskId, 'video_clips', [{
    shot_index: 0,
    file_path: clipPath,
    video_url: '/existing-paid-output.mp4',
    lineage_fingerprint: 'current-lineage',
    qa: { pass: false, failure_dimensions: ['person_identity'], problems: ['identity drift'] },
    error: '视频抽帧 QA 未通过',
    error_code: 'VIDEO_FRAME_QA_FAILED',
  }]);
  assert.throws(
    () => storyService.acceptVideoClipOverride(taskId, 0, { reason: '尝试接受 P0' }, { id: 'test-user' }),
    error => error.code === 'VIDEO_MANUAL_ACCEPT_BLOCKED_P0' && error.status === 409,
    '人物、场景、动作或跨镜连续性的 P0 失败不得靠人工接受绕过',
  );
  assert.strictEqual(storage.getOutput(taskId, 'video_clips')[0].qa.pass, false, '被拒绝的 P0 人工接受不能改写已保存 QA');

  storage.saveOutput(taskId, 'video_clips', [{
    shot_index: 0,
    file_path: clipPath,
    video_url: '/existing-paid-output.mp4',
    lineage_fingerprint: 'current-lineage',
    qa: { pass: false, failure_dimensions: ['composition'], problems: ['minor framing preference'] },
    error: '视频抽帧 QA 未通过',
    error_code: 'VIDEO_FRAME_QA_FAILED',
  }]);
  const accepted = storyService.acceptVideoClipOverride(taskId, 0, { reason: '确认接受非 P0 构图偏好' }, { id: 'test-user' });
  assert.strictEqual(accepted.video_clip.qa.status, 'manual_accepted', '明确的非 P0 轻微项仍保留可审计的人工作出决定路径');
  storage.deleteTask(taskId);
}

(async () => {
  try {
    testGenericKeyframeAnchoredUnits();
    await testMotionAwareBoundariesAndFallback();
    await testContinuousSourceVisualDeduplication();
    await testMissingCrossShotEvidenceIsBlocking();
    testP0CannotBeManuallyAccepted();
    console.log('new story ad competitor continuity gates: ok');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
