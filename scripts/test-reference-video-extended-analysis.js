'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-extended-'));
process.env.OUTPUT_DIR = tempRoot;
process.env.NEW_STORY_AD_MOCK_LLM = '1';

const service = require('../src/services/newStoryAd/referenceVideoAnalysisService');

async function main() {
  const user = { id: 'extended-analysis-test-user' };
  const id = 'ref_video_extended_42_segments';
  const dir = service._private.analysisDir(user.id, id);
  fs.mkdirSync(dir, { recursive: true });
  const sourcePath = path.join(dir, 'source.mp4');
  execFileSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=1:d=42',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath,
  ], { windowsHide: true, timeout: 60000 });

  const cuts = Array.from({ length: 41 }, (_, index) => index + 1);
  const evidencePlan = service._private.buildShotAwareEvidencePlan(42, cuts);
  const base = {
    id,
    user_id: user.id,
    task_id: '',
    status: 'failed',
    phase: '等待确认扩展分析',
    progress: 24,
    cancelled: false,
    rights_confirmed: true,
    source: {
      kind: 'upload',
      original_name: '42-segments.mp4',
      local_path: sourcePath,
      private_directory: dir,
      size_bytes: fs.statSync(sourcePath).size,
      metadata: {
        duration_seconds: 42,
        size_bytes: fs.statSync(sourcePath).size,
        format: 'mp4',
        video_codec: 'h264',
        width: 160,
        height: 90,
        fps: '1/1',
        has_audio: false,
        audio_codec: '',
      },
    },
    shot_detection: { cuts },
    evidence_plan: evidencePlan,
    checkpoints: [],
    result: null,
    error: {
      code: 'REFERENCE_VIDEO_EXTENDED_ANALYSIS_CONFIRMATION_REQUIRED',
      message: '等待用户确认分批分析',
      retryable: false,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  base.analysis_preflight = service._private.evidencePreflight(base, base.shot_detection, evidencePlan);
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify(base, null, 2));

  assert.throws(
    () => service.start(id, user, {
      extendedAnalysisConfirmed: true,
      preflightFingerprint: 'stale-fingerprint',
    }),
    error => error.code === 'REFERENCE_VIDEO_PREFLIGHT_CONFIRMATION_STALE',
    '过期或伪造的预检指纹必须在启动前被拒绝',
  );

  const started = service.start(id, user, {
    extendedAnalysisConfirmed: true,
    preflightFingerprint: base.analysis_preflight.fingerprint,
  });
  assert.equal(started.accepted, true);
  await service._private.activeRuns.get(id);
  const completed = service.get(id, user);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.analysis_preflight.confirmed, true);
  assert.equal(completed.analysis_preflight.segment_count, 42);
  assert.equal(completed.analysis_preflight.batch_count, 11);
  assert.equal(completed.evidence_frames.length, 42, '42 个片段必须全部提取，不能静默丢帧');
  assert.equal(completed.result.evidence_coverage.expected_frame_count, 42);
  assert.equal(completed.result.evidence_coverage.covered_frame_count, 42);
  assert.equal(completed.transcript.status, 'no_audio');
  console.log(JSON.stringify({ passed: true, segments: 42, frames: 42, batches: 11, transcript: 'no_audio' }));
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(() => {
  const resolved = path.resolve(tempRoot);
  const expectedRoot = path.resolve(os.tmpdir());
  if (resolved.startsWith(`${expectedRoot}${path.sep}`) && path.basename(resolved).startsWith('vido-reference-extended-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
