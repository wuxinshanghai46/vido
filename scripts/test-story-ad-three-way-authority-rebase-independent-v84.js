'use strict';

const assert = require('assert/strict');
const { createService } = require('../src/services/newStoryAd/subjectRecoveryPreflightService');
const realSubjects = require('../src/services/newStoryAd/subjectAssetBundleService');

function compact(id, index) {
  return { id, lineage_identity_id: `lineage-${id}`, displayName: `人物${index + 1}`, roleName: index ? '配角' : '主角',
    age: index ? '18~25岁' : '25~35岁', appearanceText: `人物${index + 1}核心外貌`, wardrobeText: '用户服装方向',
    hairMakeupText: '用户发型', negativeText: '禁止文字', look_profiles: [{ id: `${id}:look`, wardrobeText: '用户服装方向',
      hairMakeupText: '用户发型', negativeText: '禁止文字', garments: [], footwear: [], accessories: [], wardrobe_contract: null }] };
}
function enrich(profile) {
  const contract = { style_family: 'task-derived', knowledge_doc_ids: ['kb-task'], garments: ['task garment'] };
  const completion = { schema_version: 4, source: 'generation_preflight_ai_completion', user_text: profile.wardrobeText,
    ai_supplement: '平台补齐细节', resolved_text: `${profile.wardrobeText}；平台补齐细节`, wardrobe_contract: contract };
  const look = { ...profile.look_profiles[0], wardrobeText: completion.resolved_text, style_family: contract.style_family,
    wardrobe_contract: contract, knowledge_refs: contract.knowledge_doc_ids, wardrobe_completion: completion };
  return { ...profile, wardrobeText: completion.resolved_text, wardrobe_contract: contract,
    wardrobe_completion: completion, look_profiles: [look] };
}
function checkpoint(current) {
  const units = {};
  for (let index = 0; index < 28; index += 1) units[`unit-${index + 1}`] = index < 25
    ? { status: 'completed', provider_submission_state: 'completed', billing_state: 'confirmed' }
    : { status: 'failed', provider_submission_state: 'submission_rejected', billing_state: 'not_billed', billing_review: { state: 'not_billed' } };
  return { status: 'failed', counts: { people: 4, pets: 0 }, input_profiles: { humans: structuredClone(current) },
    targets: current.map((row, index) => ({ kind: 'human', id: row.id, index, key: `human:${row.id}` })),
    person_dossier_checkpoints: units };
}

