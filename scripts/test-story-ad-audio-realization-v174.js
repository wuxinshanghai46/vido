#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');

function toneEnergy(samples, sampleRate, frequency) {
  let sin = 0; let cos = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const angle = 2 * Math.PI * frequency * index / sampleRate;
    sin += samples[index] * Math.sin(angle); cos += samples[index] * Math.cos(angle);
  }
  return Math.sqrt(sin * sin + cos * cos) / Math.max(1, samples.length);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-audio-v174-'));
  const source = path.join(dir, 'native-sfx.mp4');
  const voice = path.join(dir, 'dialogue.wav');
  const mixed = path.join(dir, 'mixed.mp4');
  const pcm = path.join(dir, 'mixed.pcm');
  try {
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x568:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2:sample_rate=44100', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2:sample_rate=44100', voice]);
    await videoAdapter.normalizeProviderClip({ inputPath: source, outputPath: mixed, audioPath: voice, durationSec: 2, aspectRatio: '9:16', resolution: '480p', qualityTier: 'draft' });
    const streams = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', mixed], { encoding: 'utf8' }).trim();
    assert.equal(streams, 'aac', '最终视频必须包含真实 AAC 混音轨');
    execFileSync(ffmpeg, ['-y', '-i', mixed, '-vn', '-ac', '1', '-ar', '44100', '-f', 's16le', pcm]);
    const raw = fs.readFileSync(pcm); const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
    const ambient = toneEnergy(samples, 44100, 440); const dialogue = toneEnergy(samples, 44100, 880);
    assert.ok(ambient > 120, `原生环境声/音效没有进入混音：${ambient}`);
    assert.ok(dialogue > 300, `对白音轨没有进入混音：${dialogue}`);
    console.log(JSON.stringify({ ok: true, checks: 4, native_audio_energy: Math.round(ambient), dialogue_energy: Math.round(dialogue), model_calls: 0 }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
