'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public/js/dashboard-workbench.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/dashboard-workbench.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

assert.doesNotMatch(js, /<button class="wb-play-button"/, 'round play button markup must be removed');
assert.match(html, /dashboard-workbench\.js\?v=20260820-hover-preview-v93/, 'dashboard script cache key must activate the hover preview build in production');
assert.match(html, /dashboard-workbench\.css\?v=20260820-hover-preview-v93/, 'dashboard style cache key must hide legacy play controls in production');
assert.doesNotMatch(js, /data-play-video/, 'legacy play-only click target must be removed');
assert.match(js, /\.wb-video-card\[data-video-id\]/, 'the whole card must open the video');
assert.match(js, /card\.addEventListener\('pointerenter', play\)/, 'pointer hover must start preview');
assert.match(js, /card\.addEventListener\('pointerleave', stop\)/, 'pointer leave must stop preview');
assert.match(js, /card\.addEventListener\('focus', play\)/, 'keyboard focus must start preview');
assert.match(js, /video\.pause\(\)/, 'preview must pause on exit');
assert.match(js, /video\.currentTime\s*=/, 'preview must reset to its cover frame');
assert.match(js, /role="button" tabindex="0"/, 'video card must remain keyboard accessible');
assert.match(css, /\.wb-video-card:focus-visible/, 'keyboard focus must be visible');

console.log(JSON.stringify({ passed: true, checks: 10, interaction: 'hover-muted-preview-and-click-open' }));
