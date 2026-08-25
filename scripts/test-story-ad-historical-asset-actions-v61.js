const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const app = read('public/story-ad/app.js');
const assets = read('public/story-ad/views/assetCenterView.js');
const stageSource = read('public/story-ad/views/assetCenterStageView.js');
const planStatusSource = read('public/story-ad/views/assetCenterPlanReleaseStatus.js');
const inlineProgressSource = read('public/story-ad/views/assetCenterInlineProgress.js');
const technicalDetailsSource = read('public/story-ad/views/assetCenterTechnicalDetails.js');
const planningDetails = read('public/story-ad/views/assetCenterPlanningDetails.js');
const requestGuards = read('public/story-ad/views/assetCenterRequestGuard.js');
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

function functionDeclaration(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const params = source.indexOf('(', start);
  let paramDepth = 0; let open = -1;
  for (let index = params; index < source.length; index += 1) {
    if (source[index] === '(') paramDepth += 1;
    if (source[index] === ')' && --paramDepth === 0) { open = source.indexOf('{', index); break; }
  }
  assert.notEqual(open, -1, `missing body for ${signature}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
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

const browserSource = source => source
  .replace(/^import\s+.*?;\s*$/gm, '')
  .replace(/^export\s+\{.*$/gm, '')
  .replace(/\bexport\s+/g, '');
const stageSandbox = { makeGuardMap: () => ({}), makePersonGuard: () => ({}), escapeHtml: value => String(value) };
vm.runInNewContext(`${browserSource(inlineProgressSource)}\n${browserSource(technicalDetailsSource)}\n${browserSource(planStatusSource)}\n${browserSource(stageSource)}\nglobalThis.__stage=assetPlanStageView;`, stageSandbox);
const historicalGenerateDom = stageSandbox.__stage({ counts: { people: 2 }, missingSubjectCount: 2 });
const historicalContinueDom = stageSandbox.__stage({ counts: { people: 2 }, missingSubjectCount: 0 });
const historicalEditDom = stageSandbox.__stage({ assetPlanReady: false, eligibility: { issues: ['person_plan_stale'] } });

// 人物资产页仍保留自身的精确只读控件分类；壳层不再注入第 1 步全局解锁横幅。
assert.match(
  historicalGenerateDom,
  buttonTagWith('data-generate-subject-assets', 'data-history-safe'),
  '人物资产生成按钮必须显式声明为历史资产页仍可执行的动作',
);
assert.match(
  historicalContinueDom,
  buttonTagWith('data-confirm-assets', 'data-history-safe'),
  '人物资产完成后进入场景的动作必须声明为历史安全动作',
);
const historyModule = new Function(`${historySource.replace(/\bexport\s+/g, '')}; return { applyHistoricalReadonlyControls, historicalStepUsesGlobalEdit };`)();
assert.doesNotMatch(app, /applyHistoricalStepMode|data-unlock-history-step|新增\s*\/\s*修改内容/, '壳层不得再插入冗余全局历史编辑入口');
const control = selectors => ({
  disabled: false,
  dataset: {},
  matches: selector => selectors.includes(selector),
});
const controlFromDom = (html, attribute) => {
  const tag = html.match(new RegExp(`<button(?=[^>]*${attribute})[^>]*>`, 'i'))?.[0] || '';
  assert(tag, `最终DOM缺少 ${attribute} 按钮`);
  return control(tag.includes('data-history-safe') ? ['[data-history-safe]'] : []);
};
const safeAction = controlFromDom(historicalGenerateDom, 'data-generate-subject-assets');
const ordinaryAction = control([]);
const editInput = control([]);
const fakeHost = { querySelectorAll: () => [safeAction, ordinaryAction, editInput] };
historyModule.applyHistoricalReadonlyControls(fakeHost);
assert.equal(safeAction.disabled, false, '人物生成/下一步等显式安全动作在历史资产页必须保持可用');
assert.equal(ordinaryAction.disabled, true, '未分类的动作默认必须受保护，防止打开动态编辑面板绕过只读');
assert.equal(editInput.disabled, true, '输入控件在显式解锁前必须保持只读');
assert.doesNotMatch(assets, /data-unlock-history-step|新增\s*\/\s*修改内容/, '人物资产最终 DOM 不得包含第1步的全局新增/修改入口');
assert.doesNotMatch(app, /historicalReadOnly\s*:/, '壳层不得再把第2步后的独立编辑入口降级成公共历史只读模式');
assert.match(assets, /data-asset-id/, '人物资产必须保留本步骤的详情编辑入口');
assert.match(planningDetails, /personEditForm\(item\)/, '人物详情必须保留独立人物编辑表单');
assert.doesNotMatch(planningDetails, /data-drawer-generate/, '人物详情不得继续提供旧的单项付费生成入口');
assert.match(assets, /data-generate-subject-assets/, '历史资产页的人物生成必须使用独立主体入口');
assert.match(assets, /createKeyedRequestGuard\(\)/, '人物图片生成必须按意图复用统一防重入 guard');
assert.match(assets, /subjectRequests\.run\(intent,[\s\S]*await confirmDialog\(/, '防重入 guard 必须包住人物确认与提交链');
assert.match(requestGuards, /if \(guard\.active\) return onSkipped\?\.\(\);[\s\S]*await guard\.run\(operation\)/, '同一意图在确认框打开前必须被 guard 拦截');
assert.match(requestGuards, /try \{ return await operation\(requestKey\); \} finally \{ active = false; \}/, '取消、失败与成功后都必须释放人物生成防重入锁');
assert.match(newStoryAdRoute, /requestKey[\s\S]*idempotencyKey[\s\S]*queueStage\(/, '页面防重入之外，人物生成请求仍必须保留服务端 request_key 幂等兜底');

// 信息架构：剧情不提供商品主体操作；广告主体操作只属于商品分类工具栏。
const modeExpression = assets.match(/const contentMode\s*=\s*([^;]+);/)?.[1];
assert(modeExpression, '资产中心必须先读取项目权威内容类型');
const resolveMode = new Function('bundle', `return ${modeExpression};`);
assert.equal(resolveMode({ project: { content_mode: 'narrative_story' }, brief: { content_mode: null } }), 'narrative_story', 'brief模式为空时必须使用项目权威剧情模式');
assert.equal(resolveMode({ project: { content_mode: 'commercial_subject' }, brief: { content_mode: 'narrative_story' } }), 'commercial_subject', '项目权威广告模式不得被陈旧brief覆盖');
const groupExpression = assets.match(/const assetGroups\s*=\s*([^;]+);/)?.[1];
assert(groupExpression, '资产中心必须按内容类型建立可见分类');
const groupsFor = new Function('narrative', 'GROUPS', `return ${groupExpression};`);
const groupContract = [['people', '人物'], ['animals', '动物'], ['products', '商品 / 展示主体'], ['logos', 'LOGO']];
const narrativeGroups = groupsFor(true, groupContract);
const commercialGroups = groupsFor(false, groupContract);
assert(!narrativeGroups.some(([key]) => key === 'products'), '剧情项目最终分类不得出现商品/展示主体及其添加生成入口');
assert(!narrativeGroups.some(([key]) => key === 'logos'), '剧情项目不得显示广告专属LOGO分类');
assert(commercialGroups.some(([key]) => key === 'products'), '广告项目必须保留商品/展示主体分类');
const renderSectionsSource = functionDeclaration(assets, 'function renderSections');
const renderSections = new Function('emptyState', 'GROUPS', 'escapeHtml', 'assetCard', `${renderSectionsSource}; return renderSections;`)(
  ({ title }) => `<div>${title}</div>`, groupContract, value => String(value || ''), item => `<article>${item.name}</article>`,
);
const commercialProductDom = renderSections({ products: [{ id: 'product-1', name: '商品一' }] }, 1, 'commercial_subject', commercialGroups, '');
assert.match(commercialProductDom, /data-asset-section="products"[\s\S]*data-add-asset="products"[\s\S]*上传商品\/展示主体素材/, '广告商品素材上传必须渲染在商品/展示主体分类内部');
assert.doesNotMatch(commercialProductDom, /data-generate-product-main/, '商品分类不得继续提供旧的独立生成入口');
const commercialEmptyDom = renderSections({}, 0, 'commercial_subject', commercialGroups, '');
assert.match(commercialEmptyDom, /data-asset-section="products" hidden[\s\S]*data-add-asset="products"[\s\S]*上传商品\/展示主体素材/, '广告全部资产为空时仍必须保留可由分类点击显示的商品上传空态');
const narrativeDom = renderSections({ products: [{ id: 'legacy-product', name: '旧主体' }] }, 1, 'narrative_story', narrativeGroups, '');
assert.doesNotMatch(narrativeDom, /data-generate-product-main|商品 \/ 展示主体|legacy-product/, '剧情项目最终资产 DOM 不得泄漏历史商品主体操作');
const viewHead = assets.match(/<section class="view-head">[\s\S]*?<\/section>/)?.[0] || '';
assert.doesNotMatch(viewHead, /data-generate-product-main|添加商品|生成展示主体/, '商品主体操作不得与顶部人物动作并列');

// 已完成第一步时不再重复下一步引导，但失败/运行中的参考操作必须始终可达。
assert.match(
  brief,
  /showReferenceStepGuidance\s*=\s*referenceStepVisible\s*&&\s*bundle\.navigation\?\.steps\?\.brief\?\.completed\s*!==\s*true/,
  'brief 完成态必须继续阻止重复的下一步引导卡',
);
assert.match(brief, /\$\{showReferenceStepGuidance && !referenceAction\.blocked \? `<section[^`]*data-brief-inline-action/s, '下一步卡必须受完成态门禁控制');
assert.match(brief, /referenceProgressMarkup:\s*referenceProgress\(bundle\.reference\)/,
  '对话内停止与失败恢复动作不得受历史完成态门禁控制');

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

async function assertMountedHistoricalControls() {
  const harness = require('./test-story-ad-recovery-plan-action-final-dom-v79');
  const controls = buttons => buttons.map(button => ({
    ...button, dataset: {},
    matches: selector => selector === '[data-history-safe]' && /\bdata-history-safe(?:\s|=|$)/.test(button.attrs),
  }));
  harness.resetStageLoads();
  const eligible = await harness.render({ checkpoint: null, stale: false, historicalReadOnly: true });
  assert.equal(harness.stageLoadCount(), 1, '真实assetCenterView mount必须恰好加载一次资产阶段模块');
  const eligibleControls = controls(eligible.buttons);
  historyModule.applyHistoricalReadonlyControls({ querySelectorAll: () => eligibleControls });
  const generateButton = eligibleControls.find(button => /data-generate-subject-assets\b/.test(button.attrs));
  assert(generateButton && generateButton.disabled === false, '真实mount最终DOM中的历史安全人物按钮必须保持可用');
  assert(eligibleControls.find(button => /data-select-person\b/.test(button.attrs))?.disabled === true,
    '真实mount最终DOM中的人物编辑/替换动作必须继续受历史只读保护');

  harness.resetStageLoads();
  const stale = await harness.render({ checkpoint: null, stale: true, historicalReadOnly: true });
  assert.equal(harness.stageLoadCount(), 1, '人物方案阻断态mount也必须通过同一loader加载阶段模块');
  const staleControls = controls(stale.buttons);
  historyModule.applyHistoricalReadonlyControls({ querySelectorAll: () => staleControls });
  assert(!staleControls.some(button => /data-update-person-plan\b/.test(button.attrs)),
    '历史资产页不得继续渲染旧的人物方案更新按钮');
  const staleGenerate = staleControls.find(button => /data-generate-subject-assets\b/.test(button.attrs));
  assert(staleGenerate && staleGenerate.disabled === false, '失效人物资产必须通过独立人物动作重建');
}

assertMountedHistoricalControls()
  .then(() => console.log('story-ad historical asset action and interaction v61 contracts passed'))
  .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
