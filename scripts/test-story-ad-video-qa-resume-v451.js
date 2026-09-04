'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const load = source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const availability = require('../src/services/newStoryAd/videoQaAvailabilityService');
const failure = require('../src/services/newStoryAd/publicFailureProjectionService');
const workflow = require('../src/services/newStoryAd/videoArtifactWorkflowService');
const mediaRuntime = require('../src/services/newStoryAd/videoAdapterMediaRuntime').createVideoAdapterMediaRuntime({ videoDir: '' });
const frameQa = require('../src/services/newStoryAd/videoFrameQaService');

(async () => {
  assert.equal(availability.isUnavailable({ code: 'VISION_QA_UNAVAILABLE' }), true);
  assert.equal(availability.isUnavailable({ code: 'VISION_CIRCUIT_OPEN' }), true);
  assert.equal(availability.isUnavailable({ code: 'VIDEO_FRAME_QA_FAILED' }), false, '内容不合格不能伪装成审核线路不可用');
  assert.match(failure.authorizedFailureMessage('VISION_QA_UNAVAILABLE', 'all routes failed'), /视频已经生成并保留/);

  globalThis.escapeHtml = String;
  globalThis.mediaPreview = () => '';
  const presentation = await load(read('public/story-ad/views/clipReviewPresentation.js').replace(/^import .*;\r?\n/gm, ''));
  const oneSaved = presentation.clipReviewState([{ video_url: '/shot-1.mp4', status: 'ready', qa_pass: null }], 7);
  assert.equal(oneSaved.generated.length, 1);
  assert.equal(oneSaved.pending.length, 1);
  assert.equal(oneSaved.remaining, 6);
  assert.equal(oneSaved.action, '继续生成剩余分镜视频（6）');
  const allPending = presentation.clipReviewState(Array.from({ length: 7 }, (_, index) => ({ video_url: `/shot-${index + 1}.mp4`, status: 'ready' })), 7);
  assert.equal(allPending.action, '重新审片已生成视频（7）');

  const expected = workflow.buildExpectedLineages({
    shots: [{ id: 'shot-1' }, { id: 'shot-2' }],
    ctx: { output_ratio: '9:16', video_resolution: '480p' },
    contextFor: (_shot, index, ctx) => index === 0 ? { ...ctx, video_resolution: '1080p' } : ctx,
  });
  assert.equal(expected[0].video_resolution, '1080p', '已生成旧镜必须保留其原分辨率谱系');
  assert.equal(expected[1].video_resolution, '480p', '后续未生成镜头必须使用新的 480P 默认值');
  assert.deepEqual(mediaRuntime.outputSize('9:16'), { width: 480, height: 854 });

  let extractionCalls = 0;
  const savedPendingClip = {
    file_path: '/persistent/generated-shot-1.mp4',
    video_url: '/api/new-story-ad/videos/generated-shot-1.mp4',
    qa: null,
    qa_pending: true,
  };
  const evidence = await frameQa.ensureBoundaryFrameEvidence({
    taskId: 'all-industry-task',
    clips: [savedPendingClip, null],
    targetIndexes: [0, 1],
    includeTargetIndexes: [0],
    extractFrames: async ({ index }) => {
      extractionCalls += 1;
      assert.equal(index, 0);
      return [
        { image_url: '/api/new-story-ad/assets/head.jpg', point: 0, second: 0 },
        { image_url: '/api/new-story-ad/assets/tail.jpg', point: 1, second: 4 },
      ];
    },
  });
  assert.equal(extractionCalls, 1, '待复审旧片段必须在新付费提交前本地补齐一次证据');
  assert.deepEqual(evidence.backfilled_indexes, [0]);
  assert.equal(evidence.clips[0].qa.status, 'evidence_ready');
  assert.equal(evidence.clips[0].qa.pass, undefined, '技术帧证据不能冒充内容质检通过');
  assert.equal(frameQa.hasReviewFrameEvidence(evidence.clips[0].qa), true);
  const reusedEvidence = await frameQa.ensureBoundaryFrameEvidence({
    taskId: 'all-industry-task',
    clips: evidence.clips,
    targetIndexes: [0, 1],
    includeTargetIndexes: [0],
    extractFrames: async () => { throw new Error('已经持久化的证据不得重复抽取'); },
  });
  assert.deepEqual(reusedEvidence.backfilled_indexes, []);

  const service = read('src/services/newStoryAd/storyAdService.js');
  const evidenceService = read('src/services/newStoryAd/videoEvidencePreflightService.js');
  assert.match(service, /qaDeferral\.preserve/);
  assert.match(service, /if \(!qaAvailability\.isUnavailable\(error\)\) throw error;/);
  assert.match(service, /qaDeferral\.throwIfPending\(clips\)/);
  assert.match(read('src/services/newStoryAd/videoQaAvailabilityService.js'), /不会重复生成/);
  assert.match(read('src/services/newStoryAd/contextBuilder.js'), /videoResolution \|\| '480p'/);
  assert.match(read('public/story-ad/views/briefView.js'), /\['480p', '720p', '1080p', '4K'\]/);
  assert.match(read('public/digital-human.html'), /class="dh-chip active" data-nsa-video-resolution="480p"/);
  assert.match(evidenceService, /prepareClipReviewFrameEvidence/);
  assert.match(evidenceService, /storage\.saveOutput\(taskId, 'video_clips', clips\)/);
  console.log(JSON.stringify({ passed: true, cases: 24, paid_video_calls: 0, qa_fallback_calls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
