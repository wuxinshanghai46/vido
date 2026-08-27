'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-active-plan-release-v52-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const publication = require('../src/services/newStoryAd/assetPlanPublicationService');
const generationPermit = require('../src/services/newStoryAd/generationPermitService');
const coverage = require('../src/services/newStoryAd/storySceneCoverageService');
const release = require('../src/services/storyAdReleaseBundleService');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function relation(era, time, location, environment) { return { era, time, location, environment }; }
function beat(id, phase, location, change = false) {
  return {
    id, phase, era: '当前任务时代', time_anchor: `${id}时刻`, location,
    production_state: `${id}可见状态`,
    production_relation: relation(change ? 'changed' : 'same', change ? 'changed' : 'continuous', change ? 'changed' : 'same', change ? 'changed' : 'same'),
    production_requirements: { layout: `${location}布局`, material_light: `${id}光线`, interaction: `${id}行动`, negative: '禁止任务外内容' },
    summary: `${id}推动行动`, cause: `${id}前因`, consequence: `${id}结果`,
  };
}
function context(id, castCount) {
  return {
    request_id: id, brief: `${id}匿名生产结构`, content_mode: 'narrative_story', content_mode_source: 'user',
    product_presentation: { mode: 'narrative_story', subject: '', standalone_generation_supported: false },
    story_scene_contract_version: coverage.CONTRACT_VERSION,
    target_duration: 15, shot_count: 4, output_ratio: '9:16', expected_people: castCount, cast_mode: 'multi',
    cast_profiles: [], pet_profiles: [], prop_assets: [], scene_assets: [], assets: [], creative_direction: {}, performance: {},
  };
}
function rawPlan(castCount, propCount, sceneCount) {
  const phases = ['opening', 'development', 'turning_point', 'resolution'];
  const beats = Array.from({ length: Math.max(4, sceneCount) }, (_, index) => beat(
    `beat_${index + 1}`,
    phases[Math.min(index, phases.length - 1)],
    `space_${Math.min(index + 1, sceneCount)}`,
    index === 0 || index >= 2,
  ));
  return coverage.compileAssetPlan({
    cast_profiles: Array.from({ length: castCount }, (_, index) => ({ id: `cast_${index + 1}`, name: `人物${index + 1}`, role: '剧情人物', look_profiles: [{ id: `cast_${index + 1}_look_1` }] })),
    pet_profiles: [],
    prop_plan: Array.from({ length: propCount }, (_, index) => ({ id: `prop_${index + 1}`, name: `道具${index + 1}` })),
    story_seed: {
      logline: '匿名剧情闭环', opening: '建立目标', development: '行动升级', turning_point: '发生转折', resolution: '完成回收', plot_beats: beats,
    },
  });
}
function oldEnvelope(oldBundle) { return { ...release.envelope(), producer_bundle_id: oldBundle, build_id: `legacy-${oldBundle}` }; }
function createFixture({ id, oldBundle, castCount, propCount, sceneCount, opaquePlanFingerprint = '' }) {
  const ctx = context(id, castCount);
  storage.createTask({ id, title: '匿名历史任务', content_revision: 8, request: ctx, status: 'done', stage: 'scene_config_done' });
  storage.updateTask(id, { required_bundle_id: oldBundle }, { systemFinalization: true });
  const task = storage.getTask(id);
  const currentFingerprint = assetPlan.fingerprint(task, ctx);
  const fingerprint = opaquePlanFingerprint || currentFingerprint;
  ctx.asset_plan_fingerprint = fingerprint;
  storage.saveOutput(id, 'context', ctx);
  const compiled = rawPlan(castCount, propCount, sceneCount);
  const candidateId = `${id}-candidate`;
  const base = {
    ...compiled, status: 'active', candidate_id: candidateId, active_revision: 3, content_revision: 8,
    fingerprint, story_scene_contract_version: coverage.CONTRACT_VERSION, release_envelope: oldEnvelope(oldBundle),
  };
  const domains = Object.fromEntries(['person', 'scene'].map(domain => [domain, { bundle_id: oldBundle, fingerprint, content_revision: 8 }]));
  const plan = { ...base, domain_state: domains };
  storage.saveOutput(id, publication.CANDIDATE_KIND, { ...base, status: 'candidate', validation_status: 'passed', validation_issues: [] });
  storage.saveOutput(id, publication.ACTIVE_KIND, { plan_id: candidateId, active_revision: 3, content_revision: 8, fingerprint, release_envelope: base.release_envelope, domain_state: domains, plan });
  storage.saveOutput(id, 'asset_plan', plan);
  return { taskId: id, fingerprint: currentFingerprint, planFingerprint: fingerprint, candidateId, plan };
}
function modelCalls(taskId) { return (storage.readDb().model_calls || []).filter(row => row.task_id === taskId).length; }
function nextTimestamp() { const started = Date.now(); while (Date.now() === started) {} }

