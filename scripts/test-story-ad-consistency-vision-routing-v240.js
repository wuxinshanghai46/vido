#!/usr/bin/env node
'use strict';

const assert = require('assert');
const pipeline = require('../src/services/pipelineModelService');
const adapters = require('../src/services/newStoryAd/providerAdapterRegistry');
const migration = require('./configure-story-ad-consistency-vision-routing-v240');

const expected = [
  'deyunai/claude-sonnet-4-6',
  'webang-maas/gemini-2.5-flash',
  'zhipu/glm-4.6v-flash',
];

for (const stage of migration.STAGES) {
  assert.deepEqual(
    pipeline.getStageDefaults(stage).map(item => `${item.provider_id}/${item.model_id}`),
    expected,
    `${stage} 默认顺序必须以漫路、微众优先，智谱兜底`,
  );
}

const settings = {
  providers: [
    { id: 'deyunai', enabled: true, api_key: 'test', models: [{ id: 'claude-sonnet-4-6', enabled: true }] },
    { id: 'webang-maas', enabled: true, api_key: 'test', models: [{ id: 'gemini-2.5-flash', enabled: true }] },
    { id: 'zhipu', enabled: true, api_key: 'test', models: [{ id: 'glm-4.6v-flash', enabled: true }] },
  ],
};
assert.deepEqual(migration.configuredRoute(settings).map(item => `${item.provider_id}/${item.model_id}`), expected);

const content = adapters.anthropicVisionContent([
  { role: 'system', content: 'ignored system' },
  { role: 'user', content: [
    { type: 'text', text: 'inspect' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
    { type: 'image_url', image_url: { url: 'https://example.invalid/reference.webp' } },
  ] },
], 'fallback');
assert.deepEqual(content, [
  { type: 'text', text: 'inspect' },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
  { type: 'image', source: { type: 'url', url: 'https://example.invalid/reference.webp' } },
]);

assert.equal(
  adapters.validateDeyunaiTextContract(
    { id: 'deyunai', preset: 'deyunai' },
    { id: 'claude-sonnet-4-6', use: 'story', channel: 'overseas' },
  ).ok,
  true,
  '漫路 Claude Messages 不应被海外 Chat vendor 门禁误过滤',
);

console.log(JSON.stringify({ passed: true, stages: migration.STAGES.length, route: expected, paid_model_calls: 0 }));
