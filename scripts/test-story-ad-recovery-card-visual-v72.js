'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const source = `${read('public/story-ad/views/billingRecoveryBanner.js')}\n${read('public/story-ad/views/assetCheckpointRecovery.js')}`
  .replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
const sandbox = { escapeHtml };
vm.runInNewContext(`${source}\nglobalThis.__tested={checkpointRecoverySummary,checkpointRecoveryBanner};`, sandbox, { filename: 'assetCheckpointRecovery.js' });

const people = [7, 6, 6, 6].map((completed, index) => ({
  name: `人物${index + 1}`,
  checkpoint_recovery_summary: {
    completed_units: completed, total_units: completed + 1, retry_blocked: true,
    missing_units: [{
      label: index < 2 ? '腰部配饰' : '发饰',
      reason: index === 3 ? '多次生成仍未达到质量标准，需要平台确认本次结果和计费后处理' : '内容安全审核未通过，需要平台人工核对后处理',
      error_code: index === 3 ? 'IMAGE_ATTEMPTS_EXHAUSTED' : 'PROVIDER_CONTENT_AUDIT', retry_blocked: true,
    }],
  },
}));
const summary = sandbox.__tested.checkpointRecoverySummary(people);
const html = sandbox.__tested.checkpointRecoveryBanner(summary);
const css = `${read('public/story-ad/styles.css')}\n${read('public/story-ad/workspace.css')}`;
const failures = [];
const verify = (name, callback) => { try { callback(); } catch (error) { failures.push(`${name}: ${error.message}`); } };