function createLegacyV14Fixture(id) {
  const ctx = context(id, 2);
  storage.createTask({ id, title: '匿名V14任务', content_revision: 8, request: ctx, status: 'done', stage: 'scene_config_done' });
  const task = storage.getTask(id);
  const fingerprint = assetPlan.legacyFingerprintV14(task, ctx);
  ctx.asset_plan_fingerprint = fingerprint;
  storage.saveOutput(id, 'context', ctx);
  storage.saveArtifact(id, 'context', ctx, { content_revision: 8, snapshot_id: `${id}:r8:context` });
  storage.saveOutput(id, 'person_demographics_migration_backup_v63', { context: ctx });
  const candidateId = `${id}-candidate`;
  const envelope = oldEnvelope('legacy-v14-bundle');
  const domains = Object.fromEntries(['person', 'scene'].map(domain => [domain, {
    bundle_id: 'legacy-v14-bundle', fingerprint, content_revision: 8,
  }]));
  const base = {
    ...rawPlan(2, 0, 4), candidate_id: candidateId, content_revision: 8, fingerprint,
    fingerprint_contract: publication.LEGACY_FINGERPRINT_CONTRACT,
    story_scene_contract_version: coverage.CONTRACT_VERSION, release_envelope: envelope,
  };
  const plan = { ...base, status: 'active', active_revision: 3, domain_state: domains };
  storage.saveOutput(id, publication.CANDIDATE_KIND, {
    ...base, status: 'candidate', validation_status: 'passed', validation_issues: [],
  });
  storage.saveOutput(id, publication.ACTIVE_KIND, {
    plan_id: candidateId, active_revision: 3, content_revision: 8, fingerprint,
    fingerprint_contract: publication.LEGACY_FINGERPRINT_CONTRACT,
    release_envelope: envelope, domain_state: domains, plan,
  });
  storage.saveOutput(id, 'asset_plan', plan);
  return { taskId: id, fingerprint, currentFingerprint: assetPlan.fingerprint(task, ctx) };
}

const fixtures = [
  createFixture({ id: 'anon-tech-structure', oldBundle: 'c06ecadb-old-v50', castCount: 2, propCount: 0, sceneCount: 7 }),
  createFixture({
    id: 'anon-story-structure', oldBundle: 'afbaed96-old-v39', castCount: 4, propCount: 5, sceneCount: 9,
    // Production V224 stored a digest from projection v12. It is intentionally
    // opaque to v14 and must be proven by persisted lineage, not re-hashed.
    opaquePlanFingerprint: '285489a1f21dfb471e0260c02219d0ace27a2877e7e728177821beffac0e3e4e',
  }),
];

