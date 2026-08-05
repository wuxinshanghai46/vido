#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const isolatedOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-longform-compose-'));
process.env.OUTPUT_DIR = isolatedOutputDir;
process.env.DB_ENABLED = 'false';

const ffmpegPath = require('ffmpeg-static');
const compose = require('../src/services/newStoryAd/composeService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const finalVideoQa = require('../src/services/newStoryAd/finalVideoQaService');

async function main() {
  fs.mkdirSync(compose.COMPOSE_DIR, { recursive: true });
  const source = path.join(isolatedOutputDir, 'six-second-source.mp4');
  const generated = spawnSync(ffmpegPath, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=5:duration=6',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', source,
  ], { encoding: 'utf8', timeout: 120000 });
  assert.equal(generated.status, 0, generated.stderr);

  const inputs = Array.from({ length: 100 }, () => source);
  const durations = Array.from({ length: 100 }, () => 6);
  const plan = durations.map((_, index) => ({
    first_shot_index: index + 1,
    execution: 'hard_cut',
    overlap_sec: 0,
    audio_bridge_execution: 'none',
    audio_overlap_sec: 0,
  }));
  assert.equal(compose.transitionTimelineDuration(durations, plan), 600);
  for (const rate of [0.1, 0.4, 1, 2.4, 6]) {
    const factors = compose.audioTempoFilter(rate).split(',').map(item => Number(item.split('=')[1]));
    assert.ok(factors.every(value => value >= 0.5 && value <= 2));
  }

  const output = path.join(compose.COMPOSE_DIR, 'longform-600s.mp4');
  const result = await compose.composeTransitionHierarchy(inputs, output, plan, durations, {
    taskId: 'duration-contract',
    groupSize: 12,
  });
  assert.ok(result.levels >= 2, '100镜必须经过分层合成，不能进入单个100输入filter_complex');
  const actualDuration = await videoAdapter.probeDuration(output);
  assert.ok(Math.abs(actualDuration - 600) <= 0.5, `expected 600s, received ${actualDuration}s`);
  const qa = await finalVideoQa.inspectFinalVideo({
    filePath: output,
    expectedDurationSec: 600,
    requireAudio: true,
    transitionPlan: plan,
    inputDurations: durations,
  });
  assert.equal(qa.pass, true, JSON.stringify(qa.problems));
  assert.equal(qa.decode_pass, true);
  console.log(JSON.stringify({ passed: true, shots: 100, layers: result.levels, duration_sec: actualDuration, qa: qa.pass }));
}

main()
  .finally(() => fs.rmSync(isolatedOutputDir, { recursive: true, force: true }))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
