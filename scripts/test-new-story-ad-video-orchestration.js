#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-video-orchestration-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_VIDEO_GLOBAL_CONCURRENCY = '4';

const scheduler = require('../src/services/newStoryAd/videoParallelScheduler');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');
const storage = require('../src/services/newStoryAd/storageService');
const storyService = require('../src/services/newStoryAd/storyAdService');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testAdaptiveDependencyAwareConcurrency() {
  const dependencies = { 0: null, 1: 0, 2: null, 3: null, 4: null, 5: null };
  const events = [];
  let active = 0;
  let peak = 0;
  const schedule = await scheduler.runSchedule({
    indexes: [0, 1, 2, 3, 4, 5],
    dependencyOf: index => dependencies[index],
    options: { video_concurrency: 2, video_max_concurrency: 4, adaptive_video_concurrency: true },
    worker: async index => {
      events.push(`start:${index}`);
      active += 1;
      peak = Math.max(peak, active);
      await delay(index === 0 ? 15 : 8);
      active -= 1;
      events.push(`end:${index}`);
      return { index };
    },
  });
  assert.strictEqual(schedule.configured_concurrency, 2);
  assert.strictEqual(schedule.max_concurrency, 4);
  assert(peak >= 2 && peak <= 4);
  assert(events.indexOf('start:1') > events.indexOf('end:0'), '连续镜头必须等待前镜完成');
  assert.deepStrictEqual(schedule.waves[0].indexes, [0, 2]);
  assert(schedule.waves.some(wave => wave.concurrency >= 3), '成功波次后应自适应提高并发');
}

async function testThrottleDowngrade() {
  const calls = new Map();
  const schedule = await scheduler.runSchedule({
    indexes: [0, 1],
    options: { video_concurrency: 2, video_max_concurrency: 4, adaptive_video_concurrency: false },
    worker: async index => {
      calls.set(index, (calls.get(index) || 0) + 1);
      if (index === 0 && calls.get(index) === 1) {
        const error = new Error('HTTP 429 rate limit');
        error.code = 'RATE_LIMIT';
        throw error;
      }
      return { index };
    },
  });
  assert.strictEqual(calls.get(0), 2, '限流镜头只允许串行重试一次');
  assert.strictEqual(calls.get(1), 1);
  assert.strictEqual(schedule.effective_concurrency, 1, '限流后必须降为串行');
  assert.strictEqual(schedule.throttle_retries['0'], 1);
}

function testUniversalNonSpeakingDefault() {
  const defaultPrompt = videoAdapter.clipPrompt(
    { visual: '人物展示当前任务主体', action: '自然转身', voiceover: '这里是画外旁白。' },
    { product_subject: '任意任务主体' },
    {},
  );
  assert(defaultPrompt.includes('off-screen voiceover'));
  assert(defaultPrompt.includes('do not speak or lip-sync'));
  assert.strictEqual(ttsAdapter.shotSpeechText({
    voiceover: '画外旁白内容',
    dialogue_lines: [{ speaker: '演员甲', line: '不应重复进入默认旁白' }],
  }), '画外旁白内容');
  assert.strictEqual(ttsAdapter.shotSpeechText({ speech_mode: 'silent', voiceover: '不应发声' }), '');
  const speakingPrompt = videoAdapter.clipPrompt(
    { visual: '人物面对镜头', speech_mode: 'on_camera_dialogue', dialogue_lines: [{ speaker: '演员甲', line: '明确讲话' }] },
    {},
    {},
  );
  assert(speakingPrompt.includes('explicitly authored on-camera dialogue'));
}

function testPersistedShotMonitor() {
  storage.createTask({ id: 'monitor-task', title: '通用监控测试', user_id: 'user-a', request: {} });
  storage.updateTask('monitor-task', {
    active_generation_id: 'video-generation-current', active_stage: 'media',
    generation_started_at: '2026-07-16T08:00:00.000Z',
    generation_progress: { stage: 'keyframes', generation_id: 'keyframe-generation-old', processed: 2 },
  });
  videoAdapter.updateVideoShotStatus('monitor-task', 0, {
    lifecycle: 'provider_submitted',
    total_shots: 2,
    provider_id: 'deyunai',
    model_id: 'doubao-seedance-2-0-260128',
    provider_task_id: 'provider-task-1',
  }, 2);
  videoAdapter.updateVideoShotStatus('monitor-task', 0, {
    lifecycle: 'qa_passed',
    file_path: path.join(tempDir, 'shot-1.mp4'),
    file_exists: true,
  }, 2);
  const rows = videoAdapter.listVideoShotStatuses('monitor-task', 2);
  assert.strictEqual(rows[0].provider_task_id, 'provider-task-1');
  assert.strictEqual(rows[0].lifecycle, 'qa_passed');
  assert.strictEqual(rows[0].health, 'passed');
  const task = storage.getTask('monitor-task');
  assert.strictEqual(task.generation_progress.total, 2);
  assert.strictEqual(task.generation_progress.qa_passed, 1);
  assert.strictEqual(task.generation_progress.stage, 'video');
  assert.strictEqual(task.generation_progress.generation_id, 'video-generation-current', '视频进度必须绑定本次后台生成，不能继承旧关键帧任务 ID');
  assert.strictEqual(task.generation_progress.started_at, '2026-07-16T08:00:00.000Z');
}

function testManualVideoAcceptanceDoesNotGenerate() {
  const taskId = 'manual-video-accept-task';
  const clipPath = path.join(tempDir, 'manual-accept.mp4');
  fs.writeFileSync(clipPath, 'existing paid video');
  storage.createTask({ id: taskId, title: '人工接受视频测试', user_id: 'user-a', request: {} });
  storage.saveOutput(taskId, 'storyboard_table', [{ index: 1, title: '镜头 1' }]);
  storage.saveOutput(taskId, 'video_clips', [{
    shot_index: 0,
    file_path: clipPath,
    video_url: '/existing.mp4',
    lineage_fingerprint: 'current-lineage',
    qa: { pass: false, problems: ['visible seam'] },
    error: '视频抽帧 QA 未通过',
    error_code: 'VIDEO_FRAME_QA_FAILED',
  }]);
  const result = storyService.acceptVideoClipOverride(taskId, 0, { reason: '用户确认接受' }, { id: 'user-a' });
  assert.strictEqual(result.video_clip.qa.pass, true);
  assert.strictEqual(result.video_clip.qa.manual_override, true);
  assert.strictEqual(result.video_clip.manual_acceptance.approved, true);
  assert.strictEqual(storage.getTask(taskId).stage, 'video_ready');
}

(async () => {
  try {
    await testAdaptiveDependencyAwareConcurrency();
    await testThrottleDowngrade();
    testUniversalNonSpeakingDefault();
    testPersistedShotMonitor();
    testManualVideoAcceptanceDoesNotGenerate();
    console.log('new story ad video orchestration: ok');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