for (const fixture of fixtures) {
  const before = publication.activeRecord(fixture.taskId);
  const semanticHash = hash({ cast: before.plan.cast_profiles, props: before.plan.prop_plan, scenes: before.plan.scene_plan, story: before.plan.story_seed });
  const compatibility = publication.releaseCompatibility({
    task: storage.getTask(fixture.taskId), context: storage.getOutput(fixture.taskId, 'context'), plan: before.plan,
    activeRecord: before, candidate: storage.getOutput(fixture.taskId, publication.CANDIDATE_KIND), fingerprint: fixture.fingerprint,
  });
  assert.equal(compatibility.compatible, true, `${fixture.taskId} old envelope with complete contract fields should be compatible`);
  assert.equal(compatibility.fingerprint_basis, 'legacy_revision_and_persisted_lineage');
  assert.equal(compatibility.migration_required, true);
  const publicEligibility = publication.publicEligibility(fixture.taskId, { fingerprint: fixture.fingerprint });
  if (compatibility.fingerprint_basis === 'same_contract_strict_hash') {
    assert.equal(publicEligibility.eligible, true, `仅发布封套变化时页面不得误报内容方案过期: ${JSON.stringify(publicEligibility)}`);
    assert.equal(publicEligibility.release_sync_pending, true);
    assert.deepEqual(publicEligibility.issues, []);
  } else {
    assert.equal(publicEligibility.eligible, false, '旧指纹合同仍必须先完成受控迁移，不得在页面静默放行');
  }
  const callsBefore = modelCalls(fixture.taskId);
  const migrated = publication.migrateCompatibleRelease(fixture.taskId, { fingerprint: fixture.fingerprint, reason: 'v52-test' });
  assert.equal(migrated.migrated, true);
  const after = publication.activeRecord(fixture.taskId);
  assert.equal(after.plan_id, fixture.candidateId);
  assert.equal(after.active_revision, 3);
  assert.equal(after.plan.release_envelope.producer_bundle_id, release.identity().bundle_id);
  assert.equal(storage.getTask(fixture.taskId).required_bundle_id, release.identity().bundle_id,
    '兼容迁移必须在同一原子事务内同步任务与 Active Plan 的 release bundle');
  assert.equal(hash({ cast: after.plan.cast_profiles, props: after.plan.prop_plan, scenes: after.plan.scene_plan, story: after.plan.story_seed }), semanticHash);
  const candidate = storage.getOutput(fixture.taskId, publication.CANDIDATE_KIND);
  assert.equal(candidate.candidate_id, after.plan_id);
  assert.equal(candidate.fingerprint, after.fingerprint);
  assert.equal(candidate.validation_status, 'passed');
  assert.equal(candidate.fingerprint_contract, publication.FINGERPRINT_CONTRACT);
  assert.equal(after.plan.fingerprint_contract, publication.FINGERPRINT_CONTRACT);
  assert.equal(modelCalls(fixture.taskId), callsBefore);
  const migrationTimestamp = storage.getOutput(fixture.taskId, publication.RELEASE_MIGRATION_KIND).migrated_at;
  const repeated = publication.migrateCompatibleRelease(fixture.taskId, { fingerprint: fixture.fingerprint, reason: 'v52-test-repeat' });
  assert.equal(repeated.migrated, false);
  assert.equal(repeated.compatibility.already_current, true);
  assert.equal(storage.getOutput(fixture.taskId, publication.RELEASE_MIGRATION_KIND).migrated_at, migrationTimestamp);
}

const ownedSceneMigration = createFixture({ id: 'owned-scene-release-migration', oldBundle: 'legacy-owned-scene', castCount: 2, propCount: 0, sceneCount: 4 });
const ownedSceneGenerationId = 'owned-scene-generation';
storage.createGenerationRun({
  id: 'owned-scene-release-unit', task_id: ownedSceneMigration.taskId, work_id: ownedSceneMigration.taskId,
  domain: 'scene_plan', target_permanent_id: `${ownedSceneMigration.taskId}:scene_plan`, operation: 'run_scene_plan',
  input_fingerprint: ownedSceneMigration.fingerprint, spec_revision: 8, provider_id: 'internal-orchestrator', model_id: 'legacy-owned-scene',
  orchestration_job_id: ownedSceneGenerationId, state: 'running', unit_version: 1,
  billing_state: 'not_submitted', provider_submission_state: 'not_applicable',
});
storage.updateTask(ownedSceneMigration.taskId, { active_generation_id: ownedSceneGenerationId, active_stage: 'scene_plan' });
const ownedSceneResult = publication.migrateCompatibleRelease(ownedSceneMigration.taskId, {
  fingerprint: ownedSceneMigration.fingerprint, generationId: ownedSceneGenerationId, reason: 'owned-scene-release-migration',
});
assert.equal(ownedSceneResult.migrated, true, '当前 scene-plan job 必须能完成自己的零模型版本迁移');
assert.equal(storage.getTask(ownedSceneMigration.taskId).required_bundle_id, release.identity().bundle_id,
  'scene-plan 自有迁移必须同步任务 release bundle');
