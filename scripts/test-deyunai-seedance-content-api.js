#!/usr/bin/env node
const assert = require('assert');
const {
  isSeedanceContentGenerationModel,
  buildSeedanceContentTaskBody,
  extractSeedanceContentTaskVideoUrl,
  ensurePersonImageAsset,
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
  referenceAssetUrls: ['asset://asset-person-001'],
});
assert.strictEqual(i2v.ratio, '9:16');
assert.strictEqual(i2v.resolution, '1080p');
assert.strictEqual(i2v.duration, 10);
assert.deepStrictEqual(i2v.content[1], {
  type: 'image_url',
  image_url: { url: 'https://example.com/frame.png' },
  role: 'first_frame',
});
assert.strictEqual(i2v.content.length, 2, '首帧模式不能混入 reference_image');

const referenceOnly = buildSeedanceContentTaskBody({
  model: 'doubao-seedance-2-0-260128',
  prompt: 'reference only',
  duration: 5,
  size: '720x1280',
  referenceAssetUrls: ['asset://asset-person-001'],
});
assert.deepStrictEqual(referenceOnly.content[1], {
  type: 'image_url',
  image_url: { url: 'asset://asset-person-001' },
  role: 'reference_image',
});

assert.strictEqual(
  extractSeedanceContentTaskVideoUrl({ content: { video_url: 'https://cdn.example.com/a.mp4' } }),
  'https://cdn.example.com/a.mp4'
);
assert.strictEqual(
  extractSeedanceContentTaskVideoUrl({ output: { results: [{ video: { url: 'https://cdn.example.com/b.mp4' } }] } }),
  'https://cdn.example.com/b.mp4'
);

let listCalls = 0;
const fakeHttpClient = {
  async post(url, body) {
    if (url.endsWith('/ListAssetGroups')) {
      assert.strictEqual(body.Filter.GroupType, 'AIGC');
      assert.strictEqual(body.Filter.Name, 'vido_person_test');
      return { data: { Result: { Items: [] } } };
    }
    if (url.endsWith('/CreateAssetGroup')) {
      assert.strictEqual(body.Name, 'vido_person_test');
      assert.strictEqual(body.GroupType, 'AIGC');
      return { data: { Result: { Id: 'group-aigc-001' } } };
    }
    if (url.endsWith('/CreateAsset')) {
      assert.strictEqual(body.GroupId, 'group-aigc-001');
      assert.strictEqual(body.AssetType, 'Image');
      return { data: { Result: { Id: 'asset-person-001' } } };
    }
    if (url.endsWith('/ListAssets')) {
      listCalls += 1;
      return { data: { Result: { Items: [{ Id: 'asset-person-001', Status: listCalls > 1 ? 'Active' : 'Processing' }] } } };
    }
    throw new Error(`unexpected fake request: ${url}`);
  },
};

(async () => {
  const asset = await ensurePersonImageAsset({
    sourceUrl: 'https://example.com/actor-front.png',
    groupType: 'AIGC',
    groupName: 'vido_person_test',
    httpClient: fakeHttpClient,
    pollIntervalMs: 1,
    timeoutMs: 2000,
  });
  assert.strictEqual(asset.asset_id, 'asset-person-001');
  assert.strictEqual(asset.asset_url, 'asset://asset-person-001');
  assert.strictEqual(asset.status, 'Active');
  assert.strictEqual(listCalls, 2);
  await assert.rejects(
    () => ensurePersonImageAsset({
      sourceUrl: 'https://example.com/real-person.png',
      groupType: 'LivenessFace',
      httpClient: fakeHttpClient,
      pollIntervalMs: 1,
      timeoutMs: 100,
    }),
    error => error?.code === 'DEYUNAI_LIVENESS_GROUP_BINDING_REQUIRED',
  );
  console.log('DEYUNAI_SEEDANCE_CONTENT_API_TEST_OK');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
