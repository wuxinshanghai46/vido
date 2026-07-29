const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-video-test-'));
process.env.OUTPUT_DIR = tempRoot;
process.env.NEW_STORY_AD_MOCK_LLM = '1';

const ffmpegPath = require('ffmpeg-static');
const service = require('../src/services/newStoryAd/referenceVideoAnalysisService');

async function waitFor(id, user, statuses, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = service.get(id, user);
    if (statuses.includes(row.status)) return row;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${statuses.join(',')}`);
}

async function main() {
  const user = { id: 'reference-video-test-user' };
  const input = path.join(tempRoot, 'input.mp4');
  execFileSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=720x1280:d=3:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    input,
  ], { windowsHide: true });
  const directInput = path.join(tempRoot, 'direct-input.mp4');
  fs.copyFileSync(input, directInput);

  const uploadSession = service.createUploadSession({
    body: {
      file_name: 'resumable-reference.mp4',
      size_bytes: fs.statSync(input).size,
      mimetype: 'video/mp4',
      last_modified: 123456,
      chunk_size: 1024 * 1024,
      rights_confirmed: 'true',
    },
    user,
  });
  const resumedSession = service.createUploadSession({
    body: {
      file_name: 'resumable-reference.mp4',
      size_bytes: fs.statSync(input).size,
      mimetype: 'video/mp4',
      last_modified: 123456,
      chunk_size: 1024 * 1024,
      rights_confirmed: 'true',
    },
    user,
  });
  assert.strictEqual(resumedSession.id, uploadSession.id);
  const chunkFile = path.join(tempRoot, 'chunk-0.part');
  fs.copyFileSync(input, chunkFile);
  const chunked = service.saveUploadChunk(uploadSession.id, 0, {
    path: chunkFile,
    size: fs.statSync(chunkFile).size,
  }, user);
  assert.deepStrictEqual(chunked.received_chunks, [0]);
  const completedUpload = await service.completeUploadSession(uploadSession.id, user);
  assert.strictEqual(completedUpload.session.status, 'completed');
  assert.ok(completedUpload.analysis.id);
  service.remove(completedUpload.analysis.id, user);

  const uploaded = await service.create({
    file: {
      path: directInput,
      originalname: 'reference.mp4',
      mimetype: 'video/mp4',
      size: fs.statSync(directInput).size,
    },
    body: { rights_confirmed: 'true' },
    user,
  });
  assert.strictEqual(uploaded.status, 'uploaded');
  assert.strictEqual(uploaded.identity_extraction_allowed, false);
  assert.ok(uploaded.source.metadata.duration_seconds >= 2.9);
  assert.strictEqual(uploaded.source.local_path, undefined, 'private video path must not leave the service');
  assert.throws(() => service._private.validateUpload(
    { originalname: 'too-long.mp4', size: 1024 },
    { width: 720, height: 1280, duration_seconds: 180.01 },
  ), /180 秒/);
  assert.throws(() => service._private.validateUpload(
    { originalname: 'wrong.avi', size: 1024 },
    { width: 720, height: 1280, duration_seconds: 10 },
  ), /MP4、MOV 或 WebM/);

  const started = service.start(uploaded.id, user);
  assert.strictEqual(started.accepted, true);
  const duplicate = service.start(uploaded.id, user);
  assert.strictEqual(duplicate.duplicate, true, 'start must be idempotent');

  const completed = await waitFor(uploaded.id, user, ['completed', 'failed']);
  assert.strictEqual(completed.status, 'completed', JSON.stringify(completed.error || {}));
  assert.strictEqual(completed.progress, 100);
  assert.ok(completed.checkpoints.length >= 5);
  assert.strictEqual(completed.downstream_generation_triggered, false);
  assert.strictEqual(completed.result.analysis_scope, 'creative_structure_only');
  assert.ok(completed.result.prohibited_reuse.includes('person_identity'));
  assert.ok(completed.result.camera_intents.length >= 2);
  assert.ok(completed.result.camera_intents.every(item => item.evidence_timestamps.length));
  assert.ok(completed.result.character_actions.every(item => item.start_pose && item.key_action && item.end_pose));
  assert.ok(completed.result.generated_brief.includes('运镜'));
  assert.strictEqual(completed.result.output_language, 'zh-CN');
  assert.ok(/[\u3400-\u9fff]{12}/.test(completed.result.generated_brief), 'generated brief must be readable Simplified Chinese');
  assert.strictEqual(completed.result.transcript.status, 'mocked');
  assert.ok(completed.result.transcript.segments.length >= 1);

  const localizedFallback = service._private.normalizeResult({
    summary: 'This advertisement presents an efficient workflow solution.',
    generated_brief: 'The video demonstrates innovative digital tools for modern workplaces.',
    plot_beats: [
      { order: 1, range: [0, 3.77], purpose: 'establish the problem', rhythm: 'steady' },
    ],
    camera_intents: [
      {
        range: [0, 3.77],
        movement: 'slow_push_in',
        start_shot_size: 'wide',
        end_shot_size: 'medium_close_up',
        angle: 'eye_level',
        lens_estimate_mm: 35,
      },
    ],
    character_actions: [
      { start_pose: 'standing', key_action: 'checks a smartphone', end_pose: 'holds center' },
    ],
  });
  assert.strictEqual(localizedFallback.output_language, 'zh-CN');
  assert.ok(localizedFallback.generated_brief.includes('【广告目标】'));
  assert.ok(localizedFallback.generated_brief.includes('【运镜与节奏】'));
  assert.ok(!localizedFallback.generated_brief.includes('This advertisement'));
  assert.ok(!localizedFallback.generated_brief.includes('The video demonstrates'));

  const mapping = service.mapSceneViews(uploaded.id, user, [
    { view_key: 'master', image_url: '/master.png' },
    { view_key: 'interaction', image_url: '/interaction.png' },
    { view_key: 'detail', image_url: '/detail.png' },
  ]);
  assert.strictEqual(mapping.status, 'mapped');
  assert.ok(mapping.mappings.every(item => item.feasible && item.mapped_view));

  assert.throws(() => service.get(uploaded.id, { id: 'other-user' }), /不存在|无权/);
  const deleted = service.remove(uploaded.id, user);
  assert.strictEqual(deleted.deleted, true);

  console.log(JSON.stringify({
    passed: true,
    checks: 36,
    evidence_frames: completed.result.evidence_frames.length,
    camera_intents: completed.result.camera_intents.length,
    scene_mappings: mapping.mappings.length,
    private_source_path_exposed: false,
    downstream_generation_triggered: false,
  }));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    const resolved = path.resolve(tempRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  });
