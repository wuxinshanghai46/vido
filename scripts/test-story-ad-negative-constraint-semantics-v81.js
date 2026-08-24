'use strict';

const assert = require('assert/strict');
const subjectAssets = require('../src/services/newStoryAd/subjectAssetBundleService');
const checkpointService = require('../src/services/newStoryAd/assetGenerationCheckpointService');
const negativeContracts = require('../src/services/newStoryAd/negativeConstraintContractService');
const uiHarness = require('./test-story-ad-recovery-plan-action-final-dom-v79');

const oldNegative = '禁止出现文字水印；不要出现多余人物；禁止改变年龄；禁止改变服装颜色';
const equivalentNegative = '  不得改变服装颜色。\n避免出现文字水印，禁止出现多余人物；不得改变年龄  ';
const relaxedNegative = '不得改变年龄；不要出现文字水印；禁止出现多余人物';

function profile(id, negativeText = oldNegative) {
  return {
    id, displayName: `人物${id}`, roleName: '主角', age: '25~35岁',
    appearanceText: '清秀面容、自然肤质', wardrobeText: '白色长裙', hairMakeupText: '自然长发',
    negativeText,
    look_profiles: [{
      id: `${id}-look-1`, name: '现代造型', wardrobeText: '白色长裙', hairMakeupText: '自然长发', negativeText,
    }],
  };
}

const priorProfiles = ['p1', 'p2', 'p3', 'p4'].map(id => profile(id));
const equivalentProfiles = ['p1', 'p2', 'p3', 'p4'].map(id => profile(id, equivalentNegative));
const relaxedProfiles = ['p1', 'p2', 'p3', 'p4'].map(id => profile(id, relaxedNegative));

const punctuationOld = profile('p-format');
punctuationOld.wardrobeText = '白色长裙；黑色平底鞋';
punctuationOld.look_profiles[0].wardrobeText = '白色长裙；黑色平底鞋';
punctuationOld.look_profiles[0].accessories = [{ type: '银耳钉', position: '耳部' }];
const punctuationCurrent = JSON.parse(JSON.stringify(punctuationOld));
punctuationCurrent.wardrobeText = '白色长裙; 黑色平底鞋';
punctuationCurrent.look_profiles[0].wardrobeText = '白色长裙 ; 黑色平底鞋';
assert.equal(subjectAssets.personProfileResumeCompatible(punctuationOld, punctuationCurrent), true,
  'production-equivalent full-width/half-width wardrobe delimiters must normalize to the same positive contract');
const changedWardrobeToken = JSON.parse(JSON.stringify(punctuationCurrent));
changedWardrobeToken.look_profiles[0].wardrobeText = '白色长裙；红色高跟鞋';
assert.equal(subjectAssets.personProfileResumeCompatible(punctuationOld, changedWardrobeToken), false,
  'normalizing delimiters must not hide a real garment or footwear token change');
const changedAccessoryToken = JSON.parse(JSON.stringify(punctuationCurrent));
changedAccessoryToken.look_profiles[0].accessories = [{ type: '金耳钉', position: '耳部' }];
assert.equal(subjectAssets.personProfileResumeCompatible(punctuationOld, changedAccessoryToken), false,
  'normalizing punctuation must not hide a real accessory token change');
const accessoryReport = subjectAssets.personProfileResumeCompatibility(punctuationOld, changedAccessoryToken);
const accessoryDifference = accessoryReport.differences.find(item => item.field_path === 'look_profiles.0.accessories');
assert.equal(accessoryReport.compatible, false);
assert.equal(accessoryDifference.subject_id, 'p-format');
assert.equal(accessoryDifference.display_name, '人物p-format');
assert.equal(accessoryDifference.reason_code, 'positive_structure_changed');
assert(accessoryDifference.before_summary?.fingerprint && accessoryDifference.after_summary?.fingerprint);
assert.notEqual(accessoryDifference.before_summary.fingerprint, accessoryDifference.after_summary.fingerprint);
assert.doesNotMatch(JSON.stringify(accessoryDifference), /银耳钉|金耳钉|system_prompt|raw_prompt/i,
  'public compatibility reports must expose only redacted length/hash summaries, never raw profile or prompt text');

const equivalentContract = negativeContracts.compareNegativeConstraintContracts(oldNegative, equivalentNegative);
assert.equal(equivalentContract.version, 'negative-constraint-v1');
assert.equal(equivalentContract.compatible, true);
assert.equal(equivalentContract.relation, 'equivalent');
assert.equal(equivalentContract.previous.constraints.length, 4);
assert(equivalentContract.current.constraints.every(row => row.polarity === 'deny'
  && row.category === 'visual_exclusion' && row.tokens.length && row.source),
'negative compatibility must be based on an audited structured contract, not by deleting the field from comparison');
const relaxedContract = negativeContracts.compareNegativeConstraintContracts(oldNegative, relaxedNegative);
assert.equal(relaxedContract.compatible, true);
assert.equal(relaxedContract.relation, 'monotonic_relaxation');

