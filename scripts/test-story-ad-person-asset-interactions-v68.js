'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const projection = require('../src/services/newStoryAd/subjectCheckpointProjectionService');
const dossierComposites = require('../src/services/newStoryAd/dossierCompositeService');
const subjectBundle = require('../src/services/newStoryAd/subjectAssetBundleService');

function loadBrowserModule(file, exposed, globals = {}) {
  const source = read(file)
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/\bexport\s+/g, '');
  const sandbox = { ...globals };
  vm.runInNewContext(`${source}\nglobalThis.__tested = { ${exposed.join(', ')} };`, sandbox, { filename: file });
  return sandbox.__tested;
}

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const mediaPreview = (item = {}, options = {}) => item.image_url
  ? `<button data-media-zoom-url="${escapeHtml(item.image_url)}" data-media-zoom-label="${escapeHtml(options.label || '')}"><img src="${escapeHtml(item.image_url)}"></button>`
  : '<div class="media-placeholder"></div>';

class EventNode {
  constructor(name = '') {
    this.name = name;
    this.dataset = {};
    this.handlers = new Map();
    this.style = {};
    this.hidden = false;
    this.removed = false;
    this.className = '';
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach(value => this.classList.values.add(value)),
      remove: (...values) => values.forEach(value => this.classList.values.delete(value)),
      toggle: (value, force) => {
        const enabled = force === undefined ? !this.classList.values.has(value) : Boolean(force);
        if (enabled) this.classList.values.add(value); else this.classList.values.delete(value);
        return enabled;
      },
    };
  }
  addEventListener(type, handler) {
    const rows = this.handlers.get(type) || [];
    rows.push(handler);
    this.handlers.set(type, rows);
  }
  removeEventListener(type, handler) {
    this.handlers.set(type, (this.handlers.get(type) || []).filter(row => row !== handler));
  }
  dispatch(type, values = {}) {
    const event = {
      target: this, currentTarget: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
      ...values,
    };
    (this.handlers.get(type) || []).forEach(handler => handler(event));
    return event;
  }
  setAttribute(name, value) { this[name] = String(value); }
  removeAttribute(name) { delete this[name]; }
  remove() { this.removed = true; }
}

class LightboxFixture {
  constructor() {
    this.trigger = new EventNode('trigger');
    Object.assign(this.trigger.dataset, {
      mediaZoomUrl: '/assets/person-original.png',
      mediaPreviewUrl: '/assets/person-preview.png',
      mediaZoomLabel: '人物主图', mediaZoomGroup: 'person',
    });
    this.trigger.closest = selector => selector === '[data-media-zoom-url]' ? this.trigger : null;
    this.scope = new EventNode('scope');
    this.scope.contains = node => node === this.trigger;
    this.scope.querySelectorAll = selector => selector === '[data-media-zoom-url]' ? [this.trigger] : [];
    this.image = new EventNode('image');
    this.image.complete = true;
    this.image.naturalWidth = 2048;
    this.image.naturalHeight = 2048;
    this.image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 800 });
    this.image.setPointerCapture = id => { this.image.capturedPointerId = id; };
    this.image.removeAttribute = name => { if (name === 'src') this.image.src = ''; };
    this.caption = new EventNode('caption');
    this.counter = new EventNode('counter');
    this.zoomLevel = new EventNode('zoom-level');
    this.pixelSize = new EventNode('pixel-size');
    this.strip = new EventNode('strip');
    this.strip.buttons = [];
    Object.defineProperty(this.strip, 'innerHTML', {
      set: html => {
        this.strip.buttons = [...html.matchAll(/data-lightbox-index="(\d+)"/g)].map(match => {
          const button = new EventNode('thumbnail');
          button.dataset.lightboxIndex = match[1];
          return button;
        });
      },
    });
    this.strip.querySelectorAll = selector => selector === '[data-lightbox-index]' ? this.strip.buttons : [];
    this.close = new EventNode('close');
    this.prev = new EventNode('prev');
    this.next = new EventNode('next');
    this.zoomIn = new EventNode('zoom-in');
    this.zoomOut = new EventNode('zoom-out');
    this.zoomReset = new EventNode('zoom-reset');
    this.overlay = new EventNode('overlay');
    Object.defineProperty(this.overlay, 'innerHTML', { set: () => {} });
    this.overlay.querySelector = selector => ({
      img: this.image,
      'figcaption span': this.caption,
      'figcaption b': this.counter,
      '.media-lightbox-strip': this.strip,
      '[data-media-zoom-level]': this.zoomLevel,
      '[data-media-pixel-size]': this.pixelSize,
      '.media-lightbox-close': this.close,
      '.is-prev': this.prev,
      '.is-next': this.next,
      '[data-media-zoom-in]': this.zoomIn,
      '[data-media-zoom-out]': this.zoomOut,
      '[data-media-zoom-reset]': this.zoomReset,
    })[selector] || null;
    this.overlay.querySelectorAll = selector => selector === '.media-lightbox-nav' ? [this.prev, this.next] : [];
    this.document = new EventNode('document');
    this.document.querySelector = () => null;
    this.document.createElement = tag => {
      assert.equal(tag, 'div');
      return this.overlay;
    };
    this.document.body = { appendChild: node => { this.appended = node; } };
  }
}

