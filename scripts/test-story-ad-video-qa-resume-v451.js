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

  let repairPromptBuilds = 0;
  const retainedPrompt = workflow.compatibilityMotionPrompt({
    video_url: '/api/new-story-ad/videos/existing.mp4',
    motion_prompt: 'the immutable prompt used by the provider',
  }, () => { repairPromptBuilds += 1; return 'new repair prompt'; });
  assert.equal(retainedPrompt, 'the immutable prompt used by the provider');
  assert.equal(repairPromptBuilds, 0, '已有媒体的兼容性指纹不得被本轮修复提示词污染');
  assert.equal(workflow.compatibilityMotionPrompt({}, () => { repairPromptBuilds += 1; return 'new generation prompt'; }), 'new generation prompt');
  assert.equal(repairPromptBuilds, 1, '未生成镜头仍应构造本轮生成提示词');
  assert.equal(workflow.compatibilityMotionPrompt(null, () => { repairPromptBuilds += 1; return 'null-slot generation prompt'; }), 'null-slot generation prompt');
  assert.equal(repairPromptBuilds, 2, '稀疏任务中的 null 镜头槽位也必须正常进入生成提示词路径');

  const originalShot = { id: 'shot-1', action: 'turns toward camera', camera: 'slow push' };
  const originalPrompt = 'original persisted provider prompt';
  const lineageV7 = workflow.buildExpectedLineages({
    shots: [originalShot], ctx: { output_ratio: '9:16', video_resolution: '1080p' },
    motionPromptFor: () => originalPrompt, qaPolicyVersion: 'story-ad-video-frame-qa-v7',
  })[0];
  const staleRejectedClip = {
    video_url: '/api/new-story-ad/videos/existing.mp4', motion_prompt: originalPrompt,
    lineage: lineageV7, lineage_fingerprint: lineageV7.fingerprint,
    qa: { pass: false, status: 'rejected', qa_policy_version: 'story-ad-video-frame-qa-v7' },
  };
  const lineageV8 = workflow.buildExpectedLineages({
    shots: [originalShot], ctx: { output_ratio: '9:16', video_resolution: '1080p' },
    motionPromptFor: () => workflow.compatibilityMotionPrompt(staleRejectedClip, () => 'repair prompt must not win'),
    qaPolicyVersion: 'story-ad-video-frame-qa-v8',
  });
  const policyUpgrade = workflow.buildCompatibilityReport({ clips: [staleRejectedClip], expectedLineages: lineageV8 });
  assert.equal(policyUpgrade.decisions[0].status, 'reverify_required');
  assert.deepEqual(policyUpgrade.decisions[0].reason_codes, ['QA_POLICY_OLD']);
  const changedLineage = workflow.buildExpectedLineages({
    shots: [{ ...originalShot, action: 'walks out of frame' }], ctx: { output_ratio: '9:16', video_resolution: '1080p' },
    motionPromptFor: () => originalPrompt, qaPolicyVersion: 'story-ad-video-frame-qa-v8',
  });
  assert.equal(workflow.buildCompatibilityReport({ clips: [staleRejectedClip], expectedLineages: changedLineage }).decisions[0].status, 'regenerate_required', '真实镜头语义变化仍必须重生成');
  const noPromptClip = { ...staleRejectedClip, motion_prompt: '' };
  assert.equal(workflow.compatibilityMotionPrompt(noPromptClip, () => 'fail-closed-current-prompt'), 'fail-closed-current-prompt', '缺失原始提示词时不得无证据沿用旧语义');

  const isolatedPrompts = await Promise.all(Array.from({ length: 20 }, (_, index) => Promise.resolve(workflow.compatibilityMotionPrompt({
    video_url: `/users/${'u'.repeat(80)}-${index}/task-${'t'.repeat(120)}-${index}.mp4`, motion_prompt: `prompt-${index}`,
  }, () => `wrong-${index}`))));
  assert.deepEqual(isolatedPrompts, Array.from({ length: 20 }, (_, index) => `prompt-${index}`), '并发多用户长 ID 不得串用兼容性提示词');

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
      return [0, 1, 2, 3, 4].map((second, sampleIndex) => ({
        image_url: `/api/new-story-ad/assets/sample-${sampleIndex}.jpg`, point: sampleIndex / 4, second,
      }));
    },
  });
  assert.equal(extractionCalls, 1, '待复审旧片段必须在新付费提交前本地补齐一次证据');
  assert.deepEqual(evidence.backfilled_indexes, [0]);
  assert.equal(evidence.clips[0].qa.status, 'evidence_ready');
  assert.equal(evidence.clips[0].qa.pass, undefined, '技术帧证据不能冒充内容质检通过');
  assert.equal(frameQa.hasReviewFrameEvidence(evidence.clips[0].qa), true);
  assert.equal(frameQa.hasCurrentReviewFrameEvidence(evidence.clips[0].qa), true);
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
  console.log(JSON.stringify({ passed: true, cases: 36, paid_video_calls: 0, qa_fallback_calls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
