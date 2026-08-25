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

function loadBrowserModule(file, exposed, globals = {}) {
  const source = read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
  const sandbox = { ...globals };
  vm.runInNewContext(`${source}\nglobalThis.__tested = { ${exposed.join(', ')} };`, sandbox, { filename: file });
  return sandbox.__tested;
}

const ui = loadBrowserModule('public/story-ad/components/ui.js', ['generationProgressPanel']);
const recoveryBannerUi = loadBrowserModule('public/story-ad/views/billingRecoveryBanner.js', ['renderCheckpointRecoveryBanner']);
const recoveryUi = loadBrowserModule(
  'public/story-ad/views/assetCheckpointRecovery.js',
  ['checkpointRecoverySummary', 'checkpointRecoveryBanner'],
  { escapeHtml, renderCheckpointRecoveryBanner: recoveryBannerUi.renderCheckpointRecoveryBanner },
);
const planStatusUi = loadBrowserModule(
  'public/story-ad/views/assetCenterPlanReleaseStatus.js',
  ['personPlanBlockedView'],
  { personPlanProgressMarkup: () => '', personPlanTechnicalDetails: () => '' },
);

function person(index, completed, label, reason, errorCode) {
  return {
    name: `人物${index}`,
    checkpoint_recovery_summary: {
      completed_units: completed,
      total_units: completed + 1,
      retry_blocked: true,
      missing_units: [{
        key: `person-${index}-missing`, label, reason, error_code: errorCode,
        billing_state: 'unknown', provider_submission_state: 'submitted_unknown', retry_blocked: true,
      }],
    },
  };
}

const people = [
  person(1, 7, '腰部配饰', '内容安全审核未通过，需人工核对后处理', 'PROVIDER_CONTENT_AUDIT'),
  person(2, 6, '腰部配饰', '内容安全审核未通过，需人工核对后处理', 'PROVIDER_CONTENT_AUDIT'),
  person(3, 6, '发饰', '内容安全审核未通过，需人工核对后处理', 'PROVIDER_CONTENT_AUDIT'),
  person(4, 6, '发饰', '多次生成仍未达到质量标准', 'IMAGE_ATTEMPTS_EXHAUSTED'),
];
const bundle = {
  project: { status: 'failed', error: 'provider failure', error_code: 'IMAGE_ATTEMPTS_EXHAUSTED' },
  generation: { progress: { status: 'failed', stage: 'visual_assets', completed: 21, total: 21 } },
  assets: { people }, navigation: { asset_plan_eligibility: { eligible: false } },
};

const summary = recoveryUi.checkpointRecoverySummary(people);
const terminal = ui.generationProgressPanel(bundle, 'assets');
const recovery = recoveryUi.checkpointRecoveryBanner(summary);
const page = `${terminal}${recovery}`;
const failures = [];
const verify = (name, callback) => {
  try { callback(); } catch (error) { failures.push(`${name}: ${error.message}`); }
};

verify('checkpoint summary is authoritative 25/29 with four missing units', () => {
  assert.equal(summary.completed, 25);
  assert.equal(summary.total, 29);
  assert.equal(summary.missing.length, 4);
  assert.equal(summary.retry_blocked, true);
});
verify('asset route renders one primary recovery status instead of terminal plus recovery duplicates', () => {
  assert.equal(terminal, '', 'assets route must suppress the duplicate terminal panel when checkpoint recovery is present');
  assert.equal((page.match(/data-checkpoint-recovery-(?:details|banner)/g) || []).length, 1);
  assert.match(recovery, /25[\s\S]*?\/29/);
});
verify('the one recovery status is an accessible primary alert', () => {
  assert.match(recovery, /data-checkpoint-recovery-banner[^>]*role="alert"|role="alert"[^>]*data-checkpoint-recovery-banner/);
});
verify('four rows are shown once by person with Chinese labels and reasons', () => {
  for (let index = 1; index <= 4; index += 1) {
    assert.equal((page.match(new RegExp(`<li>[\\s\\S]*?<b>人物${index}</b>[\\s\\S]*?</li>`, 'g')) || []).length, 1, `人物${index} must appear once`);
  }
  assert.equal((page.match(/<li>/g) || []).length, 4);
  assert.match(page, /<b>人物1<\/b>[\s\S]*?腰部配饰[\s\S]*?内容安全审核未通过，需人工核对后处理/);
  assert.match(page, /<b>人物4<\/b>[\s\S]*?发饰[\s\S]*?多次生成仍未达到质量标准/);
});
verify('customer UI does not expose internal error codes', () => {
  assert.doesNotMatch(page, /PROVIDER_CONTENT_AUDIT|IMAGE_ATTEMPTS_EXHAUSTED|submitted_unknown|billing_state|UNKNOWN/);
});
verify('pending final DOM keeps the single outcome action visible but disabled until review completes', () => {
  assert.match(recovery, /data-generate-recovery disabled[^>]*>生成剩余 4 项/);
  assert.match(recovery, /data-review-state="pending"/);
  assert.doesNotMatch(recovery, /查看核账进度|data-billing-review|data-accept-billing-risk/);
});
verify('updating the person plan is never presented as missing-image recovery', () => {
  const outside = ui.generationProgressPanel(bundle, 'brief');
  assert.doesNotMatch(page + outside, /更新人物(?:与场景)?方案|data-update-person-plan/);
  const blockedPlan = planStatusUi.personPlanBlockedView({
    eligible: false, visual_recovery_active: true, issues: ['person_plan_stale'],
  }, false);
  assert.equal(blockedPlan, '', '恢复阶段必须完全隐藏人物方案卡，而不是保留禁用说明');
});

