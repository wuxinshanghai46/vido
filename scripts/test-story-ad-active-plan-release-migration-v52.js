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
  const callsBefore = modelCalls(fixture.taskId);
  const migrated = publication.migrateCompatibleRelease(fixture.taskId, { fingerprint: fixture.fingerprint, reason: 'v52-test' });
  assert.equal(migrated.migrated, true);
  const after = publication.activeRecord(fixture.taskId);
  assert.equal(after.plan_id, fixture.candidateId);
  assert.equal(after.active_revision, 3);
  assert.equal(after.plan.release_envelope.producer_bundle_id, release.identity().bundle_id);
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

const guarded = createFixture({ id: 'anon-guarded', oldBundle: 'legacy-guarded', castCount: 2, propCount: 0, sceneCount: 4 });
storage.updateTask(guarded.taskId, { active_generation_id: 'another-job', active_stage: 'person_plan' });
assert.equal(publication.migrateCompatibleRelease(guarded.taskId, { fingerprint: guarded.fingerprint }).blocked, true);
storage.updateTask(guarded.taskId, { active_generation_id: '', active_stage: '' });
storage.saveModelCall({ id: 'unknown-active', task_id: guarded.taskId, stage: 'person_plan', status: 'running', billing_state: 'unknown', provider_submission_state: 'submitted_unknown' });
assert.equal(publication.migrateCompatibleRelease(guarded.taskId, { fingerprint: guarded.fingerprint }).blocked, true);
storage.saveModelCall({ id: 'unknown-active', task_id: guarded.taskId, stage: 'person_plan', status: 'failed', billing_state: 'confirmed', provider_submission_state: 'failed' });

const originalSaveOutput = storage.saveOutput;
let writes = 0;
storage.saveOutput = (...args) => {
  writes += 1;
  if (writes === 2) throw new Error('simulated-active-write-failure');
  return originalSaveOutput(...args);
};
assert.throws(() => publication.migrateCompatibleRelease(guarded.taskId, { fingerprint: guarded.fingerprint }), /simulated-active-write-failure/);
storage.saveOutput = originalSaveOutput;
assert.equal(publication.activeRecord(guarded.taskId).plan.release_envelope.producer_bundle_id, 'legacy-guarded', 'failed JSON batch must retain old active plan');
assert.equal(storage.getOutput(guarded.taskId, publication.RELEASE_MIGRATION_KIND), null);

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

console.log(JSON.stringify({ passed: true, production_shape_fixtures: fixtures.length, incompatible_cases: incompatibleCases.length, model_calls_added: 0, cli_dry_run: true, cli_apply_explicit_task: true }));