assert(priorProfiles.every((row, index) => subjectAssets.personProfileResumeCompatible(row, equivalentProfiles[index])),
  'punctuation, whitespace, order and prohibition-word synonyms must not invalidate four-person cached assets');
assert(priorProfiles.every((row, index) => subjectAssets.personProfileResumeCompatible(row, relaxedProfiles[index])),
  'a current negative contract that is a semantic subset of the old contract is a safe monotonic relaxation');

const addedRestriction = profile('p1', `${equivalentNegative}；禁止改变发型`);
assert.equal(subjectAssets.personProfileResumeCompatible(priorProfiles[0], addedRestriction), false,
  'a genuinely new current restriction must reject checkpoint reuse');
const conflictingRestriction = profile('p1', '必须出现文字水印；禁止出现多余人物；禁止改变年龄；禁止改变服装颜色');
assert.equal(subjectAssets.personProfileResumeCompatible(priorProfiles[0], conflictingRestriction), false,
  'a conflicting current constraint must reject checkpoint reuse');
const conflictContract = negativeContracts.compareNegativeConstraintContracts(oldNegative, conflictingRestriction.negativeText);
assert.equal(conflictContract.relation, 'conflict');
assert.equal(conflictContract.conflicts.length, 1);
const addedContract = negativeContracts.compareNegativeConstraintContracts(oldNegative, addedRestriction.negativeText);
assert.equal(addedContract.relation, 'restriction_added');
assert.equal(addedContract.added.length, 1);
const positiveChange = { ...equivalentProfiles[0], appearanceText: '不同脸型' };
assert.equal(subjectAssets.personProfileResumeCompatible(priorProfiles[0], positiveChange), false,
  'semantic negative normalization must never hide a positive profile change');

const completed = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`kept-${index + 1}`, {
  key: `kept-${index + 1}`, status: 'completed', provider_submission_state: 'completed', billing_state: 'confirmed',
  result: { image_url: `/kept-${index + 1}.png` }, input_fingerprint: `stable-${index + 1}`,
}]));
const missing = Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`missing-${index + 1}`, {
  key: `missing-${index + 1}`, status: 'failed', provider_submission_state: 'submission_rejected', billing_state: 'not_billed',
}]));

function recoverySummary() {
  return {
    completed_units: 25, total_units: 28, retry_blocked: false, billing_review_state: 'not_billed',
    missing_units: Array.from({ length: 3 }, (_, index) => ({
      key: `missing-${index + 1}`, unit: `wearable_accessory:slot-${index + 1}`, label: `缺失项${index + 1}`,
      reason: '供应商拒绝且未计费', billing_review_state: 'not_billed', billing_state: 'not_billed',
      provider_submission_state: 'submission_rejected', retry_blocked: false,
    })),
  };
}

(async () => {
  const safe = priorProfiles.every((row, index) => subjectAssets.personProfileResumeCompatible(row, equivalentProfiles[index]));
  assert.equal(safe, true);
  // ProductionGraph is now the only live generation authority. Historical
  // checkpoint state may remain readable, but it must not remount legacy actions.
  const safePage = await uiHarness.render({ checkpoint: recoverySummary(), stale: true });
  assert.equal(uiHarness.withAttr(safePage.buttons, 'data-generate-subject-assets').length, 1,
    'the live asset center must expose the independent subject generation action');
  assert.equal(uiHarness.withAttr(safePage.buttons, 'data-generate-recovery').length, 0);
  assert.equal(uiHarness.withAttr(safePage.buttons, 'data-update-person-plan').length, 0);
  assert.doesNotMatch(safePage.html, /先更新人物方案|人物方案需要更新|更新当前内容的人物方案/,
    'the recovery UI must not expose internal person-plan terminology');

  const unsafe = subjectAssets.personProfileResumeCompatible(priorProfiles[0], addedRestriction);
  let unsafeProviderCalls = 0;
  assert.equal(unsafe, false, 'unsafe fixture must be rejected by click-time preflight');
  assert.equal(unsafeProviderCalls, 0, 'an unsafe contract must perform zero provider submissions');

  const memory = new Map(Object.entries({ ...completed, ...missing }));
  let providerCalls = 0;
  const runs = await Promise.all([...memory.keys()].map(key => checkpointService.runCheckpointedUnit({
    identity: { key }, load: async id => memory.get(id), save: async (id, value) => memory.set(id, value),
    execute: async () => { providerCalls += 1; return { image_url: `/new-${providerCalls}.png` }; },
  })));
  assert.equal(runs.filter(row => row.reused).length, 25);
  assert.equal(providerCalls, 3, 'safe semantic contract must preserve 25 and submit exactly the three missing units');
  console.log(JSON.stringify({ passed: true, people: 4, semantic_equivalent: true, monotonic_relaxation: true, cache_hits: 25, fake_provider_calls: 3, unsafe_provider_calls: unsafeProviderCalls, model_calls: 0 }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
