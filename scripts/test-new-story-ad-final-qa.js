#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-final-qa-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_MOCK_LLM = '1';

const videoCore = require('../src/services/videoGenerationCore');
const videoPreflight = require('../src/services/newStoryAd/videoPreflightService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');
const composeService = require('../src/services/newStoryAd/composeService');
const finalVideoQa = require('../src/services/newStoryAd/finalVideoQaService');
const storage = require('../src/services/newStoryAd/storageService');
const storyService = require('../src/services/newStoryAd/storyAdService');
const artifactWorkflow = require('../src/services/newStoryAd/videoArtifactWorkflowService');
const keyframeFreshness = require('../src/services/newStoryAd/keyframeContractFreshnessService');
const frameQa = require('../src/services/newStoryAd/videoFrameQaService');

function shot(index, duration) {
  return {
    id: `final-qa-shot-${index + 1}`,
    title: `通用镜头 ${index + 1}`,
    scene_id: 'final-qa-generic-space',
    scene_revision: 1,
    duration,
    visual: `当前任务视觉节拍 ${index + 1}`,
    action: `当前角色连续完成动作 ${index + 1}`,
    characters: ['当前角色'],
    screen_direction: 'left_to_right',
  };
}

function contract(index) {
  return {
    contract_fingerprint: `final-contract-${index + 1}`,
    scene_lock: {
      scene_id: 'final-qa-generic-space',
      scene_revision: 1,
      scene_contract: { lighting: 'current authored light' },
    },
  };
}

function approvedKeyframe(index) {
  return {
    image_url: `/frame-${index + 1}.png`,
    current_generation_id: `frame-generation-${index + 1}`,
    contract_fingerprint: `final-contract-${index + 1}`,
    current_generation_status: 'accepted',
    qa: { pass: true, person: { person_presence: 'person' } },
  };
}

function testSelectiveRedoAndCostAuthorization() {
  const shots = [3, 3, 4, 2, 4, 4].map((duration, index) => shot(index, duration));
  const contracts = shots.map((_, index) => contract(index));
  const keyframes = shots.map((_, index) => approvedKeyframe(index));
  const common = {
    taskId: 'selective-quality-redo', shots, contracts, keyframes,
    clips: [], statuses: [], mode: 'quality', providerRoute: 'deyunai/doubao-seedance-2-0-260128',
  };
  const firstGroup = videoPreflight.buildVideoPreflight({ ...common, onlyIndexes: [1] });
  assert.strictEqual(firstGroup.paid_unit_count, 1, '选择一个失败镜头只能授权它所属的一个连续母片单元');
  assert.deepStrictEqual(firstGroup.units.map(unit => unit.member_indexes), [[0, 1, 2]], '选择性重做必须扩展到真实母片边界');
  assert.deepStrictEqual(firstGroup.shots.map(item => item.index), [0, 1, 2], '预检明细必须与实际付费目标完全一致');
  assert.strictEqual(firstGroup.paid_video_seconds, 10);
  assert.strictEqual(firstGroup.automatic_retry_count, 0);
  assert(firstGroup.units.every(unit => unit.automatic_retry_limit === 0 || unit.automatic_retry_limit === undefined));

  const secondGroup = videoPreflight.buildVideoPreflight({ ...common, onlyIndexes: [4] });
  assert.deepStrictEqual(secondGroup.units.map(unit => unit.member_indexes), [[3, 4, 5]]);
  assert.notStrictEqual(firstGroup.fingerprint, secondGroup.fingerprint, '不同选择性重做目标必须产生不同费用/执行确认指纹');

  const authorizedExecutionPlan = {
    fingerprint: firstGroup.execution_plan?.fingerprint || firstGroup.fingerprint,
    generation_units: firstGroup.units.filter(unit => unit.paid).map(unit => ({
      id: unit.id,
      paid: true,
      mode: unit.continuous ? 'one_take' : 'single_shot',
      edit_shot_indexes: unit.member_indexes,
      duration_sec: unit.duration_sec,
      complexity_level: 0,
      requires_manual_review: false,
      automatic_retry_limit: 0,
    })),
  };
  const costPlan = videoCore.costGuard.buildCostPlan({
    executionPlan: authorizedExecutionPlan,
    providerId: 'deyunai',
    modelId: 'doubao-seedance-2-0-260128',
    options: { usd_cny_rate: 7.2 },
  });
  assert.strictEqual(costPlan.paid_unit_count, 1);
  assert.deepStrictEqual(costPlan.units[0].edit_shot_indexes, [0, 1, 2], '费用确认单元必须与实际选择性重做目标一致');
  assert.strictEqual(costPlan.automatic_paid_retry_count, 0);
  assert.throws(
    () => videoCore.costGuard.assertCostAuthorization(costPlan, {}),
    error => error.code === 'VIDEO_COST_CONFIRMATION_REQUIRED',
    '没有费用指纹与人民币上限时不得提交付费重做',
  );
  const authorization = videoCore.costGuard.assertCostAuthorization(costPlan, {
    cost_plan_fingerprint: costPlan.fingerprint,
    confirmed_cost_limit_rmb: costPlan.maximum_cost_rmb,
  });
  assert.strictEqual(authorization.authorized, true);
}

