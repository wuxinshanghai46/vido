const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function control({ safe = false } = {}) {
  return {
    disabled: false,
    dataset: {},
    matches: selector => safe && selector === '[data-history-safe]',
  };
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  const appSource = read('public/story-ad/app.js');
  const briefSource = read('public/story-ad/views/briefView.js');
  const dialogueSource = read('public/story-ad/views/briefDialoguePanel.js');
  const storeSource = read('public/story-ad/store/projectStore.js');
  const historyUrl = pathToFileURL(path.join(root, 'public/story-ad/workspaceHistoryMode.js')).href;
  const { applyHistoricalReadonlyControls } = await import(historyUrl);

  assert.doesNotMatch(appSource, /applyHistoricalStepMode|data-unlock-history-step|新增\s*\/\s*修改内容/, '壳层不得再注入冗余历史编辑横幅');
  assert.doesNotMatch(dialogueSource, /data-open-history-edit|brief-edit-history|这一步已确认；需要修改时点这里开启编辑/, '对话页不得保留第二个历史编辑入口');
  assert.match(dialogueSource, /data-dialogue-professional/, '手动设置 modal 仍是唯一的结构化精调入口');
  assert.match(briefSource, /await store\.updateRequest\(payload, \{ refreshSections: 'summary' \}\)/, '历史内容修改必须继续走权威更新接口');
  assert.match(storeSource, /base_content_revision/, '权威更新必须继续携带内容版本，阻止陈旧覆盖');
  assert.match(storeSource, /client_edit_seq/, '权威更新必须继续携带客户端编辑序列');

  const safeAction = control({ safe: true });
  const editAction = control();
  const editInput = control();
  applyHistoricalReadonlyControls({ querySelectorAll: () => [safeAction, editAction, editInput] });
  assert.equal(safeAction.disabled, false, '显式安全动作必须保持可用');
  assert.equal(editAction.disabled, true, '未分类编辑动作仍须受局部只读保护');
  assert.equal(editInput.disabled, true, '未分类输入仍须受局部只读保护');

  console.log(JSON.stringify({ passed: true, checks: 10, scope: 'story-ad-history-edit-entry-final-dom-v63', model_calls: 0 }));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