assert.equal(storage.getGenerationRun('owned-scene-release-unit').authority_id, storage.getTask(ownedSceneMigration.taskId).active_authority_id,
  '当前 scene-plan generation unit 必须绑定到迁移后的新 Active authority');
assert.equal(modelCalls(ownedSceneMigration.taskId), 0, '当前 scene-plan 版本迁移不得调用模型');

const unrelatedSceneMigration = createFixture({ id: 'unrelated-scene-release-migration', oldBundle: 'legacy-unrelated-scene', castCount: 2, propCount: 0, sceneCount: 4 });
storage.createGenerationRun({
  id: 'owned-scene-unit-with-neighbor', task_id: unrelatedSceneMigration.taskId, work_id: unrelatedSceneMigration.taskId,
  domain: 'scene_plan', target_permanent_id: `${unrelatedSceneMigration.taskId}:scene_plan`, operation: 'run_scene_plan',
  input_fingerprint: unrelatedSceneMigration.fingerprint, spec_revision: 8, provider_id: 'internal-orchestrator', model_id: 'legacy-unrelated-scene',
  orchestration_job_id: 'owned-scene-job-with-neighbor', state: 'running', unit_version: 1,
  billing_state: 'not_submitted', provider_submission_state: 'not_applicable',
});
storage.createGenerationRun({
  id: 'unrelated-active-scene-unit', task_id: unrelatedSceneMigration.taskId, work_id: unrelatedSceneMigration.taskId,
  domain: 'scene_plan', target_permanent_id: `${unrelatedSceneMigration.taskId}:scene_plan:other`, operation: 'run_scene_plan',
  input_fingerprint: `${unrelatedSceneMigration.fingerprint}:other`, spec_revision: 8, provider_id: 'internal-orchestrator', model_id: 'legacy-unrelated-scene',
  orchestration_job_id: 'unrelated-active-scene-job', state: 'running', unit_version: 1,
  billing_state: 'not_submitted', provider_submission_state: 'not_applicable',
});
storage.updateTask(unrelatedSceneMigration.taskId, { active_generation_id: 'owned-scene-job-with-neighbor', active_stage: 'scene_plan' });
assert.throws(() => publication.migrateCompatibleRelease(unrelatedSceneMigration.taskId, {
  fingerprint: unrelatedSceneMigration.fingerprint, generationId: 'owned-scene-job-with-neighbor',
}), error => error?.code === 'AUTHORITY_PROMOTION_BLOCKED', '无关活动 generation 仍必须阻止版本迁移');

const lazyPermitMigration = createFixture({ id: 'lazy-permit-release-migration', oldBundle: 'legacy-lazy-permit', castCount: 2, propCount: 0, sceneCount: 4 });
const lazyPermit = generationPermit.issue(lazyPermitMigration.taskId, 'scene_asset', { idempotencyKey: 'lazy-scene-generation' });
assert.equal(lazyPermit.release_bundle_id, release.identity().bundle_id, '受保护生成必须先零模型迁移到当前 release 再签发许可');
assert.equal(storage.getTask(lazyPermitMigration.taskId).required_bundle_id, release.identity().bundle_id,
  '生成许可懒迁移必须同步任务 release bundle');
assert.equal(publication.eligibility(lazyPermitMigration.taskId, { fingerprint: lazyPermitMigration.fingerprint }).eligible, true);
assert.equal(modelCalls(lazyPermitMigration.taskId), 0, '生成许可的 release 同步不得调用模型');

