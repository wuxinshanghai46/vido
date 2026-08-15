'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const projection = require('../src/services/newStoryAd/subjectCheckpointProjectionService');

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
        key: 'portrait', unit: 'identity:face_front', status: 'completed',
        provider_submission_state: 'completed', billing_state: 'confirmed',
        result: { image_url: '/api/new-story-ad/assets/person-face.png' },
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
  const recoveryUi = loadBrowserModule('public/story-ad/views/assetCheckpointRecovery.js', ['checkpointRecoverySummary', 'checkpointRecoveryBanner'], { escapeHtml });
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
  verify('all successful checkpoint images are available to the full drawer', () => {
    assert.equal(projected.view_images.length, 1);
    assert.equal(projected.category_atlases.length, 1);
    assert.equal(projected.cover_image_url, '/api/new-story-ad/assets/person-face.png');
  });
  verify('body atlas wins canonical cover even when an identity atlas appears first', () => {
    const atlas = projection.canonicalPersonAtlas([
      { key: 'identity_1', kind: 'identity', image_url: '/person_identity_atlas.png' },
      { key: 'body_1', kind: 'body', image_url: '/person_body_atlas.png' },
    ]);
    assert.equal(atlas.image_url, '/person_body_atlas.png');
  });
  verify('projection preserves each failed unit and public reason', () => {
    assert.deepEqual(projected.failed_checkpoint_units, [{
      key: 'walk', unit: 'base_action:natural_walk', reason: '三次质量审核未通过', error_code: 'IMAGE_ATTEMPTS_EXHAUSTED',
    }]);
  });
  const cardHtml = assetCardRenderer()({
    ...projected,
    failed_checkpoint_units: [{ key: 'walk', unit: 'base_action:natural_walk', label: '自然行走', reason: '三次质量审核未通过' }],
  }, 'people');
  verify('final person card renders a concrete failed-unit banner', () => {
    assert.match(cardHtml, /data-asset-failure-banner/);
    assert.match(cardHtml, /自然行走/);
    assert.match(cardHtml, /三次质量审核未通过/);
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
    assert.match(recoveryBanner, /人物图片已生成 25\/29/);
    assert.match(recoveryBanner, /平台核账中|无需点击或重试/);
    assert.match(recoveryBanner, /查看已生成图片/);
    assert.doesNotMatch(recoveryBanner, /PROVIDER_CONTENT_AUDIT|IMAGE_ATTEMPTS_EXHAUSTED/);
  });
  verify('non-asset global progress keeps authoritative counts without exposing internal codes', () => {
    const globalPanel = ui.generationProgressPanel(recoveryBundle, 'story');
    assert.match(globalPanel, /25\/29/);
    assert.doesNotMatch(globalPanel, /可从缺失项继续|21\/21|PROVIDER_CONTENT_AUDIT|IMAGE_ATTEMPTS_EXHAUSTED/);
  });
  verify('person plan eligibility is explicitly separate from billing recovery', () => {
    const plan = planUi.personPlanBlockedView({ issues: [], visual_recovery_active: true }, false);
    assert.match(plan, /独立事项/);
    assert.match(plan, /与当前缺图无关/);
    assert.match(plan, /平台核对完成后/);
    assert.doesNotMatch(plan, /data-update-person-plan/);
    assert.match(plan, /disabled/);
  });

  if (failures.length) {
    throw new Error(`V68 acceptance is red (${failures.length}):\n- ${failures.join('\n- ')}`);
  }
  console.log(JSON.stringify({ passed: true, zoom: fixture.zoomLevel.textContent, paid_model_calls: 0 }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
