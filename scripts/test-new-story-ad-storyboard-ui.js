#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const currentStoryboard = read('public/story-ad/views/storyboardView.js');
const legacyTransitionModule = read('public/js/new-story-ad/storyboard.js');
const videoReview = read('public/js/new-story-ad/video-review.js');
const transitionReview = read('public/js/new-story-ad/transition-review.js');

[
  'name="duration"', 'name="visual"', 'name="action"', 'name="voiceover"',
  'data-save-inline-shot', 'data-generate-sketch', 'data-confirm-sketch',
].forEach(token => assert(currentStoryboard.includes(token), `missing current storyboard action hook: ${token}`));
assert(currentStoryboard.includes('const pageSize = 20'), 'long-form storyboard must render one bounded page');
assert(currentStoryboard.includes('data-open-shot-design'), 'confirmed storyboard must enter the current shot designer');

[
  'data-nsa-shot-field="transition_type"',
  'data-nsa-shot-field="transition_duration_sec"',
  'data-nsa-shot-field="transition_match_anchor"',
  'data-nsa-shot-field="audio_bridge"',
  'data-nsa-shot-field="audio_bridge_duration_sec"',
].forEach(token => assert(legacyTransitionModule.includes(token), `transition contract module is missing: ${token}`));
assert(videoReview.includes('NewStoryAdTransitionReview'));

const keyframeContext = { window: {} };
vm.runInNewContext(read('public/js/new-story-ad/keyframes.js'), keyframeContext);
assert.strictEqual(
  keyframeContext.window.NewStoryAdKeyframes.isQaInfrastructureError('timeout of 300000ms exceeded', 'IMAGE_ATTEMPTS_EXHAUSTED'),
  false,
);
assert.strictEqual(
  keyframeContext.window.NewStoryAdKeyframes.isQaInfrastructureError('visual QA unavailable', 'VISION_QA_UNAVAILABLE'),
  true,
);
assert(transitionReview.includes('dh-nsa-transition-verdict'));

console.log('new-story-ad storyboard UI tests passed');