const legacyV14 = createLegacyV14Fixture('legacy-v14-four-source');
assert.notEqual(legacyV14.currentFingerprint, legacyV14.fingerprint, 'V15必须与旧V14投影明确分版');
const legacyV14Calls = modelCalls(legacyV14.taskId);
const legacyV14Migrated = publication.migrateCompatibleRelease(legacyV14.taskId, {
  fingerprint: legacyV14.currentFingerprint, reason: 'v14-four-source-proof',
});
assert.equal(legacyV14Migrated.migrated, true);
assert.equal(legacyV14Migrated.compatibility.fingerprint_basis, 'legacy_v14_four_source_exact_match');
assert.equal(publication.activeRecord(legacyV14.taskId).fingerprint_contract, publication.FINGERPRINT_CONTRACT);
assert.equal(publication.activeRecord(legacyV14.taskId).fingerprint, legacyV14.currentFingerprint);
assert.equal(modelCalls(legacyV14.taskId), legacyV14Calls, '兼容迁移不得新增模型调用');
assert.equal(publication.migrateCompatibleRelease(legacyV14.taskId, {
  fingerprint: legacyV14.currentFingerprint,
}).migrated, false, '兼容迁移必须幂等');

const legacyChanged = createLegacyV14Fixture('legacy-v14-semantic-changed');
storage.updateTask(legacyChanged.taskId, {
  request: { ...storage.getTask(legacyChanged.taskId).request, brief: '用户已经修改的不同语义输入' },
});
const semanticChangedResult = publication.migrateCompatibleRelease(legacyChanged.taskId, {
  fingerprint: assetPlan.fingerprint(storage.getTask(legacyChanged.taskId), storage.getOutput(legacyChanged.taskId, 'context')),
});
assert.equal(semanticChangedResult.migrated, false);
assert(semanticChangedResult.compatibility.issues.includes('active_plan_legacy_v14_proof_failed'));

const legacyUnknown = createLegacyV14Fixture('legacy-v14-unknown-billing');
storage.saveModelCall({
  id: 'legacy-v14-unknown-call', task_id: legacyUnknown.taskId, stage: 'person_plan',
  status: 'failed', billing_state: 'unknown', provider_submission_state: 'submitted_unknown',
});
const unknownResult = publication.migrateCompatibleRelease(legacyUnknown.taskId, {
  fingerprint: legacyUnknown.currentFingerprint,
});
assert.equal(unknownResult.blocked, true);
assert(unknownResult.compatibility.issues.includes('unknown_billing_unquarantined'));

const legacyActive = createLegacyV14Fixture('legacy-v14-active-generation');
storage.updateTask(legacyActive.taskId, { active_generation_id: 'same-generation' });
const activeResult = publication.migrateCompatibleRelease(legacyActive.taskId, {
  fingerprint: legacyActive.currentFingerprint, generationId: 'same-generation',
});
assert.equal(activeResult.blocked, true, '旧合同兼容迁移必须等待活动生成完全结束');
assert(activeResult.compatibility.issues.includes('active_generation_exists'));

const legacyWrongTarget = createLegacyV14Fixture('legacy-v14-wrong-target');
const wrongTargetResult = publication.migrateCompatibleRelease(legacyWrongTarget.taskId, {
  fingerprint: 'caller-supplied-wrong-v15-fingerprint',
});
assert.equal(wrongTargetResult.migrated, false, '目标V15指纹也必须由当前权威context重算证明');
assert(wrongTargetResult.compatibility.issues.includes('active_plan_input_fingerprint_mismatch'));

const legacyLatestMismatch = createLegacyV14Fixture('legacy-v14-latest-artifact-mismatch');
nextTimestamp();
storage.saveArtifact(legacyLatestMismatch.taskId, 'context', {
  ...storage.getOutput(legacyLatestMismatch.taskId, 'context'), brief: '最新artifact已经变化',
}, { content_revision: 8, snapshot_id: 'latest-mismatch' });
const latestMismatchResult = publication.migrateCompatibleRelease(legacyLatestMismatch.taskId, {
  fingerprint: legacyLatestMismatch.currentFingerprint,
});
assert.equal(latestMismatchResult.migrated, false, '最新artifact不匹配时不得被更旧的匹配artifact掩盖');
assert(latestMismatchResult.compatibility.issues.includes('active_plan_legacy_v14_proof_failed'));

