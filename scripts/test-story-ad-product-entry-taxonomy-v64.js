'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8')
  .replace(/^import\s+.*?;\s*$/gm, '')
  .replace(/\bexport\s+/g, '');

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function guard() {
  return { run: async (...args) => {
    const operation = args.find(value => typeof value === 'function');
    return operation ? operation('request-key') : false;
  } };
}

const billingBindingSource = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterBillingRetry.js'), 'utf8')
  .replace(/^import\s+.*?;\s*$/gm, '')
  .replace(/\bexport\s+/g, '');
const billingBindingSandbox = {
  request: async () => ({}),
  setButtonBusy() {},
  toast() {},
  setTimeout() {},
  document: { visibilityState: 'visible' },
};
vm.runInNewContext(`${billingBindingSource}\nglobalThis.__bindSubjectBillingRecovery = bindSubjectBillingRecovery;`, billingBindingSandbox, {
  filename: 'assetCenterBillingRetry.js',
});
const realBindSubjectBillingRecovery = billingBindingSandbox.__bindSubjectBillingRecovery;
const billingRecoveryBindings = [];
let subjectConfirmationCalls = 0;
const sandbox = {
  __loadAssetCheckpointRecovery: async () => ({
    checkpointRecoverySummary: () => ({ completed: 0, total: 0, missing: [], retry_blocked: false }),
    checkpointRecoveryBanner: () => '',
  }),
  __loadAssetCenterStage: async () => ({ assetPlanStageView: ({ missingSubjectCount = 0 } = {}) => `<section data-plan-stage>${missingSubjectCount ? '<button data-generate-subject-assets>生成人物资产</button>' : ''}</section>` }),
  request: async () => ({}),
  bindMediaLightbox() {},
  emptyState: ({ title = '', body = '', action = '', actionId = '' } = {}) => `<section data-empty><b>${title}</b><p>${body}</p><button data-empty-action="${actionId}">${action}</button></section>`,
  escapeHtml,
  setButtonBusy() {},
  toast() {},
  confirmDialog: async message => { subjectConfirmationCalls += 1; assert.equal(message, '本次会生成完整人物、穿搭配饰、随身物、动作表情。'); return false; },
  openActorLibrary() {},
  openRealPersonFlow() {},
  authorizeBillingReviews: async () => {},
  bindSubjectBillingRecovery(options) {
    billingRecoveryBindings.push(options);
    return realBindSubjectBillingRecovery(options);
  },
  confirmBillingAwareAction: async () => ({ accepted: false }),
  recoveryRequestKey: () => 'subject-click-regression',
  ensureSubjectRecoveryReady: async () => true,
  collectPersonLookValues: values => values,
  renderPersonLookTiles: () => '',
  legacyDossierBoard: () => '',
  mediaSection: () => '',
  assetCardMedia: () => '<span data-media></span>',
  assertSavedPerson() {},
  personAgeDisplay: profile => profile.age || profile.age_range || '',
  personAssetState: () => 'missing_dossier',
  personLookSummary: () => '',
  bindPersonEvolutionForm() {},
  collectPersonEvolutionValues: values => values,
  renderPersonEvolutionSummary: () => '',
  createKeyedRequestGuard: guard,
  createPersonPlanRequestGuard: guard,
  personPlanBlockedView: () => '<section data-plan-blocked></section>',
  checkpointRecoverySummary: people => {
    const missing = people.flatMap(item => item.checkpoint_recovery_summary?.missing_units || []);
    return { completed: 0, total: missing.length, missing, retry_blocked: missing.some(unit => unit.retry_blocked), billing_review_state: 'not_billed' };
  },
};
vm.runInNewContext(`${source}\nglobalThis.__tested = { mount };`, sandbox, { filename: 'assetCenterView.js' });

function control() {
  return {
    dataset: {}, files: [], value: '', disabled: false,
    handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    click() { return this.handlers.click?.({ currentTarget: this, stopPropagation() {} }); },
    classList: { toggle() {} },
  };
}

function person() {
  return {
    id: 'person-1', asset_id: 'person-1', subject_id: 'person-1', name: '林清', status: 'verified',
    profile: {
      id: 'person-1', displayName: '林清', roleName: '主角', age: '28岁',
      ethnicity: '未指定（原创角色，可修改）', appearanceText: '原创人物外貌',
      hairMakeupText: '自然发型', look_profiles: [{ id: 'look-1', wardrobeText: '原创日常服装' }],
    },
  };
}

function product() {
  return {
    id: 'product-1', asset_id: 'product-1', name: '智能门锁', status: 'draft',
    presentation: { label: '商品主体', standalone_generation_supported: true },
  };
}

async function render(contentMode, products = [], { includePerson = true } = {}) {
  let html = '';
  let filters = [];
  let sections = [];
  const controls = new Map();
  const host = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      filters = [...value.matchAll(/<button[^>]*data-asset-filter="([^"]+)"[^>]*>/g)].map(match => ({
        ...control(), dataset: { assetFilter: match[1] },
      }));
      sections = [...value.matchAll(/<section[^>]*data-asset-section="([^"]+)"([^>]*)>/g)].map(match => ({
        ...control(), dataset: { assetSection: match[1] }, hidden: /\shidden(?:\s|>|$)/.test(match[2]),
      }));
    },
    querySelectorAll(selector) {
      if (selector === '[data-asset-filter]') return filters;
      if (selector === '[data-asset-section]') return sections;
      return [];
    },
    querySelector(selector) {
      const attribute = selector.match(/^\[([^\]]+)\]$/)?.[1];
      if (attribute && !html.includes(attribute)) return null;
      if (!controls.has(selector)) controls.set(selector, control());
      return controls.get(selector);
    },
  };
  const bundle = {
    project: { id: `task-${contentMode}`, active_generation_id: '', content_mode: contentMode },
    revisions: { content: 1 },
    // 生产 bundle 的 content_mode 权威值位于 project；brief 可能不投影该字段。
    brief: { content_mode: null, text: '测试目标', cast_mode: 'single', product_subject: products[0]?.name || '' },
    navigation: { asset_plan_eligibility: { eligible: true, person: { eligible: true } } },
    assets: { people: includePerson ? [person()] : [], animals: [], products, logos: [], scenes: [] },
  };
  await sandbox.__tested.mount(host, {
    store: { runStage: async () => {}, updateRequest: async () => bundle },
    bundle, refreshShell: async () => {}, refreshCurrentView: async () => {}, navigate() {},
  });
  return { html: host.innerHTML, host, filters, sections, controls };
}

