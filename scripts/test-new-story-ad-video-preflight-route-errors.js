#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/services/newStoryAd/storyAdService.js'), 'utf8');
const start = source.indexOf('function buildVideoPreflightPlan');
const end = source.indexOf('function assertVideoPreflightConfirmation', start);
const block = source.slice(start, end);
assert.match(block, /let pinnedModelError = null/);
assert.match(block, /pinnedModelError = error/);
assert.match(block, /if \(!pinnedModel && pinnedModelError\)/);
assert.match(block, /pinnedModelError\.code \|\| 'VIDEO_MODEL_CONFIG_REQUIRED'/);
assert(!block.includes('VIDEO_COST_PRICE_UNKNOWN'), 'missing accounting metadata cannot block a supported video route');
console.log(JSON.stringify({ passed: true, explicit_route_error_preserved: true, unknown_price_not_used_for_missing_route: true }));
