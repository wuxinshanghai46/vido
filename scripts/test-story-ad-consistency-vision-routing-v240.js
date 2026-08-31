#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-vision-routing-v240-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
fs.writeFileSync(path.join(outputDir, 'settings.json'), JSON.stringify({ providers: [
  { id: 'smscrw', enabled: true, api_key: 'test', api_url: 'https://example.invalid/v1', models: [{ id: 'claude-opus-4-8', enabled: true, use: 'vision' }] },
  { id: 'deyunai', preset: 'deyunai', enabled: true, api_key: 'test', api_url: 'https://example.invalid', models: [{ id: 'claude-opus-4-7', enabled: true, use: 'vision', channel: 'overseas' }] },
  { id: 'webang-maas', enabled: true, api_key: 'test', api_url: 'https://example.invalid/v1', models: [{ id: 'gemini-2.5-pro', enabled: true, use: 'vision' }] },
  { id: 'zhipu', enabled: true, api_key: 'test', api_url: 'https://example.invalid/v1', models: [{ id: 'glm-4.6v-flash', enabled: true, use: 'vision' }] },
] }));
const pipeline = require('../src/services/pipelineModelService');
const adapters = require('../src/services/newStoryAd/providerAdapterRegistry');
const gateway = require('../src/services/newStoryAd/modelGateway');
const migration = require('./configure-story-ad-consistency-vision-routing-v240');

const expected = [
  'smscrw/claude-opus-4-8',
  'webang-maas/gemini-2.5-pro',
  'deyunai/claude-opus-4-7',
];

for (const stage of migration.STAGES) {
  assert.deepEqual(
    pipeline.getStageDefaults(stage).map(item => `${item.provider_id}/${item.model_id}`),
    expected,
    `${stage} 默认顺序必须服从当前供应商排行并选择各家最佳视觉模型`,
  );
}

const settings = {
  providers: [
    { id: 'smscrw', enabled: true, api_key: 'test', models: [{ id: 'claude-opus-4-8', enabled: true, use: 'vision' }] },
    { id: 'deyunai', enabled: true, api_key: 'test', models: [{ id: 'claude-opus-4-7', enabled: true, use: 'vision', channel: 'overseas' }] },
    { id: 'webang-maas', enabled: true, api_key: 'test', models: [{ id: 'gemini-2.5-pro', enabled: true }] },
    { id: 'zhipu', enabled: true, api_key: 'test', models: [{ id: 'glm-4.6v-flash', enabled: true }] },
  ],
};
assert.deepEqual(
  gateway.candidatesForVisionStage('new_story_ad.scene_camera_qa').map(item => `${item.provider_id}/${item.model_id}`),
  expected,
  '真实候选发现必须保持当前供应商顺序，并保留满足适配器合同的供应商模型',
);
assert.equal(
  adapters.resolveTextAdapter({ provider_id: 'zhipu', model_id: 'glm-4.6v-flash', _stageId: 'new_story_ad.scene_camera_qa', _capability: 'vision' }).modelId,
  'glm-4.6v-flash',
  'scene_camera_qa 必须按 VLM 能力解析智谱，不能误判为文本模型',
);

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

console.log(JSON.stringify({ passed: true, stages: migration.STAGES.length, route: expected, actual_candidate_discovery: true, camera_qa_vlm_adapter: true, paid_model_calls: 0 }));
fs.rmSync(outputDir, { recursive: true, force: true });
