const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 读取仓库内 UTF-8 文本文件。 */
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** 计算文本行数，作为防止单文件继续膨胀的守卫。 */
function lines(relativePath) {
  return read(relativePath).split(/\r?\n/).length;
}

/** 校验新通用核心的每个命名函数前都存在中文功能备注。 */
function assertFunctionComments(relativePath) {
  const rows = read(relativePath).split(/\r?\n/);
  rows.forEach((row, index) => {
    if (!/^function\s+\w+|^async function\s+\w+/.test(row.trim())) return;
    const previous = rows.slice(Math.max(0, index - 4), index).join('\n');
    assert(/\/\*\*[\s\S]*[\u3400-\u9fff]/.test(previous), `${relativePath}:${index + 1} 新函数缺少中文功能备注`);
  });
}

/** 执行代码体量、按需加载和平台隔离边界检查。 */
function run() {
  const limits = {
    'src/services/videoGenerationCore/chineseError.js': 180,
    'src/services/videoGenerationCore/domainContract.js': 280,
    'src/services/videoGenerationCore/executionPlanner.js': 380,
    'src/services/videoGenerationCore/costGuard.js': 260,
    'public/js/new-story-ad/bootstrap.js': 180,
    'src/services/newStoryAd/storyAdService.js': 3800,
    'src/services/newStoryAd/videoAdapter.js': 1350,
    'public/js/new-story-ad-legacy-ui.js': 6400,
  };
  Object.entries(limits).forEach(([file, limit]) => {
    assert(lines(file) <= limit, `${file} 已超过 ${limit} 行，必须先拆分后继续开发`);
  });

  [
    'src/services/videoGenerationCore/chineseError.js',
    'src/services/videoGenerationCore/domainContract.js',
    'src/services/videoGenerationCore/executionPlanner.js',
    'src/services/videoGenerationCore/costGuard.js',
    'public/js/new-story-ad/bootstrap.js',
  ].forEach(assertFunctionComments);

  const page = read('public/digital-human.html');
  assert(page.includes('/js/new-story-ad/bootstrap.js'), '数字人页面必须使用剧情广告按需加载入口');
  assert(!page.includes('/js/new-story-ad-legacy-ui.js'), '数字人页面不得直接同步加载剧情广告旧 UI');
  assert(!page.includes('/js/new-story-ad/generation-flow.js'), '数字人页面不得直接同步加载剧情广告生成流程');

  const sharedRoute = read('src/routes/digitalHuman.js');
  assert(!sharedRoute.includes('videoGenerationCore'), '通用视频核心不得反向侵入旧数字人总路由');
  const scheduler = read('src/services/newStoryAd/videoParallelScheduler.js');
  assert(scheduler.includes('allowThrottleRetry'), '付费视频并发器必须默认禁止自动限流重试');
  const service = read('src/services/newStoryAd/storyAdService.js');
  assert(service.includes('const maxRepairs = 0'), '付费视频必须保持零自动修片');
  assert(service.includes('taskSummary(task, { detailed: false })'), '任务列表必须使用轻量摘要，禁止读取全部媒体输出');
  console.log('剧情广告 V3 架构、备注、性能与隔离边界：全部通过');
}

run();
