#!/usr/bin/env node
const assert = require('assert');
const {
  isSeedanceContentGenerationModel,
  buildSeedanceContentTaskBody,
  extractSeedanceContentTaskVideoUrl,
} = require('../src/services/deyunaiService');

assert.strictEqual(isSeedanceContentGenerationModel('doubao-seedance-2-0-260128'), true);
assert.strictEqual(isSeedanceContentGenerationModel('doubao-seedance-2-0-fast-260128'), true);
assert.strictEqual(isSeedanceContentGenerationModel('sora-2'), false);

const t2v = buildSeedanceContentTaskBody({
  model: 'doubao-seedance-2-0-260128',
  prompt: '测试提示词',
  duration: 5,
  size: '1280x720',
});
assert.deepStrictEqual(t2v, {
  model: 'doubao-seedance-2-0-260128',
  content: [{ type: 'text', text: '测试提示词' }],
  ratio: '16:9',
  duration: 5,
  resolution: '720p',
  generate_audio: false,
  watermark: false,
});

const i2v = buildSeedanceContentTaskBody({
  model: 'doubao-seedance-2-0-fast-260128',
  prompt: '人物向前走一步',
  duration: 12,
  size: '1080x1920',
  imageUrl: 'https://example.com/frame.png',
});
assert.strictEqual(i2v.ratio, '9:16');
assert.strictEqual(i2v.resolution, '1080p');
assert.strictEqual(i2v.duration, 10);
assert.deepStrictEqual(i2v.content[1], {
  type: 'image_url',
  image_url: { url: 'https://example.com/frame.png' },
  role: 'first_frame',
});

assert.strictEqual(
  extractSeedanceContentTaskVideoUrl({ content: { video_url: 'https://cdn.example.com/a.mp4' } }),
  'https://cdn.example.com/a.mp4'
);
assert.strictEqual(
  extractSeedanceContentTaskVideoUrl({ output: { results: [{ video: { url: 'https://cdn.example.com/b.mp4' } }] } }),
  'https://cdn.example.com/b.mp4'
);

console.log('DEYUNAI_SEEDANCE_CONTENT_API_TEST_OK');
