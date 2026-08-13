#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const media = require('../src/services/newStoryAd/mediaAdapter');

const candidates = [
  { provider_id: 'first-provider', model_id: 'gpt-image-2' },
  { provider_id: 'deyunai', model_id: 'gpt-image-2' },
  { provider_id: 'deyunai', model_id: 'other-image' },
];
const exact = media.selectImageCandidates('new_story_ad.keyframe', 'deyunai/gpt-image-2', candidates);
assert.deepStrictEqual(exact.candidatePool.map(item => `${item.provider_id}/${item.model_id}`), ['deyunai/gpt-image-2']);
assert.strictEqual(exact.exactRouteRequested, true);
const missing = media.selectImageCandidates('new_story_ad.keyframe', 'missing/gpt-image-2', candidates);
assert.deepStrictEqual(missing.candidatePool, [], 'an exact paid route must fail closed instead of falling back to another provider');
const modelOnly = media.selectImageCandidates('new_story_ad.keyframe', 'gpt-image-2', candidates);
assert.deepStrictEqual(modelOnly.candidatePool.map(item => item.provider_id), ['first-provider', 'deyunai']);

const source = fs.readFileSync(path.resolve(__dirname, '../src/services/newStoryAd/mediaAdapter.js'), 'utf8');
const genericStart = source.indexOf(': (async () => {');
assert(genericStart > 0);
const genericBlock = source.slice(genericStart, source.indexOf('})(),', genericStart) + 5);
assert(genericBlock.indexOf('notifyGenerationObserver(onSubmitting') < genericBlock.indexOf('client.images.generate'));
assert(genericBlock.indexOf('client.images.generate') < genericBlock.indexOf('notifyGenerationObserver(onSubmitted'));
console.log(JSON.stringify({ passed: true, exact_provider_model_route_preserved: true, exact_route_fails_closed: true, generic_submission_audited_before_network: true }));
