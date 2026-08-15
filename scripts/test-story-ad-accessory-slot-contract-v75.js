const assert = require('assert');

const dossier = require('../src/services/newStoryAd/dossierCompositeService');
const wearablePolicy = require('../src/services/newStoryAd/wearableEvidencePolicyService');

function keys(profile) {
  return dossier.explicitAccessoryDefinitions(profile).map(item => item.key);
}

function memoryCheckpointService() {
  return {
    normalizeCheckpoint: value => value,
    runCheckpointedUnit: async ({ execute }) => ({ result: await execute({
      providerResult: null,
      onSubmitting: async () => {},
      onSubmitted: async () => {},
      onProviderResult: async () => {},
    }), reused: false }),
  };
}

(async () => {
  assert.deepStrictEqual(keys({ wardrobe_contract: { accessories: { mode: 'none', items: [{ type: '发簪' }] } } }), [],
    'authoritative accessories.mode=none must suppress stale positive item text');
  for (const negative of ['不加发饰', '无发饰', '不佩戴发簪', 'without hairpin']) {
    assert(!keys({ hairMakeupText: negative }).includes('hair_accessories'), `${negative} must not create a hair accessory unit`);
  }
  assert(keys({ hairMakeupText: '佩戴一枚白玉发簪' }).includes('hair_accessories'), 'positive 发簪 evidence must create hair slot');
  assert(keys({ wardrobeText: '玄色腰带，系白玉腰佩' }).includes('waist_accessories'), 'positive 腰带 evidence must create waist slot');

  const calls = [];
  const profile = {
    age_range: '13~17岁',
    wardrobeText: '少女穿白裙，腰间玉带；剧情中持剑打斗后死亡；年龄为成年；另有耳环和项链',
    hairMakeupText: '黑发，以白玉发簪固定',
    wardrobe_contract: {
      accessories: { mode: 'specified', items: [
        { type: '白玉发簪', position: '发间', material: '玉' },
        { type: '金属腰带', position: '腰间', material: '金属' },
        { type: '耳环', position: '耳部', material: '银' },
      ] },
    },
  };
  const rows = await dossier.generateWearableDetails({
    taskId: 'v75-accessory', assetId: 'minor-p1', revision: 1, profile,
    definitions: dossier.explicitAccessoryDefinitions(profile).filter(item => ['hair_accessories', 'waist_accessories'].includes(item.key)),
    atomicAssets: [
      { id: 'minor-face', kind: 'identity', key: 'face_front', image_url: '/minor-face.png' },
      { id: 'minor-body', kind: 'body', key: 'front', image_url: '/minor-body.png' },
    ],
    loadCheckpoint: async () => null,
    saveCheckpoint: async () => {},
  }, {
    checkpointService: memoryCheckpointService(),
    mediaAdapter: {
      generateImage: async options => {
        calls.push(options);
        return { image_url: `/generated/${calls.length}.png`, provider_used: 'fake/provider' };
      },
    },
  });
  assert.equal(rows.length, 2);
  assert.equal(calls.length, 2);
  const hair = calls.find(call => /发饰/.test(call.prompt));
  const waist = calls.find(call => /腰带/.test(call.prompt));
  assert(hair && waist, 'each requested slot must have its own provider call');
  for (const [slot, call] of [['hair', hair], ['waist', waist]]) {
    assert(!/持剑|打斗|死亡|成年/.test(call.prompt), `${slot} prompt must exclude plot violence/death and conflicting age prose`);
    assert.equal(call.referenceImages?.length || 0, 0, `${slot} minor face/body must not be sent as an independent accessory reference`);
    assert.equal(call.requireReferences, false, `${slot} minor accessory generation must not require face/body reference`);
  }
  assert(!/腰带|耳环|项链/.test(hair.prompt), 'hair slot prompt must not contain waist/ear/neck accessory evidence');
  assert(!/发簪|耳环|项链/.test(waist.prompt), 'waist slot prompt must not contain hair/ear/neck accessory evidence');

  let historicalLoads = 0;
  let historicalProviderCalls = 0;
  const migrated = await wearablePolicy.resolve({
    taskId: 'xing-yue-history', assetId: 'yun-reincarnation', revision: 2,
    profile: {
      name: '林知月（现代）', role: '云知月的现代转世', age_range: '25~35岁',
      hairMakeupText: '现代自然长发，不加发饰，without hairpin',
      wardrobe_contract: { accessories: { mode: 'none', items: [] } },
    },
    atomicAssets: [{ kind: 'wearable_accessory', key: 'hair_accessories', image_url: '/legacy-fake-hairpin.png' }],
    loadCheckpoint: async () => { historicalLoads += 1; return { status: 'completed', result: { image_url: '/legacy-fake-hairpin.png' } }; },
    saveCheckpoint: async () => {},
  }, {
    checkpointService: memoryCheckpointService(),
    mediaAdapter: { generateImage: async () => { historicalProviderCalls += 1; return { image_url: '/must-not-run.png' }; } },
  });
  assert.deepStrictEqual(migrated.items, [], 'modern reincarnation with authoritative no-accessory contract must drop the legacy false hair-accessory unit');
  assert.equal(historicalLoads, 0, 'a removed historical false unit must not even be loaded/reused');
  assert.equal(historicalProviderCalls, 0, 'historical cleanup must use zero provider/model calls');

  console.log(JSON.stringify({ passed: true, negative_modes: 5, positive_slots: 2, fake_provider_calls: calls.length, historical_false_units_removed: 1, planning_model_calls: 0 }));
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
