const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-paid-execution-gate-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const express = require('express');
const paidExecutionPolicy = require('../src/services/newStoryAd/paidVideoExecutionPolicyService');
const scheduler = require('../src/services/newStoryAd/videoParallelScheduler');
const service = require('../src/services/newStoryAd');
const storage = require('../src/services/newStoryAd/storageService');
const jobService = require('../src/services/newStoryAd/jobService');
const mediaPipeline = require('../src/services/newStoryAd/mediaPipelineService');
const generationPermit = require('../src/services/newStoryAd/generationPermitService');
const mediaModelSelection = require('../src/services/newStoryAd/mediaGenerationModelSelectionService');

const DANGEROUS_KEYS = paidExecutionPolicy.EXTERNAL_BOOLEAN_CONTROLS;
const FORBIDDEN_HTTP_CASES = [
  ...paidExecutionPolicy.EXTERNAL_BOOLEAN_CONTROLS.map(key => ({ key, value: true })),
  ...paidExecutionPolicy.EXTERNAL_CONCURRENCY_CONTROLS.map(key => ({ key, value: 2 })),
  ...paidExecutionPolicy.SERVER_OWNED_CONTROLS.map(key => ({ key, value: 'client-forged-value' })),
];

function requestJson(port, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body || {}));
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
      },
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function assertCanonicalPaidOptions(input = {}) {
  const canonical = paidExecutionPolicy.canonicalize(input);
  DANGEROUS_KEYS.forEach((key) => {
    assert.notStrictEqual(canonical[key], true, `${key} 不得在付费执行中保持开启`);
  });
  assert.strictEqual(canonical._paidExecution, true);
  assert.strictEqual(canonical.video_concurrency, 1);
  assert.strictEqual(canonical.video_max_concurrency, 1);
  paidExecutionPolicy.SERVER_OWNED_CONTROLS.forEach(key => assert.strictEqual(canonical[key], undefined));
  assert.strictEqual(canonical.only_indexes, input.only_indexes);
  assert.strictEqual(canonical.video_preflight_fingerprint, input.video_preflight_fingerprint);
  return canonical;
}

async function testPolicyAndScheduler() {
  for (const { key, value } of FORBIDDEN_HTTP_CASES) {
    assert.throws(
      () => paidExecutionPolicy.assertExternalRequest({ [key]: value }),
      error => error.code === 'VIDEO_PAID_EXECUTION_OPTION_FORBIDDEN' && error.status === 422,
      `${key} 必须在 HTTP 入队前被拒绝`,
    );
  }

  const canonical = assertCanonicalPaidOptions({
    continue_after_unit_failure: true,
    continueAfterUnitFailure: true,
    allow_throttle_retry: true,
    allowThrottleRetry: true,
    allow_local_fallback: true,
    allowLocalFallback: true,
    allow_video_model_fallback: true,
    allowVideoModelFallback: true,
    parallel_videos: true,
    parallelVideos: true,
    usd_cny_rate: 1,
    provider_capability_registry: { forged: true },
    only_indexes: [2],
    video_preflight_fingerprint: 'preflight-current',
  });

  let providerCalls = 0;
  await assert.rejects(() => scheduler.runSchedule({
    indexes: [0],
    options: canonical,
    worker: async () => {
      providerCalls += 1;
      const error = new Error('HTTP 429 rate limit');
      error.code = 'RATE_LIMIT';
      throw error;
    },
  }), error => error.code === 'RATE_LIMIT');
  assert.strictEqual(providerCalls, 1, '付费 429 不得进入调度器重排');

  assert.strictEqual(
    paidExecutionPolicy.localFallbackAllowed(canonical, { NEW_STORY_AD_ALLOW_LOCAL_VIDEO_FALLBACK: '1' }),
    false,
    '付费执行必须压过生产环境 fallback 开关',
  );
  assert.strictEqual(
    paidExecutionPolicy.localFallbackAllowed({ allow_local_fallback: true }, {}),
    true,
    '非付费内部调用仍可显式使用本地测试 fallback',
  );
  assert.throws(
    () => paidExecutionPolicy.assertBatchSucceeded({
      failures: [{ error: 'simulated paid unit failure', error_code: 'PAID_UNIT_FAILED', indexes: [1], billing_state: 'not_submitted' }],
    }, [{ shot_index: 0 }], [1]),
    error => error.code === 'PAID_UNIT_FAILED'
      && error.billingState === 'not_submitted'
      && error.partial_video_clips.length === 1
      && error.failed_indexes[0] === 1,
    '适配器即使把单元失败编码在返回值中，服务层也必须转为终止错误',
  );
}

