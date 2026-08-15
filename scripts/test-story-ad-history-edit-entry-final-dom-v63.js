const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function control({ safe = false } = {}) {
  return {
    disabled: false,
    dataset: {},
    matches: selector => safe && selector === '[data-history-safe]',
  };
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const appSource = fs.readFileSync(path.join(root, 'public/story-ad/app.js'), 'utf8');
  const historyUrl = pathToFileURL(path.join(root, 'public/story-ad/workspaceHistoryMode.js')).href;
  const { applyHistoricalReadonlyControls, historicalStepUsesGlobalEdit } = await import(historyUrl);
  const functionSource = extractFunction(appSource, 'applyHistoricalStepMode');
  const store = { state: { bundle: { navigation: { current: 'final' } } } };
  const applyHistoricalStepMode = new Function(
    'historicalStepUsesGlobalEdit', 'historicalStepReadOnly', 'historicalEditUnlocks', 'historicalUnlockKey', 'document',
    'store', 'applyHistoricalReadonlyControls', 'confirmDialog', 'mountView', 'currentRoute',
    `return (${functionSource});`,
  )(
    historicalStepUsesGlobalEdit,
    () => true,
    { has: () => false, add: () => {} },
    route => route.view,
    { createElement: () => ({
      className: '', innerHTML: '', setAttribute() {},
      querySelector(selector) {
        return selector === '[data-unlock-history-step]' && this.innerHTML.includes('data-unlock-history-step')
          ? { addEventListener() {} }
          : null;
      },
    }) },
    store,
    applyHistoricalReadonlyControls,
    async () => false,
    async () => {},
    () => ({ view: 'brief' }),
  );

  function render(view) {
    const safeAction = control({ safe: true });
    const editAction = control();
    const host = {
      banner: null,
      prepend(node) { this.banner = node; },
      querySelectorAll: () => [safeAction, editAction],
    };
    applyHistoricalStepMode(host, { taskId: 'task-1', view });
    return { html: host.banner?.innerHTML || '', safeAction, editAction };
  }

  const brief = render('brief');
  assert.match(brief.html, /data-unlock-history-step/, '第 1 步必须保留“新增 / 修改内容”入口');
  assert.equal(brief.safeAction.disabled, false, '第 1 步的独立安全动作不得被历史只读误锁');
  assert.equal(brief.editAction.disabled, true, '第 1 步未明确解锁前，内容编辑仍须只读');

  for (const view of ['assets', 'scene', 'plot', 'storyboard', 'final']) {
    const rendered = render(view);
    assert.doesNotMatch(rendered.html, /data-unlock-history-step/, `${view} 步骤不得再显示第 1 步的“新增 / 修改内容”入口`);
    assert.equal(rendered.safeAction.disabled, false, `${view} 自身明确声明的安全入口必须保持可用`);
    assert.equal(rendered.editAction.disabled, false, `${view} 自身的独立编辑入口不得被第 1 步全局门禁接管`);
  }

  console.log('story-ad history edit entry final DOM v63 passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