verify('one accessible recovery card keeps 25/29 as the main hierarchy', () => {
  assert.equal((html.match(/data-checkpoint-recovery-banner/g) || []).length, 1);
  assert.match(html, /data-checkpoint-recovery-banner[^>]*role="alert"|role="alert"[^>]*data-checkpoint-recovery-banner/);
  assert.match(html.replace(/<[^>]+>/g, ''), /25\s*\/29/);
  assert.equal(summary.completed, 25); assert.equal(summary.total, 29); assert.equal(summary.missing.length, 4);
});
verify('header has three deliberate zones and a dedicated metric hierarchy', () => {
  assert.match(html, /asset-recovery-copy/);
  assert.match(html, /asset-recovery-metric/);
  assert.match(html, /asset-recovery-action/);
  const metric = html.match(/<(?:div|aside)[^>]*asset-recovery-metric[^>]*>[\s\S]*?<\/(?:div|aside)>/)?.[0] || '';
  assert.match(metric.replace(/<[^>]+>/g, ''), /25\s*\/29/);
  assert.match(metric, /(?:已[^<]{0,6}保留|完成|人物图片)/);
  assert.match(css, /\.asset-checkpoint-recovery\s+header\s*\{[^}]*grid-template-columns\s*:\s*(?:auto\s+minmax\(0,1fr\)\s+auto|minmax\(0,1fr\)\s+auto\s+auto)/s);
  assert.match(css, /\.asset-recovery-metric\s*\{[^}]*display\s*:\s*(?:grid|flex)/s);
});
verify('status label is integrated and not a floating bordered global pill', () => {
  const status = html.match(/<span[^>]*>[\s\S]*?平台核账中<\/span>/)?.[0] || '';
  assert.ok(status);
  assert.doesNotMatch(status, /status-tag/);
  assert.match(status, /asset-(?:checkpoint-)?recovery-(?:eyebrow|kicker|state)/);
  const stateCss = css.match(/\.asset-recovery-state\s*\{([^}]*)\}/s)?.[1] || '';
  assert.doesNotMatch(stateCss, /(?:border(?:-radius)?|background|padding)\s*:/, 'status must read as inline hierarchy, not a floating chip');
});
verify('header is compact, aligned, and does not create a large empty column', () => {
  assert.match(css, /\.asset-checkpoint-recovery\s*\{[^}]*padding\s*:/s);
  assert.match(css, /\.asset-checkpoint-recovery\s+header\s*\{[^}]*grid-template-columns\s*:\s*(?:auto\s+minmax\(0,1fr\)\s+auto|minmax\(0,1fr\)\s+auto\s+auto)/s);
  assert.doesNotMatch(css, /\.asset-checkpoint-recovery\s+header\s*\{[^}]*min-height\s*:/s);
});
verify('pending review exposes one quiet status action with hover and focus highlight', () => {
  const actions = [...html.matchAll(/<(?:a|button)\b[^>]*>[\s\S]*?<\/(?:a|button)>/g)].map(match => match[0]);
  assert.equal(actions.length, 1);
  assert.match(actions[0], /查看核账进度/);
  assert.doesNotMatch(actions[0], /\bprimary\b|is-warning|is-success/);
  assert.doesNotMatch(actions[0], /生成|重试|更新人物方案/);
  assert.match(css, /\.btn:not\(:disabled\):hover[\s\S]*?border-color\s*:\s*var\(--mint\)/);
  assert.match(css, /\.btn:focus-visible[\s\S]*?border-color\s*:\s*var\(--mint\)/);
});
verify('pointer rest state stays neutral after click and blocked next-step is not styled as a primary call to action', () => {
  assert.doesNotMatch(css, /\.asset-card:hover\s*,\s*\.asset-card:focus-within\s*\{[^}]*(?:border-color|box-shadow)\s*:/s);
  const nextStepCss = css.match(/\.asset-visual-next-step\s*\{([^}]*)\}/s)?.[1] || '';
  assert.doesNotMatch(nextStepCss, /border-color\s*:\s*color-mix\([^;]*var\(--mint\)/);
  assert.doesNotMatch(nextStepCss, /background\s*:\s*linear-gradient\([^;]*var\(--mint\)/);
});
verify('progress is restrained rather than a bright full-width primary stripe', () => {
  if (/asset-checkpoint-track/.test(html)) {
    assert.match(css, /\.asset-checkpoint-track\s*\{[^}]*height\s*:\s*[34]px/s);
    const fill = css.match(/\.asset-checkpoint-track\s+i\s*\{([^}]*)\}/s)?.[1] || '';
    assert.match(fill, /color-mix|var\(--muted\)|var\(--surface-3\)/);
    assert.doesNotMatch(fill, /background\s*:\s*var\(--mint\)\s*(?:;|$)/);
  } else {
    assert.match(html, /asset-recovery-list-head/, 'removing the bright stripe must retain a quiet progress/detail hierarchy');
  }
});
verify('four people form a clear wide grid and a readable narrow single column', () => {
  assert.equal((html.match(/<li>/g) || []).length, 4);
  for (let index = 1; index <= 4; index += 1) assert.match(html, new RegExp(`<b>人物${index}</b>`));
  assert.match(css, /\.asset-checkpoint-recovery\s+ul\s*\{[^}]*grid-template-columns\s*:\s*repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css, /@media\s*\(max-width\s*:\s*760px\)[\s\S]*?\.asset-checkpoint-recovery\s+ul\s*\{[^}]*grid-template-columns\s*:\s*1fr/s);
  assert.match(css, /\.asset-checkpoint-recovery\s+li\s+span[^{,]*\{[^}]*overflow-wrap\s*:\s*anywhere/s);
  assert.match(css, /\.asset-checkpoint-recovery\s+li\s+(?:small|p)\s*\{[^}]*overflow-wrap\s*:\s*anywhere/s);
  assert.match(css, /\.asset-checkpoint-recovery\s+li\s+(?:small|p)\s*\{[^}]*font-size\s*:\s*(?:12|13|14)px/s);
});
verify('safe user-facing state remains explicit and contains no internal controls or codes', () => {
  assert.match(html, /核账中/); assert.match(html, /核账完成前不能授权或生成/);
  assert.match(html, /内容安全审核未通过/); assert.match(html, /多次生成仍未达到质量标准/);
  assert.doesNotMatch(html, /PROVIDER_CONTENT_AUDIT|IMAGE_ATTEMPTS_EXHAUSTED|submitted_unknown|UNKNOWN/);
  assert.match(html, /data-billing-review/);
  assert.doesNotMatch(html, /data-update-person-plan|data-generate|data-billing-risk-accept|重试/);
});

function loadAssetCard() {
  const code = read('public/story-ad/views/assetCenterView.js').replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
  const guard = () => ({ run: async operation => operation('test-key') });
  const globals = {
    escapeHtml, assetCardMedia: () => '<div data-person-preview></div>', renderPersonLookTiles: () => '', renderPersonEvolutionSummary: () => '',
    personLookSummary: () => '', personAgeDisplay: () => '25~35岁', personAssetState: () => 'upgrade_required', sceneNeedsGeneration: () => false,
    request() {}, bindMediaLightbox() {}, emptyState() {}, setButtonBusy() {}, toast() {}, confirmDialog() {}, openActorLibrary() {}, openRealPersonFlow() {},
    authorizeBillingReviews() {}, confirmBillingAwareAction() {}, collectPersonLookValues() {}, legacyDossierBoard() {}, mediaSection() {}, assertSavedPerson() {},
    bindPersonEvolutionForm() {}, collectPersonEvolutionValues() {}, createKeyedRequestGuard: guard, createPersonPlanRequestGuard: guard, personPlanBlockedView() {},
  };
  vm.runInNewContext(`${code}\nglobalThis.__assetCard=assetCard;globalThis.__checkpointDetails=drawerCheckpointDetails;`, globals, { filename: 'assetCenterView.js' });
  return globals;
}
const partialPerson = {
  id: 'person-1', subject_id: 'person-1', name: '人物1', partial_checkpoint: true, completed_checkpoint_units: 7, profile: {},
  failed_checkpoint_units: [{ key: 'waist', unit: 'wearable_accessory:waist_accessories', reason: '内容安全审核未通过，需要平台人工核对后处理', error_code: 'PROVIDER_CONTENT_AUDIT' }],
  checkpoint_recovery_summary: { retry_blocked: true, missing_units: [{ key: 'waist', label: '腰部配饰', reason: '内容安全审核未通过，需要平台人工核对后处理' }] },
};
verify('person card does not repeat the project recovery failure banner', () => {
  assert.doesNotMatch(loadAssetCard().__assetCard(partialPerson, 'people'), /data-asset-failure-banner|asset-failure-banner/);
});

function fakeNode() {
  const close = { addEventListener() {}, focus() {} };
  return { className: '', html: '', set innerHTML(value) { this.html = value; }, get innerHTML() { return this.html; }, addEventListener() {}, remove() {},
    querySelector(selector) { return selector === '[data-close-drawer]' ? close : null; }, querySelectorAll() { return []; } };
}
const fakeDocument = { created: [], body: { append() {} }, createElement() { const node = fakeNode(); this.created.push(node); return node; }, addEventListener() {}, removeEventListener() {} };
const planningSource = read('public/story-ad/views/assetCenterPlanningDetails.js').replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
const planningGlobals = {
  document: fakeDocument, FormData: class {}, escapeHtml, bindMediaLightbox() {}, bindPersonLookForm() {}, bindPersonEvolutionForm() {},
  bindSceneDossierCard() {}, renderSceneDossierCard: () => '', personDossierShowcase: () => '',
  mediaPreview: item => item?.image_url ? `<img src="${escapeHtml(item.image_url)}">` : '<div></div>',
};
vm.runInNewContext(`${planningSource}\nglobalThis.__openDrawer=openAssetDrawer;`, planningGlobals, { filename: 'assetCenterPlanningDetails.js' });
fakeDocument.created.length = 0;
planningGlobals.__openDrawer({
  ...partialPerson, image_url: '/assets/person-1-face.png', view_images: [{ image_url: '/assets/person-1-face.png' }], category_atlases: [], status: 'partial',
}, 'people', {}, {
  groupLabel: '人物', generatable: true, mediaSection: () => '<section data-raw></section>', profileDetails: () => '<section data-profile></section>',
  legacyDossierBoard: () => '<section data-board></section>', dossierDetails: () => '', checkpointDetails: loadAssetCard().__checkpointDetails, personEditForm: () => '<form id="personEditForm" data-person-edit></form>',
});
const drawer = fakeDocument.created.find(node => /is-person-drawer/.test(node.className))?.innerHTML || '';
verify('person drawer retains the missing-unit details after card deduplication', () => {
  assert.match(drawer, /data-drawer-checkpoint-details/);
  assert.match(drawer, /腰部配饰/);
  assert.match(drawer, /内容安全审核未通过，需要平台人工核对后处理/);
  assert.doesNotMatch(drawer, /PROVIDER_CONTENT_AUDIT/);
});

if (failures.length) throw new Error(`V72 recovery visual acceptance is red (${failures.length}):\n- ${failures.join('\n- ')}`);
console.log(JSON.stringify({ passed: true, completed: 25, total: 29, people: 4, paid_model_calls: 0 }));
