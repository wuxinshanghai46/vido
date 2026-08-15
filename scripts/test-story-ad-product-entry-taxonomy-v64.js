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

const sandbox = {
  __loadAssetCheckpointRecovery: async () => ({
    checkpointRecoverySummary: () => ({ completed: 0, total: 0, missing: [], retry_blocked: false }),
    checkpointRecoveryBanner: () => '',
  }),
  request: async () => ({}),
  bindMediaLightbox() {},
  emptyState: ({ title = '', body = '', action = '', actionId = '' } = {}) => `<section data-empty><b>${title}</b><p>${body}</p><button data-empty-action="${actionId}">${action}</button></section>`,
  escapeHtml,
  setButtonBusy() {},
  toast() {},
  confirmDialog: async () => false,
  openActorLibrary() {},
  openRealPersonFlow() {},
  authorizeBillingReviews: async () => {},
  confirmBillingAwareAction: async () => ({ accepted: false }),
  collectPersonLookValues: values => values,
  renderPersonLookTiles: () => '',
  legacyDossierBoard: () => '',
  mediaSection: () => '',
  assetCardMedia: () => '<span data-media></span>',
  assertSavedPerson() {},
  personAgeDisplay: profile => profile.age || profile.age_range || '',
  personAssetState: () => 'complete_dossier',
  personLookSummary: () => '',
  bindPersonEvolutionForm() {},
  collectPersonEvolutionValues: values => values,
  renderPersonEvolutionSummary: () => '',
  createKeyedRequestGuard: guard,
  createPersonPlanRequestGuard: guard,
  personPlanBlockedView: () => '<section data-plan-blocked></section>',
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
    querySelector: () => control(),
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
  return { html: host.innerHTML, host, filters, sections };
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
  const narrative = (await render('narrative_story', [product()])).html;
  assert.doesNotMatch(viewHead(narrative), /data-generate-product-main/, '剧情项目顶栏不得出现商品/展示主体入口');
  assert.doesNotMatch(narrative, /data-asset-filter="products"/, '剧情项目不得出现商品/展示主体分类');
  assert.doesNotMatch(narrative, /data-asset-section="products"|data-add-asset="products"|data-generate-product=/, '剧情项目任何资产分类都不得泄漏展示主体添加或生成入口');
  assert.doesNotMatch(narrative, /data-asset-filter="logos"|data-asset-section="logos"|data-add-asset="logos"/, '剧情项目不得显示广告专用LOGO分类或添加入口');
  assert.match(narrative, /data-select-person/, '剧情项目必须保留选择已有人物素材');
  assert.match(narrative, /data-upload-real-person/, '剧情项目必须保留上传真人素材');
  assert.match(narrative, /data-generate-subjects/, '剧情项目必须保留人物/动物生成入口');

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
  assert.match(commercialEmpty.html, /data-generate-subjects/);
  assert.match(commercialEmpty.html, /data-asset-filter="products"/, '广告项目必须保留商品/展示主体分类');
  const productTab = commercialEmpty.filters.find(item => item.dataset.assetFilter === 'products');
  assert(productTab, '广告商品分类必须可点击');
  await productTab.click();
  assert.equal(commercialEmpty.sections.find(item => item.dataset.assetSection === 'products')?.hidden, false, '点击空商品分类后必须显示分类内添加入口');
  const createProduct = buttonTag(commercialEmpty.html, 'data-generate-product-main');
  assert.match(createProduct, /data-history-safe/, '分类内添加/生成展示主体属于二次确认后的安全执行动作，历史步骤不得误锁');
  assert.doesNotMatch(createProduct, /\sdisabled(?:\s|>|=)/, '分类内添加/生成展示主体必须可操作');
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
  const generateProduct = buttonTag(commercialExisting, 'data-generate-product="product-1"');
  assert.match(generateProduct, /data-history-safe/, '商品生成属于有二次确认的历史安全执行动作');
  assert.doesNotMatch(generateProduct, /\sdisabled(?:\s|>|=)/, '已有商品的分类内生成入口必须可操作');

  console.log('story-ad product entry taxonomy v64 passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
