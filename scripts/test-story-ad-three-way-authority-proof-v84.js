'use strict';

const assert = require('assert');
const proof = require('../src/services/newStoryAd/subjectProfileAuthorityProofService');
const subjects = require('../src/services/newStoryAd/subjectAssetBundleService');

const base = id => ({ id, displayName: `人物${id}`, roleName: '主角', age: '25~35', appearanceText: '黑发，五官清晰',
  wardrobeText: '白色长袍', hairMakeupText: '长发', negativeText: '不要文字',
  look_profiles: [{ id: `${id}:look`, wardrobeText: '白色长袍', hairMakeupText: '长发', negativeText: '不要文字', garments: [], footwear: [], accessories: [], wardrobe_contract: null }] });
const enrich = profile => {
  const contract = { style_family: 'ancient', knowledge_doc_ids: ['kb-1'], garments: ['white robe'] };
  const completion = { schema_version: 4, source: proof.DERIVED_SOURCE, user_text: '白色长袍', ai_supplement: '交领', resolved_text: '白色长袍；交领', wardrobe_contract: contract };
  const look = { ...profile.look_profiles[0], wardrobeText: completion.resolved_text, style_family: contract.style_family,
    wardrobe_contract: contract, knowledge_refs: contract.knowledge_doc_ids, wardrobe_completion: completion };
  return { ...profile, wardrobeText: completion.resolved_text, wardrobe_contract: contract, wardrobe_completion: completion,
    knowledge_refs: contract.knowledge_doc_ids, style_family: contract.style_family, richness: 'complete',
    source: 'generation_completion', name_source: 'planning', world_revision: 8, look_profiles: [{ ...look, richness: 'complete', source: 'generation_completion', world_revision: 8 }] };
};
const active = [base('a'), base('b')], current = active.map(enrich), args = { active, sealed: active, checkpoint: current,
  current, completion: current, contentRevision: 8, sealedRevision: 8, activeSnapshotId: 'sealed-r8', sealedSnapshotId: 'sealed-r8', subjectAssets: subjects };
assert.equal(proof.prove(args).compatible, true, 'explicit derived enrichment must be accepted');
assert.equal(proof.prove({ ...args, sealedRevision: 7 }).compatible, false, 'revision mismatch must block');
const unproven = structuredClone(current); delete unproven[0].look_profiles[0].wardrobe_completion;
assert.equal(proof.prove({ ...args, current: unproven, checkpoint: unproven }).compatible, false, 'missing provenance must block');
const changed = structuredClone(current); changed[0].appearanceText = '金发';
assert.equal(proof.prove({ ...args, current: changed, checkpoint: changed }).compatible, false, 'user semantic change must block');
const wrongContract = structuredClone(current); wrongContract[0].look_profiles[0].knowledge_refs = ['kb-2'];
assert.equal(proof.prove({ ...args, current: wrongContract, checkpoint: wrongContract }).compatible, false, 'contract mismatch must block');
console.log(JSON.stringify({ passed: true, contract_version: 1, model_calls: 0 }));
