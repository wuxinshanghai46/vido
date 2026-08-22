#!/usr/bin/env node
'use strict';

const assert = require('assert');
const routeConfig = require('./configure-story-ad-independent-text-routes');

const providers = routeConfig.PREFERRED_CANDIDATES.map(candidate => ({
  id: candidate.provider_id,
  enabled: true,
  api_key: `fake-${candidate.provider_id}`,
  models: [{ id: candidate.model_id, enabled: true, use: 'story' }],
}));
const selected = routeConfig.selectCandidates(providers);
assert.equal(selected.length, 3);
assert.deepEqual(selected.map(item => item.priority), [1, 2, 3]);
assert.equal(new Set(selected.map(item => item.provider_id)).size, 3);

providers[1].models[0].enabled = false;
assert.equal(routeConfig.selectCandidates(providers).length, 2, '禁用模型不得混入发布路由');
console.log(JSON.stringify({ passed: true, independent_providers: 3, disabled_model_rejected: true }));