function checkpointFixture() {
  return {
    status: 'failed', updated_at: '2026-08-15T08:00:00.000Z',
    person_dossier_checkpoints: {
      portrait: {
        key: 'portrait', unit: 'face_master', status: 'completed',
        provider_submission_state: 'completed', billing_state: 'confirmed',
        result: { kind: 'face_master', key: 'face', image_url: '/api/new-story-ad/assets/person-face.png' },
      },
      walk: {
        key: 'walk', unit: 'base_action:natural_walk', status: 'failed',
        provider_submission_state: 'not_submitted', billing_state: 'not_submitted',
        error: { code: 'IMAGE_ATTEMPTS_EXHAUSTED', message: '三次质量审核未通过' },
      },
    },
    subject_checkpoint_owners: {
      portrait: { kind: 'human', subject_id: 'person-1', index: 0 },
      walk: { kind: 'human', subject_id: 'person-1', index: 0 },
    },
  };
}

function assetCardRenderer() {
  const source = read('public/story-ad/views/assetCenterView.js')
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/\bexport\s+/g, '');
  const guard = () => ({ run: async operation => operation('test-key') });
  const sandbox = {
    escapeHtml, assetCardMedia: () => '<div data-card-media></div>', renderPersonLookTiles: () => '',
    renderPersonEvolutionSummary: () => '', personLookSummary: () => '', personAgeDisplay: () => '25~35岁',
    personAssetState: () => 'upgrade_required', sceneNeedsGeneration: () => false,
    request() {}, bindMediaLightbox() {}, emptyState() {}, setButtonBusy() {}, toast() {}, confirmDialog() {},
    openActorLibrary() {}, openRealPersonFlow() {}, authorizeBillingReviews() {}, confirmBillingAwareAction() {},
    collectPersonLookValues() {}, legacyDossierBoard() {}, mediaSection() {}, assertSavedPerson() {},
    bindPersonEvolutionForm() {}, collectPersonEvolutionValues() {}, createKeyedRequestGuard: guard,
    createPersonPlanRequestGuard: guard, personPlanBlockedView() {},
  };
  vm.runInNewContext(`${source}\nglobalThis.__tested = { assetCard };`, sandbox, { filename: 'assetCenterView.js' });
  return sandbox.__tested.assetCard;
}

