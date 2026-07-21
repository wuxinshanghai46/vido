const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const cancellation = require('./cancellationContext');

const POLICY_VERSION = 'final-video-technical-qa-v1';

function run(binary, args, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    const signal = cancellation.signal();
    let stdout = '';
    let stderr = '';
    const abort = () => child.kill('SIGKILL');
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(signal.reason || new Error('Final video QA aborted'));
      return resolve({ code, stdout, stderr });
    });
  });
}

async function probe(filePath) {
  const result = await run(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath], 30000);
  if (result.code !== 0) throw new Error(result.stderr || 'ffprobe failed');
  return JSON.parse(result.stdout || '{}');
}

function parseIntervals(stderr = '', prefix = '') {
  const starts = [...stderr.matchAll(new RegExp(`${prefix}_start:([0-9.]+)`, 'g'))].map(match => Number(match[1]));
  const ends = [...stderr.matchAll(new RegExp(`${prefix}_end:([0-9.]+)`, 'g'))].map(match => Number(match[1]));
  return starts.map((start, index) => ({
    start_sec: start,
    end_sec: Number.isFinite(ends[index]) ? ends[index] : start,
    duration_sec: Number(Math.max(0, (ends[index] || start) - start).toFixed(3)),
  }));
}

function transitionBoundaries(plan = [], durations = []) {
  let cursor = Number(durations[0] || 0);
  const boundaries = [];
  for (let index = 1; index < durations.length; index += 1) {
    const row = plan[index] || {};
    boundaries.push({ second: cursor - Number(row.overlap_sec || 0), execution: row.execution || 'cut', index });
    cursor += Number(durations[index] || 0) - Number(row.overlap_sec || 0);
  }
  return boundaries;
}

async function inspectFinalVideo({ filePath = '', expectedDurationSec = 0, requireAudio = false, transitionPlan = [], inputDurations = [] } = {}) {
  const problems = [];
  if (!filePath || !fs.existsSync(filePath)) {
    return { pass: false, policy_version: POLICY_VERSION, error_code: 'FINAL_VIDEO_FILE_MISSING', problems: ['Final video file is missing.'] };
  }
  let metadata;
  try {
    metadata = await probe(filePath);
  } catch (error) {
    return { pass: false, policy_version: POLICY_VERSION, error_code: 'FINAL_VIDEO_PROBE_FAILED', problems: [String(error.message || error)] };
  }
  const videoStream = (metadata.streams || []).find(stream => stream.codec_type === 'video');
  const audioStream = (metadata.streams || []).find(stream => stream.codec_type === 'audio');
  const duration = Number(metadata.format?.duration || videoStream?.duration || 0);
  if (!videoStream) problems.push('Final output has no decodable video stream.');
  const tolerance = Math.max(0.5, Number(expectedDurationSec || duration) * 0.03);
  if (expectedDurationSec > 0 && Math.abs(duration - expectedDurationSec) > tolerance) {
    problems.push(`Final duration ${duration.toFixed(3)}s differs from expected ${Number(expectedDurationSec).toFixed(3)}s.`);
  }
  if (requireAudio && !audioStream) problems.push('Final output is missing its required audio stream.');
  const audioDuration = Number(audioStream?.duration || metadata.format?.duration || 0);
  if (requireAudio && audioStream && Math.abs(audioDuration - duration) > tolerance) {
    problems.push(`Audio duration ${audioDuration.toFixed(3)}s does not cover the full visual duration ${duration.toFixed(3)}s.`);
  }
  const decode = videoStream
    ? await run(ffmpegPath, ['-v', 'info', '-i', filePath, '-an', '-vf', 'blackdetect=d=0.20:pix_th=0.10,freezedetect=n=-50dB:d=0.80', '-f', 'null', '-'], 360000)
    : { code: 1, stderr: 'video stream missing' };
  if (decode.code !== 0) problems.push('Final output failed full-stream decode.');
  const blackIntervals = parseIntervals(decode.stderr, 'black');
  const freezeIntervals = parseIntervals(decode.stderr, 'freeze');
  const boundaries = transitionBoundaries(transitionPlan, inputDurations);
  const unexpectedBoundaryBlack = boundaries.filter(boundary => boundary.execution !== 'fade_black'
    && blackIntervals.some(interval => interval.start_sec <= boundary.second + 0.2 && interval.end_sec >= boundary.second - 0.2));
  if (unexpectedBoundaryBlack.length) problems.push('Unexpected black frames were detected at a non-fade transition boundary.');
  if (blackIntervals.some(interval => interval.duration_sec > 1)) problems.push('A blocking black-frame interval longer than 1 second was detected.');
  const freezeLimit = Math.max(2, duration * 0.4);
  if (freezeIntervals.some(interval => interval.duration_sec > freezeLimit)) problems.push('A blocking freeze/duplicate-frame interval was detected.');
  return {
    pass: problems.length === 0,
    policy_version: POLICY_VERSION,
    error_code: problems.length ? 'FINAL_VIDEO_TECHNICAL_QA_FAILED' : '',
    duration_sec: duration,
    expected_duration_sec: Number(expectedDurationSec || 0),
    video_codec: videoStream?.codec_name || '',
    audio_codec: audioStream?.codec_name || '',
    audio_present: !!audioStream,
    audio_duration_sec: audioDuration,
    decode_pass: decode.code === 0,
    black_intervals: blackIntervals,
    freeze_intervals: freezeIntervals,
    transition_boundaries: boundaries,
    problems,
    checked_at: new Date().toISOString(),
  };
}

module.exports = { POLICY_VERSION, inspectFinalVideo, transitionBoundaries, parseIntervals };
