'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public/js/dashboard-workbench.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/dashboard-workbench.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');

assert.doesNotMatch(js, /<button class="wb-play-button"/, 'round play button markup must be removed');
assert.match(html, /dashboard-workbench\.js\?v=20260821-dashboard-preload-v128/, 'dashboard script cache key must activate the preload dashboard build in production');
assert.match(html, /dashboard-workbench\.css\?v=20260820-dashboard-clean-v94/, 'dashboard style cache key must activate the hover preview visibility fix');
assert.doesNotMatch(html, /你的 AI 视频创作工作台|VIDO GUIDED PRODUCTION|hubSmartRoute/, 'legacy dashboard markup must not remain in the initial HTML');
assert.doesNotMatch(app, /function loadDashboard\(|function hubSmartRoute\(|function hubSetExample\(/, 'legacy dashboard runtime must be removed instead of racing the current workbench');
assert.doesNotMatch(js, /data-play-video/, 'legacy play-only click target must be removed');
assert.match(js, /\.wb-video-card\[data-video-id\]/, 'the whole card must open the video');
assert.match(js, /card\.addEventListener\('pointerenter', play\)/, 'pointer hover must start preview');
assert.match(js, /card\.addEventListener\('pointerleave', stop\)/, 'pointer leave must stop preview');
assert.match(js, /card\.addEventListener\('focus', play\)/, 'keyboard focus must start preview');
assert.match(js, /video\.pause\(\)/, 'preview must pause on exit');
assert.match(js, /video\.currentTime\s*=/, 'preview must reset to its cover frame');
assert.match(js, /role="button" tabindex="0"/, 'video card must remain keyboard accessible');
assert.match(css, /\.wb-video-card:focus-visible/, 'keyboard focus must be visible');
assert.match(css, /\.wb-video-card\.is-previewing \.wb-video-fallback-image\{opacity:0/, 'the static cover must become transparent while the muted preview is playing');

console.log(JSON.stringify({ passed: true, checks: 15, interaction: 'refresh-without-legacy-ui-and-visible-hover-preview' }));
