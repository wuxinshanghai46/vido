#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ffmpegPath = require('ffmpeg-static');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-compose-transitions-'));
process.env.OUTPUT_DIR = tempDir;

const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const composeService = require('../src/services/newStoryAd/composeService');
const runFfmpeg = promisify(execFile);

(async () => {
  try {
    const first = path.join(tempDir, 'first.mp4');
    const second = path.join(tempDir, 'second.mp4');
    await runFfmpeg(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', first]);
    await runFfmpeg(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=2', '-vf', 'hue=h=45', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', second]);
    const result = await composeService.concatVideos({
      taskId: 'compose-transition-test',
      clips: [
        { shot_index: 0, file_path: first },
        { shot_index: 1, file_path: second },
      ],
      transitions: [
        { transition_type: 'none' },
        { transition_type: 'dissolve', transition_reason: 'authored test transition' },
      ],
    });
    assert.ok(fs.existsSync(result.file_path));
    assert.strictEqual(result.transition_plan[1].execution, 'dissolve');
    assert.strictEqual(result.transition_plan[1].overlap_sec, 0.35);
    assert.match(result.provider_used, /authored-transitions/);
    const duration = await videoAdapter.probeDuration(result.file_path);
    assert(duration > 3.45 && duration < 3.85, `dissolve should overlap the two clips, got ${duration}`);

    const fadeResult = await composeService.concatVideos({
      taskId: 'compose-fade-black-transition-test',
      clips: [
        { shot_index: 0, file_path: first },
        { shot_index: 1, file_path: second },
      ],
      transitions: [
        { transition_type: 'none' },
        { transition_type: 'fade', transition_reason: 'authored fade test transition' },
      ],
    });
    assert.ok(fs.existsSync(fadeResult.file_path));
    assert.strictEqual(fadeResult.transition_plan[1].execution, 'fade_black');

    const mixedFrameRateClips = [];
    const mixedSpecs = [[24, 1.042], [30, 1], [24, 1.042], [30, 1]];
    for (const [index, [fps, sourceDuration]] of mixedSpecs.entries()) {
      const filePath = path.join(tempDir, `mixed-${index + 1}-${fps}fps.mp4`);
      await runFfmpeg(ffmpegPath, ['-y', '-f', 'lavfi', '-i', `testsrc2=s=320x180:r=${fps}:d=${sourceDuration}`, '-vf', `hue=h=${index * 30}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', filePath]);
      mixedFrameRateClips.push({ shot_index: index, file_path: filePath });
    }
    const mixedSourceDurations = await Promise.all(mixedFrameRateClips.map(clip => videoAdapter.probeDuration(clip.file_path)));
    const mixedResult = await composeService.concatVideos({
      taskId: 'compose-mixed-frame-rate-transition-test',
      clips: mixedFrameRateClips,
      transitions: [
        { transition_type: 'none' },
        { transition_type: 'hard_cut' },
        { transition_type: 'hard_cut' },
        { transition_type: 'dissolve' },
      ],
    });
    assert.ok(fs.existsSync(mixedResult.file_path));
    assert.strictEqual(mixedResult.transition_plan[3].execution, 'dissolve');
    const mixedDuration = await videoAdapter.probeDuration(mixedResult.file_path);
    const expectedMixedDuration = mixedSourceDurations.reduce((sum, value) => sum + value, 0) - 0.35;
    assert(Math.abs(mixedDuration - expectedMixedDuration) < 0.2, `mixed 24/30 fps clips with hard cuts before dissolve must preserve the authored timeline, expected ${expectedMixedDuration}, got ${mixedDuration}`);

    const continuousPlan = composeService.buildTransitionPlan([
      { scene_block_id: 'one-source', scene_block_members: [1, 2] },
      { scene_block_id: 'one-source', scene_block_members: [1, 2] },
    ], [{}, { transition_type: 'fade' }], [2, 2]);
    assert.strictEqual(continuousPlan[1].execution, 'continuous_source_cut');
    assert.strictEqual(continuousPlan[1].overlap_sec, 0, 'segments from one continuous provider clip must not be blurred by another transition');
    const repairedPlan = composeService.buildTransitionPlan([
      { shot_index: 0 },
      { shot_index: 1, transition_override: 'fade' },
    ], [{}, { transition_type: 'hard_cut' }], [5, 5]);
    assert.strictEqual(repairedPlan[1].execution, 'fade_black', 'a deterministic repair transition must override the stale authored hard cut');

    const semanticPlan = composeService.buildTransitionPlan([
      { shot_index: 0 },
      { shot_index: 1 },
      { shot_index: 2 },
    ], [
      { transition_type: 'none' },
      {
        transition_type: 'cut_on_action',
        audio_bridge: '下一场景环境声提前进入',
        audio_bridge_duration_sec: 0.3,
      },
      {
        transition_type: 'match_cut',
        transition_match_anchor: '画面中心圆形轮廓',
      },
    ], [2, 2, 2]);
    assert.strictEqual(semanticPlan[1].execution, 'cut_on_action', 'cut-on-action must remain an executable semantic cut instead of collapsing to a generic cut');
    assert.strictEqual(semanticPlan[1].audio_bridge_execution, 'j_cut_crossfade');
    assert.strictEqual(semanticPlan[1].audio_overlap_sec, 0.3);
    assert.strictEqual(semanticPlan[2].execution, 'match_cut', 'match cut must remain explicit in the final plan');
    assert.strictEqual(semanticPlan[2].match_anchor, '画面中心圆形轮廓');
    assert.strictEqual(semanticPlan[2].verification_required, true);

    const audioBridgeResult = await composeService.concatVideos({
      taskId: 'compose-audio-bridge-test',
      clips: [
        { shot_index: 0, file_path: first },
        { shot_index: 1, file_path: second },
      ],
      transitions: [
        { transition_type: 'none' },
        {
          transition_type: 'cut_on_action',
          audio_bridge: '下一场景环境声提前进入',
          audio_bridge_duration_sec: 0.3,
        },
      ],
    });
    assert.ok(fs.existsSync(audioBridgeResult.file_path));
    assert.strictEqual(audioBridgeResult.transition_plan[1].execution, 'cut_on_action');
    assert.strictEqual(audioBridgeResult.audio_bridge_applied, true);
    assert.strictEqual(audioBridgeResult.audio_bridge_count, 1);
    assert.strictEqual(audioBridgeResult.technical_qa.audio_present, true, 'an authored audio bridge must create and verify a real final audio stream');
    console.log('new story ad compose transitions: ok');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
