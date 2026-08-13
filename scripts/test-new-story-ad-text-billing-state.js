#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-text-billing-'));
process.env.DB_ENABLED = '0';
const gateway = require('../src/services/newStoryAd/modelGateway');
const storage = require('../src/services/newStoryAd/storageService');
const models = [{ provider_id: 'billing-test', model_id: 'text-model', enabled: true }];

(async () => {
  try {
    await assert.rejects(() => gateway.generateText({
      taskId: 'timeout-task', stage: 'new_story_ad.asset_plan', systemPrompt: 'x', userPrompt: 'x',
      maxCandidates: 3, _candidateModels: [...models, { provider_id: 'must-not-run', model_id: 'fallback', enabled: true }],
      _generateText: async () => { throw Object.assign(new Error('socket hang up'), { code: 'TIMEOUT_OR_NETWORK' }); },
    }), error => error.billing_state === 'unknown' && error.provider_submission_state === 'submitted_unknown');
    const timeoutCalls = storage.getTaskBundle('timeout-task').model_calls;
    assert.equal(timeoutCalls.length, 1);
    assert.equal(timeoutCalls[0].billing_state, 'unknown');
    assert.equal(timeoutCalls[0].provider_submission_state, 'submitted_unknown');

    const success = await gateway.generateText({
      taskId: 'success-task', stage: 'new_story_ad.asset_plan', systemPrompt: 'x', userPrompt: 'x',
      _candidateModels: models, _generateText: async () => ({ text: '{"ok":true}' }),
    });
    assert.equal(success.text, '{"ok":true}');
    const successCall = storage.getTaskBundle('success-task').model_calls[0];
    assert.equal(successCall.billing_state, 'confirmed');
    assert.equal(successCall.provider_submission_state, 'completed');

    await assert.rejects(() => gateway.generateText({
      taskId: 'rejected-task', stage: 'new_story_ad.asset_plan', systemPrompt: 'x', userPrompt: 'x',
      _candidateModels: models, _generateText: async () => { throw Object.assign(new Error('invalid token'), { code: 'AUTH_CONFIG' }); },
    }));
    const rejectedCall = storage.getTaskBundle('rejected-task').model_calls[0];
    assert.equal(rejectedCall.billing_state, 'not_billed');
    assert.equal(rejectedCall.provider_submission_state, 'submission_rejected');
    console.log(JSON.stringify({ passed: true, timeout_quarantined: true, automatic_fallback_after_unknown: 0, success_confirmed: true, rejected_not_billed: true }));
  } finally {
    fs.rmSync(process.env.OUTPUT_DIR, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
