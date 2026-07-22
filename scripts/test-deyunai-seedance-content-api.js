#!/usr/bin/env node
const assert = require('assert');
const {
  isSeedanceContentGenerationModel,
  buildSeedanceContentTaskBody,
  extractSeedanceContentTaskVideoUrl,
  seedanceContentTaskError,
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
assert.strictEqual(i2v.duration, 12);
assert.deepStrictEqual(i2v.content[1], {
  type: 'image_url',
  image_url: { url: 'asset://asset-person-001' },
  role: 'reference_image',
});
assert.strictEqual(i2v.content.length, 2, '人物资产模式不能混入 first_frame');

const frameOnly = buildSeedanceContentTaskBody({
  model: 'doubao-seedance-2-0-260128',
  prompt: 'frame only',
  duration: 20,
  size: '720x960',
  imageUrl: 'https://example.com/frame.png',
});
assert.strictEqual(frameOnly.ratio, '3:4');
assert.strictEqual(frameOnly.duration, 15);
assert.strictEqual(frameOnly.content[1].role, 'first_frame');

const landscape43 = buildSeedanceContentTaskBody({
  model: 'doubao-seedance-2-0-260128',
  prompt: 'four by three',
  duration: 5,
  size: '960x720',
});
assert.strictEqual(landscape43.ratio, '4:3');

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

const personAndSceneReferences = buildSeedanceContentTaskBody({
  model: 'doubao-seedance-2-0-260128',
  prompt: 'continuous current-task scene',
  duration: 10,
  size: '1280x720',
  imageUrl: 'https://example.com/forbidden-mixed-first-frame.png',
  referenceAssetUrls: ['asset://asset-person-001', 'asset://asset-scene-001'],
});
assert.deepStrictEqual(personAndSceneReferences.content.slice(1).map(item => [item.image_url.url, item.role]), [
  ['asset://asset-person-001', 'reference_image'],
  ['asset://asset-scene-001', 'reference_image'],
]);
assert.strictEqual(personAndSceneReferences.content.some(item => item.role === 'first_frame'), false, '人物+场景素材仍必须保持单一 reference-media 输入模式');

const currentKeyframeAndPreviousTail = buildSeedanceContentTaskBody({
  model: 'doubao-seedance-2-0-260128',
  prompt: 'repair a failed cross-unit boundary',
  duration: 5,
  size: '720x1280',
  referenceAssetUrls: ['asset://current-keyframe', 'asset://previous-tail'],
});
assert.deepStrictEqual(
  currentKeyframeAndPreviousTail.content.filter(item => item.type === 'image_url').map(item => [item.image_url.url, item.role]),
  [['asset://current-keyframe', 'reference_image'], ['asset://previous-tail', 'reference_image']],
  'boundary repair must submit both private visual anchors in stable semantic order',
);
assert(!currentKeyframeAndPreviousTail.content.some(item => item.role === 'first_frame'), 'Seedance boundary repair must not mix first_frame with managed references');

assert.strictEqual(
  extractSeedanceContentTaskVideoUrl({ content: { video_url: 'https://cdn.example.com/a.mp4' } }),
  'https://cdn.example.com/a.mp4'
);
assert.strictEqual(
  extractSeedanceContentTaskVideoUrl({ output: { results: [{ video: { url: 'https://cdn.example.com/b.mp4' } }] } }),
  'https://cdn.example.com/b.mp4'
);

const privacyError = seedanceContentTaskError({
  error: {
    code: 'InputImageSensitiveContentDetected.PrivacyInformation',
    message: 'The request failed because the input image may contain real person. Request id: 02178417084623764d8a6219dbbdb6281842e0590025e923e2605',
    type: 'BadRequest',
  },
});
assert.strictEqual(privacyError.code, 'INPUT_PERSON_PRIVACY');
assert.strictEqual(privacyError.retryable, false);
assert.match(privacyError.message, /提交失败/);

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
