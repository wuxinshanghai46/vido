'use strict';

const assert = require('assert/strict');
const proof = require('../src/services/newStoryAd/subjectProfileAuthorityProofService');
const subjects = require('../src/services/newStoryAd/subjectAssetBundleService');

function compact(id, index) {
  return {
    id, lineage_identity_id: `lineage-${id}`, displayName: `人物${index + 1}`, roleName: index ? '配角' : '主角',
    age: index ? '18~25岁' : '25~35岁', appearanceText: `人物${index + 1}核心外貌`, wardrobeText: '用户服装方向',
    hairMakeupText: '用户发型', negativeText: '禁止文字',
    look_profiles: [{ id: `${id}:look`, wardrobeText: '用户服装方向', hairMakeupText: '用户发型', negativeText: '禁止文字',
      garments: [], footwear: [], accessories: [], wardrobe_contract: null }],
  };
}

function enrich(profile) {
  const contract = { style_family: 'task-derived', knowledge_doc_ids: ['kb-task'], garments: ['task garment'] };
  const completion = {
    schema_version: 4, source: proof.DERIVED_SOURCE, user_text: profile.wardrobeText,
    ai_supplement: '平台补齐的可生成细节', resolved_text: `${profile.wardrobeText}；平台补齐的可生成细节`, wardrobe_contract: contract,
  };
  const look = { ...profile.look_profiles[0], wardrobeText: completion.resolved_text, style_family: contract.style_family,
    wardrobe_contract: contract, knowledge_refs: contract.knowledge_doc_ids, wardrobe_completion: completion };
  return { ...profile, wardrobeText: completion.resolved_text, wardrobe_contract: contract,
    wardrobe_completion: completion, look_profiles: [look] };
}

const active = Array.from({ length: 4 }, (_, index) => compact(`person-${index + 1}`, index));
const current = active.map(enrich);
const baseArgs = { active, sealed: structuredClone(active), checkpoint: structuredClone(current), current,
  completion: structuredClone(current), contentRevision: 12, sealedRevision: 12,
  activeSnapshotId: 'snapshot-v84', sealedSnapshotId: 'snapshot-v84', subjectAssets: subjects };

assert.deepEqual(proof.prove(baseArgs), {
  compatible: true, reason: 'proven_platform_derived_enrichment', contract_version: 1,
}, 'four stable identities with explicit wardrobe-completion provenance must be safe');

for (const [label, mutate] of [
  ['name', row => { row.displayName = '改名'; }],
  ['role', row => { row.roleName = '反派'; }],
  ['age', row => { row.age = '60~70岁'; }],
  ['appearance', row => { row.appearanceText = '核心外貌已改变'; }],
]) {
  const changed = structuredClone(current); mutate(changed[0]);
  assert.equal(proof.prove({ ...baseArgs, current: changed, checkpoint: changed }).compatible, false,
    `${label} is user semantic authority and must block`);
}

for (const field of ['source', 'schema_version', 'resolved_text', 'wardrobe_contract']) {
  const missing = structuredClone(current); delete missing[0].look_profiles[0].wardrobe_completion[field];
  assert.equal(proof.prove({ ...baseArgs, current: missing, checkpoint: missing }).compatible, false,
    `missing provenance field ${field} must block`);
}

const wrongRevision = proof.prove({ ...baseArgs, sealedRevision: 11 });
assert.equal(wrongRevision.compatible, false); assert.equal(wrongRevision.reason, 'sealed_revision_mismatch');
for (const patch of [
  { activeSnapshotId: '' }, { sealedSnapshotId: '' }, { sealedSnapshotId: 'different-snapshot' }, { completion: [] },
]) assert.equal(proof.prove({ ...baseArgs, ...patch }).compatible, false,
  'missing or changed snapshot/completion provenance must block');
const completionWrongId = structuredClone(current); completionWrongId[0].id = 'wrong-completion-person';
assert.equal(proof.prove({ ...baseArgs, completion: completionWrongId }).compatible, false,
  'completion provenance must carry the same stable person IDs');
const completionReordered = structuredClone(current); [completionReordered[0], completionReordered[1]] = [completionReordered[1], completionReordered[0]];
assert.equal(proof.prove({ ...baseArgs, completion: completionReordered }).compatible, false,
  'completion provenance order must match active/sealed/checkpoint/current order');
const changedId = structuredClone(current); changedId[0].id = 'replacement-person';
assert.equal(proof.prove({ ...baseArgs, current: changedId, checkpoint: changedId }).compatible, false, 'stable ID changes must block');
const reordered = structuredClone(current); [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
assert.equal(proof.prove({ ...baseArgs, current: reordered, checkpoint: reordered }).compatible, false, 'person order changes must block');
const checkpointChanged = structuredClone(current); checkpointChanged[0].appearanceText = 'checkpoint不再等于current';
assert.equal(proof.prove({ ...baseArgs, checkpoint: checkpointChanged }).compatible, false, 'checkpoint incompatibility must block');

const unprovenDerivedField = structuredClone(current); unprovenDerivedField[0].world_revision = 99;
assert.equal(proof.prove({ ...baseArgs, current: unprovenDerivedField, checkpoint: unprovenDerivedField }).compatible, false,
  'new platform-derived fields must not be accepted without their own explicit source contract');
const lineageChanged = structuredClone(current); lineageChanged[0].lineage_identity_id = 'different-lineage';
assert.equal(proof.prove({ ...baseArgs, current: lineageChanged, checkpoint: lineageChanged }).compatible, false,
  'lineage identity changes must block even when the display ID is unchanged');

console.log(JSON.stringify({ passed: true, people: 4, semantic_blockers: 4, provenance_blockers: 4,
  revision_blocked: true, id_order_lineage_blocked: true, checkpoint_blocked: true, model_calls: 0, provider_calls: 0 }));
