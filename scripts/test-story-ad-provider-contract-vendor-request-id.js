#!/usr/bin/env node
'use strict';

const assert = require('assert');
const adapters = require('../src/services/newStoryAd/providerAdapterRegistry');

(async () => {
  assert.deepEqual(
    adapters.validateDeyunaiTextContract(
      { id: 'deyunai', preset: 'deyunai' },
      { id: 'gemini-2.5-pro', use: 'story', channel: 'overseas' }
    ),
    { ok: false, reason: 'deyunai_vendor_missing' },
    '漫路海外 Chat 缺少官方 vendor 配置时必须在调用前隔离'
  );
  assert.equal(
    adapters.validateDeyunaiTextContract(
      { id: 'deyunai', preset: 'deyunai', vendor: 'official-vendor' },
      { id: 'gemini-2.5-pro', use: 'story', channel: 'overseas' }
    ).ok,
    true
  );
  assert.equal(
    adapters.validateDeyunaiTextContract(
      { id: 'deyunai', preset: 'deyunai' },
      { id: 'claude-sonnet-4-6', use: 'story', channel: 'overseas' }
    ).ok,
    true,
    '官方 Claude Messages 契约不要求 vendor 头'
  );
  const sdk = adapters.openAICompatibleSdkOptions({
    apiKey: 'fake-key',
    family: 'deyunai',
    providerId: 'deyunai',
    modelId: 'gemini-2.5-pro',
    channel: 'overseas',
    baseURL: 'https://api.deyunai.com/c35/v1',
    vendor: 'official-vendor',
  }, 90000);
  assert.equal(sdk.baseURL, 'https://api.deyunai.com/c35/v1');
  assert.equal(sdk.defaultHeaders.vendor, 'official-vendor', 'baseURL 已是 c35 时仍必须发送官方 vendor 头');

  const created = [];
  const result = await adapters.callOpenAICompatible({
    apiKey: 'fake-key', family: 'deyunai', providerId: 'deyunai', modelId: 'gemini-2.5-pro',
    channel: 'overseas', baseURL: 'https://api.deyunai.com/v1', vendor: 'official-vendor',
  }, 'system', 'user', {
    _client: { chat: { completions: { create: async payload => {
      created.push(payload);
      return { id: 'chatcmpl-official-response', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} };
    } } } },
  });
  assert.equal(created.length, 1);
  assert.equal(result.provider_request_id, 'chatcmpl-official-response');

  const error = Object.assign(new Error('unauthorized'), {
    status: 401,
    request_id: 'req-error-401',
    response: { status: 401, headers: {} },
  });
  adapters.attachProviderErrorEvidence(error);
  assert.equal(error.provider_status, 401);
  assert.equal(error.provider_request_id, 'req-error-401');
  console.log(JSON.stringify({ passed: true, missing_vendor_preflight: true, vendor_header_on_existing_c35: true, response_id_captured: true, error_evidence_captured: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