async function testHttpIngress() {
  const originals = {
    assertTaskOwner: service.assertTaskOwner,
    assertVideoPreflightConfirmation: service.assertVideoPreflightConfirmation,
    taskSummary: service.taskSummary,
    generateVideoStage: service.generateVideoStage,
    getTask: storage.getTask,
    queueStage: jobService.queueStage,
    runMediaPipeline: mediaPipeline.runMediaPipeline,
    issuePermit: generationPermit.issue,
    consumePermit: generationPermit.consume,
  };
  let queued = null;
  let videoOptions = null;
  let mediaOptions = null;
  let server = null;
  const originalApplySelection = mediaModelSelection.applySelection;
  try {
    service.assertTaskOwner = id => ({ id });
    service.assertVideoPreflightConfirmation = () => ({ fingerprint: 'preflight-current' });
    service.taskSummary = task => task || {};
    service.generateVideoStage = async (_taskId, options) => { videoOptions = options; return {}; };
    storage.getTask = id => ({
      id,
      status: 'draft',
      stage: 'video',
      request: { content_mode: 'commercial_subject', content_mode_source: 'user' },
    });
    jobService.queueStage = (entry) => {
      queued = entry;
      return { accepted: true, duplicate: false, job: { id: `job-${entry.stage}` } };
    };
    mediaPipeline.runMediaPipeline = async ({ options }) => { mediaOptions = options; return {}; };
    generationPermit.issue = (taskId, stage) => ({ permit_id: `permit-${taskId}-${stage}`, task_id: taskId, stage });
    generationPermit.consume = (_taskId, issued) => ({ ...issued, status: 'consumed' });

    mediaModelSelection.applySelection = (_stage, body = {}) => ({ ...body, video_provider: 'mock', video_model: 'selected-video', video_model_route: 'mock/selected-video' });
    delete require.cache[require.resolve('../src/routes/newStoryAd')];
    const router = require('../src/routes/newStoryAd');
    const app = express();
    app.use(express.json());
    app.use('/api/new-story-ad', router);
    server = http.createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;

    for (const route of ['video', 'media']) {
      for (const { key, value } of FORBIDDEN_HTTP_CASES) {
        queued = null;
        const response = await requestJson(port, `/api/new-story-ad/tasks/paid-route-task/${route}`, {
          video_preflight_fingerprint: 'preflight-current',
          [key]: value,
        });
        assert.strictEqual(response.status, 422, `${route} 必须拒绝外部参数 ${key}`);
        assert.strictEqual(response.body.code, 'VIDEO_PAID_EXECUTION_OPTION_FORBIDDEN');
        assert.strictEqual(queued, null, `${route} 拒绝危险参数后不得入队`);
      }
    }

    const safeBody = Object.fromEntries(DANGEROUS_KEYS.map(key => [key, false]));
    safeBody.video_model_route = 'mock/selected-video';
    safeBody.video_preflight_fingerprint = 'preflight-current';
    safeBody.only_indexes = [1];

    let response = await requestJson(port, '/api/new-story-ad/tasks/paid-route-task/video', safeBody);
    assert.strictEqual(response.status, 202);
    assert(queued?.execute, '视频入口必须产生后台执行闭包');
    await queued.execute({ generationId: 'video-generation-safe' });
    assertCanonicalPaidOptions(videoOptions);

    queued = null;
    response = await requestJson(port, '/api/new-story-ad/tasks/paid-route-task/media', safeBody);
    assert.strictEqual(response.status, 202);
    assert(queued?.execute, '媒体入口必须产生后台执行闭包');
    await queued.execute({ generationId: 'media-generation-safe' });
    assertCanonicalPaidOptions(mediaOptions);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    service.assertTaskOwner = originals.assertTaskOwner;
    service.assertVideoPreflightConfirmation = originals.assertVideoPreflightConfirmation;
    service.taskSummary = originals.taskSummary;
    service.generateVideoStage = originals.generateVideoStage;
    storage.getTask = originals.getTask;
    jobService.queueStage = originals.queueStage;
    mediaPipeline.runMediaPipeline = originals.runMediaPipeline;
    generationPermit.issue = originals.issuePermit;
    generationPermit.consume = originals.consumePermit;
    mediaModelSelection.applySelection = originalApplySelection;
  }
}

(async () => {
  try {
    await testPolicyAndScheduler();
    await testHttpIngress();
    console.log('new story ad paid execution gate: ok');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
