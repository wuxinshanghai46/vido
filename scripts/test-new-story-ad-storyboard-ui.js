#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'public/js/new-story-ad-legacy-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/digital-human-wizard.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/digital-human.html'), 'utf8');

[
  'data-nsa-shot-field="duration"',
  'data-nsa-shot-field="visual"',
  'data-nsa-shot-field="action"',
  'data-nsa-shot-field="voiceover"',
  'data-nsa-shot-field="purpose"',
  'data-nsa-shot-save',
  'data-nsa-shot-regenerate',
  'data-nsa-candidate-preview',
  'data-nsa-candidate-use',
].forEach(token => assert(ui.includes(token), `missing storyboard action hook: ${token}`));

assert(ui.includes('dh-nsa-frame-summary'), 'compact approval summary must render by default');
assert(ui.includes('dh-nsa-frame-settings'), 'full edit controls must be available behind disclosure');
assert(ui.indexOf('dh-nsa-frame-summary') < ui.indexOf('dh-nsa-frame-settings'), 'approval summary must precede advanced editing');
assert(ui.includes('旧版可用 · 新版未通过'), 'retained old frame and latest rejected attempt must be distinct');
assert(ui.includes('生成失败 · 当前版本未通过'), 'failed frames without an old preview must not be shown as pending');
assert(ui.includes('当前版本视觉 QA 已通过'), 'QA copy must describe the accepted current version');
assert(ui.includes('旧版 QA 已升级 · 请重新生成'), 'outdated QA frames must require regeneration');
assert(ui.includes('确认沿用旧版'), 'retained QA2 candidates must offer an explicit confirmation action');
assert(ui.includes('当前版本通过 ${kf.fresh_pass || 0}/${kf.total}'), 'status summary must use fresh pass instead of URL count');
assert(ui.includes('保留旧版 ${kf.retained_previous}'), 'status summary must expose retained old frames');
assert(ui.includes('生成失败 ${kf.failed}'), 'status summary must expose hard failures');
assert(css.includes('grid-template-areas:'), 'storyboard layout must use explicit compact regions');
assert(css.includes('--dh-nsa-frame-ratio'), 'preview ratio must follow the task ratio instead of a fixed scene');
assert(css.includes('.dh-nsa-duration span { min-height: 0 !important; padding: 0 !important; border: 0 !important;'), 'duration label must reset legacy pill styles');
assert(css.includes('.dh-nsa-frame-preview { aspect-ratio: var(--dh-nsa-frame-ratio, 9 / 16); min-height: 0; max-height: none; }'), 'dynamic preview ratio must explicitly reset the legacy max-height cap');
assert(css.includes('@media (max-width: 600px)'), 'mobile storyboard layout must be covered');
assert(html.includes('20260714-storyboard-quality-v2'), 'storyboard assets must use a fresh cache version');

console.log('new-story-ad storyboard UI tests passed');