const legacyLatestMatch = createLegacyV14Fixture('legacy-v14-latest-artifact-match');
nextTimestamp();
storage.saveArtifact(legacyLatestMatch.taskId, 'context', {
  ...storage.getOutput(legacyLatestMatch.taskId, 'context'), brief: '较旧artifact不匹配',
}, { content_revision: 8, snapshot_id: 'older-mismatch' });
nextTimestamp();
storage.saveArtifact(legacyLatestMatch.taskId, 'context', storage.getOutput(legacyLatestMatch.taskId, 'context'), {
  content_revision: 8, snapshot_id: 'newest-match',
});
assert.equal(publication.migrateCompatibleRelease(legacyLatestMatch.taskId, {
  fingerprint: legacyLatestMatch.currentFingerprint,
}).migrated, true, '最新artifact匹配时不应被更旧的artifact误阻断');

const legacyNewProjectionDrift = createLegacyV14Fixture('legacy-v14-new-projection-drift');
nextTimestamp();
storage.saveArtifact(legacyNewProjectionDrift.taskId, 'context', {
  ...storage.getOutput(legacyNewProjectionDrift.taskId, 'context'), revisions: { scene: 1 },
}, { content_revision: 8, snapshot_id: 'new-projection-semantic-drift' });
assert.equal(assetPlan.legacyFingerprintV14(
  storage.getTask(legacyNewProjectionDrift.taskId),
  storage.listArtifacts(legacyNewProjectionDrift.taskId, 'context')[0].payload,
), legacyNewProjectionDrift.fingerprint, '该场景语义差异在旧V14投影中不可见');
const newProjectionDriftResult = publication.migrateCompatibleRelease(legacyNewProjectionDrift.taskId, {
  fingerprint: legacyNewProjectionDrift.currentFingerprint,
});
assert.equal(newProjectionDriftResult.migrated, false, '四源还必须在新V15语义投影下保持一致');
assert(newProjectionDriftResult.compatibility.issues.includes('active_plan_legacy_v14_proof_failed'));

const guarded = createFixture({ id: 'anon-guarded', oldBundle: 'legacy-guarded', castCount: 2, propCount: 0, sceneCount: 4 });
storage.updateTask(guarded.taskId, { active_generation_id: 'another-job', active_stage: 'person_plan' });
assert.equal(publication.migrateCompatibleRelease(guarded.taskId, { fingerprint: guarded.fingerprint }).blocked, true);
storage.updateTask(guarded.taskId, { active_generation_id: '', active_stage: '' });
storage.saveModelCall({ id: 'unknown-active', task_id: guarded.taskId, stage: 'person_plan', status: 'running', billing_state: 'unknown', provider_submission_state: 'submitted' });
let billingBlocked = publication.migrateCompatibleRelease(guarded.taskId, { fingerprint: guarded.fingerprint });
assert.equal(billingBlocked.blocked, true);
assert(billingBlocked.compatibility.issues.includes('active_unknown_billing_exists'));
assert(billingBlocked.compatibility.issues.includes('unknown_billing_unquarantined'));
storage.saveModelCall({ id: 'unknown-active', task_id: guarded.taskId, stage: 'person_plan', status: 'failed', billing_state: 'confirmed', provider_submission_state: 'failed' });
storage.saveModelCall({ id: 'unknown-historical', task_id: guarded.taskId, stage: 'person_plan', status: 'failed', billing_state: 'unknown', provider_submission_state: 'submitted_unknown' });
billingBlocked = publication.migrateCompatibleRelease(guarded.taskId, { fingerprint: guarded.fingerprint });
assert.equal(billingBlocked.blocked, true);
assert.deepEqual(billingBlocked.compatibility.issues, ['unknown_billing_unquarantined']);
storage.createGenerationRun({
  id: 'quarantine-unknown-historical', task_id: guarded.taskId, work_id: guarded.taskId,
  state: 'billing_unknown', billing_state: 'unknown', legacy_model_call_id: 'unknown-historical',
});
assert.throws(
  () => publication.migrateCompatibleRelease(guarded.taskId, { fingerprint: guarded.fingerprint }),
  error => error?.code === 'AUTHORITY_PROMOTION_BLOCKED',
  '计费未核清的隔离 run 也必须阻止切换新 Active',
);
assert.throws(
  () => generationPermit.issue(guarded.taskId, 'scene_asset', { idempotencyKey: 'billing-review-copy' }),
  error => error?.code === 'GENERATION_BILLING_REVIEW_REQUIRED'
    && /历史图片调用的计费状态尚未核清/.test(error.message),
  '生成入口必须显示历史计费待核对，不能继续误报为没有本版本 Active Plan',
);
storage.updateGenerationRun('quarantine-unknown-historical', { state: 'failed', billing_state: 'confirmed' });
storage.saveModelCall({ id: 'unknown-historical', task_id: guarded.taskId, stage: 'person_plan', status: 'failed', billing_state: 'confirmed', provider_submission_state: 'failed' });
assert.equal(publication.migrateCompatibleRelease(guarded.taskId, { fingerprint: guarded.fingerprint }).migrated, true);