async function main() {
  const failures = [];
  const verify = (name, callback) => {
    try { callback(); } catch (error) { failures.push(`${name}: ${error.message}`); }
  };

  const fixture = new LightboxFixture();
  class PreloadImage {
    set src(value) { this.value = value; this.onload?.(); }
  }
  const lightbox = loadBrowserModule('public/story-ad/views/mediaLightbox.js', ['bindMediaLightbox'], {
    document: fixture.document, Image: PreloadImage, escapeHtml,
  });
  const ui = loadBrowserModule('public/story-ad/components/ui.js', ['generationProgressPanel']);
  const recoveryBannerUi = loadBrowserModule('public/story-ad/views/billingRecoveryBanner.js', ['renderCheckpointRecoveryBanner']);
  const recoveryUi = loadBrowserModule('public/story-ad/views/assetCheckpointRecovery.js', ['checkpointRecoverySummary', 'checkpointRecoveryBanner'], { escapeHtml, renderCheckpointRecoveryBanner: recoveryBannerUi.renderCheckpointRecoveryBanner });
  const planUi = loadBrowserModule('public/story-ad/views/assetCenterPlanReleaseStatus.js', ['personPlanBlockedView']);
  lightbox.bindMediaLightbox(fixture.scope);
  fixture.scope.dispatch('click', { target: fixture.trigger });
  await Promise.resolve();
  await Promise.resolve();
  for (let index = 0; index < 9; index += 1) fixture.image.dispatch('wheel', { deltaY: -1, clientX: 400, clientY: 400 });
  verify('352% zoom is reached through real wheel events', () => assert.equal(fixture.zoomLevel.textContent, '352%'));

  const pointerBefore = fixture.image.style.transform;
  fixture.image.dispatch('pointerdown', { pointerId: 7, clientX: 100, clientY: 120 });
  fixture.image.dispatch('pointermove', { pointerId: 7, clientX: 160, clientY: 190 });
  verify('pointer drag changes pan at 352%', () => assert.notEqual(fixture.image.style.transform, pointerBefore));
  verify('main image retains pointer capture instead of thumbnail strip', () => assert.equal(fixture.image.capturedPointerId, 7));

  fixture.image.dispatch('pointerup', { pointerId: 7 });
  const mouseBefore = fixture.image.style.transform;
  fixture.image.dispatch('mousedown', { clientX: 160, clientY: 190 });
  fixture.image.dispatch('mousemove', { clientX: 210, clientY: 240 });
  verify('mouse drag changes pan at 352%', () => assert.notEqual(fixture.image.style.transform, mouseBefore));
  const nativeDrag = fixture.image.dispatch('dragstart');
  verify('native image drag is disabled', () => assert.ok(nativeDrag.defaultPrevented || fixture.image.draggable === false));

  const sceneCard = loadBrowserModule('public/story-ad/views/sceneDossierCard.js', ['assetCardMedia'], { escapeHtml, mediaPreview });
  const partialCardMedia = sceneCard.assetCardMedia({
    id: 'person-1', name: '苏月见', partial_checkpoint: true,
    image_url: '/api/new-story-ad/assets/person-face.png',
    category_atlases: [{ key: 'face_front', image_url: '/api/new-story-ad/assets/person-face.png' }],
  }, 'people');
  verify('successful partial person media is visible on the card', () => assert.match(partialCardMedia, /person-face\.png/));
  verify('successful partial person media opens the full-size viewer', () => assert.match(partialCardMedia, /data-media-zoom-url/));

  const people = [{ subject_id: 'person-1', name: '苏月见', profile: { id: 'person-1' }, status: 'draft' }];
  const projected = projection.mergePeople(people, { 'subject_asset_checkpoint:generation-1': checkpointFixture() })[0];
  verify('successful native portrait is projected semantically instead of masquerading as a four-view atlas', () => {
    assert.equal(projected.view_images.length, 0);
    assert.equal(projected.category_atlases.length, 0);
    assert.equal(projected.native_masters.face.image_url, '/api/new-story-ad/assets/person-face.png');
    assert.equal(projected.cover_image_url, '/api/new-story-ad/assets/person-face.png');
  });
  verify('native face portrait wins the partial card even when a body atlas also completed', () => {
    const realCheckpoint = checkpointFixture();
    realCheckpoint.person_dossier_checkpoints.body = {
      key: 'body', unit: 'body', status: 'completed', billing_state: 'confirmed', provider_submission_state: 'completed',
      result: { kind: 'body', atlas: { image_url: '/person_body_atlas.png' }, atomic_assets: [{ kind: 'body', key: 'front', image_url: '/person_body_front.png' }] },
    };
    realCheckpoint.subject_checkpoint_owners.body = { kind: 'human', subject_id: 'person-1', index: 0 };
    const preview = projection.projectCheckpoint(realCheckpoint, [{ id: 'person-1' }])[0];
    assert.equal(preview.image_url, '/api/new-story-ad/assets/person-face.png');
    assert.equal(preview.native_masters.face.image_url, '/api/new-story-ad/assets/person-face.png');
    assert.equal(preview.category_atlases[0].image_url, '/person_body_atlas.png');
  });
  verify('negative hair-band wording does not create a paid hair-accessory unit', () => {
    const evidence = dossierComposites.accessoryEvidence({
      hairMakeupText: '黑色及肩中长直发；不戴帽子、不戴眼镜、不戴发带；自然通勤淡妆',
    }, { key: 'hair_accessories', pattern: /发饰|发带/u });
    assert.equal(evidence, '');
  });
  verify('the remembered Image 2 compliance specification reaches every human dossier prompt', () => {
    const prompt = subjectBundle.humanPrompt({ displayName: '原创人物', roleName: '背景人物', age: '25岁', visual_medium: 'live_action' }, 1);
    assert.match(prompt, /Compliance preflight/);
    assert.match(prompt, /original synthetic identities/i);
    assert.match(prompt, /celebrities, public figures, protected characters/i);
  });
  verify('projection preserves each failed unit and public reason', () => {
    assert.equal(projected.failed_checkpoint_units.length, 1);
    const failed = projected.failed_checkpoint_units[0];
    assert.equal(failed.key, 'walk'); assert.equal(failed.unit, 'base_action:natural_walk');
    assert.equal(failed.reason, '三次质量审核未通过'); assert.equal(failed.error_code, 'IMAGE_ATTEMPTS_EXHAUSTED');
    assert.equal(failed.billing_review_state, 'pending'); assert.equal(failed.review_revision, 1);
  });
  const cardHtml = assetCardRenderer()({
    ...projected,
    failed_checkpoint_units: [{ key: 'walk', unit: 'base_action:natural_walk', label: '自然行走', reason: '三次质量审核未通过' }],
  }, 'people');
  verify('final person card does not duplicate the project recovery detail banner', () => {
    assert.doesNotMatch(cardHtml, /data-asset-failure-banner|asset-failure-banner/);
  });

  const complete = { ...people[0], dossier_sheet: { image_url: '/complete-dossier.png' }, status: 'verified' };
  const untouchedComplete = projection.mergePeople([complete], { 'subject_asset_checkpoint:generation-1': checkpointFixture() })[0];
  verify('an authoritative complete dossier is not downgraded by an older partial checkpoint', () => {
    assert.equal(untouchedComplete, complete);
    assert.equal(untouchedComplete.partial_checkpoint, undefined);
  });

  const recoveryPeople = [7, 6, 6, 6].map((completed, index) => ({
    name: `人物${index + 1}`,
    checkpoint_recovery_summary: {
      completed_units: completed, total_units: completed + 1, retry_blocked: true,
      missing_units: [{ label: index < 2 ? '腰部配饰' : '发饰', reason: '需人工核对后处理', error_code: index < 3 ? 'PROVIDER_CONTENT_AUDIT' : 'IMAGE_ATTEMPTS_EXHAUSTED', retry_blocked: true }],
    },
  }));
  const recoveryBundle = {
    project: { status: 'failed', error: 'provider failure' },
    generation: { progress: { status: 'failed', stage: 'visual_assets', completed: 21, total: 21 } },
    assets: { people: recoveryPeople }, navigation: { asset_plan_eligibility: { eligible: true } },
  };
  const recoveryBanner = recoveryUi.checkpointRecoveryBanner(recoveryUi.checkpointRecoverySummary(recoveryPeople));
  verify('asset page renders one actionable recovery status instead of duplicating terminal state', () => {
    assert.equal(ui.generationProgressPanel(recoveryBundle, 'assets'), '');
    assert.match(recoveryBanner.replace(/<[^>]+>/g, ''), /25\/29/);
    assert.match(recoveryBanner, /平台核账中/);
    assert.match(recoveryBanner, /data-generate-recovery disabled[^>]*>生成剩余 4 项/);
    assert.doesNotMatch(recoveryBanner, /查看核账进度|data-billing-review|data-billing-risk-accept/);
    assert.doesNotMatch(recoveryBanner, /PROVIDER_CONTENT_AUDIT|IMAGE_ATTEMPTS_EXHAUSTED/);
  });
  verify('pending result action cannot reach confirmation or provider while polling still advances review state', () => {
    const action = recoveryBanner.match(/<button\b([^>]*)data-generate-recovery([^>]*)>/);
    let confirmationCalls = 0, providerCalls = 0;
    if (action && !/\bdisabled\b/.test(`${action[1]} ${action[2]}`)) { confirmationCalls += 1; providerCalls += 1; }
    assert.equal(confirmationCalls, 0); assert.equal(providerCalls, 0);
    const billingRetry = read('public/story-ad/views/assetCenterBillingRetry.js');
    assert.match(billingRetry, /billing_review_state\s*===\s*'pending'[\s\S]*startBillingReviewPolling/);
    assert.match(billingRetry, /store\.refreshSections\('summary,assets'\)/);
  });
  const pollTimers = [], pollRefreshes = [];
  const pollSource = read('public/story-ad/views/assetCenterBillingRetry.js')
    .replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '')
    .replace(/function billingReviewDialog\(\) \{[\s\S]*?\n\}/,
      'function billingReviewDialog() { return globalThis.__billingDialog(); }');
  const pollSandbox = {
    __billingDialog: async () => ({ loadBillingReviews: async () => ({ reviews: [{ billing_review_state: 'not_billed' }] }) }),
    setTimeout: callback => { pollTimers.push(callback); },
    document: { visibilityState: 'visible' }, request: async () => ({}), setButtonBusy() {}, toast() {},
  };
  vm.runInNewContext(`${pollSource}\nglobalThis.__poll=startBillingReviewPolling;`, pollSandbox, { filename: 'assetCenterBillingRetry.js' });
  pollSandbox.__poll({
    bundle: { project: { id: 'task-v82' } }, host: { isConnected: true }, initialDelay: 2000,
    store: { refreshSections: async value => { pollRefreshes.push(value); } },
  });
  verify('pending review starts the real polling state machine', () => assert.equal(pollTimers.length, 1));
  await pollTimers.shift()();
  verify('polling refreshes summary and assets when review state changes', () => assert.deepEqual(pollRefreshes, ['summary,assets']));
  verify('the live asset center no longer mounts legacy checkpoint recovery actions', () => {
    const source = read('public/story-ad/views/assetCenterView.js');
    assert.doesNotMatch(source, /checkpointRecoveryBanner\s*\(/);
    assert.doesNotMatch(source, /data-generate-recovery/);
    assert.doesNotMatch(source, /querySelectorAll\('\[data-generate-subjects\]/);
    assert.match(source, /data-generate-subject-assets/);
  });
  verify('non-owner views do not expose person asset failures', () => {
    const globalPanel = ui.generationProgressPanel(recoveryBundle, 'brief');
    assert.equal(globalPanel, '');
  });
  verify('person plan eligibility is explicitly separate from billing recovery', () => {
    const plan = planUi.personPlanBlockedView({ issues: [], visual_recovery_active: true }, false);
    assert.equal(plan, '', '缺图恢复期间人物方案卡不得进入DOM形成第二主动作');
  });

  if (failures.length) {
    throw new Error(`V68 acceptance is red (${failures.length}):\n- ${failures.join('\n- ')}`);
  }
  console.log(JSON.stringify({ passed: true, zoom: fixture.zoomLevel.textContent, paid_model_calls: 0 }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
