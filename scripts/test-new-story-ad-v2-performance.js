const assert = require('assert');
const fs = require('fs');
const path = require('path');
const progressProjection = require('../src/services/newStoryAd/taskProgressProjectionService');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

function main() {
  const oversizedTask = {
    id: 'performance-task',
    status: 'running',
    stage: 'video',
    active_generation_id: 'generation-1',
    active_stage: 'video',
    updated_at: new Date().toISOString(),
    // 这些大字段模拟真实任务，但轻量投影绝不能把它们发给轮询接口。
    request: {
      storyboard_table: Array.from({ length: 120 }, (_, index) => ({
        index: index + 1,
        visual: '超长分镜内容'.repeat(500),
      })),
      images: Array.from({ length: 120 }, () => 'data:image/png;base64,'.padEnd(20000, 'x')),
      videos: Array.from({ length: 120 }, () => ({ url: '/large-video.mp4', metadata: 'x'.repeat(5000) })),
    },
    generation_progress: {
      stage: 'video',
      status: 'running',
      target_total: 120,
      processed: 61,
      succeeded: 60,
      failed: 1,
      current_index: 62,
      percent: 51,
      message: '正在处理第 62 个生成单元',
    },
  };
  const projection = progressProjection.projectTaskProgress(oversizedTask);
  const payload = JSON.stringify(projection);
  assert(payload.length < 5000, `轻量进度响应过大：${payload.length} bytes`);
  assert.strictEqual(payload.includes('storyboard_table'), false);
  assert.strictEqual(payload.includes('data:image'), false);
  assert.strictEqual(payload.includes('large-video.mp4'), false);
  assert.strictEqual(projection.task.generation_progress.processed, 61);

  const unchanged = progressProjection.projectTaskProgress(oversizedTask, projection.revision);
  assert.strictEqual(unchanged.changed, false);

  const flowSource = read('public/js/new-story-ad/generation-flow.js');
  const waitSource = flowSource.slice(
    flowSource.indexOf('async function waitForStage'),
    flowSource.indexOf('async function startStage'),
  );
  assert(waitSource.includes('/progress'), '阶段等待必须使用轻量进度接口');
  assert(waitSource.includes('?compact=1'), '阶段结束必须只获取一次压缩完整快照');
  assert(waitSource.includes('ctx.renderProgress?.()'), '处理中必须局部更新进度');

  const legacySource = read('public/js/new-story-ad-legacy-ui.js');
  const progressRenderStart = legacySource.indexOf('renderProgress: () =>');
  const progressRender = legacySource.slice(progressRenderStart, progressRenderStart + 220);
  assert(progressRender.includes('renderStatus()'));
  assert.strictEqual(progressRender.includes('renderStoryboard()'), false);
  assert.strictEqual(progressRender.includes('renderMedia()'), false);
  assert(legacySource.includes('/progress${progressRevision'), '进度计时器不得继续下载完整任务');

  const routeSource = read('src/routes/newStoryAd.js');
  assert(routeSource.indexOf("router.get('/tasks/:id/progress'")
    < routeSource.indexOf("router.get('/tasks/:id'"), '轻量进度路由必须位于完整任务路由之前');

  const bootstrapSource = read('public/js/new-story-ad/bootstrap.js');
  const mediaLoaderSource = read('public/js/new-story-ad/bootstrap-media-loader.js');
  const coreList = bootstrapSource.slice(
    bootstrapSource.indexOf('const CORE_SCRIPT_PATHS'),
    bootstrapSource.indexOf('let loadPromise'),
  );
  assert.strictEqual(coreList.includes('video-review.js'), false, '审片模块不得进入首屏核心包');
  assert.strictEqual(coreList.includes('video-preflight-ui.js'), false, '费用预检模块不得进入首屏核心包');
  assert(bootstrapSource.includes('const loadMediaModules = async'), '第 5 步模块必须按需加载');
  assert(mediaLoaderSource.includes("new-story-ad:media-modules-ready"), '按需加载完成后必须发送就绪事件');
  assert(mediaLoaderSource.includes('/js/new-story-ad/video-review.js'), '审片模块必须由独立媒体加载器管理');

  console.log(`剧情广告 V2.0 性能边界测试通过：120 镜任务轮询载荷 ${payload.length} bytes。`);
}

main();
