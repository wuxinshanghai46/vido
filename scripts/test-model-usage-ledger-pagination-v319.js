#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const ledger = require('../src/services/modelUsageLedgerService');

const storyCall = {
  id: 'call-claude-1', task_id: 'task-1', stage: 'new_story_ad.storyboard_table',
  provider_id: 'smscrw', model_id: 'claude-sonnet-4-6', status: 'success',
  created_at: '2026-08-30T08:00:00.000Z', latency_ms: 321,
};
const projected = ledger.projectStoryCall(storyCall);
assert.equal(projected.provider, 'smscrw');
assert.equal(projected.model, 'claude-sonnet-4-6');
assert.equal(projected.category, 'llm');
assert.equal(projected.agent_id, 'new_story_ad.storyboard_table');
assert.equal(projected.cost_usd, 0, '账本未记录成本时不得臆造成本');

const duplicate = { ...projected, id: 'legacy-duplicate' };
assert.equal(ledger.mergeUsageRecords([duplicate], [projected]).length, 1, '相同供应商请求不得重复计数');
const merged = ledger.mergeUsageRecords([
  { id: 'legacy-1', timestamp: '2026-08-29T08:00:00.000Z', provider: 'deyunai', model: 'gpt-image-2', status: 'success' },
], [projected]);
assert.equal(merged.length, 2);
assert.equal(merged[0].id, projected.id, '统一账本必须按时间倒序');
assert.equal(ledger.matches(projected, { from: '2026-08-30T00:00:00.000Z', to: '2026-08-30T23:59:59.999Z', provider: 'smscrw', model: 'claude-sonnet-4-6' }), true);
assert.equal(ledger.matches(projected, { provider: 'deyunai' }), false);

const tokenTrackerSource = require('fs').readFileSync(require('path').resolve(__dirname, '../src/services/tokenTracker.js'), 'utf8');
const routeSource = require('fs').readFileSync(require('path').resolve(__dirname, '../src/routes/admin.js'), 'utf8');
const uiSource = require('fs').readFileSync(require('path').resolve(__dirname, '../public/js/admin-vue-content-monitor.js'), 'utf8');
assert.match(tokenTrackerSource, /limit = 20/);
assert.match(routeSource, /parseInt\(req\.query\.limit\) \|\| 20/);
assert.match(uiSource, /limit: 20/);
assert.match(uiSource, /上一页/);
assert.match(uiSource, /下一页/);
assert.doesNotMatch(uiSource, /加载更多调用记录/);

console.log(JSON.stringify({ passed: true, unified_story_call: true, deduplicated: true, default_page_size: 20, pagination: 'previous-next', provider_calls: 0 }));
