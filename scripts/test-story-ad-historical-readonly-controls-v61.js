const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

function control({ safe = false, disabled = false } = {}) {
  return {
    disabled,
    dataset: {},
    matches(selector) {
      return safe && selector === '[data-history-safe]';
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

  const guardUrl = pathToFileURL(path.resolve(__dirname, '../public/story-ad/views/assetCenterPlanReleaseStatus.js')).href;
  const { createKeyedRequestGuard } = await import(guardUrl);
  const keyedGuard = createKeyedRequestGuard();
  let releaseFirst;
  let calls = 0;
  const first = keyedGuard.run('all', 'request-1', async requestKey => {
    calls += 1;
    assert.equal(requestKey, 'request-1');
    await new Promise(resolve => { releaseFirst = resolve; });
    return false;
  });
  assert.equal(await keyedGuard.run('all', 'request-2', async () => { calls += 1; }, () => 'skipped'), 'skipped', '同一生成意图并发时必须在第二次确认前拦截');
  assert.equal(calls, 1, '同一意图不得并行执行两次');
  releaseFirst();
  await first;
  assert.equal(await keyedGuard.run('all', 'request-2', async requestKey => requestKey), 'request-1', '取消或失败后允许重试，并继续复用幂等 request_key');

  console.log('story-ad historical readonly control behavior v61 passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
