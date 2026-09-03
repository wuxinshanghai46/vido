'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-cast-lineage-v417-'));
process.env.OUTPUT_DIR = output;
process.env.DB_ENABLED = '0';
const storage = require('../src/services/newStoryAd/storageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const lineage = require('../src/services/newStoryAd/assetPlanCastLineageService');
const publication = require('../src/services/newStoryAd/assetPlanPublicationService');
const lifecycle = require('../src/services/newStoryAd/personAssetLifecycleService');
const permits = require('../src/services/newStoryAd/generationPermitService');

function scenario(index) {
  const id = `new-project-${index}-${'a'.repeat(150)}`;
  const cast = [{ id: `actor-${index}`, name: `角色${index}`, displayName: `角色${index}`, role: '讲解者',
    age: '25岁', appearanceText: '原创成年人物', wardrobeText: '白色衬衫', hairMakeupText: '自然短发' }];
  const ctx = { content_mode: 'commercial_subject', brief: '原创产品讲解', cast_mode: 'single',
    expected_people: 1, cast_profiles: cast, pet_profiles: [], revisions: { person: 1 },
    asset_plan_generated_cast_fingerprint: lineage.fingerprint(cast) };
  storage.createTask({ id, status: 'done', request: ctx });
  storage.saveOutput(id, 'context', ctx);
  const before = assetPlan.fingerprint(storage.getTask(id), ctx);
  publication.publish(id, { cast_profiles: cast, scene_plan: { spaces: [] } }, { fingerprint: before, scope: 'person' });
  const member = { status: 'verified', verification: { state: 'verified' }, cross_view_qa: { pass: true,
    checked_at: '2026-09-03T00:00:00Z', updated_at: '2026-09-03T00:00:01Z' },
    updated_at: '2026-09-03T00:00:02Z', reference_views: { front: { url: `/person-${index}.png`, created_at: '2026-09-03T00:00:00Z' } } };
  lifecycle.commitGeneratedSubjectAssets(id, { counts: { mode: 'single' }, pet_profiles: [],
    cast_assets: [{ id: `asset-${index}`, actor_id: `provider-${index}`, subject_profile: cast[0],
      image_url: `/person-${index}.png`, person_contract: member }],
    person_contract: { ...member, member_contracts: [member] } }, {}, { change_kind: 'visual_dossier' });
  const next = storage.getOutput(id, 'context');
  assert.notEqual(storage.canonicalFingerprint(next.cast_profiles), lineage.fingerprint(next.cast_profiles), 'nested QA timestamps reproduce the incompatible serializers');
  assert.equal(assetPlan.fingerprint(storage.getTask(id), next), before, 'generating a person image must not turn a new task into a stale textual plan');
  assert.equal(next.asset_plan_generated_cast_fingerprint, lineage.fingerprint(next.cast_profiles));
  publication.publish(id, { cast_profiles: next.cast_profiles, scene_plan: { spaces: [{ id: 'scene-1' }] } },
    { fingerprint: assetPlan.fingerprint(storage.getTask(id), next), scope: 'scene' });
  assert.equal(publication.eligibility(id, { fingerprint: before }).eligible, true, 'first scene publication must retain the current person domain');
  const permit = permits.issue(id, 'scene_asset', { idempotencyKey: `scene-${index}` });
  assert.equal(permit.status, 'issued');
  assert.equal(permits.consume(id, permit).status, 'consumed');
  const edited = { ...next, cast_profiles: [{ ...next.cast_profiles[0], wardrobeText: '蓝色外套' }] };
  assert.notEqual(assetPlan.fingerprint(storage.getTask(id), edited), before, 'actual wardrobe edits must still invalidate the plan');
  assert.equal(storage.listModelCalls(id).length, 0);
  // Reproduce an already persisted production task made by the old writer.
  const broken = { ...next, asset_plan_generated_cast_fingerprint: storage.canonicalFingerprint(next.cast_profiles) };
  const brokenFingerprint = assetPlan.fingerprint(storage.getTask(id), broken);
  storage.saveOutput(id, 'context', broken);
  storage.updateTask(id, { request: broken });
  const brokenPlan = publication.publish(id, publication.currentPlan(id), { fingerprint: brokenFingerprint,
    source: 'initial_scene_plan_section_completion', scope: 'scene' });
  storage.saveOutput(id, publication.CANDIDATE_KIND, { ...brokenPlan, validation_status: 'passed' });
  storage.saveOutput(id, 'asset_plan', brokenPlan);
  storage.saveOutput(id, 'tts_audio', { tracks: [{ audio_url: '/retained-audio.mp3', text: '原台词' }] });
  const audio = lineage.fingerprint(storage.getOutput(id, 'tts_audio'));
  assert.deepEqual(publication.eligibility(id, { fingerprint: brokenFingerprint }).issues, ['person_plan_stale']);
  const repair = require('../src/services/newStoryAd/assetPlanCastLineageRepairService');
  const planned = repair.plan(id);
  assert.throws(() => repair.apply(id, 'outdated'), /任务状态已改变/);
  const priorRunId = `historical-attempt-${index}`;
  storage.createGenerationRun({ id: priorRunId, work_id: id, domain: 'blueprint', state: 'billing_unknown',
    billing_state: 'unknown', retry_blocked: false, automatic_retry_allowed: false });
  assert.throws(() => repair.apply(id, planned.sourceFingerprint), error => error.code === 'AUTHORITY_PROMOTION_BLOCKED');
  assert.equal(storage.getOutput(id, 'context').asset_plan_generated_cast_fingerprint, broken.asset_plan_generated_cast_fingerprint,
    'blocked promotion must roll back the attempted lineage write');
  storage.updateGenerationRun(priorRunId, { retry_blocked: true, execution_disabled: true });
  assert.equal(repair.apply(id, planned.sourceFingerprint).media_unchanged, true);
  const historical = storage.getGenerationRun(priorRunId);
  assert.equal(historical.execution_disabled, true);
  assert.equal(historical.retry_blocked, true);
  assert.equal(historical.automatic_retry_allowed, false);
  assert.equal(historical.billing_state, 'unknown');
  assert.equal(lineage.fingerprint(storage.getOutput(id, 'tts_audio')), audio);
  assert.equal(publication.eligibility(id, { fingerprint: before }).eligible, true);
  assert.equal(storage.listModelCalls(id).length, 0);
}
Promise.all([0, 1].map(index => Promise.resolve().then(() => scenario(index))))
  .then(() => console.log(JSON.stringify({ passed: true, independent_tasks: 2, nested_qa_timestamps: true,
    first_scene_permit: true, proven_record_repair: true, quarantined_history_preserved: true,
    failed_promotion_rolled_back: true, real_edit_rejected: true, model_calls: 0 })))
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(output, { recursive: true, force: true }));