function buttonTag(html, attribute) {
  const match = html.match(new RegExp(`<button(?=[^>]*${attribute})[^>]*>`, 'i'));
  assert(match, `缺少按钮：${attribute}`);
  return match[0];
}

function viewHead(html) {
  const match = html.match(/<section class="view-head">[\s\S]*?<\/section>/);
  assert(match, '缺少资产中心顶栏');
  return match[0];
}

(async () => {
  const narrativeResult = await render('narrative_story', [product()]);
  const narrative = narrativeResult.html;
  assert.doesNotMatch(viewHead(narrative), /data-generate-product-main/, '剧情项目顶栏不得出现商品/展示主体入口');
  assert.doesNotMatch(narrative, /data-asset-filter="products"/, '剧情项目不得出现商品/展示主体分类');
  assert.doesNotMatch(narrative, /data-asset-section="products"|data-add-asset="products"|data-generate-product=/, '剧情项目任何资产分类都不得泄漏展示主体添加或生成入口');
  assert.doesNotMatch(narrative, /data-asset-filter="logos"|data-asset-section="logos"|data-add-asset="logos"/, '剧情项目不得显示广告专用LOGO分类或添加入口');
  assert.match(narrative, /data-select-person/, '剧情项目必须保留选择已有人物素材');
  assert.match(narrative, /data-upload-real-person/, '剧情项目必须保留上传真人素材');
  assert.doesNotMatch(narrative, /data-generate-subjects/, '剧情项目不得继续暴露旧人物/动物单项生成入口');
  const subjectButton = narrativeResult.controls.get('[data-generate-subject-assets]');
  assert(subjectButton, '人物主按钮必须完成真实事件绑定');
  await subjectButton.click();
  assert.equal(subjectConfirmationCalls, 1, '点击人物主按钮必须进入确认框，不能因未定义的恢复状态静默失败');

  const narrativeNoAssets = (await render('narrative_story', [], { includePerson: false })).html;
  assert.match(narrativeNoAssets, /当前项目还没有可用资产/, '剧情总资产为0时必须保留正常空状态');
  assert.doesNotMatch(
    narrativeNoAssets,
    /商品(?:\s*\/\s*展示主体)?素材|商品、LOGO|data-asset-filter="(?:products|logos)"|data-asset-section="(?:products|logos)"/,
    'project明确剧情、brief模式为空且total=0时，空状态和分类都不得泄漏广告商品或LOGO',
  );

  const commercialEmpty = await render('commercial_subject', []);
  assert.doesNotMatch(viewHead(commercialEmpty.html), /data-generate-product-main/, '广告项目顶栏人物动作组不得混入展示主体入口');
  assert.match(commercialEmpty.html, /data-select-person/);
  assert.match(commercialEmpty.html, /data-upload-real-person/);
  assert.doesNotMatch(commercialEmpty.html, /data-generate-subjects/);
  assert.match(commercialEmpty.html, /data-asset-filter="products"/, '广告项目必须保留商品/展示主体分类');
  const productTab = commercialEmpty.filters.find(item => item.dataset.assetFilter === 'products');
  assert(productTab, '广告商品分类必须可点击');
  await productTab.click();
  assert.equal(commercialEmpty.sections.find(item => item.dataset.assetSection === 'products')?.hidden, false, '点击空商品分类后必须显示分类内添加入口');
  assert.doesNotMatch(commercialEmpty.html, /data-generate-product-main/, '商品分类不得继续暴露独立生成入口');
  const addProduct = buttonTag(commercialEmpty.html, 'data-add-asset="products"');
  assert.doesNotMatch(addProduct, /\sdisabled(?:\s|>|=)/, '广告商品分类内的添加入口必须可操作');

  const commercialNoAssets = await render('commercial_subject', [], { includePerson: false });
  assert(commercialNoAssets.sections.some(item => item.dataset.assetSection === 'products'), '广告总资产为0时也必须渲染商品分类，不能只返回全局空状态');
  const noAssetsProductSection = commercialNoAssets.sections.find(item => item.dataset.assetSection === 'products');
  assert.equal(noAssetsProductSection.hidden, true, '总资产为0时All视图可以隐藏空商品分类');
  await commercialNoAssets.filters.find(item => item.dataset.assetFilter === 'products')?.click();
  assert.equal(noAssetsProductSection.hidden, false, '总资产为0时点击商品分类仍须显示添加入口');
  await commercialNoAssets.filters.find(item => item.dataset.assetFilter === 'all')?.click();
  assert.equal(noAssetsProductSection.hidden, true, '从空商品分类返回All后应再次隐藏0项分类');

  const commercialExisting = (await render('commercial_subject', [product()])).html;
  assert.doesNotMatch(commercialExisting, /data-generate-product=/, '已有商品也必须进入统一制作图谱，不得单独生成');

  assert.equal(billingRecoveryBindings.length, 0, '统一制作图谱不得绑定旧视觉资产计费恢复入口');

  console.log('story-ad product entry taxonomy v64 passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
