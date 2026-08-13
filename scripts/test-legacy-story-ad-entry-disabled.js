const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/digital-human.html');
const ui = read('public/js/digital-human.js');
const css = read('public/css/digital-human.css');
const server = read('src/server.js');
const releaseFiles = require('./lib/storyAdReleaseFiles');

assert(!html.includes('data-tab="luxury-ad"'), '左侧导航不得保留旧剧情广告 DOM 入口');
assert(!html.includes('data-task-type="luxury_ad"'), '任务中心不得保留旧剧情广告筛选入口');
assert(!html.includes('旧剧情广告'), '数字人页面不得继续展示旧剧情广告文案');
assert(!html.includes('剧情广告 V2.0'), '当前剧情广告入口不得再使用容易与旧版混淆的 V2.0 名称');
assert(html.includes('data-tab="new-story-ad"'), '当前剧情广告入口必须保留');
assert(html.includes('/js/digital-human.js?v=20260728-disable-legacy-entry-v53'), '入口关闭必须更新前端脚本缓存版本');
assert(html.includes('/css/digital-human.css?v=20260728-disable-legacy-entry-v53'), '入口关闭必须更新前端样式缓存版本');
assert(!ui.includes('data-scene="luxury-ad"'), '形象用途弹窗不得保留旧剧情广告入口');
assert(ui.includes("return tab === 'luxury-ad' ? 'new-story-ad' : tab;"), '统一标签路由必须把旧入口归一化到当前剧情广告');
assert(ui.includes("const initialLuxuryProjectRouteId = initialTab === 'material-film' ? getLuxuryAdProjectRouteId() : '';"),
  '新版剧情广告不得恢复旧 luxury_project');
assert(css.includes('.dh-app [hidden] { display: none !important; }'), '页面必须保证 hidden 不被组件 display 样式覆盖');
assert(server.includes("['luxury-ad', 'luxury_ad', 'new-story-ad', 'new_story_ad'].includes(tab)"), '服务端页面路由必须识别旧标签并统一转入独立新版工作台');
assert(server.includes("? `/story-ad/projects/${encodeURIComponent(taskId)}"), '旧任务深链必须保留任务 ID 并进入独立新版工作台');
assert(server.includes("app.get(['/luxury-ad', '/luxury-ad.html']"), '旧独立页面地址必须重定向到当前剧情广告');
assert(server.includes("code: 'LEGACY_STORY_AD_DISABLED'"), '旧剧情广告 API 必须继续返回永久下线错误');
assert.strictEqual(releaseFiles.isRuntimeReleaseFile('public/js/new-story-ad-legacy-ui.js'), false, '旧客户端源码不得进入生产运行闭包');
assert.strictEqual(fs.existsSync(path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js')), false, '旧客户端源码必须物理删除，不能只靠运行闭包排除');

const firstInlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
assert(firstInlineScript, '页面必须保留首屏路由脚本');
let replacedUrl = '';
const location = {
  href: 'http://localhost/digital-human?tab=luxury-ad&luxury_project=old-project&lux_step=4&lux_focus=frames',
  search: '?tab=luxury-ad&luxury_project=old-project&lux_step=4&lux_focus=frames',
  hash: '',
};
const document = { documentElement: { dataset: {} } };
vm.runInNewContext(firstInlineScript, {
  URL,
  URLSearchParams,
  location,
  document,
  history: { replaceState: (_state, _title, url) => { replacedUrl = String(url); } },
});
assert.strictEqual(document.documentElement.dataset.dhInitialTab, 'new-story-ad');
assert(replacedUrl.includes('tab=new-story-ad'), '旧深链必须立即改写为当前剧情广告地址');
assert(!/luxury_project|lux_step|lux_focus/.test(replacedUrl), '旧项目、步骤和焦点参数不得进入新版剧情广告');

console.log(JSON.stringify({
  status: 'PASS',
  nav_entry_removed: true,
  task_filter_removed: true,
  avatar_entry_removed: true,
  legacy_url_redirected: true,
  legacy_project_state_dropped: true,
  legacy_api_disabled: true,
}, null, 2));