const failureGuarded = createFixture({ id: 'anon-write-failure', oldBundle: 'legacy-write-failure', castCount: 2, propCount: 0, sceneCount: 4 });

const originalSaveOutput = storage.saveOutput;
let writes = 0;
storage.saveOutput = (...args) => {
  writes += 1;
  if (writes === 2) throw new Error('simulated-active-write-failure');
  return originalSaveOutput(...args);
};
assert.throws(() => publication.migrateCompatibleRelease(failureGuarded.taskId, { fingerprint: failureGuarded.fingerprint }), /simulated-active-write-failure/);
storage.saveOutput = originalSaveOutput;
assert.equal(publication.activeRecord(failureGuarded.taskId).plan.release_envelope.producer_bundle_id, 'legacy-write-failure', 'failed JSON batch must retain old active plan');
assert.equal(storage.getTask(failureGuarded.taskId).required_bundle_id, 'legacy-write-failure',
  '失败迁移必须把任务 release bundle 与 Active Plan 一起回滚');
assert.equal(storage.getOutput(failureGuarded.taskId, publication.RELEASE_MIGRATION_KIND), null);

const incompatibleCases = [
  ['fingerprint', { strictFingerprintContract: true, fingerprint: 'different' }, 'active_plan_input_fingerprint_mismatch'],
  ['revision', { taskPatch: { content_revision: 9 } }, 'active_plan_content_revision_mismatch'],
  ['candidate', { candidatePatch: { validation_status: 'rejected' } }, 'asset_plan_candidate_inconsistent'],
  ['contract', { envelopePatch: { validator_version: 'old-validator' } }, 'active_plan_contract_component_mismatch:validator_version'],
  ['stable-id', { planPatch: plan => ({ ...plan, cast_profiles: [plan.cast_profiles[0], { ...plan.cast_profiles[0] }] }) }, 'stable_id_duplicate:cast_profiles'],
];
for (const [label, change, expected] of incompatibleCases) {
  const fixture = createFixture({ id: `incompatible-${label}`, oldBundle: `legacy-${label}`, castCount: 2, propCount: 0, sceneCount: 4 });
  if (change.taskPatch) storage.updateTask(fixture.taskId, change.taskPatch);
  if (change.candidatePatch) storage.saveOutput(fixture.taskId, publication.CANDIDATE_KIND, { ...storage.getOutput(fixture.taskId, publication.CANDIDATE_KIND), ...change.candidatePatch });
  if (change.envelopePatch || change.planPatch || change.strictFingerprintContract) {
    const active = publication.activeRecord(fixture.taskId);
    let plan = change.planPatch ? change.planPatch(active.plan) : active.plan;
    if (change.envelopePatch) plan = { ...plan, release_envelope: { ...plan.release_envelope, ...change.envelopePatch } };
    if (change.strictFingerprintContract) {
      plan = { ...plan, fingerprint_contract: publication.FINGERPRINT_CONTRACT };
      const candidate = storage.getOutput(fixture.taskId, publication.CANDIDATE_KIND);
      storage.saveOutput(fixture.taskId, publication.CANDIDATE_KIND, { ...candidate, fingerprint_contract: publication.FINGERPRINT_CONTRACT });
    }
    storage.saveOutput(fixture.taskId, publication.ACTIVE_KIND, { ...active, fingerprint_contract: plan.fingerprint_contract, plan });
  }
  const result = publication.migrateCompatibleRelease(fixture.taskId, { fingerprint: change.fingerprint || fixture.fingerprint });
  assert.equal(result.migrated, false, label);
  assert(result.compatibility.issues.includes(expected), `${label}: expected ${expected}, got ${result.compatibility.issues.join(',')}`);
}