const css = read('public/story-ad/workspace.css');
verify('recovery card avoids the wide two-column whitespace layout', () => {
  assert.doesNotMatch(css, /\.asset-checkpoint-recovery\s*\{[^}]*grid-template-columns\s*:\s*minmax\(260px/s);
});
verify('narrow screens keep the four rows single-column and wrap long Chinese reasons', () => {
  assert.match(css, /@media\s*\(max-width\s*:\s*760px\)[\s\S]*?\.asset-checkpoint-recovery\s+ul\s*\{[^}]*grid-template-columns\s*:\s*1fr/s);
  assert.match(css, /\.asset-checkpoint-recovery\s+li\s+span\s*\{[^}]*overflow-wrap\s*:\s*anywhere/s);
});

function fakeNode() {
  const close = { addEventListener() {}, focus() {} };
  return {
    className: '', html: '', dataset: {},
    set innerHTML(value) { this.html = value; }, get innerHTML() { return this.html; },
    addEventListener() {}, remove() {},
    querySelector(selector) { return selector === '[data-close-drawer]' ? close : null; },
    querySelectorAll() { return []; },
  };
}
const fakeDocument = {
  created: [], body: { append() {} }, createElement() { const row = fakeNode(); this.created.push(row); return row; },
  addEventListener() {}, removeEventListener() {},
};
const planning = loadBrowserModule('public/story-ad/views/assetCenterPlanningDetails.js', ['openAssetDrawer'], {
  document: fakeDocument, FormData: class {}, escapeHtml, bindMediaLightbox() {}, bindPersonLookForm() {},
  bindPersonEvolutionForm() {}, bindSceneDossierCard() {}, renderSceneDossierCard: () => '',
  mediaPreview: item => item?.image_url ? `<figure data-preview><img src="${escapeHtml(item.image_url)}"></figure>` : '<div data-placeholder></div>',
  personDossierShowcase: item => `<section class="person-canonical-dossier-board is-large" data-person-dossier-board data-board-state="complete"><img src="${escapeHtml(item.dossier_sheet.image_url)}"></section>`,
});
const renderers = {
  groupLabel: '人物', generatable: true,
  mediaSection: (_title, views) => `<section data-raw-person-views>${views.map(view => `<img src="${escapeHtml(view.image_url)}">`).join('')}</section>`,
  profileDetails: () => '<section data-person-text-profile>人物文字设定</section>',
  legacyDossierBoard: (_item, views) => `<section data-legacy-dossier-board>${views.map(view => `<img src="${escapeHtml(view.image_url)}">`).join('')}</section>`,
  dossierDetails: () => '<section data-dossier-details></section>', personEditForm: () => '<form id="personEditForm" data-person-edit>人物编辑</form>',
};
function drawerHtml(item) {
  fakeDocument.created.length = 0;
  planning.openAssetDrawer(item, 'people', {}, renderers);
  return fakeDocument.created.find(node => /is-person-drawer/.test(node.className))?.innerHTML || '';
}
const completeDrawer = drawerHtml({
  id: 'person-1', name: '人物1', dossier_sheet: { image_url: '/assets/person-1-canonical-dossier.png' },
  view_images: [{ image_url: '/assets/person-1-raw-face.png' }], profile: {}, status: 'verified',
});
verify('editable person drawer starts with its prompt editor and keeps the canonical dossier behind it', () => {
  assert.match(completeDrawer, /person-canonical-dossier-board[^>]*is-large|is-large[^>]*person-canonical-dossier-board/);
  assert.match(completeDrawer, /data-person-dossier-board/);
  const canonical = completeDrawer.indexOf('/assets/person-1-canonical-dossier.png');
  assert.ok(completeDrawer.indexOf('data-person-edit') >= 0 && completeDrawer.indexOf('data-person-edit') < canonical);
  assert.ok(canonical >= 0 && canonical < completeDrawer.indexOf('data-raw-person-views'));
  assert.doesNotMatch(completeDrawer, /data-person-text-profile/);
  assert.doesNotMatch(completeDrawer.slice(0, canonical), /person-1-raw-face|person-2/);
});
const partialDrawer = drawerHtml({
  id: 'person-1', subject_id: 'person-1', name: '人物1', partial_checkpoint: true,
  image_url: '/assets/person-1-face-single.png', cover_image_url: '/assets/person-1-identity-atlas.png',
  view_images: [{ image_url: '/assets/person-1-face-single.png' }],
  category_atlases: [
    { key: 'body_1', subject_id: 'person-2', image_url: '/assets/person-2-body-atlas.png' },
    { key: 'identity_1', subject_id: 'person-1', image_url: '/assets/person-1-identity-atlas.png' },
    { key: 'body_1', subject_id: 'person-1', image_url: '/assets/person-1-body-atlas.png' },
  ], profile: {}, checkpoint_recovery_summary: { retry_blocked: true }, status: 'partial',
});
verify('partial person drawer starts with that person canonical atlas board and marks partial', () => {
  assert.match(partialDrawer, /data-person-dossier-board/);
  assert.match(partialDrawer, /is-large/);
  assert.match(partialDrawer, /data-board-state="partial"|data-partial(?:="true")?/);
  const canonical = partialDrawer.indexOf('/assets/person-1-body-atlas.png');
  assert.ok(canonical >= 0 && canonical < partialDrawer.indexOf('data-raw-person-views'));
  assert.doesNotMatch(partialDrawer.slice(0, partialDrawer.indexOf('data-raw-person-views')), /person-2-body-atlas|person-1-identity-atlas|person-1-face-single/);
});

if (failures.length) {
  throw new Error(`V70 final DOM acceptance is red (${failures.length}):\n- ${failures.join('\n- ')}`);
}
console.log(JSON.stringify({ passed: true, completed: summary.completed, total: summary.total, missing: summary.missing.length, paid_model_calls: 0 }));
