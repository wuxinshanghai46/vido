#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-timeline-render-v341-'));
const ffmpeg = require('ffmpeg-static');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const compose = require('../src/services/newStoryAd/composeService');

function fixture(name, color, frequency) {
  const output = path.join(process.env.OUTPUT_DIR, `${name}.mp4`);
  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:r=30:d=2`,
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=44100:duration=2`,
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', output,
  ], { stdio: 'ignore' });
  return output;
}

(async () => {
  try {
    const clips = [
      { file_path: fixture('clip-a', 'blue', 440), duration_sec: 2 },
      { file_path: fixture('clip-b', 'orange', 660), duration_sec: 2 },
    ];
    const result = await compose.concatVideos({
      taskId: 'timeline-render-v341',
      clips,
      timelineEdits: [
        { shot_index: 1, trim_start_sec: 0.2, trim_end_sec: 0.2, speed: 1.25, clip_volume: 0.5 },
        { shot_index: 2, trim_start_sec: 0.1, trim_end_sec: 0.1, speed: 0.9, muted: true },
      ],
      transitions: [
        { transition_type: 'hard_cut' },
        { transition_type: 'dissolve', transition_duration_sec: 0.3 },
      ],
      subtitleEnabled: false,
      soundTracks: [],
    });
    assert(fs.existsSync(result.file_path));
    assert.equal(result.technical_qa.pass, true);
    assert.equal(result.transition_plan[1].execution, 'dissolve');
    assert.equal(result.visual_input_count, 2);
    const duration = await videoAdapter.probeDuration(result.file_path);
    assert(duration > 2.5 && duration < 4.5, `unexpected edited duration ${duration}`);
    console.log(JSON.stringify({ passed: true, checks: 5, provider_calls: 0, output_exists: true, technical_qa: true, transition: 'dissolve', duration_sec: duration }));
  } finally {
    try { fs.rmSync(process.env.OUTPUT_DIR, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
