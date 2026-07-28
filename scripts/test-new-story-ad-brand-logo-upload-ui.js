#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const brandSource = fs.readFileSync(path.join(root, 'public/js/new-story-ad/brand-overlay.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/digital-human.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/digital-human-wizard.css'), 'utf8');
const route = fs.readFileSync(path.join(root, 'src/routes/newStoryAd.js'), 'utf8');

const sandbox = {
  window: {},
  URL: { createObjectURL: () => 'blob:logo-preview' },
  console,
};
vm.createContext(sandbox);
vm.runInContext(brandSource, sandbox, { filename: 'brand-overlay.js' });
const overlay = sandbox.window.NewStoryAdBrandOverlay;

function renderState(state) {
  const controls = new Map([
    ['#dhNsaAdBrandLogoAsset', { innerHTML: '' }],
    ['#dhNsaAdBrandLogoAuthorized', { checked: false }],
    ['#dhNsaAdBrandLogoPosition', { value: '' }],
    ['#dhNsaAdBrandLogoWidth', { value: '' }],
    ['#dhNsaAdBrandLogoDuration', { value: '' }],
  ]);
  overlay.render(state, {
    within: selector => controls.get(selector) || null,
    previewUrl: asset => asset?.previewUrl || asset?.image_url || '',
    escapeHtml: value => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;'),
    setFieldValue: (selector, value) => {
      const control = controls.get(selector);
      if (control) control.value = String(value);
    },
  });
  return controls.get('#dhNsaAdBrandLogoAsset').innerHTML;
}

function testUploadConstraints() {
  assert.equal(overlay.MAX_LOGO_BYTES, 10 * 1024 * 1024);
  assert.equal(overlay.validateLogoFile({ name: 'brand.png', type: 'image/png', size: 1024 }).ok, true);
  assert.equal(overlay.validateLogoFile({ name: 'brand.jpg', type: 'image/jpeg', size: 1024 }).ok, true);
  assert.equal(overlay.validateLogoFile({ name: 'brand.jpeg', type: 'image/jpeg', size: 1024 }).ok, true);
  assert.equal(overlay.validateLogoFile({ name: 'brand.webp', type: 'image/webp', size: 1024 }).ok, true);
  assert.match(overlay.validateLogoFile({ name: 'brand.gif', type: 'image/gif', size: 1024 }).message, /PNG、JPG、JPEG 或 WebP/);
  assert.match(overlay.validateLogoFile({
    name: 'brand.png',
    type: 'image/png',
    size: 10 * 1024 * 1024 + 1,
  }).message, /不能超过 10MB/);
  assert.match(route, /品牌 Logo 仅支持 10MB 以内的 PNG、JPG 或 WebP 图片/);
}

function testEmptyUploadPresentation() {
  const output = renderState({});
  assert.match(output, /id="dhNsaAdBrandLogoUpload"/);
  assert.match(output, /点击上传 Logo 图片/);
  assert.match(output, /PNG、JPG、JPEG、WebP/);
  assert.match(output, /大小不超过 10MB/);
  assert.doesNotMatch(output, /删除 Logo/);
  assert.match(html, /accept="\.png,\.jpg,\.jpeg,\.webp,image\/png,image\/jpeg,image\/webp"/);
  assert.doesNotMatch(html, />上传授权 Logo</);
  assert.doesNotMatch(html, />删除 Logo</);
}

function testUploadedThumbnailActions() {
  const output = renderState({
    brandLogoAsset: {
      name: '示例品牌.png',
      previewUrl: '/uploads/example-logo.png',
      uploading: false,
    },
  });
  assert.match(output, /class="dh-nsa-brand-logo-preview/);
  assert.match(output, /data-nsa-brand-logo-preview/);
  assert.match(output, /aria-label="放大预览 Logo"/);
  assert.match(output, /id="dhNsaAdBrandLogoClear"/);
  assert.match(output, /aria-label="删除 Logo"/);
  assert.match(output, /更换图片/);
  assert.match(output, /示例品牌\.png/);
  assert.doesNotMatch(output, />删除 Logo</);
  assert.match(css, /\.dh-nsa-brand-logo-preview:hover \.dh-nsa-brand-logo-actions/);
  assert.match(css, /button#dhNsaAdBrandLogoClear:hover/);
  assert.match(css, /@media \(hover: none\)/);
}

async function testInvalidFileStopsBeforeUpload() {
  const state = { brandLogoAsset: null };
  let uploads = 0;
  let message = '';
  await overlay.upload({ name: 'brand.gif', type: 'image/gif', size: 1024 }, {
    state,
    revokePreview: () => {},
    markMediaDirty: () => {},
    renderAssets: () => {},
    toast: value => { message = value; },
    uploadAsset: async () => { uploads += 1; },
    scheduleAutoSave: () => {},
  });
  assert.equal(uploads, 0, '无效 Logo 必须在请求前拦截');
  assert.equal(state.brandLogoAsset, null);
  assert.match(message, /仅支持/);
}

async function main() {
  testUploadConstraints();
  testEmptyUploadPresentation();
  testUploadedThumbnailActions();
  await testInvalidFileStopsBeforeUpload();
  console.log('new story ad brand logo upload UI: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
