const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

function control({ safe = false, disabled = false } = {}) {
  return {
    disabled,
    dataset: {},
    matches(selector) {
      return safe && selector === '[data-historical-readonly-action="safe"]';
    },
  };
}

(async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../public/story-ad/workspaceHistoryMode.js')).href;
  const { applyHistoricalReadonlyControls, historicalStepReadOnly } = await import(moduleUrl);

  assert.equal(historicalStepReadOnly({ navigation: { current: 'scene' } }, { view: 'assets' }), true);
  assert.equal(historicalStepReadOnly({ navigation: { current: 'assets' } }, { view: 'assets' }), false);

  const safeGenerate = control({ safe: true });
  const safeNavigation = control({ safe: true });
  const safeButBusinessDisabled = control({ safe: true, disabled: true });
  const editButton = control();
  const editInput = control();
  const editSelect = control();
  const controls = [safeGenerate, safeNavigation, safeButBusinessDisabled, editButton, editInput, editSelect];
  const result = applyHistoricalReadonlyControls({ querySelectorAll: () => controls });

  assert.deepEqual(result, { protected: 3, safe: 3 });
  assert.equal(safeGenerate.disabled, false, '历史资产页的安全生成动作必须保持可点击');
  assert.equal(safeNavigation.disabled, false, '进入下一步等安全导航动作必须保持可点击');
  assert.equal(safeButBusinessDisabled.disabled, true, '历史只读策略不得反向启用业务本来禁用的动作');
  for (const editable of [editButton, editInput, editSelect]) {
    assert.equal(editable.disabled, true, '历史内容编辑控件必须继续锁定');
    assert.equal(editable.dataset.historicalReadonly, 'true');
  }

  console.log('story-ad historical readonly control behavior v61 passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