const referenceChanged = createFixture({
  id: 'anon-tech-reference-source-changed', oldBundle: 'c06ecadb-old-v50', castCount: 2, propCount: 0, sceneCount: 7,
});
storage.updateTask(referenceChanged.taskId, { content_revision: 9 });
storage.saveOutput(referenceChanged.taskId, 'context', {
  ...storage.getOutput(referenceChanged.taskId, 'context'),
  reference_video_analysis: { analysis_id: 'new-authoritative-analysis', status: 'completed' },
}, { content_revision: 9 });
const referenceChangedResult = publication.migrateCompatibleRelease(referenceChanged.taskId, { fingerprint: 'new-source-fingerprint' });
assert.equal(referenceChangedResult.migrated, false);
assert(referenceChangedResult.compatibility.issues.includes('active_plan_content_revision_mismatch'));

const cliFixture = createFixture({ id: 'cli-explicit-task', oldBundle: 'legacy-cli', castCount: 2, propCount: 0, sceneCount: 4 });
const migrationCliSource = fs.readFileSync(path.join(__dirname, 'migrate-story-ad-active-plan-release.js'), 'utf8');
assert.doesNotMatch(migrationCliSource, /storage\.readDb\(\)/, '单任务发布迁移不得全库扫描模型调用记录');
assert.match(migrationCliSource, /listModelCalls\(taskId/, '单任务发布迁移必须按 taskId 查询模型调用记录');
const publicationSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'newStoryAd', 'assetPlanPublicationService.js'), 'utf8');
const migrationBody = publicationSource.match(/function migrateCompatibleRelease[\s\S]*?\n}\n\nfunction eligibility/)?.[0] || '';
assert.doesNotMatch(migrationBody, /storage\.readDb\(\)/, '发布迁移写入前的计费审计不得读取完整数据库');
assert.doesNotMatch(migrationBody, /getTaskBundle\(taskId/, '发布迁移计费审计不得读取目标任务的全部输出');
assert.match(migrationBody, /listOutputsByKindPrefixes\(taskId/, '发布迁移计费审计必须只查询计费检查点输出');
assert.match(migrationBody, /listModelCalls\(taskId\)/, '发布迁移计费审计必须按 taskId 查询模型调用');
assert.match(migrationBody, /listGenerationRuns\(\{ task_id: taskId \}\)/, '发布迁移计费审计必须按 taskId 查询生成单元');
function cli(args) {
  return spawnSync(process.execPath, [path.join(__dirname, 'migrate-story-ad-active-plan-release.js'), ...args], {
    env: process.env, cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
  });
}
const dry = cli(['--task', cliFixture.taskId]);
assert.equal(dry.status, 0, dry.stderr);
assert.equal(JSON.parse(dry.stdout).mode, 'dry-run');
assert.equal(publication.activeRecord(cliFixture.taskId).plan.release_envelope.producer_bundle_id, 'legacy-cli');
const applied = cli(['--apply', '--task', cliFixture.taskId]);
assert.equal(applied.status, 0, applied.stderr);
assert.equal(JSON.parse(applied.stdout).model_calls_added, 0);
const idempotent = cli(['--apply', '--task', cliFixture.taskId]);
assert.equal(idempotent.status, 0, idempotent.stderr);
assert.equal(JSON.parse(idempotent.stdout).idempotent, true);
assert.notEqual(cli(['--apply']).status, 0);

console.log(JSON.stringify({ passed: true, production_shape_fixtures: fixtures.length, incompatible_cases: incompatibleCases.length, owned_scene_release_migration: true, unrelated_generation_blocked: true, lazy_permit_release_migration: true, model_calls_added: 0, cli_dry_run: true, cli_apply_explicit_task: true }));
