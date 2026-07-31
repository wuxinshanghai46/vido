#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND_ROOT = path.join(ROOT, 'public', 'story-ad');
const INITIAL_FILES = [
  'public/story-ad/app.js',
  'public/story-ad/api.js',
  'public/story-ad/store/projectStore.js',
  'public/story-ad/components/ui.js',
];
const SOURCE_FILES = [
  ...walk(FRONTEND_ROOT),
  path.join(ROOT, 'src/routes/storyAdWorkspace.js'),
  ...walk(path.join(ROOT, 'src/services/storyAdWorkspace')),
];
const FORBIDDEN_DEMO_TERMS = [
  '保时捷',
  '赛车手',
  '女赛车手',
  '山路篇',
  '湿润山路',
  '林间停车区',
  '领航员',
  '边牧',
  '42daab0d',
];

/** 递归列出需要检查的源文件。 */
function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const value = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(value) : [value];
  }).filter(file => /\.(?:js|css|html)$/.test(file));
}

/** 读取 UTF-8 源文件。 */
function read(file) {
  return fs.readFileSync(file, 'utf8');
}

/** 返回仓库相对路径。 */
function relative(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

/** 执行示例数据、代码体量、独立入口与按需加载硬门禁。 */
function main() {
  SOURCE_FILES.forEach(file => {
    const content = read(file);
    const lineCount = content.split(/\r?\n/).length;
    assert(lineCount <= 600, `${relative(file)} 超过 600 行，必须拆分`);
    if (file.startsWith(FRONTEND_ROOT) && file.endsWith('.js')) {
      assert(!/\b(?:alert|confirm|prompt)\s*\(/.test(content), `${relative(file)} 不得使用浏览器原生弹窗`);
    }
    FORBIDDEN_DEMO_TERMS.forEach(term => {
      assert(!content.includes(term), `${relative(file)} 命中原型示例内容：${term}`);
    });
  });

  const app = read(path.join(ROOT, 'public/story-ad/app.js'));
  assert(app.includes("import('./views/"), '项目视图必须使用动态导入');
  assert(!app.includes('new-story-ad-legacy-ui'), '新模块不得加载旧剧情广告大文件');
  assert(!app.includes('digital-human'), '新模块不得依赖数字人页面');
  assert(app.includes('route.isNew && store.state.bundle'), '进入新建页必须清理上一项目数据');
  assert(app.includes('store.clearProject()'), '新建页必须调用统一跨任务清理');
  assert(app.includes('data-workbench'), '任务中心和项目页必须提供返回工作台入口');
  assert(app.includes("location.href = '/dashboard'"), '返回工作台必须指向平台工作台');
  assert(app.includes('window.vidoTheme?.normalize'), '剧情广告必须复用平台主题规范化逻辑');
  assert(app.includes('window.vidoTheme?.set'), '剧情广告主题切换必须同步平台主题');
  assert(!app.includes("localStorage.setItem('vido-theme', resolved)"), '不得用暗亮别名覆盖平台主题键');
  const page = read(path.join(ROOT, 'public/story-ad/index.html'));
  assert(!page.includes('/js/new-story-ad/'), '独立入口不得同步加载旧剧情广告脚本');
  assert(page.includes('type="module"'), '独立入口必须使用模块化脚本');
  assert(page.includes('/js/vido-theme.js'), '独立入口必须加载平台共享主题脚本');
  const styles = read(path.join(ROOT, 'public/story-ad/styles.css'));
  assert(styles.includes(':root[data-theme="light-mist"]'), '亮色样式必须识别平台 light-mist 主题');
  const dialog = read(path.join(ROOT, 'public/story-ad/components/dialog.js'));
  assert(dialog.includes('role="dialog"'), '确认与输入提示必须使用可访问的平台弹窗');

  const initialBytes = INITIAL_FILES.reduce((sum, file) => sum + fs.statSync(path.join(ROOT, file)).size, 0);
  const allJsBytes = walk(FRONTEND_ROOT).filter(file => file.endsWith('.js')).reduce((sum, file) => sum + fs.statSync(file).size, 0);
  assert(initialBytes <= 100 * 1024, `任务中心初始 JS ${initialBytes} bytes 超过 100 KiB`);
  assert(allJsBytes <= 220 * 1024, `全部新模块 JS ${allJsBytes} bytes 超过 220 KiB`);

  const workflow = read(path.join(ROOT, 'public/story-ad/views/workflowView.js'));
  assert(workflow.includes("addEventListener('pointermove'"), '画布必须支持指针平移');
  assert(workflow.includes("addEventListener('wheel'"), '画布必须支持滚轮缩放');
  assert(workflow.includes('data-node-panel'), '画布节点必须支持详情面板');
  const store = read(path.join(ROOT, 'public/story-ad/store/projectStore.js'));
  assert(store.includes('bindReferenceAnalysis(analysis)'), '参考分析必须显式绑定当前任务');
  assert(store.includes('referenceAnalysisId'), '参考轮询必须锁定明确分析 ID');
  assert(store.includes('function clearProject()'), '状态仓库必须提供跨任务清理');

  console.log(`story-ad workspace v6 boundaries: passed; initial_js=${initialBytes} bytes; all_js=${allJsBytes} bytes`);
}

main();