function writeSilentPcmWav(filePath, durationSec = 0.5) {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataBytes = Math.round(sampleRate * durationSec) * channels * bitsPerSample / 8;
  const buffer = Buffer.alloc(44 + dataBytes);
  const blockAlign = channels * bitsPerSample / 8;
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

function renderTestPatternVideo(filePath, durationSec = 3) {
  const rendered = spawnSync(ffmpegPath, [
    '-y', '-f', 'lavfi', '-i', `testsrc2=s=320x180:r=24:d=${durationSec}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', filePath,
  ], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(rendered.status, 0, rendered.stderr || '无法生成最终 QA 测试视频');
}

async function testShortVoiceTrackCannotTruncateVisual() {
  const videoPath = path.join(tempDir, 'three-second-visual.mp4');
  renderTestPatternVideo(videoPath, 3);
  const audioName = 'half-second-voice.wav';
  const audioPath = path.join(ttsAdapter.AUDIO_DIR, audioName);
  writeSilentPcmWav(audioPath, 0.5);
  const composed = await composeService.concatVideos({
    taskId: 'short-voice-must-not-truncate',
    clips: [{ shot_index: 0, file_path: videoPath }],
    ttsAudio: { tracks: [{ audio_url: ttsAdapter.publicAudioUrl(audioName), text: '短配音' }] },
    transitions: [{}],
  });
  const duration = await videoAdapter.probeDuration(composed.file_path);
  assert(duration >= 2.85, `0.5 秒配音不得把 3 秒视觉截断，实际成片仅 ${duration} 秒`);
  assert.strictEqual(composed.voiceover_applied, true);
  const qa = await finalVideoQa.inspectFinalVideo({
    filePath: composed.file_path,
    expectedDurationSec: 3,
    requireAudio: true,
    transitionPlan: composed.transition_plan,
  });
  assert.strictEqual(qa.pass, true);
}

async function testFinalQaFailureIsNotPersisted() {
  const taskId = 'final-qa-persistence-gate';
  const clipPath = path.join(tempDir, 'approved-input.mp4');
  await videoAdapter.renderLocalClip({ outputPath: clipPath, durationSec: 2, aspectRatio: '16:9' });
  storage.createTask({ id: taskId, type: 'new_story_ad', status: 'done', stage: 'video_ready', user_id: 'test', request: {} });
  storage.saveOutput(taskId, 'context', { include_voiceover: false, subtitle: false, output_ratio: '16:9' });
  const composeShots = [{ index: 1, duration: 2, title: '当前任务镜头' }];
  storage.saveOutput(taskId, 'storyboard_table', composeShots);
  const composeCtx = storage.getOutput(taskId, 'context'), composeContracts = keyframeFreshness.inspect(taskId, { ctx: composeCtx, shots: composeShots }).contracts;
  const currentLineage = artifactWorkflow.buildExpectedLineages({ shots: composeShots, contracts: composeContracts, ctx: composeCtx, shotPlans: [{ index: 0, input_strategy: 'approved_keyframe_first_frame_only' }], qaPolicyVersion: frameQa.VIDEO_FRAME_QA_POLICY_VERSION, speechModeFor: (shotItem, contractItem) => videoAdapter.explicitShotSpeechMode(shotItem, contractItem), motionPromptFor: (shotItem, contractItem) => videoAdapter.clipPrompt(shotItem, composeCtx, contractItem, null, {}, '') })[0];
  storage.saveOutput(taskId, 'video_clips', [{
    shot_index: 0,
    file_path: clipPath,
    video_url: '/approved-input.mp4',
    lineage: currentLineage,
    lineage_fingerprint: currentLineage.fingerprint,
    seedance_input_mode: 'approved_keyframe_first_frame_only',
    qa: { pass: true, qa_policy_version: frameQa.VIDEO_FRAME_QA_POLICY_VERSION },
  }]);

  const originalInspect = finalVideoQa.inspectFinalVideo;
  let inspectCalls = 0;
  finalVideoQa.inspectFinalVideo = async () => {
    inspectCalls += 1;
    return { pass: false, error_code: 'FINAL_VIDEO_TECHNICAL_QA_FAILED', problems: ['mock final decode failure'] };
  };
  try {
    await assert.rejects(
      () => storyService.composeStage(taskId, { include_voiceover: false, subtitle: false }),
      error => error.code === 'FINAL_VIDEO_TECHNICAL_QA_FAILED',
    );
    assert.strictEqual(inspectCalls, 1, '每次最终合成必须且只需执行一次成片技术 QA');
    assert.strictEqual(storage.getOutput(taskId, 'final_video'), null, '最终 QA 失败不能持久化成片记录');
    assert.notStrictEqual(storage.getTask(taskId).stage, 'final_video_ready', '最终 QA 失败不能把任务推进到成片就绪');
  } finally {
    finalVideoQa.inspectFinalVideo = originalInspect;
    storage.deleteTask(taskId);
  }

  const invalidPath = path.join(tempDir, 'invalid-final.mp4');
  fs.writeFileSync(invalidPath, 'not a video');
  const invalidQa = await finalVideoQa.inspectFinalVideo({ filePath: invalidPath, expectedDurationSec: 2, requireAudio: false, transitionPlan: [] });
  assert.strictEqual(invalidQa.pass, false, '不可解码的最终文件必须被技术 QA 硬拒绝');
  assert.match(invalidQa.error_code || '', /^FINAL_VIDEO_(?:PROBE_FAILED|TECHNICAL_QA_FAILED)$/, '失败必须携带稳定的最终视频 QA 错误码');
}

function testForceRegenerateAllIsNeverImplicit() {
  const root = path.resolve(__dirname, '..');
  const storySource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyAdService.js'), 'utf8');
  const generationFlow = fs.readFileSync(path.join(root, 'public/js/new-story-ad/generation-flow.js'), 'utf8');
  const mediaBody = generationFlow.slice(generationFlow.indexOf('function mediaStageBody'), generationFlow.indexOf('function keyframeStatusFromResponse'));
  assert(!/forceRegenerateAll\s*=\s*!zeroCostOnly\s*&&\s*\(\s*generationMode\s*===\s*['"]quality['"]/.test(storySource), 'quality 模式不能隐式强制全量重做');
  assert(/options\.force_regenerate_all\s*===\s*true|options\.forceRegenerateAll\s*===\s*true/.test(storySource), '只有显式服务端标志才能授权全量重做');
  assert(!/force_regenerate_all\s*:\s*true/.test(mediaBody), '普通整片媒体提交不得默认 force_regenerate_all=true');
  assert(/max_auto_repairs\s*:\s*0/.test(mediaBody), '媒体链自动重试必须固定为 0');
}

function testModuleResponsibilityBoundaries() {
  const root = path.resolve(__dirname, '..');
  const lineCount = relative => fs.readFileSync(path.join(root, relative), 'utf8').split(/\r?\n/).length;
  assert(lineCount('src/services/newStoryAd/motionAwareEditService.js') <= 280, '运动分析应保持独立小模块，不能回灌主服务');
  assert(lineCount('src/services/newStoryAd/finalVideoQaService.js') <= 280, '最终 QA 应保持独立小模块，不能回灌主服务');
  assert(lineCount('src/services/newStoryAd/videoSubmissionGateService.js') <= 140, '范围、费用与提交门禁应保持独立小模块');
  assert(lineCount('src/services/newStoryAd/storyAdService.js') <= 3800, '剧情广告主服务不能继续堆叠跨职责实现');
  const storySource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyAdService.js'), 'utf8');
  assert(!storySource.includes('grayscale_mean_absolute_frame_difference'), '主服务不得重复实现母片运动分析');
  assert(!storySource.includes('ffprobe JSON'), '主服务不得重复实现最终媒体探测');
}

function testStep5RenderingPerformanceBoundaries() {
  const root = path.resolve(__dirname, '..');
  const legacy = fs.readFileSync(path.join(root, 'public/js/new-story-ad-legacy-ui.js'), 'utf8');
  const reviewModule = fs.readFileSync(path.join(root, 'public/js/new-story-ad/video-review.js'), 'utf8');
  const availabilityModule = fs.readFileSync(path.join(root, 'public/js/new-story-ad/video-unit-availability.js'), 'utf8');
  const renderMedia = legacy.slice(legacy.indexOf('function renderMedia()'), legacy.indexOf('function syncPersonSpecControls'));
  assert(reviewModule.split(/\r?\n/).length <= 360, '视频选择、费用与 P0 语义应保持在独立前端模块中');
  assert(availabilityModule.split(/\r?\n/).length <= 140, '生成单元阻断范围计算必须保持为独立小模块');
  assert(!legacy.includes('const P0_DIMENSIONS = new Set'), '旧主前端不得重复实现 P0 维度合同');
  assert(!legacy.includes('function selectionSummary('), '旧主前端不得重复实现生成单元费用选择逻辑');
  assert(renderMedia.includes('preload="metadata"'), 'Step 5 唯一最终成片播放器只预取 metadata');
  assert(reviewModule.includes('data-nsa-review-media=') && reviewModule.includes("video.preload = 'none'"), '母片与成员片段必须折叠后懒创建且默认不预加载');
  assert(reviewModule.includes("image.loading = 'lazy'"), '边界证据图片必须按需懒加载');
  assert(!/setInterval|fetch\(|api\(/.test(renderMedia), 'Step 5 渲染不能为每个成员镜头建立独立轮询或请求');
  assert.strictEqual((renderMedia.match(/videoGenerationUnits\(clips\)/g) || []).length, 1, '一次渲染只能投影一次 generation units');
  assert.strictEqual((renderMedia.match(/<div class="dh-nsa-video-unit-list"/g) || []).length, 1, 'Step 5 只能有一棵生成单元 DOM，不能同时重复逐镜与母片列表');
}

(async () => {
  try {
    testSelectiveRedoAndCostAuthorization();
    await testShortVoiceTrackCannotTruncateVisual();
    await testFinalQaFailureIsNotPersisted();
    testForceRegenerateAllIsNeverImplicit();
    testModuleResponsibilityBoundaries();
    testStep5RenderingPerformanceBoundaries();
    console.log('new story ad final QA and cost gates: ok');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
