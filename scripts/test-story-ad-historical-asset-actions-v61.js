const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const app = read('public/story-ad/app.js');
const assets = read('public/story-ad/views/assetCenterView.js');
const planningDetails = read('public/story-ad/views/assetCenterPlanningDetails.js');
const requestGuards = read('public/story-ad/views/assetCenterPlanReleaseStatus.js');
const newStoryAdRoute = read('src/routes/newStoryAd.js');
const brief = read('public/story-ad/views/briefView.js');
const styles = read('public/story-ad/styles.css');
const historySource = read('public/story-ad/workspaceHistoryMode.js');

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  throw new Error(`unterminated ${signature}`);
}

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `missing CSS rule ${selector}`);
  return match[1];
}

function buttonTagWith(...attributes) {
  return new RegExp(`<button${attributes.map(attribute => `(?=[^>]*${attribute})`).join('')}[^>]*>`, 'i');
}

const historyMode = functionBody(app, 'function applyHistoricalStepMode');

// 历史步骤只读只能保护编辑动作，不能把查看、生成和进入下一步等执行动作一刀切锁死。
assert.doesNotMatch(
  historyMode,
  /querySelectorAll\(['"]button, input, select, textarea['"]\)/,
  '历史只读不得再次禁用页面内所有按钮；V60 的人物生成按钮正是在这里被误锁',
);
assert.match(
  historyMode,
  /historical[^\n]*(action|control)|editable|readOnly/i,
  '历史只读必须使用明确的控件分类契约，而不是依赖按钮文案或页面位置',
);
assert.match(
  assets,
  buttonTagWith('data-generate-missing-subjects', 'data-history-safe'),
  '整批人物图片生成按钮必须显式声明为历史资产页仍可执行的动作',
);
assert.match(
  assets,
  buttonTagWith('data-confirm-assets', 'data-history-safe'),
  '人物资产确认/进入下一步必须显式声明为历史资产页仍可执行的动作',
);
const historyModule = new Function(`${historySource.replace(/\bexport\s+/g, '')}; return { applyHistoricalReadonlyControls };`)();
const control = selectors => ({
  disabled: false,
  dataset: {},
  matches: selector => selectors.includes(selector),
});
const safeAction = control(['[data-history-safe]']);
assert.match(app, buttonTagWith('data-unlock-history-step', 'data-history-safe'), '解锁按钮必须纳入只读安全动作契约');
const unlockAction = control(['[data-unlock-history-step]', '[data-history-safe]']);
const ordinaryAction = control([]);
const editInput = control([]);
const fakeHost = { querySelectorAll: () => [safeAction, unlockAction, ordinaryAction, editInput] };
historyModule.applyHistoricalReadonlyControls(fakeHost);
assert.equal(safeAction.disabled, false, '人物生成/下一步等显式安全动作在历史资产页必须保持可用');
assert.equal(unlockAction.disabled, false, '历史步骤的“新增/修改内容”解锁按钮绝不能被只读处理自己禁用');
assert.equal(ordinaryAction.disabled, true, '未分类的动作默认必须受保护，防止打开动态编辑面板绕过只读');
assert.equal(editInput.disabled, true, '输入控件在显式解锁前必须保持只读');
assert.match(assets, /historicalReadOnly\s*=\s*context\.historicalReadOnly === true/, '资产页必须采用壳层传入的最终历史只读状态');
assert.match(assets, /openDrawer\(item, group, \{ readOnly: historicalReadOnly,/, '查看详情打开的动态 drawer 必须继承历史只读状态');
assert.match(planningDetails, /readOnly \? '<p[^']*data-historical-drawer-readonly[^']*' : `\$\{group === 'people' \? personEditForm/s, '历史 drawer 必须只展示已保存内容，不能动态补回编辑表单');
assert.match(planningDetails, /readOnly \? '' : '<button[^']*type="submit"[^']*保存人物文字设定/, '历史 drawer 不得显示人物文字保存动作');
assert.match(planningDetails, /readOnly \? '' : `<button[^`]*data-drawer-upload-product/s, '历史 drawer 不得显示商品上传/替换动作');
assert.match(planningDetails, /data-drawer-generate/, '历史只读只保护文字编辑，付费生成入口在二次确认前仍需可达');
assert.match(assets, /createKeyedRequestGuard\(\)/, '人物图片生成必须按意图复用统一防重入 guard');
assert.match(assets, /subjectRequests\.run\(intent,[\s\S]*await confirmBillingAwareAction\(\{/, '防重入 guard 必须包住计费确认与提交链');
assert.match(requestGuards, /if \(guard\.active\) return onSkipped\?\.\(\);[\s\S]*await guard\.run\(operation\)/, '同一意图在确认框打开前必须被 guard 拦截');
assert.match(requestGuards, /try \{ return await operation\(requestKey\); \} finally \{ active = false; \}/, '取消、失败与成功后都必须释放人物生成防重入锁');
assert.match(newStoryAdRoute, /requestKey[\s\S]*idempotencyKey[\s\S]*queueStage\(/, '页面防重入之外，人物生成请求仍必须保留服务端 request_key 幂等兜底');

// 已完成第一步时，下一步卡和参考进度卡必须同时不渲染。
assert.match(
  brief,
  /showReferenceStepGuidance\s*=\s*referenceStepVisible\s*&&\s*bundle\.navigation\?\.steps\?\.brief\?\.completed\s*!==\s*true/,
  'brief 完成态必须作为两张引导卡的共同显示门禁',
);
assert.match(brief, /\$\{showReferenceStepGuidance && !referenceAction\.blocked \? `<section[^`]*data-brief-inline-action/s, '下一步卡必须受完成态门禁控制');
assert.match(brief, /\$\{showReferenceStepGuidance \? `<div data-reference-progress-host/s, '参考进度卡必须受完成态门禁控制');

// 视觉规范：默认低调，只有 hover/focus/busy 才突出；disabled 必须清楚但不能伪装成高亮。
const primaryDefault = cssRule(styles, '.btn.primary');
assert.doesNotMatch(primaryDefault, /background\s*:\s*var\(--mint\)/, '主按钮默认态不得使用整块高亮色');
assert.doesNotMatch(primaryDefault, /color\s*:\s*#03120d/i, '主按钮默认态不得使用高亮底专用的深色文字');
assert.match(primaryDefault, /background\s*:\s*var\(--surface(?:-2|-3)?\)|transparent|color-mix/i, '主按钮默认态必须使用低调表面色');

const primaryHover = cssRule(styles, '.btn.primary:not(:disabled):hover');
assert.match(primaryHover, /background[^;]*(--mint|white)|box-shadow[^;]*--mint/i, '精确指针 hover 必须产生明确高亮反馈');

const disabledMatch = styles.match(/\.btn:disabled[^,{]*(?:\([^)]*\))?\s*,\s*\.icon-btn:disabled[^,{]*(?:\([^)]*\))?\s*\{([^}]+)\}/);
assert.ok(disabledMatch, '必须定义语义明确的普通禁用态（可排除 aria-busy 执行中态）');
const disabled = disabledMatch[1];
assert.match(disabled, /cursor\s*:\s*not-allowed/, '禁用态必须明确不可操作');
assert.doesNotMatch(disabled, /background[^;]*--mint(?!ed)/i, '禁用态不得使用操作高亮底色');

const busy = cssRule(styles, '.btn[aria-busy="true"], .icon-btn[aria-busy="true"]');
assert.match(busy, /cursor\s*:\s*progress/, '执行中必须显示进度指针');
assert.match(busy, /opacity\s*:\s*1/, '执行中不能看起来像禁用失败');

console.log('story-ad historical asset action and interaction v61 contracts passed');
