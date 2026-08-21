const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const index = read('public/index.html');
const app = read('public/js/app.js');
const dashboardUi = read('public/js/dashboard-workbench.js');
const dashboardStyle = read('public/css/dashboard-workbench.css');
const style = read('public/css/style.css');
const dashboardRoute = read('src/routes/dashboard.js');
const server = read('src/server.js');
const workflow = read('public/js/workflow.js');
const aiCanvas = read('public/js/aicanvas.js');

const removedSurfacePatterns = [
  ['data-page="i2v"', '侧边栏不得保留图生视频独立入口'],
  ['data-page="imggen"', '侧边栏不得保留图片生成独立入口'],
  ['id="page-i2v"', '首页不得保留图生视频独立页面'],
  ['id="page-imggen"', '首页不得保留图片生成独立页面'],
  ['data-group="工具"', '两个入口删除后不得留下空工具分组'],
];
removedSurfacePatterns.forEach(([pattern, message]) => assert(!index.includes(pattern), message));

[
  'loadI2VPage',
  'startI2VGeneration',
  'loadImgGenPage',
  'startImageGeneration',
].forEach(symbol => assert(!app.includes(symbol), `专用前端代码仍包含 ${symbol}`));
assert(!style.includes('.i2v-page'), '专用图生视频样式仍然存在');
assert(!style.includes('.ig-page'), '专用图片生成样式仍然存在');

assert(index.includes("window.location.href='/story-ad/'"), '侧边栏必须提供独立剧情广告入口');
assert(index.includes('>剧情广告</div>'), '侧边栏必须显示剧情广告名称');
assert(dashboardUi.includes("'/story-ad/'"), '新建作品必须进入独立剧情广告任务中心');
assert(!dashboardUi.includes("'/digital-human?tab=new-story-ad"), '新建作品不得再进入数字人中的旧入口');
assert(!dashboardUi.includes("'/?page=i2v'"), '新建作品不得保留图生视频独立入口');
assert(!dashboardUi.includes("page.className = 'page active dashboard-workbench-page'"), '工作台初始化不得强制重新激活首页');
assert(dashboardUi.includes("page.classList.add('dashboard-workbench-page')"), '工作台只能添加自身样式类，必须保留路由决定的激活状态');
assert(app.includes("document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));"), '切换任何同页模块前必须统一退出当前页面');
assert(dashboardStyle.includes('#page-dashboard.dashboard-workbench-page{visibility:hidden!important;display:none!important}'), '非激活首页必须彻底隐藏');
assert(dashboardStyle.includes('#page-dashboard.dashboard-workbench-page.active{visibility:visible!important;display:block!important;'), '只有激活首页才允许显示');
assert(!dashboardStyle.includes('@media(max-width:680px){#page-dashboard.dashboard-workbench-page{'), '移动端样式也不得绕过首页激活状态');

assert(dashboardRoute.includes('`/story-ad/projects/${encodeURIComponent(record.id)}?view=final`'), '已完成剧情广告必须返回独立成片页');
assert(dashboardRoute.includes('`/story-ad/projects/${encodeURIComponent(x.id)}?view=${storyAdView(x.stage)}`'), '进行中剧情广告必须返回与当前阶段对应的独立项目页');
assert(dashboardRoute.includes("if (/storyboard/.test(value)) return 'storyboard';"), '剧情广告分镜阶段必须返回分镜页');
assert(dashboardRoute.includes("if (/scene|asset|character|product/.test(value)) return 'assets';"), '剧情广告资产阶段必须返回资产页');
assert(!dashboardRoute.includes("resumeUrl: '/?page=i2v'"), '历史图生视频任务不得指向已删除页面');
assert(dashboardRoute.includes("resumeUrl: '/?page=works'"), '历史图生视频任务应落到作品中心');

assert(server.includes("app.use('/api/i2v'"), '共享图生视频能力不得随独立页面误删');
assert(server.includes("app.use('/api/imggen'"), '共享图片生成能力不得随独立页面误删');
assert(server.includes("app.use('/api/new-story-ad', authenticate, require('./routes/newStoryAd'))"), '剧情广告生成接口不得继续依赖旧数字人权限');
assert(server.includes("app.use('/api/story-ad', authenticate, require('./routes/storyAdWorkspace'))"), '剧情广告工作台接口不得继续依赖旧数字人权限');
assert(workflow.includes('/api/i2v/generate'), '工作流仍需复用图生视频能力');
assert(aiCanvas.includes('/api/imggen/generate'), '视频画布仍需复用图片生成能力');
assert(server.includes("app.use('/api/story-ad'"), '独立剧情广告接口必须注册');
assert(server.includes("app.get(/^\\/story-ad$/"), '无斜杠的剧情广告入口必须使用严格路由');
assert(!server.includes("app.get('/story-ad',"), '禁止用会同时匹配 /story-ad/ 的非严格路由，否则会自重定向');

assert(index.includes('/js/app.js?v=20260820-dashboard-clean-v94'), '首页业务脚本缓存版本必须更新');
assert(index.includes('/css/style.css?v=20260731-story-ad-entry'), '首页样式缓存版本必须更新');
assert(index.includes('/js/dashboard-workbench.js?v=20260821-dashboard-preload-v128'), '工作台脚本缓存版本必须与首页预加载版本同步更新');
assert(index.includes('/css/dashboard-workbench.css?v=20260820-dashboard-clean-v94'), '工作台样式缓存版本必须与可见悬停预览版本同步更新');

console.log('platform module navigation tests passed: removed=2 story_ad_entry=2 shared_capabilities=2');