function fixture({ missingSnapshot = false, activeGeneration = false, billingUnknown = false,
  checkpointCompatible = true, failAfterPublish = false } = {}) {
  const activeCast = Array.from({ length: 4 }, (_, index) => compact(`person-${index + 1}`, index));
  const currentCast = activeCast.map(enrich);
  let task = { id: 'task-v84', content_revision: 12, active_generation_id: activeGeneration ? 'generation-live' : '', request: {} };
  let context = { cast_profiles: structuredClone(currentCast), revisions: { person_semantic: 12 } };
  let active = { active_revision: 7, fingerprint: 'ACTIVE', plan: { fingerprint: 'ACTIVE', cast_profiles: structuredClone(activeCast) } };
  let writes = 0, publishCalls = 0, providerCalls = 0;
  const cp = checkpoint(currentCast);
  const completion = { status: 'complete', cast_profiles: structuredClone(currentCast) };
  const snapshot = { id: 'snapshot-v84', task_id: task.id, content_revision: 12, status: 'sealed', payload: { cast_profiles: structuredClone(activeCast) } };
  const extras = new Map();
  const canonicalFingerprint = value => require('crypto').createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
  const storage = {
    getTask: () => task, getOutput: (_id, kind) => kind === 'context' ? context : extras.get(kind) || null,
    listOutputs: () => [
      { kind: 'subject_asset_checkpoint:v84', updated_at: '2026-08-15T12:00:00Z', payload: cp },
      { kind: 'generation_spec_completion:person:v84', updated_at: '2026-08-15T12:01:00Z', payload: completion },
    ],
    getManifest: () => ({ artifacts: { asset_plan_active: missingSnapshot ? '' : 'artifact-active' } }),
    getArtifact: id => id ? { id, snapshot_id: 'snapshot-v84' } : null,
    getSnapshot: id => id === snapshot.id ? snapshot : null,
    readDb: () => ({ snapshots: [snapshot] }), canonicalFingerprint,
    saveOutput: (_id, kind, value) => { extras.set(kind, value); writes += 1; },
    updateTask: (_id, patch) => { task = { ...task, ...patch }; writes += 1; },
    withWriteBatch(fn) {
      const before = { task: structuredClone(task), context: structuredClone(context), active: structuredClone(active), writes, publishCalls, extras: new Map(extras) };
      try { return fn(); } catch (error) {
        task = before.task; context = before.context; active = before.active; writes = before.writes; publishCalls = before.publishCalls;
        extras.clear(); before.extras.forEach((value, key) => extras.set(key, value)); throw error;
      }
    },
  };
  const subjectAssets = {
    resolveCounts: () => ({ people: 4, pets: 0 }), humanMemberSpecs: (_spec, body) => body.cast_profiles,
    petMemberSpecs: () => [], requestedSubjectTargets: (_body, humans) => ({ selected: humans.map((row, index) => ({ kind: 'human', id: row.id, index, key: `human:${row.id}` })) }),
    resumablePartialCheckpoint: (_storage, _id, _counts, _targets, humans) => checkpointCompatible
      && humans.every((row, index) => realSubjects.personProfileResumeCompatible(cp.input_profiles.humans[index], row)) ? cp : null,
    personProfileResumeCompatible: realSubjects.personProfileResumeCompatible,
    personProfileResumeCompatibility: realSubjects.personProfileResumeCompatibility,
  };
  const assetPlan = { fingerprint: () => 'CURRENT' };
  const publication = {
    ACTIVE_KIND: 'asset_plan_active', activeRecord: () => active,
    eligibility: (_id, { fingerprint }) => ({ eligible: !failAfterPublish && active.fingerprint === fingerprint, issues: [] }),
    publish: (_id, plan, options) => { publishCalls += 1; writes += 1; active = { active_revision: active.active_revision + 1,
      fingerprint: options.fingerprint, plan: { ...plan, fingerprint: options.fingerprint } }; publication.lastOptions = options; return active; },
  };
  const taskStateAudit = { billingRiskForTask: () => ({ active_unknown_billing: billingUnknown ? [{ key: 'unknown' }] : [], unquarantined_unknown_billing: [] }) };
  const service = createService({ storage, subjectAssets, assetPlan, publication, taskStateAudit });
  return { service, body: { cast_profiles: currentCast }, writes: () => writes, publishCalls: () => publishCalls,
    providerCalls: () => providerCalls, publication };
}

const safe = fixture(), preview = safe.service.preview('task-v84', safe.body);
assert.equal(preview.state, 'safe_rebase_available'); assert.equal(preview.authority_proof.compatible, true);
assert.equal(preview.retained_count, 25); assert.equal(preview.missing_count, 3); assert.equal(preview.model_call_count, 0);
const applied = safe.service.apply('task-v84', safe.body, preview.proof_token);
assert.equal(applied.state, 'ready'); assert.equal(applied.model_call_count, 0); assert.equal(safe.publishCalls(), 1);
assert.equal(safe.publication.lastOptions.source, 'subject_recovery_three_way_authority_rebase');
assert.equal(safe.publication.lastOptions.scope, 'person'); assert.equal(safe.publication.lastOptions.model_meta.model_call_count, 0);
assert.equal(safe.providerCalls(), 0, 'preflight and authority rebase must never call the image provider');

for (const options of [{ missingSnapshot: true }, { activeGeneration: true }, { billingUnknown: true }, { checkpointCompatible: false }]) {
  const blocked = fixture(options), before = blocked.writes(), result = blocked.service.preview('task-v84', blocked.body);
  assert.equal(result.state, 'blocked'); assert.equal(result.model_call_count, 0); assert.equal(blocked.writes(), before);
  assert.equal(blocked.publishCalls(), 0); assert.equal(blocked.providerCalls(), 0);
}
const atomic = fixture({ failAfterPublish: true }), atomicPreview = atomic.service.preview('task-v84', atomic.body), atomicWrites = atomic.writes();
assert.equal(atomicPreview.state, 'safe_rebase_available');
assert.throws(() => atomic.service.apply('task-v84', atomic.body, atomicPreview.proof_token), error => error.code === 'SUBJECT_RECOVERY_PREFLIGHT_REBASE_FAILED');
assert.equal(atomic.writes(), atomicWrites); assert.equal(atomic.publishCalls(), 0); assert.equal(atomic.providerCalls(), 0);

console.log(JSON.stringify({ passed: true, retained: 25, missing: 3, publish_calls: 1, provider_calls: 0,
  model_calls: 0, blocked_zero_writes: 4, atomic_rollback: true }));
