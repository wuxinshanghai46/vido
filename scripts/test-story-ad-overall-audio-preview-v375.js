#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-sound-v375-'));
process.env.OUTPUT_DIR = temporaryRoot;
process.env.NEW_STORY_AD_AUDIO_CACHE_DIR = path.join(temporaryRoot, 'data-disk-audio-cache');
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_MOCK_TTS = '1';

const storage = require('../src/services/newStoryAd/storageService');
const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');
const audioProduction = require('../src/services/newStoryAd/audioProductionService');
const soundDesign = require('../src/services/newStoryAd/soundDesignAssetService');
const mixPreview = require('../src/services/newStoryAd/audioMixPreviewService');
const recovery = require('../src/services/newStoryAd/legacyTtsFailureRecoveryService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');

async function main() {
  const taskId = 'sound-overall-preview-v375';
  const shots = Array.from({ length: 7 }, (_, index) => ({
    shot_id: `shot_${index + 1}`,
    shot_index: index + 1,
    duration_sec: 1,
    speech_mode: 'offscreen_voiceover',
    voiceover: `第${index + 1}段旁白`,
  }));
  storage.createTask({ id: taskId, request: {}, user_id: 'test-user' });
  storage.saveOutput(taskId, 'storyboard_table', shots);
  const generated = await ttsAdapter.generateVoiceover({ taskId, shots, voiceId: 'mock-voice', voiceAssignments: { narrator: 'mock-voice', speakers: {} }, concurrency: 3 });
  storage.saveOutput(taskId, 'tts_audio', generated);
  storage.saveOutput(taskId, 'final_video', { video_url: '/fixture-initial-final.mp4' });
  audioProduction.savePlan(taskId, { voice_id: 'mock-voice', voice_volume: 0.8, bgm_volume: 0.12 });
  await soundDesign.importOpenverseAsset(taskId, { openverse_id: 'vido_generated_ambient_music_v1', shot_index: 1, track_type: 'bgm' });

  const description = mixPreview.describe(taskId);
  assert.strictEqual(description.ready_voice_track_count, 7, '每个有声音的镜头必须匹配一条有效试听轨');
  assert.strictEqual(description.spoken_shot_count, 7, '整体配音必须覆盖七个有声音镜头');
  assert.strictEqual(description.bgm_selected, true, '整体试听必须只读取当前唯一背景音乐');
  assert.strictEqual(description.ready, true, '背景音乐和全部配音齐全后才能整体试听');
  const mixed = await mixPreview.create(taskId, { voice_volume: 0.8, bgm_volume: 0.12 });
  const mixedPath = mediaAdapter.assetPathFromName(decodeURIComponent(mixed.voice_audio_url.split('/').pop()));
  assert(fs.existsSync(mixedPath) && fs.statSync(mixedPath).size > 1000, '必须生成可播放且可独立调音量的配音时间轴轨');
  assert.strictEqual(mixed.live_mix, true, '整体试听必须返回浏览器实时双轨混音合同');
  assert(mixed.bgm_audio_url, '整体试听必须单独返回背景音乐轨');
  const cached = await mixPreview.create(taskId, { voice_volume: 1, bgm_volume: 0.3 });
  assert.strictEqual(cached.cached, true, '相同声音素材改变音量时必须复用配音时间轴轨，不能重新处理');
  assert.strictEqual(cached.voice_audio_url, mixed.voice_audio_url, '音量变化不得改变或销毁配音时间轴轨');
  assert(mixedPath.startsWith(mediaAdapter.AUDIO_CACHE_DIR), '声音试听缓存必须写入专用音频缓存目录');

  const legacyId = 'legacy-tts-person-failure-v375';
  storage.createTask({ id: legacyId, request: {}, user_id: 'test-user' });
  storage.updateTask(legacyId, { status: 'failed', stage: 'tts_failed', error: '人物参考尚未验证', error_code: 'PERSON_VERIFICATION_REQUIRED', support_id: 'legacy-support' });
  const legitimateVideoId = 'video-person-failure-v375';
  storage.createTask({ id: legitimateVideoId, request: {}, user_id: 'test-user' });
  storage.updateTask(legitimateVideoId, { status: 'failed', stage: 'video_failed', error: '人物参考尚未验证', error_code: 'PERSON_VERIFICATION_REQUIRED' });
  const recovered = recovery.recoverAll();
  assert.strictEqual(recovered.recovered, 1, '只迁移旧版错误归属的 TTS 人物失败');
  assert.deepStrictEqual({ model_calls: recovered.model_calls, paid_calls: recovered.paid_calls }, { model_calls: 0, paid_calls: 0 }, '历史状态迁移不得调用模型或产生费用');
  const legacyTask = storage.getTask(legacyId);
  assert.strictEqual(legacyTask.error_code, '', '历史无效人物错误必须从任务权威状态清除');
  assert.strictEqual(legacyTask.stage, 'storyboard_ready', '迁移后回到声音生成前的真实可继续阶段');
  assert(storage.getOutput(legacyId, recovery.RECOVERY_KIND)?.previous_error_code === 'PERSON_VERIFICATION_REQUIRED', '迁移必须保留可审计记录');
  assert.strictEqual(storage.getTask(legitimateVideoId).error_code, 'PERSON_VERIFICATION_REQUIRED', '视频阶段真实人物门禁不得被误清除');

  const root = path.resolve(__dirname, '..');
  const view = fs.readFileSync(path.join(root, 'public/story-ad/views/soundDesignFeature.js'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'public/story-ad/controllers/liveAudioPreviewController.js'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'src/routes/storyAdWorkspace.js'), 'utf8');
  assert.strictEqual((view.match(/data-voice-volume>/g) || []).length, 1, '配音音量只允许出现在整体试听区，不能在上方重复展示');
  assert(view.includes('data-overall-audio-preview') && view.includes('试听背景音乐 + 配音对白'), '声音页必须提供明确的整体混合试听入口');
  assert(view.includes('data-overall-voice-player') && view.includes('data-overall-bgm-player'), '整体试听必须使用可独立实时调音量的配音轨和背景音乐轨');
  assert(!`${view}\n${controller}`.includes('resetOverallPreview'), '拖动音量不得暂停并销毁正在播放的整体试听');
  assert(controller.includes("addEventListener('input', syncPreviewVolumes)"), '拖动两路音量必须即时同步到正在播放的播放器');
  assert(controller.includes('data-openverse-preview') && controller.includes('/sound-assets/openverse/prepare'), '试听候选背景音乐时必须并行预缓存，切换时直接复用');
  assert(view.includes('activeBgmAsset?.file_url') && view.includes('trackPreviewUrl'), '背景音乐和每镜配音都必须读取真实可播放 URL');
  assert(route.includes("/projects/:taskId/audio-mix-preview"), '必须存在受项目权限保护的整体试听接口');

  console.log(JSON.stringify({
    ok: true,
    per_shot_voice_tracks: description.ready_voice_track_count,
    selected_bgm_tracks: 1,
    voice_stem_bytes: fs.statSync(mixedPath).size,
    live_volume_tracks: 2,
    cache_reused: cached.cached,
    recovered_legacy_failures: recovered.recovered,
    preserved_video_person_failures: 1,
    model_calls: 0,
    paid_calls: 0,
  }));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});
