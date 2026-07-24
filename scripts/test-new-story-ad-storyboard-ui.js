#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
  'data-nsa-shot-autosave-status',
  'data-nsa-shot-regenerate',
  'data-nsa-candidate-preview',
  'data-nsa-candidate-use',
  'data-nsa-candidate-review',
].forEach(token => assert(ui.includes(token), `missing storyboard action hook: ${token}`));

assert(!ui.includes('data-nsa-shot-save'), 'storyboard edits must not depend on a manual save action');

assert(ui.includes('dh-nsa-frame-summary'), 'compact approval summary must render by default');
assert(ui.includes('dh-nsa-frame-settings'), 'full edit controls must be available behind disclosure');
assert(ui.indexOf('dh-nsa-frame-summary') < ui.indexOf('dh-nsa-frame-settings'), 'approval summary must precede advanced editing');
assert(ui.includes("? '新版本未通过'"), 'retained old frame and latest rejected attempt must use a short state label');
assert(ui.includes("? '生成失败'"), 'failed frames without an old preview must not be shown as pending');
assert(ui.includes("? 'QA 已通过'"), 'QA copy must describe the accepted current version');
assert(ui.includes("frame.contract_outdated ? '需重新生成' : '需重新验证'"), 'outdated frames must expose a short actionable state');
assert(ui.includes('dh-nsa-frame-status-note'), 'status reason and regeneration action must be separate from the short badge');
assert(ui.includes('镜头设置已修改，当前画面仍为上一版本。重新生成后新设置才会生效。'), 'changed-shot notice must explain why regeneration is required');
assert(ui.includes('确认沿用旧版'), 'retained QA2 candidates must offer an explicit confirmation action');
assert(ui.includes('审核服务异常'), 'QA infrastructure failures must be distinguished from visual rejection');
assert(ui.includes('重新验证此图'), 'QA infrastructure failures must support retrying the existing image');
assert(ui.includes('没有重新生成图片'), 'QA-only retry must explain that media generation was not invoked');
assert(ui.includes('当前版本通过 ${kf.fresh_pass || 0}/${kf.total}'), 'status summary must use fresh pass instead of URL count');
assert(ui.includes('保留旧版 ${kf.retained_previous}'), 'status summary must expose retained old frames');
assert(ui.includes('生成失败 ${kf.failed}'), 'status summary must expose hard failures');
assert(ui.includes('补齐未生成镜头（${kf.missing}）'), 'fill action must count only frames without an image');
assert(ui.includes("missingOnly ? { missing_images_only: true } : {}"), 'fill action must request strict missing-image targeting');
assert(ui.includes("state.storyboardDirty === true && state.shots.length"), 'keyframe action must not rebuild all contracts when the storyboard was not edited');
assert(css.includes('grid-template-areas:'), 'storyboard layout must use explicit compact regions');
assert(css.includes('--dh-nsa-frame-ratio'), 'preview ratio must follow the task ratio instead of a fixed scene');
assert(css.includes('.dh-nsa-frame-identity {'), 'storyboard header must have a dedicated compact identity region');
assert(css.includes('.dh-nsa-duration { min-height: 36px;'), 'duration control must use the compact neutral control');
assert(css.includes('.dh-nsa-frame-status-note { grid-area: notice;'), 'long status explanations must render in a separate full-width notice');
assert(css.includes('.dh-nsa-frame-preview { aspect-ratio: var(--dh-nsa-frame-ratio, 9 / 16); min-height: 0; max-height: none; }'), 'dynamic preview ratio must explicitly reset the legacy max-height cap');
assert(css.includes('@media (max-width: 600px)'), 'mobile storyboard layout must be covered');
assert(html.includes('/js/new-story-ad/bootstrap.js?v=20260725-subject-form-restore-v8'), '剧情广告入口必须使用统一弹窗缓存版本');
assert(fs.readFileSync(path.join(root, 'public/js/new-story-ad/bootstrap.js'), 'utf8').includes("const SCRIPT_VERSION = '20260725-subject-form-restore-v8'"), '懒加载的剧情广告子模块必须使用同一缓存版本');
assert(ui.includes('data-nsa-admin-video-monitor'), 'super admin must have an in-context shot monitor entry');
assert(ui.includes('/api/new-story-ad/admin/tasks/${encodeURIComponent(state.taskId)}/video-monitor'), 'shot monitor must read the protected admin endpoint');
assert(ui.includes("currentUserIsAdmin() && state.taskId && ['video', 'media', 'compose'].includes"), 'ordinary users and non-video stages must not show the admin shot monitor entry');
assert(ui.includes('每 5 秒自动刷新'), 'admin shot monitor must explain its live refresh interval');

const keyframeContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/new-story-ad/keyframes.js'), 'utf8'), keyframeContext);
assert.strictEqual(
  keyframeContext.window.NewStoryAdKeyframes.isQaInfrastructureError('timeout of 300000ms exceeded', 'IMAGE_ATTEMPTS_EXHAUSTED'),
  false,
  'image provider timeout must not be displayed as a visual QA outage',
);
assert.strictEqual(
  keyframeContext.window.NewStoryAdKeyframes.isQaInfrastructureError('视觉审核服务暂时不可用', 'VISION_QA_UNAVAILABLE'),
  true,
  'actual visual QA outage must retain its dedicated explanation',
);

console.log('new-story-ad storyboard UI tests passed');
