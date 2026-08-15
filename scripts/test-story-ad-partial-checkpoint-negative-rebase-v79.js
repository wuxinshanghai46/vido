'use strict';

const assert = require('assert/strict');
const subjectAssets = require('../src/services/newStoryAd/subjectAssetBundleService');
const checkpointService = require('../src/services/newStoryAd/assetGenerationCheckpointService');

const previousNegative = '禁止文字；禁止水印；禁止多余人物';
const currentNegative = '禁止文字；禁止水印';
const profile = (id, negativeText = previousNegative) => ({
  id,
  displayName: `人物${id}`,
  roleName: '主角',
  age: '25~35岁',
  appearanceText: '清秀面容、自然肤质',
  // The checkpoint stores the effective primary-look projection; the canonical
  // top-level compatibility fields therefore match that same primary look.
  wardrobeText: '白色长裙',
  hairMakeupText: '自然长发、淡妆',
  negativeText,
  // Production-equivalent: look inherits the profile negative contract instead of
  // carrying a separately edited negativeText value.
  look_profiles: [
    { id: `${id}-look-1`, name: '现代造型', wardrobeText: '白色长裙', hairMakeupText: '自然长发' },
    { id: `${id}-look-2`, name: '夜景造型', wardrobeText: '深色外套', hairMakeupText: '低马尾' },
  ],
});

const priorProfiles = ['p1', 'p2', 'p3', 'p4'].map(id => profile(id));
const currentProfiles = priorProfiles.map(row => profile(row.id, currentNegative));

for (let index = 0; index < priorProfiles.length; index += 1) {
  assert.equal(subjectAssets.personProfileResumeCompatible(priorProfiles[index], currentProfiles[index]), true,
    'removing only old negative constraints must preserve the 25 already-paid successful assets');
}

const mutations = [
  ['stable id', value => ({ ...value, id: 'different-id' })],
  ['name', value => ({ ...value, displayName: '不同名字' })],
  ['role', value => ({ ...value, roleName: '反派' })],
  ['age', value => ({ ...value, age: '36~45岁' })],
  ['appearance', value => ({ ...value, appearanceText: '不同脸型' })],
  ['wardrobe', value => ({ ...value, wardrobeText: '红色西装' })],
  ['hair', value => ({ ...value, hairMakeupText: '短发浓妆' })],
  ['look content', value => ({ ...value, look_profiles: value.look_profiles.map((look, i) => i ? look : { ...look, wardrobeText: '红色礼服' }) })],
  ['look id', value => ({ ...value, look_profiles: value.look_profiles.map((look, i) => i ? look : { ...look, id: 'different-look-id' }) })],
  ['look order', value => ({ ...value, look_profiles: [...value.look_profiles].reverse() })],
];
for (const [label, mutate] of mutations) {
  assert.equal(subjectAssets.personProfileResumeCompatible(priorProfiles[0], mutate(currentProfiles[0])), false,
    `${label} changes must reject partial checkpoint reuse`);
}
assert.equal(subjectAssets.personProfileResumeCompatible(
  profile('p1', currentNegative), profile('p1', previousNegative),
), false, 'a new negative restriction not present in the old checkpoint must reject reuse');

const completed = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`kept-${index + 1}`, {
  key: `kept-${index + 1}`, unit: `identity:kept-${index + 1}`, status: 'completed',
  provider_submission_state: 'completed', billing_state: 'confirmed',
  result: { image_url: `/kept-${index + 1}.png` }, input_fingerprint: `stable-${index + 1}`,
}]));
const missing = Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`missing-${index + 1}`, {
  key: `missing-${index + 1}`, unit: `wearable_accessory:slot-${index + 1}`, status: 'failed',
  provider_submission_state: 'submission_rejected', billing_state: 'not_billed',
}]));
const checkpoint = {
  status: 'partial', counts: { people: 4, pets: 0 },
  targets: currentProfiles.map((row, index) => ({ kind: 'human', id: row.id, index, key: `human:${row.id}` })),
  input_profiles: { humans: priorProfiles.map(subjectAssets.personGenerationProfile), pets: [] },
  person_dossier_checkpoints: { ...completed, ...missing },
  subject_checkpoint_owners: Object.fromEntries([...Object.keys(completed), ...Object.keys(missing)].map(key => [key, { kind: 'human', subject_id: 'p1', index: 0 }])),
};
const storageFor = payload => ({
  listOutputs: () => [{ kind: 'subject_asset_checkpoint:v79-old', updated_at: '2026-08-15T10:00:00.000Z', payload }],
});
const storage = storageFor(checkpoint);
const targets = { selected: currentProfiles.map((row, index) => ({ kind: 'human', id: row.id, index, key: `human:${row.id}` })), selectedKeys: new Set() };
const resumed = subjectAssets.resumablePartialCheckpoint(storage, 'task-v79', { people: 4, pets: 0 }, targets, currentProfiles, []);
assert.equal(resumed, checkpoint, 'the production-equivalent four-person checkpoint must be selected for rebase');
assert.deepEqual(resumed.input_profiles.humans.map(row => row.id), currentProfiles.map(row => row.id), 'stable person IDs and order must remain unchanged');
const changedTargetKey = JSON.parse(JSON.stringify(checkpoint));
changedTargetKey.targets[2].key = 'human:p3:different-contract-key';
assert.equal(subjectAssets.resumablePartialCheckpoint(storageFor(changedTargetKey), 'task-v79', { people: 4, pets: 0 }, targets, currentProfiles, []), null,
  'a changed target key must reject reuse even when the display person IDs still match');
const changedTargetOrder = JSON.parse(JSON.stringify(checkpoint));
changedTargetOrder.targets.reverse();
assert.equal(subjectAssets.resumablePartialCheckpoint(storageFor(changedTargetOrder), 'task-v79', { people: 4, pets: 0 }, targets, currentProfiles, []), null,
  'changed target order must reject reuse instead of attaching cached images to the wrong member');

(async () => {
  const memory = new Map(Object.entries(resumed.person_dossier_checkpoints));
  let providerCalls = 0;
  const runs = await Promise.all([...memory.keys()].map(key => checkpointService.runCheckpointedUnit({
    identity: { key },
    load: async id => memory.get(id),
    save: async (id, value) => memory.set(id, value),
    execute: async () => { providerCalls += 1; return { image_url: `/new-${providerCalls}.png` }; },
  })));
  assert.equal(runs.filter(row => row.reused).length, 25, 'all 25 successful checkpoint units must remain cache hits');
  assert.equal(providerCalls, 3, 'provider calls must equal the current authoritative missing count');
  assert.deepEqual(resumed.targets.map(row => row.id), currentProfiles.map(row => row.id));
  console.log(JSON.stringify({ passed: true, people: 4, stable_person_ids: 4, cache_hits: 25, fake_provider_calls: providerCalls, model_calls: 0 }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
